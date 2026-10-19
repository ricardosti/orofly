// Voos e fotos guardados no aparelho enquanto falta sinal.
//
// Revisão do modo offline (18/10/2026). O voo em andamento já aguentava ficar sem sinal (o
// rascunho no localStorage + a sincronização do pendingSync), mas três coisas se perdiam:
//
// 1. O VOO, ao começar outro. "Novo voo" limpava o rascunho — e um voo finalizado sem sinal
//    só existia ali. Agora ele vai pra esta fila e sobe sozinho quando o sinal voltar.
// 2. As FOTOS (mapa, observação e evidências do clima) ficavam só na memória: fechou o app,
//    sumiram, e nada mandava elas depois. Agora cada foto é guardada no IndexedDB na hora em
//    que é tirada e só sai de lá quando sobe pro Storage.
// 3. A BAIXA DE ESTOQUE de um voo finalizado sem sinal nunca acontecia (o banco gravava
//    area_deduzida como se tivesse descontado). Ela vai junto com o voo na fila.
//
// A fila de voos fica no localStorage: o payload é texto pequeno, e a gravação síncrona
// garante que ele está guardado antes de a tela trocar de voo. As fotos vão pro IndexedDB,
// que guarda o arquivo como veio (o localStorage só guarda texto, uns 5 MB por site).

import { ehFalhaDeRede, comPrazo, SemSinal } from './filaDespesas'

const FILA = 'orofly_fila_voos'

export function listarVoosNaFila() {
  try { return JSON.parse(localStorage.getItem(FILA) || '[]') } catch { return [] }
}
function gravarFila(itens) {
  localStorage.setItem(FILA, JSON.stringify(itens))
}
// Guarda (ou atualiza) um voo na fila. Lança se o aparelho não deixar gravar — quem chama
// decide o que fazer, porque nesse caso o voo NÃO está guardado.
export function enfileirarVoo(item) {
  const fila = listarVoosNaFila().filter(v => v.id !== item.id)
  gravarFila([...fila, item])
}
// Com `criado_em`, só remove se for aquela versão — se o voo foi guardado de novo enquanto
// subia, a versão nova fica.
export function removerVooDaFila(id, criado_em) {
  try { gravarFila(listarVoosNaFila().filter(v => v.id !== id || (criado_em && v.criado_em !== criado_em))) } catch {}
}

// ── Fotos ──────────────────────────────────────────────────────────────────────────────
const BANCO = 'orofly-fotos', VERSAO = 1, LOJA = 'fotos'

function abrir() {
  return new Promise((ok, falha) => {
    if (typeof indexedDB === 'undefined') return falha(new Error('este aparelho não guarda fotos offline'))
    const req = indexedDB.open(BANCO, VERSAO)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(LOJA)) req.result.createObjectStore(LOJA, { keyPath: 'chave' })
    }
    req.onsuccess = () => ok(req.result)
    req.onerror = () => falha(req.error)
  })
}
async function naLoja(modo, fazer) {
  const db = await abrir()
  try {
    return await new Promise((ok, falha) => {
      const tx = db.transaction(LOJA, modo)
      const req = fazer(tx.objectStore(LOJA))
      tx.oncomplete = () => ok(req?.result)
      tx.onerror = () => falha(tx.error)
      tx.onabort = () => falha(tx.error)
    })
  } finally {
    db.close()
  }
}

// slot: 0 (observação), 1 (evidência do início), 2 (evidência do fim) ou 'mapa'.
// Os mesmos caminhos do envio direto (uploadFotos/uploadFotoMapa): reenviar só sobrescreve.
export const caminhoFoto = (pilotoId, relId, slot) =>
  String(slot) === 'mapa' ? `${pilotoId}/${relId}/mapa.jpg` : `${pilotoId}/${relId}/obs_${slot}.jpg`

// Devolve false se o aparelho não guardou (aí a foto só existe na memória).
export function guardarFoto(relId, slot, arquivo) {
  if (!relId || !arquivo) return Promise.resolve(false)
  return naLoja('readwrite', l => l.put({ chave: `${relId}:${slot}`, relId, slot: String(slot), arquivo,
    nome: arquivo.name || '', tipo: arquivo.type || '', criado_em: new Date().toISOString() }))
    .then(() => true)
    .catch(e => { console.warn('Foto não guardada no aparelho:', e); return false })
}
export function apagarFoto(relId, slot) {
  if (!relId) return Promise.resolve()
  return naLoja('readwrite', l => l.delete(`${relId}:${slot}`)).catch(() => {})
}
export async function fotosDoVoo(relId) {
  if (!relId) return []
  try { return ((await naLoja('readonly', l => l.getAll())) || []).filter(f => f.relId === relId) } catch { return [] }
}
export async function apagarFotosDoVoo(relId) {
  for (const f of await fotosDoVoo(relId)) await apagarFoto(relId, f.slot)
}

// Sobe as fotos guardadas de um voo e grava os caminhos na linha do relatório. `obsBase` e
// `mapaBase` são o que o banco já tem — slot sem foto nova fica como está (antes ia null).
// Lança SemSinal se faltar rede; cada foto que subiu já sai do aparelho.
export async function enviarFotosGuardadas(sb, { relId, pilotoId, obsBase, mapaBase }) {
  const fotos = await fotosDoVoo(relId)
  if (!fotos.length) return null
  const obs = [0, 1, 2].map(i => obsBase?.[i] || null)
  let mapa = mapaBase || null
  const subiram = []
  for (const f of fotos) {
    const path = caminhoFoto(pilotoId, relId, f.slot)
    const { error } = await comPrazo(sb.storage.from('relatorios').upload(path, f.arquivo, { upsert: true }), 60000)
    if (error) {
      if (ehFalhaDeRede(error)) throw new SemSinal(error.message)
      continue // arquivo recusado pelo Storage: não adianta tentar de novo
    }
    if (f.slot === 'mapa') mapa = path; else obs[+f.slot] = path
    subiram.push(f)
  }
  if (!subiram.length) return null
  const { error } = await comPrazo(sb.from('relatorios').update({ obs_fotos_urls: obs, foto_mapa_url: mapa }).eq('id', relId), 20000)
  if (error) { if (ehFalhaDeRede(error)) throw new SemSinal(error.message); throw error }
  for (const f of subiram) await apagarFoto(relId, f.slot)
  return { obs, mapa, caminhos: subiram.map(f => caminhoFoto(pilotoId, relId, f.slot)) }
}

// Sobe a linha de um voo da fila. Voo com `soFotos` já está no banco (só as fotos ficaram):
// aí não regrava a linha, pra não passar por cima do que o admin já editou.
export async function enviarLinhaDoVoo(item, sb) {
  const consulta = item.soFotos
    ? sb.from('relatorios').select('id,obs_fotos_urls,foto_mapa_url').eq('id', item.id).maybeSingle()
    : sb.from('relatorios').upsert(item.payload, { onConflict: 'id' }).select('id,obs_fotos_urls,foto_mapa_url').single()
  const { data, error } = await comPrazo(consulta, 20000)
  if (error) { if (ehFalhaDeRede(error)) throw new SemSinal(error.message); throw error }
  return data
}

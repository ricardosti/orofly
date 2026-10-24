// Documentos da fazenda pra fiscalização (pedido do Rodolfo, 23/10/2026): solicitação de voo
// (SARPAS), documentos dos pilotos e da aeronave. O admin sobe no cadastro da fazenda, igual ao
// mapa; o piloto vê no app, na tela do Mapa, e os arquivos ficam guardados no aparelho pra abrir
// sem sinal — na fiscalização, no talhão, pode não ter.
//
// Arquivo no Storage em relatorios/documentos/<fazenda>/<hora>_<nome> (qualquer usuário logado
// lê; só o admin grava) e a lista em fazendas.documentos:
//   [{ nome, categoria, path, tipo, tamanho, enviado_em }]

export const CATEGORIAS_DOC = [
  ['solicitacao_voo', '📝', 'Solicitação de voo'],
  ['piloto', '🪪', 'Documento do piloto'],
  ['aeronave', '🛩️', 'Documento da aeronave'],
  ['outro', '📄', 'Outro'],
]
export const categoriaDoc = id => CATEGORIAS_DOC.find(c => c[0] === id) || CATEGORIAS_DOC[3]

// Palpite pelo nome do arquivo — o admin troca na hora se errar.
export function palpiteCategoria(nome) {
  const n = String(nome || '').toLowerCase()
  if (/solicit|autoriza|sarpas|decea|notam/.test(n)) return 'solicitacao_voo'
  if (/sisant|aeronave|drone|seguro|apolice|ap[oó]lice|t70|t50|t40|t25/.test(n)) return 'aeronave'
  if (/piloto|cnh|licen|caar|habilita|certificad|\brg\b|cpf/.test(n)) return 'piloto'
  return 'outro'
}

export function caminhoDocumento(fazendaId, nomeArquivo) {
  const seguro = String(nomeArquivo || 'documento').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_').slice(-80)
  return `documentos/${fazendaId}/${Date.now()}_${seguro}`
}

export const ehPdf = d => /pdf/i.test(d?.tipo || '') || /\.pdf$/i.test(d?.path || d?.nome || '')

export function tamanhoLegivel(bytes) {
  const b = Number(bytes) || 0
  if (b >= 1048576) return `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}

// ── No aparelho (IndexedDB), pela chave do caminho ──────────────────────────────────────
const BANCO = 'orofly-docs', LOJA = 'arquivos'

function abrirBanco() {
  return new Promise((ok, erro) => {
    const req = indexedDB.open(BANCO, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(LOJA)
    req.onsuccess = () => ok(req.result)
    req.onerror = () => erro(req.error)
  })
}
async function naLoja(modo, fazer) {
  const db = await abrirBanco()
  return new Promise((ok, erro) => {
    const tx = db.transaction(LOJA, modo)
    const req = fazer(tx.objectStore(LOJA))
    tx.oncomplete = () => ok(req?.result)
    tx.onerror = () => erro(tx.error)
  })
}

export async function documentoNoAparelho(path) {
  try { return (await naLoja('readonly', s => s.get(path))) || null } catch { return null }
}
export async function caminhosNoAparelho() {
  try { return (await naLoja('readonly', s => s.getAllKeys())) || [] } catch { return [] }
}
async function guardarNoAparelho(path, blob) {
  try { await naLoja('readwrite', s => s.put(blob, path)); return true } catch { return false }
}

// O arquivo: do aparelho, se já estiver lá; senão baixa — e guarda pra próxima vez sem sinal.
export async function abrirDocumento(supabase, doc) {
  const guardado = await documentoNoAparelho(doc.path)
  if (guardado) return { blob: guardado, doAparelho: true }
  const { data, error } = await supabase.storage.from('relatorios').download(doc.path)
  if (error || !data) throw new Error(error?.message || 'não deu pra baixar o documento')
  await guardarNoAparelho(doc.path, data)
  return { blob: data, doAparelho: false }
}

// Guarda no aparelho os documentos da fazenda que ainda não estão lá (um de cada vez) e apaga
// os que saíram da lista dela. Sem sinal, não faz nada. Devolve os caminhos guardados.
export async function guardarDocumentosDaFazenda(supabase, fazenda, aoGuardar) {
  const docs = fazenda?.documentos || []
  const ja = new Set(await caminhosNoAparelho())
  const prefixo = `documentos/${fazenda?.id}/`
  const sairam = [...ja].filter(p => typeof p === 'string' && p.startsWith(prefixo) && !docs.some(d => d.path === p))
  if (sairam.length) { try { await naLoja('readwrite', s => { sairam.forEach(p => s.delete(p)); return null }) } catch { /* fica pra próxima */ } }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return docs.filter(d => ja.has(d.path)).map(d => d.path)
  for (const d of docs) {
    if (ja.has(d.path)) continue
    try { await abrirDocumento(supabase, d); ja.add(d.path); aoGuardar?.(d.path) } catch { /* tenta de novo da próxima vez */ }
  }
  return docs.filter(d => ja.has(d.path)).map(d => d.path)
}

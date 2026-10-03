// Fila de despesas lançadas SEM SINAL: ficam guardadas no aparelho e sobem sozinhas quando
// a internet volta.
//
// Pedido do Pastor (03/10/2026). No campo o piloto lança a nota onde não tem sinal, e ela dava
// "Erro: Failed to fetch" e só existia na tela — fechou o app, perdeu. O voo já tinha isso (a
// retentativa do saveToSupabase); a despesa não.
//
// Guarda no IndexedDB, e não no localStorage, por causa da FOTO: o localStorage só guarda
// texto e tem uns 5 MB por site — três comprovantes em base64 já estourariam. O IndexedDB
// guarda o arquivo como veio, e funciona igual no app Android e no site aberto no celular.
//
// Cada nota ganha no aparelho o id que ela vai ter no banco. É isso que impede nota
// DUPLICADA: com sinal fraco, o envio pode chegar ao banco e a resposta não voltar ao
// celular. Na retentativa o banco recusa o mesmo id (código 23505) e a nota conta como
// enviada, em vez de entrar duas vezes. A foto vai pra um caminho que é o próprio id, então
// reenviar só sobrescreve o mesmo arquivo.

const BANCO = 'orofly-fila', VERSAO = 1, LOJA = 'despesas'

function abrir() {
  return new Promise((ok, falha) => {
    if (typeof indexedDB === 'undefined') return falha(new Error('este aparelho não guarda dados offline'))
    const req = indexedDB.open(BANCO, VERSAO)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(LOJA)) req.result.createObjectStore(LOJA, { keyPath: 'id' })
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

export const guardarNaFila = (item) => naLoja('readwrite', loja => loja.put(item))
export const removerDaFila = (id) => naLoja('readwrite', loja => loja.delete(id))
export async function listarFila() {
  const itens = (await naLoja('readonly', loja => loja.getAll())) || []
  return itens.sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)))
}

// Pede ao navegador pra não apagar a fila quando faltar espaço. No app instalado isso não
// acontece; no site aberto no Chrome do celular, sem o pedido, o navegador pode limpar.
export function pedirArmazenamentoPersistente() {
  try { navigator.storage?.persist?.() } catch { /* navegador sem suporte: segue sem o pedido */ }
}

export class SemSinal extends Error {}

// O cliente do Supabase NÃO lança em falha de rede: devolve { error } com a mensagem do
// fetch ("Failed to fetch" no Chrome, "Load failed" no Safari) e sem código do Postgres.
// Erro COM código (RLS, coluna errada, duplicado) é resposta do banco — a rede funcionou, e
// tentar de novo não vai adiantar.
export function ehFalhaDeRede(e) {
  if (!e) return false
  if (e instanceof SemSinal) return true
  if (/^[0-9A-Z]{5}$/.test(e.code || '')) return false
  return /fetch|network|load failed|timeout|tempo esgotado|abort|offline|ERR_INTERNET|ECONN/i
    .test(`${e.message || ''} ${e.name || ''} ${e.details || ''}`)
}

// Prazo pra uma tentativa. No campo o sinal "existe" mas não passa nada, e sem prazo o botão
// ficaria em "Salvando..." pra sempre. Se a tentativa abandonada chegar ao banco depois, não
// faz mal: o id gerado no aparelho impede a duplicata.
export function comPrazo(promessa, ms) {
  let t
  const prazo = new Promise((_, falha) => { t = setTimeout(() => falha(new SemSinal(`tempo esgotado (${ms / 1000}s)`)), ms) })
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(t))
}

// Envia UMA despesa: foto, vínculo com o voo pela OS e a linha da despesa. Recebe o cliente
// do Supabase por parâmetro pra dar pra testar sem banco de verdade. Lança SemSinal quando
// falta rede (a nota fica na fila); qualquer outro erro é do banco e vai pro chamador.
export async function enviarDespesa(item, sb) {
  let foto_url = null
  if (item.foto) {
    const path = `despesas/${item.piloto_id}/${item.id}.${item.fotoExt || 'jpg'}`
    const { error } = await sb.storage.from('relatorios')
      .upload(path, item.foto, { upsert: true, contentType: item.foto.type || undefined })
    if (error && ehFalhaDeRede(error)) throw new SemSinal(error.message)
    // Erro do Storage que não é de rede (arquivo recusado): segue sem a foto, como o envio
    // direto sempre fez — travar a nota inteira por causa do anexo seria pior.
    if (!error) foto_url = path
  }
  let relatorio_id = null
  if (item.ordem_servico) {
    const { data, error } = await sb.from('relatorios').select('id').ilike('ordem_servico', item.ordem_servico).maybeSingle()
    if (error && ehFalhaDeRede(error)) throw new SemSinal(error.message)
    if (data) relatorio_id = data.id
  }
  const { error } = await sb.from('despesas').insert({ ...item.despesa, id: item.id, foto_url, relatorio_id })
  // 23505 = esse id já está no banco: um envio anterior chegou, só a resposta não voltou.
  if (error && error.code !== '23505') {
    if (ehFalhaDeRede(error)) throw new SemSinal(error.message)
    throw error
  }
  return { foto_url, relatorio_id }
}

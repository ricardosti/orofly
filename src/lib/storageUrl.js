// URLs assinadas do Storage, com cache.
//
// ── Por que isto existe ──
//
// Cada componente que mostrava uma foto chamava `createSignedUrl` no próprio useEffect, e o
// Supabase devolve um TOKEN NOVO a cada chamada. Token diferente = URL diferente = o navegador
// trata como outro arquivo e baixa tudo de novo. Rolar uma lista, reabrir um modal, voltar de
// uma aba, gerar o consolidado da fazenda duas vezes — tudo re-baixava as mesmas imagens.
//
// O tamanho do estrago, medido em 13/09/2026: 16,67 GB de banda num mês com 590 MB de arquivos
// guardados. Cada arquivo desceu ~28 vezes. Foi o que estourou a cota do plano grátis em
// 26/08/2026 e derrubou o app (ver seção 8 do CLAUDE.md).
//
// Guardando a URL por caminho, a segunda exibição da mesma foto sai do cache do navegador e
// custa zero de banda. A validade longa é parte da correção, não descuido: URL curta obriga a
// reassinar, e reassinar é justamente o que quebrava o cache.
//
// ── Cuidado ao trocar uma foto ──
//
// Os uploads usam `upsert: true` no mesmo caminho. Depois de substituir um arquivo, chame
// `esquecerUrl(path)` — senão a URL velha continua no cache e o navegador serve a imagem
// antiga. Assinar de novo gera outro token, que o navegador vê como recurso novo e baixa.

const VALIDADE_S = 60 * 60 * 8    // 8h — cobre um dia de trabalho sem reassinar
const MARGEM_MS = 10 * 60 * 1000  // renova 10min antes de vencer, pra nunca entregar URL morta

// chave `bucket|path` -> { promessa, expiraEm }. Guarda a PROMESSA, não a string: dois
// componentes com a mesma foto na tela ao mesmo tempo pedem uma assinatura só.
const cache = new Map()

export async function urlAssinada(supabase, path, bucket = 'relatorios') {
  if (!supabase || !path) return null
  const chave = bucket + '|' + path
  const guardada = cache.get(chave)
  if (guardada && guardada.expiraEm - MARGEM_MS > Date.now()) return guardada.promessa

  const promessa = supabase.storage.from(bucket).createSignedUrl(path, VALIDADE_S)
    .then(({ data, error }) => {
      // O cliente do Supabase não lança exceção: erro vem em `error` com `data` null.
      // Falhou, sai do cache — senão o null fica grudado por 8h e a foto nunca aparece.
      if (error || !data?.signedUrl) { cache.delete(chave); return null }
      return data.signedUrl
    })
    .catch(() => { cache.delete(chave); return null })

  cache.set(chave, { promessa, expiraEm: Date.now() + VALIDADE_S * 1000 })
  return promessa
}

// Depois de substituir ou apagar um arquivo nesse caminho.
export function esquecerUrl(path, bucket = 'relatorios') {
  if (path) cache.delete(bucket + '|' + path)
}

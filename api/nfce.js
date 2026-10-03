// Consulta a nota na SEFAZ pela chave de acesso e devolve o que a nota diz de verdade:
// valor, data da emissão e quem emitiu.
//
// Por que existe: o QR Code da NFC-e (versões 2 e 3) não traz o valor, e ler o valor pelo
// texto da foto (OCR) erra — cupom amassado, foto de longe, vinco em cima do 5 que vira 3.
// Mas a CHAVE a gente lê com certeza (o dígito verificador recusa leitura errada), e com
// ela a página pública de consulta da SEFAZ mostra a nota inteira, sem captcha. É o mesmo
// endereço que o celular de qualquer consumidor abre ao escanear o QR.
//
// Roda no servidor porque o navegador não deixa um site ler a página de outro (CORS).
// Não é um "busca qualquer endereço": só monta URL de consulta da SEFAZ a partir de uma
// chave válida, ou aceita o endereço do próprio QR quando ele é de um *.gov.br e traz a
// mesma chave.
const TIMEOUT_MS = 10000

// Endereço de consulta de cada estado, pra quando só temos a chave (QR ilegível, chave
// lida do texto impresso). Só entra estado conferido na prática: endereço errado aqui faria
// o app esperar à toa. Os demais estados ainda funcionam quando o QR foi lido, porque o
// endereço vem dentro dele.
const CONSULTA_POR_UF = {
  // SP aceita a chave sozinha no formato do QR versão 3 (chave|3|ambiente). Conferido em
  // 03/10/2026 com duas notas reais, inclusive uma cujo QR estava ilegível.
  35: (chave) => `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${chave}|3|1`,
}

function dvDaChave(chave43) {
  let soma = 0, peso = 2
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return (resto === 0 || resto === 1) ? 0 : 11 - resto
}
const chaveValida = (c) => /^\d{44}$/.test(c || '') && dvDaChave(c.slice(0, 43)) === Number(c[43])

// Endereço do QR, só se for de um portal do governo e trouxer a mesma chave. Sem essa
// trava a função viraria um proxy pra qualquer site.
function urlDoQrAceita(url, chave) {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol) || !/\.gov\.br$/i.test(u.hostname)) return null
    if (!decodeURIComponent(u.search).replace(/\D/g, '').includes(chave)) return null
    return u.toString()
  } catch { return null }
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function textoLimpo(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}
const numeroBr = (s) => parseFloat(String(s).replace(/\./g, '').replace(',', '.'))

// Tira da página o que interessa. O leiaute é o da consulta pública da NFC-e (o mesmo em
// SP e em vários estados); por via das dúvidas, procura também pelo texto dos rótulos, que
// muda menos que as classes do HTML.
function lerPagina(html) {
  const texto = textoLimpo(html)
  let valor = null
  const porClasse = /class="totalNumb txtMax"[^>]*>\s*([\d.]+,\d{2})/.exec(html)
  if (porClasse) valor = numeroBr(porClasse[1])
  for (const re of [/Valor a pagar\s*R\$:?\s*([\d.]+,\d{2})/i, /Valor total\s*R\$:?\s*([\d.]+,\d{2})/i]) {
    if (valor != null) break
    const m = re.exec(texto)
    if (m) valor = numeroBr(m[1])
  }
  const d = /Emiss[aã]o:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(texto)
  const emit = /class="txtTopo"[^>]*>\s*([^<]+)/.exec(html)
  return {
    valor: Number.isFinite(valor) && valor > 0 ? valor : null,
    data: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
    emitente: emit ? textoLimpo(emit[1]) : null,
    // Nota cancelada continua aparecendo na consulta, mas não vale como comprovante.
    cancelada: /id="hdfNotaCancelada"/i.test(html),
    // No HTML cru, e não no texto limpo: a SEFAZ-SP escreve esse aviso por dentro de um
    // <script>, que a limpeza joga fora.
    inexistente: /Inexistente na Base de Dados/i.test(html),
  }
}

async function buscar(url) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      // Alguns portais recusam quem não se apresenta como navegador.
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36' },
    })
    const bytes = await r.arrayBuffer()
    // SP responde em UTF-8, mas há portal estadual em ISO-8859-1 — sem isso o nome do
    // emitente chegaria com acento quebrado.
    const charset = /charset=([\w-]+)/i.exec(r.headers.get('content-type') || '')?.[1] || 'utf-8'
    let html
    try { html = new TextDecoder(charset).decode(bytes) } catch { html = new TextDecoder('utf-8').decode(bytes) }
    return { status: r.status, html }
  } finally {
    clearTimeout(t)
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const chave = String(req.query.chave || '').replace(/\D/g, '')
  if (!chaveValida(chave)) return res.status(400).json({ error: 'chave de acesso inválida' })

  // Prefere o endereço do QR (vale pra qualquer estado); sem ele, monta pelo estado.
  const url = (req.query.url && urlDoQrAceita(String(req.query.url), chave))
    || CONSULTA_POR_UF[Number(chave.slice(0, 2))]?.(chave)
  if (!url) return res.status(422).json({ error: 'estado ainda não suportado sem o QR Code' })

  try {
    const { status, html } = await buscar(url)
    if (status !== 200) return res.status(502).json({ error: `SEFAZ respondeu HTTP ${status}` })
    const nota = lerPagina(html)
    if (nota.inexistente) return res.status(404).json({ error: 'a SEFAZ não encontrou essa nota' })
    if (nota.valor == null) return res.status(502).json({ error: 'a página da SEFAZ veio num formato que não reconheci' })
    // Nota emitida não muda: pode guardar a resposta por um dia no cache da Vercel e não
    // incomodar a SEFAZ de novo se o piloto refizer a foto.
    res.setHeader('Cache-Control', 's-maxage=86400')
    return res.status(200).json({ chave, valor: nota.valor, data: nota.data, emitente: nota.emitente, cancelada: nota.cancelada })
  } catch (e) {
    return res.status(502).json({ error: e.name === 'AbortError' ? `SEFAZ não respondeu em ${TIMEOUT_MS / 1000}s` : String(e.message || e) })
  }
}

// Exposto pros testes; a Vercel só usa o handler.
module.exports.lerPagina = lerPagina

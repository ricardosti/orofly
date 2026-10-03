// Leitura do QR Code / chave de acesso de nota fiscal brasileira (NFC-e e NFe), pra
// pré-preencher o Cadastro de Notas em vez de o piloto digitar tudo na mão.
//
// Por que QR antes de IA: a chave de acesso é EXATA, não adivinhada. Ela já carrega, nas
// próprias posições, o CNPJ de quem emitiu e o ano/mês da emissão — sem chamar API, sem
// chave de serviço, sem internet e sem custo. Modelo de visão fica pro que não tem QR.
//
// O que o QR atual NÃO dá: o valor. Na versão 2 do QR Code da NFC-e o parâmetro só traz
// chave, versão, ambiente e hash (na versão 3, nem o hash) — o `vNF` existia só na versão
// 1, que ainda aparece em emissor antigo. O valor vem, em ordem de confiança:
//   1. da SEFAZ, consultada pela chave (consultarSefaz → /api/nfce) — o valor oficial;
//   2. do texto impresso na foto (OCR), quando a SEFAZ não está ao alcance.
import jsQR from 'jsqr'
import { apiUrl } from './apiBase'

// ── Chave de acesso (44 dígitos) ──────────────────────────────────────────────
// Layout oficial: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
const UF_POR_CODIGO = {
  11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',
  24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',
  41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF',
}

// Dígito verificador da chave: módulo 11 com pesos 2..9 ciclando da direita pra esquerda.
// É o que separa uma leitura boa de um OCR que trocou 8 por 3 — sem essa conferência o
// app preencheria o CNPJ errado com cara de certeza.
export function dvDaChave(chave43) {
  let soma = 0, peso = 2
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return (resto === 0 || resto === 1) ? 0 : 11 - resto
}

export function chaveValida(chave) {
  if (!/^\d{44}$/.test(chave || '')) return false
  if (dvDaChave(chave.slice(0, 43)) !== Number(chave[43])) return false
  // Além do dígito verificador, a chave tem estrutura: estado que existe, mês de 1 a 12,
  // ano possível e modelo de documento fiscal (55 NFe, 59 SAT, 65 NFC-e). O dígito sozinho
  // passa por acaso em 1 de cada 11 sequências — num teste com cupom real o OCR juntou
  // linhas inteiras de números e CINCO sequências de lixo passaram nele. Nenhuma passaria
  // nesta conferência.
  const uf = Number(chave.slice(0, 2)), ano = 2000 + Number(chave.slice(2, 4)), mes = Number(chave.slice(4, 6))
  if (!UF_POR_CODIGO[uf] || mes < 1 || mes > 12 || ano < 2006 || ano > new Date().getFullYear()) return false
  return ['55', '59', '65'].includes(chave.slice(20, 22))
}

// Quebra a chave nos dados que ela carrega. Não inventa nada: só lê posição.
export function dadosDaChave(chave) {
  if (!chaveValida(chave)) return null
  const cnpj = chave.slice(6, 20)
  const ano = 2000 + Number(chave.slice(2, 4))
  const mes = Number(chave.slice(4, 6))
  const modelo = chave.slice(20, 22)
  return {
    chave,
    uf: UF_POR_CODIGO[Number(chave.slice(0, 2))] || null,
    cnpj,
    cnpjFormatado: cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
    ano, mes,
    // Só o mês da emissão está na chave, não o dia. Vira o 1º dia do mês como PISTA, e a
    // tela avisa — chutar um dia exato seria inventar dado que a nota não deu.
    mesEmissao: `${ano}-${String(mes).padStart(2, '0')}`,
    modelo,                       // 55 = NFe (DANFE), 65 = NFC-e (cupom)
    numero: Number(chave.slice(25, 34)),
  }
}

// ── Conteúdo do QR ────────────────────────────────────────────────────────────
// Formatos que aparecem na prática, e por isso a busca é tolerante:
//   v2 (atual):  ...?p=CHAVE|versao|tpAmb|cIdToken|cHash
//   v1 (antigo): ...?p=CHAVE|versao|tpAmb|cDest|dhEmi|vNF|vICMS|digVal|cIdToken|cHash
//   alguns estados montam a URL de um jeito próprio, e o DANFE às vezes traz só a chave.
// Por isso o caminho principal é "procura 44 dígitos e confere o DV", e os campos extras
// do `p=` são bônus quando existirem.
export function parseConteudoQr(texto) {
  const bruto = String(texto || '')
  const avisos = []

  // Qualquer sequência de 44 dígitos no conteúdo, com ou sem separador.
  const candidatos = (bruto.replace(/[\s.-]/g, '').match(/\d{44}/g) || [])
  const chave = candidatos.find(chaveValida)
  if (!chave) {
    return { ok: false, motivo: candidatos.length
      ? 'achei uma sequência de 44 dígitos, mas o dígito verificador não bate — leitura provavelmente errada'
      : 'não é um QR de nota fiscal (não tem chave de acesso)', avisos, textoBruto: bruto }
  }

  const dados = dadosDaChave(chave)
  let valor = null, dataEmissao = null

  // Campos do `p=` — só a versão 1 traz data e valor.
  const p = /[?&]p=([^&\s]+)/.exec(bruto)?.[1]
  if (p) {
    const campos = decodeURIComponent(p).split('|')
    const versao = campos[1]
    if (versao === '1' && campos.length >= 7) {
      const dh = campos[4], vNF = parseFloat(campos[5])
      if (dh && /^\d{4}-\d{2}-\d{2}/.test(dh)) dataEmissao = dh.slice(0, 10)
      if (Number.isFinite(vNF) && vNF > 0) valor = vNF
    } else {
      avisos.push('QR versão 2: traz a chave, mas não o valor nem o dia da emissão')
    }
  } else {
    avisos.push('QR sem os parâmetros da SEFAZ — aproveitei só a chave')
  }

  return { ok: true, origem: 'qrcode', chave, ...dados, valor, dataEmissao, avisos, textoBruto: bruto }
}

// ── Leitura da imagem ─────────────────────────────────────────────────────────
// Dois caminhos: o BarcodeDetector nativo (rápido, é o do próprio Android) e o jsQR como
// reserva. A reserva não é luxo — o detector nativo não existe em todo navegador de
// desktop, e é no desktop que a conferência das notas acontece.
async function lerComDetectorNativo(bitmap) {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null
  try {
    const formatos = await window.BarcodeDetector.getSupportedFormats?.() || []
    if (formatos.length && !formatos.includes('qr_code')) return null
    const det = new window.BarcodeDetector({ formats: ['qr_code'] })
    const achados = await det.detect(bitmap)
    return achados?.[0]?.rawValue || null
  } catch { return null }
}

function lerComJsQr(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  // `attemptBoth` cobre o cupom fotografado contra a luz, que sai com as cores trocadas.
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null
}

// Desenha a imagem num canvas de no máximo `maxLado`. Foto de celular vem com 3000+ px e
// o jsQR varre pixel a pixel: sem reduzir, trava a tela por segundos no aparelho do piloto.
async function paraCanvas(origem, maxLado = 1400, minLado = 0, suave = false) {
  const bitmap = origem instanceof Blob ? await createImageBitmap(origem) : origem
  const maior = Math.max(bitmap.width, bitmap.height)
  let escala = Math.min(1, maxLado / maior) || 1
  // Piso de resolução, usado pelo OCR. Ampliar não inventa detalhe nenhum, mas dá ao
  // Tesseract mais pixel por caractere — e só isso já corrigiu leitura errada nos testes:
  // com texto de 20 px ele devolvia "60,80" no lugar de "60,00". Teto de 3x porque acima
  // disso é só borrão caro de processar.
  if (minLado && maior * escala < minLado) escala = Math.min(4, minLado / maior)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  // willReadFrequently: este canvas é lido várias vezes (uma por tentativa do leitor de
  // QR). Sem a dica, o navegador o mantém na GPU e cada leitura obriga uma cópia de
  // volta — ele mesmo avisa no console. Com a dica, o canvas já nasce na memória.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  // Pro OCR, reamostragem de qualidade: ampliar 2,5x com a interpolação simples deixa a
  // borda das letras em degrau. O leitor de QR fica como estava, porque já funciona.
  if (suave) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high' }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { canvas, bitmap }
}

// Aplaina a iluminação: divide cada pixel pelo branco do papel em volta dele.
//
// Foi o que fez o OCR funcionar em foto de cupom de verdade. O Tesseract separa tinta de
// papel por um limiar único, e numa foto de celular o papel nunca é branco por igual:
// sombra da mão, dobra do cupom amassado, fundo escuro (calça, banco do carro) puxando o
// limiar. A tinta fina da impressora térmica some junto com a sombra. Medido numa nota do
// McDonald's: sem isto o OCR não leu nenhum número; com isto leu valor, data e a chave de
// acesso inteira, nas 4 configurações testadas. O limiar adaptativo do próprio Tesseract
// (Sauvola) não leu nada na mesma foto.
//
// O "branco do papel" é o máximo local da vizinhança (passa por cima das letras), depois
// suavizado, calculado num mapa 8x menor: no tamanho cheio seriam dezenas de MB a mais no
// celular do piloto, pra um fundo que varia devagar de qualquer jeito.
function aplainarIluminacao(canvas) {
  const W = canvas.width, H = canvas.height
  const sw = Math.max(8, Math.round(W / 8)), sh = Math.max(8, Math.round(H / 8)), n = sw * sh
  const peq = document.createElement('canvas')
  peq.width = sw; peq.height = sh
  const pctx = peq.getContext('2d', { willReadFrequently: true })
  pctx.imageSmoothingEnabled = true; pctx.imageSmoothingQuality = 'high'
  pctx.drawImage(canvas, 0, 0, sw, sh)
  const pd = pctx.getImageData(0, 0, sw, sh).data
  const cinza = new Float32Array(n)
  for (let i = 0, p = 0; p < n; i += 4, p++) cinza[p] = 0.299 * pd[i] + 0.587 * pd[i + 1] + 0.114 * pd[i + 2]
  // Máximo e depois média, cada um em duas passadas (linha, coluna), raio 3 no mapa.
  const R = 3
  const passar = (src, horizontal, maximo) => {
    const out = new Float32Array(n)
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let acc = 0, cnt = 0
      for (let k = -R; k <= R; k++) {
        const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k
        if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue
        const v = src[yy * sw + xx]
        if (maximo) { if (v > acc) acc = v } else { acc += v; cnt++ }
      }
      out[y * sw + x] = maximo ? acc : acc / cnt
    }
    return out
  }
  const fundo = passar(passar(passar(passar(cinza, true, true), false, true), true, false), false, false)

  // Divisão no tamanho cheio, com o fundo interpolado (bilinear): sem isso apareceriam
  // degraus de 8 px na imagem, e o OCR lê degrau como traço.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, W, H), d = img.data
  const LO = 0.55, K = 255 / (1 - LO)   // abaixo de 55% do branco do papel vira tinta preta
  const x0 = new Int32Array(W), x1 = new Int32Array(W), tx = new Float32Array(W)
  for (let x = 0; x < W; x++) {
    const f = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / W - 0.5))
    x0[x] = f | 0; x1[x] = Math.min(sw - 1, x0[x] + 1); tx[x] = f - x0[x]
  }
  for (let y = 0; y < H; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / H - 0.5)), y0 = fy | 0, ty = fy - y0
    const l0 = y0 * sw, l1 = Math.min(sh - 1, y0 + 1) * sw
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      const t = tx[x]
      const b = (fundo[l0 + x0[x]] * (1 - t) + fundo[l0 + x1[x]] * t) * (1 - ty)
              + (fundo[l1 + x0[x]] * (1 - t) + fundo[l1 + x1[x]] * t) * ty
      let v = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / (b > 1 ? b : 1) - LO) * K
      v = v < 0 ? 0 : v > 255 ? 255 : v
      d[i] = d[i + 1] = d[i + 2] = v
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

function copiarCanvas(canvas) {
  const c = document.createElement('canvas')
  c.width = canvas.width; c.height = canvas.height
  c.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0)
  return c
}

// Lê o QR de uma foto de nota. Devolve sempre um objeto — nunca lança, porque isso roda
// durante o lançamento da despesa e falha de leitura não pode travar o piloto.
// Recorta uma faixa do canvas (fração 0–1) num canvas novo. Serve pra dar ao leitor um
// pedaço com o QR grande, em vez da folha inteira onde ele é um detalhe.
function recorte(canvas, x0, y0, x1, y1) {
  const w = Math.round((x1 - x0) * canvas.width), h = Math.round((y1 - y0) * canvas.height)
  if (w < 40 || h < 40) return null
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d', { willReadFrequently: true })
    .drawImage(canvas, Math.round(x0 * canvas.width), Math.round(y0 * canvas.height), w, h, 0, 0, w, h)
  return c
}

export async function lerNotaFiscal(arquivo) {
  try {
    const { canvas, bitmap } = await paraCanvas(arquivo, 1600)
    // 1) Detector nativo na imagem original, que é o caminho mais rápido quando existe.
    let texto = await lerComDetectorNativo(bitmap)
    if (texto) return parseConteudoQr(texto)

    // 2) jsQR em várias tentativas. Nota de campo chega amassada, com dobra atravessando
    // o código e fotografada de longe — numa única passada o leitor desiste fácil.
    // A ordem vai do mais barato ao mais caro, e para na primeira que ler.
    const grande = (await paraCanvas(arquivo, 2600)).canvas
    const tentativas = [
      ['imagem toda', canvas],
      ['imagem ampliada', grande],
      // O QR da NFC-e fica no rodapé do cupom; recortar a metade de baixo faz ele
      // ocupar o dobro da área e muda bastante a chance de leitura.
      ['metade de baixo', recorte(grande, 0, 0.45, 1, 1)],
      ['metade de cima', recorte(grande, 0, 0, 1, 0.55)],
      ['miolo', recorte(grande, 0.1, 0.25, 0.9, 0.85)],
    ]
    for (const [, alvo] of tentativas) {
      if (!alvo) continue
      texto = lerComJsQr(alvo)
      if (texto) return parseConteudoQr(texto)
    }

    // 3) Última cartada: preto e branco. Cupom térmico desbotado e foto contra a luz
    // ficam com contraste fraco, e binarizar às vezes resolve o que o resto não leu.
    try {
      const { binarizar } = await import('./ocrCoordenadas')
      for (const alvo of [recorte(grande, 0, 0.45, 1, 1), grande]) {
        if (!alvo) continue
        const bn = recorte(alvo, 0, 0, 1, 1)   // cópia, pra não estragar o original
        if (!bn) continue
        binarizar(bn)
        texto = lerComJsQr(bn)
        if (texto) return parseConteudoQr(texto)
      }
    } catch { /* binarização indisponível: segue sem ela */ }

    return { ok: false, motivo: 'não achei QR Code nessa foto' }
  } catch (e) {
    return { ok: false, motivo: `não consegui ler a imagem (${e?.message || e})` }
  }
}

// Palpite de categoria pelo ramo do estabelecimento. Fica restrito às 5 categorias que
// existem no app — devolver "Combustível" não encaixaria no select e viraria erro só em
// produção. Sem palpite devolve null, e o piloto escolhe.
const PISTAS_CATEGORIA = [
  [/posto|combust|petrobr|ipiranga|shell|ale\b|texaco|auto\s?posto/i, 'Gasolina'],
  [/pedagio|pedágio|autoban|ecovias|arteris|ccr\b|triunfo|rodovia/i, 'Pedágio'],
  [/hotel|pousada|motel|hospedagem|flat\b/i, 'Hotel'],
  [/restaurante|lanchon|padaria|churrasc|pizzar|bar\b|refei|self\s?service|marmit/i, 'Almoço'],
]
export function palpiteCategoria(nomeEstabelecimento) {
  const n = String(nomeEstabelecimento || '')
  for (const [re, cat] of PISTAS_CATEGORIA) if (re.test(n)) return cat
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// DEGRAU 2 — OCR do texto impresso, pras notas que não têm QR (DANFE, pedágio,
// nota de serviço) e pro VALOR, que o QR versão 2 não traz em nota nenhuma.
//
// Usa o Tesseract que já está no projeto (o mesmo que lê coordenada de mapa), em
// 'eng' e não 'por': o modelo de inglês já foi baixado por aquele uso, e o que
// interessa aqui — dígitos e a palavra TOTAL — é igual nos dois idiomas. Trocar
// custaria mais uns megabytes de download pro piloto sem ganho nenhum.

// Rótulos que antecedem o valor da nota, do mais específico pro mais genérico.
// Quanto mais específico, mais confiança — "VALOR A PAGAR" é inequívoco, "TOTAL"
// sozinho pode ser muita coisa.
//
// Escritos com as trocas típicas do OCR em cupom térmico: T e 1 e I, O e 0 e Q, A e 4,
// L e 1 e I. Num cupom real o "TOTAL R$ 35.90" saiu "10TAl 4) 35.90" e a linha era
// ignorada inteira.
const T_ = '[T1I]', O_ = '[O0Q]', A_ = '[A4]', L_ = '[L1I|]'
const TOTAL_ = `${T_}${O_}${T_}${A_}${L_}`
const ROTULOS_VALOR = [
  [new RegExp(`V${A_}${L_}${O_}R\\s*${A_}\\s*P${A_}G${A_}R`), 10],
  [new RegExp(`${TOTAL_}\\s*${A_}\\s*P${A_}G${A_}R`),         10],
  [new RegExp(`V${A_}${L_}${O_}R\\s*${TOTAL_}`),               8],
  [new RegExp(`${TOTAL_}\\s*(R\\s*[$S5]|:)`),                  7],
  [new RegExp(`(^|[^A-Z])${TOTAL_}(?![A-Z])`),                 5],
]
// Linhas que TÊM a palavra total/valor mas não são o valor da nota. Sem isso, o
// "VALOR APROX DOS TRIBUTOS" que vem no rodapé de todo cupom seria lido como o
// total — é a armadilha mais comum. "TRIB" e "APROX" cobrem a forma abreviada
// ("Trib aprox: R$7,28(13,48%)"), que num cupom real fez o app lançar 18,00 — a
// alíquota do imposto — como valor da despesa.
const NAO_E_O_TOTAL = /TRIB|IMPOST|ITENS|\bQTDE?\b|QUANTIDADE|TROCO|DESCONTO|ACRESCIMO|DINHEIRO|RECEBIDO|\bLEI\b|IBPT|APROX/
// SUBTOTAL não é o total (falta desconto e acréscimo), mas quando o OCR só consegue ler
// essa linha é melhor preencher com ele e pedir conferência do que deixar o campo vazio —
// na prática, sem desconto os dois são iguais. Entra com peso baixo e sempre avisando.
// Sem o S de propósito: o OCR come a primeira letra ("UBTOTAL R$", medido).
const EH_SUBTOTAL = new RegExp(`UB\\s*${TOTAL_}`)
// Linha do pagamento com cartão ou PIX: o valor pago é exatamente o total. Dinheiro fica
// de fora (o cliente paga 50 numa conta de 35,90), e por isso continua no NAO_E_O_TOTAL.
// "VALOR PAGO" também fica de fora, pelo mesmo motivo: em dinheiro ele é o que o cliente
// entregou, não o total.
const EH_PAGAMENTO = /CART.O|CREDIT[O0]|DEBIT[O0]|\bPIX\b|\bTEF\b/
// Linha de item ("1 UN X 19,00"): não serve de rótulo, e fica fora do "maior valor".
const EH_ITEM = /\bUN\b\s*X|\bX\s*\d+[.,]\d{2}/

const semAcento = t => String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')

// Converte o que está no papel em número. O formato brasileiro é "1.234,56" — ponto de
// milhar, vírgula decimal — mas o OCR raramente devolve isso limpo: ele troca a vírgula
// por ponto, por espaço, ou come o separador. Um cupom real chegou com "TOTAL" legível e
// o valor ao lado recusado por isso.
//
// O que NÃO se aceita: número sem nenhum separador decimal. "3590" tanto pode ser 35,90
// quanto 3.590,00, e errar por cem no lançamento é pior do que deixar em branco.
function numeroBr(txt) {
  const limpo = String(txt||'').replace(/\s+/g,' ').trim()
  let m
  // 1.234,56 — milhar com ponto, decimal com vírgula (o jeito certo)
  if ((m = /^\d{1,3}(?:\.\d{3})+,\d{2}$/.exec(limpo))) return parseFloat(limpo.replace(/\./g,'').replace(',','.'))
  // 1,234.56 — milhar com vírgula, decimal com ponto (o OCR às vezes inverte)
  if ((m = /^\d{1,3}(?:,\d{3})+\.\d{2}$/.exec(limpo))) return parseFloat(limpo.replace(/,/g,''))
  // 35,90 · 35.90 — dois dígitos depois de vírgula ou ponto.
  // ESPAÇO não entra como separador: com ele, a hora de emissão "01/10/2026 08:22:23"
  // virava o valor 2026,08 — medido num cupom real. O ganho de aceitar "35 90" não paga
  // o risco de lançar a data como dinheiro.
  if ((m = /^(\d+)[.,](\d{2})$/.exec(limpo))) return parseFloat(`${m[1]}.${m[2]}`)
  return null
}

// Teto de sanidade. O OCR confunde vírgula com ponto e transforma 128,90 em 12890;
// acima disso é quase certo erro de leitura, e preencher errado é pior que não
// preencher. O piloto digita, como já fazia.
const TETO_DESPESA = 50000

// Números com centavos de uma linha. Fora: percentual ("18,00%", a alíquota do imposto),
// número colado a outro dígito (pedaço de chave ou de protocolo) e inteiro com zero à
// esquerda ("0169.65" — pedaço da chave de acesso, nunca dinheiro).
const RE_VALOR = /(?<![\d.,])(?:[1-9]\d{0,2}(?:[.,]\d{3})+|[1-9]\d*|0)[.,]\d{2}(?!\d)(?!\s*%)/g
const numerosDaLinha = (l) => (String(l).match(RE_VALOR) || [])
  .map(numeroBr).filter(v => v !== null && v > 0 && v <= TETO_DESPESA)

// ── Valor total: votação entre as linhas do cupom.
//
// O total aparece mais de uma vez na mesma nota: na linha do TOTAL, no SUBTOTAL (quando
// não há desconto) e na linha do pagamento com cartão. O OCR erra cada linha por conta
// própria, então duas linhas que concordam valem mais que um rótulo lido uma vez só. Foi
// o que decidiu um cupom real: "TOTAL R$ 39.90" (o 5 lido como 9) contra "SUBTOTAL 35.90"
// e "TEF Credito 35.90". A votação fica com 35,90; a regra antiga pegava 39,90.
//
// Cada voto: { valor, peso, fonte }. Peso 0 é número solto, sem rótulo na linha.
export function votosDeValor(texto) {
  const maiusculo = semAcento(texto).toUpperCase()
  const linhas = maiusculo.split(/\r?\n/)
  const info = linhas.map(l => {
    if (NAO_E_O_TOTAL.test(l)) return null
    let rot = null
    if (EH_SUBTOTAL.test(l)) rot = { peso: 3, fonte: 'subtotal' }
    else {
      const r = ROTULOS_VALOR.find(([re]) => re.test(l))
      if (r) rot = { peso: r[1], fonte: 'total' }
      else if (EH_PAGAMENTO.test(l)) rot = { peso: 4, fonte: 'pagamento' }
    }
    return { rot, nums: numerosDaLinha(l), item: EH_ITEM.test(l) }
  })
  const votos = [], usada = new Set()
  info.forEach((x, i) => {
    if (!x?.rot) return
    if (x.nums.length) {
      votos.push({ valor: Math.max(...x.nums), peso: x.rot.peso, fonte: x.rot.fonte })
      usada.add(i)
      return
    }
    // Rótulo sem número: cupom estreito quebra a linha, e com o papel torto o número
    // aparece duas ou três linhas abaixo, depois dos outros rótulos. Pega a próxima linha
    // de número SEM rótulo próprio e ainda não usada — assim "VALOR TOTAL" fica com o
    // primeiro número da coluna e "Cartão" com o segundo.
    // Pagamento não procura abaixo: "crédito de ICMS" no cabeçalho pegaria o preço de um
    // item.
    if (x.rot.fonte === 'pagamento') return
    for (let k = i + 1, vistas = 0; k < info.length && vistas < 3; k++) {
      if (!linhas[k].trim()) continue
      vistas++
      const y = info[k]
      if (!y || y.rot || usada.has(k) || !y.nums.length) continue
      votos.push({ valor: Math.max(...y.nums), peso: x.rot.peso - 1, fonte: x.rot.fonte })
      usada.add(k)
      break
    }
  })
  info.forEach((x, i) => {
    if (!x || x.rot || usada.has(i)) return
    new Set(x.nums).forEach(v => votos.push({ valor: v, peso: 0, fonte: 'solto', item: x.item }))
  })
  // Só deduz valor de foto que pareça nota — sem isso, qualquer número numa foto qualquer
  // viraria despesa.
  return { votos, temTotal: /T[O0]TAL|VALOR/.test(maiusculo) }
}

// Junta os votos por valor e escolhe. Pontos = o rótulo mais forte + um bônus por linha
// que concorda (rótulo concordando vale mais que número solto: um item que custa o mesmo
// que o total não prova nada). Recebe votos de várias leituras da mesma foto, e aí a
// concordância entre leituras conta igual.
export function decidirValor(votos, temTotal) {
  const grupos = new Map()
  for (const v of votos) {
    const k = v.valor.toFixed(2)
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(v)
  }
  let melhor = null
  for (const vs of grupos.values()) {
    vs.sort((a, b) => b.peso - a.peso)
    if (!vs[0].peso) continue
    const bonus = vs.slice(1).reduce((s, v) => s + (v.peso ? 4 : 1), 0)
    const pontos = vs[0].peso + Math.min(bonus, 8)
    if (!melhor || pontos > melhor.pontos || (pontos === melhor.pontos && vs[0].valor > melhor.valor)) {
      melhor = { valor: vs[0].valor, pontos, fonte: vs[0].fonte }
    }
  }
  if (melhor) return melhor
  // Último recurso: o MAIOR valor solto do papel. O cupom fotografado às vezes sai com
  // todos os rótulos numa coluna e todos os números noutra, sem como parear — foi o caso
  // real de um cupom de lanchonete. Numa nota o total é sempre >= cada item, e as linhas
  // de troco, dinheiro e tributo já ficaram de fora.
  if (!temTotal) return null
  const soltos = votos.filter(v => !v.peso && !v.item).map(v => v.valor)
  if (!soltos.length) return null
  const maior = Math.max(...soltos)
  // Mas só vale se o maior aparecer mais de uma vez (em duas linhas, ou em duas leituras).
  // Num cupom amassado, com o vinco em cima do 5, cada leitura deu um número diferente pro
  // mesmo total — 93,99 · 33,99 · 53,09, quando era 53,99. Escolher um seria cara ou
  // coroa, e valor errado com cara de certo é pior que campo vazio: não preenche, e avisa.
  if (soltos.filter(v => v === maior).length >= 2) return { valor: maior, pontos: 0, fonte: 'maior' }
  return { valor: null, pontos: 0, fonte: 'ambiguo', candidatos: [...new Set(soltos)].sort((a, b) => b - a).slice(0, 3) }
}

// Aviso que acompanha o valor quando ele não veio de um rótulo de total. A tela mostra
// esses em destaque (procura por SUBTOTAL / "deduzido").
function avisoDoValor(escolha) {
  if (escolha?.fonte === 'subtotal') return 'só o SUBTOTAL foi legível — se a nota tiver desconto, o total é outro'
  if (escolha?.fonte === 'pagamento') return 'o valor foi deduzido da linha do pagamento — confira com atenção'
  if (escolha?.fonte === 'maior') return 'o valor foi deduzido como o maior do cupom — confira com atenção'
  if (escolha?.fonte === 'ambiguo') {
    const lista = escolha.candidatos.map(v => v.toFixed(2).replace('.', ',')).join(' · ')
    return `não consegui ler o valor com segurança (cada leitura deu um número: ${lista}) — digite o valor da nota`
  }
  return null
}

// Função PURA: recebe o texto que o OCR devolveu e tira dele o que der. Separada
// do Tesseract de propósito — é aqui que mora a chance de errar, e assim dá pra
// testar com cupom de verdade sem depender de imagem nem de navegador.
export function extrairDaNota(texto) {
  const linhas = semAcento(texto).toUpperCase().split(/\r?\n/)
  const achados = { chave: null, valor: null, data: null, avisos: [] }

  // ── Chave de acesso impressa (a nota traz os 44 dígitos em grupos de 4).
  //
  // Antes isto juntava TODOS os dígitos do papel e deslizava uma janela de 44. Não
  // funciona: o dígito verificador passa por acaso em 1 de cada 11 tentativas, e com
  // dezenas de janelas achar lixo "válido" é quase certo. Num cupom real o app leu
  // `0001010000495140055399…` — pedaços do código do produto, do valor e da hora
  // colados — e exibiu um CNPJ que não existia na nota, com cara de certeza.
  //
  // Agora só considera bloco que apareça JUNTO no papel, e dá preferência ao que vem
  // logo depois do rótulo "Chave de Acesso". Os separadores aceitos são espaço, hífen
  // e ponto (como a chave é impressa); barra e dois-pontos NÃO entram, e é isso que
  // impede a data e a hora de se fundirem ao número ao lado.
  const blocosDe44 = (t) => {
    const out = []
    for (const m of String(t).matchAll(/(?<!\d)(?:\d[\s.-]*){44}(?!\d)/g)) out.push(m[0].replace(/\D/g, ''))
    return out
  }
  const semAc = semAcento(texto)
  const linhasAc = semAc.split(/\r?\n/)
  const candidatos = []
  linhasAc.forEach((l, i) => {
    if (/CHAVE\s*DE\s*ACESSO/i.test(l)) candidatos.push(...blocosDe44(linhasAc.slice(i, i + 3).join(' ')))
  })
  candidatos.push(...blocosDe44(semAc))
  achados.chave = candidatos.find(chaveValida) || null
  if (!achados.chave && candidatos.length) {
    achados.avisos.push('achei uma sequência de 44 dígitos, mas o dígito verificador não bate — o OCR trocou algum número')
  }

  // ── Valor total: votação entre as linhas (ver votosDeValor).
  const { votos, temTotal } = votosDeValor(texto)
  const escolha = decidirValor(votos, temTotal)
  if (escolha) {
    achados.valor = escolha.valor
    const aviso = avisoDoValor(escolha)
    if (aviso) achados.avisos.push(aviso)
  } else if (temTotal) {
    achados.avisos.push('achei a palavra TOTAL mas não um valor legível')
    // Deixa no console o que o OCR enxergou perto do TOTAL. Sem isso, "não leu" vira
    // adivinhação — e o formato que o OCR inventa muda de cupom pra cupom.
    try {
      const perto = linhas.filter(l => /TOTAL|VALOR|PAGO/.test(l)).slice(0, 6)
      console.warn('[nota] TOTAL encontrado mas sem valor legível. Linhas lidas:', perto)
    } catch { /* console indisponível */ }
  }

  // ── Data da emissão: prefere a que estiver ao lado de um rótulo de emissão;
  // não achando, a primeira data plausível do papel.
  const hoje = new Date()
  const dataValida = (d, m, a) => {
    if (a < 100) a += 2000
    if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2015) return null
    const dt = new Date(a, m - 1, d)
    if (dt > hoje) return null                       // nota do futuro é leitura errada
    if (dt.getDate() !== d || dt.getMonth() !== m - 1) return null
    return `${a}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  // Em cupom térmico o OCR troca dígito com frequência — num teste real, "28/09/2026"
  // saiu "28/89/2026" (0 lido como 8) e a data era descartada. Quando a leitura não
  // forma data válida, tenta as confusões típicas de dígito. Só aceita se UMA única
  // variante der certo: havendo duas, não dá pra saber qual era, e chutar a data de uma
  // despesa é pior do que deixar em branco.
  const CONFUSOES = { '0':'8', '8':'0', '1':'7', '7':'1', '6':'5', '5':'6', '9':'0' }
  const corrigirData = (dd, mm, aa) => {
    const variantes = new Set()
    for (const [i, parte] of [[0, dd], [1, mm]]) {
      for (let k = 0; k < parte.length; k++) {
        const troca = CONFUSOES[parte[k]]
        if (!troca) continue
        const novo = parte.slice(0, k) + troca + parte.slice(k + 1)
        const iso = i === 0 ? dataValida(+novo, +mm, +aa) : dataValida(+dd, +novo, +aa)
        if (iso) variantes.add(iso)
      }
    }
    return variantes.size === 1 ? [...variantes][0] : null
  }
  const comRotulo = [], soltas = []
  for (const linha of linhas) {
    for (const m of linha.matchAll(/(\d{2})\/(\d{2})\/(\d{2,4})/g)) {
      const iso = dataValida(+m[1], +m[2], +m[3]) || corrigirData(m[1], m[2], m[3])
      if (!iso) continue
      ;(/EMISS|DATA|DT\b/.test(linha) ? comRotulo : soltas).push(iso)
    }
  }
  achados.data = comRotulo[0] || soltas[0] || null
  return achados
}

// Roda o Tesseract na foto e passa o texto pro extrator, em até três leituras diferentes
// da mesma foto. Os votos das leituras se somam (ver decidirValor): o mesmo número lido
// por dois caminhos diferentes é muito mais confiável que uma leitura só.
//
// Por que estas três, medido em dois cupons reais (um limpo, um amassado):
//   1. aplainada, layout automático (psm 3) — a mais rápida, e no cupom limpo já basta;
//   2. aplainada, bloco único (psm 6) — lê melhor coluna de números desalinhada;
//   3. a foto como veio (psm 6) — rede de segurança pra foto em que aplainar atrapalhe.
// Saíram a passada binarizada (o aplainamento faz o mesmo serviço, melhor) e a de "só
// dígitos": sem as letras ela não sabe qual número é o total, e num cupom real lançou a
// alíquota do imposto (18,00%) como valor.
export async function lerNotaPorOcr(arquivo, aoProgredir) {
  let worker = null
  try {
    // Lado maior em 3200 px, pra cima ou pra baixo. Foto do WhatsApp chega com 1280 e é
    // ampliada (2,5x); foto da câmera chega com 4000 e é reduzida — mais que isso só deixa
    // o OCR lento no celular, sem ganho de leitura.
    const { canvas } = await paraCanvas(arquivo, 3200, 3200, true)
    const plano = aplainarIluminacao(copiarCanvas(canvas))
    const { createWorker } = await import('tesseract.js')
    worker = await createWorker('eng', 1, aoProgredir ? { logger: aoProgredir } : undefined)

    const passadas = [[plano, '3'], [plano, '6'], [canvas, '6']]
    const votos = [], datas = [], textos = []
    let chave = null, temTotal = false, escolha = null
    for (const [alvo, psm] of passadas) {
      await worker.setParameters({ tessedit_pageseg_mode: psm })
      const { data } = await worker.recognize(alvo)
      const t = data?.text || ''
      textos.push(t)
      const a = extrairDaNota(t)
      chave = chave || a.chave
      if (a.data) datas.push(a.data)
      const v = votosDeValor(t)
      votos.push(...v.votos)
      temTotal = temTotal || v.temTotal
      escolha = decidirValor(votos, temTotal)
      // Para quando já tem o bastante. Com a chave, a SEFAZ dá o valor oficial e o que o
      // OCR leu vira só reserva; sem ela, precisa de valor bem confirmado E da data. Cada
      // leitura a mais custa vários segundos no celular do piloto.
      if ((chave && escolha?.valor) || (escolha?.pontos >= 10 && datas.length)) break
    }

    // Data: a mais lida entre as passadas (empate fica com a primeira).
    const conta = {}
    datas.forEach(d => { conta[d] = (conta[d] || 0) + 1 })
    const data = datas.reduce((m, d) => (m && conta[m] >= conta[d] ? m : d), null)

    const avisos = []
    if (escolha) { const av = avisoDoValor(escolha); if (av) avisos.push(av) }
    else if (temTotal) avisos.push('achei a palavra TOTAL mas não um valor legível')
    return { ok: !!(chave || escolha?.valor || data), origem: 'ocr', chave, valor: escolha?.valor ?? null, data, avisos,
             ...(chave ? dadosDaChave(chave) : {}), textoBruto: textos.join('\n-----\n') }
  } catch (e) {
    return { ok: false, motivo: `não consegui ler o texto da nota (${e?.message || e})` }
  } finally {
    try { await worker?.terminate() } catch { /* worker já caiu: nada a fazer */ }
  }
}

// ── DEGRAU 0 — a própria SEFAZ ───────────────────────────────────────────────
// Com a chave em mãos (do QR ou do texto impresso), pergunta à SEFAZ o valor e a data:
// o número oficial da nota, não um palpite do OCR. Passa pelo /api/nfce porque o
// navegador não pode ler a página da SEFAZ direto (CORS).
//
// Nunca lança. Sem internet, estado ainda não suportado, SEFAZ fora do ar: devolve
// { ok:false, motivo } e o app segue com a leitura da foto, como antes.
export async function consultarSefaz(chave, urlDoQr) {
  if (!chaveValida(chave)) return { ok: false, motivo: 'chave inválida' }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const q = new URLSearchParams({ chave })
    if (/^https?:\/\//i.test(urlDoQr || '')) q.set('url', urlDoQr)
    const r = await fetch(apiUrl(`/api/nfce?${q}`), { signal: ctl.signal })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !(j?.valor > 0)) return { ok: false, motivo: j?.error || `HTTP ${r.status}` }
    return { ok: true, chave, valor: j.valor, data: j.data || null, emitente: j.emitente || null, cancelada: !!j.cancelada }
  } catch (e) {
    return { ok: false, motivo: e?.name === 'AbortError' ? 'a SEFAZ demorou demais' : 'sem conexão' }
  } finally {
    clearTimeout(t)
  }
}

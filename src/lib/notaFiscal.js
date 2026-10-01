// Leitura do QR Code / chave de acesso de nota fiscal brasileira (NFC-e e NFe), pra
// pré-preencher o Cadastro de Notas em vez de o piloto digitar tudo na mão.
//
// Por que QR antes de IA: a chave de acesso é EXATA, não adivinhada. Ela já carrega, nas
// próprias posições, o CNPJ de quem emitiu e o ano/mês da emissão — sem chamar API, sem
// chave de serviço, sem internet e sem custo. Modelo de visão fica pro que não tem QR.
//
// O que o QR atual NÃO dá: o valor. Na versão 2 do QR Code da NFC-e (a obrigatória hoje)
// o parâmetro só traz chave, versão, ambiente e hash — o `vNF` existia só na versão 1,
// que ainda aparece em emissor antigo. Então o valor continua manual, e é isso que o
// passo seguinte (OCR do total) vem resolver.
import jsQR from 'jsqr'

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
  return dvDaChave(chave.slice(0, 43)) === Number(chave[43])
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
async function paraCanvas(origem, maxLado = 1400) {
  const bitmap = origem instanceof Blob ? await createImageBitmap(origem) : origem
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height)) || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { canvas, bitmap }
}

// Lê o QR de uma foto de nota. Devolve sempre um objeto — nunca lança, porque isso roda
// durante o lançamento da despesa e falha de leitura não pode travar o piloto.
export async function lerNotaFiscal(arquivo) {
  try {
    const { canvas, bitmap } = await paraCanvas(arquivo)
    let texto = await lerComDetectorNativo(bitmap)
    if (!texto) texto = lerComJsQr(canvas)
    // Segunda passada ampliada: o QR do cupom é pequeno e, numa foto da nota inteira,
    // às vezes só aparece com mais resolução.
    if (!texto) {
      const grande = await paraCanvas(arquivo, 2200)
      texto = lerComJsQr(grande.canvas)
    }
    if (!texto) return { ok: false, motivo: 'não achei QR Code nessa foto' }
    return parseConteudoQr(texto)
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

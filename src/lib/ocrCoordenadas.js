// Leitura automática das coordenadas impressas na borda de fotos/prints de mapas (estilo
// Raízen: grid de lat/lng ou UTM nas margens da folha) — usa Tesseract.js (OCR 100% no
// dispositivo/navegador, sem chave de API), restrito às faixas de borda da imagem (onde
// ficam os rótulos do grid) pra ser rápido e não confundir com números do miolo do mapa
// (áreas/declividade dos talhões, que no Brasil usam vírgula — "14,62" — não ponto, então
// já ficam fora do nosso regex de coordenada decimal por design).
//
// Trata 3 problemas reais encontrados em mapas de usina (ex: Raízen/Bioparque Bonfim):
// 1. Texto rotacionado 90° nas margens esquerda/direita (comum pros rótulos de Northing/
//    latitude, que não cabem na horizontal numa faixa estreita) — tenta OCR a 0°, e só se
//    não achar nada tenta de novo a ±90°.
// 2. Baixo contraste do papel escaneado/fotografado — binariza (preto e branco) o recorte
//    antes do OCR.
// 3. Grid em UTM (números inteiros de 6-7 dígitos, ex: 360024 / 7621750) em vez de graus
//    decimais — detecta e converte pra lat/lng usando a zona lida no texto do mapa (ex:
//    "UTM 22 Sul"), assumindo elipsoide WGS84 (SIRGAS 2000 é praticamente idêntico pra
//    esse fim — a diferença é desprezível perto da própria margem de erro de calibração
//    manual).
//
// Limitação conhecida, sem rodeio: se não achar NENHUM texto de zona UTM no mapa, os
// números UTM detectados são descartados (não dá pra converter sem saber a zona) e cai
// pro preenchimento manual normalmente.
import { createWorker } from 'tesseract.js'

const FAIXA_BORDA = 0.16 // fração da largura/altura da imagem considerada "borda" pro grid

function recortarCanvas(bitmap, sx, sy, sw, sh) {
  const c = document.createElement('canvas')
  c.width = sw
  c.height = sh
  c.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  return c
}

// Preto e branco puro — destaca texto escuro em fundo cinza/amarelado de papel
// escaneado/fotografado, o que ajuda bastante a precisão do OCR.
function binarizar(canvas, limiar = 150) {
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const cinza = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const v = cinza < limiar ? 0 : 255
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

// Rotaciona um canvas em +90 ou -90 graus (texto vertical -> horizontal, pra o OCR ler).
function rotacionarCanvas(canvas, graus) {
  const rad = (graus * Math.PI) / 180
  const c = document.createElement('canvas')
  c.width = canvas.height
  c.height = canvas.width
  const ctx = c.getContext('2d')
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate(rad)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return c
}

// Mapeia um ponto (X,Y) dentro do canvas ROTACIONADO de volta pra coordenada local do
// canvas original (antes de rotacionar) — pra saber onde o texto ficava de verdade na
// faixa de borda, mesmo tendo lido ele rotacionado.
function desrotacionarPonto(x, y, larguraOriginal, alturaOriginal, graus) {
  if (graus === 90) return { x: y, y: alturaOriginal - x }
  if (graus === -90) return { x: larguraOriginal - y, y: x }
  return { x, y }
}

async function ocrRegiao(worker, canvasOriginal, offX, offY) {
  const larguraOriginal = canvasOriginal.width, alturaOriginal = canvasOriginal.height
  const tentativas = [0, 90, -90]
  for (const graus of tentativas) {
    const canvas = graus === 0 ? canvasOriginal : rotacionarCanvas(canvasOriginal, graus)
    binarizar(canvas)
    const { data } = await worker.recognize(canvas)
    const tokens = []
    for (const word of data.words || []) {
      const texto = (word.text || '').trim()
      const local = desrotacionarPonto(
        (word.bbox.x0 + word.bbox.x1) / 2,
        (word.bbox.y0 + word.bbox.y1) / 2,
        larguraOriginal, alturaOriginal, graus,
      )
      tokens.push({ texto, cx: offX + local.x, cy: offY + local.y })
    }
    // Só tenta a próxima rotação se a atual não achou nenhum número aproveitável — evita
    // gastar tempo rotacionando quando o texto já estava na horizontal (caso comum).
    const achouAlgo = tokens.some(t => /^-?\d{1,3}[.,]\d{3,7}$/.test(t.texto) || /^\d{6,7}$/.test(t.texto))
    if (achouAlgo || graus === tentativas[tentativas.length - 1]) return tokens
  }
  return []
}

// Conversão UTM -> lat/lng (fórmula padrão de Snyder, elipsoide WGS84 — ver nota de
// limitação no topo do arquivo sobre SIRGAS 2000).
function utmParaLatLng(easting, northing, zona, hemisferioSul) {
  const a = 6378137.0
  const f = 1 / 298.257223563
  const e2 = f * (2 - f)
  const ePrime2 = e2 / (1 - e2)
  const k0 = 0.9996
  const x = easting - 500000
  const y = hemisferioSul ? northing - 10000000 : northing
  const meridianoCentral = (zona - 1) * 6 - 180 + 3
  const M = y / k0
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2)
  const T1 = Math.tan(phi1) ** 2
  const C1 = ePrime2 * Math.cos(phi1) ** 2
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * Math.sin(phi1) ** 2, 1.5)
  const D = x / (N1 * k0)
  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * (
    D ** 2 / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ePrime2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ePrime2 - 3 * C1 ** 2) * D ** 6) / 720
  )
  const lng = (
    D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ePrime2 + 24 * T1 ** 2) * D ** 5) / 120
  ) / Math.cos(phi1)
  return { lat: (lat * 180) / Math.PI, lng: meridianoCentral + (lng * 180) / Math.PI }
}

// Retorna { nwLat, nwLng, seLat, seLng } ou null se não achou coordenadas suficientes.
export async function detectarCantosPorOcr(blob) {
  const bitmap = await createImageBitmap(blob)
  const { width, height } = bitmap
  const faixaX = Math.round(width * FAIXA_BORDA)
  const faixaY = Math.round(height * FAIXA_BORDA)

  const regioes = [
    { canvas: recortarCanvas(bitmap, 0, 0, width, faixaY), offX: 0, offY: 0 },
    { canvas: recortarCanvas(bitmap, 0, height - faixaY, width, faixaY), offX: 0, offY: height - faixaY },
    { canvas: recortarCanvas(bitmap, 0, 0, faixaX, height), offX: 0, offY: 0 },
    { canvas: recortarCanvas(bitmap, width - faixaX, 0, faixaX, height), offX: width - faixaX, offY: 0 },
  ]

  const worker = await createWorker('eng')
  const todosTokens = []
  try {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.,-' })
    for (const regiao of regioes) {
      const tokens = await ocrRegiao(worker, regiao.canvas, regiao.offX, regiao.offY)
      todosTokens.push(...tokens)
    }

    const decimais = []
    const utmBrutos = []
    for (const t of todosTokens) {
      const comoDecimal = t.texto.replace(',', '.')
      if (/^-?\d{1,3}\.\d{3,7}$/.test(comoDecimal)) {
        const valor = parseFloat(comoDecimal)
        if (Math.abs(valor) <= 180) decimais.push({ valor, cx: t.cx, cy: t.cy })
      } else if (/^\d{6,7}$/.test(t.texto)) {
        utmBrutos.push({ valor: parseInt(t.texto, 10), digitos: t.texto.length, cx: t.cx, cy: t.cy })
      }
    }

    let utmConvertidos = []
    if (utmBrutos.length > 0) {
      // Zona/hemisfério só dá pra saber lendo o texto normal do mapa (não os dígitos) —
      // roda mais uma passada sem o filtro "só números" na faixa de cima, onde
      // normalmente fica a legenda "Sistema de Projeção ... UTM XX Sul/Norte".
      await worker.setParameters({ tessedit_char_whitelist: '' })
      const { data: dataZona } = await worker.recognize(regioes[0].canvas)
      await worker.setParameters({ tessedit_char_whitelist: '0123456789.,-' })
      const textoZona = (dataZona.text || '')
      const mZona = textoZona.match(/UTM\s*(\d{1,2})/i)
      if (mZona) {
        const zona = parseInt(mZona[1], 10)
        const hemisferioSul = !/norte|north/i.test(textoZona) // Brasil = sul na esmagadora maioria dos casos
        // Northing (7 dígitos) vira latitude com easting nominal (500000 = meridiano
        // central, erro mínimo); Easting (6 dígitos) vira longitude usando a média dos
        // northings encontrados (bem mais preciso que chutar um northing nominal).
        const northings = utmBrutos.filter(t => t.digitos === 7)
        const eastings = utmBrutos.filter(t => t.digitos === 6)
        const northingMedio = northings.length ? northings.reduce((a, t) => a + t.valor, 0) / northings.length : null
        for (const t of northings) {
          const { lat } = utmParaLatLng(500000, t.valor, zona, hemisferioSul)
          utmConvertidos.push({ eixo: 'lat', valor: lat, cx: t.cx, cy: t.cy })
        }
        if (northingMedio != null) {
          for (const t of eastings) {
            const { lng } = utmParaLatLng(t.valor, northingMedio, zona, hemisferioSul)
            utmConvertidos.push({ eixo: 'lng', valor: lng, cx: t.cx, cy: t.cy })
          }
        }
      }
    }

    // Números perto do topo/base variam com X (posição horizontal) = rótulos de longitude.
    // Números perto da esquerda/direita variam com Y (posição vertical) = rótulos de latitude.
    const candidatosLng = [
      ...decimais.filter(t => t.cy < faixaY || t.cy > height - faixaY),
      ...utmConvertidos.filter(t => t.eixo === 'lng').map(t => ({ valor: t.valor, cx: t.cx, cy: t.cy })),
    ]
    const candidatosLat = [
      ...decimais.filter(t => t.cx < faixaX || t.cx > width - faixaX),
      ...utmConvertidos.filter(t => t.eixo === 'lat').map(t => ({ valor: t.valor, cx: t.cx, cy: t.cy })),
    ]
    if (candidatosLng.length < 2 || candidatosLat.length < 2) return null

    const lngOrdenados = [...candidatosLng].sort((a, b) => a.cx - b.cx)
    const latOrdenados = [...candidatosLat].sort((a, b) => a.cy - b.cy)
    const nwLng = lngOrdenados[0].valor
    const seLng = lngOrdenados[lngOrdenados.length - 1].valor
    const nwLat = latOrdenados[0].valor
    const seLat = latOrdenados[latOrdenados.length - 1].valor
    if (nwLng === seLng || nwLat === seLat) return null

    return { nwLat, nwLng, seLat, seLng }
  } finally {
    await worker.terminate()
  }
}

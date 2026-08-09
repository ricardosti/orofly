// Mapa georreferenciado da fazenda (estilo Avenza) — renderiza o PDF que a fazenda manda
// (GeoPDF de verdade ou não) num canvas, e converte GPS em posição na imagem usando os 4
// cantos (lat/lng) que o admin cadastrou pra essa fazenda.
import * as pdfjsLib from 'pdfjs-dist'
import { Capacitor } from '@capacitor/core'

// Servido como arquivo estático da pasta public/ (copiado de node_modules na hora do build) —
// evita depender do bundling de módulo do Webpack pro worker, que quebrava no Vercel (os
// vários chunks internos do worker davam 404 e caíam no fallback de SPA, servindo HTML no
// lugar do JS: "Expected a JavaScript-or-Wasm module script... MIME type of text/html").
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.mjs`

// Renderiza a primeira página do PDF (Blob/ArrayBuffer) num canvas já existente.
// Retorna { width, height } em pixels do canvas.
export async function renderPdfPageToCanvas(pdfData, canvas, maxWidth = 1000) {
  const buf = pdfData instanceof Blob ? await pdfData.arrayBuffer() : pdfData
  const doc = await pdfjsLib.getDocument({ data: buf }).promise
  const page = await doc.getPage(1)
  const viewportBase = page.getViewport({ scale: 1 })
  const scale = maxWidth / viewportBase.width
  const viewport = page.getViewport({ scale })
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return { width: viewport.width, height: viewport.height }
}

// Distância em linha reta entre 2 pontos (fórmula de Haversine), em km.
export function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Converte uma coordenada GPS em posição (x,y) dentro da imagem renderizada, usando os 4
// cantos cadastrados (retângulo alinhado aos eixos — sem rotação, é o caso real observado
// nos GeoPDFs que a Bracell manda). Fora dos limites, retorna null.
export function latLngParaPixel(lat, lng, bounds, imgWidth, imgHeight) {
  const { latMin, latMax, lngMin, lngMax } = bounds
  if (latMax === latMin || lngMax === lngMin) return null
  const u = (lng - lngMin) / (lngMax - lngMin)
  const v = (lat - latMin) / (latMax - latMin)
  if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return null // bem fora do mapa
  return {
    x: Math.max(0, Math.min(imgWidth, u * imgWidth)),
    y: Math.max(0, Math.min(imgHeight, (1 - v) * imgHeight)), // y de tela é invertido (0 no topo)
    dentro: u >= 0 && u <= 1 && v >= 0 && v <= 1,
  }
}

// Extrai georreferenciamento nativo de um GeoPDF real (dicionários /VP, /Measure, /GPTS,
// /LPTS do padrão ISO 32000 / Adobe Geospatial — é o que ArcGIS, Global Mapper, TerraGo
// Publisher etc. gravam). Se achar, devolve os 4 cantos prontos, sem precisar calibrar na
// mão. Se o PDF for "comum" (sem essas chaves), devolve null — quem chamar deve cair pra
// calibração manual por 2 pontos.
//
// Como funciona: GPTS é uma lista de pontos [lat1,lon1, lat2,lon2, ...] (coordenada real);
// LPTS é a lista correspondente [x1,y1, x2,y2, ...] em fração 0–1 dentro da página (origem
// no canto inferior esquerdo, eixo Y pra cima — convenção nativa do PDF, que é a MESMA que
// latLngParaPixel já usa pra "v"). Pega os 2 pontos mais afastados em diagonal e resolve o
// mesmo sistema linear da calibração manual — não precisamos nem dos 4 cantos, 2 bastam.
//
// Limitação conhecida: assume que o /BBox do viewport é a página inteira (caso mais comum).
// Se o PDF usar um /BBox menor (recortando um cabeçalho/legenda, por exemplo), o resultado
// fica levemente deslocado — por isso ainda vale checar visualmente depois de importar.
// Também não lê object streams comprimidos (/ObjStm); se o GPTS estiver lá dentro, não
// vamos achar e cai pro fallback manual — não é 100% dos GeoPDFs, mas cobre boa parte.
export async function extrairGeoPdf(pdfData) {
  try {
    const buf = pdfData instanceof Blob ? await pdfData.arrayBuffer() : pdfData
    const bytes = new Uint8Array(buf)
    let texto = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      texto += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
    }

    const pegarArray = (chave) => {
      const m = texto.match(new RegExp('/' + chave + '\\s*\\[([^\\]]+)\\]'))
      if (!m) return null
      const nums = m[1].trim().split(/\s+/).map(Number)
      return nums.some(isNaN) ? null : nums
    }

    const gpts = pegarArray('GPTS')
    const lpts = pegarArray('LPTS')
    if (!gpts || !lpts || gpts.length < 4 || lpts.length < 4 || gpts.length !== lpts.length) {
      return { encontrado: false, motivo: gpts||lpts ? 'GPTS/LPTS incompletos ou de tamanhos diferentes' : 'sem dicionário /GPTS (PDF comum, não é GeoPDF)' }
    }

    const pontos = []
    for (let i = 0; i + 1 < gpts.length; i += 2) {
      pontos.push({ lat: gpts[i], lng: gpts[i + 1], u: lpts[i], v: lpts[i + 1] })
    }
    // Pega o par mais afastado (maior diagonal) pra minimizar erro numérico do cálculo
    let par = null, dist = -1
    for (let i = 0; i < pontos.length; i++) {
      for (let j = i + 1; j < pontos.length; j++) {
        const d = Math.hypot(pontos[i].u - pontos[j].u, pontos[i].v - pontos[j].v)
        if (d > dist) { dist = d; par = [pontos[i], pontos[j]] }
      }
    }
    if (!par || dist < 0.15) return { encontrado: false, motivo: `pontos GPTS/LPTS achados mas muito próximos entre si (dist=${dist.toFixed(3)}) pra calcular com precisão` }
    const [A, B] = par
    if (A.u === B.u || A.v === B.v) return { encontrado: false, motivo: 'pontos GPTS/LPTS alinhados (não formam diagonal), não dá pra calcular' }

    const dLng = (A.lng - B.lng) / (A.u - B.u)
    const lngMin = A.lng - A.u * dLng
    const lngMax = lngMin + dLng
    const dLat = (A.lat - B.lat) / (A.v - B.v)
    const latMin = A.lat - A.v * dLat
    const latMax = latMin + dLat

    return {
      encontrado: true,
      pontosUsados: pontos.length,
      bounds: {
        latMin: Math.min(latMin, latMax), latMax: Math.max(latMin, latMax),
        lngMin: Math.min(lngMin, lngMax), lngMax: Math.max(lngMin, lngMax),
      },
    }
  } catch (e) {
    return { encontrado: false, motivo: 'erro ao ler o PDF: ' + (e?.message || e) }
  }
}

function base64ParaArrayBuffer(base64) {
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes.buffer
}

function blobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Cache local do PDF do mapa (pasta Data do app, via @capacitor/filesystem) — depois da
// primeira vez que o mapa foi baixado com internet, ele abre de novo em campo mesmo sem
// sinal. Só existe no app nativo (Android/iOS); no navegador comum não faz nada.
export async function lerMapaCache(fazendaId) {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const res = await Filesystem.readFile({ path: `mapas-cache/${fazendaId}.pdf`, directory: Directory.Data })
    return base64ParaArrayBuffer(res.data)
  } catch { return null }
}

export async function salvarMapaCache(fazendaId, blobOuArrayBuffer) {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const blob = blobOuArrayBuffer instanceof Blob ? blobOuArrayBuffer : new Blob([blobOuArrayBuffer])
    const base64 = await blobParaBase64(blob)
    await Filesystem.mkdir({ path: 'mapas-cache', directory: Directory.Data, recursive: true }).catch(() => {})
    await Filesystem.writeFile({ path: `mapas-cache/${fazendaId}.pdf`, data: base64, directory: Directory.Data })
  } catch (e) { console.error('Erro ao salvar mapa em cache local:', e) }
}

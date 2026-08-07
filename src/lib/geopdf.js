// Mapa georreferenciado da fazenda (estilo Avenza) — renderiza o PDF que a fazenda manda
// (GeoPDF de verdade ou não) num canvas, e converte GPS em posição na imagem usando os 4
// cantos (lat/lng) que o admin cadastrou pra essa fazenda.
import * as pdfjsLib from 'pdfjs-dist'

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

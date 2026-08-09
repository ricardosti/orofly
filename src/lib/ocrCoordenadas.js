// Leitura automática das coordenadas impressas na borda de fotos/prints de mapas (estilo
// Raízen: grid de lat/lng nas margens da folha) — usa Tesseract.js (OCR 100% no
// dispositivo/navegador, sem chave de API), restrito às faixas de borda da imagem (onde
// ficam os rótulos do grid) pra ser rápido e não confundir com números do miolo do mapa
// (áreas/declividade dos talhões, que no Brasil usam vírgula — "14,62" — não ponto, então
// já ficam fora do nosso regex de coordenada por design).
//
// Limitação conhecida, sem rodeio: só reconhece coordenadas em graus decimais (ex:
// -21.7325) — não converte grids em UTM (metros). Se o mapa só tiver grid UTM nas bordas
// (sem nenhum valor em graus decimais visível), o OCR não acha nada e a tela cai pro
// preenchimento manual normalmente, sem quebrar o fluxo. Também precisa de internet na
// primeira vez que roda (baixa o modelo de OCR do Tesseract, ~15MB) — depois disso o
// navegador costuma cachear.
import { createWorker } from 'tesseract.js'

const FAIXA_BORDA = 0.16 // fração da largura/altura da imagem considerada "borda" pro grid

function recortarCanvas(bitmap, sx, sy, sw, sh) {
  const c = document.createElement('canvas')
  c.width = sw
  c.height = sh
  c.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  return c
}

// Retorna { nwLat, nwLng, seLat, seLng } ou null se não achou coordenadas suficientes.
export async function detectarCantosPorOcr(blob) {
  const bitmap = await createImageBitmap(blob)
  const { width, height } = bitmap
  const faixaX = Math.round(width * FAIXA_BORDA)
  const faixaY = Math.round(height * FAIXA_BORDA)

  const regioes = [
    { canvas: recortarCanvas(bitmap, 0, 0, width, faixaY), offX: 0, offY: 0 }, // topo
    { canvas: recortarCanvas(bitmap, 0, height - faixaY, width, faixaY), offX: 0, offY: height - faixaY }, // base
    { canvas: recortarCanvas(bitmap, 0, 0, faixaX, height), offX: 0, offY: 0 }, // esquerda
    { canvas: recortarCanvas(bitmap, width - faixaX, 0, faixaX, height), offX: width - faixaX, offY: 0 }, // direita
  ]

  const worker = await createWorker('eng')
  const tokens = []
  try {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.-' })
    for (const regiao of regioes) {
      const { data } = await worker.recognize(regiao.canvas)
      for (const word of data.words || []) {
        const texto = (word.text || '').trim()
        if (!/^-?\d{1,3}\.\d{3,7}$/.test(texto)) continue
        const valor = parseFloat(texto)
        if (Math.abs(valor) > 180) continue
        const cx = regiao.offX + (word.bbox.x0 + word.bbox.x1) / 2
        const cy = regiao.offY + (word.bbox.y0 + word.bbox.y1) / 2
        tokens.push({ valor, cx, cy })
      }
    }
  } finally {
    await worker.terminate()
  }

  // Números perto do topo/base variam com X (posição horizontal) = rótulos de longitude.
  // Números perto da esquerda/direita variam com Y (posição vertical) = rótulos de latitude.
  const candidatosLng = tokens.filter(t => t.cy < faixaY || t.cy > height - faixaY)
  const candidatosLat = tokens.filter(t => t.cx < faixaX || t.cx > width - faixaX)
  if (candidatosLng.length < 2 || candidatosLat.length < 2) return null

  const lngOrdenados = [...candidatosLng].sort((a, b) => a.cx - b.cx)
  const latOrdenados = [...candidatosLat].sort((a, b) => a.cy - b.cy)
  const nwLng = lngOrdenados[0].valor
  const seLng = lngOrdenados[lngOrdenados.length - 1].valor
  const nwLat = latOrdenados[0].valor
  const seLat = latOrdenados[latOrdenados.length - 1].valor
  if (nwLng === seLng || nwLat === seLat) return null

  return { nwLat, nwLng, seLat, seLng }
}

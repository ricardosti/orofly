// Compressão de imagem antes de subir pro Storage.
//
// Existe por causa de agosto/2026: fotos de 3–8 MB direto da câmera estouraram a cota de
// banda do Supabase e derrubaram o app. No app do piloto isso já é resolvido pelo
// ImageAnnotator; aqui é pro que entra por seleção de arquivo, sem passar por ele.

// 1280 px no lado maior. No PDF a foto sai com 70–128 mm de largura; a 200 dpi isso dá
// ~1000 px, então 1280 ainda sobra. Mesmo número usado no ImageAnnotator.
const MAX_LADO = 1280
const QUALIDADE = 0.82

/**
 * Lê o arquivo, reduz e devolve { dataUrl, blob }.
 * Se der qualquer problema (formato exótico, canvas bloqueado), devolve o original
 * em dataUrl e blob null — melhor subir grande do que perder a foto do usuário.
 */
export function comprimirImagem(file, { maxLado = MAX_LADO, qualidade = QUALIDADE } = {}) {
  return new Promise(resolve => {
    const leitor = new FileReader()
    leitor.onerror = () => resolve(null)
    leitor.onload = ev => {
      const original = ev.target.result
      const img = new Image()
      img.onerror = () => resolve({ dataUrl: original, blob: null })
      img.onload = () => {
        try {
          let w = img.width, h = img.height
          if (w > maxLado || h > maxLado) {
            const escala = maxLado / Math.max(w, h)
            w = Math.round(w * escala); h = Math.round(h * escala)
          }
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          const dataUrl = canvas.toDataURL('image/jpeg', qualidade)
          canvas.toBlob(blob => resolve({ dataUrl, blob }), 'image/jpeg', qualidade)
        } catch {
          resolve({ dataUrl: original, blob: null })
        }
      }
      img.src = original
    }
    leitor.readAsDataURL(file)
  })
}

/** Baixa uma imagem já no Storage e devolve em dataURL — o jsPDF só aceita assim. */
export async function urlParaDataUrl(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise(resolve => {
      const r = new FileReader()
      r.onload = ev => resolve(ev.target.result)
      r.onerror = () => resolve(null)
      r.readAsDataURL(blob)
    })
  } catch { return null }
}

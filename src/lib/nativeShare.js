// Compartilhamento/"download" de arquivos dentro do app nativo (Capacitor).
// O WebView do app empacotado não tem download de navegador nem sempre suporta a
// Web Share API do jeito esperado — usa os plugins oficiais do Capacitor (Share +
// Filesystem) pra abrir o menu nativo do Android de compartilhar/salvar.
import { Capacitor } from '@capacitor/core'

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Compartilha texto + (opcional) um arquivo. No app nativo abre o menu de compartilhar
// do Android (permite escolher WhatsApp etc). No navegador comum tenta a Web Share API
// e, se não suportar, cai no webFallbackUrl (ex: link wa.me só com texto).
export async function compartilharNativo({ text, file, filename, webFallbackUrl }) {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      const { Share } = await import('@capacitor/share')
      let fileUri
      if (file) {
        const base64 = await blobToBase64(file)
        const written = await Filesystem.writeFile({ path: filename || 'compartilhar', data: base64, directory: Directory.Cache })
        fileUri = written.uri
      }
      await Share.share({ text, files: fileUri ? [fileUri] : undefined, dialogTitle: 'Compartilhar' })
      return true
    } catch (e) {
      // Usuário cancelando o menu de compartilhar não é erro
      if (String(e?.message || '').toLowerCase().includes('cancel')) return true
      console.error('Erro ao compartilhar (nativo):', e)
      return false
    }
  }
  try {
    if (navigator.share) {
      if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ text, files: [file] }); return true }
      await navigator.share({ text }); return true
    }
  } catch (e) { if (e.name === 'AbortError') return true }
  if (webFallbackUrl) window.open(webFallbackUrl, '_blank')
  return false
}

// Salva um PDF do jsPDF: no navegador baixa normalmente; no app nativo não existe
// "baixar" de verdade, então abre o menu de compartilhar (Salvar em Arquivos, enviar
// por WhatsApp/e-mail etc).
export async function salvarOuCompartilharPdf(doc, filename) {
  if (Capacitor.isNativePlatform()) {
    const blob = doc.output('blob')
    await compartilharNativo({ file: blob, filename })
    return
  }
  doc.save(filename)
}

// Mesma ideia para um Blob qualquer já pronto (ex: documento Word).
export async function salvarOuCompartilharBlob(blob, filename) {
  if (Capacitor.isNativePlatform()) {
    await compartilharNativo({ file: blob, filename })
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

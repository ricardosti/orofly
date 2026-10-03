// Câmera e galeria pelo plugin nativo do Capacitor, com volta pro <input type=file> na web.
//
// Por que não dá pra confiar no `capture="environment"` do input: no WebView do Android ele
// é uma SUGESTÃO, não uma ordem. Na prática o aparelho abre o seletor de arquivos e cai na
// galeria — foi o que aconteceu em campo: o piloto tocava em "Câmera" e via as fotos dele.
// O plugin abre a câmera de verdade.
import { Capacitor } from '@capacitor/core'

export function cameraNativaDisponivel() {
  try { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Camera') } catch { return false }
}

async function pegarFoto(source) {
  if (!cameraNativaDisponivel()) return null
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
    const foto = await Camera.getPhoto({
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      resultType: CameraResultType.Uri,
      // Qualidade alta e SEM redimensionar: esta foto passa pelo leitor de QR, e QR de
      // cupom é pequeno — cada pixel conta. Quem reduz pro tamanho de guardar é o editor
      // de imagem, depois da leitura.
      quality: 92,
      correctOrientation: true,
      allowEditing: false,
      promptLabelHeader: 'Foto da nota',
      promptLabelPhoto: 'Escolher da galeria',
      promptLabelPicture: 'Tirar foto',
    })
    if (!foto?.webPath) return null
    const blob = await fetch(foto.webPath).then(r => r.blob())
    return new File([blob], `nota.${foto.format || 'jpg'}`, { type: blob.type || 'image/jpeg' })
  } catch (e) {
    // Cancelar a câmera cai aqui e não é erro — devolve null e a tela segue como estava.
    return null
  }
}

export const abrirCamera  = () => pegarFoto('camera')
export const abrirGaleria = () => pegarFoto('galeria')

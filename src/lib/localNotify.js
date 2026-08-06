// Notificação local (nativa) do app Android — usada pra avisar o admin, na hora, quando
// um piloto inicia um voo. Só funciona enquanto o app estiver de pé (foreground ou em
// segundo plano, mas não totalmente fechado pelo Android) — é a alternativa sem precisar
// de servidor de push (Firebase), já que o Web Push comum não roda de forma confiável
// dentro do WebView do Capacitor. Em navegador (não-nativo) essas funções não fazem nada.
import { Capacitor } from '@capacitor/core'

export async function pedirPermissaoNotificacaoLocal() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const atual = await LocalNotifications.checkPermissions()
    if (atual.display !== 'granted') await LocalNotifications.requestPermissions()
  } catch (e) { console.warn('Permissão de notificação local:', e) }
}

let proximoId = Math.floor(Date.now() / 1000) % 1000000

export async function notificarLocal({ titulo, corpo }) {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.schedule({
      notifications: [{ id: proximoId++, title: titulo, body: corpo }],
    })
  } catch (e) { console.warn('Notificação local falhou:', e) }
}

// Helpers para Web Push notifications

const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY
// URL absoluta: dentro do app nativo (Capacitor) a origem é https://localhost,
// que não tem as funções serverless — sempre chama o site publicado de verdade.
const API_BASE = 'https://orofly.vercel.app'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

// Registra service worker e pede permissão de push
export async function registrarPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('Push não suportado neste navegador')
      return null
    }

    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      console.log('Permissão de notificação negada')
      return null
    }

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      if (!VAPID_PUBLIC_KEY) {
        console.warn('VAPID_PUBLIC_KEY não configurada')
        return null
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      })
    }
    return sub
  } catch (e) {
    console.error('Erro ao registrar push:', e)
    return null
  }
}

// Salva subscription no banco
export async function salvarSubscription(supabase, userId, subscription) {
  if (!subscription) return
  try {
    await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      subscription: subscription.toJSON(),
    }, { onConflict: 'user_id' })
  } catch (e) {
    console.error('Erro ao salvar subscription:', e)
  }
}

// Envia notificação via API
export async function enviarNotificacao({ titulo, corpo, url, tag, requireInteraction }) {
  try {
    await fetch(`${API_BASE}/api/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, corpo, url, tag, requireInteraction })
    })
  } catch (e) {
    console.error('Erro ao enviar notificação:', e)
  }
}

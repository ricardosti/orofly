// Orofly Service Worker - Push Notifications
self.addEventListener('install', e => { self.skipWaiting() })
self.addEventListener('activate', e => { e.waitUntil(clients.claim()) })

// Recebe push notification
self.addEventListener('push', e => {
  const data = e.data?.json() || {}
  const options = {
    body: data.body || 'Nova notificação Orofly',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
    tag: data.tag || 'orofly',
  }
  e.waitUntil(self.registration.showNotification(data.title || 'Orofly', options))
})

// Clique na notificação abre o app
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(clients.matchAll({ type: 'window' }).then(wins => {
    const win = wins.find(w => w.url.includes(self.location.origin))
    if (win) { win.focus(); win.navigate(url) }
    else clients.openWindow(url)
  }))
})

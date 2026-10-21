const { createClient } = require('@supabase/supabase-js')
const webpush = require('web-push')
const { cors, conferirLogin } = require('./_auth')

webpush.setVapidDetails(
  'mailto:admin@orofly.com.br',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// Link da notificação: só caminho do próprio site ou o mapa do Google (o do SOS). Sem essa
// trava, quem chamasse a função mandava aos admins uma notificação apontando pra qualquer
// site — e o clique abre o link dentro do app (public/sw.js).
function linkPermitido(url) {
  const s = String(url || '')
  if (/^\/(?![/\\])/.test(s)) return s
  try {
    const u = new URL(s)
    const mapa = u.hostname === 'maps.google.com' || (u.hostname === 'www.google.com' && u.pathname.startsWith('/maps'))
    if (u.protocol === 'https:' && mapa) return u.toString()
  } catch { /* não é URL */ }
  return '/'
}

module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await conferirLogin(req, res))) return

  const admin = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  try {
    const { titulo, corpo, url, tag, requireInteraction } = req.body

    // Busca subscriptions de todos os admins ativos
    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('subscription, profiles!inner(role, ativo)')
      .eq('profiles.role', 'admin')
      .eq('profiles.ativo', true)

    if (error) throw error
    if (!subs || subs.length === 0) {
      return res.status(200).json({ sent: 0, message: 'Nenhum admin com push ativo' })
    }

    const payload = JSON.stringify({
      title: String(titulo || 'Orofly').slice(0, 120),
      body: String(corpo || '').slice(0, 500),
      url: linkPermitido(url),
      tag: String(tag || 'orofly').slice(0, 64),
      requireInteraction: !!requireInteraction,
    })

    let sent = 0, failed = 0
    for (const row of subs) {
      try {
        await webpush.sendNotification(row.subscription, payload)
        sent++
      } catch (e) {
        failed++
        // Remove subscription inválida
        if (e.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('subscription', row.subscription)
        }
      }
    }

    return res.status(200).json({ sent, failed })
  } catch (err) {
    console.error('send-notification error:', err)
    return res.status(400).json({ error: err.message })
  }
}

// Exposto pros testes; a Vercel só usa o handler.
module.exports.linkPermitido = linkPermitido

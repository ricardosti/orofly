const { createClient } = require('@supabase/supabase-js')
const webpush = require('web-push')

webpush.setVapidDetails(
  'mailto:admin@orofly.com.br',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
      title: titulo || 'Orofly',
      body: corpo || '',
      url: url || '/',
      tag: tag || 'orofly',
      requireInteraction: requireInteraction || false,
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

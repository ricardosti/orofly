const { createClient } = require('@supabase/supabase-js')

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const admin = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  try {
    const { user_id, subscription } = req.body
    await admin.from('push_subscriptions').upsert({ user_id, subscription }, { onConflict: 'user_id' })
    return res.status(200).json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}

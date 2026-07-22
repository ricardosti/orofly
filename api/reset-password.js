const { createClient } = require('@supabase/supabase-js')
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  try {
    const { id, novaSenha } = req.body
    if (!id || !novaSenha) return res.status(400).json({ error: 'id e novaSenha obrigatórios' })
    if (novaSenha.length < 6) return res.status(400).json({ error: 'Senha mínima 6 caracteres' })
    const { error } = await admin.auth.admin.updateUserById(id, { password: novaSenha })
    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

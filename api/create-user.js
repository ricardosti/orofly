const { createClient } = require('@supabase/supabase-js')
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  try {
    const { nome, email, senha, role } = req.body
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Preencha todos os campos' })
    if (senha.length < 6) return res.status(400).json({ error: 'Senha mínima 6 caracteres' })
    const { data, error } = await admin.auth.admin.createUser({ email, password: senha, user_metadata: { nome, role: role||'piloto' }, email_confirm: true })
    if (error) throw error
    await admin.from('profiles').upsert({ id: data.user.id, nome, email, role: role||'piloto', ativo: true })
    return res.status(200).json({ success: true, userId: data.user.id })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

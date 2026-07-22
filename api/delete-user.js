const { createClient } = require('@supabase/supabase-js')
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  try {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    // Apaga o perfil primeiro (se houver cascade de auth.users pra profiles, isso já
    // seria feito sozinho no próximo passo, mas não custa garantir dos dois lados)
    await admin.from('profiles').delete().eq('id', id)
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

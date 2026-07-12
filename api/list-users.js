const { createClient } = require('@supabase/supabase-js')
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()
  const admin = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  try {
    const { data, error } = await admin.from('profiles').select('*').order('nome')
    if (error) throw error
    return res.status(200).json({ users: data })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

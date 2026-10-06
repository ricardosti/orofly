const { cors, exigirPerfil } = require('./_auth')
module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  const acesso = await exigirPerfil(req, res, ['admin', 'supervisor'])
  if (!acesso) return
  try {
    const { id, time_id } = req.body
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    const { error } = await acesso.admin.from('profiles').update({ time_id: time_id || null }).eq('id', id)
    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

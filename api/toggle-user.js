const { cors, exigirPerfil } = require('./_auth')
module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  const acesso = await exigirPerfil(req, res, ['admin'])
  if (!acesso) return
  const { admin, perfil } = acesso
  try {
    const { id, ativo } = req.body
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    if (id === perfil.id && !ativo) return res.status(400).json({ error: 'Você não pode desativar a própria conta' })
    const { error } = await admin.from('profiles').update({ ativo }).eq('id', id)
    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

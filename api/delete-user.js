const { cors, exigirPerfil } = require('./_auth')
module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const acesso = await exigirPerfil(req, res, ['admin'])
  if (!acesso) return
  const { admin, perfil } = acesso
  try {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    if (id === perfil.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta' })
    // Apaga o perfil primeiro (se houver cascade de auth.users pra profiles, isso já
    // seria feito sozinho no próximo passo, mas não custa garantir dos dois lados)
    await admin.from('profiles').delete().eq('id', id)
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

const { cors, exigirPerfil, PERFIS } = require('./_auth')
module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  const acesso = await exigirPerfil(req, res, ['admin'])
  if (!acesso) return
  const { admin, perfil } = acesso
  try {
    const { id, role } = req.body
    if (!id || !role) return res.status(400).json({ error: 'id e role obrigatórios' })
    if (!PERFIS.includes(role)) return res.status(400).json({ error: 'Perfil inválido' })
    // O painel já bloqueia; aqui garante que ninguém mude o próprio perfil pela API.
    if (id === perfil.id) return res.status(400).json({ error: 'Você não pode alterar o próprio perfil de acesso' })
    const { error } = await admin.from('profiles').update({ role }).eq('id', id)
    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

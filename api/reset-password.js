const { cors, exigirPerfil } = require('./_auth')
module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const acesso = await exigirPerfil(req, res, ['admin'])
  if (!acesso) return
  try {
    const { id, novaSenha } = req.body
    if (!id || !novaSenha) return res.status(400).json({ error: 'id e novaSenha obrigatórios' })
    if (novaSenha.length < 6) return res.status(400).json({ error: 'Senha mínima 6 caracteres' })
    const { error } = await acesso.admin.auth.admin.updateUserById(id, { password: novaSenha })
    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

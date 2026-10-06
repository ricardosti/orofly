const { cors, exigirPerfil, PERFIS } = require('./_auth')
module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const acesso = await exigirPerfil(req, res, ['admin'])
  if (!acesso) return
  const { admin } = acesso
  try {
    const { nome, email, senha, role } = req.body
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Preencha todos os campos' })
    if (senha.length < 6) return res.status(400).json({ error: 'Senha mínima 6 caracteres' })
    const perfil = role || 'piloto'
    if (!PERFIS.includes(perfil)) return res.status(400).json({ error: 'Perfil inválido' })
    const { data, error } = await admin.auth.admin.createUser({ email, password: senha, user_metadata: { nome, role: perfil }, email_confirm: true })
    if (error) throw error
    await admin.from('profiles').upsert({ id: data.user.id, nome, email, role: perfil, ativo: true })
    return res.status(200).json({ success: true, userId: data.user.id })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

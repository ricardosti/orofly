const { cors, exigirPerfil } = require('./_auth')
// Lista da aba Usuários/Equipes. O RLS de `profiles` só deixa cada um ler o próprio perfil,
// por isso passa por aqui — e só para quem administra a equipe.
module.exports = async function handler(req, res) {
  cors(res, 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  const acesso = await exigirPerfil(req, res, ['admin', 'supervisor'])
  if (!acesso) return
  try {
    const { data, error } = await acesso.admin.from('profiles').select('*').order('nome')
    if (error) throw error
    return res.status(200).json({ users: data })
  } catch (err) { return res.status(400).json({ error: err.message }) }
}

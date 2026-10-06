// Porteiro das funções administrativas. Todas usam a chave mestra (service role), que passa
// por cima do RLS — e até 05/10/2026 nenhuma conferia quem chamava: qualquer um na internet
// podia listar os usuários (list-users), trocar a senha de qualquer conta (reset-password) e
// virar admin (toggle-role). Agora quem chama manda o próprio login no cabeçalho
// (Authorization: Bearer <token da sessão>) e precisa ter um dos perfis permitidos.
//
// O "_" no nome impede a Vercel de publicar este arquivo como rota.
const { createClient } = require('@supabase/supabase-js')

const PERFIS = ['piloto', 'supervisor', 'admin', 'administrativo']

function clienteAdmin() {
  return createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function cors(res, metodos = 'POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', metodos)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

// Devolve { admin, perfil } quando o token é de um usuário ATIVO com um dos `perfis`; senão
// já responde 401/403 e devolve null.
async function exigirPerfil(req, res, perfis) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) { res.status(401).json({ error: 'Sessão expirada: entre de novo' }); return null }
  const admin = clienteAdmin()
  const { data, error } = await admin.auth.getUser(token)
  const user = data?.user
  if (error || !user) { res.status(401).json({ error: 'Sessão expirada: entre de novo' }); return null }
  const { data: perfil } = await admin.from('profiles').select('id, role, ativo').eq('id', user.id).maybeSingle()
  if (!perfil || !perfil.ativo || !perfis.includes(perfil.role)) {
    res.status(403).json({ error: 'Sem permissão para isso' }); return null
  }
  return { admin, perfil }
}

module.exports = { PERFIS, clienteAdmin, cors, exigirPerfil }

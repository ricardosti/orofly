import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

// No app Android/iOS o WebView carrega os assets do bundle local (webDir: 'build'), servido
// de um esquema tipo capacitor://localhost — não do domínio da Vercel. Um fetch relativo
// ('/api/clima') nesse contexto bate num endpoint que não existe localmente e falha, mesmo
// com internet OK (bug: previsão funciona na Web mas dá erro de conexão no APK). Na Web
// (fetch relativo já funciona, mesma origem) deixamos como está; só no nativo é que a gente
// precisa apontar pro domínio de produção onde as funções serverless (/api/*) realmente vivem.
const API_BASE = Capacitor.isNativePlatform() ? 'https://orofly.vercel.app' : ''

export function apiUrl(path) {
  return `${API_BASE}${path}`
}

// Login de quem chama, pras funções do servidor que conferem o perfil (api/_auth.js). Sem
// sessão, vai sem. Com prazo: sem sinal e com o token vencido, o getSession fica ~25 s tentando
// renovar — e a previsão guardada no aparelho esperaria esse tempo todo pra aparecer.
export async function cabecalhoLogin() {
  try {
    const { data } = await Promise.race([
      supabase.auth.getSession(),
      new Promise(ok => setTimeout(() => ok({ data: null }), 3000)),
    ])
    const token = data?.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch { return {} }
}

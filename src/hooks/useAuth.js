import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { definirUsuario, registrar } from '../lib/atividade'

const AuthContext = createContext({})

// Marcado só quando o usuário digita a senha e entra. O onAuthStateChange sozinho
// não serve pra isso: ele também dispara na renovação automática do token.
let loginDeliberado = false

// Login guardado no aparelho: a sessão do Supabase ainda no armazenamento e o último perfil
// carregado. O piloto abre o app no campo, sem sinal e com o token de acesso vencido (dura
// ~1h). Nesse caso o getSession passa ~25 s tentando renovar e volta SEM sessão, e o
// INITIAL_SESSION chega antes, também vazio: o app ficava no splash e depois caía no login,
// e com sinal fraco (navigator.onLine = true) ficava preso nele. A sessão continua guardada
// e renova sozinha quando o sinal voltar. Medido no Node em 18/10/2026.
function loginGuardado() {
  try {
    const temSessao = Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k))
    const u = JSON.parse(localStorage.getItem('orofly_session_cache') || 'null')
    const p = JSON.parse(localStorage.getItem('orofly_profile_cache') || 'null')
    if (temSessao && u && p && p.id === u.id) return { u, p }
  } catch {}
  return null
}

export function AuthProvider({ children }) {
  // Com login guardado, o app abre na hora com ele, sem esperar a renovação do token.
  const [guardado] = useState(loginGuardado)
  const [user, setUser] = useState(guardado?.u ?? null)
  const [profile, setProfile] = useState(guardado?.p ?? null)
  const [loading, setLoading] = useState(!guardado)

  useEffect(() => {
    if (guardado) definirUsuario(guardado.p)
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (session?.user) {
        setUser(session.user)
        try { localStorage.setItem('orofly_session_cache', JSON.stringify({ id: session.user.id, email: session.user.email })) } catch {}
        fetchProfile(session.user.id)
        return
      }
      // Sem sessão: ou não tem login (vai pro login), ou a renovação do token falhou por falta
      // de rede. AuthRetryableFetchError é o Supabase dizendo "não alcancei o servidor" — o
      // navigator.onLine sozinho não basta, porque com sinal fraco ele diz que está online.
      const semRede = error?.name === 'AuthRetryableFetchError' || !navigator.onLine
      const g = semRede && loginGuardado()
      if (g) { setUser(g.u); setProfile(g.p); definirUsuario(g.p); setLoading(false); return }
      setUser(null); setProfile(null); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, session) => {
      // O estado inicial é do getSession acima: sem sinal, o INITIAL_SESSION vem vazio e
      // derrubaria o login guardado.
      if (evento === 'INITIAL_SESSION') return
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line

  async function fetchProfile(userId) {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (error) throw error
      setProfile(data)
      definirUsuario(data)
      if (loginDeliberado) { loginDeliberado = false; registrar('login') }
      try { localStorage.setItem('orofly_profile_cache', JSON.stringify(data)) } catch {}
    } catch (e) {
      // Sem conexão: usa o último perfil salvo em cache pra não travar o app carregando pra sempre
      try {
        const cached = JSON.parse(localStorage.getItem('orofly_profile_cache') || 'null')
        if (cached?.id === userId) { setProfile(cached); definirUsuario(cached) }
      } catch {}
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading,
      signIn: async (email, password) => {
        const res = await supabase.auth.signInWithPassword({ email, password })
        // O registro em si sai do fetchProfile, que é quando o nome já está carregado.
        if (!res.error) loginDeliberado = true
        return res
      },
      signOut: async () => {
        registrar('logout')          // antes de sair: depois do signOut o RLS já recusa
        const res = await supabase.auth.signOut()
        definirUsuario(null)
        return res
      },
      refreshProfile: () => user && fetchProfile(user.id)
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { definirUsuario, registrar } from '../lib/atividade'

const AuthContext = createContext({})

// Marcado só quando o usuário digita a senha e entra. O onAuthStateChange sozinho
// não serve pra isso: ele também dispara na renovação automática do token.
let loginDeliberado = false

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        try { localStorage.setItem('orofly_session_cache', JSON.stringify({ id: session.user.id, email: session.user.email })) } catch {}
        fetchProfile(session.user.id)
        return
      }
      // Sem sessão válida localmente — normalmente é porque o token de acesso expirou
      // (dura ~1h) e a renovação automática precisa de internet pra acontecer. Se estiver
      // offline e já existir um login anterior salvo, deixa continuar em vez de barrar no
      // login (o piloto não tem como digitar a senha sem sinal de qualquer forma).
      if (!navigator.onLine) {
        try {
          const cachedUser = JSON.parse(localStorage.getItem('orofly_session_cache') || 'null')
          const cachedProfile = JSON.parse(localStorage.getItem('orofly_profile_cache') || 'null')
          if (cachedUser && cachedProfile && cachedProfile.id === cachedUser.id) {
            setUser(cachedUser); setProfile(cachedProfile); definirUsuario(cachedProfile); setLoading(false)
            return
          }
        } catch {}
      }
      setUser(null); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

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

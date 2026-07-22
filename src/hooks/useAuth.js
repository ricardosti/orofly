import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

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
            setUser(cachedUser); setProfile(cachedProfile); setLoading(false)
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
      try { localStorage.setItem('orofly_profile_cache', JSON.stringify(data)) } catch {}
    } catch (e) {
      // Sem conexão: usa o último perfil salvo em cache pra não travar o app carregando pra sempre
      try {
        const cached = JSON.parse(localStorage.getItem('orofly_profile_cache') || 'null')
        if (cached?.id === userId) setProfile(cached)
      } catch {}
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading,
      signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
      signOut: () => supabase.auth.signOut()
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

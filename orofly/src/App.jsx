import { useState } from 'react'
import { AuthProvider, useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import PilotApp from './pages/PilotApp'
import AdminPanel from './pages/AdminPanel'

function AppRouter() {
  const { user, profile, loading } = useAuth()
  const [mode, setMode] = useState(null)

  if (loading) return <Splash />
  if (!user || !profile) return <LoginPage />
  if (!profile.ativo) return <Bloqueado />

  const isAdmin = profile.role === 'admin'
  const currentMode = mode || profile.role

  return currentMode === 'admin'
    ? <AdminPanel onSwitchMode={isAdmin ? () => setMode('piloto') : null} />
    : <PilotApp   onSwitchMode={isAdmin ? () => setMode('admin')  : null} />
}

function Splash() {
  return (
    <div style={{minHeight:'100vh',background:'#111a14',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12}}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      </svg>
      <div style={{fontFamily:"'Syne',sans-serif",color:'#8aad94',fontSize:13,letterSpacing:2}}>OROFLY</div>
    </div>
  )
}

function Bloqueado() {
  const { signOut } = useAuth()
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f4f8f5'}}>
      <div style={{textAlign:'center',padding:32}}>
        <div style={{fontSize:40,marginBottom:12}}>⛔</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:600,color:'#111a14'}}>Acesso desativado</div>
        <div style={{color:'#6b8070',marginTop:8,fontSize:14}}>Entre em contato com o administrador.</div>
        <button style={{marginTop:20,background:'#1a7a4a',color:'#fff',border:'none',borderRadius:10,padding:'10px 24px',cursor:'pointer',fontFamily:"'Syne',sans-serif",fontWeight:600}} onClick={signOut}>Sair</button>
      </div>
    </div>
  )
}

export default function App() {
  return <AuthProvider><AppRouter /></AuthProvider>
}

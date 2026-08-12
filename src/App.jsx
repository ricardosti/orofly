import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider } from './lib/theme'
import LoginPage from './pages/LoginPage'
import PilotApp from './pages/PilotApp'
import AdminPanel from './pages/AdminPanel'

function AppRouter() {
  const { user, profile, loading } = useAuth()
  const [mode, setMode] = useState(null)

  // A checagem de sessão (loading) costuma resolver quase instantaneamente com sessão
  // em cache — rápido demais pra dar tempo da animação do drone aparecer de verdade.
  // Garante um tempo mínimo de splash (independente de quanto o loading real demorou),
  // sem prender o piloto se o loading demorar mais que isso.
  const [minSplashDone, setMinSplashDone] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMinSplashDone(true), 1800)
    return () => clearTimeout(t)
  }, [])

  if (loading || !minSplashDone) return <Splash />
  if (!user || !profile) return <LoginPage />
  if (!profile.ativo) return <Bloqueado />

  const isAdmin = profile.role === 'admin'
  const isSupervisor = profile.role === 'supervisor'
  // Supervisor cai no AdminPanel por padrão (que se restringe sozinho a Agenda + Equipes),
  // mas continua sendo piloto — precisa poder alternar pro app de voo igual o admin.
  const canSwitchMode = isAdmin || isSupervisor
  const currentMode = mode || (isAdmin || isSupervisor ? 'admin' : 'piloto')

  return currentMode === 'admin'
    ? <AdminPanel onSwitchMode={canSwitchMode ? () => setMode('piloto') : null} />
    : <PilotApp   onSwitchMode={canSwitchMode ? () => setMode('admin')  : null} />
}

// Tela de carregamento (enquanto a sessão é verificada) — drone parado no centro com as
// hélices girando rápido, "pousando" visualmente no fundo que a tela de Login também usa,
// pra não dar flash de cor quando troca de uma pra outra. Some assim que loading vira false
// (não tem duração fixa: se a sessão carrega rápido, a animação só passa rapidinho).
function Splash() {
  return (
    <div style={{minHeight:'100dvh',height:'100dvh',background:'radial-gradient(circle at 15% 15%, #123d2c 0%, #0b1210 45%, #0b1210 100%)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:18,overflow:'hidden'}}>
      <style>{`
        @keyframes of-hover { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
        @keyframes of-spin { to { transform: rotate(360deg) } }
        @keyframes of-fadeup { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform: translateY(0) } }
        .of-drone { animation: of-hover 1.8s ease-in-out infinite; }
        .of-prop { transform-box: fill-box; transform-origin: center; animation: of-spin .15s linear infinite; }
        .of-word { opacity:0; animation: of-fadeup .6s ease-out .35s forwards; }
        @media (prefers-reduced-motion: reduce) {
          .of-drone { animation: none; }
          .of-prop { animation: none; }
          .of-word { animation: none; opacity:1; }
        }
      `}</style>
      <svg className="of-drone" width="84" height="84" viewBox="0 0 100 100" fill="none">
        {[[22,22],[78,22],[22,78],[78,78]].map(([x,y])=>(
          <g key={`${x}-${y}`}>
            <line x1="50" y1="50" x2={x} y2={y} stroke="#00A86B" strokeWidth="3" strokeLinecap="round"/>
            <g className="of-prop">
              <circle cx={x} cy={y} r="11" stroke="rgba(34,196,118,0.4)" strokeWidth="1.5"/>
              <rect x={x-9} y={y-1} width="18" height="2" rx="1" fill="#8fe6b8"/>
              <rect x={x-1} y={y-9} width="2" height="18" rx="1" fill="#8fe6b8"/>
            </g>
            <circle cx={x} cy={y} r="3" fill="#0b1210"/>
          </g>
        ))}
        <rect x="38" y="40" width="24" height="20" rx="6" fill="#00A86B"/>
        <circle cx="50" cy="63" r="4" fill="#0b1210"/>
      </svg>
      <div className="of-word" style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
        <div style={{fontFamily:"'Syne',sans-serif",color:'#fff',fontSize:20,fontWeight:700,letterSpacing:-.5}}>Orofly<span style={{color:'#ffb020'}}>.</span></div>
        <div style={{fontFamily:"'Syne',sans-serif",color:'#7ba38f',fontSize:10.5,letterSpacing:2,textTransform:'uppercase'}}>Aplicações Aéreas</div>
      </div>
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
  return <ThemeProvider><AuthProvider><AppRouter /></AuthProvider></ThemeProvider>
}

import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../lib/theme'
import { APP_VERSION } from '../lib/version'

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 860)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 860)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

const FEATURES = ['🚁 App do piloto com GPS e fotos', '📋 Relatórios automáticos em PDF', '⚙️ Painel admin em tempo real', '🔔 Alertas e notificações push', '🆘 Botão SOS com localização GPS']

const Logo = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#22c476" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
  </svg>
)

export default function LoginPage() {
  const { theme } = useTheme()
  const { signIn } = useAuth()
  const isMobile = useIsMobile()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    if (!navigator.onLine) {
      setError('📴 Sem conexão. O primeiro login do dia precisa de internet (depois disso o app funciona offline normalmente).')
      setLoading(false)
      return
    }
    const { error } = await signIn(email, password)
    if (error) setError(/network|fetch/i.test(error.message || '') ? '📴 Sem conexão com o servidor. Tente novamente com sinal.' : 'E-mail ou senha incorretos.')
    setLoading(false)
  }

  const Card = (
    <div style={{ background: theme.card, borderRadius: 20, border: `1px solid ${theme.cardBorder2}`, padding: isMobile ? '30px 24px' : '36px 32px', width: '100%', maxWidth: 380, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, color: theme.text, marginBottom: 4 }}>Entrar</div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 26 }}>Pilotos e administradores</div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, letterSpacing: 1, marginBottom: 6, fontFamily: "'Syne',sans-serif" }}>E-MAIL</div>
          <input style={{ width: '100%', border: `1px solid ${theme.inputBorder}`, borderRadius: 10, padding: '12px 14px', fontSize: 15, fontFamily: "'DM Sans',sans-serif", outline: 'none', color: theme.text, background: theme.bg, boxSizing: 'border-box' }} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" required autoFocus />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, letterSpacing: 1, marginBottom: 6, fontFamily: "'Syne',sans-serif" }}>SENHA</div>
          <input style={{ width: '100%', border: `1px solid ${theme.inputBorder}`, borderRadius: 10, padding: '12px 14px', fontSize: 15, fontFamily: "'DM Sans',sans-serif", outline: 'none', color: theme.text, background: theme.bg, boxSizing: 'border-box' }} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
        </div>
        {error && <div style={{ background: theme.dangerBg, color: theme.dangerText, borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{error}</div>}
        <button style={{ background: '#0b1210', color: '#fff', border: 'none', borderRadius: 20, padding: 14, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer', position: 'relative', overflow: 'hidden', opacity: loading ? .7 : 1 }} type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: '#ffb020' }} />
        </button>
      </form>
    </div>
  )

  return (
    <div style={{ minHeight: '100dvh', height: '100dvh', background: 'radial-gradient(circle at 15% 15%, #123d2c 0%, #0b1210 45%, #0b1210 100%)', position:'relative', overflow:'hidden', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{position:'absolute',top:'-15%',right:'-10%',width:420,height:420,borderRadius:'50%',background:'radial-gradient(circle,rgba(34,196,118,0.28),transparent 70%)',filter:'blur(10px)'}}/>
      <div style={{position:'absolute',bottom:'-20%',left:'-10%',width:340,height:340,borderRadius:'50%',background:'radial-gradient(circle,rgba(255,176,32,0.16),transparent 70%)',filter:'blur(10px)'}}/>
      <div style={{ width: '100%', maxWidth: 1000, position:'relative', zIndex:1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 0 : 48, padding: isMobile ? '48px 28px 24px' : '48px' }}>
        <div style={{ flex: isMobile ? '0 0 auto' : '1 1 380px', display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'center' : 'flex-start', textAlign: isMobile ? 'center' : 'left', paddingBottom: isMobile ? 24 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Logo size={isMobile ? 44 : 36} />
            <span style={{ fontFamily: "'Syne',sans-serif", fontSize: isMobile ? 32 : 32, fontWeight: 700, color: '#fff', letterSpacing: -1 }}>Orofly<span style={{ color: '#ffb020' }}>.</span></span>
          </div>
          <div style={{ fontSize: 15, color: '#7ba38f', marginBottom: isMobile ? 28 : 44, lineHeight: 1.6, maxWidth: 360 }}>Sistema de Gestão de Operações de Drone</div>
          {!isMobile && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {FEATURES.map(f => <div key={f} style={{ fontSize: 14, color: '#c8eed8' }}>{f}</div>)}
            </div>
          )}
        </div>

        <div style={{ flex: '0 1 380px', minWidth: 300, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {Card}
          <div style={{ textAlign: 'center', fontSize: 11, color: '#4a6e56', marginTop: 16 }}>v{APP_VERSION}</div>
        </div>
      </div>
    </div>
  )
}

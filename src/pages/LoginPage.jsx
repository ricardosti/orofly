import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 860)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 860)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

const FEATURES = ['🚁 GPS e fotos', '📋 PDF automático', '🔔 Push', '🆘 SOS com GPS']
const CHART_BARS = [38, 62, 45, 80, 55, 70, 48]

const Logo = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
  </svg>
)

const PhoneMockup = () => (
  <div style={{ animation: 'orofly-float2 6s ease-in-out infinite', filter: 'drop-shadow(0 30px 50px rgba(0,0,0,0.45))' }}>
    <div style={{ width: 240, borderRadius: 32, background: '#0c1710', border: '6px solid #1c2b20', padding: '14px 10px', boxSizing: 'border-box' }}>
      <div style={{ background: '#f4f8f5', borderRadius: 18, overflow: 'hidden' }}>
        {/* Status bar do app */}
        <div style={{ background: '#1a7a4a', padding: '10px 14px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Logo size={13} />
            <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: '#fff' }}>Orofly<span style={{ color: '#f0c040' }}>.</span></span>
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>Olá, Piloto 👋</div>
        </div>
        {/* Corpo */}
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0ecea', padding: '7px 9px' }}>
              <div style={{ fontSize: 7, fontWeight: 700, color: '#8aad94' }}>VOOS HOJE</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111a14', fontFamily: "'Syne',sans-serif" }}>3</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0ecea', padding: '7px 9px' }}>
              <div style={{ fontSize: 7, fontWeight: 700, color: '#8aad94' }}>ESTE MÊS</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a7a4a', fontFamily: "'Syne',sans-serif" }}>210<span style={{ fontSize: 8 }}> ha</span></div>
            </div>
          </div>
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0ecea', padding: '9px 9px 6px', display: 'flex', alignItems: 'flex-end', gap: 3, height: 46 }}>
            {CHART_BARS.map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 3, background: i === 3 ? '#f0c040' : '#1a7a4a', opacity: i === 3 ? 1 : 0.55 + i * 0.03 }} />
            ))}
          </div>
          <div style={{ background: '#1a7a4a', borderRadius: 10, padding: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13 }}>🚁</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: "'Syne',sans-serif" }}>Novo Voo</span>
          </div>
        </div>
      </div>
    </div>
  </div>
)

export default function LoginPage() {
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
    <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #d0e4d8', padding: isMobile ? '30px 24px' : '36px 32px', width: '100%', maxWidth: 380, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, color: '#111a14', marginBottom: 4 }}>Entrar</div>
      <div style={{ fontSize: 13, color: '#6b8070', marginBottom: 26 }}>Pilotos e administradores</div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b8070', letterSpacing: 1, marginBottom: 6, fontFamily: "'Syne',sans-serif" }}>E-MAIL</div>
          <input style={{ width: '100%', border: '1px solid #d0e4d8', borderRadius: 10, padding: '12px 14px', fontSize: 15, fontFamily: "'DM Sans',sans-serif", outline: 'none', color: '#111a14', background: '#f4f8f5', boxSizing: 'border-box' }} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" required autoFocus />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b8070', letterSpacing: 1, marginBottom: 6, fontFamily: "'Syne',sans-serif" }}>SENHA</div>
          <input style={{ width: '100%', border: '1px solid #d0e4d8', borderRadius: 10, padding: '12px 14px', fontSize: 15, fontFamily: "'DM Sans',sans-serif", outline: 'none', color: '#111a14', background: '#f4f8f5', boxSizing: 'border-box' }} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
        </div>
        {error && <div style={{ background: '#fef2f2', color: '#c0392b', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{error}</div>}
        <button style={{ background: '#111a14', color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer', position: 'relative', overflow: 'hidden', opacity: loading ? .7 : 1 }} type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: '#f0c040' }} />
        </button>
      </form>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at top,#16261c 0%,#0c130e 60%,#080c09 100%)', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes orofly-float { 0%,100%{ transform:translateY(0px) rotate(-3deg) } 50%{ transform:translateY(-14px) rotate(3deg) } }
        @keyframes orofly-float2 { 0%,100%{ transform:translateY(0px) rotate(2deg) } 50%{ transform:translateY(-16px) rotate(-1deg) } }
        @keyframes orofly-glow { 0%,100%{ opacity:.35 } 50%{ opacity:.65 } }
      `}</style>

      {/* Glow decorativo de fundo */}
      <div style={{ position: 'absolute', top: '-10%', right: '-10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle,#1a7a4a55,transparent 70%)', filter: 'blur(20px)', animation: 'orofly-glow 6s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', bottom: '-15%', left: '-10%', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle,#f0c04033,transparent 70%)', filter: 'blur(20px)', animation: 'orofly-glow 7s ease-in-out infinite 1s' }} />

      {/* Wrapper central — largura máxima fixa, sempre centralizado, mesmo em telas ultra largas */}
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: isMobile ? 0 : 40, padding: isMobile ? '48px 24px 24px' : '40px 48px' }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', gap: 36, flex: '1 1 420px', minWidth: 0, justifyContent: isMobile ? 'center' : 'flex-end', padding: isMobile ? '0 0 24px' : 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'center' : 'flex-start', textAlign: isMobile ? 'center' : 'left', flexShrink: 0 }}>
            <div style={{ animation: 'orofly-float 5s ease-in-out infinite', marginBottom: 18 }}>
              <Logo size={isMobile ? 52 : 40} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontFamily: "'Syne',sans-serif", fontSize: isMobile ? 34 : 32, fontWeight: 700, color: '#fff', letterSpacing: -1 }}>Orofly<span style={{ color: '#f0c040' }}>.</span></span>
            </div>
            <div style={{ fontSize: 15, color: '#8aad94', marginBottom: isMobile ? 24 : 30, lineHeight: 1.6, maxWidth: 300 }}>Sistema de Gestão de Operações de Drone</div>
            {!isMobile && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 300 }}>
                {FEATURES.map(f => (
                  <span key={f} style={{ fontSize: 12, fontWeight: 600, color: '#c8eed8', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '6px 12px' }}>{f}</span>
                ))}
              </div>
            )}
          </div>
          {!isMobile && <div style={{ flexShrink: 0 }}><PhoneMockup /></div>}
        </div>

        <div style={{ flex: '0 1 380px', minWidth: 300, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {Card}
          <div style={{ textAlign: 'center', fontSize: 11, color: '#4a6e56', marginTop: 18 }}>v3.9</div>
        </div>
      </div>
    </div>
  )
}

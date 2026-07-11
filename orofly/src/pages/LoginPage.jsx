import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await signIn(email, password)
    if (error) setError('E-mail ou senha incorretos.')
    setLoading(false)
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',background:'#111a14'}}>
      <div style={{flex:1,padding:'60px 48px',display:'flex',flexDirection:'column',justifyContent:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <span style={{fontFamily:"'Syne',sans-serif",fontSize:32,fontWeight:700,color:'#fff',letterSpacing:-1}}>Orofly<span style={{color:'#f0c040'}}>.</span></span>
        </div>
        <div style={{fontSize:15,color:'#8aad94',marginBottom:48,lineHeight:1.6,maxWidth:380}}>Sistema de Gestão de Operações de Drone</div>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          {['🚁 App do piloto com GPS e fotos','📋 Relatórios automáticos em PDF','⚙️ Painel admin em tempo real','🔔 Alertas e notificações push','🆘 Botão SOS com localização GPS'].map(f=>(
            <div key={f} style={{fontSize:14,color:'#c8eed8'}}>{f}</div>
          ))}
        </div>
      </div>
      <div style={{width:'min(100%,440px)',background:'#f4f8f5',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32}}>
        <div style={{background:'#fff',borderRadius:20,border:'1px solid #d0e4d8',padding:'36px 32px',width:'100%',boxShadow:'0 4px 32px rgba(26,122,74,0.08)'}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:700,color:'#111a14',marginBottom:4}}>Entrar</div>
          <div style={{fontSize:13,color:'#6b8070',marginBottom:28}}>Pilotos e administradores</div>
          <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:16}}>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:'#6b8070',letterSpacing:1,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>E-MAIL</div>
              <input style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:10,padding:'12px 14px',fontSize:15,fontFamily:"'DM Sans',sans-serif",outline:'none',color:'#111a14',background:'#f4f8f5'}} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" required autoFocus />
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:'#6b8070',letterSpacing:1,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>SENHA</div>
              <input style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:10,padding:'12px 14px',fontSize:15,fontFamily:"'DM Sans',sans-serif",outline:'none',color:'#111a14',background:'#f4f8f5'}} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            {error && <div style={{background:'#fef2f2',color:'#c0392b',borderRadius:8,padding:'10px 14px',fontSize:13}}>{error}</div>}
            <button style={{background:'#111a14',color:'#fff',border:'none',borderRadius:12,padding:14,fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:600,cursor:'pointer',position:'relative',overflow:'hidden',opacity:loading?.7:1}} type="submit" disabled={loading}>
              {loading?'Entrando...':'Entrar'}
              <div style={{position:'absolute',bottom:0,left:0,right:0,height:3,background:'#f0c040'}}/>
            </button>
          </form>
        </div>
        <div style={{textAlign:'center',fontSize:11,color:'#8aad94',marginTop:16}}>v3.1</div>
      </div>
    </div>
  )
}

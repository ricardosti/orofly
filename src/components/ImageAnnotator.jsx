import { useRef, useEffect, useState } from 'react'

// Editor de marcação sobre foto (lápis) — modal fullscreen com canvas HTML5. Usado antes de
// salvar a Foto de Observação (Passo 5) e as fotos de Incidentes, pra o piloto poder circular/
// riscar um obstáculo direto na imagem sem precisar de outro app.
const CORES = [
  { nome:'Vermelho', hex:'#e5484d' },
  { nome:'Amarelo', hex:'#f2c94c' },
  { nome:'Verde', hex:'#00A86B' },
  { nome:'Branco', hex:'#ffffff' },
]

// Comprime a imagem final em JPEG, tentando ficar abaixo de ~1MB reduzindo a qualidade em
// passos fixos (evita loop indefinido) — o tamanho em pixels já foi limitado a 1920px no
// lado maior na hora de montar o canvas, então essa etapa só cuida do peso do arquivo.
async function canvasParaBlobComprimido(canvas) {
  const tentativas = [0.85, 0.7, 0.55, 0.4]
  for (const q of tentativas) {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', q))
    if (blob && (blob.size <= 1024*1024 || q === tentativas[tentativas.length-1])) return blob
  }
  return null
}

// `src`: data URL ou URL da foto original. `onSave(blob)`: chamado com o JPEG final (já
// comprimido) quando o piloto confirma. `onCancel()`: fecha sem salvar.
export default function ImageAnnotator({ src, onSave, onCancel }) {
  const canvasRef = useRef(null)
  const ultimoPontoRef = useRef(null)
  const [cor, setCor] = useState(CORES[0].hex)
  const [espessura, setEspessura] = useState('fino')
  const [desenhando, setDesenhando] = useState(false)
  const [historico, setHistorico] = useState([])
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!src) { setErro('Nenhuma foto pra editar.'); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      const MAX_LADO = 1920
      let w = img.width, h = img.height
      if (w > MAX_LADO || h > MAX_LADO) {
        const escala = MAX_LADO / Math.max(w, h)
        w = Math.round(w*escala); h = Math.round(h*escala)
      }
      canvas.width = w; canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)
      setPronto(true)
    }
    img.onerror = () => setErro('Não consegui carregar essa foto pra editar.')
    img.src = src
  }, [src])

  function salvarHistorico() {
    const canvas = canvasRef.current
    if (!canvas) return
    try { setHistorico(h => [...h, canvas.toDataURL('image/png')].slice(-15)) } catch { /* canvas tainted etc — undo só fica indisponível */ }
  }

  function coordDoEvento(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const escalaX = canvas.width / rect.width, escalaY = canvas.height / rect.height
    const ponto = e.touches?.[0] || e
    return { x: (ponto.clientX - rect.left) * escalaX, y: (ponto.clientY - rect.top) * escalaY }
  }

  function iniciarTraco(e) {
    if (!pronto) return
    e.preventDefault()
    salvarHistorico()
    setDesenhando(true)
    ultimoPontoRef.current = coordDoEvento(e)
  }
  function desenhar(e) {
    if (!desenhando) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const p = coordDoEvento(e)
    const ultimo = ultimoPontoRef.current
    if (!ultimo) return
    ctx.strokeStyle = cor
    ctx.lineWidth = espessura==='grosso' ? 10 : 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(ultimo.x, ultimo.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ultimoPontoRef.current = p
  }
  function pararTraco() { setDesenhando(false); ultimoPontoRef.current = null }

  function desfazer() {
    if (historico.length === 0) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const anterior = historico[historico.length-1]
    const img = new Image()
    img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0) }
    img.src = anterior
    setHistorico(h => h.slice(0,-1))
  }

  function limparTudo() {
    if (historico.length===0) return
    if (!window.confirm('Apagar todas as marcações feitas nessa foto?')) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const original = historico[0]
    const img = new Image()
    img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0) }
    img.src = original
    setHistorico([])
  }

  async function confirmar() {
    setSalvando(true)
    try {
      const blob = await canvasParaBlobComprimido(canvasRef.current)
      if (!blob) throw new Error('canvas vazio')
      onSave(blob)
    } catch (e) {
      console.error('[ImageAnnotator] falha ao gerar imagem final:', e)
      window.alert('Não consegui salvar a anotação, tenta de novo.')
    } finally {
      setSalvando(false)
    }
  }

  if (erro) {
    return (
      <div style={{ position:'fixed', inset:0, zIndex:500, background:'#000', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, padding:20 }}>
        <span style={{ color:'#fff', fontSize:14, textAlign:'center' }}>⚠️ {erro}</span>
        <button onClick={onCancel} style={{ background:'#00A86B', color:'#fff', border:'none', borderRadius:12, padding:'10px 20px', fontSize:13, cursor:'pointer' }}>Voltar</button>
      </div>
    )
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:500, background:'#000', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'calc(env(safe-area-inset-top,0px)+10px) 14px 10px', background:'#111' }}>
        <span style={{ color:'#fff', fontSize:14, fontWeight:700, fontFamily:"'Poppins',sans-serif" }}>✏️ Marcar na foto</span>
        <button onClick={onCancel} style={{ background:'rgba(255,255,255,.15)', border:'none', color:'#fff', borderRadius:16, padding:'6px 12px', fontSize:12, cursor:'pointer' }}>Cancelar</button>
      </div>

      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', touchAction:'none' }}>
        {!pronto && <span style={{ color:'#fff', fontSize:13 }}>Carregando...</span>}
        <canvas ref={canvasRef}
          style={{ maxWidth:'100%', maxHeight:'100%', display: pronto?'block':'none', touchAction:'none', cursor:'crosshair' }}
          onMouseDown={iniciarTraco} onMouseMove={desenhar} onMouseUp={pararTraco} onMouseLeave={pararTraco}
          onTouchStart={iniciarTraco} onTouchMove={desenhar} onTouchEnd={pararTraco}/>
      </div>

      <div style={{ background:'#111', padding:'10px 14px calc(env(safe-area-inset-bottom,0px)+10px)', display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          {CORES.map(c => (
            <button key={c.hex} onClick={()=>setCor(c.hex)} title={c.nome}
              style={{ width:30, height:30, borderRadius:'50%', background:c.hex, border: cor===c.hex ? '3px solid #00A86B' : '2px solid rgba(255,255,255,.4)', cursor:'pointer' }}/>
          ))}
          <div style={{ width:1, height:24, background:'rgba(255,255,255,.2)', margin:'0 6px' }}/>
          {[['fino','Fino'],['grosso','Grosso']].map(([v,label]) => (
            <button key={v} onClick={()=>setEspessura(v)} style={{ background: espessura===v?'#00A86B':'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:14, padding:'6px 12px', fontSize:11.5, fontWeight:600, cursor:'pointer' }}>{label}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={desfazer} disabled={historico.length===0} style={{ flex:1, background:'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:600, cursor:historico.length?'pointer':'default', opacity:historico.length?1:.4 }}>↩️ Desfazer</button>
          <button onClick={limparTudo} disabled={historico.length===0} style={{ flex:1, background:'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:600, cursor:historico.length?'pointer':'default', opacity:historico.length?1:.4 }}>🧹 Limpar</button>
          <button onClick={confirmar} disabled={salvando||!pronto} style={{ flex:1.4, background:'#00A86B', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700, cursor:'pointer', opacity:salvando?.7:1 }}>{salvando?'Salvando...':'💾 Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

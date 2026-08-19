import { useRef, useEffect, useState } from 'react'

// Editor de foto — modal fullscreen com canvas HTML5, com dois modos: marcação (lápis, pra
// circular/riscar algo direto na imagem) e corte (recorte livre arrastando os cantos). Usado
// antes de aceitar qualquer foto no fluxo do piloto (Observação e Evidência Climática do Passo
// 5, Foto do Mapa de Pós Aplicação, Incidentes, Notas/Despesas), pra não precisar de outro app.
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

const MIN_CORTE = 40 // px CSS — tamanho mínimo da área de corte, evita colapsar pra zero

// `src`: data URL ou URL da foto original. `onSave(blob)`: chamado com o JPEG final (já
// comprimido) quando o piloto confirma. `onCancel()`: fecha sem salvar.
export default function ImageAnnotator({ src, onSave, onCancel }) {
  const canvasRef = useRef(null)
  const ultimoPontoRef = useRef(null)
  const cropDragRef = useRef(null)
  const [modo, setModo] = useState('desenho') // 'desenho' | 'corte'
  const [cor, setCor] = useState(CORES[0].hex)
  const [espessura, setEspessura] = useState('fino')
  const [desenhando, setDesenhando] = useState(false)
  const [historico, setHistorico] = useState([])
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [crop, setCrop] = useState(null) // {x,y,w,h} em px CSS, relativo ao box do canvas
  const [cropDragging, setCropDragging] = useState(false)

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

  // Redesenha o canvas a partir de um dataURL do histórico, sempre ajustando as dimensões
  // do canvas pro tamanho intrínseco daquela imagem — necessário pra desfazer corretamente
  // mesmo depois de um corte (que muda o tamanho do canvas).
  function restaurarDataUrl(dataUrl, aoTerminar) {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      canvas.width = img.width; canvas.height = img.height
      ctx.clearRect(0,0,canvas.width,canvas.height)
      ctx.drawImage(img,0,0)
      aoTerminar?.()
    }
    img.src = dataUrl
  }

  function coordDoEvento(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const escalaX = canvas.width / rect.width, escalaY = canvas.height / rect.height
    const ponto = e.touches?.[0] || e
    return { x: (ponto.clientX - rect.left) * escalaX, y: (ponto.clientY - rect.top) * escalaY }
  }

  function iniciarTraco(e) {
    if (!pronto || modo!=='desenho') return
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
    restaurarDataUrl(historico[historico.length-1])
    setHistorico(h => h.slice(0,-1))
  }

  function limparTudo() {
    if (historico.length===0) return
    if (!window.confirm('Apagar todas as marcações e cortes feitos nessa foto?')) return
    restaurarDataUrl(historico[0])
    setHistorico([])
  }

  // ── Corte ──
  function iniciarModoCorte() {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = rect.width*0.1, my = rect.height*0.1
    setCrop({ x:mx, y:my, w:rect.width-mx*2, h:rect.height-my*2 })
    setModo('corte')
  }
  function cancelarCorte() { setCrop(null); setModo('desenho') }

  function pontoCliente(e) {
    const p = e.touches?.[0] || e
    return { x:p.clientX, y:p.clientY }
  }
  function iniciarCropDrag(tipo, e) {
    e.preventDefault(); e.stopPropagation()
    const p = pontoCliente(e)
    cropDragRef.current = { tipo, startX:p.x, startY:p.y, startCrop:{...crop} }
    setCropDragging(true)
  }
  useEffect(() => {
    if (!cropDragging) return
    function mover(e) {
      const info = cropDragRef.current
      const canvas = canvasRef.current
      if (!info || !canvas) return
      if (e.cancelable) e.preventDefault()
      const p = pontoCliente(e)
      const dx = p.x - info.startX, dy = p.y - info.startY
      const rect = canvas.getBoundingClientRect()
      const sc = info.startCrop
      let { x, y, w, h } = sc
      if (info.tipo === 'mover') {
        x = Math.max(0, Math.min(sc.x+dx, rect.width - sc.w))
        y = Math.max(0, Math.min(sc.y+dy, rect.height - sc.h))
      } else {
        if (info.tipo.includes('e')) w = Math.max(MIN_CORTE, Math.min(sc.w+dx, rect.width - sc.x))
        if (info.tipo.includes('s')) h = Math.max(MIN_CORTE, Math.min(sc.h+dy, rect.height - sc.y))
        if (info.tipo.includes('w')) {
          const clampedDx = Math.min(Math.max(dx, -sc.x), sc.w - MIN_CORTE)
          x = sc.x + clampedDx; w = sc.w - clampedDx
        }
        if (info.tipo.includes('n')) {
          const clampedDy = Math.min(Math.max(dy, -sc.y), sc.h - MIN_CORTE)
          y = sc.y + clampedDy; h = sc.h - clampedDy
        }
      }
      setCrop({ x, y, w, h })
    }
    function soltar() { cropDragRef.current = null; setCropDragging(false) }
    window.addEventListener('mousemove', mover)
    window.addEventListener('mouseup', soltar)
    window.addEventListener('touchmove', mover, { passive:false })
    window.addEventListener('touchend', soltar)
    return () => {
      window.removeEventListener('mousemove', mover)
      window.removeEventListener('mouseup', soltar)
      window.removeEventListener('touchmove', mover)
      window.removeEventListener('touchend', soltar)
    }
  }, [cropDragging])

  function aplicarCorte() {
    const canvas = canvasRef.current
    if (!canvas || !crop) return
    const rect = canvas.getBoundingClientRect()
    const escalaX = canvas.width / rect.width, escalaY = canvas.height / rect.height
    const sx = Math.round(crop.x*escalaX), sy = Math.round(crop.y*escalaY)
    const sw = Math.round(crop.w*escalaX), sh = Math.round(crop.h*escalaY)
    if (sw < 5 || sh < 5) return
    salvarHistorico()
    const temp = document.createElement('canvas')
    temp.width = sw; temp.height = sh
    temp.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    canvas.width = sw; canvas.height = sh
    canvas.getContext('2d').drawImage(temp, 0, 0)
    setCrop(null)
    setModo('desenho')
  }

  async function confirmar() {
    setSalvando(true)
    try {
      const blob = await canvasParaBlobComprimido(canvasRef.current)
      if (!blob) throw new Error('canvas vazio')
      onSave(blob)
    } catch (e) {
      console.error('[ImageAnnotator] falha ao gerar imagem final:', e)
      window.alert('Não consegui salvar a edição, tenta de novo.')
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

  const HANDLES = crop ? [['nw',crop.x,crop.y],['ne',crop.x+crop.w,crop.y],['sw',crop.x,crop.y+crop.h],['se',crop.x+crop.w,crop.y+crop.h]] : []

  return (
    <div style={{ position:'fixed', inset:0, zIndex:500, background:'#000', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'calc(env(safe-area-inset-top,0px)+10px) 14px 10px', background:'#111' }}>
        <span style={{ color:'#fff', fontSize:14, fontWeight:700, fontFamily:"'Poppins',sans-serif" }}>✏️ Editar foto</span>
        <button onClick={onCancel} style={{ background:'rgba(255,255,255,.15)', border:'none', color:'#fff', borderRadius:16, padding:'6px 12px', fontSize:12, cursor:'pointer' }}>Cancelar</button>
      </div>

      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', touchAction:'none' }}>
        {!pronto && <span style={{ color:'#fff', fontSize:13 }}>Carregando...</span>}
        <div style={{ position:'relative', display: pronto?'inline-block':'none', maxWidth:'100%', maxHeight:'100%' }}>
          <canvas ref={canvasRef}
            style={{ maxWidth:'100%', maxHeight:'100%', display:'block', touchAction:'none', cursor: modo==='desenho'?'crosshair':'default' }}
            onMouseDown={iniciarTraco} onMouseMove={desenhar} onMouseUp={pararTraco} onMouseLeave={pararTraco}
            onTouchStart={iniciarTraco} onTouchMove={desenhar} onTouchEnd={pararTraco}/>

          {modo==='corte' && crop && (
            <div style={{ position:'absolute', inset:0 }}>
              <div style={{ position:'absolute', left:0, top:0, right:0, height:crop.y, background:'rgba(0,0,0,.55)' }}/>
              <div style={{ position:'absolute', left:0, top:crop.y+crop.h, right:0, bottom:0, background:'rgba(0,0,0,.55)' }}/>
              <div style={{ position:'absolute', left:0, top:crop.y, width:crop.x, height:crop.h, background:'rgba(0,0,0,.55)' }}/>
              <div style={{ position:'absolute', left:crop.x+crop.w, top:crop.y, right:0, height:crop.h, background:'rgba(0,0,0,.55)' }}/>
              <div onMouseDown={e=>iniciarCropDrag('mover',e)} onTouchStart={e=>iniciarCropDrag('mover',e)}
                style={{ position:'absolute', left:crop.x, top:crop.y, width:crop.w, height:crop.h, border:'2px dashed #fff', cursor:'move', touchAction:'none' }}/>
              {HANDLES.map(([tipo,hx,hy]) => (
                <div key={tipo} onMouseDown={e=>iniciarCropDrag(tipo,e)} onTouchStart={e=>iniciarCropDrag(tipo,e)}
                  style={{ position:'absolute', left:hx-12, top:hy-12, width:24, height:24, borderRadius:'50%', background:'#00A86B', border:'3px solid #fff', touchAction:'none', cursor:`${tipo}-resize`, boxShadow:'0 2px 6px rgba(0,0,0,.4)' }}/>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ background:'#111', padding:'10px 14px calc(env(safe-area-inset-bottom,0px)+10px)', display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
          <button onClick={cancelarCorte} disabled={modo==='desenho'}
            style={{ flex:1, maxWidth:160, background: modo==='desenho'?'#00A86B':'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:14, padding:'9px 12px', fontSize:12.5, fontWeight:600, cursor:'pointer' }}>
            ✏️ Desenhar
          </button>
          <button onClick={iniciarModoCorte} disabled={modo==='corte'}
            style={{ flex:1, maxWidth:160, background: modo==='corte'?'#00A86B':'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:14, padding:'9px 12px', fontSize:12.5, fontWeight:600, cursor:'pointer' }}>
            ✂️ Cortar
          </button>
        </div>

        {modo==='desenho' ? (
          <>
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
          </>
        ) : (
          <>
            <div style={{ fontSize:11.5, color:'rgba(255,255,255,.7)', textAlign:'center' }}>Arraste os cantos verdes pra ajustar a área, ou arraste o meio pra mover</div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={cancelarCorte} style={{ flex:1, background:'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:600, cursor:'pointer' }}>✕ Cancelar corte</button>
              <button onClick={aplicarCorte} style={{ flex:1.4, background:'#00A86B', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700, cursor:'pointer' }}>✂️ Aplicar corte</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

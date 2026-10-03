import { useRef, useEffect, useState } from 'react'
import { hslParaHex, matizDaCor, CORES_ATALHO, GRADIENTE_MATIZ } from '../lib/cores'

// Editor de foto — modal fullscreen com canvas HTML5, com dois modos: marcação (lápis, pra
// circular/riscar algo direto na imagem) e corte (recorte livre arrastando os cantos). Usado
// antes de aceitar qualquer foto no fluxo do piloto (Observação e Evidência Climática do Passo
// 5, Foto do Mapa de Pós Aplicação, Incidentes, Notas/Despesas), pra não precisar de outro app.

// Comprime a imagem final em JPEG, tentando ficar abaixo do ALVO reduzindo a qualidade em
// passos fixos (evita loop indefinido) — o tamanho em pixels já foi limitado na hora de montar
// o canvas, então essa etapa só cuida do peso do arquivo.
const ALVO_BYTES = 400 * 1024
async function canvasParaBlobComprimido(canvas) {
  const tentativas = [0.85, 0.7, 0.55, 0.4]
  for (const q of tentativas) {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', q))
    if (blob && (blob.size <= ALVO_BYTES || q === tentativas[tentativas.length-1])) return blob
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
  const [cor, setCor] = useState(CORES_ATALHO[0])
  // Espessura contínua, em passos de 0,1% do maior lado da foto. Eram 3 degraus fixos
  // (Fino/Médio/Grosso). O teto vai até 100 (= 10% do lado maior, ~128 px numa foto de
  // 1280) porque o uso não é só riscar: o Pastor PINTA area no mapa fotografado, e com
  // pincel fino isso viraria dezenas de passadas.
  const [espessura, setEspessura] = useState(12)
  // Fracao do maior lado da imagem, nao pixel fixo: a foto pode chegar com 1280 px
  // ou com 700, e o traco de 4 px que era discreto numa ficava grosso na outra.
  // Assim a marcacao sai com a mesma espessura relativa sempre.
  const fatorEspessura = espessura * 0.001
  const [desenhando, setDesenhando] = useState(false)
  const [historico, setHistorico] = useState([])
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [crop, setCrop] = useState(null) // {x,y,w,h} em px CSS, relativo ao box do canvas
  // Corte livre (laço): o contorno que o dedo desenhou, em px DO CANVAS (não CSS), porque
  // é nessas coordenadas que o recorte acontece. O retangular continua existindo — cada um
  // serve pra uma coisa: retângulo pra enquadrar, laço pra recortar um talhão torto.
  const [tipoCorte, setTipoCorte] = useState('retangulo') // 'retangulo' | 'livre'
  const [laco, setLaco] = useState([])
  // Tamanho atual do canvas, espelhado em estado: o overlay do laço precisa dele no render,
  // e o canvas muda de tamanho a cada corte.
  const [dimCanvas, setDimCanvas] = useState({ w:0, h:0 })
  const [cropDragging, setCropDragging] = useState(false)
  // Altura livre pra imagem, medida de verdade.
  //
  // `max-height:100%` no canvas não resolve: percentual só vale quando o pai tem altura
  // DEFINIDA, e o wrapper se ajusta ao conteúdo (altura automática) — o navegador então
  // trata como `none`. Resultado medido: a área tinha 723 px e o canvas ficava com 1070,
  // estourando e cortando o rodapé da nota, exatamente onde fica o QR Code.
  // Medir e aplicar em pixel resolve, e o ResizeObserver mantém certo quando a tela gira
  // ou a barra de ferramentas muda de tamanho.
  const areaRef = useRef(null)
  const [alturaLivre, setAlturaLivre] = useState(0)
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const medir = () => setAlturaLivre(el.clientHeight)
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pronto])

  useEffect(() => {
    if (!src) { setErro('Nenhuma foto pra editar.'); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      // 1280px no lado maior. No PDF a foto sai com 70–128mm de largura; a 200 dpi isso dá
      // ~1000px, então 1280 ainda sobra. Os 1920 anteriores guardavam detalhe que nunca
      // chegava ao papel e pagavam banda por ele em toda visualização.
      const MAX_LADO = 1280
      let w = img.width, h = img.height
      if (w > MAX_LADO || h > MAX_LADO) {
        const escala = MAX_LADO / Math.max(w, h)
        w = Math.round(w*escala); h = Math.round(h*escala)
      }
      canvas.width = w; canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)
      setDimCanvas({ w, h })
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
      setDimCanvas({ w: img.width, h: img.height })
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
    if (!pronto) return
    if (modo==='corte' && tipoCorte==='livre') {
      e.preventDefault()
      setDesenhando(true)
      setLaco([coordDoEvento(e)])
      return
    }
    if (modo!=='desenho') return
    e.preventDefault()
    salvarHistorico()
    setDesenhando(true)
    ultimoPontoRef.current = coordDoEvento(e)
  }
  function desenhar(e) {
    if (!desenhando) return
    e.preventDefault()
    if (modo==='corte' && tipoCorte==='livre') {
      const p = coordDoEvento(e)
      setLaco(l => {
        // Descarta micro-movimento: um dedo parado viraria centenas de pontos iguais.
        const u = l[l.length-1]
        if (u && Math.hypot(p.x-u.x, p.y-u.y) < 2) return l
        return [...l, p]
      })
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const p = coordDoEvento(e)
    const ultimo = ultimoPontoRef.current
    if (!ultimo) return
    ctx.strokeStyle = cor
    // Minimo de 3 px pra nunca sumir numa imagem pequena.
    ctx.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) * fatorEspessura))
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
  function retanguloPadrao() {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const mx = rect.width*0.1, my = rect.height*0.1
    return { x:mx, y:my, w:rect.width-mx*2, h:rect.height-my*2 }
  }
  function iniciarModoCorte() {
    if (!canvasRef.current) return
    setLaco([])
    setCrop(tipoCorte==='livre' ? null : retanguloPadrao())
    setModo('corte')
  }
  function escolherTipoCorte(tipo) {
    setTipoCorte(tipo)
    setLaco([])
    setCrop(tipo==='livre' ? null : retanguloPadrao())
  }
  function cancelarCorte() { setCrop(null); setLaco([]); setModo('desenho') }

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
    setDimCanvas({ w: sw, h: sh })
    setCrop(null)
    setModo('desenho')
  }

  // Recorta pelo contorno do laço: corta no retângulo que envolve o desenho e, dentro
  // dele, deixa passar só o que está dentro do traço.
  function aplicarCorteLivre() {
    const canvas = canvasRef.current
    if (!canvas || laco.length < 3) return
    const xs = laco.map(p=>p.x), ys = laco.map(p=>p.y)
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)))
    const x1 = Math.min(canvas.width, Math.ceil(Math.max(...xs))), y1 = Math.min(canvas.height, Math.ceil(Math.max(...ys)))
    const w = x1-x0, h = y1-y0
    if (w < 5 || h < 5) return
    salvarHistorico()
    const temp = document.createElement('canvas')
    temp.width = w; temp.height = h
    const tctx = temp.getContext('2d')
    // O que sobra fora do contorno fica BRANCO, não transparente: transparência obrigaria
    // a salvar em PNG, que pesa bem mais que o JPEG — e peso de imagem foi exatamente o
    // que estourou a cota do Supabase em agosto.
    tctx.fillStyle = '#ffffff'
    tctx.fillRect(0, 0, w, h)
    tctx.save()
    tctx.beginPath()
    tctx.moveTo(laco[0].x-x0, laco[0].y-y0)
    laco.slice(1).forEach(p => tctx.lineTo(p.x-x0, p.y-y0))
    tctx.closePath()
    tctx.clip()
    tctx.drawImage(canvas, -x0, -y0)
    tctx.restore()
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(temp, 0, 0)
    setDimCanvas({ w, h })
    setLaco([])
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

      {/* minHeight:0 é o que faz a imagem CABER em vez de ser cortada. Sem ele, um item
          flex não encolhe abaixo do próprio conteúdo: o canvas de uma nota fiscal (alta e
          estreita) ficava no tamanho natural, estourava a área e o overflow cortava o
          rodapé — justamente onde fica o QR Code. */}
      <div ref={areaRef} style={{ flex:1, minHeight:0, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', touchAction:'none', padding:6 }}>
        {!pronto && <span style={{ color:'#fff', fontSize:13 }}>Carregando...</span>}
        {/* alignItems/justifyContent no centro: como flex, este wrapper esticava o canvas
            na altura (align-self padrão é stretch) e a nota saía achatada — proporção 1.18
            onde o papel tinha 1.78. Centralizado, o canvas mantém a forma. */}
        <div style={{ position:'relative', display: pronto?'flex':'none', alignItems:'center', justifyContent:'center',
          maxWidth:'100%', maxHeight:'100%', minHeight:0, minWidth:0 }}>
          <canvas ref={canvasRef}
            // minWidth/minHeight 0: como filho de um flex, o canvas nasce com
            // `min-height:auto`, que o proíbe de encolher abaixo do tamanho natural — e aí
            // o max-height nunca chegava a valer. Medido: o wrapper respeitava o limite
            // (711 px) e o canvas insistia em 1070, estourando e cortando o rodapé da nota,
            // bem onde fica o QR Code.
            style={{ maxWidth:'100%', maxHeight: alturaLivre ? `${alturaLivre - 12}px` : '100%',
              minWidth:0, minHeight:0, width:'auto', height:'auto', display:'block', touchAction:'none',
              cursor: (modo==='desenho'||(modo==='corte'&&tipoCorte==='livre'))?'crosshair':'default' }}
            onMouseDown={iniciarTraco} onMouseMove={desenhar} onMouseUp={pararTraco} onMouseLeave={pararTraco}
            onTouchStart={iniciarTraco} onTouchMove={desenhar} onTouchEnd={pararTraco}/>

          {/* Contorno do laço. O <path> com fillRule evenodd escurece tudo MENOS o que
              está dentro do traço — mesma leitura visual do corte retangular. */}
          {modo==='corte' && tipoCorte==='livre' && dimCanvas.w>0 && (
            <svg viewBox={`0 0 ${dimCanvas.w} ${dimCanvas.h}`} preserveAspectRatio="none"
              style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}>
              {laco.length>2 && (
                <path fillRule="evenodd" fill="rgba(0,0,0,.55)"
                  d={`M0,0 H${dimCanvas.w} V${dimCanvas.h} H0 Z M${laco[0].x},${laco[0].y} ${laco.slice(1).map(p=>`L${p.x},${p.y}`).join(' ')} Z`}/>
              )}
              {laco.length>1 && (
                <polyline points={laco.map(p=>`${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="#00A86B" strokeWidth={Math.max(2, dimCanvas.w*0.005)}
                  strokeLinecap="round" strokeLinejoin="round"/>
              )}
              {/* Tracejado ligando o fim ao começo: mostra que o contorno fecha sozinho. */}
              {laco.length>2 && (
                <line x1={laco[laco.length-1].x} y1={laco[laco.length-1].y} x2={laco[0].x} y2={laco[0].y}
                  stroke="#00A86B" strokeWidth={Math.max(2, dimCanvas.w*0.004)}
                  strokeDasharray={`${dimCanvas.w*0.012} ${dimCanvas.w*0.01}`} strokeLinecap="round"/>
              )}
            </svg>
          )}

          {modo==='corte' && tipoCorte==='retangulo' && crop && (
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
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              {CORES_ATALHO.map(c => (
                <button key={c} onClick={()=>setCor(c)} title={c}
                  style={{ width:26, height:26, borderRadius:'50%', background:c, flexShrink:0, cursor:'pointer',
                    border: cor===c ? '3px solid #00A86B' : '2px solid rgba(255,255,255,.4)' }}/>
              ))}
              {/* O gradiente é o próprio controle: arrastar nele escolhe o matiz. */}
              <input type="range" min={0} max={359} value={matizDaCor(cor)}
                onChange={e=>setCor(hslParaHex(Number(e.target.value)))}
                style={{ flex:1, minWidth:0, height:26, margin:0, cursor:'pointer', appearance:'none', WebkitAppearance:'none',
                  borderRadius:13, border:'2px solid rgba(255,255,255,.4)', background:GRADIENTE_MATIZ }}/>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {/* A bolinha mostra o tamanho real, mas trava em 34 px: acima disso o pincel
                  não cabe na barra e empurraria o slider pra fora da tela. O número ao lado
                  continua dizendo o valor de verdade. */}
              <div style={{ width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <div style={{ width:Math.min(34,Math.max(2,espessura)), height:Math.min(34,Math.max(2,espessura)), borderRadius:'50%', background:cor,
                  border: cor==='#ffffff' ? '1px solid rgba(0,0,0,.3)' : 'none' }}/>
              </div>
              <input type="range" min={1} max={100} value={espessura}
                onChange={e=>setEspessura(Number(e.target.value))}
                style={{ flex:1, accentColor:'#00A86B', cursor:'pointer' }}/>
              <span style={{ fontSize:11, color:'rgba(255,255,255,.65)', width:34, textAlign:'right', flexShrink:0 }}>{espessura}</span>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={desfazer} disabled={historico.length===0} style={{ flex:1, background:'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:600, cursor:historico.length?'pointer':'default', opacity:historico.length?1:.4 }}>↩️ Desfazer</button>
              <button onClick={limparTudo} disabled={historico.length===0} style={{ flex:1, background:'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:600, cursor:historico.length?'pointer':'default', opacity:historico.length?1:.4 }}>🧹 Limpar</button>
              <button onClick={confirmar} disabled={salvando||!pronto} style={{ flex:1.4, background:'#00A86B', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700, cursor:'pointer', opacity:salvando?.7:1 }}>{salvando?'Salvando...':'💾 Salvar'}</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display:'flex', gap:8 }}>
              {[['retangulo','▭ Retângulo'],['livre','✏️ Livre']].map(([t,label]) => (
                <button key={t} onClick={()=>escolherTipoCorte(t)}
                  style={{ flex:1, background: tipoCorte===t?'#00A86B':'rgba(255,255,255,.15)', color:'#fff', border:'none',
                    borderRadius:12, padding:'9px', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>{label}</button>
              ))}
            </div>
            <div style={{ fontSize:11.5, color:'rgba(255,255,255,.7)', textAlign:'center' }}>
              {tipoCorte==='livre'
                ? (laco.length>2 ? 'Solte pra fechar o contorno. Pra refazer, é só desenhar de novo.'
                   : 'Contorne com o dedo a parte que você quer manter — o contorno fecha sozinho')
                : 'Arraste os cantos verdes pra ajustar a área, ou arraste o meio pra mover'}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={cancelarCorte} style={{ flex:1, background:'rgba(255,255,255,.15)', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:600, cursor:'pointer' }}>✕ Cancelar corte</button>
              {tipoCorte==='livre' ? (
                <button onClick={aplicarCorteLivre} disabled={laco.length<3}
                  style={{ flex:1.4, background:'#00A86B', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700, cursor:'pointer', opacity: laco.length<3?.4:1 }}>✂️ Aplicar corte</button>
              ) : (
                <button onClick={aplicarCorte} style={{ flex:1.4, background:'#00A86B', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700, cursor:'pointer' }}>✂️ Aplicar corte</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

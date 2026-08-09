import { useState, useEffect, useRef } from 'react'
import { renderPdfPageToCanvas, latLngParaPixel, distanciaKm, lerMapaCache, salvarMapaCache } from '../lib/geopdf'
import { compartilharNativo } from '../lib/nativeShare'

// Mapa georreferenciado da fazenda (estilo Avenza) — renderiza o PDF cadastrado e sobrepõe
// a posição de GPS ao vivo do usuário, convertida via os 4 cantos (lat/lng) cadastrados.
// Usado tanto no Admin (conferir o cadastro) quanto no app do piloto (durante o voo).
export default function MapaFazendaViewer({ supabase, fazenda, onClose }) {
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const mapBoxRef = useRef(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [tamCanvas, setTamCanvas] = useState({ width: 0, height: 0 })
  const [pos, setPos] = useState(null) // { lat, lng, accuracy }
  const [enviando, setEnviando] = useState(false)
  // Depois que o piloto envia um PDF novo, a fazenda que veio por props ainda não reflete
  // isso (o admin que carregou a lista não sabe do upload) — guarda local pra já mostrar
  // o mapa sem precisar fechar/reabrir a tela.
  const [pathOverride, setPathOverride] = useState(null)
  // Log visível na própria tela — pra diagnosticar em campo sem precisar de cabo USB/
  // debug remoto. Cada linha tem hora + mensagem; fica num painel copiável no rodapé.
  const [logs, setLogs] = useState([])
  const log = (msg) => setLogs(l => [...l, `${new Date().toLocaleTimeString('pt-BR')}  ${msg}`])

  const mapaPdfPath = pathOverride || fazenda?.mapa_pdf_path
  const temMapa = !!mapaPdfPath
  const temBounds = fazenda?.mapa_lat_min != null && fazenda?.mapa_lat_max != null && fazenda?.mapa_lng_min != null && fazenda?.mapa_lng_max != null

  async function handleEscolherArquivo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    log(`arquivo selecionado: ${file ? `${file.name} (${(file.size/1024).toFixed(0)}KB, ${file.type||'sem tipo'})` : 'NENHUM (picker cancelado ou não retornou arquivo)'}`)
    if (!file || !fazenda?.id) return
    setEnviando(true)
    setErro('')
    // Timeout manual — em vez de ficar preso em "Enviando..." pra sempre se a rede cair
    // ou a leitura do arquivo (URI content:// do Android) travar sem erro nem sucesso.
    const comTimeout = (promessa, ms, msg) => Promise.race([
      promessa,
      new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
    ])
    try {
      log('lendo bytes do arquivo...')
      // Lê os bytes explicitamente antes de enviar — o objeto File vindo de um picker
      // content:// do Android às vezes trava se passado direto pro fetch/upload.
      const buf = await comTimeout(file.arrayBuffer(), 15000, 'Não consegui ler o arquivo selecionado (tempo esgotado).')
      const blob = new Blob([buf], { type: 'application/pdf' })
      log(`arquivo lido (${(blob.size/1024).toFixed(0)}KB), enviando pro Storage...`)
      const path = `mapas/${fazenda.id}/mapa.pdf`
      const { error: upErr } = await comTimeout(
        supabase.storage.from('relatorios').upload(path, blob, { upsert: true, contentType: 'application/pdf' }),
        20000, 'Envio do arquivo demorou demais (rede lenta ou instável).'
      )
      if (upErr) { log(`ERRO no upload: ${upErr.message||JSON.stringify(upErr)}`); throw upErr }
      log('upload OK, atualizando cadastro da fazenda...')
      const { error: dbErr } = await comTimeout(
        supabase.from('fazendas').update({ mapa_pdf_path: path }).eq('id', fazenda.id),
        10000, 'Salvou o arquivo mas demorou pra atualizar o cadastro da fazenda.'
      )
      if (dbErr) { log(`ERRO ao atualizar fazenda: ${dbErr.message||JSON.stringify(dbErr)}`); throw dbErr }
      log('cadastro atualizado, renderizando PDF...')
      setCarregando(true)
      const { width, height } = await renderPdfPageToCanvas(blob, canvasRef.current, 1000)
      setTamCanvas({ width, height })
      salvarMapaCache(fazenda.id, blob)
      setPathOverride(path)
      log('concluído com sucesso ✅')
    } catch (e2) {
      log(`FALHOU: ${e2?.message || String(e2)}`)
      setErro('Não consegui enviar o mapa: ' + (e2?.message || 'confira sua conexão e tente de novo.'))
    } finally {
      setEnviando(false)
      setCarregando(false)
    }
  }

  // Pra onde apontar o "Abrir no Maps": usa o ponto cadastrado na fazenda se tiver, senão
  // cai pro centro do próprio mapa georreferenciado — assim funciona mesmo se o admin só
  // preencheu os 4 cantos do mapa e não o lat/lng "simples" da fazenda.
  const destino = (fazenda?.lat && fazenda?.lng)
    ? { lat: fazenda.lat, lng: fazenda.lng }
    : temBounds
      ? { lat: (fazenda.mapa_lat_min + fazenda.mapa_lat_max) / 2, lng: (fazenda.mapa_lng_min + fazenda.mapa_lng_max) / 2 }
      : null

  // Abre do cache local primeiro (rápido e funciona sem sinal em campo) e, em paralelo,
  // tenta buscar a versão mais nova do servidor — se conseguir, atualiza o cache pra
  // próxima vez. Só mostra erro se não tinha cache E não conseguiu baixar (sem sinal na
  // primeira vez que abre esse mapa nesse aparelho).
  useEffect(() => {
    if (!temMapa) { setCarregando(false); return }
    log(`abrindo mapa: path=${mapaPdfPath}`)
    let cancelado = false
    ;(async () => {
      let mostrouCache = false
      const cache = await lerMapaCache(fazenda.id)
      log(`cache local: ${cache ? 'encontrado' : 'não tem'}`)
      if (cache && !cancelado) {
        try {
          const { width, height } = await renderPdfPageToCanvas(cache, canvasRef.current, 1000)
          if (!cancelado) { setTamCanvas({ width, height }); setCarregando(false); mostrouCache = true; log('renderizado do cache ✅') }
        } catch (eCache) { log(`falhou renderizar cache: ${eCache?.message||eCache}`) }
      }
      try {
        log('baixando do servidor...')
        const { data, error } = await supabase.storage.from('relatorios').download(mapaPdfPath)
        if (error) throw error
        if (cancelado) return
        log(`baixado (${(data.size/1024).toFixed(0)}KB)`)
        if (!mostrouCache) {
          const { width, height } = await renderPdfPageToCanvas(data, canvasRef.current, 1000)
          if (cancelado) return
          setTamCanvas({ width, height })
          log('renderizado do servidor ✅')
        }
        salvarMapaCache(fazenda.id, data)
      } catch (e) {
        log(`erro ao baixar/renderizar: ${e?.message||e}`)
        if (!mostrouCache && !cancelado) setErro('Não consegui abrir o mapa dessa fazenda. Confira sua conexão e tente de novo.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    })()
    return () => { cancelado = true }
  }, [supabase, fazenda?.id, mapaPdfPath, temMapa])

  // Segue o GPS sempre que der pra comparar com algum destino — mesmo longe da fazenda,
  // isso já mostra distância e o link do Maps, útil pra quem tá testando ou se deslocando.
  useEffect(() => {
    if (!destino || !navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      p => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [destino?.lat, destino?.lng])

  const bounds = temBounds ? { latMin: fazenda.mapa_lat_min, latMax: fazenda.mapa_lat_max, lngMin: fazenda.mapa_lng_min, lngMax: fazenda.mapa_lng_max } : null
  const pinPx = pos && bounds && tamCanvas.width ? latLngParaPixel(pos.lat, pos.lng, bounds, tamCanvas.width, tamCanvas.height) : null
  const distKm = pos && destino ? distanciaKm(pos.lat, pos.lng, destino.lat, destino.lng) : null
  const longe = distKm != null && distKm > 5 // mais de 5km: nem faz sentido falar de "dentro/fora do talhão", é caso de navegação mesmo

  // Pinch-to-zoom + arrastar no mapa (estilo Avenza) — zoom entre 1x e 6x, arrastar livre
  // dentro desse zoom, e duplo toque/clique reseta pra visão inteira.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const gestoRef = useRef({ modo: null, x0: 0, y0: 0, panX0: 0, panY0: 0, dist0: 0, zoom0: 1 })
  const ZOOM_MIN = 1, ZOOM_MAX = 6

  function limitarPan(z, p) {
    const box = mapBoxRef.current
    if (!box) return p
    const r = box.getBoundingClientRect()
    const maxX = (r.width * (z - 1)) / 2
    const maxY = (r.height * (z - 1)) / 2
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) }
  }
  function resetZoom() { setZoom(1); setPan({ x: 0, y: 0 }) }
  function distEntreToques(touches) {
    const [a, b] = touches
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  function onMapaTouchStart(e) {
    if (e.touches.length === 2) {
      gestoRef.current = { modo: 'pinch', dist0: distEntreToques(e.touches), zoom0: zoom, panX0: pan.x, panY0: pan.y }
    } else if (e.touches.length === 1) {
      gestoRef.current = { modo: 'pan', x0: e.touches[0].clientX, y0: e.touches[0].clientY, panX0: pan.x, panY0: pan.y }
    }
  }
  function onMapaTouchMove(e) {
    const g = gestoRef.current
    if (g.modo === 'pinch' && e.touches.length === 2) {
      e.preventDefault()
      const novoZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, g.zoom0 * (distEntreToques(e.touches) / g.dist0)))
      setZoom(novoZoom)
      setPan(limitarPan(novoZoom, { x: g.panX0, y: g.panY0 }))
    } else if (g.modo === 'pan' && e.touches.length === 1) {
      if (zoom > 1) e.preventDefault()
      const dx = e.touches[0].clientX - g.x0, dy = e.touches[0].clientY - g.y0
      setPan(limitarPan(zoom, { x: g.panX0 + dx, y: g.panY0 + dy }))
    }
  }
  function onMapaTouchEnd() { gestoRef.current = { modo: null } }
  function onMapaWheel(e) {
    e.preventDefault()
    const novoZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * (e.deltaY < 0 ? 1.15 : 0.87)))
    setZoom(novoZoom)
    setPan(p => limitarPan(novoZoom, p))
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(11,18,16,.7)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:14 }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:20, width:'100%', maxWidth:480, maxHeight:'92vh', overflowY:'auto', padding:16 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
          <div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700 }}>🗺️ Mapa da Fazenda</div>
            <div style={{ fontSize:12, color:'#5c7568' }}>{fazenda?.nome} — {fazenda?.cliente}</div>
          </div>
          <button style={{ background:'#f1f8f4', color:'#5c7568', border:'none', borderRadius:14, padding:'5px 10px', fontSize:12, cursor:'pointer' }} onClick={onClose}>✕</button>
        </div>

        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" style={{ display:'none' }} onChange={handleEscolherArquivo}/>

        {!temMapa ? (
          <div style={{ background:'#f7fbf8', borderRadius:14, padding:24, textAlign:'center', fontSize:13, color:'#5c7568' }}>
            Essa fazenda ainda não tem mapa cadastrado.
            <button disabled={enviando} onClick={()=>fileInputRef.current?.click()}
              style={{ display:'block', width:'100%', marginTop:14, background:'#0e9f6e', color:'#fff', border:'none', borderRadius:12, padding:'10px', fontSize:13, fontWeight:600, cursor:'pointer', opacity:enviando?.6:1 }}>
              {enviando?'Enviando...':'📤 Enviar mapa (PDF)'}
            </button>
            {destino && !enviando && (
              <a href={`https://maps.google.com/?q=${destino.lat},${destino.lng}`} target="_blank" rel="noreferrer"
                style={{ display:'block', marginTop:12, color:'#0e9f6e', fontWeight:600, textDecoration:'none' }}>🗺️ Abrir localização no Maps</a>
            )}
          </div>
        ) : erro ? (
          <div style={{ background:'#fdeaea', color:'#e5484d', borderRadius:14, padding:16, fontSize:13 }}>
            {erro}
            <button disabled={enviando} onClick={()=>fileInputRef.current?.click()}
              style={{ display:'block', width:'100%', marginTop:12, background:'#fff', color:'#e5484d', border:'1px solid #e5484d', borderRadius:12, padding:'10px', fontSize:13, fontWeight:600, cursor:'pointer', opacity:enviando?.6:1 }}>
              {enviando?'Enviando...':'📤 Enviar mapa de novo (PDF)'}
            </button>
          </div>
        ) : (
          <>
            <div ref={mapBoxRef}
              style={{ position:'relative', borderRadius:14, overflow:'hidden', border:'1px solid #dcebe3', background:'#eef3ee',
                aspectRatio: tamCanvas.width && tamCanvas.height ? `${tamCanvas.width}/${tamCanvas.height}` : '4/3', touchAction:'none' }}
              onTouchStart={onMapaTouchStart} onTouchMove={onMapaTouchMove} onTouchEnd={onMapaTouchEnd}
              onDoubleClick={resetZoom} onWheel={onMapaWheel}>
              {carregando && <div style={{ padding:60, textAlign:'center', fontSize:13, color:'#7ba38f' }}>Abrindo mapa...</div>}
              <div style={{ position:'absolute', inset:0, transformOrigin:'center center', transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`, display: carregando ? 'none' : 'block' }}>
                <canvas ref={canvasRef} style={{ width:'100%', height:'100%', display:'block' }} />
                {pinPx && (
                  <div style={{
                    position:'absolute', left:`${(pinPx.x/tamCanvas.width)*100}%`, top:`${(pinPx.y/tamCanvas.height)*100}%`,
                    transform:`translate(-50%,-50%) scale(${1/zoom})`, width:20, height:20, borderRadius:'50%',
                    background: pinPx.dentro ? '#0e9f6e' : '#e5484d', border:'3px solid #fff',
                    boxShadow:'0 0 0 6px ' + (pinPx.dentro ? 'rgba(14,159,110,.25)' : 'rgba(229,72,77,.25)'),
                  }}/>
                )}
              </div>
              {zoom>1 && (
                <button onClick={resetZoom} style={{ position:'absolute', right:8, bottom:8, background:'rgba(11,18,16,.75)', color:'#fff', border:'none', borderRadius:20, padding:'6px 12px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  ⤢ {zoom.toFixed(1)}x — resetar
                </button>
              )}
            </div>
            <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
              {!temBounds ? (
                <div style={{ fontSize:11.5, color:'#a3690a', background:'#fff3e0', borderRadius:10, padding:'8px 10px' }}>⚠️ Esse mapa não tem as coordenadas dos cantos cadastradas — não dá pra mostrar a posição em cima dele ainda.</div>
              ) : !pos ? (
                <div style={{ fontSize:11.5, color:'#7ba38f' }}>📡 Buscando seu GPS...</div>
              ) : longe ? (
                <div style={{ fontSize:11.5, color:'#2952a3', fontWeight:600, background:'#e6f1fb', borderRadius:10, padding:'8px 10px' }}>
                  📍 Você está a ~{distKm < 10 ? distKm.toFixed(1) : Math.round(distKm)} km do mapa — use a rota abaixo pra chegar. A posição ao vivo aparece aqui quando você estiver perto.
                </div>
              ) : !pinPx?.dentro ? (
                <div style={{ fontSize:11.5, color:'#e5484d', fontWeight:600 }}>⚠️ Você está fora da área desse mapa (~{Math.round(distKm*1000)}m do centro)</div>
              ) : (
                <div style={{ fontSize:11.5, color:'#0e9f6e', fontWeight:600 }}>📍 Você está dentro da área mapeada</div>
              )}
              {pos && (
                <div style={{ fontFamily:'ui-monospace,monospace', fontSize:11, color:'#5c7568' }}>
                  {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} · precisão ±{Math.round(pos.accuracy)}m
                </div>
              )}
              {destino && (
                <a href={`https://maps.google.com/?q=${destino.lat},${destino.lng}`} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'#0e9f6e', fontWeight:600, textDecoration:'none' }}>🗺️ Abrir rota no Maps</a>
              )}
              <button disabled={enviando} onClick={()=>fileInputRef.current?.click()}
                style={{ alignSelf:'flex-start', background:'none', border:'none', color:'#7ba38f', fontSize:11, fontWeight:600, cursor:'pointer', padding:0, marginTop:4 }}>
                {enviando?'Enviando...':'🔄 Trocar mapa (enviar PDF novo)'}
              </button>
            </div>
          </>
        )}

        {/* TEMP — log de diagnóstico visível na tela, pra debugar o upload sem cabo USB.
            Remover depois que o fluxo estiver validado. */}
        {logs.length > 0 && (
          <div style={{ marginTop:14, background:'#0b1210', borderRadius:12, padding:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:10, fontWeight:700, color:'#8fe6b8', letterSpacing:.5 }}>LOG (debug)</span>
              <div style={{ display:'flex', gap:6 }}>
                <button onClick={()=>compartilharNativo({ text: logs.join('\n') })}
                  style={{ background:'#1a3a2c', color:'#8fe6b8', border:'none', borderRadius:8, padding:'4px 8px', fontSize:10, fontWeight:600, cursor:'pointer' }}>📤 Compartilhar</button>
                <button onClick={()=>setLogs([])}
                  style={{ background:'#1a3a2c', color:'#8fe6b8', border:'none', borderRadius:8, padding:'4px 8px', fontSize:10, fontWeight:600, cursor:'pointer' }}>Limpar</button>
              </div>
            </div>
            <div style={{ maxHeight:150, overflowY:'auto', fontFamily:'ui-monospace,monospace', fontSize:10, color:'#c8eed8', lineHeight:1.5 }}>
              {logs.map((l,i)=><div key={i} style={{ wordBreak:'break-word' }}>{l}</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

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
  // Mesma ideia do pathOverride, mas pros 4 cantos — depois de calibrar, mostra a posição
  // na hora sem esperar reabrir a tela.
  const [boundsOverride, setBoundsOverride] = useState(null)
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
      log('cadastro atualizado, salvando no cache local...')
      // Não renderiza aqui direto — o <canvas> só existe na tela depois que temMapa vira
      // true (troca de tela do "sem mapa" pro visualizador), então o ref ainda está null
      // nesse instante. Guarda no cache e deixa o useEffect de carregamento (que já roda
      // assim que mapaPdfPath muda) cuidar de renderizar, igual quando abre um mapa existente.
      await salvarMapaCache(fazenda.id, blob)
      setPathOverride(path)
      log('concluído — abrindo o mapa...')
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
    setCarregando(true)
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

  const bounds = boundsOverride || (temBounds ? { latMin: fazenda.mapa_lat_min, latMax: fazenda.mapa_lat_max, lngMin: fazenda.mapa_lng_min, lngMax: fazenda.mapa_lng_max } : null)
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
    if (calibrando) return
    if (e.touches.length === 2) {
      gestoRef.current = { modo: 'pinch', dist0: distEntreToques(e.touches), zoom0: zoom, panX0: pan.x, panY0: pan.y }
    } else if (e.touches.length === 1) {
      gestoRef.current = { modo: 'pan', x0: e.touches[0].clientX, y0: e.touches[0].clientY, panX0: pan.x, panY0: pan.y }
    }
  }
  function onMapaTouchMove(e) {
    if (calibrando) return
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
    if (calibrando) return
    e.preventDefault()
    const novoZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * (e.deltaY < 0 ? 1.15 : 0.87)))
    setZoom(novoZoom)
    setPan(p => limitarPan(novoZoom, p))
  }

  // Calibração por 2 pontos — toca em 2 lugares reconhecíveis no mapa, informa a
  // coordenada real de cada um (digitando ou usando o GPS de quem está lá), e o app
  // calcula os 4 cantos sozinho. Substitui ter que descobrir/digitar os 4 números
  // de cabeça (o que só eu conseguia fazer via SQL até agora).
  const [calibrando, setCalibrando] = useState(false)
  const [pontosCalib, setPontosCalib] = useState([]) // [{px,py,lat,lng}]
  const [pendente, setPendente] = useState(null) // {px,py} tocado, esperando a coordenada
  const [calibLat, setCalibLat] = useState('')
  const [calibLng, setCalibLng] = useState('')
  const [calibSalvando, setCalibSalvando] = useState(false)

  function iniciarCalibracao() {
    setCalibrando(true)
    setPontosCalib([])
    setPendente(null)
    setCalibLat(''); setCalibLng('')
    resetZoom()
    log('calibração iniciada')
  }
  function cancelarCalibracao() {
    setCalibrando(false)
    setPontosCalib([])
    setPendente(null)
  }
  function onMapaClickCalibrar(e) {
    if (!calibrando || pendente || pontosCalib.length >= 2) return
    const box = mapBoxRef.current
    if (!box || !tamCanvas.width) return
    const r = box.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * tamCanvas.width
    const py = ((e.clientY - r.top) / r.height) * tamCanvas.height
    setPendente({ px, py })
  }
  function usarGpsAtual() {
    if (!pos) return
    setCalibLat(String(pos.lat.toFixed(6)))
    setCalibLng(String(pos.lng.toFixed(6)))
  }
  function confirmarPonto() {
    const lat = parseFloat(calibLat), lng = parseFloat(calibLng)
    if (!pendente || isNaN(lat) || isNaN(lng)) return
    setPontosCalib(ps => [...ps, { ...pendente, lat, lng }])
    setPendente(null); setCalibLat(''); setCalibLng('')
  }
  async function salvarCalibracao(novoBounds) {
    setCalibSalvando(true)
    log(`calibração calculada: lat ${novoBounds.latMin.toFixed(6)}~${novoBounds.latMax.toFixed(6)}, lng ${novoBounds.lngMin.toFixed(6)}~${novoBounds.lngMax.toFixed(6)}`)
    try {
      const { error } = await supabase.from('fazendas').update({
        mapa_lat_min: novoBounds.latMin, mapa_lat_max: novoBounds.latMax,
        mapa_lng_min: novoBounds.lngMin, mapa_lng_max: novoBounds.lngMax,
      }).eq('id', fazenda.id)
      if (error) throw error
      setBoundsOverride(novoBounds)
      log('calibração salva ✅')
    } catch (e) {
      log(`ERRO ao salvar calibração: ${e?.message || e}`)
      setErro('Não consegui salvar a calibração: ' + (e?.message || 'confira sua conexão.'))
    } finally {
      setCalibSalvando(false)
      setCalibrando(false)
      setPontosCalib([])
    }
  }
  useEffect(() => {
    if (pontosCalib.length !== 2 || !tamCanvas.width) return
    const [A, B] = pontosCalib
    if (A.px === B.px || A.py === B.py) {
      log('calibração inválida: os 2 pontos precisam estar em posições bem diferentes (diagonais), tente de novo')
      setPontosCalib([])
      return
    }
    const dLng = (A.lng - B.lng) / ((A.px - B.px) / tamCanvas.width)
    const lngMin = A.lng - (A.px / tamCanvas.width) * dLng
    const lngMax = lngMin + dLng
    const vA = 1 - A.py / tamCanvas.height, vB = 1 - B.py / tamCanvas.height
    const dLat = (A.lat - B.lat) / (vA - vB)
    const latMin = A.lat - vA * dLat
    const latMax = latMin + dLat
    salvarCalibracao({
      latMin: Math.min(latMin, latMax), latMax: Math.max(latMin, latMax),
      lngMin: Math.min(lngMin, lngMax), lngMax: Math.max(lngMin, lngMax),
    })
  }, [pontosCalib]) // eslint-disable-line

  // Régua de escala + coordenadas — estilo Avenza. Escolhe o "degrau" redondo (5m, 10m,
  // 20m, 50m...) que fica com uma largura legível na tela, considerando o zoom atual.
  const ESCALA_DEGRAUS = [5,10,20,50,100,200,500,1000,2000,5000,10000,20000]
  function calcularEscala() {
    const box = mapBoxRef.current
    if (!bounds || !tamCanvas.width || !box) return null
    const r = box.getBoundingClientRect()
    if (!r.width) return null
    const latMed = (bounds.latMax + bounds.latMin) / 2
    const metrosPorGrauLng = 111320 * Math.cos(latMed * Math.PI / 180)
    const totalMetros = (bounds.lngMax - bounds.lngMin) * metrosPorGrauLng
    const metrosPorPixelTela = totalMetros / (r.width * zoom)
    if (!isFinite(metrosPorPixelTela) || metrosPorPixelTela <= 0) return null
    let escolhido = ESCALA_DEGRAUS[0]
    for (const deg of ESCALA_DEGRAUS) { if (deg / metrosPorPixelTela <= 140) escolhido = deg; else break }
    const larguraPx = escolhido / metrosPorPixelTela
    const label = escolhido >= 1000 ? `${escolhido/1000} km` : `${escolhido} m`
    return { larguraPx, label }
  }
  function formatarCoord(lat, lng) {
    const ns = lat >= 0 ? 'N' : 'S', ew = lng >= 0 ? 'L' : 'O'
    return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lng).toFixed(6)}° ${ew}`
  }
  const escala = temMapa && !carregando ? calcularEscala() : null

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
                aspectRatio: tamCanvas.width && tamCanvas.height ? `${tamCanvas.width}/${tamCanvas.height}` : '4/3', touchAction:'none',
                cursor: calibrando ? 'crosshair' : 'default' }}
              onTouchStart={onMapaTouchStart} onTouchMove={onMapaTouchMove} onTouchEnd={onMapaTouchEnd}
              onDoubleClick={resetZoom} onWheel={onMapaWheel} onClick={onMapaClickCalibrar}>
              {carregando && <div style={{ padding:60, textAlign:'center', fontSize:13, color:'#7ba38f' }}>Abrindo mapa...</div>}
              <div style={{ position:'absolute', inset:0, transformOrigin:'center center', transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`, display: carregando ? 'none' : 'block' }}>
                <canvas ref={canvasRef} style={{ width:'100%', height:'100%', display:'block' }} />
                {pinPx && !calibrando && (
                  <div style={{
                    position:'absolute', left:`${(pinPx.x/tamCanvas.width)*100}%`, top:`${(pinPx.y/tamCanvas.height)*100}%`,
                    transform:`translate(-50%,-50%) scale(${1/zoom})`, width:20, height:20, borderRadius:'50%',
                    background: pinPx.dentro ? '#0e9f6e' : '#e5484d', border:'3px solid #fff',
                    boxShadow:'0 0 0 6px ' + (pinPx.dentro ? 'rgba(14,159,110,.25)' : 'rgba(229,72,77,.25)'),
                  }}/>
                )}
                {calibrando && [...pontosCalib, ...(pendente ? [pendente] : [])].map((p,i) => (
                  <div key={i} style={{
                    position:'absolute', left:`${(p.px/tamCanvas.width)*100}%`, top:`${(p.py/tamCanvas.height)*100}%`,
                    transform:'translate(-50%,-50%)', width:22, height:22, borderRadius:'50%',
                    background: i < pontosCalib.length ? '#0e9f6e' : '#ffb020', border:'3px solid #fff',
                    display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:11, fontWeight:700,
                    boxShadow:'0 2px 6px rgba(0,0,0,.35)',
                  }}>{i+1}</div>
                ))}
              </div>
              {zoom>1 && !calibrando && (
                <button onClick={resetZoom} style={{ position:'absolute', right:8, bottom:8, background:'rgba(11,18,16,.75)', color:'#fff', border:'none', borderRadius:20, padding:'6px 12px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  ⤢ {zoom.toFixed(1)}x — resetar
                </button>
              )}
              {escala && !calibrando && (
                <div style={{ position:'absolute', left:8, bottom:8, display:'flex', flexDirection:'column', alignItems:'flex-start', pointerEvents:'none' }}>
                  <div style={{ width:escala.larguraPx, height:4, background:'rgba(11,18,16,.75)', borderLeft:'2px solid rgba(11,18,16,.75)', borderRight:'2px solid rgba(11,18,16,.75)' }}/>
                  <span style={{ fontSize:10, fontWeight:700, color:'#fff', background:'rgba(11,18,16,.75)', borderRadius:6, padding:'1px 5px', marginTop:2 }}>{escala.label}</span>
                </div>
              )}
              {pos && !calibrando && (
                <div style={{ position:'absolute', right:8, top:8, background:'rgba(11,18,16,.75)', color:'#fff', fontSize:9.5, fontFamily:'ui-monospace,monospace', borderRadius:8, padding:'4px 8px' }}>
                  {formatarCoord(pos.lat, pos.lng)}
                </div>
              )}
              {calibrando && (
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'flex-start', justifyContent:'center', pointerEvents:'none', paddingTop:8 }}>
                  <div style={{ background:'rgba(11,18,16,.85)', color:'#fff', fontSize:11.5, fontWeight:600, borderRadius:10, padding:'6px 12px', textAlign:'center', pointerEvents:'none' }}>
                    {pendente ? 'Informe a coordenada desse ponto abaixo ⬇️' : `Toque no ${pontosCalib.length===0?'1º':'2º'} ponto que você reconhece no mapa`}
                  </div>
                </div>
              )}
            </div>
            {calibrando && (
              <div style={{ marginTop:10, background:'#f6faf7', border:'1px solid #dcebe3', borderRadius:14, padding:12, display:'flex', flexDirection:'column', gap:8 }}>
                {pendente ? (
                  <>
                    <div style={{ fontSize:11, fontWeight:700, color:'#5c7568' }}>COORDENADA DO PONTO {pontosCalib.length+1}</div>
                    <div style={{ display:'flex', gap:6 }}>
                      <input placeholder="Latitude" value={calibLat} onChange={e=>setCalibLat(e.target.value)} type="number"
                        style={{ flex:1, border:'1px solid #e0ece5', borderRadius:8, padding:'8px 10px', fontSize:12.5 }}/>
                      <input placeholder="Longitude" value={calibLng} onChange={e=>setCalibLng(e.target.value)} type="number"
                        style={{ flex:1, border:'1px solid #e0ece5', borderRadius:8, padding:'8px 10px', fontSize:12.5 }}/>
                    </div>
                    {pos && (
                      <button onClick={usarGpsAtual} style={{ alignSelf:'flex-start', background:'none', border:'none', color:'#0e9f6e', fontSize:11.5, fontWeight:600, cursor:'pointer', padding:0 }}>
                        📡 Usar minha localização atual (só se você estiver nesse ponto agora)
                      </button>
                    )}
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={()=>setPendente(null)} style={{ flex:1, background:'#fff', color:'#5c7568', border:'1px solid #dcebe3', borderRadius:10, padding:'9px', fontSize:12.5, fontWeight:600, cursor:'pointer' }}>Cancelar ponto</button>
                      <button onClick={confirmarPonto} disabled={!calibLat||!calibLng} style={{ flex:1, background:'#0e9f6e', color:'#fff', border:'none', borderRadius:10, padding:'9px', fontSize:12.5, fontWeight:600, cursor:'pointer', opacity:(!calibLat||!calibLng)?.5:1 }}>Confirmar ponto</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize:11.5, color:'#5c7568' }}>
                      🎯 Toque em 2 pontos <strong>bem afastados e em diagonal</strong> no mapa que você reconhece na realidade (ex: canto do talhão, cruzamento de estrada). Pra cada um, informe a coordenada real — se estiver lá agora, é só usar o GPS.
                    </div>
                    {calibSalvando && <div style={{ fontSize:11.5, color:'#0e9f6e', fontWeight:600 }}>Salvando calibração...</div>}
                    <button onClick={cancelarCalibracao} style={{ alignSelf:'flex-start', background:'none', border:'none', color:'#7ba38f', fontSize:11.5, fontWeight:600, cursor:'pointer', padding:0 }}>✕ Cancelar calibração</button>
                  </>
                )}
              </div>
            )}
            {!calibrando && (
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
                {!bounds ? (
                  <div style={{ fontSize:11.5, color:'#a3690a', background:'#fff3e0', borderRadius:10, padding:'8px 10px' }}>⚠️ Esse mapa ainda não foi calibrado — toque em "🎯 Calibrar mapa" abaixo pra localizar 2 pontos e alinhar a posição.</div>
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
                    {formatarCoord(pos.lat, pos.lng)} · precisão ±{Math.round(pos.accuracy)}m
                  </div>
                )}
                {destino && (
                  <a href={`https://maps.google.com/?q=${destino.lat},${destino.lng}`} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'#0e9f6e', fontWeight:600, textDecoration:'none' }}>🗺️ Abrir rota no Maps</a>
                )}
                <div style={{ display:'flex', gap:14, marginTop:4 }}>
                  <button onClick={iniciarCalibracao}
                    style={{ background:'none', border:'none', color:'#0e9f6e', fontSize:11, fontWeight:700, cursor:'pointer', padding:0 }}>
                    🎯 {bounds ? 'Recalibrar mapa' : 'Calibrar mapa'}
                  </button>
                  <button disabled={enviando} onClick={()=>fileInputRef.current?.click()}
                    style={{ background:'none', border:'none', color:'#7ba38f', fontSize:11, fontWeight:600, cursor:'pointer', padding:0 }}>
                    {enviando?'Enviando...':'🔄 Trocar mapa (enviar PDF novo)'}
                  </button>
                </div>
              </div>
            )}
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

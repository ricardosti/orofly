import { useState, useEffect, useRef } from 'react'
import { renderPdfPageToCanvas, latLngParaPixel } from '../lib/geopdf'

// Mapa georreferenciado da fazenda (estilo Avenza) — renderiza o PDF cadastrado e sobrepõe
// a posição de GPS ao vivo do usuário, convertida via os 4 cantos (lat/lng) cadastrados.
// Usado tanto no Admin (conferir o cadastro) quanto no app do piloto (durante o voo).
export default function MapaFazendaViewer({ supabase, fazenda, onClose }) {
  const canvasRef = useRef(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [tamCanvas, setTamCanvas] = useState({ width: 0, height: 0 })
  const [pos, setPos] = useState(null) // { lat, lng, accuracy }

  const temMapa = !!fazenda?.mapa_pdf_path
  const temBounds = fazenda?.mapa_lat_min != null && fazenda?.mapa_lat_max != null && fazenda?.mapa_lng_min != null && fazenda?.mapa_lng_max != null

  useEffect(() => {
    if (!temMapa) { setCarregando(false); return }
    let cancelado = false
    ;(async () => {
      try {
        const { data, error } = await supabase.storage.from('relatorios').download(fazenda.mapa_pdf_path)
        if (error) throw error
        if (cancelado) return
        const { width, height } = await renderPdfPageToCanvas(data, canvasRef.current, 1000)
        if (cancelado) return
        setTamCanvas({ width, height })
      } catch (e) {
        if (!cancelado) setErro('Não consegui abrir o mapa dessa fazenda. Tente cadastrar o PDF de novo.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    })()
    return () => { cancelado = true }
  }, [supabase, fazenda?.mapa_pdf_path, temMapa])

  useEffect(() => {
    if (!temMapa || !temBounds || !navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      p => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [temMapa, temBounds])

  const bounds = temBounds ? { latMin: fazenda.mapa_lat_min, latMax: fazenda.mapa_lat_max, lngMin: fazenda.mapa_lng_min, lngMax: fazenda.mapa_lng_max } : null
  const pinPx = pos && bounds && tamCanvas.width ? latLngParaPixel(pos.lat, pos.lng, bounds, tamCanvas.width, tamCanvas.height) : null

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

        {!temMapa ? (
          <div style={{ background:'#f7fbf8', borderRadius:14, padding:24, textAlign:'center', fontSize:13, color:'#5c7568' }}>
            Essa fazenda ainda não tem mapa cadastrado.
            {fazenda?.lat && fazenda?.lng && (
              <a href={`https://maps.google.com/?q=${fazenda.lat},${fazenda.lng}`} target="_blank" rel="noreferrer"
                style={{ display:'block', marginTop:12, color:'#0e9f6e', fontWeight:600, textDecoration:'none' }}>🗺️ Abrir localização no Maps</a>
            )}
          </div>
        ) : erro ? (
          <div style={{ background:'#fdeaea', color:'#e5484d', borderRadius:14, padding:16, fontSize:13 }}>{erro}</div>
        ) : (
          <>
            <div style={{ position:'relative', borderRadius:14, overflow:'hidden', border:'1px solid #dcebe3', background:'#eef3ee' }}>
              {carregando && <div style={{ padding:60, textAlign:'center', fontSize:13, color:'#7ba38f' }}>Abrindo mapa...</div>}
              <canvas ref={canvasRef} style={{ width:'100%', display: carregando ? 'none' : 'block' }} />
              {pinPx && (
                <div style={{
                  position:'absolute', left:`${(pinPx.x/tamCanvas.width)*100}%`, top:`${(pinPx.y/tamCanvas.height)*100}%`,
                  transform:'translate(-50%,-50%)', width:20, height:20, borderRadius:'50%',
                  background: pinPx.dentro ? '#0e9f6e' : '#e5484d', border:'3px solid #fff',
                  boxShadow:'0 0 0 6px ' + (pinPx.dentro ? 'rgba(14,159,110,.25)' : 'rgba(229,72,77,.25)'),
                }}/>
              )}
            </div>
            <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
              {!temBounds ? (
                <div style={{ fontSize:11.5, color:'#a3690a', background:'#fff3e0', borderRadius:10, padding:'8px 10px' }}>⚠️ Esse mapa não tem as coordenadas dos cantos cadastradas — não dá pra mostrar a posição em cima dele ainda.</div>
              ) : !pos ? (
                <div style={{ fontSize:11.5, color:'#7ba38f' }}>📡 Buscando seu GPS...</div>
              ) : !pinPx?.dentro ? (
                <div style={{ fontSize:11.5, color:'#e5484d', fontWeight:600 }}>⚠️ Você está fora da área desse mapa</div>
              ) : (
                <div style={{ fontSize:11.5, color:'#0e9f6e', fontWeight:600 }}>📍 Você está dentro da área mapeada</div>
              )}
              {pos && (
                <div style={{ fontFamily:'ui-monospace,monospace', fontSize:11, color:'#5c7568' }}>
                  {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} · precisão ±{Math.round(pos.accuracy)}m
                </div>
              )}
              {fazenda?.lat && fazenda?.lng && (
                <a href={`https://maps.google.com/?q=${fazenda.lat},${fazenda.lng}`} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'#0e9f6e', fontWeight:600, textDecoration:'none' }}>🗺️ Abrir rota no Maps</a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

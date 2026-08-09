import { useState, useEffect, useRef } from 'react'
import { renderPdfPageToCanvas, latLngParaPixel, distanciaKm, lerMapaCache, salvarMapaCache, extrairGeoPdf } from '../lib/geopdf'
import { compartilharNativo } from '../lib/nativeShare'

// Resolução de renderização do PDF — alta o bastante pra ficar nítido até no zoom máximo
// (6x) num celular comum, sem precisar re-renderizar a cada nível de zoom (o PDF é vetorial,
// então renderiza uma vez nessa largura e o CSS cuida do resto).
const RENDER_LARGURA_HD = 2200

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
  // Mesma ideia, mas pra área útil do mapa dentro da folha renderizada (viewport) — nos
  // GeoPDFs reais dos clientes, o mapa ocupa só ~72% da largura da página (o resto é a
  // tabela técnica ao lado), então a posição do GPS precisa considerar só essa fração.
  const [viewportOverride, setViewportOverride] = useState(null)
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
      log(`arquivo lido (${(blob.size/1024).toFixed(0)}KB), verificando se é GeoPDF...`)
      // Tenta ler georreferenciamento nativo (GeoPDF de verdade, com /GPTS gravado) antes de
      // subir — se achar, já salva os 4 cantos junto com o path, sem precisar de calibração
      // manual depois. Se não achar (PDF comum), segue o fluxo normal e o botão "Calibrar
      // mapa" continua disponível depois de aberto.
      const geo = await extrairGeoPdf(blob)
      if (geo.encontrado) {
        log(`GeoPDF detectado ✅ (${geo.pontosUsados} pontos GPTS) — lat ${geo.bounds.latMin.toFixed(6)}~${geo.bounds.latMax.toFixed(6)}, lng ${geo.bounds.lngMin.toFixed(6)}~${geo.bounds.lngMax.toFixed(6)}. Área útil do mapa na folha: ${(geo.viewport.w*100).toFixed(0)}% da largura. Calibração automática, não vai precisar calibrar na mão.`)
      } else {
        log(`não é GeoPDF (${geo.motivo}) — depois de abrir, calibre com o botão "Calibrar mapa".`)
      }
      log('enviando pro Storage...')
      const path = `mapas/${fazenda.id}/mapa.pdf`
      const { error: upErr } = await comTimeout(
        supabase.storage.from('relatorios').upload(path, blob, { upsert: true, contentType: 'application/pdf' }),
        20000, 'Envio do arquivo demorou demais (rede lenta ou instável).'
      )
      if (upErr) { log(`ERRO no upload: ${upErr.message||JSON.stringify(upErr)}`); throw upErr }
      log('upload OK, atualizando cadastro da fazenda...')
      const updateFazenda = { mapa_pdf_path: path }
      if (geo.encontrado) {
        updateFazenda.mapa_lat_min = geo.bounds.latMin
        updateFazenda.mapa_lat_max = geo.bounds.latMax
        updateFazenda.mapa_lng_min = geo.bounds.lngMin
        updateFazenda.mapa_lng_max = geo.bounds.lngMax
        updateFazenda.mapa_vp_x = geo.viewport.x
        updateFazenda.mapa_vp_y = geo.viewport.y
        updateFazenda.mapa_vp_w = geo.viewport.w
        updateFazenda.mapa_vp_h = geo.viewport.h
      }
      const { error: dbErr } = await comTimeout(
        supabase.from('fazendas').update(updateFazenda).eq('id', fazenda.id),
        10000, 'Salvou o arquivo mas demorou pra atualizar o cadastro da fazenda.'
      )
      if (dbErr) { log(`ERRO ao atualizar fazenda: ${dbErr.message||JSON.stringify(dbErr)}`); throw dbErr }
      if (geo.encontrado) { setBoundsOverride(geo.bounds); setViewportOverride(geo.viewport) }
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
    console.log('[MapaFazendaViewer] URI do mapa recebido:', mapaPdfPath)
    log(`abrindo mapa: path=${mapaPdfPath}`)
    let cancelado = false
    ;(async () => {
      let mostrouCache = false
      const cache = await lerMapaCache(fazenda.id)
      log(`cache local: ${cache ? 'encontrado' : 'não tem'}`)
      if (cache && !cancelado) {
        try {
          if (!canvasRef.current) throw new Error('canvas ainda não montado (bug de timing — não deveria acontecer)')
          const { width, height } = await renderPdfPageToCanvas(cache, canvasRef.current, RENDER_LARGURA_HD)
          console.log('[MapaFazendaViewer] dimensões renderizadas (cache):', { width, height })
          if (!cancelado) { setTamCanvas({ width, height }); setCarregando(false); mostrouCache = true; log(`renderizado do cache ✅ (${width}x${height})`) }
        } catch (eCache) { log(`falhou renderizar cache: ${eCache?.message||eCache}`) }
      }
      try {
        log('baixando do servidor...')
        const { data, error } = await supabase.storage.from('relatorios').download(mapaPdfPath)
        if (error) throw error
        if (cancelado) return
        log(`baixado (${(data.size/1024).toFixed(0)}KB)`)
        if (!mostrouCache) {
          if (!canvasRef.current) throw new Error('canvas ainda não montado (bug de timing — não deveria acontecer)')
          const { width, height } = await renderPdfPageToCanvas(data, canvasRef.current, RENDER_LARGURA_HD)
          console.log('[MapaFazendaViewer] dimensões renderizadas (servidor):', { width, height })
          if (cancelado) return
          setTamCanvas({ width, height })
          log(`renderizado do servidor ✅ (${width}x${height})`)
        }
        salvarMapaCache(fazenda.id, data)
      } catch (e) {
        console.error('[MapaFazendaViewer] erro ao baixar/renderizar:', e)
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
  // Área útil do mapa dentro da imagem renderizada (ver comentário no latLngParaPixel) —
  // default é a imagem inteira (calibração manual e mapas antigos sem essa coluna ainda).
  const viewport = viewportOverride || (fazenda?.mapa_vp_w != null
    ? { x: fazenda.mapa_vp_x ?? 0, y: fazenda.mapa_vp_y ?? 0, w: fazenda.mapa_vp_w, h: fazenda.mapa_vp_h ?? 1 }
    : { x: 0, y: 0, w: 1, h: 1 })
  const pinPx = pos && bounds && tamCanvas.width ? latLngParaPixel(pos.lat, pos.lng, bounds, tamCanvas.width, tamCanvas.height, viewport) : null
  const distKm = pos && destino ? distanciaKm(pos.lat, pos.lng, destino.lat, destino.lng) : null
  const longe = distKm != null && distKm > 5 // mais de 5km: nem faz sentido falar de "dentro/fora do talhão", é caso de navegação mesmo
  // Raio (em % do canvas) do círculo de precisão do GPS ao redor do pin — cresce/encolhe
  // corretamente com o zoom porque fica dentro da mesma camada transformada que o mapa.
  let precisaoPctX = null, precisaoPctY = null
  if (pos?.accuracy && bounds && tamCanvas.width && tamCanvas.height) {
    const latMed = (bounds.latMax + bounds.latMin) / 2
    const totalMLng = (bounds.lngMax - bounds.lngMin) * 111320 * Math.cos(latMed * Math.PI / 180)
    const totalMLat = (bounds.latMax - bounds.latMin) * 111320
    if (totalMLng > 0 && totalMLat > 0) {
      const pxPorMx = (tamCanvas.width * viewport.w) / totalMLng
      const pxPorMy = (tamCanvas.height * viewport.h) / totalMLat
      precisaoPctX = ((pos.accuracy * pxPorMx * 2) / tamCanvas.width) * 100
      precisaoPctY = ((pos.accuracy * pxPorMy * 2) / tamCanvas.height) * 100
    }
  }

  // Pinch-to-zoom + arrastar no mapa (estilo Avenza) — zoom entre 1x e 6x, arrastar livre
  // dentro desse zoom, e duplo toque/clique reseta pra visão inteira.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const gestoRef = useRef({ modo: null, x0: 0, y0: 0, panX0: 0, panY0: 0, dist0: 0, zoom0: 1, ang0: 0, rot0: 0 })
  const ZOOM_MIN = 0.5, ZOOM_MAX = 6

  // Rotação do mapa (estilo Avenza) — gira com gesto de 2 dedos, ou automaticamente
  // seguindo a bússola/magnetômetro do celular quando "seguindoBussola" está ativo.
  const [rotacao, setRotacao] = useState(0) // graus
  const [seguindoBussola, setSeguindoBussola] = useState(false)
  const [transicaoSuave, setTransicaoSuave] = useState(false)

  // Tela cheia agora (sem popup): a imagem é "contida" dentro da tela toda (como object-fit:
  // contain), centralizada — essa é a escala de ajuste antes de aplicar o zoom do usuário.
  function escalaBase() {
    const box = mapBoxRef.current
    if (!box || !tamCanvas.width || !tamCanvas.height) return 1
    const r = box.getBoundingClientRect()
    if (!r.width || !r.height) return 1
    return Math.min(r.width / tamCanvas.width, r.height / tamCanvas.height)
  }
  function limitarPan(z, p) {
    const box = mapBoxRef.current
    if (!box || !tamCanvas.width) return p
    const r = box.getBoundingClientRect()
    const base = escalaBase()
    const imgW = tamCanvas.width * base * z, imgH = tamCanvas.height * base * z
    // permite arrastar o mapa pra fora da tela (revela o fundo neutro), mas sempre deixa uma
    // folga pra conseguir puxar ele de volta — não perde a imagem de vista de vez.
    const maxX = Math.max(0, (imgW - r.width) / 2) + r.width * 0.15
    const maxY = Math.max(0, (imgH - r.height) / 2) + r.height * 0.15
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) }
  }
  function resetZoom() { setZoom(1); setPan({ x: 0, y: 0 }) }
  function distEntreToques(touches) {
    const [a, b] = touches
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  function anguloEntreToques(touches) {
    const [a, b] = touches
    return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180 / Math.PI
  }
  function onMapaTouchStart(e) {
    if (calibrando) return
    if (e.touches.length === 2) {
      gestoRef.current = { modo: 'pinch', dist0: distEntreToques(e.touches), ang0: anguloEntreToques(e.touches), zoom0: zoom, rot0: rotacao, panX0: pan.x, panY0: pan.y }
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
      let deltaAng = anguloEntreToques(e.touches) - g.ang0
      deltaAng = ((deltaAng + 180) % 360 + 360) % 360 - 180 // menor caminho, evita saltar 350° ao cruzar o limite
      setSeguindoBussola(false)
      setSeguindoGps(false)
      setTransicaoSuave(false)
      setRotacao(g.rot0 + deltaAng)
      setZoom(novoZoom)
      setPan(limitarPan(novoZoom, { x: g.panX0, y: g.panY0 }))
    } else if (g.modo === 'pan' && e.touches.length === 1) {
      e.preventDefault()
      setSeguindoGps(false)
      const dx = e.touches[0].clientX - g.x0, dy = e.touches[0].clientY - g.y0
      setPan(limitarPan(zoom, { x: g.panX0 + dx, y: g.panY0 + dy }))
    }
  }
  function onMapaTouchEnd() { gestoRef.current = { modo: null } }

  // FAB "minha localização" — centraliza a câmera no pin do GPS e trava ali (segue
  // automaticamente conforme a posição atualiza), até o usuário arrastar/pinçar manualmente.
  const [seguindoGps, setSeguindoGps] = useState(false)
  useEffect(() => {
    if (!seguindoGps || !pinPx || !tamCanvas.width) return
    const base = escalaBase()
    const rad = rotacao * Math.PI / 180
    // o vetor até o centro da imagem está no espaço "local" (não rotacionado) do mapa — como
    // o pan é aplicado depois da rotação no transform, precisa girar esse vetor também.
    const localDx = (tamCanvas.width / 2 - pinPx.x) * base * zoom
    const localDy = (tamCanvas.height / 2 - pinPx.y) * base * zoom
    const dx = localDx * Math.cos(rad) - localDy * Math.sin(rad)
    const dy = localDx * Math.sin(rad) + localDy * Math.cos(rad)
    setPan({ x: dx, y: dy })
  }, [seguindoGps, pos?.lat, pos?.lng, rotacao, zoom]) // eslint-disable-line
  function alternarSeguirGps() {
    if (!pinPx) return
    setTransicaoSuave(!seguindoGps)
    setSeguindoGps(v => !v)
    setTimeout(() => setTransicaoSuave(false), 350)
  }

  // Rotação automática seguindo o heading do celular (magnetômetro), quando ativada pelo
  // botão da bússola. iOS entrega o heading pronto (webkitCompassHeading); Android entrega
  // "alpha" cru, que precisa inverter pra virar heading (cresce ao contrário do relógio).
  useEffect(() => {
    if (!seguindoBussola) return
    const normalizar = a => ((a % 360) + 360) % 360
    function onOrientacao(e) {
      let heading = null
      if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading
      else if (e.alpha != null) heading = normalizar(360 - e.alpha)
      if (heading == null) return
      const alvo = normalizar(-heading) // mapa gira ao contrário do heading, pra apontar "pra onde o celular tá virado" pra cima
      setRotacao(atual => {
        const delta = normalizar(alvo - normalizar(atual) + 180) - 180 // menor caminho entre -180 e 180
        return atual + delta * 0.25 // suaviza, evita tremedeira do sensor
      })
    }
    const evento = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(evento, onOrientacao)
    return () => window.removeEventListener(evento, onOrientacao)
  }, [seguindoBussola])

  // Toque na bússola: se já tava seguindo o heading, desativa e volta suavemente pro norte
  // (0°) — se tava parada, ativa a rotação automática (pedindo permissão do sensor no iOS,
  // que só funciona dentro do clique do usuário).
  async function alternarBussola() {
    if (seguindoBussola) {
      setSeguindoBussola(false)
      setTransicaoSuave(true)
      setRotacao(0)
      setTimeout(() => setTransicaoSuave(false), 350)
      log('bússola desativada — norte pra cima')
      return
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const resp = await DeviceOrientationEvent.requestPermission()
        if (resp !== 'granted') { log('permissão de bússola negada'); return }
      } catch (e) { log('erro ao pedir permissão de bússola: ' + (e?.message || e)); return }
    }
    setSeguindoBussola(true)
    log('bússola ativada — mapa gira seguindo pra onde o celular aponta')
  }
  function onMapaWheel(e) {
    if (calibrando) return
    e.preventDefault()
    const novoZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * (e.deltaY < 0 ? 1.15 : 0.87)))
    setZoom(novoZoom)
    setPan(p => limitarPan(novoZoom, p))
  }

  // HUD da tela cheia — menu de opções (⋯) e o drawer de log, escondido por padrão.
  const [menuAberto, setMenuAberto] = useState(false)
  const [mostrarLog, setMostrarLog] = useState(false)

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
    setSeguindoGps(false)
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
      // Calibração manual é feita direto sobre a imagem inteira renderizada (o usuário toca
      // no que vê na tela), então zera qualquer viewport de GeoPDF detectado antes — senão a
      // posição ficaria deslocada, aplicando duas correções sobrepostas.
      const viewportCheio = { x: 0, y: 0, w: 1, h: 1 }
      const { error } = await supabase.from('fazendas').update({
        mapa_lat_min: novoBounds.latMin, mapa_lat_max: novoBounds.latMax,
        mapa_lng_min: novoBounds.lngMin, mapa_lng_max: novoBounds.lngMax,
        mapa_vp_x: viewportCheio.x, mapa_vp_y: viewportCheio.y, mapa_vp_w: viewportCheio.w, mapa_vp_h: viewportCheio.h,
      }).eq('id', fazenda.id)
      if (error) throw error
      setBoundsOverride(novoBounds)
      setViewportOverride(viewportCheio)
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
    const metrosPorPixelTela = totalMetros / (r.width * viewport.w * zoom)
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

  const itemMenuStyle = { display:'block', width:'100%', textAlign:'left', background:'none', border:'none', borderBottom:'1px solid #eef3ee', color:'#26362d', fontSize:13, fontWeight:600, padding:'12px 14px', cursor:'pointer', textDecoration:'none' }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:2000, background:'#1c2321', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" style={{ display:'none' }} onChange={handleEscolherArquivo}/>

      {/* HUD topo — voltar / nome da fazenda / opções */}
      <div style={{ position:'absolute', top:0, left:0, right:0, zIndex:20, display:'flex', alignItems:'center', gap:10,
        padding:'calc(env(safe-area-inset-top,0px) + 10px) 12px 24px', background:'linear-gradient(rgba(11,18,16,.8),rgba(11,18,16,0))', pointerEvents:'none' }}>
        <button onClick={onClose} style={{ pointerEvents:'auto', width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,.14)', border:'none', color:'#fff', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#fff', fontWeight:700, fontSize:14, fontFamily:"'Syne',sans-serif", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{fazenda?.nome}</div>
          <div style={{ color:'rgba(255,255,255,.65)', fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{fazenda?.cliente}</div>
        </div>
        {temMapa && !erro && (
          <button onClick={()=>setMenuAberto(v=>!v)} style={{ pointerEvents:'auto', width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,.14)', border:'none', color:'#fff', fontSize:18, fontWeight:700, cursor:'pointer', flexShrink:0 }}>⋯</button>
        )}
      </div>
      {menuAberto && <div onClick={()=>setMenuAberto(false)} style={{ position:'absolute', inset:0, zIndex:20 }}/>}
      {menuAberto && (
        <div style={{ position:'absolute', top:'calc(env(safe-area-inset-top,0px) + 54px)', right:12, zIndex:21, background:'#fff', borderRadius:14, boxShadow:'0 10px 30px rgba(0,0,0,.4)', overflow:'hidden', minWidth:210 }}>
          <button onClick={()=>{ iniciarCalibracao(); setMenuAberto(false) }} style={itemMenuStyle}>🎯 {bounds ? 'Recalibrar mapa' : 'Calibrar mapa'}</button>
          <button disabled={enviando} onClick={()=>{ fileInputRef.current?.click(); setMenuAberto(false) }} style={itemMenuStyle}>🔄 {enviando ? 'Enviando...' : 'Trocar mapa (PDF)'}</button>
          {destino && (
            <a href={`https://maps.google.com/?q=${destino.lat},${destino.lng}`} target="_blank" rel="noreferrer" onClick={()=>setMenuAberto(false)} style={itemMenuStyle}>🗺️ Abrir no Maps</a>
          )}
          <button onClick={()=>{ setMostrarLog(v=>!v); setMenuAberto(false) }} style={{ ...itemMenuStyle, borderBottom:'none', color:'#7ba38f' }}>🐞 {mostrarLog ? 'Esconder' : 'Mostrar'} log (debug)</button>
        </div>
      )}

      {!temMapa ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ background:'#fff', borderRadius:18, padding:24, textAlign:'center', fontSize:13, color:'#5c7568', maxWidth:340, width:'100%' }}>
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
        </div>
      ) : erro ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ background:'#fdeaea', color:'#e5484d', borderRadius:18, padding:20, fontSize:13, maxWidth:340, width:'100%' }}>
            {erro}
            <button disabled={enviando} onClick={()=>fileInputRef.current?.click()}
              style={{ display:'block', width:'100%', marginTop:12, background:'#fff', color:'#e5484d', border:'1px solid #e5484d', borderRadius:12, padding:'10px', fontSize:13, fontWeight:600, cursor:'pointer', opacity:enviando?.6:1 }}>
              {enviando?'Enviando...':'📤 Enviar mapa de novo (PDF)'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div ref={mapBoxRef}
            style={{ flex:1, position:'relative', overflow:'hidden',
              backgroundColor:'#1c2321',
              backgroundImage:'linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px)',
              backgroundSize:'26px 26px', touchAction:'none',
              cursor: calibrando ? 'crosshair' : 'default' }}
            onTouchStart={onMapaTouchStart} onTouchMove={onMapaTouchMove} onTouchEnd={onMapaTouchEnd}
            onDoubleClick={resetZoom} onWheel={onMapaWheel} onClick={onMapaClickCalibrar}>
            {carregando && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:'#9fc2af' }}>Abrindo mapa...</div>}
            {/* O canvas precisa ficar sempre montado (mesmo com tamCanvas ainda 0/0) — é nele
                que o useEffect de carregamento renderiza o PDF via canvasRef.current; se isso
                aqui virar condicional em tamCanvas.width, o canvas nunca chega a existir no DOM
                a tempo (tamCanvas só é preenchido DEPOIS que o render acontece: fica um "ovo e
                galinha" e o mapa nunca aparece). */}
            <div style={{
              position:'absolute', left:'50%', top:'50%', width:tamCanvas.width || '100%', height:tamCanvas.height || '100%',
              transformOrigin:'center center',
              transform:`translate(-50%,-50%) translate(${pan.x}px,${pan.y}px) rotate(${rotacao}deg) scale(${escalaBase()*zoom})`,
              transition: transicaoSuave ? 'transform .35s ease' : 'none',
              display: carregando ? 'none' : 'block' }}>
              <canvas ref={canvasRef} style={{ width:'100%', height:'100%', display:'block', boxShadow:'0 4px 30px rgba(0,0,0,.5)' }} />
              {pinPx && !calibrando && tamCanvas.width > 0 && (
                <>
                  {precisaoPctX != null && (
                    <div style={{
                      position:'absolute', left:`${(pinPx.x/tamCanvas.width)*100}%`, top:`${(pinPx.y/tamCanvas.height)*100}%`,
                      width:`${precisaoPctX}%`, height:`${precisaoPctY}%`, transform:'translate(-50%,-50%)', borderRadius:'50%',
                      background:'rgba(14,159,110,.15)', border:'1px solid rgba(14,159,110,.55)', pointerEvents:'none',
                    }}/>
                  )}
                  <div style={{
                    position:'absolute', left:`${(pinPx.x/tamCanvas.width)*100}%`, top:`${(pinPx.y/tamCanvas.height)*100}%`,
                    transform:`translate(-50%,-50%) scale(${1/(escalaBase()*zoom)})`, width:20, height:20, borderRadius:'50%',
                    background: pinPx.dentro ? '#0e9f6e' : '#e5484d', border:'3px solid #fff',
                    boxShadow:'0 0 0 6px ' + (pinPx.dentro ? 'rgba(14,159,110,.25)' : 'rgba(229,72,77,.25)'),
                  }}/>
                </>
              )}
              {calibrando && tamCanvas.width > 0 && [...pontosCalib, ...(pendente ? [pendente] : [])].map((p,i) => (
                <div key={i} style={{
                  position:'absolute', left:`${(p.px/tamCanvas.width)*100}%`, top:`${(p.py/tamCanvas.height)*100}%`,
                  transform:'translate(-50%,-50%)', width:22, height:22, borderRadius:'50%',
                  background: i < pontosCalib.length ? '#0e9f6e' : '#ffb020', border:'3px solid #fff',
                  display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:11, fontWeight:700,
                  boxShadow:'0 2px 6px rgba(0,0,0,.35)',
                }}>{i+1}</div>
              ))}
            </div>
            {(zoom>1.02||zoom<0.98) && !calibrando && (
              <button onClick={resetZoom} style={{ position:'absolute', right:8, bottom:96, background:'rgba(11,18,16,.75)', color:'#fff', border:'none', borderRadius:20, padding:'6px 12px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                ⤢ {zoom.toFixed(1)}x — resetar
              </button>
            )}
            {escala && !calibrando && (
              <div style={{ position:'absolute', left:12, bottom:96, display:'flex', flexDirection:'column', alignItems:'flex-start', pointerEvents:'none' }}>
                <div style={{ width:escala.larguraPx, height:4, background:'rgba(11,18,16,.75)', borderLeft:'2px solid rgba(11,18,16,.75)', borderRight:'2px solid rgba(11,18,16,.75)' }}/>
                <span style={{ fontSize:10, fontWeight:700, color:'#fff', background:'rgba(11,18,16,.75)', borderRadius:6, padding:'1px 5px', marginTop:2 }}>{escala.label}</span>
              </div>
            )}
            {temMapa && !carregando && !calibrando && (
              <button onClick={alternarBussola} title="Bússola — toque pra girar o mapa seguindo a direção do celular, ou resetar pro norte"
                style={{ position:'absolute', right:8, top:'calc(env(safe-area-inset-top,0px) + 62px)', width:34, height:34, borderRadius:'50%', padding:0,
                  background: seguindoBussola ? '#0e9f6e' : 'rgba(11,18,16,.75)', border:'none', cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div style={{ position:'relative', width:14, height:14 }}>
                  <div style={{ position:'absolute', inset:0, transform:`rotate(${-rotacao}deg)`, transition: transicaoSuave ? 'transform .35s ease' : 'none' }}>
                    <div style={{ position:'absolute', left:'50%', top:0, transform:'translateX(-50%)', width:0, height:0, borderLeft:'4.5px solid transparent', borderRight:'4.5px solid transparent', borderBottom:'8px solid #ff5c5c' }}/>
                    <div style={{ position:'absolute', left:'50%', bottom:0, transform:'translateX(-50%)', width:0, height:0, borderLeft:'4.5px solid transparent', borderRight:'4.5px solid transparent', borderTop:'8px solid #dfe8e2' }}/>
                  </div>
                </div>
              </button>
            )}
            {calibrando && (
              <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'flex-start', justifyContent:'center', pointerEvents:'none', paddingTop:'calc(env(safe-area-inset-top,0px) + 62px)' }}>
                <div style={{ background:'rgba(11,18,16,.85)', color:'#fff', fontSize:11.5, fontWeight:600, borderRadius:10, padding:'6px 12px', textAlign:'center', pointerEvents:'none' }}>
                  {pendente ? 'Informe a coordenada desse ponto abaixo ⬇️' : `Toque no ${pontosCalib.length===0?'1º':'2º'} ponto que você reconhece no mapa`}
                </div>
              </div>
            )}
          </div>

          {/* Banner flutuante do rodapé — coordenadas ao vivo + precisão */}
          {!calibrando && (
            <div style={{ position:'absolute', left:12, right:86, zIndex:15, bottom:'calc(env(safe-area-inset-bottom,0px) + 16px)',
              background:'rgba(11,18,16,.82)', color:'#fff', borderRadius:14, padding:'10px 14px' }}>
              {!bounds ? (
                <div style={{ fontSize:12, fontWeight:600, color:'#ffcf8a' }}>⚠️ Mapa não calibrado — use "🎯 Calibrar mapa" no menu ⋯</div>
              ) : !pos ? (
                <div style={{ fontSize:12, color:'#9fc2af' }}>📡 Buscando seu GPS...</div>
              ) : (
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8 }}>
                  <span style={{ fontFamily:'ui-monospace,monospace', fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{formatarCoord(pos.lat, pos.lng)}</span>
                  <span style={{ fontSize:11, fontWeight:700, whiteSpace:'nowrap', color: longe ? '#7fb4ff' : pinPx?.dentro ? '#8fe6b8' : '#ff9d9d' }}>
                    ±{Math.round(pos.accuracy)}m {longe ? `· ${distKm<10?distKm.toFixed(1):Math.round(distKm)}km daqui` : pinPx?.dentro ? '· dentro da área' : '· fora da área'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* FAB — centraliza e trava a câmera na posição do GPS */}
          {!calibrando && (
            <button onClick={alternarSeguirGps} disabled={!pinPx} title="Centralizar na minha localização"
              style={{ position:'absolute', right:14, zIndex:15, bottom:'calc(env(safe-area-inset-bottom,0px) + 20px)',
                width:52, height:52, borderRadius:'50%', border:'none', fontSize:21, cursor: pinPx ? 'pointer' : 'default',
                background: seguindoGps ? '#0e9f6e' : '#fff', color: seguindoGps ? '#fff' : '#0e9f6e',
                boxShadow:'0 4px 16px rgba(0,0,0,.4)', opacity: pinPx ? 1 : .5 }}>
              🎯
            </button>
          )}

          {calibrando && (
            <div style={{ position:'absolute', left:0, right:0, bottom:0, zIndex:20, background:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20,
              padding:'14px 16px calc(env(safe-area-inset-bottom,0px) + 16px)', display:'flex', flexDirection:'column', gap:8, boxShadow:'0 -10px 30px rgba(0,0,0,.35)' }}>
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
        </>
      )}

      {/* Log de diagnóstico — escondido por padrão, só aparece via menu ⋯ "Mostrar log (debug)" */}
      {mostrarLog && logs.length > 0 && (
        <div style={{ position:'absolute', left:12, right:12, zIndex:22, bottom:'calc(env(safe-area-inset-bottom,0px) + 16px)', background:'#0b1210', borderRadius:12, padding:10, maxHeight:'40vh', display:'flex', flexDirection:'column' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <span style={{ fontSize:10, fontWeight:700, color:'#8fe6b8', letterSpacing:.5 }}>LOG (debug)</span>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={()=>compartilharNativo({ text: logs.join('\n') })}
                style={{ background:'#1a3a2c', color:'#8fe6b8', border:'none', borderRadius:8, padding:'4px 8px', fontSize:10, fontWeight:600, cursor:'pointer' }}>📤 Compartilhar</button>
              <button onClick={()=>setLogs([])}
                style={{ background:'#1a3a2c', color:'#8fe6b8', border:'none', borderRadius:8, padding:'4px 8px', fontSize:10, fontWeight:600, cursor:'pointer' }}>Limpar</button>
              <button onClick={()=>setMostrarLog(false)}
                style={{ background:'#1a3a2c', color:'#8fe6b8', border:'none', borderRadius:8, padding:'4px 8px', fontSize:10, fontWeight:600, cursor:'pointer' }}>✕</button>
            </div>
          </div>
          <div style={{ overflowY:'auto', fontFamily:'ui-monospace,monospace', fontSize:10, color:'#c8eed8', lineHeight:1.5 }}>
            {logs.map((l,i)=><div key={i} style={{ wordBreak:'break-word' }}>{l}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}

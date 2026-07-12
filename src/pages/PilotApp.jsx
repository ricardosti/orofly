import React, { useState, useRef, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { gerarPDFRelatorio } from '../lib/pdf'
import { registrarPush, enviarNotificacao } from '../lib/notifications'

const CLIENTES_DEFAULT = ['Raizen - Bonfim','Raizen - Santa Cândida','Raizen - Paraíso','Raizen - Zanin','Raizen - Serra','BrasilAgro','Bracell','Tereos - Vertente','Tereos - São José','Outros']
const DRONES_DEFAULT = ['DJI T70','DJI T50','DJI T25','DJI T25P','DJI T20P','DJI T100','DJI T55','Outros']
const PRODUTOS_DEFAULT = ['Triclon','Triomax','Moddus','Suiker','Roundup','Essenza','Spotlight','Agile','Volt','Mag8','Outros']
const COND_KEYS = ['faixa','vazao','vento','umidade','temperatura','delta_t']
const COND_LABELS = ['Faixa','Vazão','Vento','Umidade','Temperatura','Delta T']
const COND_PH = ['Ex: 5m','Ex: 2 L/ha','Ex: 8 km/h','Ex: 65%','Ex: 28°C','Ex: 4']
const STATUS_LABEL = { rascunho:'Rascunho', em_operacao:'🟢 Em operação', pausado:'🟡 Pausado', finalizado:'✅ Finalizado' }
const LS_KEY = 'orofly_draft'

function initForm(data) {
  const cond = {}
  COND_KEYS.forEach(k => { cond[k+'_i']=''; cond[k+'_f']='' })
  if (data) {
    COND_KEYS.forEach(k => { cond[k+'_i']=data[k+'_i']||''; cond[k+'_f']=data[k+'_f']||'' })
    const parseDt = iso => {
      if (!iso) return {data:'',hh:'',mm:''}
      const d=new Date(iso)
      return {data:d.toISOString().split('T')[0],hh:String(d.getHours()).padStart(2,'0'),mm:String(d.getMinutes()).padStart(2,'0')}
    }
    const ini=parseDt(data.dt_inicio), fim=parseDt(data.dt_fim)
    return {
      cliente:data.cliente||'',clienteOutro:'',fazenda:data.fazenda||'',area_ha:data.area_ha||'',
      piloto_nome:data.piloto_nome||'',drone:data.drone||'',droneOutro:'',
      produtos:data.produtos?.length?data.produtos:[''],
      tamanho_gota:data.tamanho_gota||'',velocidade_drone:data.velocidade_drone||'',
      localizacao:data.localizacao||'',gps_lat:data.gps_lat,gps_lng:data.gps_lng,
      ...cond,
      dt_inicio_data:ini.data,dt_inicio_hh:ini.hh,dt_inicio_mm:ini.mm,
      dt_fim_data:fim.data,dt_fim_hh:fim.hh,dt_fim_mm:fim.mm,
      pausas:data.pausas||[],obs1:data.obs1||'',obs2:data.obs2||'',
    }
  }
  return {
    cliente:'',clienteOutro:'',fazenda:'',area_ha:'',piloto_nome:'',drone:'',droneOutro:'',
    produtos:[''],tamanho_gota:'',velocidade_drone:'',
    localizacao:'',gps_lat:null,gps_lng:null,...cond,
    dt_inicio_data:'',dt_inicio_hh:'',dt_inicio_mm:'',
    dt_fim_data:'',dt_fim_hh:'',dt_fim_mm:'',
    pausas:[],obs1:'',obs2:'',compartilhado:false,
  }
}

function nowParts() {
  const n=new Date()
  return {
    data:`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`,
    hh:String(n.getHours()).padStart(2,'0'),
    mm:String(n.getMinutes()).padStart(2,'0'),
    iso:n.toISOString()
  }
}

function fmtDt(form,prefix) {
  const d=form[prefix+'_data'],hh=form[prefix+'_hh'],mm=form[prefix+'_mm']
  if(!d) return null
  return new Date(`${d}T${hh||'00'}:${mm||'00'}:00`).toISOString()
}

function DtRow({prefix,form,setForm,label}) {
  const hhs=Array.from({length:24},(_,i)=>String(i).padStart(2,'0'))
  const mms=Array.from({length:60},(_,i)=>String(i).padStart(2,'0'))
  return (
    <div style={s.field}>
      <div style={s.label}>{label}</div>
      <div style={s.dtRow}>
        <input type="date" style={s.dateInput} value={form[prefix+'_data']} onChange={e=>setForm(f=>({...f,[prefix+'_data']:e.target.value}))} />
        <div style={s.timeSelects}>
          <select style={s.timeSelect} value={form[prefix+'_hh']} onChange={e=>setForm(f=>({...f,[prefix+'_hh']:e.target.value}))}>
            <option value="">--</option>{hhs.map(h=><option key={h}>{h}</option>)}
          </select>
          <span style={s.timeSep}>:</span>
          <select style={s.timeSelect} value={form[prefix+'_mm']} onChange={e=>setForm(f=>({...f,[prefix+'_mm']:e.target.value}))}>
            <option value="">--</option>{mms.map(m=><option key={m}>{m}</option>)}
          </select>
        </div>
        <button style={s.nowBtn} onClick={()=>{const n=nowParts();setForm(f=>({...f,[prefix+'_data']:n.data,[prefix+'_hh']:n.hh,[prefix+'_mm']:n.mm}))}}>Agora</button>
      </div>
    </div>
  )
}

// Componentes de campo — fora do PilotApp para não perder foco a cada render
function FI({label,ph,val,onChange,type='text',styles}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:10,fontWeight:600,color:'#8aad94',letterSpacing:.5,marginBottom:5,display:'block',fontFamily:"'Syne',sans-serif"}}>{label}</label>
      <input type={type} style={{width:'100%',border:'1px solid #dde8e2',borderRadius:10,padding:'12px 14px',fontSize:14,color:'#111a14',outline:'none',background:'#fff',boxSizing:'border-box',fontFamily:"'DM Sans',sans-serif"}} placeholder={ph||''} value={val||''} onChange={onChange}/>
    </div>
  )
}
function FS({label,val,onChange,children}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:10,fontWeight:600,color:'#8aad94',letterSpacing:.5,marginBottom:5,display:'block',fontFamily:"'Syne',sans-serif"}}>{label}</label>
      <div style={{position:'relative'}}>
        <select style={{width:'100%',border:'1px solid #dde8e2',borderRadius:10,padding:'12px 14px',fontSize:14,color:'#111a14',outline:'none',background:'#fff',boxSizing:'border-box',fontFamily:"'DM Sans',sans-serif",appearance:'none'}} value={val||''} onChange={onChange}>{children}</select>
        <span style={{position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',color:'#aaa',pointerEvents:'none',fontSize:11}}>▼</span>
      </div>
    </div>
  )
}

export default function PilotApp({onSwitchMode}) {
  const {profile,signOut} = useAuth()
  const [view,setView] = useState('form')
  const [form,setForm] = useState(()=>{
    try { const d=localStorage.getItem(LS_KEY); if(d) return JSON.parse(d).form||initForm() } catch{}
    return initForm()
  })
  const [condTab,setCondTab] = useState('inicio')
  const [opState,setOpState] = useState(()=>{
    try { const d=localStorage.getItem(LS_KEY); if(d) return JSON.parse(d).opState||'idle' } catch{}
    return 'idle'
  })
  const [relId,setRelId] = useState(()=>{
    try { const d=localStorage.getItem(LS_KEY); if(d) return JSON.parse(d).relId||null } catch{}
    return null
  })
  const [saving,setSaving] = useState(false)
  const [saveStatus,setSaveStatus] = useState(null)
  const [toast,setToast] = useState('')
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [checklistItems, setChecklistItems] = useState({
    bateria: false, calibracao: false, area: false,
    clima: false, equipamento: false, comunicacao: false,
  })
  const [sosLoading, setSosLoading] = useState(false)
  const [dronesDB, setDronesDB] = useState([])
  const [produtosDB, setProdutosDB] = useState([])
  const [clientesDB, setClientesDB] = useState([])

  // Listas dinâmicas: banco + "Outros" no final
  const DRONES = dronesDB.length > 0
    ? [...dronesDB.filter(d=>d.ativo).map(d=>d.nome), 'Outros']
    : DRONES_DEFAULT
  const PRODUTOS_LIST = produtosDB.length > 0
    ? [...produtosDB.filter(p=>p.ativo).map(p=>p.nome), 'Outros']
    : PRODUTOS_DEFAULT
  const CLIENTES = clientesDB.length > 0
    ? [...clientesDB.filter(c=>c.ativo).map(c=>c.nome), 'Outros']
    : CLIENTES_DEFAULT
  const [sosConfirm,setSosConfirm] = useState(false)
  const [modalOpen,setModalOpen] = useState(false)
  const [exitConfirm,setExitConfirm] = useState(false)
  const [finalizeConfirm,setFinalizeConfirm] = useState(false)
  const [obsFotos,setObsFotos] = useState([null,null,null])
  const [obsFotoFiles,setObsFotoFiles] = useState([null,null,null])
  const [fotoMapa,setFotoMapa] = useState(null)
  const [fotoMapaFile,setFotoMapaFile] = useState(null)
  const [storageFotoMapa,setStorageFotoMapa] = useState(null)
  const [storageObsFotos,setStorageObsFotos] = useState([null,null,null])
  const [fotoPickerOpen, setFotoPickerOpen] = useState(null)
  const [wizardStep, setWizardStep] = useState(1)
  const [timerSecs, setTimerSecs] = useState(0)

  // Timer em tempo real durante o voo
  useEffect(() => {
    if (opState !== 'running') return
    const ini = new Date(Date.now() - timerSecs * 1000)
    const tick = () => setTimerSecs(s => s + 1)
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [opState]) // eslint-disable-line

  // Voos compartilhados
  const [voosCompartilhados, setVoosCompartilhados] = useState([])
  const [trechoModal, setTrechoModal] = useState(null) // relatorio que vai adicionar trecho
  const [trechoForm, setTrechoForm] = useState(null)
  const [trechoFotoMapa, setTrechoFotoMapa] = useState(null)
  const [trechoFotoMapaFile, setTrechoFotoMapaFile] = useState(null)
  const [trechoSaving, setTrechoSaving] = useState(false)
  const [kmlFiles,setKmlFiles] = useState([])
  const [flights,setFlights] = useState([])
  const [loadingFlights,setLoadingFlights] = useState(false)
  const toastTimer=useRef(null)
  const retryTimer=useRef(null)
  const pendingPayload=useRef(null)

  const showToast=useCallback((msg)=>{
    setToast(msg)
    if(toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current=setTimeout(()=>setToast(''),2800)
  },[])

  // Carrega drones, produtos e clientes do banco
  useEffect(() => {
    supabase.from('drones').select('nome,ativo').eq('ativo',true).order('nome')
      .then(({data}) => { if(data?.length) setDronesDB(data) })
    supabase.from('produtos').select('nome,ativo').eq('ativo',true).order('nome')
      .then(({data}) => { if(data?.length) setProdutosDB(data) })
    supabase.from('clientes').select('nome,ativo').eq('ativo',true).order('nome')
      .then(({data}) => { if(data?.length) setClientesDB(data) })
  }, [])

  // Carrega voos compartilhados abertos
  useEffect(() => {
    if (!profile) return
    supabase.from('relatorios')
      .select('id,cliente,fazenda,piloto_nome,drone,produtos,area_ha,dt_inicio,compartilhado_status,relatorio_trechos(id,piloto_id)')
      .eq('compartilhado', true)
      .eq('compartilhado_status', 'aberto')
      .neq('piloto_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) {
          // Filtra os que o piloto atual ainda não tem trecho
          const disponiveis = data.filter(r =>
            !(r.relatorio_trechos||[]).some(t => t.piloto_id === profile.id)
          )
          setVoosCompartilhados(disponiveis)
        }
      })
  }, [profile]) // eslint-disable-line

  function initTrechoForm() {
    const cond = {}
    COND_KEYS.forEach(k => { cond[k+'_i']=''; cond[k+'_f']='' })
    return { talhao:'', ...cond, dt_inicio_data:'', dt_inicio_hh:'', dt_inicio_mm:'', dt_fim_data:'', dt_fim_hh:'', dt_fim_mm:'', pausas:[], obs:'' }
  }

  async function salvarTrecho() {
    if (!trechoModal || !trechoForm) return
    setTrechoSaving(true)
    try {
      const dt_inicio = fmtDt(trechoForm,'dt_inicio')
      const dt_fim = fmtDt(trechoForm,'dt_fim')
      const cond = {}
      COND_KEYS.forEach(k => { cond[k+'_i']=trechoForm[k+'_i']||null; cond[k+'_f']=trechoForm[k+'_f']||null })

      let foto_mapa_url = null
      if (trechoFotoMapaFile) {
        const path = `${profile.id}/${trechoModal.id}/trecho_mapa.jpg`
        await supabase.storage.from('relatorios').upload(path, trechoFotoMapaFile, { upsert:true })
        foto_mapa_url = path
      }

      const { error } = await supabase.from('relatorio_trechos').insert({
        relatorio_id: trechoModal.id,
        piloto_id: profile.id,
        piloto_nome: profile.nome || profile.email,
        talhao: trechoForm.talhao,
        dt_inicio, dt_fim,
        pausas: trechoForm.pausas||[],
        ...cond,
        foto_mapa_url,
        obs: trechoForm.obs||null,
      })
      if (error) throw error
      showToast('✅ Trecho adicionado com sucesso!')
      setTrechoModal(null); setTrechoForm(null); setTrechoFotoMapa(null); setTrechoFotoMapaFile(null)
      // Atualiza lista de compartilhados
      setVoosCompartilhados(v => v.filter(x => x.id !== trechoModal.id))
    } catch(e) { showToast('Erro: '+e.message,'error') }
    setTrechoSaving(false)
  }

  // Carrega fotos do banco ao recuperar rascunho
  useEffect(() => {
    if (relId && opState !== 'idle') {
      supabase.from('relatorios').select('foto_mapa_url,obs_fotos_urls').eq('id', relId).single()
        .then(({ data }) => {
          if (data) {
            if (data.foto_mapa_url) setStorageFotoMapa(data.foto_mapa_url)
            if (data.obs_fotos_urls?.some(Boolean)) setStorageObsFotos(data.obs_fotos_urls)
          }
        })
    }
  }, [relId]) // eslint-disable-line
  useEffect(()=>{
    if(opState==='idle') return
    try { localStorage.setItem(LS_KEY,JSON.stringify({form,opState,relId})) } catch{}
  },[form,opState,relId])

  // Avisa ao fechar com operação em andamento
  useEffect(()=>{
    const handler=(e)=>{
      if(opState==='running'||opState==='paused'){
        e.preventDefault(); e.returnValue='Operação em andamento. Sair mesmo assim?'
        return e.returnValue
      }
    }
    window.addEventListener('beforeunload',handler)
    return ()=>window.removeEventListener('beforeunload',handler)
  },[opState])

  const clienteVal=form.cliente==='Outros'?form.clienteOutro:form.cliente
  const droneVal=form.drone==='Outros'?form.droneOutro:form.drone

  async function saveToSupabase(extraData={},retry=true) {
    const payload={
      piloto_id:profile.id,
      cliente:clienteVal,fazenda:form.fazenda,area_ha:form.area_ha,
      piloto_nome:form.piloto_nome||profile.nome,
      drone:droneVal,produtos:form.produtos.filter(Boolean),
      tamanho_gota:form.tamanho_gota,velocidade_drone:form.velocidade_drone,
      localizacao:form.localizacao,gps_lat:form.gps_lat,gps_lng:form.gps_lng,
      obs1:form.obs1,obs2:form.obs2,pausas:form.pausas,
      dt_inicio:fmtDt(form,'dt_inicio'),dt_fim:fmtDt(form,'dt_fim'),
      kml_arquivos:kmlFiles.map(f=>f.name),
      compartilhado:form.compartilhado||false,
      compartilhado_status:form.compartilhado?'aberto':'fechado',
      ...COND_KEYS.reduce((a,k)=>({...a,[k+'_i']:form[k+'_i'],[k+'_f']:form[k+'_f']}),{}),
      ...extraData
    }
    setSaveStatus('saving')
    try {
      let result
      if(relId){result=await supabase.from('relatorios').update(payload).eq('id',relId).select().single()}
      else{result=await supabase.from('relatorios').insert(payload).select().single();if(result.data)setRelId(result.data.id)}
      if(result.error) throw result.error
      setSaveStatus('saved');pendingPayload.current=null
      if(retryTimer.current) clearTimeout(retryTimer.current)
      return result.data
    } catch(err){
      setSaveStatus('error');pendingPayload.current={extraData}
      if(retry){if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=setTimeout(()=>{if(pendingPayload.current){showToast('🔄 Tentando salvar...');saveToSupabase(pendingPayload.current.extraData,false)}},10000)}
      return null
    }
  }

  // ---- SOS ----
  async function acionarSOS() {
    setSosConfirm(false)
    setSosLoading(true)
    showToast('🆘 Enviando SOS...')

    // Tenta capturar GPS atual
    let lat = form.gps_lat, lng = form.gps_lng
    try {
      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(pos => {
          lat = parseFloat(pos.coords.latitude.toFixed(6))
          lng = parseFloat(pos.coords.longitude.toFixed(6))
          setForm(f=>({...f,gps_lat:lat,gps_lng:lng}))
          resolve()
        }, () => resolve(), {enableHighAccuracy:true,timeout:5000})
      })
    } catch{}

    const mapsLink = lat ? `https://maps.google.com/?q=${lat},${lng}` : 'GPS não disponível'
    const pilotoNome = form.piloto_nome || profile.nome
    const clienteNome = clienteVal || 'sem cliente'

    // Salva evento SOS no banco
    try {
      await supabase.from('relatorios').upsert({
        id: relId || undefined,
        piloto_id: profile.id,
        piloto_nome: pilotoNome,
        cliente: clienteNome,
        gps_lat: lat, gps_lng: lng,
        status: 'sos',
        obs1: `🆘 SOS ACIONADO às ${new Date().toLocaleString('pt-BR')}`,
      })
    } catch{}

    // Envia push para todos os admins
    await enviarNotificacao({
      titulo: '🆘 SOS — ' + pilotoNome,
      corpo: `${pilotoNome} acionou SOS!\nCliente: ${clienteNome}\nLocalização: ${mapsLink}`,
      url: mapsLink,
      tag: 'sos-' + profile.id,
      requireInteraction: true,
    })

    setSosLoading(false)
    showToast('🆘 SOS enviado! Admins foram alertados.')
  }

  // ---- INICIAR VOO + PUSH ----
  async function opIniciar() {
    setSaving(true)
    const n=nowParts()
    const nf={...form,dt_inicio_data:n.data,dt_inicio_hh:n.hh,dt_inicio_mm:n.mm}
    setForm(nf); setOpState('running')
    const payload={
      piloto_id:profile.id,
      cliente:nf.cliente==='Outros'?nf.clienteOutro:nf.cliente,
      fazenda:nf.fazenda,area_ha:nf.area_ha,
      piloto_nome:nf.piloto_nome||profile.nome,
      drone:nf.drone==='Outros'?nf.droneOutro:nf.drone,
      produtos:nf.produtos.filter(Boolean),
      tamanho_gota:nf.tamanho_gota,velocidade_drone:nf.velocidade_drone,
      localizacao:nf.localizacao,gps_lat:nf.gps_lat,gps_lng:nf.gps_lng,
      obs1:nf.obs1,obs2:nf.obs2,pausas:[],
      dt_inicio:new Date(`${n.data}T${n.hh}:${n.mm}:00`).toISOString(),
      kml_arquivos:kmlFiles.map(f=>f.name),
      ...COND_KEYS.reduce((a,k)=>({...a,[k+'_i']:nf[k+'_i'],[k+'_f']:nf[k+'_f']}),{}),
      status:'em_operacao'
    }
    setSaveStatus('saving')
    try {
      const {data,error}=await supabase.from('relatorios').insert(payload).select().single()
      if(error) throw error
      setRelId(data.id); setSaveStatus('saved')

      // Notifica admins que voo iniciou
      const pilotoNome = nf.piloto_nome||profile.nome
      const clienteNome = nf.cliente==='Outros'?nf.clienteOutro:nf.cliente
      await enviarNotificacao({
        titulo: '🚁 Voo iniciado — ' + pilotoNome,
        corpo: `${pilotoNome} iniciou operação\nCliente: ${clienteNome||'—'}\nDrone: ${nf.drone==='Outros'?nf.droneOutro:nf.drone||'—'}`,
        tag: 'voo-inicio',
        requireInteraction: false,
      })

      showToast('✅ Operação iniciada!')
    } catch { setSaveStatus('error'); showToast('⚠️ Salvo localmente') }
    setSaving(false)
  }

  function opPausar() {
    if(opState==='running'){
      const n=nowParts()
      const novaPausa={inicio:n.iso,fim:null,motivo:''}
      setForm(f=>({...f,pausas:[...(f.pausas||[]),novaPausa]}))
      setOpState('paused')
      saveToSupabase({status:'pausado',pausas:[...(form.pausas||[]),novaPausa]})
      showToast('⏸ Pausado')
    } else if(opState==='paused'){
      const n=nowParts()
      const arr=[...(form.pausas||[])]
      const idx=arr.findLastIndex(p=>!p.fim)
      if(idx>=0) arr[idx]={...arr[idx],fim:n.iso}
      setForm(f=>({...f,pausas:arr}));setOpState('running')
      saveToSupabase({status:'em_operacao',pausas:arr})
      showToast('▶ Retomado')
    }
  }

  function validarFinalizar() {
    const erros=[]
    if(!clienteVal) erros.push('Cliente')
    if(!droneVal) erros.push('Drone')
    if(!form.dt_inicio_data) erros.push('Hora de início')
    const condFimVazias=COND_KEYS.filter(k=>!form[k+'_f'])
    if(condFimVazias.length>0) erros.push('Condições FIM')
    return erros
  }

  async function opFinalizar() {
    const erros=validarFinalizar()
    if(erros.length>0){setFinalizeConfirm({erros});return}
    await executarFinalizacao()
  }

  async function executarFinalizacao() {
    setFinalizeConfirm(null);setSaving(true)
    const n=nowParts()
    setForm(f=>({...f,dt_fim_data:n.data,dt_fim_hh:n.hh,dt_fim_mm:n.mm}))
    setOpState('finished')
    const rel=await saveToSupabase({status:'finalizado',dt_fim:n.iso})
    if(rel){
      const [obsUrls,mapaUrl]=await Promise.all([uploadFotos(rel.id),uploadFotoMapa(rel.id)])
      if(obsUrls.some(Boolean)||mapaUrl) await supabase.from('relatorios').update({obs_fotos_urls:obsUrls,foto_mapa_url:mapaUrl}).eq('id',rel.id)
      try {
        const doc=await gerarPDFRelatorio({...rel,dt_fim:n.iso},{supabase,localObsFotos:obsFotos,localFotoMapa:fotoMapa})
        await supabase.storage.from('pdfs').upload(`${profile.id}/${rel.id}/relatorio.pdf`,doc.output('blob'),{upsert:true})
        doc.save(`relatorio-orofly-${clienteVal.replace(/\s+/g,'-').toLowerCase()}.pdf`)
      } catch(e){console.error(e)}
    }
    try{localStorage.removeItem(LS_KEY)}catch{}
    setSaving(false);showToast('✅ Finalizado! PDF gerado.')
  }

  async function uploadFotos(rid) {
    const urls=[]
    for(let i=0;i<obsFotoFiles.length;i++){
      const file=obsFotoFiles[i];if(!file){urls.push(null);continue}
      const {error}=await supabase.storage.from('relatorios').upload(`${profile.id}/${rid}/obs_${i}.jpg`,file,{upsert:true})
      urls.push(error?null:`${profile.id}/${rid}/obs_${i}.jpg`)
    }
    return urls
  }
  async function uploadFotoMapa(rid){
    if(!fotoMapaFile) return null
    const path=`${profile.id}/${rid}/mapa.jpg`
    const {error}=await supabase.storage.from('relatorios').upload(path,fotoMapaFile,{upsert:true})
    return error?null:path
  }

  function getGPS(){
    if(!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(pos=>{
      setForm(f=>({...f,gps_lat:parseFloat(pos.coords.latitude.toFixed(6)),gps_lng:parseFloat(pos.coords.longitude.toFixed(6))}))
      showToast('✅ GPS capturado!')
    },()=>showToast('GPS: permissão negada'),{enableHighAccuracy:true,timeout:10000})
  }

  async function loadFlights(){
    setLoadingFlights(true)
    const {data}=await supabase.from('relatorios').select('*').eq('piloto_id',profile.id).order('created_at',{ascending:false}).limit(30)
    setFlights(data||[]);setLoadingFlights(false)
  }

  function openFlight(rel){
    setForm(initForm(rel)); setRelId(rel.id)
    setOpState(rel.status==='finalizado'?'finished':rel.status==='em_operacao'?'running':rel.status==='pausado'?'paused':'idle')
    // Limpa fotos locais — vão carregar do Storage via signed URLs
    setObsFotos([null,null,null]); setObsFotoFiles([null,null,null])
    setFotoMapa(null); setFotoMapaFile(null)
    // Salva paths para exibir do Storage
    setStorageFotoMapa(rel.foto_mapa_url||null)
    setStorageObsFotos(rel.obs_fotos_urls||[null,null,null])
    setView('form'); showToast('✏️ Voo carregado')
  }

  function tentarSair(){
    if(opState==='running'||opState==='paused') setExitConfirm(true)
    else signOut()
  }

  function limpar(){
    try{localStorage.removeItem(LS_KEY)}catch{}
    setForm(initForm());setOpState('idle');setRelId(null);setSaveStatus(null)
    setObsFotos([null,null,null]);setObsFotoFiles([null,null,null])
    setFotoMapa(null);setFotoMapaFile(null)
    setStorageFotoMapa(null);setStorageObsFotos([null,null,null])
    setKmlFiles([])
    showToast('🗑️ Formulário limpo')
  }

  const opLabel={idle:'Nova operação',running:'🟢 Em operação',paused:'🟡 Pausado',finished:'🔴 Finalizado'}[opState]

  // VIEW VOOS ANTERIORES
  // Labels e ícones dos steps
  const STEPS = [
    {n:1, label:'Identificação'},
    {n:2, label:'Aplicação'},
    {n:3, label:'Condições'},
    {n:4, label:'Finalizar'},
  ]

  const sw = {
    wrap:{maxWidth:480,margin:'0 auto',minHeight:'100vh',display:'flex',flexDirection:'column',background:'#fff',fontFamily:"'DM Sans',sans-serif"},
    header:{background:'#1a7a4a',padding:'calc(env(safe-area-inset-top,0px)+14px) 18px 0'},
    logoRow:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12},
    logoTxt:{fontFamily:"'Syne',sans-serif",fontSize:19,fontWeight:700,color:'#fff',display:'flex',alignItems:'center',gap:8},
    stepsWrap:{padding:'0 18px 14px'},
    stepsRow:{display:'flex',alignItems:'center'},
    stepCirc:{width:26,height:26,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0},
    stepDone:{background:'#fff',color:'#1a7a4a'},
    stepActive:{background:'#fff',color:'#1a7a4a',boxShadow:'0 0 0 3px rgba(255,255,255,0.4)'},
    stepNext:{background:'rgba(255,255,255,0.2)',color:'rgba(255,255,255,0.65)'},
    stepLine:{flex:1,height:2,background:'rgba(255,255,255,0.25)'},
    stepLineDone:{flex:1,height:2,background:'#fff'},
    stepLabelRow:{display:'flex',justifyContent:'space-between',marginTop:4},
    stepLbl:{fontSize:9,color:'rgba(255,255,255,0.6)',flex:1,textAlign:'center'},
    stepLblActive:{fontSize:9,color:'#fff',flex:1,textAlign:'center',fontWeight:700},
    body:{flex:1,overflowY:'auto',padding:'20px 18px 8px'},
    pageTitle:{fontSize:20,fontWeight:700,color:'#111a14',marginBottom:4,fontFamily:"'Syne',sans-serif"},
    pageSub:{fontSize:12,color:'#8aad94',marginBottom:20},
    fw:{marginBottom:14},
    fl:{fontSize:10,fontWeight:600,color:'#8aad94',letterSpacing:.5,marginBottom:5,display:'block',fontFamily:"'Syne',sans-serif"},
    fi:{width:'100%',border:'1px solid #dde8e2',borderRadius:10,padding:'12px 14px',fontSize:14,color:'#111a14',outline:'none',background:'#fff',boxSizing:'border-box',fontFamily:"'DM Sans',sans-serif"},
    fs:{width:'100%',border:'1px solid #dde8e2',borderRadius:10,padding:'12px 14px',fontSize:14,color:'#111a14',outline:'none',background:'#fff',boxSizing:'border-box',fontFamily:"'DM Sans',sans-serif",appearance:'none'},
    btnBar:{padding:'12px 18px 24px',background:'#fff',borderTop:'1px solid #f0f0f0',boxSizing:'border-box'},
    btnG:{width:'100%',background:'#1a7a4a',color:'#fff',border:'none',borderRadius:14,padding:'15px',fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:"'Syne',sans-serif",display:'flex',alignItems:'center',justifyContent:'center',gap:8},
    timerWrap:{display:'flex',flexDirection:'column',alignItems:'center',padding:'16px 0 10px'},
    statusBadge:(st)=>({display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:600,background:st==='running'?'#e8f5ee':st==='paused'?'#fff3e0':'#f5f5f5',color:st==='running'?'#1a7a4a':st==='paused'?'#e8a020':'#888'}),
  }

  const WHeader = () => (
    <div style={sw.header}>
      <div style={sw.logoRow}>
        <div style={sw.logoTxt}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Orofly
        </div>
        <div style={{display:'flex',gap:6}}>
          {onSwitchMode&&<button style={{background:'#f0c040',border:'none',color:'#111a14',borderRadius:8,padding:'5px 10px',fontSize:12,cursor:'pointer',fontWeight:600}} onClick={onSwitchMode}>⚙️</button>}
          <button style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:8,padding:'5px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>{loadFlights();setView('flights')}}>📋</button>
          <button style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:8,padding:'5px 10px',fontSize:12,cursor:'pointer'}} onClick={tentarSair}>Sair</button>
        </div>
      </div>
      <div style={sw.stepsWrap}>
        <div style={sw.stepsRow}>
          {STEPS.map((st,i)=>(
            <React.Fragment key={i}>
              {i>0&&<div style={wizardStep>i?sw.stepLineDone:sw.stepLine}/>}
              <div style={{...sw.stepCirc,...(wizardStep>st.n?sw.stepDone:wizardStep===st.n?sw.stepActive:sw.stepNext)}}>
                {wizardStep>st.n?'✓':st.n}
              </div>
            </React.Fragment>
          ))}
        </div>
        <div style={sw.stepLabelRow}>
          {STEPS.map((st,i)=>(
            <span key={i} style={wizardStep===st.n?sw.stepLblActive:sw.stepLbl}>{st.label}</span>
          ))}
        </div>
      </div>
    </div>
  )


  if(view==='flights') return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span style={s.logoTxt}>Orofly<span style={s.dot}>.</span></span></div>
          <div style={{display:'flex',gap:6}}>
            {onSwitchMode&&<button style={s.switchBtn} onClick={onSwitchMode}>⚙️ Admin</button>}
            <button style={s.logoutBtn} onClick={tentarSair}>Sair</button>
          </div>
        </div>
        <div style={s.headerSub}>Meus Voos · {profile?.nome}</div>
      </div>
      <div style={s.statusBar}><span>📋 Histórico de voos</span></div>
      <div style={{padding:16,flex:1,display:'flex',flexDirection:'column',gap:10}}>
        <button style={{...s.nowBtn,padding:'10px 16px',fontSize:13}} onClick={()=>setView('form')}>← Novo voo</button>
        {loadingFlights?<div style={{textAlign:'center',color:'#6b8070',padding:40}}>Carregando...</div>
        :flights.length===0?<div style={{textAlign:'center',color:'#6b8070',padding:40}}>Nenhum voo registrado</div>
        :flights.map(rel=>(
          <div key={rel.id} style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:'14px 16px',cursor:'pointer'}} onClick={()=>openFlight(rel)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontWeight:600,fontSize:14,color:'#111a14',fontFamily:"'Syne',sans-serif"}}>{rel.cliente||'—'}</div>
                <div style={{fontSize:12,color:'#6b8070',marginTop:2}}>{rel.fazenda}{rel.area_ha?` · ${rel.area_ha}ha`:''} · {rel.drone}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:12,fontWeight:600,color:{em_operacao:'#1a7a4a',pausado:'#e8a020',finalizado:'#185fa5',sos:'#c0392b'}[rel.status]||'#6b8070'}}>{STATUS_LABEL[rel.status]||rel.status}</div>
                <div style={{fontSize:11,color:'#6b8070',marginTop:2}}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}</div>
              </div>
            </div>
            <div style={{fontSize:12,color:'#aaa',marginTop:6}}>Toque para abrir ✏️</div>
          </div>
        ))}
      </div>
      {toast&&<div style={s.toast}>{toast}</div>}
    </div>
  )

  return (
    <div style={sw.wrap}>
      <WHeader/>

      {/* ══ STEP 1 — IDENTIFICAÇÃO ══ */}
      {wizardStep===1&&(
        <>
          <div style={sw.body}>
            <div style={sw.pageTitle}>Identificação da Operação</div>
            <div style={sw.pageSub}>Passo 1 de 4: Dados do voo</div>

            <div style={{marginBottom:14,background:form.compartilhado?'#e8f5ee':'#fafcfa',borderRadius:12,padding:'12px 14px',border:`1px solid ${form.compartilhado?'#1a7a4a':'#dde8e2'}`,display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer'}}
              onClick={()=>setForm(f=>({...f,compartilhado:!f.compartilhado}))}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:form.compartilhado?'#1a7a4a':'#6b8070'}}>🤝 Voo Compartilhado</div>
                <div style={{fontSize:11,color:'#8aad94',marginTop:2}}>{form.compartilhado?'Outros pilotos podem adicionar trechos':'Apenas você registra este voo'}</div>
              </div>
              <div style={{width:42,height:24,borderRadius:12,background:form.compartilhado?'#1a7a4a':'#dde8e2',position:'relative',transition:'all .2s',flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:9,background:'#fff',position:'absolute',top:3,left:form.compartilhado?21:3,transition:'all .2s'}}/>
              </div>
            </div>

            <FS label="CLIENTE" val={form.cliente} onChange={e=>setForm(f=>({...f,cliente:e.target.value}))}>
              <option value="">Selecione o Cliente...</option>
              {CLIENTES.map(c=><option key={c}>{c}</option>)}
            </FS>
            {form.cliente==='Outros'&&<FI label="NOME DO CLIENTE" ph="Digite o nome..." val={form.clienteOutro} onChange={e=>setForm(f=>({...f,clienteOutro:e.target.value}))}/>}
            <FI label="FAZENDA" ph="Nome da Fazenda" val={form.fazenda} onChange={e=>setForm(f=>({...f,fazenda:e.target.value}))}/>
            <FI label="ÁREA (HA)" ph="Ex: 50.5" val={form.area_ha} onChange={e=>setForm(f=>({...f,area_ha:e.target.value}))} type="number"/>
            <FI label="PILOTO" ph={profile?.nome||'Nome do piloto'} val={form.piloto_nome||profile?.nome||''} onChange={e=>setForm(f=>({...f,piloto_nome:e.target.value}))}/>
            <FS label="DRONE" val={form.drone} onChange={e=>setForm(f=>({...f,drone:e.target.value}))}>
              <option value="">Selecione o Drone...</option>
              {DRONES.map(d=><option key={d}>{d}</option>)}
            </FS>
            {form.drone==='Outros'&&<FI label="NOME DO DRONE" ph="..." val={form.droneOutro} onChange={e=>setForm(f=>({...f,droneOutro:e.target.value}))}/>}

            {form.produtos.map((p,i)=>{
              const parts=p?p.split(' - '):[''];const nome=parts[0]||'';const dosagem=parts.slice(1).join(' - ')||''
              const selectVal=PRODUTOS_LIST.includes(nome)?nome:(nome?'Outros':'')
              return (
                <div key={i} style={{marginBottom:14}}>
                  <label style={sw.fl}>PRODUTO {form.produtos.length>1?i+1:''}</label>
                  <div style={{display:'flex',gap:8}}>
                    <div style={{flex:1,position:'relative'}}>
                      <select style={{...sw.fs,paddingRight:32}} value={selectVal}
                        onChange={e=>{const arr=[...form.produtos];arr[i]=e.target.value==='Outros'?'':e.target.value+(dosagem?` - ${dosagem}`:'');setForm(f=>({...f,produtos:arr}))}}>
                        <option value="">Selecione...</option>
                        {PRODUTOS_LIST.map(pr=><option key={pr}>{pr}</option>)}
                      </select>
                      <span style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:'#aaa',pointerEvents:'none',fontSize:11}}>▼</span>
                    </div>
                    <input style={{...sw.fi,width:110,flexShrink:0}} placeholder="Dosagem" value={dosagem}
                      onChange={e=>{const arr=[...form.produtos];arr[i]=nome?`${nome} - ${e.target.value}`:e.target.value;setForm(f=>({...f,produtos:arr}))}}/>
                    {form.produtos.length>1&&<button style={{background:'none',border:'none',color:'#c0392b',fontSize:22,cursor:'pointer',padding:'0 4px'}} onClick={()=>setForm(f=>({...f,produtos:f.produtos.filter((_,j)=>j!==i)}))}>×</button>}
                  </div>
                  {(selectVal==='Outros'||(!PRODUTOS_LIST.includes(nome)&&nome))&&(
                    <input style={{...sw.fi,marginTop:8}} placeholder="Nome do produto..." value={nome==='Outros'?'':nome}
                      onChange={e=>{const arr=[...form.produtos];arr[i]=dosagem?`${e.target.value} - ${dosagem}`:e.target.value;setForm(f=>({...f,produtos:arr}))}}/>
                  )}
                </div>
              )
            })}
            <button style={{width:'100%',background:'#f4f8f5',border:'1px dashed #c3e0d0',color:'#1a7a4a',borderRadius:10,padding:'11px',fontSize:13,fontWeight:500,cursor:'pointer',marginBottom:14}} onClick={()=>setForm(f=>({...f,produtos:[...f.produtos,'']}))}>+ Adicionar produto</button>
            <FI label="TAMANHO DA GOTA" ph="Ex: Média, Grossa..." val={form.tamanho_gota} onChange={e=>setForm(f=>({...f,tamanho_gota:e.target.value}))}/>
            <FI label="VELOCIDADE DO DRONE" ph="Ex: 7 m/s" val={form.velocidade_drone} onChange={e=>setForm(f=>({...f,velocidade_drone:e.target.value}))}/>
            <FI label="LOCALIZAÇÃO / TALHÃO" ph="Ex: Talhão 5, Zona 65..." val={form.localizacao} onChange={e=>setForm(f=>({...f,localizacao:e.target.value}))}/>
            <div style={sw.fw}>
              <label style={sw.fl}>GPS</label>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{flex:1,fontSize:13,color:form.gps_lat?'#1a7a4a':'#aaa'}}>{form.gps_lat?`${form.gps_lat}, ${form.gps_lng}`:'Não capturado'}</span>
                <button style={{background:'#1a7a4a',color:'#fff',border:'none',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:500,cursor:'pointer',flexShrink:0}} onClick={getGPS}>📍 Capturar</button>
              </div>
              {form.gps_lat&&<a style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#1a7a4a',textDecoration:'none',marginTop:6}} href={`https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}`} target="_blank" rel="noreferrer">🗺️ Ver no Maps</a>}
            </div>

            {voosCompartilhados.length>0&&(
              <div style={{background:'#fffbea',border:'2px solid #f0c040',borderRadius:12,padding:14,marginTop:4}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:'#7a5c00',marginBottom:10}}>🤝 Voos Compartilhados ({voosCompartilhados.length})</div>
                {voosCompartilhados.map(v=>(
                  <div key={v.id} style={{background:'#fff',borderRadius:10,padding:'10px 12px',marginBottom:8,border:'1px solid #f0d070'}}>
                    <div style={{fontWeight:700,fontSize:13,color:'#111a14'}}>{v.cliente} — {v.fazenda}</div>
                    <div style={{fontSize:11,color:'#6b8070',marginTop:2}}>Piloto: {v.piloto_nome}</div>
                    <button style={{marginTop:8,background:'#f0c040',color:'#3a2a00',border:'none',borderRadius:8,padding:'6px 14px',fontSize:12,fontWeight:700,cursor:'pointer',width:'100%'}}
                      onClick={()=>{ setTrechoModal(v); setTrechoForm(initTrechoForm()) }}>➕ Adicionar meu trecho</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={sw.btnBar}>
            <button style={sw.btnG} onClick={()=>setWizardStep(2)}>Próximo →</button>
          </div>
        </>
      )}

      {/* ══ STEP 2 — APLICAÇÃO ══ */}
      {wizardStep===2&&(
        <>
          <div style={sw.body}>
            <div style={sw.pageTitle}>Aplicação</div>
            <div style={sw.pageSub}>Passo 2 de 4: Controle do voo</div>

            <div style={{background:'#1a7a4a',borderRadius:14,padding:'14px 16px',color:'#fff',marginBottom:16}}>
              <div style={{fontSize:12,opacity:.8,marginBottom:2}}>Cliente · Fazenda</div>
              <div style={{fontSize:14,fontWeight:600}}>{clienteVal||'—'} · {form.fazenda||'—'}</div>
              {form.area_ha&&<div style={{fontSize:12,opacity:.85,marginTop:4}}>Área: <strong>{form.area_ha} ha</strong></div>}
            </div>

            <div style={{display:'flex',justifyContent:'center',marginBottom:16}}>
              <span style={sw.statusBadge(opState)}>
                <span style={{width:7,height:7,borderRadius:'50%',background:opState==='running'?'#1a7a4a':opState==='paused'?'#e8a020':'#aaa',display:'inline-block'}}/>
                {opLabel}
              </span>
            </div>

            {(opState==='running'||opState==='paused')&&(()=>{
              const h=Math.floor(timerSecs/3600),m=Math.floor((timerSecs%3600)/60),sec=timerSecs%60
              const pad=n=>String(n).padStart(2,'0')
              const circ=289, pct=(timerSecs%3600)/3600, offset=circ-(circ*pct)
              return (
                <div style={sw.timerWrap}>
                  <svg width="130" height="130" viewBox="0 0 130 130">
                    <circle cx="65" cy="65" r="46" fill="none" stroke="#e8f5ee" strokeWidth="7"/>
                    <circle cx="65" cy="65" r="46" fill="none" stroke={opState==='paused'?'#e8a020':'#1a7a4a'} strokeWidth="7"
                      strokeDasharray="289" strokeDashoffset={offset}
                      strokeLinecap="round" transform="rotate(-90 65 65)"
                      style={{transition:'stroke-dashoffset 1s linear'}}/>
                    <text x="65" y="70" textAnchor="middle" fontSize="19" fontWeight="700" fill="#111a14" fontFamily="DM Sans,sans-serif">
                      {pad(h)}:{pad(m)}:{pad(sec)}
                    </text>
                  </svg>
                  <div style={{fontSize:11,color:'#8aad94',marginTop:4}}>{opState==='paused'?'⏸ PAUSADO':'tempo de operação'}</div>
                </div>
              )
            })()}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
              <button style={{background:'#e8f5ee',border:'none',borderRadius:12,padding:'14px 6px',display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer',opacity:opState!=='idle'?.4:1}}
                disabled={opState!=='idle'||saving}
                onClick={()=>{setChecklistItems({bateria:false,calibracao:false,area:false,clima:false,equipamento:false,comunicacao:false});setChecklistOpen(true)}}>
                <span style={{fontSize:22}}>▶️</span>
                <span style={{fontSize:11,fontWeight:600,color:'#1a7a4a'}}>Iniciar</span>
              </button>
              <button style={{background:'#fff3e0',border:'none',borderRadius:12,padding:'14px 6px',display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer',opacity:(opState==='running'||opState==='paused')?1:.4}}
                disabled={opState!=='running'&&opState!=='paused'} onClick={opPausar}>
                <span style={{fontSize:22}}>{opState==='paused'?'▶️':'⏸️'}</span>
                <span style={{fontSize:11,fontWeight:600,color:'#e8a020'}}>{opState==='paused'?'Retomar':'Pausar'}</span>
              </button>
              <button style={{background:'#fdeaea',border:'none',borderRadius:12,padding:'14px 6px',display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer',opacity:(opState==='running'||opState==='paused')?1:.4}}
                disabled={opState!=='running'&&opState!=='paused'} onClick={()=>{opFinalizar();setWizardStep(4)}}>
                <span style={{fontSize:22}}>⏹️</span>
                <span style={{fontSize:11,fontWeight:600,color:'#c0392b'}}>Finalizar</span>
              </button>
            </div>

            {(opState==='running'||opState==='paused')&&(
              <button style={{background:sosLoading?'#a93226':'#e74c3c',color:'#fff',border:'none',borderRadius:12,padding:'14px',width:'100%',fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,cursor:'pointer',letterSpacing:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginBottom:16}}
                onClick={()=>!sosLoading&&setSosConfirm(true)} disabled={sosLoading}>
                🆘 {sosLoading?'ENVIANDO SOS...':'SOS — EMERGÊNCIA'}
              </button>
            )}

            {relId&&opState!=='idle'&&(
              <div style={{background:'#e8f5ee',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#1a7a4a',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <span>✅ Dados salvos automaticamente</span>
                <button style={{background:'#1a7a4a',color:'#fff',border:'none',borderRadius:7,padding:'4px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>saveToSupabase({status:opState==='running'?'em_operacao':'pausado'})}>{saveStatus==='saving'?'...':'💾'}</button>
              </div>
            )}

            <div style={{fontSize:12,fontWeight:600,color:'#6b8070',marginBottom:10,fontFamily:"'Syne',sans-serif"}}>HORÁRIOS</div>
            <DtRow prefix="dt_inicio" form={form} setForm={setForm} label="INÍCIO" />
            <DtRow prefix="dt_fim" form={form} setForm={setForm} label="FIM" />
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,marginTop:8}}>
              <span style={{fontSize:11,fontWeight:600,color:'#8aad94'}}>PAUSAS</span>
              <button style={{background:'#f4f8f5',border:'1px solid #d0e4d8',color:'#1a7a4a',borderRadius:8,padding:'4px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>setForm(f=>({...f,pausas:[...(f.pausas||[]),{inicio:new Date().toISOString(),fim:null,motivo:''}]}))}>+ Pausa</button>
            </div>
            {(form.pausas||[]).map((pausa,i)=>(
              <div key={i} style={{background:'#f9fbfa',borderRadius:10,padding:'10px 12px',marginBottom:8,border:'1px solid #e8eee8'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#6b8070'}}>Pausa {i+1}</span>
                  <button style={{background:'none',border:'none',color:'#c0392b',cursor:'pointer',fontSize:16}} onClick={()=>setForm(f=>({...f,pausas:f.pausas.filter((_,j)=>j!==i)}))}>×</button>
                </div>
                <input style={{...sw.fi,marginBottom:4,fontSize:13}} placeholder="Motivo..." value={pausa.motivo||''} onChange={e=>{const arr=[...form.pausas];arr[i]={...arr[i],motivo:e.target.value};setForm(f=>({...f,pausas:arr}))}}/>
                <div style={{fontSize:11,color:'#8aad94'}}>{new Date(pausa.inicio).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} → {pausa.fim?new Date(pausa.fim).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'em andamento'}</div>
              </div>
            ))}
          </div>
          <div style={sw.btnBar}>
            <div style={{display:'flex',gap:8}}>
              <button style={{...sw.btnG,background:'#f4f8f5',color:'#6b8070',flex:'0 0 80px'}} onClick={()=>setWizardStep(1)}>← Voltar</button>
              <button style={{...sw.btnG,flex:1}} onClick={()=>setWizardStep(3)}>Próximo →</button>
            </div>
          </div>
        </>
      )}

      {/* ══ STEP 3 — CONDIÇÕES CLIMÁTICAS ══ */}
      {wizardStep===3&&(
        <>
          <div style={sw.body}>
            <div style={sw.pageTitle}>Condições Climáticas</div>
            <div style={sw.pageSub}>Passo 3 de 4: Início e fim da aplicação</div>
            <div style={{display:'flex',background:'#f4f8f5',borderRadius:10,padding:4,marginBottom:20}}>
              {['inicio','fim'].map(t=>(
                <button key={t} style={{flex:1,padding:'9px',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',background:condTab===t?'#fff':'transparent',color:condTab===t?'#1a7a4a':'#8aad94',boxShadow:condTab===t?'0 1px 3px rgba(0,0,0,.08)':'none'}}
                  onClick={()=>setCondTab(t)}>{t==='inicio'?'INÍCIO':'FIM'}</button>
              ))}
            </div>
            {COND_KEYS.map((k,i)=>(
              <FI key={k} label={COND_LABELS[i].toUpperCase()} ph={COND_PH[i]}
                val={form[k+'_'+(condTab==='inicio'?'i':'f')]}
                onChange={e=>setForm(f=>({...f,[k+'_'+(condTab==='inicio'?'i':'f')]:e.target.value}))}/>
            ))}
          </div>
          <div style={sw.btnBar}>
            <div style={{display:'flex',gap:8}}>
              <button style={{...sw.btnG,background:'#f4f8f5',color:'#6b8070',flex:'0 0 80px'}} onClick={()=>setWizardStep(2)}>← Voltar</button>
              <button style={{...sw.btnG,flex:1}} onClick={()=>setWizardStep(4)}>Próximo →</button>
            </div>
          </div>
        </>
      )}

      {/* ══ STEP 4 — FINALIZAR ══ */}
      {wizardStep===4&&(
        <>
          <div style={sw.body}>
            <div style={sw.pageTitle}>Finalizar</div>
            <div style={sw.pageSub}>Passo 4 de 4: Fotos, KML e observações</div>

            <div style={{marginBottom:16}}>
              <label style={sw.fl}>FOTOS DE OBSERVAÇÃO</label>
              <div style={{display:'flex',gap:8}}>
                {[0,1,2].map(i=>(
                  <div key={i} style={{flex:1,display:'flex',flexDirection:'column',gap:4}}>
                    <div style={{border:'1.5px dashed #dde8e2',borderRadius:12,padding:'10px 4px',textAlign:'center',cursor:'pointer',minHeight:66,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',overflow:'hidden',background:'#fafcfa',...((obsFotos[i]||storageObsFotos[i])?{border:'none',padding:0}:{})}}
                      onClick={()=>setFotoPickerOpen({tipo:'obs',idx:i})}>
                      {obsFotos[i]?<img src={obsFotos[i]} alt="" style={{width:'100%',height:60,objectFit:'cover',borderRadius:10}}/>
                        :storageObsFotos[i]?<StorageFotoSlot supabase={supabase} path={storageObsFotos[i]}/>
                        :<><div style={{fontSize:22}}>📷</div><div style={{fontSize:10,color:'#aaa',marginTop:2}}>Foto {i+1}</div></>}
                    </div>
                    {(obsFotos[i]||storageObsFotos[i])&&(
                      <button style={{background:'#fdeaea',color:'#c0392b',border:'none',borderRadius:6,padding:'3px',fontSize:10,cursor:'pointer'}}
                        onClick={async e=>{e.stopPropagation();const a=[...obsFotos];a[i]=null;setObsFotos(a);const b=[...obsFotoFiles];b[i]=null;setObsFotoFiles(b);showToast('🗑️ Foto removida')}}>🗑️</button>
                    )}
                    <input id={`obs-galeria-${i}`} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const a=[...obsFotos];a[i]=ev.target.result;setObsFotos(a)};r.readAsDataURL(f);const a=[...obsFotoFiles];a[i]=f;setObsFotoFiles(a)}}/>
                    <input id={`obs-camera-${i}`} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const a=[...obsFotos];a[i]=ev.target.result;setObsFotos(a)};r.readAsDataURL(f);const a=[...obsFotoFiles];a[i]=f;setObsFotoFiles(a)}}/>
                  </div>
                ))}
              </div>
            </div>

            <div style={sw.fw}>
              <label style={sw.fl}>MAPA DE PÓS APLICAÇÃO</label>
              <div style={{border:'1.5px dashed #dde8e2',borderRadius:12,padding:18,textAlign:'center',cursor:'pointer',background:'#fafcfa',...((fotoMapa||storageFotoMapa)?{padding:0,border:'none'}:{})}}
                onClick={()=>setFotoPickerOpen({tipo:'mapa',idx:0})}>
                <input id="mapa-galeria" type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setFotoMapa(ev.target.result);r.readAsDataURL(f);setFotoMapaFile(f)}}/>
                <input id="mapa-camera" type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setFotoMapa(ev.target.result);r.readAsDataURL(f);setFotoMapaFile(f)}}/>
                {fotoMapa?<img src={fotoMapa} alt="mapa" style={{width:'100%',borderRadius:12,maxHeight:180,objectFit:'cover'}}/>
                  :storageFotoMapa?<StorageFotoSlot supabase={supabase} path={storageFotoMapa} height={180}/>
                  :<><div style={{fontSize:28}}>🗺️</div><div style={{fontSize:13,color:'#aaa',marginTop:6}}>Toque para adicionar foto do mapa</div></>}
              </div>
            </div>

            <div style={sw.fw}>
              <label style={sw.fl}>ARQUIVOS KML</label>
              {kmlFiles.map((f,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:8,background:'#f4f8f5',borderRadius:10,padding:'10px 12px',marginBottom:6,border:'1px solid #e8eee8'}}>
                  <span>📄</span><span style={{flex:1,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
                  <button style={{background:'none',border:'none',color:'#c0392b',fontSize:18,cursor:'pointer'}} onClick={()=>setKmlFiles(a=>a.filter((_,j)=>j!==i))}>×</button>
                </div>
              ))}
              <label style={{display:'block',border:'1.5px dashed #dde8e2',borderRadius:10,padding:13,textAlign:'center',cursor:'pointer',background:'#fafcfa'}}>
                <input type="file" accept=".kml,.kmz" multiple style={{display:'none'}} onChange={e=>setKmlFiles(a=>[...a,...Array.from(e.target.files)])}/>
                <span style={{fontSize:13,color:'#8aad94'}}>📂 Adicionar KML / KMZ</span>
              </label>
            </div>

            <div style={sw.fw}>
              <label style={sw.fl}>OBS 1</label>
              <textarea style={{...sw.fi,resize:'none',height:70}} value={form.obs1} onChange={e=>setForm(f=>({...f,obs1:e.target.value}))}/>
            </div>
            <div style={sw.fw}>
              <label style={sw.fl}>OBS 2</label>
              <textarea style={{...sw.fi,resize:'none',height:70}} value={form.obs2} onChange={e=>setForm(f=>({...f,obs2:e.target.value}))}/>
            </div>

            {opState==='finished'&&(
              <button style={{...sw.btnG,background:'#e8f5ee',color:'#1a7a4a',border:'1.5px solid #1a7a4a',marginBottom:10}} onClick={limpar}>✈️ Iniciar Novo Voo</button>
            )}
          </div>
          <div style={sw.btnBar}>
            <div style={{display:'flex',gap:8}}>
              <button style={{...sw.btnG,background:'#f4f8f5',color:'#6b8070',flex:'0 0 80px'}} onClick={()=>setWizardStep(3)}>← Voltar</button>
              <button style={{...sw.btnG,flex:1,opacity:opState==='finished'?1:.5,cursor:opState==='finished'?'pointer':'default'}} disabled={opState!=='finished'||saving} onClick={()=>setModalOpen(true)}>
                {saving?'Aguarde...':'📄 Ver Relatório'}
              </button>
            </div>
          </div>
        </>
      )}


      {trechoModal && trechoForm && (
        <div style={s.modalOverlay}>
          <div style={{...s.modal,maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{...s.modalTitle,marginBottom:4}}>
              🤝 Adicionar Trecho
              <button style={s.modalClose} onClick={()=>{setTrechoModal(null);setTrechoForm(null);setTrechoFotoMapa(null);setTrechoFotoMapaFile(null)}}>✕</button>
            </div>
            <div style={{fontSize:11,color:'#6b8070',marginBottom:14}}>
              {trechoModal.cliente} — {trechoModal.fazenda} · Piloto principal: {trechoModal.piloto_nome}
            </div>

            {/* Talhão */}
            <div style={s.field}>
              <div style={s.label}>TALHÃO / LOCALIZAÇÃO</div>
              <input style={s.input} placeholder="Ex: Talhão 5, Zona 65..." value={trechoForm.talhao}
                onChange={e=>setTrechoForm(f=>({...f,talhao:e.target.value}))} />
            </div>

            {/* Horários */}
            <DtRow prefix="dt_inicio" form={trechoForm} setForm={setTrechoForm} label="INÍCIO" />
            <DtRow prefix="dt_fim" form={trechoForm} setForm={setTrechoForm} label="FIM" />

            {/* Condições */}
            <div style={{...s.secCard,marginTop:8}}>
              <div style={s.secTitle}>🌡️ CONDIÇÕES CLIMÁTICAS</div>
              {COND_KEYS.map(k=>(
                <div key={k} style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                  <div>
                    <div style={s.label}>{k.toUpperCase()} INÍCIO</div>
                    <input style={s.input} value={trechoForm[k+'_i']} onChange={e=>setTrechoForm(f=>({...f,[k+'_i']:e.target.value}))} />
                  </div>
                  <div>
                    <div style={s.label}>{k.toUpperCase()} FIM</div>
                    <input style={s.input} value={trechoForm[k+'_f']} onChange={e=>setTrechoForm(f=>({...f,[k+'_f']:e.target.value}))} />
                  </div>
                </div>
              ))}
            </div>

            {/* Foto mapa */}
            <div style={{marginTop:8}}>
              <div style={s.label}>FOTO DO MAPA (SEU TALHÃO)</div>
              <div style={{...s.photoArea,...(trechoFotoMapa?{padding:0,border:'none'}:{cursor:'pointer'})}}
                onClick={()=>document.getElementById('trecho-foto-input')?.click()}>
                <input id="trecho-foto-input" type="file" accept="image/*" style={{display:'none'}}
                  onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setTrechoFotoMapa(ev.target.result);r.readAsDataURL(f);setTrechoFotoMapaFile(f)}} />
                {trechoFotoMapa
                  ? <img src={trechoFotoMapa} alt="mapa" style={{width:'100%',borderRadius:8,maxHeight:140,objectFit:'cover'}}/>
                  : <><div style={{fontSize:22}}>🗺️</div><div style={{fontSize:12,color:'#6b8070',marginTop:4}}>Toque para adicionar foto do mapa</div></>}
              </div>
            </div>

            {/* Obs */}
            <div style={{...s.field,marginTop:8}}>
              <div style={s.label}>OBSERVAÇÕES</div>
              <textarea style={{...s.input,height:60,resize:'none'}} value={trechoForm.obs}
                onChange={e=>setTrechoForm(f=>({...f,obs:e.target.value}))} />
            </div>

            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button style={{...s.shareBtn,background:'#f4f8f5',color:'#6b8070',flex:1}}
                onClick={()=>{setTrechoModal(null);setTrechoForm(null);setTrechoFotoMapa(null);setTrechoFotoMapaFile(null)}}>
                Cancelar
              </button>
              <button style={{...s.shareBtn,flex:2,opacity:trechoSaving?.6:1}} disabled={trechoSaving}
                onClick={salvarTrecho}>
                {trechoSaving?'Salvando...':'✅ Salvar Trecho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHECKLIST PRÉ-VOO */}
      {checklistOpen && (
        <div style={s.modalOverlay} onClick={()=>{}}>
          <div style={{...s.modal,paddingBottom:28}} onClick={e=>e.stopPropagation()}>
            <div style={{...s.modalTitle,marginBottom:4}}>
              ✅ Checklist Pré-Voo
              <button style={s.modalClose} onClick={()=>setChecklistOpen(false)}>✕</button>
            </div>
            <div style={{fontSize:12,color:'#6b8070',marginBottom:18}}>Confirme os itens antes de iniciar. Você pode pular se preferir.</div>
            {[
              ['bateria','🔋','Bateria carregada e verificada'],
              ['calibracao','🧭','Drone calibrado (bússola e IMU)'],
              ['area','📍','Área de operação verificada e segura'],
              ['clima','🌤️','Condições climáticas favoráveis'],
              ['equipamento','🔧','Equipamento e bocais verificados'],
              ['comunicacao','📡','Comunicação com a equipe estabelecida'],
            ].map(([key,icon,label])=>(
              <div key={key} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 0',borderBottom:'1px solid #f0f4f1',cursor:'pointer'}}
                onClick={()=>setChecklistItems(c=>({...c,[key]:!c[key]}))}>
                <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${checklistItems[key]?'#1a7a4a':'#d0e4d8'}`,background:checklistItems[key]?'#1a7a4a':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .15s'}}>
                  {checklistItems[key]&&<span style={{color:'#fff',fontSize:13,fontWeight:700}}>✓</span>}
                </div>
                <span style={{fontSize:15}}>{icon}</span>
                <span style={{fontSize:14,color:checklistItems[key]?'#111a14':'#6b8070',fontWeight:checklistItems[key]?500:400}}>{label}</span>
              </div>
            ))}
            <div style={{marginTop:6,padding:'8px 0',fontSize:12,color:'#6b8070',textAlign:'center'}}>
              {Object.values(checklistItems).filter(Boolean).length} / {Object.keys(checklistItems).length} itens confirmados
            </div>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button style={{...s.shareBtn,background:'#f4f8f5',color:'#6b8070',flex:1,fontSize:13}} onClick={()=>{setChecklistOpen(false);opIniciar()}}>
                Pular checklist
              </button>
              <button style={{...s.shareBtn,background:'#1a7a4a',flex:2,position:'relative',overflow:'hidden'}} onClick={()=>{setChecklistOpen(false);opIniciar()}}>
                {Object.values(checklistItems).every(Boolean)?'✅ Tudo pronto — Iniciar!':'▶ Iniciar assim mesmo'}
                <div style={{position:'absolute',bottom:0,left:0,right:0,height:3,background:'#f0c040'}}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RELATÓRIO */}
      {modalOpen&&(
        <div style={s.modalOverlay} onClick={()=>setModalOpen(false)}>
          <div style={s.modal} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>Relatório <button style={s.modalClose} onClick={()=>setModalOpen(false)}>✕</button></div>
            <ReportView form={form} clienteVal={clienteVal} droneVal={droneVal} kmlFiles={kmlFiles}/>
            <button style={{...s.shareBtn,background:'#111a14',marginTop:12}} onClick={async()=>{
              const rel=await saveToSupabase({status:'finalizado'})
              if(rel){const doc=await gerarPDFRelatorio(rel,{supabase,localObsFotos:obsFotos,localFotoMapa:fotoMapa});doc.save('relatorio-orofly.pdf');showToast('✅ PDF salvo!')}
            }}>📄 Baixar PDF</button>
            <button style={{...s.shareBtn,background:'#25D366',marginTop:8}} onClick={()=>window.open('https://wa.me/?text='+encodeURIComponent(buildTxt(form,clienteVal,droneVal)),'_blank')}>💬 WhatsApp</button>
          </div>
        </div>
      )}

      {/* CONFIRM SOS */}
      {sosConfirm&&(
        <div style={s.modalOverlay} onClick={()=>setSosConfirm(false)}>
          <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
            <div style={{...s.modalTitle,color:'#c0392b'}}>🆘 Confirmar SOS</div>
            <p style={{fontSize:15,color:'#111a14',marginBottom:8,lineHeight:1.6}}>Isso vai alertar <strong>todos os administradores</strong> imediatamente com sua localização GPS.</p>
            <p style={{fontSize:13,color:'#e74c3c',marginBottom:24}}>Use apenas em caso de emergência real.</p>
            <div style={{display:'flex',gap:10}}>
              <button style={{...s.shareBtn,background:'#f4f8f5',color:'#6b8070',flex:1}} onClick={()=>setSosConfirm(false)}>Cancelar</button>
              <button style={{...s.shareBtn,background:'#c0392b',flex:1}} onClick={acionarSOS}>🆘 Confirmar SOS</button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM SAIR */}
      {exitConfirm&&(
        <div style={s.modalOverlay} onClick={()=>setExitConfirm(false)}>
          <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>⚠️ Operação em andamento</div>
            <p style={{fontSize:14,color:'#6b8070',marginBottom:20,lineHeight:1.6}}>Você tem uma operação em andamento. Os dados estão salvos. Deseja sair?</p>
            <div style={{display:'flex',gap:10}}>
              <button style={{...s.shareBtn,background:'#f4f8f5',color:'#6b8070',flex:1}} onClick={()=>setExitConfirm(false)}>Cancelar</button>
              <button style={{...s.shareBtn,background:'#c0392b',flex:1}} onClick={()=>{setExitConfirm(false);signOut()}}>Sair</button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM FINALIZAR */}
      {finalizeConfirm&&(
        <div style={s.modalOverlay} onClick={()=>setFinalizeConfirm(null)}>
          <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>⚠️ Campos obrigatórios</div>
            <p style={{fontSize:14,color:'#6b8070',marginBottom:8}}>Os seguintes campos estão incompletos:</p>
            <ul style={{paddingLeft:20,marginBottom:20}}>{finalizeConfirm.erros.map(e=><li key={e} style={{fontSize:14,color:'#c0392b',marginBottom:4}}>{e}</li>)}</ul>
            <div style={{display:'flex',gap:10}}>
              <button style={{...s.shareBtn,background:'#f4f8f5',color:'#6b8070',flex:1}} onClick={()=>setFinalizeConfirm(null)}>Voltar</button>
              <button style={{...s.shareBtn,background:'#e8a020',flex:1}} onClick={executarFinalizacao}>Finalizar assim mesmo</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CÂMERA / GALERIA */}
      {fotoPickerOpen && (
        <div style={s.modalOverlay} onClick={()=>setFotoPickerOpen(null)}>
          <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:'#111a14',marginBottom:20}}>📷 Adicionar foto</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <button style={{background:'#1a7a4a',color:'#fff',border:'none',borderRadius:12,padding:14,fontSize:15,fontFamily:"'Syne',sans-serif",fontWeight:600,cursor:'pointer'}}
                onClick={()=>{
                  const id = fotoPickerOpen.tipo==='mapa' ? 'mapa-camera' : `obs-camera-${fotoPickerOpen.idx}`
                  setFotoPickerOpen(null)
                  setTimeout(()=>document.getElementById(id)?.click(),150)
                }}>📸 Tirar foto com câmera</button>
              <button style={{background:'#185fa5',color:'#fff',border:'none',borderRadius:12,padding:14,fontSize:15,fontFamily:"'Syne',sans-serif",fontWeight:600,cursor:'pointer'}}
                onClick={()=>{
                  const id = fotoPickerOpen.tipo==='mapa' ? 'mapa-galeria' : `obs-galeria-${fotoPickerOpen.idx}`
                  setFotoPickerOpen(null)
                  setTimeout(()=>document.getElementById(id)?.click(),150)
                }}>🖼️ Escolher da galeria</button>
              <button style={{background:'#f4f8f5',color:'#6b8070',border:'none',borderRadius:12,padding:12,fontSize:14,cursor:'pointer'}}
                onClick={()=>setFotoPickerOpen(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {toast&&<div style={s.toast}>{toast}</div>}
    </div>
  )
}

// Componente para mostrar foto do Storage no PilotApp
function StorageFotoSlot({ supabase, path, height=60 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!path) return
    supabase.storage.from('relatorios').createSignedUrl(path, 3600).then(({data,error}) => {
      if (!error && data?.signedUrl) setUrl(data.signedUrl)
    })
  }, [path, supabase])
  if (!url) return <div style={{fontSize:10,color:'#6b8070',padding:8}}>⏳</div>
  return <img src={url} alt="foto" style={{width:'100%',height,objectFit:'cover',borderRadius:8,display:'block'}} />
}

function ReportView({form,clienteVal,droneVal,kmlFiles=[]}) {
  const fmt=p=>{const d=form[p+'_data'],hh=form[p+'_hh'],mm=form[p+'_mm'];if(!d)return'—';return`${d.split('-').reverse().join('/')} ${hh||'00'}:${mm||'00'}`}
  const rows=[
    ['Cliente',clienteVal],['Fazenda',form.fazenda],['Área',form.area_ha?form.area_ha+' ha':null],
    ['Piloto',form.piloto_nome],['Drone',droneVal],
    ...form.produtos.filter(Boolean).map((p,i)=>['Produto '+(i+1),p]),
    ['Gota',form.tamanho_gota],['Velocidade',form.velocidade_drone],
    ['Início',fmt('dt_inicio')],['Fim',fmt('dt_fim')],
    ...(form.pausas||[]).map((p,i)=>['Pausa '+(i+1),p.motivo||'—']),
    ...COND_KEYS.map((k,i)=>[COND_LABELS[i]+' ini',form[k+'_i']]),
    ...COND_KEYS.map((k,i)=>[COND_LABELS[i]+' fim',form[k+'_f']]),
    ['Obs 1',form.obs1],['Obs 2',form.obs2],
  ].filter(([,v])=>v)
  return <div>{rows.map(([l,v])=>(
    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #f0f4f1',fontSize:13}}>
      <span style={{color:'#6b8070',fontWeight:500,minWidth:110}}>{l}</span>
      <span style={{color:'#111a14',textAlign:'right',flex:1,wordBreak:'break-word'}}>{v}</span>
    </div>
  ))}</div>
}

function buildTxt(form,clienteVal,droneVal){
  const fmt=p=>{const d=form[p+'_data'],hh=form[p+'_hh'],mm=form[p+'_mm'];if(!d)return'—';return`${d.split('-').reverse().join('/')} ${hh||'00'}:${mm||'00'}`}
  let t='🚁 RELATÓRIO OROFLY\n'+new Date().toLocaleString('pt-BR')+'\n\n'
  t+=`Cliente: ${clienteVal}\nFazenda: ${form.fazenda}\nPiloto: ${form.piloto_nome}\nDrone: ${droneVal}\n`
  form.produtos.filter(Boolean).forEach((p,i)=>{t+=`Produto ${i+1}: ${p}\n`})
  t+=`\nInício: ${fmt('dt_inicio')}\nFim: ${fmt('dt_fim')}\n`
  t+='\nCondições Início:\n';COND_KEYS.forEach((k,i)=>{t+=`  ${COND_LABELS[i]}: ${form[k+'_i']||'—'}\n`})
  t+='Condições Fim:\n';COND_KEYS.forEach((k,i)=>{t+=`  ${COND_LABELS[i]}: ${form[k+'_f']||'—'}\n`})
  return t
}

function Sec({title,icon,children}){return <div style={s.section}><div style={s.sectionHeader}>{icon} {title}</div>{children}</div>}

const s={
  wrap:{maxWidth:480,margin:'0 auto',minHeight:'100vh',display:'flex',flexDirection:'column',background:'#f4f8f5',fontFamily:"'DM Sans',sans-serif"},
  // ── Header verde novo design ──
  header:{background:'#1a7a4a',padding:'calc(env(safe-area-inset-top,0px)+14px) 18px 12px'},
  headerInner:{display:'flex',alignItems:'center',justifyContent:'space-between'},
  logo:{display:'flex',alignItems:'center',gap:8},
  logoTxt:{fontFamily:"'Syne',sans-serif",fontSize:19,fontWeight:700,color:'#fff',letterSpacing:-0.5},
  dot:{color:'rgba(255,255,255,0.6)'},
  headerSub:{fontSize:11,color:'rgba(255,255,255,0.7)',marginTop:3},
  logoutBtn:{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:8,padding:'5px 10px',fontSize:12,cursor:'pointer'},
  switchBtn:{background:'#f0c040',border:'none',color:'#111a14',borderRadius:8,padding:'5px 10px',fontSize:12,cursor:'pointer',fontWeight:600},
  // ── Steps bar ──
  stepsBar:{background:'#1a7a4a',padding:'6px 18px 14px',display:'flex',flexDirection:'column',alignItems:'center',gap:4},
  stepsRow:{display:'flex',alignItems:'center',gap:0},
  stepCircle:{width:26,height:26,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700},
  stepDone:{background:'#fff',color:'#1a7a4a'},
  stepActive:{background:'#fff',color:'#1a7a4a',boxShadow:'0 0 0 3px rgba(255,255,255,0.35)'},
  stepNext:{background:'rgba(255,255,255,0.2)',color:'rgba(255,255,255,0.7)'},
  stepLine:{width:30,height:2,background:'rgba(255,255,255,0.3)'},
  stepLineDone:{width:30,height:2,background:'#fff'},
  stepLabel:{fontSize:10,color:'rgba(255,255,255,0.8)',letterSpacing:0.3},
  // ── Status / op bar ──
  statusBar:{background:'#1a7a4a',padding:'6px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:12,color:'rgba(255,255,255,0.85)'},
  statusDot:{display:'inline-block',width:7,height:7,background:'#f0c040',borderRadius:'50%',marginRight:5},
  opBar:{display:'flex',gap:8,padding:'10px 16px',background:'#fff',borderBottom:'1px solid #e8f0ec'},
  opBtn:{flex:1,padding:'10px 4px',border:'none',borderRadius:12,fontFamily:"'Syne',sans-serif",fontSize:12,fontWeight:600,cursor:'pointer',color:'#fff'},
  // ── Body e cards ──
  body:{padding:14,flex:1,display:'flex',flexDirection:'column',gap:10,paddingBottom:80},
  section:{background:'#fff',borderRadius:14,border:'0.5px solid #e0ecea',overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'},
  sectionHeader:{background:'#f2f9f5',padding:'9px 14px',fontFamily:"'Syne',sans-serif",fontSize:10,fontWeight:600,letterSpacing:1,textTransform:'uppercase',color:'#1a7a4a',borderBottom:'0.5px solid #e0ecea'},
  field:{padding:'11px 14px',borderBottom:'0.5px solid #f0f5f2'},
  label:{fontSize:10,fontWeight:600,color:'#8aad94',letterSpacing:.5,marginBottom:4,fontFamily:"'Syne',sans-serif",textTransform:'uppercase'},
  input:{width:'100%',border:'none',outline:'none',fontFamily:"'DM Sans',sans-serif",fontSize:14,color:'#111a14',background:'transparent'},
  textarea:{width:'100%',border:'none',outline:'none',fontFamily:"'DM Sans',sans-serif",fontSize:14,color:'#111a14',background:'transparent',resize:'none'},
  select:{width:'100%',border:'none',outline:'none',fontFamily:"'DM Sans',sans-serif",fontSize:14,color:'#111a14',background:'transparent',appearance:'none',cursor:'pointer'},
  dtRow:{display:'flex',alignItems:'center',gap:6},
  dateInput:{flex:1,border:'none',outline:'none',fontFamily:"'DM Sans',sans-serif",fontSize:14,color:'#111a14',background:'transparent',appearance:'none'},
  timeSelects:{display:'flex',alignItems:'center',gap:2},
  timeSelect:{background:'#f2f9f5',border:'1px solid #d0e4d8',borderRadius:7,color:'#111a14',fontSize:14,padding:'3px 4px',width:48,textAlign:'center',appearance:'none',cursor:'pointer',outline:'none'},
  timeSep:{fontSize:16,fontWeight:600,color:'#6b8070'},
  nowBtn:{background:'#f2f9f5',border:'1px solid #d0e4d8',color:'#1a7a4a',borderRadius:8,padding:'4px 10px',fontSize:12,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0},
  gpsRow:{display:'flex',alignItems:'center',gap:8},
  gpsBtn:{background:'#1a7a4a',color:'#fff',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0},
  mapsLink:{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#1a7a4a',textDecoration:'none',marginTop:6},
  tabs:{display:'flex',borderBottom:'0.5px solid #e0ecea'},
  tab:{flex:1,padding:9,fontSize:12,fontWeight:600,textAlign:'center',cursor:'pointer',color:'#8aad94',borderBottom:'2px solid transparent',fontFamily:"'Syne',sans-serif",letterSpacing:.5},
  tabActive:{color:'#1a7a4a',borderBottomColor:'#1a7a4a'},
  prodInput:{background:'#f4f8f5',border:'1px solid #e0ecea',borderRadius:10,padding:'8px 10px',fontSize:14,fontFamily:"'DM Sans',sans-serif",color:'#111a14',outline:'none'},
  remBtn:{background:'none',border:'none',color:'#c0392b',fontSize:20,cursor:'pointer',flexShrink:0},
  addBtn:{background:'#f2f9f5',border:'1px dashed #c3e0d0',color:'#1a7a4a',borderRadius:10,padding:'10px 12px',fontSize:13,fontWeight:500,cursor:'pointer',width:'100%',display:'flex',alignItems:'center',justifyContent:'center'},
  obsFotos:{display:'flex',gap:8,padding:'0 14px 14px'},
  fotoSlot:{flex:1,border:'1.5px dashed #d0e4d8',borderRadius:12,padding:'10px 4px',textAlign:'center',cursor:'pointer',minHeight:66,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',overflow:'hidden',background:'#fafcfa'},
  fotoSlotImg:{width:'100%',height:56,objectFit:'cover',borderRadius:8},
  photoArea:{margin:'0 14px 14px',border:'1.5px dashed #d0e4d8',borderRadius:12,padding:18,textAlign:'center',cursor:'pointer',display:'block',background:'#fafcfa'},
  kmlItem:{display:'flex',alignItems:'center',gap:8,background:'#f4f8f5',borderRadius:10,padding:'8px 14px',margin:'4px 14px 0',border:'0.5px solid #e0ecea'},
  kmlAdd:{margin:'8px 14px 14px',border:'1.5px dashed #d0e4d8',borderRadius:12,padding:13,textAlign:'center',cursor:'pointer',display:'block'},
  footer:{padding:'0 14px 16px',display:'flex',flexDirection:'column',gap:10},
  btnPrimary:{background:'#1a7a4a',color:'#fff',border:'none',borderRadius:14,padding:16,fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:600,cursor:'pointer',position:'relative',overflow:'hidden'},
  btnAccent:{position:'absolute',bottom:0,left:0,right:0,height:3,background:'#f0c040'},
  btnSecondary:{background:'transparent',color:'#1a7a4a',border:'1.5px solid #1a7a4a',borderRadius:14,padding:13,fontSize:14,fontWeight:500,cursor:'pointer'},
  // ── Timer circular ──
  timerWrap:{display:'flex',flexDirection:'column',alignItems:'center',padding:'16px 0 10px'},
  // ── Bottom nav ──
  bottomNav:{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'#fff',borderTop:'0.5px solid #e0ecea',display:'flex',zIndex:50,paddingBottom:'env(safe-area-inset-bottom,0px)'},
  navItem:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',padding:'8px 4px 10px',gap:2,cursor:'pointer',border:'none',background:'none'},
  navIcon:{fontSize:20,color:'#b0c4b8'},
  navIconActive:{fontSize:20,color:'#1a7a4a'},
  navLabel:{fontSize:9,color:'#b0c4b8',fontWeight:500,fontFamily:"'Syne',sans-serif"},
  navLabelActive:{fontSize:9,color:'#1a7a4a',fontWeight:700,fontFamily:"'Syne',sans-serif"},
  // ── Modals ──
  modalOverlay:{position:'fixed',inset:0,background:'rgba(0,0,0,.55)',zIndex:100,display:'flex',alignItems:'flex-end',justifyContent:'center'},
  modal:{background:'#fff',borderRadius:'20px 20px 0 0',padding:'24px 20px 32px',width:'100%',maxWidth:480,maxHeight:'85vh',overflowY:'auto'},
  modalTitle:{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:700,color:'#111a14',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'},
  modalClose:{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#6b8070'},
  shareBtn:{color:'#fff',border:'none',borderRadius:14,padding:14,fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:600,cursor:'pointer',width:'100%'},
  toast:{position:'fixed',bottom:80,left:'50%',transform:'translateX(-50%)',background:'#111a14',color:'#fff',padding:'12px 24px',borderRadius:100,fontSize:13,fontWeight:500,zIndex:200,whiteSpace:'nowrap',borderBottom:'3px solid #f0c040'},
}

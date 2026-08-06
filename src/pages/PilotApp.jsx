import React, { useState, useRef, useCallback, useEffect } from 'react'
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { gerarPDFRelatorio, calcularGastoProdutos, parseDoseProduto, areaLiquida } from '../lib/pdf'
import { registrarPush, enviarNotificacao } from '../lib/notifications'
import { compartilharNativo, salvarOuCompartilharPdf } from '../lib/nativeShare'
import ProfileModal from '../components/ProfileModal'
import { CATEGORIA_DESPESA_OPTS } from '../lib/categoriasDespesa'
import { calcDeltaT, classificarClimaParam } from '../lib/clima'
import { Clock, Map, FileBarChart2, CalendarDays, Receipt, CloudSun } from 'lucide-react'

// Ícone de "nova missão" — trilha pontilhada até um pin de mapa
const IconRota = ({size=22}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="4.5" cy="5.5" r="1.5" fill="currentColor"/>
    <circle cx="9" cy="8.5" r="1.2" fill="currentColor" opacity="0.75"/>
    <circle cx="13" cy="12.5" r="1" fill="currentColor" opacity="0.55"/>
    <path d="M18.5 14.5c0 3.6-4 6.5-4 6.5s-4-2.9-4-6.5a4 4 0 1 1 8 0z" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
    <circle cx="14.5" cy="14.5" r="1.4" fill="currentColor"/>
  </svg>
)

// Ícone de drone (traço, no mesmo estilo do lucide-react) — não existe pronto na lib
const IconDrone = ({size=24,color='currentColor'}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2.5"/>
    <path d="M9.5 9.5 5 5M14.5 9.5 19 5M9.5 14.5 5 19M14.5 14.5 19 19"/>
    <circle cx="4.5" cy="4.5" r="2"/>
    <circle cx="19.5" cy="4.5" r="2"/>
    <circle cx="4.5" cy="19.5" r="2"/>
    <circle cx="19.5" cy="19.5" r="2"/>
  </svg>
)

// Anel de progresso circular (usado no card de Manutenção Próxima)
const CircularGauge = ({pct=0, size=42, color='#f2960f', track='#f7ddb0'}) => {
  const r = (size-7)/2, c = 2*Math.PI*r
  const clamped = Math.min(100,Math.max(0,pct))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={track} strokeWidth="5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${c*clamped/100} ${c}`} transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x="50%" y="51%" textAnchor="middle" dominantBaseline="central" fontSize={size*0.26} fontWeight="700" fill="#0b1210" fontFamily="'Syne',sans-serif">{Math.round(clamped)}%</text>
    </svg>
  )
}

const CLIENTES_DEFAULT = ['Raizen - Bonfim','Raizen - Santa Cândida','Raizen - Paraíso','Raizen - Zanin','Raizen - Serra','BrasilAgro','Bracell','Tereos - Vertente','Tereos - São José','Outros']
const DRONES_DEFAULT = ['DJI T70','DJI T50','DJI T25','DJI T25P','DJI T20P','DJI T100','DJI T55','Outros']
const PRODUTOS_DEFAULT = ['Triclon','Triomax','Moddus','Suiker','Roundup','Essenza','Spotlight','Agile','Volt','Mag8','Outros']
const CULTURAS = ['Cana-de-açúcar','Soja','Milho','Eucalipto','Café','Algodão','Laranja','Citros','Arroz','Trigo','Sorgo','Feijão','Pastagem','Outras']
const COND_KEYS = ['faixa','vazao','vento','umidade','temperatura','delta_t']
const COND_LABELS = ['Faixa','Vazão','Vento','Umidade','Temperatura','Delta T']
const COND_PH = ['Ex: 5m','Ex: 2 L/ha','Ex: 8 km/h','Ex: 65%','Ex: 28°C','Ex: 4']
const STATUS_LABEL = { rascunho:'Rascunho', em_operacao:'🟢 Em operação', pausado:'🟡 Pausado', pausado_dia:'🌙 Finalizado Parcial', finalizado:'✅ Finalizado' }
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
      cultura:data.cultura||'',cliente:data.cliente||'',clienteOutro:'',
      fazenda:data.fazenda||'',produto:data.produto||'',area_ha:data.area_ha||'',talhao:data.talhao||data.localizacao||'',
      qtd_voos:data.qtd_voos||1,tipo_servico:data.tipo_servico||'area_total',
      piloto_nome:data.piloto_nome||'',drone:data.drone||'',droneOutro:'',
      produtos:data.produtos?.length
        ? data.produtos.map(p=>{
            // Remove unidade da dosagem para edição: "Moddus - 1.1 Kg/ha" → "Moddus - 1.1"
            const parts=p.split(' - ')
            if(parts.length<2) return p
            const dose=parts.slice(1).join(' - ').replace(/\s*[a-zA-Zµ]+\/ha\s*$/,'').trim()
            return `${parts[0]} - ${dose}`
          })
        : [''],
      tamanho_gota:data.tamanho_gota||'',velocidade_drone:data.velocidade_drone||'',
      localizacao:data.localizacao||'',gps_lat:data.gps_lat,gps_lng:data.gps_lng,
      ...cond,
      dt_inicio_data:ini.data,dt_inicio_hh:ini.hh,dt_inicio_mm:ini.mm,
      dt_fim_data:fim.data,dt_fim_hh:fim.hh,dt_fim_mm:fim.mm,
      pausas:data.pausas||[],obs1:data.obs1||'',obs2:data.obs2||'',bordadura:data.bordadura||'',
      bordaduraPorTalhao:data.bordadura_detalhe?.length ? Object.fromEntries(data.bordadura_detalhe.map(d=>[d.talhao,String(d.bordadura)])) : {},
      evid_meta:data.evidencia_meta||{},
      area_feita:data.area_feita!=null?String(data.area_feita):'',
      area_deduzida:data.area_deduzida!=null?String(data.area_deduzida):'',
      teste:!!data.teste,
    }
  }
  return {
    cultura:'',cliente:'',clienteOutro:'',fazenda:'',produto:'',area_ha:'',talhao:'',qtd_voos:1,tipo_servico:'area_total',
    piloto_nome:'',drone:'',droneOutro:'',
    produtos:[''],tamanho_gota:'',velocidade_drone:'',
    localizacao:'',gps_lat:null,gps_lng:null,...cond,
    dt_inicio_data:'',dt_inicio_hh:'',dt_inicio_mm:'',
    dt_fim_data:'',dt_fim_hh:'',dt_fim_mm:'',
    pausas:[],obs1:'',obs2:'',bordadura:'',bordaduraPorTalhao:{},evid_meta:{},
    area_feita:'',area_deduzida:'',teste:false,
  }
}

// Cache local de listas de referência (drones/produtos/clientes/fazendas/talhões),
// pra funcionar offline com o último cadastro conhecido em vez de ficar vazio
function loadCache(key) {
  try { const c = localStorage.getItem(key); return c ? JSON.parse(c) : [] } catch { return [] }
}
function saveCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch {}
}

// Bordadura total do form em edição: soma por talhão (multi-seleção) ou valor único
function bordaduraAtual(form) {
  const talhoesSel = (form.talhao||'').split(',').map(s=>s.trim()).filter(Boolean)
  if (talhoesSel.length > 1) return talhoesSel.reduce((a,nome)=>a+(parseFloat(form.bordaduraPorTalhao?.[nome])||0),0)
  return parseFloat(form.bordadura)||0
}
function areaLiquidaAtual(form) {
  return Math.max(0, +(((parseFloat(form.area_ha)||0)-bordaduraAtual(form))).toFixed(2))
}
// Progresso do Finalizado Parcial: quanto já foi feito (líquido) vs a meta líquida (área total menos bordadura)
function progressoParcial(form) {
  const total = areaLiquidaAtual(form)
  const feita = Math.max(0, parseFloat(form.area_feita)||0)
  const pct = total>0 ? Math.min(100, Math.round((feita/total)*100)) : 0
  return {total, feita, pct}
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
  let d=form[prefix+'_data'],hh=form[prefix+'_hh'],mm=form[prefix+'_mm']
  if(!d) return null
  // Converte DD/MM/YYYY → YYYY-MM-DD se necessário
  if(d.includes('/')) {
    const parts=d.split('/')
    if(parts.length===3) d=`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`
  }
  const iso = new Date(`${d}T${hh||'00'}:${mm||'00'}:00`)
  if(isNaN(iso.getTime())) return null
  return iso.toISOString()
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
function FI({label,ph,val,onChange,type='text',styles,disabled}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:5,display:'block',fontFamily:"'Syne',sans-serif"}}>{label}</label>
      <input type={type} disabled={disabled} style={{width:'100%',border:'1px solid #e0ece5',borderRadius:10,padding:'12px 14px',fontSize:14,color:'#0b1210',outline:'none',background:disabled?'#f1f8f4':'#fff',boxSizing:'border-box',fontFamily:"'DM Sans',sans-serif",opacity:disabled?.6:1}} placeholder={ph||''} value={val||''} onChange={onChange}/>
    </div>
  )
}
function FS({label,val,onChange,children}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:5,display:'block',fontFamily:"'Syne',sans-serif"}}>{label}</label>
      <div style={{position:'relative'}}>
        <select style={{width:'100%',border:'1px solid #e0ece5',borderRadius:10,padding:'12px 14px',fontSize:14,color:'#0b1210',outline:'none',background:'#fff',boxSizing:'border-box',fontFamily:"'DM Sans',sans-serif",appearance:'none'}} value={val||''} onChange={onChange}>{children}</select>
        <span style={{position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',color:'#aaa',pointerEvents:'none',fontSize:11}}>▼</span>
      </div>
    </div>
  )
}

function classificarCondicaoGeral(form, sufixo) {
  const params = ['vento','umidade','temperatura','delta_t']
  const resultados = params.map(k => classificarClimaParam(k, form[k+sufixo])).filter(Boolean)
  if (resultados.length === 0) return null
  if (resultados.some(r => r.status === 'nao_conforme')) return { status: 'nao_conforme', label: 'NÃO RECOMENDADO', cor: '#e5484d' }
  if (resultados.some(r => r.status === 'alerta')) return { status: 'alerta', label: 'ATENÇÃO', cor: '#f2960f' }
  return { status: 'apta', label: 'CONDIÇÕES APTAS PARA VOO', cor: '#0e9f6e' }
}

const PARAM_ICONS = { vento: '💨', umidade: '💧', temperatura: '🌡️', delta_t: '⚖️' }
const PARAM_LABELS = { vento: 'VENTO', umidade: 'UMIDADE', temperatura: 'TEMPERATURA', delta_t: 'DELTA T' }
const PARAM_UNITS = { vento: 'km/h', umidade: '%', temperatura: '°C', delta_t: '°C' }

// Extrai data original (EXIF DateTimeOriginal, fallback data do arquivo) e GPS (se houver) da foto
async function extrairMetadadosFoto(file) {
  const fallback = { data: new Date(file.lastModified).toLocaleString('pt-BR'), lat: null, lng: null }
  try {
    if (!file.type.startsWith('image/jpe')) return fallback
    const buf = await file.slice(0, 256*1024).arrayBuffer()
    const view = new DataView(buf)
    if (view.getUint16(0) !== 0xFFD8) return fallback // não é JPEG
    let offset = 2
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset)
      if (marker === 0xFFE1) { // APP1 (EXIF)
        const exifStart = offset + 10 // pula APP1 header + "Exif\0\0"
        const little = view.getUint16(exifStart) === 0x4949
        const get16 = o => view.getUint16(o, little)
        const get32 = o => view.getUint32(o, little)
        const ifd0 = exifStart + get32(exifStart + 4)
        const nIfd0 = get16(ifd0)
        let exifIfdPtr = null, gpsIfdPtr = null
        for (let i = 0; i < nIfd0; i++) {
          const e = ifd0 + 2 + i*12
          const tag = get16(e)
          if (tag === 0x8769) exifIfdPtr = exifStart + get32(e + 8)
          if (tag === 0x8825) gpsIfdPtr = exifStart + get32(e + 8)
        }

        let data = fallback.data
        if (exifIfdPtr) {
          const nExif = get16(exifIfdPtr)
          for (let i = 0; i < nExif; i++) {
            const e = exifIfdPtr + 2 + i*12
            if (get16(e) === 0x9003) { // DateTimeOriginal
              const strOff = exifStart + get32(e + 8)
              let s = ''
              for (let j = 0; j < 19; j++) s += String.fromCharCode(view.getUint8(strOff + j))
              // "2026:07:16 14:32:05" → "16/07/2026 14:32"
              const m = s.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/)
              if (m) data = `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`
            }
          }
        }

        let lat = null, lng = null
        if (gpsIfdPtr) {
          const nGps = get16(gpsIfdPtr)
          let latRef = null, lngRef = null, latDms = null, lngDms = null
          const readDms = (valOff) => [0,1,2].map(k => get32(valOff + k*8) / get32(valOff + k*8 + 4))
          for (let i = 0; i < nGps; i++) {
            const e = gpsIfdPtr + 2 + i*12
            const tag = get16(e)
            if (tag === 0x0001) latRef = String.fromCharCode(view.getUint8(e + 8)) // N/S
            else if (tag === 0x0003) lngRef = String.fromCharCode(view.getUint8(e + 8)) // E/W
            else if (tag === 0x0002) latDms = readDms(exifStart + get32(e + 8)) // GPSLatitude
            else if (tag === 0x0004) lngDms = readDms(exifStart + get32(e + 8)) // GPSLongitude
          }
          if (latDms && lngDms) {
            const toDecimal = ([d,m,s], ref) => { const v = d + m/60 + s/3600; return (ref === 'S' || ref === 'W') ? -v : v }
            lat = +toDecimal(latDms, latRef).toFixed(6)
            lng = +toDecimal(lngDms, lngRef).toFixed(6)
          }
        }

        return { data, lat, lng }
      }
      offset += 2 + view.getUint16(offset + 2)
    }
    return fallback
  } catch { return fallback }
}

export default function PilotApp({onSwitchMode}) {
  const {profile,signOut,refreshProfile} = useAuth()
  const [showPerfil,setShowPerfil] = useState(false)
  const [avatarUrl,setAvatarUrl] = useState(null)
  const [gpsPos,setGpsPos] = useState(null)
  const [notaTab,setNotaTab] = useState('viagem')
  useEffect(() => {
    if (!profile?.avatar_url) { setAvatarUrl(null); return }
    supabase.storage.from('relatorios').createSignedUrl(profile.avatar_url, 3600).then(({data,error})=>{
      if (error) console.error('Erro ao gerar URL do avatar:', error)
      if (data?.signedUrl) setAvatarUrl(data.signedUrl)
    })
  }, [profile?.avatar_url])
  const [view,setView] = useState('home')
  const isPopRef = useRef(false)
  const isFirstViewRef = useRef(true)

  // Faz o botão/gesto de voltar do navegador (e do Android) navegar entre as telas do
  // app em vez de sair do site — sem isso não há histórico de navegação nenhum, então
  // "voltar" tenta sair da página logo na primeira tela.
  useEffect(() => {
    window.history.replaceState({view:'home'}, '')
    const onPopState = (e) => {
      isPopRef.current = true
      setView(e.state?.view || 'home')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, []) // eslint-disable-line

  useEffect(() => {
    if (isFirstViewRef.current) { isFirstViewRef.current = false; return }
    if (isPopRef.current) { isPopRef.current = false; return }
    window.history.pushState({view}, '')
  }, [view])
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
  const [osAtual,setOsAtual] = useState(()=>{
    try { const d=localStorage.getItem(LS_KEY); if(d) return JSON.parse(d).osAtual||null } catch{}
    return null
  })
  // true quando o último salvamento falhou (provavelmente sem sinal) e ainda não foi sincronizado
  const [pendingSync,setPendingSync] = useState(()=>{
    try { const d=localStorage.getItem(LS_KEY); if(d) return !!JSON.parse(d).pendingSync } catch{}
    return false
  })
  // Precisa restaurar do storage aqui também — se o app for encerrado pelo Android
  // (fica em background sem sinal) e reaberto depois, essa ref reseta a {} e a
  // sincronização automática reenviaria sem o status/dados corretos, ou nem reenviaria nada.
  const lastExtraData = useRef((()=>{
    try { const d=localStorage.getItem(LS_KEY); if(d) return JSON.parse(d).lastExtraData||{} } catch{}
    return {}
  })())
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
  const [fazendasDB, setFazendasDB] = useState([])
  const [relatoriosFinalizadosOrg, setRelatoriosFinalizadosOrg] = useState([])
  const [talhoesDB, setTalhoesDB] = useState([])
  const [veiculosDB, setVeiculosDB] = useState([])
  const [voosFrotaDrone, setVoosFrotaDrone] = useState([])

  // Listas dinâmicas: banco + "Outros" no final
  const DRONES = dronesDB.length > 0
    ? [...dronesDB.filter(d=>d.ativo).map(d=>d.nome), 'Outros']
    : DRONES_DEFAULT
  const PRODUTOS_LIST = produtosDB.length > 0
    ? [...produtosDB.filter(p=>p.ativo).map(p=>p.nome), 'Outros']
    : PRODUTOS_DEFAULT
  // Unidade do produto (do inventário): Moddus=Kg, Agile=L, etc. Padrão L
  const unidadeDoProduto = (nome) => produtosDB.find(p=>p.nome===nome)?.unidade || 'L'
  const CLIENTES = clientesDB.length > 0
    ? [...clientesDB.filter(c=>c.ativo).map(c=>c.nome), 'Outros']
    : CLIENTES_DEFAULT
  const [sosConfirm,setSosConfirm] = useState(false)
  const [modalOpen,setModalOpen] = useState(false)
  const [parcialModalOpen,setParcialModalOpen] = useState(false)
  const [horarioModalOpen,setHorarioModalOpen] = useState(false)
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
  const [talhaoSearch, setTalhaoSearch] = useState('')
  const [talhaoDropdownOpen, setTalhaoDropdownOpen] = useState(false)
  const [timerSecs, setTimerSecs] = useState(0)
  const [timerTotalSecs, setTimerTotalSecs] = useState(0)

  // Timer em tempo real durante o voo — calcula sempre a partir do horário real de início
  // (dt_inicio) menos as pausas fechadas, em vez de só incrementar a cada tick. Assim o valor
  // mostrado bate com o relógio de verdade mesmo se o navegador suspender o setInterval com o
  // app em background/tela bloqueada — não importa se ficou offline, ao voltar já corrige sozinho.
  useEffect(() => {
    if (opState !== 'running') return
    const startIso = fmtDt(form,'dt_inicio')
    const start = startIso ? new Date(startIso).getTime() : Date.now()
    const pausadoMs = (form.pausas||[]).reduce((a,p)=> p.fim ? a + (new Date(p.fim).getTime()-new Date(p.inicio).getTime()) : a, 0)
    const compute = () => setTimerSecs(Math.max(0, Math.floor((Date.now()-start-pausadoMs)/1000)))
    compute()
    const id = setInterval(compute, 1000)
    document.addEventListener('visibilitychange', compute)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', compute) }
  }, [opState, form.dt_inicio_data, form.dt_inicio_hh, form.dt_inicio_mm, form.pausas]) // eslint-disable-line

  // Tempo total (relógio) — do horário que apertou Iniciar até agora, incluindo pausas.
  // Roda enquanto o voo estiver aberto (rodando ou pausado), não só enquanto "running".
  useEffect(() => {
    if (opState !== 'running' && opState !== 'paused') return
    const startIso = fmtDt(form,'dt_inicio')
    if (!startIso) { setTimerTotalSecs(0); return }
    const start = new Date(startIso).getTime()
    const compute = () => setTimerTotalSecs(Math.max(0, Math.floor((Date.now()-start)/1000)))
    compute()
    const id = setInterval(compute, 1000)
    document.addEventListener('visibilitychange', compute)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', compute) }
  }, [opState, form.dt_inicio_data, form.dt_inicio_hh, form.dt_inicio_mm]) // eslint-disable-line

  // Voos compartilhados
  const [voosCompartilhados, setVoosCompartilhados] = useState([])
  const [trechoModal, setTrechoModal] = useState(null) // relatorio que vai adicionar trecho
  const [trechoForm, setTrechoForm] = useState(null)
  const [trechoFotoMapa, setTrechoFotoMapa] = useState(null)
  const [trechoFotoMapaFile, setTrechoFotoMapaFile] = useState(null)
  const [trechoSaving, setTrechoSaving] = useState(false)
  const [kmlFiles,setKmlFiles] = useState([])
  const [flights,setFlights] = useState([])
  const [osOpcoes,setOsOpcoes] = useState([])
  const [loadingFlights,setLoadingFlights] = useState(false)
  const [flightsAbertos,setFlightsAbertos] = useState([])
  const [continuarModalOpen,setContinuarModalOpen] = useState(false)
  const [continuarLoading,setContinuarLoading] = useState(false)
  const [confirmDialog,setConfirmDialog] = useState(null) // {message, onConfirm}
  const [notaForm,setNotaForm] = useState({categoria:'',valor:'',data:new Date().toISOString().split('T')[0],ordem_servico:'',observacao:'',veiculo_id:'',km_inicial:'',km_final:'',itensViagem:[]})
  function addItemViagem(categoria){
    setNotaForm(f=>({...f,itensViagem:[...f.itensViagem,{id:Date.now()+Math.random(),categoria,valor:''}]}))
  }
  function updateItemViagem(id,valor){
    setNotaForm(f=>({...f,itensViagem:f.itensViagem.map(it=>it.id===id?{...it,valor}:it)}))
  }
  function removeItemViagem(id){
    setNotaForm(f=>({...f,itensViagem:f.itensViagem.filter(it=>it.id!==id)}))
  }
  const [osModo,setOsModo] = useState('lista')
  const [notaFotoPreview,setNotaFotoPreview] = useState(null)
  const [notaFotoFile,setNotaFotoFile] = useState(null)
  const [notaSaving,setNotaSaving] = useState(false)
  const [minhasNotas,setMinhasNotas] = useState([])
  const [loadingNotas,setLoadingNotas] = useState(false)
  const [minhaAgenda,setMinhaAgenda] = useState([])
  const [loadingAgenda,setLoadingAgenda] = useState(false)
  const [agendaDetalhe,setAgendaDetalhe] = useState(null)
  const [recusaModal,setRecusaModal] = useState(null)
  const [recusaMotivo,setRecusaMotivo] = useState('')
  const [recusaSaving,setRecusaSaving] = useState(false)
  async function confirmarRecusa(){
    if(!recusaMotivo.trim()){ showToast('Digite o motivo da recusa','error'); return }
    setRecusaSaving(true)
    try {
      const { error } = await supabase.from('agendamentos').update({status:'recusado',motivo_recusa:recusaMotivo.trim()}).eq('id',recusaModal.id)
      if(error) throw error
      showToast('Agendamento recusado')
      setRecusaModal(null); setRecusaMotivo(''); setAgendaDetalhe(null)
      const {data}=await supabase.from('agendamentos').select('*').eq('piloto_id',profile.id).order('data_prevista',{ascending:true})
      setMinhaAgenda(data||[])
    } catch(e){ showToast('Erro: '+e.message,'error') } finally { setRecusaSaving(false) }
  }
  const [tempoDias,setTempoDias] = useState(null)
  const [tempoLoading,setTempoLoading] = useState(false)
  const [tempoErro,setTempoErro] = useState('')
  const [tempoLocal,setTempoLocal] = useState('')
  const [tempoCep,setTempoCep] = useState('')
  const [tempoHorario,setTempoHorario] = useState(null)
  const [graficoHora,setGraficoHora] = useState(null)
  const toastTimer=useRef(null)
  const retryTimer=useRef(null)
  const pendingPayload=useRef(null)

  const showToast=useCallback((msg)=>{
    setToast(msg)
    if(toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current=setTimeout(()=>setToast(''),2800)
  },[])

  // Carrega drones, produtos, clientes, fazendas e talhões do banco.
  // Usa cache local (localStorage) como estado inicial e fallback offline: se a busca
  // ao vivo falhar (sem sinal), continua com o último cadastro conhecido em vez de ficar vazio.
  useEffect(() => {
    setDronesDB(loadCache('orofly_cache_drones'))
    setProdutosDB(loadCache('orofly_cache_produtos'))
    setClientesDB(loadCache('orofly_cache_clientes'))
    setFazendasDB(loadCache('orofly_cache_fazendas'))
    setTalhoesDB(loadCache('orofly_cache_talhoes'))

    supabase.from('drones').select('nome,horas_limite,ativo').eq('ativo',true).order('nome')
      .then(({data}) => { if(data?.length){ setDronesDB(data); saveCache('orofly_cache_drones',data) } })
    supabase.from('relatorios').select('drone,dt_inicio,dt_fim').eq('status','finalizado')
      .then(({data}) => { if(data) setVoosFrotaDrone(data) })
    supabase.from('produtos').select('nome,unidade,dose_padrao,dose_auto,ativo').eq('ativo',true).order('nome')
      .then(({data}) => { if(data?.length){ setProdutosDB(data); saveCache('orofly_cache_produtos',data) } })
    supabase.from('clientes').select('nome,ativo').eq('ativo',true).order('nome')
      .then(({data}) => { if(data?.length){ setClientesDB(data); saveCache('orofly_cache_clientes',data) } })
    supabase.from('fazendas').select('id,cliente,nome,produto,ativo,campanha_inicio,lat,lng,cep,id_fazenda').eq('ativo',true).order('nome')
      .then(({data}) => { if(data){ setFazendasDB(data); saveCache('orofly_cache_fazendas',data) } })
    supabase.from('talhoes').select('id,fazenda_id,nome,area_ha,ativo').eq('ativo',true).order('nome')
      .then(({data}) => { if(data){ setTalhoesDB(data); saveCache('orofly_cache_talhoes',data) } })
    // Leve, só o necessário pra calcular quanto já foi feito em cada fazenda (de todos os pilotos,
    // não só o logado) — usado pra tirar fazenda 100% concluída da lista e mostrar o que falta.
    supabase.from('relatorios').select('cliente,fazenda,area_ha,bordadura,created_at,localizacao').eq('status','finalizado')
      .then(({data}) => { if(data) setRelatoriosFinalizadosOrg(data) })
    supabase.from('veiculos').select('id,placa,marca,modelo,km_atual,proxima_manutencao_km,proxima_manutencao_data,ativo').eq('ativo',true).order('placa')
      .then(({data}) => { if(data){ setVeiculosDB(data); saveCache('orofly_cache_veiculos',data) } })
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

  // Carrega histórico pra tela Home (resumo do dia/mês + prévias dos cards)
  useEffect(() => {
    if (!profile) return
    loadFlights()
    loadAgenda()
    loadNotas()
  }, [profile]) // eslint-disable-line

  // Captura o GPS no login (pedido de permissão normal do navegador — não é
  // escondido do piloto) e já usa pra adiantar a previsão do tempo na Home.
  // Se o piloto negar ou o GPS falhar, não insiste — ele ainda pode buscar
  // manualmente por GPS ou CEP na tela de Previsão do Tempo.
  useEffect(() => {
    if (!profile || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude
        setGpsPos({lat,lng})
        supabase.from('gps_logins').insert({ piloto_id: profile.id, piloto_nome: profile.nome||profile.email, lat, lng }).then(()=>{})
        buscarPrevisao(lat, lng, 'Sua localização (GPS)')
      },
      () => {},
      { enableHighAccuracy:true, timeout:10000 }
    )
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

  // Recupera (ou gera na hora) a ordem de serviço de um rascunho já aberto antes desse recurso existir —
  // sem isso, ela só apareceria depois do próximo salvamento manual do piloto.
  useEffect(() => {
    if (!relId || osAtual) return
    supabase.from('relatorios').select('ordem_servico').eq('id', relId).single().then(({data}) => {
      if (data?.ordem_servico) { setOsAtual(data.ordem_servico); return }
      const novo = gerarOrdemServico()
      supabase.from('relatorios').update({ordem_servico:novo}).eq('id',relId).then(()=>setOsAtual(novo))
    })
  }, [relId]) // eslint-disable-line
  useEffect(()=>{
    if(opState==='idle') return
    try { localStorage.setItem(LS_KEY,JSON.stringify({form,opState,relId,osAtual,pendingSync,lastExtraData:lastExtraData.current})) } catch{}
  },[form,opState,relId,osAtual,pendingSync])

  // Sincronização automática: assim que o app fica online (ou ao reabrir com pendência),
  // reenvia o último salvamento que tinha falhado. Nada de dados perdidos por falta de sinal.
  // Usa vários gatilhos porque o evento 'online' sozinho não é confiável dentro do WebView
  // do app nativo (Android às vezes não dispara, principalmente vindo de background).
  useEffect(()=>{
    function tentarSincronizar(){
      if(!pendingSync || !navigator.onLine) return
      saveToSupabase(lastExtraData.current||{},false)
    }
    tentarSincronizar()
    window.addEventListener('online',tentarSincronizar)
    document.addEventListener('visibilitychange',tentarSincronizar)
    window.addEventListener('focus',tentarSincronizar)
    const id=setInterval(tentarSincronizar,15000)
    return ()=>{
      window.removeEventListener('online',tentarSincronizar)
      document.removeEventListener('visibilitychange',tentarSincronizar)
      window.removeEventListener('focus',tentarSincronizar)
      clearInterval(id)
    }
  },[pendingSync]) // eslint-disable-line

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

  // Compartilha o relatório resumido no WhatsApp — tenta ir junto com a foto do mapa de
  // pós-aplicação. Usa o menu nativo de compartilhar do Android dentro do app empacotado
  // (window.open/Web Share sozinhos não são confiáveis dentro do WebView).
  async function compartilharWhatsApp(){
    const fzMatch = fazendasDB.find(fz=>fz.cliente===form.cliente && fz.nome===form.fazenda)
    const formComPiloto = {...form, piloto_nome: form.piloto_nome||profile?.nome||profile?.email||'', id_fazenda: fzMatch?.id_fazenda||''}
    const texto = buildTxt(formComPiloto,clienteVal,droneVal,produtoComUnidade,opState==='paused_day')
    let file = fotoMapaFile
    console.log('[compartilharWhatsApp] fotoMapaFile=',!!fotoMapaFile,'storageFotoMapa=',storageFotoMapa)
    if (!file && storageFotoMapa) {
      try {
        const { data: signed } = await supabase.storage.from('relatorios').createSignedUrl(storageFotoMapa,60)
        if (signed?.signedUrl) {
          const res = await fetch(signed.signedUrl)
          const blob = await res.blob()
          file = new File([blob],'mapa.jpg',{type:blob.type||'image/jpeg'})
        }
      } catch(e) { console.error('Erro ao buscar foto do mapa para compartilhar:',e) }
    }
    await compartilharNativo({ text:texto, file, filename:'mapa.jpg', webFallbackUrl:'https://wa.me/?text='+encodeURIComponent(texto) })
  }

  // Anexa a evidência climática (foto de câmera/galeria ou PDF) no slot 1 (início) ou 2 (fim)
  async function handleEvidFile(slot,lbl,f){
    const isPdf=f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')
    if(isPdf){
      const a=[...obsFotos];a[slot]='pdf:'+f.name;setObsFotos(a)
    }else{
      const r=new FileReader();r.onload=ev=>{const a=[...obsFotos];a[slot]=ev.target.result;setObsFotos(a)};r.readAsDataURL(f)
    }
    const b=[...obsFotoFiles];b[slot]=f;setObsFotoFiles(b)
    // Metadata: data original da foto (EXIF) ou do arquivo + tamanho/tipo/GPS
    const metaFoto = isPdf ? {data:new Date(f.lastModified).toLocaleString('pt-BR'),lat:null,lng:null} : await extrairMetadadosFoto(f)
    const chave = slot===1?'inicio':'fim'
    setForm(fm=>({...fm,evid_meta:{...(fm.evid_meta||{}),[chave]:{
      arquivo:f.name,
      data_foto:metaFoto.data,
      gps_lat:metaFoto.lat,
      gps_lng:metaFoto.lng,
      tamanho:(f.size/1024).toFixed(0)+' KB',
      tipo:isPdf?'PDF':(f.type.split('/')[1]||'imagem').toUpperCase(),
      incluir:true
    }}}))
    showToast('✅ Evidência '+lbl.toLowerCase()+' anexada!')
  }

  // Adiciona unidade à dosagem ao salvar: "Moddus - 1.1" → "Moddus - 1.1 Kg/ha"
  const produtoComUnidade = (p) => {
    const parts = p.split(' - ')
    const nome = parts[0]||'', dose = parts.slice(1).join(' - ')||''
    if (!dose) return p
    // Se a dose já tem letras (unidade), mantém como está
    if (/[a-zA-Zµ]/.test(dose)) return p
    return `${nome} - ${dose} ${unidadeDoProduto(nome)}/ha`
  }

  function gerarOrdemServico() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789' // sem caracteres ambíguos (0/o, 1/l/i)
    let s=''; for(let i=0;i<6;i++) s+=chars[Math.floor(Math.random()*chars.length)]
    return s
  }

  async function saveToSupabase(extraData={},retry=true) {
    lastExtraData.current = extraData
    const talhoesSel = (form.talhao||'').split(',').map(s=>s.trim()).filter(Boolean)
    const bordaduraDetalhe = talhoesSel.length>1
      ? talhoesSel.map(nome=>({talhao:nome,bordadura:parseFloat(form.bordaduraPorTalhao?.[nome])||0})).filter(d=>d.bordadura>0)
      : null
    const bordaduraTotal = bordaduraAtual(form)
    // Fallback defensivo: relId deveria sempre existir (gerado em opIniciar), mas se por algum
    // motivo ainda estiver nulo aqui, gera agora em vez de deixar o registro órfão.
    const idAtual = relId || crypto.randomUUID()
    const payload={
      id:idAtual,
      piloto_id:profile.id,
      cultura:form.cultura||null,
      cliente:clienteVal,fazenda:form.fazenda,produto:form.produto||null,area_ha:form.area_ha,qtd_voos:parseInt(form.qtd_voos)||1,tipo_servico:form.tipo_servico||null,
      area_feita:form.area_feita?parseFloat(form.area_feita):null,
      area_deduzida:form.area_deduzida?parseFloat(form.area_deduzida):null,
      piloto_nome:profile.nome||profile.email,
      drone:droneVal,produtos:form.produtos.filter(Boolean).map(produtoComUnidade),
      tamanho_gota:form.tamanho_gota,velocidade_drone:form.velocidade_drone,
      localizacao:form.talhao||form.localizacao,gps_lat:form.gps_lat,gps_lng:form.gps_lng,
      obs1:form.obs1,obs2:form.obs2,bordadura:bordaduraTotal||null,bordadura_detalhe:bordaduraDetalhe&&bordaduraDetalhe.length?bordaduraDetalhe:null,evidencia_meta:form.evid_meta&&Object.keys(form.evid_meta).length?form.evid_meta:null,pausas:form.pausas,
      dt_inicio:fmtDt(form,'dt_inicio'),dt_fim:fmtDt(form,'dt_fim'),
      kml_arquivos:kmlFiles.map(f=>f.name),
      ...COND_KEYS.reduce((a,k)=>({...a,[k+'_i']:form[k+'_i'],[k+'_f']:form[k+'_f']}),{}),
      ordem_servico: osAtual || gerarOrdemServico(),
      teste: !!form.teste,
      ...extraData
    }
    setSaveStatus('saving')
    try {
      const result = await supabase.from('relatorios').upsert(payload,{onConflict:'id'}).select().single()
      if(result.error) throw result.error
      if(!relId) setRelId(idAtual)
      if(result.data && !osAtual) setOsAtual(result.data.ordem_servico||null)
      setSaveStatus('saved');pendingPayload.current=null
      if(pendingSync){setPendingSync(false);showToast('✅ Sincronizado com sucesso!')}
      if(retryTimer.current) clearTimeout(retryTimer.current)
      return result.data
    } catch(err){
      setSaveStatus('error');pendingPayload.current={extraData};setPendingSync(true)
      if(retry){if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=setTimeout(()=>{if(pendingPayload.current){saveToSupabase(pendingPayload.current.extraData,false)}},10000)}
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
    // Gera o id do relatório localmente (antes de qualquer chamada de rede) — assim ele
    // nunca fica nulo, mesmo sem sinal, e todo salvamento seguinte sabe em qual linha gravar.
    const novoId = relId || crypto.randomUUID()
    setRelId(novoId)
    const payload={
      id:novoId,
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
      const {data,error}=await supabase.from('relatorios').upsert(payload,{onConflict:'id'}).select().single()
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
    } catch {
      // Sem sinal: o id já foi gerado acima, então o voo não fica órfão — o
      // useEffect de pendingSync (linha ~610) reenvia via saveToSupabase assim que reconectar,
      // que reconstrói o payload a partir do form atual (já igual a `nf` aqui).
      setSaveStatus('error'); lastExtraData.current={status:'em_operacao'}; setPendingSync(true)
      showToast('📴 Sem sinal — voo salvo no aparelho, sincroniza sozinho quando reconectar')
    }
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
    // Condições FIM são opcionais — Delta T calculado automaticamente
    return erros
  }

  // GPS automático — captura em QUALQUER interação no app (primeiro toque/clique)
  const gpsCapturado = useRef(false)
  const gpsLatRef = useRef(null)
  useEffect(()=>{ gpsLatRef.current = form.gps_lat },[form.gps_lat])
  function autoGPS() {
    if (gpsCapturado.current || gpsLatRef.current) return
    if (!navigator.geolocation) return
    gpsCapturado.current = true
    navigator.geolocation.getCurrentPosition(
      pos => setForm(f=>({...f,gps_lat:pos.coords.latitude.toFixed(6),gps_lng:pos.coords.longitude.toFixed(6)})),
      () => { gpsCapturado.current = false }, // falhou: permite tentar de novo na próxima interação
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }
  useEffect(()=>{
    autoGPS() // tenta já ao abrir o app
    const handler = () => autoGPS()
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  },[]) // eslint-disable-line

  async function fetchClima() {
    let lat = form.gps_lat, lng = form.gps_lng
    if (!lat || !lng) {
      if (!navigator.geolocation) { showToast('⚠️ GPS não disponível neste dispositivo','error'); return }
      showToast('📍 Capturando localização...')
      try {
        const pos = await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:10000}))
        lat = pos.coords.latitude.toFixed(6); lng = pos.coords.longitude.toFixed(6)
        setForm(f=>({...f,gps_lat:lat,gps_lng:lng}))
      } catch(e) {
        showToast('⚠️ Não foi possível capturar o GPS. Verifique a permissão de localização.','error'); return
      }
    }
    showToast('🌤️ Buscando condições climáticas...')
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&wind_speed_unit=kmh&timezone=auto`
      const res = await fetch(url)
      const data = await res.json()
      const c = data.current
      if (!c) throw new Error('Sem dados')
      const temp = c.temperature_2m?.toFixed(1)
      const umid = c.relative_humidity_2m?.toFixed(0)
      const vento = c.wind_speed_10m?.toFixed(1)
      const deltaTCalc = calcDeltaT(temp, umid)
      const deltaT = deltaTCalc!=null ? deltaTCalc.toFixed(1) : null
      setForm(f => ({
        ...f,
        temperatura_i: temp, umidade_i: umid,
        vento_i: vento, delta_t_i: deltaT,
        // Fim vem com o mesmo valor do início por padrão, só enquanto o fim ainda não foi definido
        temperatura_f: f.temperatura_f || temp, umidade_f: f.umidade_f || umid,
        vento_f: f.vento_f || vento, delta_t_f: f.delta_t_f || deltaT,
      }))
      showToast('✅ Clima carregado!')
    } catch(e) {
      showToast('Erro ao buscar clima: ' + e.message, 'error')
    }
  }

  async function opFinalizar() {
    const erros=validarFinalizar()
    if(erros.length>0){setFinalizeConfirm({erros});return}
    await executarFinalizacao()
  }

  // Dá baixa no estoque dos produtos usados (área x dose). Best-effort: não bloqueia a finalização se falhar
  // (ex: função registrar_movimento_estoque ainda não criada no banco, ou produto não cadastrado no inventário).
  // `area` é a quantidade de hectares a considerar NESSA baixa — no Finalizado Parcial é só o incremento
  // desde a última baixa (evita descontar o produto duas vezes quando o voo é retomado e finalizado depois).
  async function darBaixaEstoque(relIdAlvo, area) {
    try {
      if (!relIdAlvo || !(area>0)) return
      const produtosFinal = form.produtos.filter(Boolean).map(produtoComUnidade)
      for (const p of produtosFinal) {
        const { nome, dose, unidade } = parseDoseProduto(p)
        if (dose==null || !nome) continue
        const existe = produtosDB.find(pd=>pd.nome===nome)
        if (!existe) continue // produto "Outros" digitado à mão não está no inventário — nada a baixar
        const consumo = +(dose*area).toFixed(2)
        if (consumo<=0) continue
        await supabase.rpc('registrar_movimento_estoque', {
          p_produto_nome: nome, p_quantidade: -consumo, p_tipo: 'baixa_relatorio',
          p_unidade: unidade||existe.unidade||null, p_relatorio_id: relIdAlvo, p_criado_por: profile.nome||profile.email
        })
      }
    } catch(e) { console.warn('Baixa de estoque não aplicada:', e) }
  }

  async function executarFinalizacao() {
    setFinalizeConfirm(null);setSaving(true)
    const n=nowParts()
    setForm(f=>({...f,dt_fim_data:n.data,dt_fim_hh:n.hh,dt_fim_mm:n.mm}))
    setOpState('finished')
    // Baixa só o que falta: se já teve Finalizado Parcial antes, area_deduzida guarda quanto
    // já foi descontado do estoque — aqui desconta só a diferença até a área total.
    const areaTotal = areaLiquidaAtual(form)
    const deltaBaixa = Math.max(0, areaTotal-(parseFloat(form.area_deduzida)||0))
    // Só salva o voo — PDF gerado separadamente no Step 5
    const relSalvo = await saveToSupabase({status:'finalizado',dt_fim:n.iso,area_deduzida:areaTotal})
    if (relSalvo) {
      await darBaixaEstoque(relSalvo.id, deltaBaixa)
      try{localStorage.removeItem(LS_KEY)}catch{}
      setSaving(false)
      showToast('✅ Voo salvo! Adicione fotos e gere o relatório.')
    } else {
      // Sem conexão: NÃO apaga o rascunho — fica salvo no aparelho e sincroniza
      // sozinho assim que voltar o sinal (ver useEffect de pendingSync).
      setSaving(false)
      showToast('📴 Sem sinal agora. Voo salvo no aparelho e será enviado automaticamente quando reconectar.')
    }
  }

  async function gerarRelatorioFinal() {
    setSaving(true)
    showToast('⏳ Gerando relatório...')
    // Busca no servidor primeiro — mas se estiver offline, .select() pode LANÇAR (falha de rede),
    // não só retornar vazio. Por isso cada tentativa fica isolada no seu próprio try, pra uma
    // falha de rede aqui não virar um "Erro: Failed to fetch" genérico lá embaixo.
    let rel = null
    try {
      const {data} = await supabase.from('relatorios').select('*').eq('id',relId).maybeSingle()
      rel = data
    } catch {}
    if(!rel){
      try { rel = await saveToSupabase({status:statusAtual()},false) } catch {}
    }
    if(!rel){
      // Ainda sem sinal: o relatório já existe no aparelho (form local) — mostra assim mesmo.
      // Fotos e a sincronização final ficam pendentes até reconectar.
      setSaving(false)
      showToast('📴 Sem sinal — mostrando com os dados salvos no aparelho')
      setModalOpen(true)
      return
    }
    try {
      const [obsUrls,mapaUrl]=await Promise.all([uploadFotos(rel.id),uploadFotoMapa(rel.id)])
      if(obsUrls.some(Boolean)||mapaUrl) await supabase.from('relatorios').update({obs_fotos_urls:obsUrls,foto_mapa_url:mapaUrl}).eq('id',rel.id)
    } catch(e) { console.error(e) }
    setSaving(false)
    setModalOpen(true)
  }

  async function uploadFotos(rid) {
    const urls=[]
    for(let i=0;i<obsFotoFiles.length;i++){
      const file=obsFotoFiles[i];if(!file){urls.push(null);continue}
      const {error}=await supabase.storage.from('relatorios').upload(`${profile.id}/${rid}/obs_${i}.jpg`,file,{upsert:true})
      urls.push(error?null:`${profile.id}/${rid}/obs_${i}.jpg`)
    }
    if(urls.some(Boolean)) setStorageObsFotos(prev=>urls.map((u,i)=>u||prev[i]))
    return urls
  }
  async function uploadFotoMapa(rid){
    if(!fotoMapaFile) return null
    const path=`${profile.id}/${rid}/mapa.jpg`
    const {error}=await supabase.storage.from('relatorios').upload(path,fotoMapaFile,{upsert:true})
    if(error) return null
    // Guarda o caminho no storage: o arquivo local (fotoMapaFile) some se o app recarregar
    // (ex: reinstalar, sair de background por muito tempo). Com o path salvo, ainda dá pra
    // buscar a foto de volta pra compartilhar/gerar PDF depois.
    setStorageFotoMapa(path)
    return path
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
    try {
      const {data}=await supabase.from('relatorios').select('*').eq('piloto_id',profile.id).order('created_at',{ascending:false}).limit(30)
      setFlights(data||[])
    } catch {} finally { setLoadingFlights(false) }
  }

  // Opções pro seletor de OS no Cadastro de Notas — pilotos veem só os próprios voos;
  // admin (via Modo Piloto) vê os voos de todos, já que geralmente é ele quem lança
  // nota em nome de terceiros (motorista, etc.)
  async function loadOsOpcoes(){
    try {
      let query = supabase.from('relatorios').select('id,ordem_servico,cliente,fazenda,piloto_nome,dt_inicio,created_at').not('ordem_servico','is',null).order('created_at',{ascending:false}).limit(50)
      if(!onSwitchMode) query = query.eq('piloto_id',profile.id)
      const {data} = await query
      setOsOpcoes(data||[])
    } catch {}
  }

  async function loadNotas(){
    setLoadingNotas(true)
    try {
      const {data}=await supabase.from('despesas').select('*').eq('piloto_id',profile.id).order('created_at',{ascending:false}).limit(30)
      setMinhasNotas(data||[])
    } catch {} finally { setLoadingNotas(false) }
  }

  async function loadAgenda(){
    setLoadingAgenda(true)
    try {
      const {data}=await supabase.from('agendamentos').select('*').eq('piloto_id',profile.id).order('data_prevista',{ascending:true})
      setMinhaAgenda(data||[])
    } catch {} finally { setLoadingAgenda(false) }
  }

  function iniciarVooAgendado(a){
    limpar()
    setForm(f=>({...f,cliente:a.cliente,fazenda:a.fazenda,produto:a.produto||''}))
    if(a.ordem_servico) setOsAtual(a.ordem_servico)
    setView('form')
  }

  function handleNotaFoto(f){
    if(!f) return
    const r=new FileReader()
    r.onload=ev=>setNotaFotoPreview(ev.target.result)
    r.readAsDataURL(f)
    setNotaFotoFile(f)
  }

  async function buscarPrevisao(lat,lon,local){
    setTempoLoading(true); setTempoErro(''); setTempoDias(null); setGraficoHora(null)
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max&hourly=temperature_2m,relativehumidity_2m,windspeed_10m,windgusts_10m,precipitation_probability&timezone=auto&forecast_days=5`
      const res = await fetch(url)
      if(!res.ok) throw new Error('Falha ao buscar previsão')
      const data = await res.json()
      const dias = (data.daily?.time||[]).map((dataStr,i)=>{
        // Pega temperatura/umidade por volta das 13h (janela típica de aplicação) pra estimar o Delta T do dia
        const idxHora = (data.hourly?.time||[]).findIndex(t=>t.startsWith(dataStr)&&t.endsWith('T13:00'))
        const tempMeioDia = idxHora>=0 ? data.hourly.temperature_2m[idxHora] : data.daily.temperature_2m_max[i]
        const umidMeioDia = idxHora>=0 ? data.hourly.relativehumidity_2m[idxHora] : null
        const deltaT = umidMeioDia!=null ? calcDeltaT(tempMeioDia,umidMeioDia) : null
        return {
          data: dataStr,
          tempMax: data.daily.temperature_2m_max[i], tempMin: data.daily.temperature_2m_min[i],
          umidade: umidMeioDia,
          chuvaProb: data.daily.precipitation_probability_max[i], chuvaMm: data.daily.precipitation_sum[i],
          ventoMax: data.daily.windspeed_10m_max[i],
          deltaT, deltaTClass: deltaT!=null?classificarClimaParam('delta_t',deltaT.toFixed(1)):null,
        }
      })
      setTempoDias(dias); setTempoLocal(local); setTempoHorario(data.hourly||null)
    } catch(e){ setTempoErro('Não foi possível buscar a previsão. Confira sua conexão e tente de novo.') }
    finally { setTempoLoading(false) }
  }

  function buscarPorGPS(){
    if(!navigator.geolocation){ setTempoErro('GPS não disponível neste dispositivo.'); return }
    setTempoLoading(true); setTempoErro('')
    navigator.geolocation.getCurrentPosition(
      pos=>buscarPrevisao(pos.coords.latitude,pos.coords.longitude,'Sua localização (GPS)'),
      ()=>{ setTempoLoading(false); setTempoErro('Não deu pra pegar o GPS. Digite o CEP abaixo.') },
      {enableHighAccuracy:true,timeout:10000}
    )
  }

  async function buscarPorCep(){
    const cep = tempoCep.replace(/\D/g,'')
    if(cep.length!==8){ setTempoErro('Digite um CEP válido (8 números).'); return }
    setTempoLoading(true); setTempoErro('')
    try {
      const viaCep = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then(r=>r.json())
      if(viaCep.erro) throw new Error('CEP não encontrado')
      const cidade = viaCep.localidade, uf = viaCep.uf
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=5&language=pt&format=json`).then(r=>r.json())
      const match = (geo.results||[]).find(r=>r.country_code==='BR') || (geo.results||[])[0]
      if(!match) throw new Error('Cidade não encontrada')
      await buscarPrevisao(match.latitude,match.longitude,`${cidade}, ${uf}`)
    } catch(e){ setTempoLoading(false); setTempoErro('Não encontramos esse CEP. Confira e tente de novo.') }
  }

  async function salvarNota(){
    const temDespesa = notaForm.categoria && notaForm.valor && parseFloat(notaForm.valor)>0
    const temViagem = notaForm.veiculo_id && notaForm.km_inicial!=='' && notaForm.km_final!==''
    if(!temDespesa && !temViagem){
      showToast('Preencha categoria+valor, ou selecione um veículo e informe o km inicial/final','error'); return
    }
    if(temViagem && parseFloat(notaForm.km_final) < parseFloat(notaForm.km_inicial)){
      showToast('O km final não pode ser menor que o km inicial','error'); return
    }
    setNotaSaving(true)
    try {
      let foto_url = null
      if(notaFotoFile){
        const path = `despesas/${profile.id}/${Date.now()}.jpg`
        const {error:upErr} = await supabase.storage.from('relatorios').upload(path,notaFotoFile,{upsert:true})
        if(!upErr) foto_url = path
      }
      let relatorio_id = null
      const osDigitada = notaForm.ordem_servico.trim()
      if(osDigitada){
        const {data:relMatch} = await supabase.from('relatorios').select('id').ilike('ordem_servico',osDigitada).maybeSingle()
        if(relMatch) relatorio_id = relMatch.id
      }

      // Só lança despesa se categoria+valor foram preenchidos — registrar viagem sem custo é válido
      if(temDespesa){
        const {error} = await supabase.from('despesas').insert({
          piloto_id:profile.id, piloto_nome:profile.nome||profile.email,
          categoria:notaForm.categoria, valor:parseFloat(notaForm.valor), data:notaForm.data,
          ordem_servico:osDigitada||null, relatorio_id, observacao:notaForm.observacao||null, foto_url,
          veiculo_id:notaForm.veiculo_id||null,
        })
        if(error) throw error
      }

      // Se marcou veículo + km, registra a viagem e atualiza o km atual do carro
      if(temViagem){
        const kmIni = parseFloat(notaForm.km_inicial)
        const kmFim = parseFloat(notaForm.km_final)
        const {error:vErr} = await supabase.from('viagens').insert({
          veiculo_id: notaForm.veiculo_id, motorista: profile.nome||profile.email, data: notaForm.data,
          km_inicial: kmIni, km_final: kmFim,
          ordem_servico: osDigitada||null, relatorio_id, observacao: notaForm.observacao||'Registrado via Cadastro de Notas',
        })
        if(vErr) throw vErr
        await supabase.from('veiculos').update({km_atual: kmFim}).eq('id',notaForm.veiculo_id)
        setVeiculosDB(vs=>vs.map(v=>v.id===notaForm.veiculo_id?{...v,km_atual:kmFim}:v))

        // Despesas lançadas durante a viagem (gasolina, pedágio, almoço etc.) — uma por item
        for(const item of notaForm.itensViagem){
          const valorItem = parseFloat(item.valor)
          if(!(valorItem>0)) continue
          const {error:iErr} = await supabase.from('despesas').insert({
            piloto_id:profile.id, piloto_nome:profile.nome||profile.email,
            categoria:item.categoria, valor:valorItem, data:notaForm.data,
            ordem_servico:osDigitada||null, relatorio_id, observacao:'Lançado durante viagem', foto_url,
            veiculo_id:notaForm.veiculo_id,
          })
          if(iErr) throw iErr
        }
      }

      showToast(relatorio_id?'✅ Registrado e vinculado ao voo!':'✅ Registrado!')
      setNotaForm({categoria:'',valor:'',data:new Date().toISOString().split('T')[0],ordem_servico:'',observacao:'',veiculo_id:'',km_inicial:'',km_final:'',itensViagem:[]})
      setOsModo('lista')
      setNotaFotoPreview(null); setNotaFotoFile(null)
      loadNotas()
    } catch(e){ showToast('Erro: '+e.message,'error') } finally { setNotaSaving(false) }
  }

  function openFlight(rel){
    setForm(initForm(rel)); setRelId(rel.id); setOsAtual(rel.ordem_servico||null)
    const st = rel.status==='finalizado'?'finished':rel.status==='em_operacao'?'running':rel.status==='pausado'?'paused':rel.status==='pausado_dia'?'paused_day':'idle'
    setOpState(st)
    setObsFotos([null,null,null]); setObsFotoFiles([null,null,null])
    setFotoMapa(null); setFotoMapaFile(null)
    setStorageFotoMapa(rel.foto_mapa_url||null)
    setStorageObsFotos(rel.obs_fotos_urls||[null,null,null])
    setView('form')
    if(st==='paused_day'||st==='running'||st==='paused') { setWizardStep(4); showToast(st==='paused_day'?'🌙 Voo retomado do dia anterior!':'✏️ Voo carregado') }
    else showToast('✏️ Voo carregado')
  }

  // Todos os voos desse piloto ainda em aberto (rodando, pausado ou parcial) — consultado direto
  // no servidor porque pode ter mais de um (ex: um parcial esquecido de outro dia + um rodando agora),
  // e o estado local só sabe do último que passou por esse aparelho.
  async function carregarFlightsAbertos(){
    if(!profile?.id) return
    try {
      const {data,error} = await supabase.from('relatorios').select('id,cliente,fazenda,localizacao,status,dt_inicio,created_at')
        .eq('piloto_id',profile.id).in('status',['em_operacao','pausado','pausado_dia']).order('created_at',{ascending:false})
      if(error) throw error
      setFlightsAbertos(data||[])
    } catch(e) { console.error('Erro ao carregar voos abertos:',e) }
  }
  useEffect(()=>{ carregarFlightsAbertos() },[profile?.id,opState]) // eslint-disable-line

  async function abrirVooAberto(id){
    if(id===relId){ setContinuarModalOpen(false); setView('form'); setWizardStep(4); return }
    try {
      const {data} = await supabase.from('relatorios').select('*').eq('id',id).single()
      if(data){ setContinuarModalOpen(false); openFlight(data) }
    } catch(e){ showToast('Erro ao abrir voo: '+e.message,'error') }
  }

  async function deletarRascunho(rel) {
    try {
      const { error } = await supabase.from('relatorios').delete().eq('id', rel.id)
      if (error) throw error
      setFlights(fs=>fs.filter(f=>f.id!==rel.id))
      if (relId===rel.id) limpar(true)
      setRascunhoParaExcluir(null)
      showToast('🗑️ Rascunho excluído')
    } catch(e) { showToast('Erro ao excluir: '+e.message,'error') }
  }

  async function deletarTodosRascunhos() {
    const ids = flights.filter(f=>f.status==='rascunho').map(f=>f.id)
    if(ids.length===0) return
    try {
      const { error } = await supabase.from('relatorios').delete().in('id', ids)
      if (error) throw error
      setFlights(fs=>fs.filter(f=>!ids.includes(f.id)))
      if (ids.includes(relId)) limpar(true)
      showToast(`🗑️ ${ids.length} rascunho(s) excluído(s)`)
    } catch(e) { showToast('Erro ao excluir: '+e.message,'error') }
  }

  // Voos marcados como teste, em qualquer status (rascunho/parcial/finalizado) — não conta
  // pra produção, então dá pra limpar tudo de uma vez sem afetar dados reais.
  async function deletarTodosTestes() {
    const ids = flights.filter(f=>f.teste).map(f=>f.id)
    if(ids.length===0) return
    try {
      const { error } = await supabase.from('relatorios').delete().in('id', ids)
      if (error) throw error
      setFlights(fs=>fs.filter(f=>!ids.includes(f.id)))
      if (ids.includes(relId)) limpar(true)
      showToast(`🧪 ${ids.length} voo(s) de teste excluído(s)`)
    } catch(e) { showToast('Erro ao excluir: '+e.message,'error') }
  }

  async function handleContinuarVoo(){
    // Sempre abre a lista na hora, mesmo com 1 voo só ou nenhum — nada de auto-navegar
    // por trás, pra ficar previsível: clicou, aparece a pergunta "qual voo?".
    setContinuarLoading(true)
    setContinuarModalOpen(true)
    const {data} = await supabase.from('relatorios').select('id,cliente,fazenda,localizacao,status,dt_inicio,created_at')
      .eq('piloto_id',profile.id).in('status',['em_operacao','pausado','pausado_dia']).order('created_at',{ascending:false})
    setFlightsAbertos(data||[])
    setContinuarLoading(false)
  }

  function tentarSair(){
    if(opState==='running'||opState==='paused') setExitConfirm(true)
    else signOut()
  }

  // Precisa ficar disponível em toda tela que tem botão "Sair" (não só no wizard) — antes só
  // existia lá, então clicar Sair na Home/Relatórios/Notas/Tempo/Agenda com voo em andamento
  // não fazia nada visível (o aviso simplesmente não tinha onde renderizar).
  const ExitConfirmModal = () => !exitConfirm ? null : (
    <div style={s.modalOverlay} onClick={()=>setExitConfirm(false)}>
      <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
        <div style={s.modalTitle}>⚠️ Operação em andamento</div>
        <p style={{fontSize:14,color:'#5c7568',marginBottom:20,lineHeight:1.6}}>Você tem uma operação em andamento. Os dados estão salvos. Deseja sair?</p>
        <div style={{display:'flex',gap:10}}>
          <button style={{...s.shareBtn,background:'#f1f8f4',color:'#5c7568',flex:1}} onClick={()=>setExitConfirm(false)}>Cancelar</button>
          <button style={{...s.shareBtn,background:'#e5484d',flex:1}} onClick={()=>{setExitConfirm(false);signOut()}}>Sair</button>
        </div>
      </div>
    </div>
  )

  // Substitui window.confirm — dentro do preview embutido (iframe) o confirm() nativo é
  // bloqueado silenciosamente e retorna false sem o usuário ver nada, fazendo o botão
  // parecer quebrado. Esse modal funciona em qualquer contexto (preview, app, navegador).
  const ConfirmDialogModal = () => !confirmDialog ? null : (
    <div style={s.modalOverlay} onClick={()=>setConfirmDialog(null)}>
      <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
        <div style={s.modalTitle}>⚠️ Confirmar</div>
        <p style={{fontSize:14,color:'#5c7568',marginBottom:20,lineHeight:1.6}}>{confirmDialog.message}</p>
        <div style={{display:'flex',gap:10}}>
          <button style={{...s.shareBtn,background:'#f1f8f4',color:'#5c7568',flex:1}} onClick={()=>setConfirmDialog(null)}>Cancelar</button>
          <button style={{...s.shareBtn,background:'#e5484d',flex:1}} onClick={()=>{const fn=confirmDialog.onConfirm;setConfirmDialog(null);fn()}}>Confirmar</button>
        </div>
      </div>
    </div>
  )

  // Sai do fluxo de voo pra Home — salva o progresso primeiro se já tem algo preenchido,
  // pra não perder dados do piloto (diferente de "Limpar"/"Novo Voo", que descartam).
  async function sairDoFluxoVoo(){
    if(form.cliente || form.fazenda || opState!=='idle') await saveToSupabase({status:statusAtual()})
    setView('home')
  }

  // Botão de saída rápida do fluxo, disponível nos 5 passos ao lado dos demais — salva o
  // progresso (sairDoFluxoVoo) antes de voltar pra Home, então nunca perde dado preenchido.
  const HomeExitBtn = () => (
    <button type="button" style={{...sw.btnG,background:'#f1f8f4',color:'#5c7568',flex:'0 0 42px',padding:'11px 4px',fontSize:16}} onClick={sairDoFluxoVoo}>🏠</button>
  )

  function limpar(silent=false){
    try{localStorage.removeItem(LS_KEY)}catch{}
    setForm(initForm());setOpState('idle');setRelId(null);setOsAtual(null);setSaveStatus(null);setPendingSync(false)
    setObsFotos([null,null,null]);setObsFotoFiles([null,null,null])
    setFotoMapa(null);setFotoMapaFile(null)
    setStorageFotoMapa(null);setStorageObsFotos([null,null,null])
    setKmlFiles([])
    setWizardStep(1)
    if(!silent) showToast('🗑️ Formulário limpo')
  }

  const opLabel={idle:'Nova operação',running:'🟢 Em operação',paused:'🟡 Pausado',paused_day:'🌙 Finalizado Parcial',finished:'🔴 Finalizado'}[opState]
  // Status correto para salvar sem rebaixar voo finalizado para rascunho
  const statusAtual = () => opState==='finished'?'finalizado':opState==='running'?'em_operacao':opState==='paused'?'pausado':opState==='paused_day'?'pausado_dia':'rascunho'

  // VIEW VOOS ANTERIORES
  // Labels e ícones dos steps
  const STEPS = [
    {n:1, label:'Identificação'},
    {n:2, label:'Aplicação'},
    {n:3, label:'Condições'},
    {n:4, label:'Ação'},
    {n:5, label:'Relatório'},
  ]

  const sw = {
    wrap:{maxWidth:480,margin:'0 auto',minHeight:'100vh',display:'flex',flexDirection:'column',background:'#fff',fontFamily:"'DM Sans',sans-serif"},
    header:{background:'linear-gradient(135deg,#0e9f6e 0%,#0a6e4f 100%)',padding:'calc(env(safe-area-inset-top,0px)+14px) 18px 0'},
    logoRow:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12},
    logoTxt:{fontFamily:"'Syne',sans-serif",fontSize:19,fontWeight:700,color:'#fff',display:'flex',alignItems:'center',gap:8},
    stepsWrap:{padding:'0 18px 14px'},
    stepsRow:{display:'flex',alignItems:'center'},
    stepCirc:{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0,transition:'all .2s'},
    stepDone:{background:'#fff',color:'#0e9f6e'},
    stepActive:{background:'#ffb020',color:'#3a2a00',boxShadow:'0 0 0 5px rgba(255,176,32,0.28)',transform:'scale(1.08)'},
    stepNext:{background:'rgba(255,255,255,0.2)',color:'rgba(255,255,255,0.65)'},
    stepLine:{flex:1,height:2,background:'rgba(255,255,255,0.25)'},
    stepLineDone:{flex:1,height:2,background:'#fff'},
    stepLabelRow:{display:'flex',justifyContent:'space-between',marginTop:4},
    stepLbl:{fontSize:9,color:'rgba(255,255,255,0.6)',flex:1,textAlign:'center'},
    stepLblActive:{fontSize:9,color:'#fff',flex:1,textAlign:'center',fontWeight:700},
    body:{flex:1,overflowY:'auto',padding:'20px 18px 8px'},
    pageTitle:{fontSize:20,fontWeight:700,color:'#0b1210',marginBottom:4,fontFamily:"'Syne',sans-serif"},
    pageSub:{fontSize:12,color:'#7ba38f',marginBottom:20},
    fw:{marginBottom:14},
    fl:{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:5,display:'block',fontFamily:"'Syne',sans-serif"},
    fi:{width:'100%',border:'1px solid #e0ece5',borderRadius:10,padding:'12px 14px',fontSize:14,color:'#0b1210',outline:'none',background:'#fff',boxSizing:'border-box',fontFamily:"'DM Sans',sans-serif"},
    fs:{width:'100%',border:'1px solid #e0ece5',borderRadius:10,padding:'12px 14px',fontSize:14,color:'#0b1210',outline:'none',background:'#fff',boxSizing:'border-box',fontFamily:"'DM Sans',sans-serif",appearance:'none'},
    btnBar:{padding:'10px 18px 20px',background:'#fff',borderTop:'1px solid #f0f0f0',boxSizing:'border-box'},
    btnG:{width:'100%',background:'#0e9f6e',color:'#fff',border:'none',borderRadius:100,padding:'11px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:"'Syne',sans-serif",display:'flex',alignItems:'center',justifyContent:'center',gap:8,boxShadow:'0 6px 18px rgba(14,159,110,0.35)'},
    timerWrap:{display:'flex',flexDirection:'column',alignItems:'center',padding:'16px 0 10px'},
    statusBadge:(st)=>({display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:600,background:st==='running'?'#e3f7ec':st==='paused'?'#fff3e0':'#f5f5f5',color:st==='running'?'#0e9f6e':st==='paused'?'#f2960f':'#888'}),
  }

  const WHeader = () => (
    <div style={sw.header}>
      <div style={sw.logoRow}>
        <div style={sw.logoTxt}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Orofly
        </div>
        <div style={{display:'flex',gap:6}}>
          {onSwitchMode&&<button style={{background:'#ffb020',border:'none',color:'#0b1210',borderRadius:16,padding:'5px 10px',fontSize:12,cursor:'pointer',fontWeight:600}} onClick={onSwitchMode}>⚙️</button>}
          <button style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:16,padding:'5px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setView('home')}>🏠</button>
          <button style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:16,padding:'5px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>{loadFlights();setView('flights')}}>📋</button>
          <button style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:16,padding:'5px 10px',fontSize:12,cursor:'pointer'}} onClick={tentarSair}>Sair</button>
        </div>
      </div>
      {osAtual&&(
        <div style={{padding:'0 18px 10px',display:'flex',alignItems:'center',gap:6}}>
          <span style={{background:'rgba(255,255,255,0.16)',color:'#fff',fontFamily:'ui-monospace,monospace',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:20}}>📋 OS {osAtual}</span>
        </div>
      )}
      {pendingSync&&(
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,background:'#5a3d0a',padding:'6px 12px',fontSize:11,color:'#ffb020'}}>
          <span>📴 Sem sincronizar — será enviado automaticamente com sinal</span>
          <button style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#ffb020',borderRadius:14,padding:'3px 9px',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}
            onClick={()=>saveToSupabase(lastExtraData.current||{},false)}>🔄 Tentar agora</button>
        </div>
      )}
      <div style={sw.stepsWrap}>
        <div style={sw.stepsRow}>
          {STEPS.map((st,i)=>(
            <React.Fragment key={i}>
              {i>0&&<div style={wizardStep>i?sw.stepLineDone:sw.stepLine}/>}
              <div
                style={{...sw.stepCirc,...(wizardStep>st.n?sw.stepDone:wizardStep===st.n?sw.stepActive:sw.stepNext),cursor:'pointer'}}
                onClick={()=>setWizardStep(st.n)}>
                {wizardStep>st.n?'✓':st.n}
              </div>
            </React.Fragment>
          ))}
        </div>
        <div style={sw.stepLabelRow}>
          {STEPS.map((st,i)=>(
            <span key={i} style={{...wizardStep===st.n?sw.stepLblActive:sw.stepLbl,cursor:'pointer'}} onClick={()=>setWizardStep(st.n)}>{st.label}</span>
          ))}
        </div>
      </div>
    </div>
  )

  const BottomNav = () => (
    <div style={{position:'fixed',left:0,right:0,bottom:0,maxWidth:480,margin:'0 auto',background:'#fff',borderTop:'1px solid #dcebe3',padding:'10px 20px calc(env(safe-area-inset-bottom,0px) + 10px)',display:'flex',justifyContent:'space-around',alignItems:'flex-end',zIndex:50,boxShadow:'0 -8px 24px rgba(11,18,16,0.06)'}}>
      <div onClick={()=>setView('home')} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,cursor:'pointer',color:view==='home'?'#0e9f6e':'#a9beb1',minWidth:52}}>
        <span style={{fontSize:20}}>🏠</span>
        <span style={{fontSize:10,fontWeight:700}}>Início</span>
      </div>
      {(()=>{
        const temVooAberto = flightsAbertos.length>0
        return (
          <div onClick={handleContinuarVoo} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:temVooAberto?'pointer':'default',marginTop:-26,position:'relative'}}>
            <span style={{width:52,height:52,borderRadius:'50%',background:temVooAberto?'linear-gradient(135deg,#0e9f6e,#22c476)':'#c3d4c9',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',boxShadow:temVooAberto?'0 8px 20px rgba(14,159,110,0.45)':'none',border:'4px solid #fff'}}>
              <IconRota size={22}/>
              {flightsAbertos.length>1&&<span style={{position:'absolute',top:-2,right:-2,background:'#ffb020',color:'#3a2a00',fontSize:10,fontWeight:700,borderRadius:20,minWidth:17,height:17,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 3px',border:'2px solid #fff'}}>{flightsAbertos.length}</span>}
            </span>
            <span style={{fontSize:10,fontWeight:700,color:temVooAberto?'#0e9f6e':'#a9beb1'}}>Continuar voo</span>
          </div>
        )
      })()}
      <div onClick={()=>{loadFlights();setView('flights')}} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,cursor:'pointer',color:view==='flights'?'#0e9f6e':'#a9beb1',minWidth:52}}>
        <span style={{fontSize:20}}>📋</span>
        <span style={{fontSize:10,fontWeight:700}}>Relatórios</span>
      </div>
    </div>
  )

  if(view==='home') {
    const draftAtivo = opState!=='idle' && opState!=='finished'
    const hoje = new Date()
    const mesmoDia = d => d && new Date(d).toDateString()===hoje.toDateString()
    const finalizados = flights.filter(r=>r.status==='finalizado')
    const voosHoje = finalizados.filter(r=>mesmoDia(r.dt_inicio||r.created_at))
    const areaHoje = voosHoje.reduce((a,r)=>a+parseFloat(r.area_ha||0),0)
    const primeiroNome = (profile?.nome||'').split(' ')[0] || 'Piloto'
    const iniciais = (profile?.nome||'P').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()
    const minutosHoje = voosHoje.reduce((a,r)=>{ if(!r.dt_inicio||!r.dt_fim) return a; return a+Math.max(0,Math.round((new Date(r.dt_fim)-new Date(r.dt_inicio))/60000)) },0)
    const horasHoje = minutosHoje/60
    const horaAtual = hoje.getHours()
    const saudacao = horaAtual<12 ? 'Bom dia' : horaAtual<18 ? 'Boa tarde' : 'Boa noite'
    const condDia = tempoDias?.[0]
    const condicoesOk = condDia ? (condDia.deltaTClass?.status==='apta' && condDia.chuvaProb<50) : null
    return (
      <div style={s.wrap}>
        <div style={{background:'#fff',borderBottom:'1px solid #eef5f0',padding:'calc(env(safe-area-inset-top,0px) + 16px) 18px 20px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0e9f6e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              <span style={{fontFamily:"'Syne',sans-serif",fontSize:19,fontWeight:700,color:'#0b1210'}}>Orofly<span style={{color:'#0e9f6e'}}>.</span></span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              {onSwitchMode&&<button style={{background:'#f1f8f4',border:'none',color:'#5c7568',borderRadius:20,padding:'6px 9px',fontSize:12,cursor:'pointer'}} onClick={onSwitchMode}>⚙️</button>}
              <button style={{background:'#f1f8f4',border:'none',color:'#5c7568',borderRadius:20,padding:'6px 9px',fontSize:12,cursor:'pointer'}} onClick={tentarSair}>Sair</button>
              <div onClick={()=>setShowPerfil(true)} style={{width:44,height:44,borderRadius:'50%',background:'#e3f7ec',border:'2px solid #0e9f6e',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Syne',sans-serif",fontWeight:700,color:'#0e9f6e',fontSize:15,flexShrink:0,cursor:'pointer',overflow:'hidden'}}>
                {avatarUrl?<img src={avatarUrl} alt="avatar" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:iniciais}
              </div>
            </div>
          </div>
          <div style={{marginTop:22}}>
            <div style={{fontSize:24,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{saudacao}, {primeiroNome}</div>
            <div style={{fontSize:14,color:'#7ba38f',marginTop:4,display:'flex',alignItems:'center',gap:6}}>
              Hoje: {voosHoje.length} voos · {areaHoje.toFixed(areaHoje<10?1:0)} ha{condicoesOk!==null && <> · Condições {condicoesOk?'✅':'⚠️'}</>}
            </div>
          </div>
        </div>

        <div style={{padding:'14px 16px 100px',flex:1,display:'flex',flexDirection:'column',gap:14}}>
          {/* Voo em andamento */}
          {draftAtivo && (opState==='paused_day' ? (()=>{
            const {total,feita,pct} = progressoParcial(form)
            return (
              <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',borderLeft:'4px solid #0e9f6e',padding:'14px 16px',cursor:'pointer',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}} onClick={()=>setView('form')}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span style={{width:40,height:40,borderRadius:12,background:'#e3f7ec',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>🕐</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:15,fontWeight:700,fontFamily:"'Syne',sans-serif",color:'#0b1210'}}>Operação em Andamento</div>
                    <div style={{fontSize:12,color:'#7ba38f',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{form.fazenda||'—'}{total>0?` · ${feita.toFixed(2)} ha de ${total.toFixed(2)} ha`:''}</div>
                  </div>
                  <span style={{background:'#e3f7ec',color:'#0e9f6e',fontSize:10,fontWeight:700,borderRadius:20,padding:'4px 10px',flexShrink:0,fontFamily:"'Syne',sans-serif"}}>PARCIAL</span>
                </div>
                {total>0&&(
                  <div style={{height:8,background:'#eef5f0',borderRadius:20,overflow:'hidden',marginTop:12}}>
                    <div style={{height:'100%',width:`${pct}%`,background:'#0e9f6e',borderRadius:20,transition:'width .3s'}}/>
                  </div>
                )}
              </div>
            )
          })() : (
            <div style={{background:'linear-gradient(135deg,#0e9f6e,#0a6e4f)',borderRadius:22,padding:18,color:'#fff',cursor:'pointer',boxShadow:'0 10px 26px rgba(14,159,110,0.35)',position:'relative',overflow:'hidden'}} onClick={()=>setView('form')}>
              <span style={{position:'absolute',right:-10,bottom:-14,fontSize:64,opacity:.15}}>🚁</span>
              <div style={{fontSize:11,fontWeight:700,opacity:.85,letterSpacing:.5}}>{opState==='paused'?'🟡 VOO PAUSADO':'🟢 VOO EM ANDAMENTO'}</div>
              <div style={{fontSize:17,fontWeight:700,marginTop:4,fontFamily:"'Syne',sans-serif"}}>{form.cliente||'—'} — {form.fazenda||'—'}</div>
              {osAtual&&<div style={{fontSize:10,fontFamily:'ui-monospace,monospace',opacity:.8,marginTop:2}}>OS {osAtual}</div>}
              <div style={{fontSize:12,opacity:.9,marginTop:6,display:'flex',alignItems:'center',gap:6}}>▶️ Continuar voo <span style={{marginLeft:'auto'}}>›</span></div>
            </div>
          ))}

          {/* Ação principal */}
          <button style={{background:draftAtivo?'#fff':'linear-gradient(135deg,#0e9f6e,#22c476)',color:draftAtivo?'#0e9f6e':'#fff',border:draftAtivo?'2px solid #0e9f6e':'none',borderRadius:24,padding:'20px',display:'flex',alignItems:'center',gap:14,cursor:'pointer',textAlign:'left',boxShadow:draftAtivo?'none':'0 10px 24px rgba(14,159,110,0.3)'}}
            onClick={()=>{
              // Novo Voo sempre começa do zero, sem perguntar nada — o voo anterior (se houver)
              // já está salvo no servidor e continua acessível por "Continuar voo".
              limpar(true); setView('form')
            }}>
            <span style={{width:48,height:48,borderRadius:14,background:draftAtivo?'#e3f7ec':'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,color:draftAtivo?'#0e9f6e':'#fff'}}><IconRota size={24}/></span>
            <div>
              <div style={{fontSize:16,fontWeight:700,fontFamily:"'Syne',sans-serif"}}>Novo Voo</div>
              <div style={{fontSize:12,opacity:.85}}>Iniciar uma nova operação</div>
            </div>
            <span style={{marginLeft:'auto',fontSize:18}}>›</span>
          </button>

          {/* Estatísticas do dia */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
            {[
              [IconDrone,'#0e9f6e',voosHoje.length,'Voos',()=>{loadFlights();setView('flights')}],
              [Clock,'#2f6fed',horasHoje.toFixed(1)+'h','Horas de Voo',()=>{loadFlights();setView('flights')}],
              [Map,'#f2960f',areaHoje.toFixed(0)+' ha','Área Pulverizada',()=>{loadFlights();setView('flights')}],
            ].map(([Icon,color,value,label,onClick])=>(
              <div key={label} onClick={onClick} style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:'18px 6px',textAlign:'center',boxShadow:'0 6px 20px rgba(11,18,16,0.05)',cursor:'pointer'}}>
                <Icon size={26} color={color} style={{marginBottom:8}}/>
                <div style={{fontSize:22,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif",fontVariantNumeric:'tabular-nums'}}>{value}</div>
                <div style={{fontSize:11,color:'#7ba38f',marginTop:3}}>{label}</div>
              </div>
            ))}
          </div>

          {/* Menu — grid 2x2 */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {(()=>{
              const hoje=new Date()
              const voosMes = flights.filter(f=>{const d=new Date(f.created_at);return d.getMonth()===hoje.getMonth()&&d.getFullYear()===hoje.getFullYear()}).length
              return (
                <button style={{background:'#fff',color:'#0b1210',border:'1px solid #dcebe3',borderRadius:22,padding:'16px',display:'flex',flexDirection:'column',gap:10,cursor:'pointer',textAlign:'left',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}
                  onClick={()=>{loadFlights();setView('flights')}}>
                  <span style={{width:44,height:44,borderRadius:14,background:'#e3f7ec',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><FileBarChart2 size={20} color="#0e9f6e"/></span>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,fontFamily:"'Syne',sans-serif"}}>Meus Relatórios</div>
                    <div style={{fontSize:11,color:'#7ba38f'}}>{voosMes>0?`${voosMes} voo(s) este mês`:'Ver histórico'}</div>
                  </div>
                </button>
              )
            })()}

            {(()=>{
              const pendentes = minhaAgenda.filter(a=>a.status==='pendente')
              return (
                <button style={{background:'#fff',color:'#0b1210',border:'1px solid #dcebe3',borderRadius:22,padding:'16px',display:'flex',flexDirection:'column',gap:10,cursor:'pointer',textAlign:'left',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}
                  onClick={()=>{loadAgenda();setView('agenda')}}>
                  <span style={{width:44,height:44,borderRadius:14,background:'#e6f1fb',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,position:'relative'}}>
                    <CalendarDays size={20} color="#2f6fed"/>
                    {pendentes.length>0&&<span style={{position:'absolute',top:-4,right:-4,background:'#e5484d',color:'#fff',fontSize:10,fontWeight:700,borderRadius:20,minWidth:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px'}}>{pendentes.length}</span>}
                  </span>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,fontFamily:"'Syne',sans-serif"}}>Minha Agenda</div>
                    <div style={{fontSize:11,color:'#7ba38f'}}>{pendentes.length>0?`${pendentes.length} programado(s)`:'Nenhum voo'}</div>
                  </div>
                </button>
              )
            })()}

            {(()=>{
              const hoje=new Date()
              const notasMes = minhasNotas.filter(n=>{const d=new Date(n.created_at||n.data);return d.getMonth()===hoje.getMonth()&&d.getFullYear()===hoje.getFullYear()}).length
              return (
                <button style={{background:'#fff',color:'#0b1210',border:'1px solid #dcebe3',borderRadius:22,padding:'16px',display:'flex',flexDirection:'column',gap:10,cursor:'pointer',textAlign:'left',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}
                  onClick={()=>{loadNotas();loadOsOpcoes();setView('notas')}}>
                  <span style={{width:44,height:44,borderRadius:14,background:'#fff3e0',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Receipt size={20} color="#f2960f"/></span>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,fontFamily:"'Syne',sans-serif"}}>Cadastro de Notas</div>
                    <div style={{fontSize:11,color:'#7ba38f'}}>{notasMes>0?`${notasMes} nota(s) este mês`:'Almoço, gasolina...'}</div>
                  </div>
                </button>
              )
            })()}

            <button style={{background:'#fff',color:'#0b1210',border:'1px solid #dcebe3',borderRadius:22,padding:'16px',display:'flex',flexDirection:'column',gap:10,cursor:'pointer',textAlign:'left',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}
              onClick={()=>setView('tempo')}>
              <span style={{width:44,height:44,borderRadius:14,background:'#f3ecfb',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><CloudSun size={20} color="#8e44ad"/></span>
              <div>
                <div style={{fontSize:15,fontWeight:700,fontFamily:"'Syne',sans-serif"}}>Previsão do Tempo</div>
                <div style={{fontSize:11,color:'#7ba38f'}}>{tempoDias?`${Math.round(tempoDias[0].tempMax)}°C hoje`:'Chuva e Delta T'}</div>
              </div>
            </button>
          </div>

          {/* Voos compartilhados pendentes */}
          {voosCompartilhados.length>0&&(
            <div style={{background:'#fffbea',border:'2px solid #ffb020',borderRadius:14,padding:14}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:'#7a5c00',marginBottom:10}}>🤝 Voos Disponíveis ({voosCompartilhados.length})</div>
              {voosCompartilhados.map(v=>(
                <div key={v.id} style={{background:'#fff',borderRadius:10,padding:'10px 12px',marginBottom:8,border:'1px solid #f0d070'}}>
                  <div style={{fontWeight:700,fontSize:13,color:'#0b1210'}}>{v.cliente} — {v.fazenda}</div>
                  <div style={{fontSize:11,color:'#5c7568',marginTop:2}}>Piloto: {v.piloto_nome}</div>
                  <button style={{marginTop:8,background:'#ffb020',color:'#3a2a00',border:'none',borderRadius:16,padding:'6px 14px',fontSize:12,fontWeight:700,cursor:'pointer',width:'100%'}}
                    onClick={()=>{ setTrechoModal(v); setTrechoForm(initTrechoForm()); setView('form') }}>➕ Adicionar meu trecho</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <BottomNav/>
        {toast&&<div style={s.toast}>{toast}</div>}
        {showPerfil&&<ProfileModal profile={profile} onClose={()=>setShowPerfil(false)} onSaved={async()=>{await refreshProfile();setShowPerfil(false);showToast('✅ Perfil atualizado!')}}/>}
        <ExitConfirmModal/>
      </div>
    )
  }

  if(view==='flights') return (
    <div style={{...s.wrap,paddingBottom:80}}>
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c476" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span style={s.logoTxt}>Orofly<span style={s.dot}>.</span></span></div>
          <div style={{display:'flex',gap:6}}>
            {onSwitchMode&&<button style={s.switchBtn} onClick={onSwitchMode}>⚙️ Admin</button>}
            <button style={s.logoutBtn} onClick={tentarSair}>Sair</button>
          </div>
        </div>
        <div style={s.headerSub}>Meus Voos · {profile?.nome}</div>
      </div>
      <div style={s.statusBar}><span>📋 Histórico de voos</span></div>
      <div style={{padding:16,flex:1,display:'flex',flexDirection:'column',gap:10}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <button style={{...s.nowBtn,padding:'10px 16px',fontSize:13}} onClick={()=>setView('home')}>← Voltar</button>
          {flights.some(f=>f.status==='rascunho')&&(
            <button style={{...s.nowBtn,padding:'10px 16px',fontSize:13,background:'#fdeaea',color:'#e5484d'}}
              onClick={()=>setConfirmDialog({message:'Excluir TODOS os rascunhos? Essa ação não pode ser desfeita.',onConfirm:deletarTodosRascunhos})}>
              🗑️ Excluir todos os rascunhos
            </button>
          )}
          {flights.some(f=>f.teste)&&(
            <button style={{...s.nowBtn,padding:'10px 16px',fontSize:13,background:'#fff3e0',color:'#a3690a'}}
              onClick={()=>setConfirmDialog({message:'Excluir TODOS os voos marcados como teste (qualquer status)? Essa ação não pode ser desfeita.',onConfirm:deletarTodosTestes})}>
              🧪 Excluir todos os testes
            </button>
          )}
        </div>
        {loadingFlights?<div style={{textAlign:'center',color:'#5c7568',padding:40}}>Carregando...</div>
        :flights.length===0?<div style={{textAlign:'center',color:'#5c7568',padding:40}}>Nenhum voo registrado</div>
        :flights.map(rel=>(
          <div key={rel.id} style={{background:'#fff',borderRadius:18,border:'1px solid #d7e6dc',padding:'14px 16px',cursor:'pointer',boxShadow:'0 4px 14px rgba(11,18,16,0.05)'}} onClick={()=>openFlight(rel)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontWeight:600,fontSize:14,color:'#0b1210',fontFamily:"'Syne',sans-serif",display:'flex',alignItems:'center',gap:6}}>
                  {rel.cliente||'—'}
                  {rel.teste&&<span style={{fontSize:9,fontWeight:700,color:'#a3690a',background:'#fff3e0',padding:'2px 7px',borderRadius:20}}>🧪 TESTE</span>}
                </div>
                <div style={{fontSize:12,color:'#5c7568',marginTop:2}}>{rel.fazenda}{rel.area_ha?` · ${rel.area_ha}ha`:''} · {rel.drone}</div>
              </div>
              <div style={{textAlign:'right',display:'flex',alignItems:'flex-start',gap:8}}>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:{em_operacao:'#0e9f6e',pausado:'#f2960f',finalizado:'#2f6fed',sos:'#e5484d'}[rel.status]||'#5c7568'}}>{STATUS_LABEL[rel.status]||rel.status}</div>
                  <div style={{fontSize:11,color:'#5c7568',marginTop:2}}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}</div>
                </div>
                {rel.status==='rascunho'&&(
                  <button title="Excluir rascunho" style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:10,width:26,height:26,fontSize:13,cursor:'pointer',flexShrink:0}}
                    onClick={e=>{e.stopPropagation();setConfirmDialog({message:`Excluir o rascunho de ${rel.cliente||'—'} — ${rel.fazenda||'—'}?`,onConfirm:()=>deletarRascunho(rel)})}}>🗑️</button>
                )}
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
              <span style={{fontSize:12,color:'#aaa'}}>Toque para abrir ✏️</span>
              {rel.ordem_servico&&<span style={{fontSize:10,fontFamily:'ui-monospace,monospace',fontWeight:600,color:'#0e9f6e',background:'#e3f7ec',padding:'2px 8px',borderRadius:20}}>OS {rel.ordem_servico}</span>}
            </div>
          </div>
        ))}
      </div>
      <BottomNav/>
      {toast&&<div style={s.toast}>{toast}</div>}
      <ExitConfirmModal/>
      <ConfirmDialogModal/>
    </div>
  )

  if(view==='notas') return (
    <div style={{...s.wrap,paddingBottom:90}}>
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c476" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span style={s.logoTxt}>Orofly<span style={s.dot}>.</span></span></div>
          <div style={{display:'flex',gap:6}}>
            {onSwitchMode&&<button style={s.switchBtn} onClick={onSwitchMode}>⚙️ Admin</button>}
            <button style={s.logoutBtn} onClick={tentarSair}>Sair</button>
          </div>
        </div>
        <div style={s.headerSub}>🧾 Cadastro de Notas</div>
      </div>

      <div style={{padding:16,display:'flex',flexDirection:'column',gap:14}}>
        <button style={{...s.nowBtn,padding:'10px 16px',fontSize:13,alignSelf:'flex-start'}} onClick={()=>setView('home')}>← Voltar</button>

        {veiculosDB.length>0 && (
          <div style={{display:'flex',background:'#eef5f0',borderRadius:16,padding:4,gap:4}}>
            <button style={{flex:1,background:notaTab==='viagem'?'#fff':'transparent',color:notaTab==='viagem'?'#0b1210':'#5c7568',border:'none',borderRadius:12,padding:'10px 8px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:notaTab==='viagem'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
              onClick={()=>setNotaTab('viagem')}>🚗 Viagem</button>
            <button style={{flex:1,background:notaTab==='despesa'?'#fff':'transparent',color:notaTab==='despesa'?'#0b1210':'#5c7568',border:'none',borderRadius:12,padding:'10px 8px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:notaTab==='despesa'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
              onClick={()=>setNotaTab('despesa')}>🧾 Despesa</button>
          </div>
        )}

        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
          {/* Foto da nota */}
          <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>FOTO DA NOTA</div>
          {notaFotoPreview ? (
            <div style={{position:'relative',marginBottom:14}}>
              <img src={notaFotoPreview} alt="nota" style={{width:'100%',maxHeight:220,objectFit:'cover',borderRadius:14,display:'block'}}/>
              <button style={{position:'absolute',top:8,right:8,background:'rgba(11,18,16,0.65)',color:'#fff',border:'none',borderRadius:20,width:28,height:28,cursor:'pointer'}}
                onClick={()=>{setNotaFotoPreview(null);setNotaFotoFile(null)}}>✕</button>
            </div>
          ) : (
            <div style={{display:'flex',gap:10,marginBottom:14}}>
              <button style={{flex:1,background:'#e3f7ec',color:'#0e9f6e',border:'none',borderRadius:16,padding:'14px 8px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                onClick={()=>document.getElementById('nota-camera')?.click()}>📸 Câmera</button>
              <button style={{flex:1,background:'#e6f1fb',color:'#2f6fed',border:'none',borderRadius:16,padding:'14px 8px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                onClick={()=>document.getElementById('nota-galeria')?.click()}>🖼️ Galeria</button>
            </div>
          )}
          <input id="nota-camera" type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>handleNotaFoto(e.target.files[0])}/>
          <input id="nota-galeria" type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleNotaFoto(e.target.files[0])}/>

          {(notaTab==='despesa' || veiculosDB.length===0) && (
            <>
              {/* Categoria */}
              <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>CATEGORIA</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
                {CATEGORIA_DESPESA_OPTS.map(([cat,ic])=>(
                  <button key={cat} type="button" style={{background:notaForm.categoria===cat?'#0e9f6e':'#f1f8f4',color:notaForm.categoria===cat?'#fff':'#0b1210',border:'none',borderRadius:16,padding:'10px 8px',fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}
                    onClick={()=>setNotaForm(f=>({...f,categoria:cat}))}>{ic} {cat}</button>
                ))}
              </div>

              {/* Valor + data */}
              <div style={{display:'flex',gap:10,marginBottom:14}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>VALOR (R$)</div>
                  <input type="number" style={sw.fi} placeholder="0,00" value={notaForm.valor} onChange={e=>setNotaForm(f=>({...f,valor:e.target.value}))}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>DATA</div>
                  <input type="date" style={sw.fi} value={notaForm.data} onChange={e=>setNotaForm(f=>({...f,data:e.target.value}))}/>
                </div>
              </div>
            </>
          )}

          {/* Veículo / Viagem — aba dedicada */}
          {notaTab==='viagem' && veiculosDB.length>0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>VEÍCULO</div>
              <select style={{...sw.fs,marginBottom:8}} value={notaForm.veiculo_id}
                onChange={e=>{
                  const v = veiculosDB.find(x=>x.id===e.target.value)
                  setNotaForm(f=>({...f,veiculo_id:e.target.value,km_inicial:v?String(v.km_atual||0):''}))
                }}>
                <option value="">Selecione o veículo...</option>
                {veiculosDB.map(v=><option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>)}
              </select>
              {notaForm.veiculo_id && (
                <div style={{display:'flex',gap:10,marginBottom:4}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>KM INICIAL</div>
                    <input type="number" style={sw.fi} placeholder="0" value={notaForm.km_inicial} onChange={e=>setNotaForm(f=>({...f,km_inicial:e.target.value}))}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>KM FINAL</div>
                    <input type="number" style={sw.fi} placeholder="0" value={notaForm.km_final} onChange={e=>setNotaForm(f=>({...f,km_final:e.target.value}))}/>
                  </div>
                </div>
              )}
              {notaForm.veiculo_id && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>GASTOS DESSA VIAGEM (OPCIONAL)</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
                    {CATEGORIA_DESPESA_OPTS.map(([cat,ic])=>(
                      <button key={cat} type="button" style={{background:'#f1f8f4',color:'#0b1210',border:'none',borderRadius:14,padding:'8px 12px',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}
                        onClick={()=>addItemViagem(cat)}>+ {ic} {cat}</button>
                    ))}
                  </div>
                  {notaForm.itensViagem.map(item=>{
                    const ic = CATEGORIA_DESPESA_OPTS.find(([c])=>c===item.categoria)?.[1]||'🧾'
                    return (
                      <div key={item.id} style={{marginBottom:8}}>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                          <div style={{flex:'0 0 auto',fontSize:12,fontWeight:600,color:'#0b1210',whiteSpace:'nowrap'}}>{ic} {item.categoria}</div>
                          <input type="number" style={{...sw.fi,flex:1}} placeholder="Valor (R$)" value={item.valor} onChange={e=>updateItemViagem(item.id,e.target.value)}/>
                          <button type="button" style={{background:'#fdecec',color:'#e5484d',border:'none',borderRadius:12,width:34,height:34,flexShrink:0,cursor:'pointer'}} onClick={()=>removeItemViagem(item.id)}>🗑️</button>
                        </div>
                        {item.categoria==='Gasolina' && notaForm.km_inicial!=='' && notaForm.km_final!=='' && (
                          <div style={{fontSize:11,color:'#7ba38f',marginTop:3}}>🔢 Km {notaForm.km_inicial} → {notaForm.km_final}</div>
                        )}
                      </div>
                    )
                  })}
                  <div style={{fontSize:11,color:'#7ba38f',marginTop:2}}>Cada item lançado aqui já fica vinculado a essa viagem (veículo/OS) automaticamente.</div>
                </div>
              )}
              <div style={{marginTop:4}}>
                <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>DATA</div>
                <input type="date" style={sw.fi} value={notaForm.data} onChange={e=>setNotaForm(f=>({...f,data:e.target.value}))}/>
              </div>
            </div>
          )}

          {/* Ordem de serviço */}
          <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>ORDEM DE SERVIÇO (OPCIONAL)</div>
          {osModo==='lista' ? (
            <select style={{...sw.fs,marginBottom:4}} value={notaForm.ordem_servico}
              onChange={e=>{
                if(e.target.value==='__outro__'){ setOsModo('outro'); setNotaForm(f=>({...f,ordem_servico:''})); return }
                setNotaForm(f=>({...f,ordem_servico:e.target.value}))
              }}>
              <option value="">Nenhuma / não vincular a um voo</option>
              {osOpcoes.map(r=>(
                <option key={r.id} value={r.ordem_servico}>OS {r.ordem_servico} — {r.cliente||'—'} / {r.fazenda||'—'}{onSwitchMode?` · ${r.piloto_nome||'—'}`:''} ({new Date(r.dt_inicio||r.created_at).toLocaleDateString('pt-BR')})</option>
              ))}
              <option value="__outro__">🔎 Outra OS (digitar manualmente)...</option>
            </select>
          ) : (
            <div style={{display:'flex',gap:8,marginBottom:4}}>
              <input style={{...sw.fi,flex:1}} placeholder="Ex: 132134b" value={notaForm.ordem_servico} onChange={e=>setNotaForm(f=>({...f,ordem_servico:e.target.value}))}/>
              <button type="button" style={{background:'#f1f8f4',color:'#5c7568',border:'none',borderRadius:14,padding:'0 14px',fontSize:12,fontWeight:600,cursor:'pointer'}} onClick={()=>{setOsModo('lista');setNotaForm(f=>({...f,ordem_servico:''}))}}>📋 Lista</button>
            </div>
          )}
          <div style={{fontSize:11,color:'#7ba38f',marginBottom:14}}>{onSwitchMode?'Voos recentes de todos os pilotos aparecem na lista':'Voos recentes seus aparecem na lista'} — ou digite a OS manualmente</div>

          {/* Observação */}
          <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>OBSERVAÇÃO (OPCIONAL)</div>
          <input style={{...sw.fi,marginBottom:16}} placeholder="Ex: almoço com equipe" value={notaForm.observacao} onChange={e=>setNotaForm(f=>({...f,observacao:e.target.value}))}/>

          <button style={{...sw.btnG,opacity:notaSaving?.7:1}} disabled={notaSaving} onClick={salvarNota}>
            {notaSaving?'Salvando...':(notaForm.categoria||notaForm.valor)?'💾 Salvar Nota':'💾 Salvar'}
          </button>
        </div>

        {/* Notas recentes */}
        <div>
          <div style={{fontSize:13,fontWeight:700,color:'#0b1210',marginBottom:10,fontFamily:"'Syne',sans-serif"}}>Notas Recentes</div>
          {loadingNotas?<div style={{textAlign:'center',color:'#5c7568',padding:20}}>Carregando...</div>
          :minhasNotas.length===0?<div style={{textAlign:'center',color:'#5c7568',padding:20,fontSize:13}}>Nenhuma nota cadastrada ainda</div>
          :minhasNotas.map(n=>(
            <div key={n.id} style={{background:'#fff',borderRadius:16,border:'1px solid #dcebe3',padding:'12px 14px',marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontWeight:600,fontSize:13,color:'#0b1210'}}>{CATEGORIA_DESPESA_OPTS.find(([c])=>c===n.categoria)?.[1]||'🧾'} {n.categoria}</div>
                  <div style={{fontSize:11,color:'#7ba38f',marginTop:2}}>{new Date(n.data).toLocaleDateString('pt-BR')}{n.ordem_servico?` · OS ${n.ordem_servico}`:''}{n.veiculo_id?` · 🚗 ${veiculosDB.find(v=>v.id===n.veiculo_id)?.placa||''}`:''}</div>
                </div>
                <div style={{fontWeight:700,fontSize:14,color:'#0e9f6e',fontFamily:"'Syne',sans-serif"}}>R$ {parseFloat(n.valor).toFixed(2)}</div>
              </div>
              {n.foto_url && <div style={{marginTop:10}}><StorageFotoSlot supabase={supabase} path={n.foto_url} height={120}/></div>}
            </div>
          ))}
        </div>
      </div>
      <BottomNav/>
      {toast&&<div style={s.toast}>{toast}</div>}
      <ExitConfirmModal/>
    </div>
  )

  if(view==='tempo') return (
    <div style={{...s.wrap,paddingBottom:90}}>
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c476" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span style={s.logoTxt}>Orofly<span style={s.dot}>.</span></span></div>
          <div style={{display:'flex',gap:6}}>
            {onSwitchMode&&<button style={s.switchBtn} onClick={onSwitchMode}>⚙️ Admin</button>}
            <button style={s.logoutBtn} onClick={tentarSair}>Sair</button>
          </div>
        </div>
        <div style={s.headerSub}>🌤️ Previsão do Tempo</div>
      </div>

      <div style={{padding:16,display:'flex',flexDirection:'column',gap:14}}>
        <button style={{...s.nowBtn,padding:'10px 16px',fontSize:13,alignSelf:'flex-start'}} onClick={()=>setView('home')}>← Voltar</button>

        {!tempoDias && (
          <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
            <button style={{...sw.btnG,opacity:tempoLoading?.7:1}} disabled={tempoLoading} onClick={buscarPorGPS}>{tempoLoading?'Buscando...':'📍 Usar meu GPS'}</button>
            <div style={{textAlign:'center',fontSize:11,color:'#7ba38f',margin:'14px 0'}}>ou digite seu CEP</div>
            <div style={{display:'flex',gap:8}}>
              <input style={{...sw.fi,flex:1}} placeholder="00000-000" value={tempoCep} maxLength={9}
                onChange={e=>{
                  let v=e.target.value.replace(/\D/g,'').slice(0,8)
                  if(v.length>5) v=v.slice(0,5)+'-'+v.slice(5)
                  setTempoCep(v)
                }}/>
              <button style={{background:'#0e9f6e',color:'#fff',border:'none',borderRadius:16,padding:'0 20px',fontSize:14,fontWeight:600,cursor:'pointer',opacity:tempoLoading?.7:1}} disabled={tempoLoading} onClick={buscarPorCep}>Buscar</button>
            </div>
            {tempoErro&&<div style={{marginTop:12,background:'#fdeaea',color:'#e5484d',borderRadius:12,padding:'10px 14px',fontSize:13}}>{tempoErro}</div>}
            {fazendasDB.some(fz=>fz.lat&&fz.lng) && (
              <>
                <div style={{textAlign:'center',fontSize:11,color:'#7ba38f',margin:'14px 0'}}>ou escolha uma fazenda cadastrada</div>
                <select style={{...sw.fi,width:'100%'}} defaultValue="" disabled={tempoLoading}
                  onChange={e=>{
                    const fz = fazendasDB.find(f=>f.id===e.target.value)
                    if(fz) buscarPrevisao(fz.lat,fz.lng,`${fz.nome} (${fz.cliente})`)
                  }}>
                  <option value="" disabled>Selecione a fazenda...</option>
                  {fazendasDB.filter(fz=>fz.lat&&fz.lng).map(fz=>(
                    <option key={fz.id} value={fz.id}>{fz.nome} — {fz.cliente}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        {tempoDias && (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:13,color:'#5c7568'}}>📍 {tempoLocal}</div>
              <button style={{...s.nowBtn,padding:'6px 12px',fontSize:11}} onClick={()=>{setTempoDias(null);setTempoErro('')}}>Trocar local</button>
            </div>

            {/* Gráfico de tendência dos 5 dias */}
            <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:'16px 8px 8px',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
              <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:6,paddingLeft:8}}>TEMPERATURA MÁX. E CHANCE DE CHUVA</div>
              <ResponsiveContainer width="100%" height={160}>
                <ComposedChart data={tempoDias.map((d,i)=>({
                  dia: i===0?'Hoje':new Date(d.data+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'short'}),
                  temp: Math.round(d.tempMax), chuva: Math.round(d.chuvaProb),
                }))} margin={{top:5,right:10,left:-20,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                  <XAxis dataKey="dia" tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false}/>
                  <YAxis tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false} axisLine={false}/>
                  <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}}/>
                  <Bar dataKey="chuva" fill="#2f6fed" radius={[6,6,0,0]} opacity={0.35} name="Chuva %"/>
                  <Line type="monotone" dataKey="temp" stroke="#f2960f" strokeWidth={2.5} dot={{r:3}} name="Temp °C"/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {tempoDias.map((d,i)=>{
              const dataObj = new Date(d.data+'T12:00:00')
              const diaLabel = i===0?'Hoje':dataObj.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'})
              const chuvaAlerta = d.chuvaProb>=50
              return (
                <div key={d.data} style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                  <div style={{fontSize:14,fontWeight:700,fontFamily:"'Syne',sans-serif",textTransform:'capitalize',marginBottom:10}}>{diaLabel}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                    <div style={{background:graficoHora?.data===d.data&&graficoHora?.tipo==='temp'?'#fdf0dc':'#f1f8f4',borderRadius:14,padding:'10px 12px',cursor:'pointer'}}
                      onClick={()=>setGraficoHora(g=>g?.data===d.data&&g?.tipo==='temp'?null:{data:d.data,tipo:'temp'})}>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>🌡️ TEMPERATURA <span style={{opacity:.6}}>· ver por hora</span></div>
                      <div style={{fontSize:16,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{Math.round(d.tempMin)}° / {Math.round(d.tempMax)}°</div>
                    </div>
                    <div style={{background:graficoHora?.data===d.data&&graficoHora?.tipo==='umidade'?'#e3f7ec':'#f1f8f4',borderRadius:14,padding:'10px 12px',cursor:'pointer'}}
                      onClick={()=>setGraficoHora(g=>g?.data===d.data&&g?.tipo==='umidade'?null:{data:d.data,tipo:'umidade'})}>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>💧 UMIDADE (13H) <span style={{opacity:.6}}>· ver por hora</span></div>
                      <div style={{fontSize:16,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{d.umidade!=null?`${Math.round(d.umidade)}%`:'—'}</div>
                    </div>
                    <div style={{background:graficoHora?.data===d.data&&graficoHora?.tipo==='vento'?'#e6f1fb':'#f1f8f4',borderRadius:14,padding:'10px 12px',cursor:'pointer'}}
                      onClick={()=>setGraficoHora(g=>g?.data===d.data&&g?.tipo==='vento'?null:{data:d.data,tipo:'vento'})}>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>💨 VENTO MÁX. <span style={{opacity:.6}}>· ver por hora</span></div>
                      <div style={{fontSize:16,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{Math.round(d.ventoMax)} km/h</div>
                    </div>
                    <div style={{background:graficoHora?.data===d.data&&graficoHora?.tipo==='chuva'?'#e6f1fb':(chuvaAlerta?'#e6f1fb':'#f1f8f4'),borderRadius:14,padding:'10px 12px',cursor:'pointer'}}
                      onClick={()=>setGraficoHora(g=>g?.data===d.data&&g?.tipo==='chuva'?null:{data:d.data,tipo:'chuva'})}>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>☔ CHUVA <span style={{opacity:.6}}>· ver por hora</span></div>
                      <div style={{fontSize:16,fontWeight:700,color:chuvaAlerta?'#2f6fed':'#0b1210',fontFamily:"'Syne',sans-serif"}}>{Math.round(d.chuvaProb)}%</div>
                    </div>
                  </div>

                  {graficoHora?.data===d.data && tempoHorario && (()=>{
                    const idxs = tempoHorario.time.map((t,i)=>i).filter(i=>tempoHorario.time[i].startsWith(d.data))
                    const pontos = idxs.map(i=>({
                      hora: tempoHorario.time[i].slice(11,16),
                      temp: tempoHorario.temperature_2m?.[i]!=null?Math.round(tempoHorario.temperature_2m[i]):null,
                      vento: tempoHorario.windspeed_10m?.[i]!=null?Math.round(tempoHorario.windspeed_10m[i]):null,
                      rajada: tempoHorario.windgusts_10m?.[i]!=null?Math.round(tempoHorario.windgusts_10m[i]):null,
                      umidade: tempoHorario.relativehumidity_2m?.[i]!=null?Math.round(tempoHorario.relativehumidity_2m[i]):null,
                      chuva: tempoHorario.precipitation_probability?.[i]!=null?Math.round(tempoHorario.precipitation_probability[i]):null,
                    }))
                    const titulos = {temp:'🌡️ TEMPERATURA POR HORA',vento:'💨 VENTO E RAJADAS POR HORA',umidade:'💧 UMIDADE POR HORA',chuva:'☔ CHANCE DE CHUVA POR HORA'}
                    return (
                      <div style={{background:'#f9fbfa',borderRadius:14,padding:'12px 6px 6px',marginBottom:8,border:'1px solid #eef5f0'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:4,paddingLeft:10}}>{titulos[graficoHora.tipo]}</div>
                        <ResponsiveContainer width="100%" height={140}>
                          <ComposedChart data={pontos} margin={{top:5,right:10,left:-20,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                            <XAxis dataKey="hora" tick={{fontSize:9,fill:'#7ba38f'}} tickLine={false} interval={2}/>
                            <YAxis tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false} axisLine={false}/>
                            <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}}/>
                            {graficoHora.tipo==='temp' && <Line type="monotone" dataKey="temp" stroke="#f2960f" strokeWidth={2.5} dot={{r:2}} name="Temp °C"/>}
                            {graficoHora.tipo==='vento' && (
                              <>
                                <Line type="monotone" dataKey="vento" stroke="#2f6fed" strokeWidth={2.5} dot={{r:2}} name="Vento km/h"/>
                                <Line type="monotone" dataKey="rajada" stroke="#e5484d" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Rajada km/h"/>
                              </>
                            )}
                            {graficoHora.tipo==='umidade' && <Line type="monotone" dataKey="umidade" stroke="#0e9f6e" strokeWidth={2.5} dot={{r:2}} name="Umidade %"/>}
                            {graficoHora.tipo==='chuva' && <Bar dataKey="chuva" fill="#2f6fed" radius={[4,4,0,0]} name="Chuva %"/>}
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    )
                  })()}
                  <div style={{background:d.deltaTClass?d.deltaTClass.bg:'#f1f8f4',borderRadius:14,padding:'10px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>⚖️ DELTA T (13H)</div>
                      {d.deltaTClass&&<div style={{fontSize:11,color:d.deltaTClass.cor,marginTop:2,fontWeight:600}}>{d.deltaTClass.icon} {d.deltaTClass.label}</div>}
                    </div>
                    <div style={{fontSize:20,fontWeight:700,color:d.deltaTClass?d.deltaTClass.cor:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{d.deltaT!=null?d.deltaT.toFixed(1):'—'}</div>
                  </div>
                </div>
              )
            })}
            <div style={{fontSize:10,color:'#aaa',textAlign:'center'}}>Fonte: Open-Meteo · Umidade e Delta T estimados às 13h, referência para o horário mais comum de aplicação</div>
          </>
        )}
      </div>
      <BottomNav/>
      {toast&&<div style={s.toast}>{toast}</div>}
      <ExitConfirmModal/>
    </div>
  )

  // Previsão do tempo do voo agendado — busca sempre que o card é exibido, usando a
  // fazenda vinculada (precisa ter lat/lng cadastrados pelo admin em Fazendas & Clientes).
  const AgendaClimaBadge = ({fz, data}) => {
    const [clima,setClima] = useState(null)
    const [loading,setLoading] = useState(false)
    useEffect(()=>{
      if(!fz?.lat||!fz?.lng||!data){ setClima(null); return }
      let cancelled = false
      setLoading(true)
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${fz.lat}&longitude=${fz.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max&hourly=temperature_2m,relativehumidity_2m&timezone=auto&forecast_days=16`)
        .then(r=>r.json())
        .then(d=>{
          if(cancelled) return
          const idx=(d.daily?.time||[]).indexOf(data)
          if(idx<0){ setClima(null); return }
          // Temperatura/umidade por volta das 13h (janela típica de aplicação) pra estimar o Delta T do dia
          const idxHora = (d.hourly?.time||[]).findIndex(t=>t.startsWith(data)&&t.endsWith('T13:00'))
          const tempMeioDia = idxHora>=0 ? d.hourly.temperature_2m[idxHora] : d.daily.temperature_2m_max[idx]
          const umidMeioDia = idxHora>=0 ? d.hourly.relativehumidity_2m[idxHora] : null
          const deltaT = umidMeioDia!=null ? calcDeltaT(tempMeioDia,umidMeioDia) : null
          setClima({
            tempMax:d.daily.temperature_2m_max[idx],tempMin:d.daily.temperature_2m_min[idx],
            chuvaProb:d.daily.precipitation_probability_max[idx],ventoMax:d.daily.windspeed_10m_max[idx],
            deltaT, deltaTClass: deltaT!=null?classificarClimaParam('delta_t',deltaT.toFixed(1)):null,
          })
        })
        .catch(()=>{ if(!cancelled) setClima(null) })
        .finally(()=>{ if(!cancelled) setLoading(false) })
      return ()=>{ cancelled=true }
    },[fz?.lat,fz?.lng,data])
    if(!fz?.lat||!fz?.lng) return null
    if(loading) return <div style={{fontSize:11,color:'#7ba38f',marginTop:8}}>🌦️ Buscando previsão...</div>
    if(!clima) return null
    return (
      <div style={{background:'#f1f8f4',borderRadius:10,padding:'8px 10px',marginTop:8,display:'flex',flexDirection:'column',gap:6,fontSize:11,color:'#0b1210'}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
          <span>🌡️ {clima.tempMin?.toFixed(0)}°-{clima.tempMax?.toFixed(0)}°C</span>
          <span>💧 {clima.chuvaProb}% chuva</span>
          <span>💨 {clima.ventoMax?.toFixed(0)} km/h</span>
        </div>
        {clima.deltaTClass && (
          <div style={{display:'inline-flex',alignItems:'center',gap:5,alignSelf:'flex-start',background:clima.deltaTClass.bg,color:clima.deltaTClass.cor,fontWeight:700,padding:'3px 9px',borderRadius:20}}>
            {clima.deltaTClass.icon} Delta T {clima.deltaT.toFixed(1)}°C — {clima.deltaTClass.label}
          </div>
        )}
      </div>
    )
  }

  // Distância em linha reta (Haversine) — não é distância de estrada real, é só uma
  // referência rápida de "quão longe" a fazenda está da posição atual do piloto.
  function distanciaKm(lat1,lng1,lat2,lng2){
    const R = 6371
    const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
    return R * 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))
  }
  const DistanciaBadge = ({fz}) => {
    // Se o GPS do login não pegou (permissão negada na hora, sem sinal etc.), tenta de novo
    // aqui — é um resumo de viagem, então vale a pena insistir em vez de só sumir a linha.
    useEffect(()=>{
      if(gpsPos || !navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        pos=>setGpsPos({lat:pos.coords.latitude,lng:pos.coords.longitude}),
        ()=>{}, {enableHighAccuracy:true,timeout:10000}
      )
    },[])
    if(!fz?.lat || !fz?.lng) return null
    if(!gpsPos) return <span style={{fontSize:11,color:'#aaa',fontStyle:'italic'}}>📏 Ative o GPS pra ver a distância</span>
    const km = distanciaKm(gpsPos.lat,gpsPos.lng,fz.lat,fz.lng)
    return <span style={{fontSize:11,color:'#7ba38f'}}>📏 ≈{km.toFixed(0)} km em linha reta da sua posição</span>
  }

  if(view==='agenda') return (
    <div style={{...s.wrap,paddingBottom:90}}>
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c476" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span style={s.logoTxt}>Orofly<span style={s.dot}>.</span></span></div>
          <div style={{display:'flex',gap:6}}>
            {onSwitchMode&&<button style={s.switchBtn} onClick={onSwitchMode}>⚙️ Admin</button>}
            <button style={s.logoutBtn} onClick={tentarSair}>Sair</button>
          </div>
        </div>
        <div style={s.headerSub}>📅 Minha Agenda</div>
      </div>

      <div style={{padding:16,display:'flex',flexDirection:'column',gap:10}}>
        <button style={{...s.nowBtn,padding:'10px 16px',fontSize:13,alignSelf:'flex-start'}} onClick={()=>setView('home')}>← Voltar</button>

        {loadingAgenda?<div style={{textAlign:'center',color:'#5c7568',padding:40}}>Carregando...</div>
        :minhaAgenda.length===0?<div style={{textAlign:'center',color:'#5c7568',padding:40,background:'#fff',borderRadius:20,border:'1px solid #dcebe3'}}>Nenhum voo programado pelo admin ainda</div>
        :minhaAgenda.map(a=>{
          const hoje = new Date(); hoje.setHours(0,0,0,0)
          const atrasado = a.status==='pendente' && new Date(a.data_prevista)<hoje
          const STATUS_BADGE = {pendente:{label:'Pendente',bg:'#fff3e0',cor:'#f2960f'},concluido:{label:'Concluído',bg:'#e3f7ec',cor:'#0e9f6e'},cancelado:{label:'Cancelado',bg:'#fdeaea',cor:'#e5484d'},recusado:{label:'Recusado',bg:'#fdeaea',cor:'#e5484d'}}
          const badge = STATUS_BADGE[a.status]||STATUS_BADGE.pendente
          return (
            <div key={a.id} style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                <span style={{background:badge.bg,color:badge.cor,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>{badge.label}</span>
                {atrasado&&<span style={{background:'#fdeaea',color:'#e5484d',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ Atrasado</span>}
                {a.ordem_servico&&<span style={{background:'#eef5f0',color:'#5c7568',fontFamily:'ui-monospace,monospace',fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20}}>OS {a.ordem_servico}</span>}
              </div>
              <div style={{fontWeight:700,fontSize:15,fontFamily:"'Syne',sans-serif"}}>{a.cliente} — {a.fazenda}{a.talhao?<span style={{fontWeight:400,fontSize:12,color:'#7ba38f'}}> ({a.talhao})</span>:''}</div>
              <div style={{fontSize:12,color:'#7ba38f',marginTop:2}}>{new Date(a.data_prevista+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit'})}{a.produto?` · ${a.produto}`:''}</div>
              {a.observacao&&<div style={{fontSize:12,color:'#5c7568',marginTop:6,fontStyle:'italic'}}>{a.observacao}</div>}
              <AgendaClimaBadge fz={fazendasDB.find(fz=>fz.cliente===a.cliente&&fz.nome===a.fazenda)} data={a.data_prevista}/>
              <div style={{marginTop:4}}><DistanciaBadge fz={fazendasDB.find(fz=>fz.cliente===a.cliente&&fz.nome===a.fazenda)}/></div>
              {a.status==='recusado'&&a.motivo_recusa&&(
                <div style={{background:'#fdeaea',color:'#a3221e',borderRadius:10,padding:'8px 10px',marginTop:8,fontSize:12}}>Motivo: {a.motivo_recusa}</div>
              )}
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button style={{...sw.btnG,background:'#f1f8f4',color:'#5c7568',flex:'0 0 110px',padding:'12px 8px'}} onClick={()=>setAgendaDetalhe(a)}>📋 Detalhes</button>
                {a.status==='pendente'&&(
                  <>
                    <button style={{...sw.btnG,background:'#fdeaea',color:'#e5484d',flex:'0 0 46px',padding:'12px 4px'}} onClick={()=>{setRecusaModal(a);setRecusaMotivo('')}}>❌</button>
                    <button style={{...sw.btnG,flex:1,padding:'12px'}} onClick={()=>iniciarVooAgendado(a)}>🚁 Iniciar este voo</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <BottomNav/>
      {toast&&<div style={s.toast}>{toast}</div>}
      <ExitConfirmModal/>
      {agendaDetalhe && (()=>{
        const fz = fazendasDB.find(fz=>fz.cliente===agendaDetalhe.cliente&&fz.nome===agendaDetalhe.fazenda)
        return (
          <div style={s.modalOverlay} onClick={()=>setAgendaDetalhe(null)}>
            <div style={{...s.modal,paddingBottom:24,textAlign:'left'}} onClick={e=>e.stopPropagation()}>
              <div style={s.modalTitle}>📋 {agendaDetalhe.cliente} — {agendaDetalhe.fazenda}</div>
              <div style={{fontSize:13,color:'#5c7568',marginBottom:14}}>
                {new Date(agendaDetalhe.data_prevista+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit'})}
                {agendaDetalhe.talhao&&` · Talhão ${agendaDetalhe.talhao}`}
                {agendaDetalhe.ordem_servico&&` · OS ${agendaDetalhe.ordem_servico}`}
              </div>
              {agendaDetalhe.produto && (
                <div style={{background:'#f1f8f4',borderRadius:10,padding:'10px 12px',marginBottom:10,fontSize:13}}>
                  <strong>🧪 {agendaDetalhe.produto}</strong>{agendaDetalhe.dose&&<span style={{color:'#5c7568'}}> · Dose: {agendaDetalhe.dose}</span>}
                </div>
              )}
              {agendaDetalhe.observacao && (
                <div style={{fontSize:13,color:'#5c7568',marginBottom:10,fontStyle:'italic'}}>{agendaDetalhe.observacao}</div>
              )}
              <div style={{marginBottom:10}}>
                <AgendaClimaBadge fz={fz} data={agendaDetalhe.data_prevista}/>
              </div>
              {fz?.lat && fz?.lng ? (
                <div style={{background:'#eef5f0',borderRadius:10,padding:'10px 12px',marginBottom:14,fontSize:12,color:'#5c7568'}}>
                  📍 {fz.lat}, {fz.lng}{fz.cep?` · CEP ${fz.cep}`:''}
                  <div style={{marginTop:4}}><DistanciaBadge fz={fz}/></div>
                  <a href={`https://maps.google.com/?q=${fz.lat},${fz.lng}`} target="_blank" rel="noreferrer" style={{display:'block',marginTop:6,color:'#0e9f6e',fontWeight:600,textDecoration:'none'}}>🗺️ Abrir rota no Maps</a>
                </div>
              ) : (
                <div style={{fontSize:11,color:'#aaa',marginBottom:14,fontStyle:'italic'}}>Essa fazenda ainda não tem localização cadastrada.</div>
              )}
              <div style={{display:'flex',gap:8}}>
                {agendaDetalhe.status==='pendente'&&(
                  <button style={{...s.shareBtn,background:'#fdeaea',color:'#e5484d',flex:1}} onClick={()=>{setRecusaModal(agendaDetalhe);setRecusaMotivo('')}}>❌ Recusar</button>
                )}
                <button style={{...s.shareBtn,background:'#f1f8f4',color:'#5c7568',flex:1}} onClick={()=>setAgendaDetalhe(null)}>Fechar</button>
              </div>
            </div>
          </div>
        )
      })()}
      {recusaModal && (
        <div style={s.modalOverlay} onClick={()=>setRecusaModal(null)}>
          <div style={{...s.modal,paddingBottom:24}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>❌ Recusar agendamento</div>
            <p style={{fontSize:13,color:'#5c7568',marginBottom:12,lineHeight:1.5}}>{recusaModal.cliente} — {recusaModal.fazenda}. O admin vai ver o motivo que você digitar aqui.</p>
            <textarea style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:10,padding:'10px 12px',fontSize:13,outline:'none',boxSizing:'border-box',minHeight:80,fontFamily:"'DM Sans',sans-serif",resize:'vertical'}}
              placeholder="Ex: sem condição climática, drone em manutenção, muito longe..." value={recusaMotivo} onChange={e=>setRecusaMotivo(e.target.value)}/>
            <div style={{display:'flex',gap:10,marginTop:14}}>
              <button style={{...s.shareBtn,background:'#f1f8f4',color:'#5c7568',flex:1}} onClick={()=>setRecusaModal(null)}>Cancelar</button>
              <button style={{...s.shareBtn,background:'#e5484d',flex:1,opacity:recusaSaving?.6:1}} disabled={recusaSaving} onClick={confirmarRecusa}>{recusaSaving?'Enviando...':'Confirmar recusa'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div style={sw.wrap}>
      <WHeader/>

      {/* ══ STEP 1 — IDENTIFICAÇÃO ══ */}
      {wizardStep===1&&(
        <>
          <div style={sw.body}>
            <div style={sw.pageTitle}>Identificação</div>
            <div style={sw.pageSub}>Passo 1 de 5: Dados do voo</div>

            {/* Piloto — só exibe */}
            <div style={{...sw.fw,background:'#f1f8f4',borderRadius:10,padding:'10px 14px',marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,fontFamily:"'Syne',sans-serif",marginBottom:3}}>PILOTO</div>
              <div style={{fontSize:14,fontWeight:600,color:'#0e9f6e'}}>{profile?.nome}</div>
            </div>

            <FS label="CULTURA" val={form.cultura} onChange={e=>{setForm(f=>({...f,cultura:e.target.value}));autoGPS()}}>
              <option value="">Selecione a Cultura...</option>
              {CULTURAS.map(c=><option key={c}>{c}</option>)}
            </FS>

            <FS label="CLIENTE" val={form.cliente} onChange={e=>{
              setForm(f=>({...f,cliente:e.target.value,fazenda:'',produto:'',talhao:'',localizacao:'',area_ha:''}));setTalhaoSearch('');autoGPS()
            }}>
              <option value="">Selecione o Cliente...</option>
              {CLIENTES.map(c=><option key={c}>{c}</option>)}
            </FS>
            {form.cliente==='Outros'&&<FI label="NOME DO CLIENTE" ph="Digite o nome..." val={form.clienteOutro} onChange={e=>setForm(f=>({...f,clienteOutro:e.target.value}))}/>}

            {/* FAZENDA — dropdown filtrado pelo cliente, com Outros */}
            {(()=>{
              const norm = s => (s||'').trim().toLowerCase().replace(/\s+/g,' ')
              // Progresso de um talhão específico (todos os pilotos) desde o último "zerar" da
              // fazenda no Admin — quando um voo abrange vários talhões, divide a área proporcional
              // ao tamanho cadastrado de cada um (não dá pra saber a área exata por talhão nesse caso).
              const progressoTalhao = (fz, t, talhoesDaFazenda) => {
                const areaTotal = parseFloat(t.area_ha)||0
                if(areaTotal<=0) return null
                let areaRealizada = 0
                let bordaduraRealizada = 0
                relatoriosFinalizadosOrg.forEach(r=>{
                  if(r.cliente!==fz.cliente || r.fazenda!==fz.nome) return
                  if(fz.campanha_inicio && new Date(r.created_at) < new Date(fz.campanha_inicio)) return
                  const nomesVoo = (r.localizacao||'').split(',').map(s=>s.trim()).filter(Boolean)
                  if(!nomesVoo.includes(t.nome)) return
                  const somaRegistrada = nomesVoo.reduce((a,n)=>{
                    const tt = talhoesDaFazenda.find(x=>x.nome===n)
                    return a + (tt?parseFloat(tt.area_ha)||0:0)
                  },0)
                  const fracao = somaRegistrada>0 ? areaTotal/somaRegistrada : 1/nomesVoo.length
                  areaRealizada += areaLiquida(r) * fracao
                  bordaduraRealizada += (parseFloat(r.bordadura)||0) * fracao
                })
                // Bordadura conta como "feito" pro fim de fechamento — ela é área deliberadamente
                // não pulverizada (faixa de segurança), não trabalho pendente.
                const feito = areaRealizada + bordaduraRealizada
                return { areaTotal, areaRealizada, bordaduraRealizada, pct: Math.min(100,(feito/areaTotal)*100) }
              }
              // Fazenda some da lista só quando TODOS os talhões dela estiverem concluídos
              const fazendaCompleta = (fz) => {
                const talhoesDaFazenda = talhoesDB.filter(t=>t.fazenda_id===fz.id)
                if(talhoesDaFazenda.length===0) return false
                return talhoesDaFazenda.every(t=>(progressoTalhao(fz,t,talhoesDaFazenda)?.pct??0) >= 100)
              }
              const fazendasCliente = fazendasDB.filter(fz=>fz.cliente===form.cliente && (norm(fz.nome)===norm(form.fazenda) || !fazendaCompleta(fz)))
              const temCadastro = fazendasCliente.length>0
              // Comparação tolerante a maiúsculas/espaços — cadastro pode ter "Fazenda X " vs "FAZENDA X"
              const fazendaSel = fazendasCliente.find(fz=>norm(fz.nome)===norm(form.fazenda))
              const selectVal = fazendaSel ? fazendaSel.nome : (form.fazenda ? 'Outros' : '')
              return (
                <>
                  {temCadastro ? (
                    <>
                      <FS label="FAZENDA" val={selectVal} onChange={e=>{
                        const v=e.target.value==='Outros'?'':e.target.value
                        const fzEscolhida = fazendasCliente.find(fz=>norm(fz.nome)===norm(v))
                        setForm(f=>({...f,fazenda:v,produto:fzEscolhida?.produto||'',talhao:'',localizacao:'',area_ha:''}));setTalhaoSearch('');autoGPS()
                      }}>
                        <option value="">Selecione a Fazenda...</option>
                        {fazendasCliente.map(fz=><option key={fz.id}>{fz.nome}</option>)}
                        <option>Outros</option>
                      </FS>
                      {(selectVal==='Outros')&&<FI label="NOME DA FAZENDA" ph="Digite o nome..." val={form.fazenda} onChange={e=>{setForm(f=>({...f,fazenda:e.target.value}));autoGPS()}}/>}
                    </>
                  ) : (
                    <FI label="FAZENDA" ph="Nome da Fazenda" val={form.fazenda} onChange={e=>{setForm(f=>({...f,fazenda:e.target.value}));autoGPS()}}/>
                  )}

                  {/* TALHÕES — lista multi-seleção; soma as áreas dos selecionados */}
                  {(()=>{
                    const talhoesFaz = fazendaSel ? talhoesDB.filter(t=>t.fazenda_id===fazendaSel.id) : []
                    const temTalhoes = talhoesFaz.length>0
                    const selecionados = (form.talhao||'').split(',').map(s=>s.trim()).filter(Boolean)
                    const aplicarSelecao = (novos) => {
                      const soma = talhoesFaz.filter(x=>novos.includes(x.nome)).reduce((a,x)=>a+parseFloat(x.area_ha||0),0)
                      const joined = novos.join(', ')
                      setForm(f=>({...f,talhao:joined,localizacao:joined,area_ha:soma>0?String(parseFloat(soma.toFixed(2))):f.area_ha}))
                      autoGPS()
                    }
                    const toggleTalhao = (t) => {
                      const isSel = selecionados.includes(t.nome)
                      aplicarSelecao(isSel ? selecionados.filter(n=>n!==t.nome) : [...selecionados, t.nome])
                    }
                    const todosSelecionados = temTalhoes && talhoesFaz.every(t=>selecionados.includes(t.nome))
                    const toggleTodos = () => aplicarSelecao(todosSelecionados ? [] : talhoesFaz.map(t=>t.nome))
                    const talhoesVisiveis = talhoesFaz
                      .filter(t=>!talhaoSearch.trim() || t.nome.toLowerCase().includes(talhaoSearch.trim().toLowerCase()))
                    if (temTalhoes) return (
                      <div style={{...sw.fw,position:'relative'}}>
                        <label style={sw.fl}>TALHÕES <span style={{fontWeight:400,color:'#aaa'}}>(selecione um ou mais)</span></label>

                        {/* Campo fechado — estilo igual ao select de Fazenda/Cliente */}
                        <div onClick={()=>setTalhaoDropdownOpen(o=>!o)}
                          style={{width:'100%',border:'1px solid #e0ece5',borderRadius:10,padding:'12px 14px',fontSize:14,color:selecionados.length?'#0b1210':'#aaa',background:'#fff',boxSizing:'border-box',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:"'DM Sans',sans-serif"}}>
                          <span>{selecionados.length ? `${selecionados.length} talhão(ões) selecionado(s)` : 'Selecione os talhões...'}</span>
                          <span style={{color:'#aaa',fontSize:11}}>{talhaoDropdownOpen?'▲':'▼'}</span>
                        </div>

                        {talhaoDropdownOpen && (
                          <>
                            {/* backdrop transparente — fecha ao clicar fora */}
                            <div onClick={()=>setTalhaoDropdownOpen(false)} style={{position:'fixed',inset:0,zIndex:90}}/>
                            {/* painel flutuante */}
                            <div style={{position:'absolute',top:'100%',left:0,right:0,marginTop:4,background:'#fff',border:'1px solid #e0ece5',borderRadius:10,boxShadow:'0 10px 30px rgba(0,0,0,.18)',zIndex:91,padding:10}}>
                              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
                                <button type="button" onClick={toggleTodos} style={{background:'none',border:'none',color:'#0e9f6e',fontSize:12,fontWeight:600,cursor:'pointer',padding:'2px 0'}}>
                                  {todosSelecionados?'Limpar seleção':'Selecionar todos'}
                                </button>
                              </div>
                              {talhoesFaz.length>6&&(
                                <input style={{...sw.fi,marginBottom:8}} placeholder={`🔍 Buscar entre ${talhoesFaz.length} talhões...`}
                                  value={talhaoSearch} onChange={e=>setTalhaoSearch(e.target.value)}/>
                              )}
                              <div style={{border:'1px solid #f0f5f2',borderRadius:10,overflow:'hidden',maxHeight:240,overflowY:'auto'}}>
                                {talhoesVisiveis.length===0 ? (
                                  <div style={{padding:'14px',fontSize:13,color:'#aaa',textAlign:'center'}}>Nenhum talhão encontrado</div>
                                ) : talhoesVisiveis.map(t=>{
                                  const sel = selecionados.includes(t.nome)
                                  const prog = fazendaSel ? progressoTalhao(fazendaSel, t, talhoesFaz) : null
                                  const finalizado = prog && prog.pct>=100
                                  const parcial = prog && prog.pct>0 && prog.pct<100
                                  const falta = prog ? Math.max(0, prog.areaTotal-prog.areaRealizada-prog.bordaduraRealizada) : 0
                                  const bg = sel ? '#e3f7ec' : finalizado ? '#eafaf0' : parcial ? '#fff8e6' : '#fff'
                                  return (
                                    <div key={t.id} onClick={()=>toggleTalhao(t)}
                                      style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer',background:bg,borderBottom:'1px solid #f0f5f2',borderLeft:finalizado?'3px solid #0e9f6e':parcial?'3px solid #f2960f':'3px solid transparent'}}>
                                      <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${sel?'#0e9f6e':'#c3d4c9'}`,background:sel?'#0e9f6e':'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                                        {sel&&<span style={{color:'#fff',fontSize:11,fontWeight:700}}>✓</span>}
                                      </div>
                                      <span style={{fontSize:14,color:'#0b1210',flex:1}}>
                                        {t.nome}
                                        {finalizado&&<span style={{marginLeft:6,fontSize:10,fontWeight:700,color:'#fff',background:'#0e9f6e',padding:'2px 7px',borderRadius:20}}>✓ Concluído</span>}
                                        {parcial&&<span style={{marginLeft:6,fontSize:10,fontWeight:700,color:'#a3690a',background:'#ffe9b8',padding:'2px 7px',borderRadius:20}}>faltam {falta.toFixed(1)} ha</span>}
                                      </span>
                                      {t.area_ha&&<span style={{fontSize:12,color:'#0e9f6e',fontWeight:600}}>{t.area_ha} ha</span>}
                                    </div>
                                  )
                                })}
                              </div>
                              <input style={{...sw.fi,marginTop:8}} placeholder="Outro talhão? Digite aqui e Enter..." value=""
                                onKeyDown={e=>{
                                  if(e.key==='Enter'&&e.target.value.trim()){
                                    const novos=[...selecionados,e.target.value.trim()]
                                    const joined=novos.join(', ')
                                    setForm(f=>({...f,talhao:joined,localizacao:joined}))
                                    e.target.value=''
                                  }
                                }}
                                onChange={()=>{}}/>
                              <button type="button" onClick={()=>setTalhaoDropdownOpen(false)}
                                style={{width:'100%',marginTop:8,background:'#0e9f6e',color:'#fff',border:'none',borderRadius:8,padding:'9px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                Concluído
                              </button>
                            </div>
                          </>
                        )}

                        {selecionados.length>0&&(
                          <div style={{marginTop:6,fontSize:12,color:'#0e9f6e',fontWeight:600}}>
                            ✅ {selecionados.length} talhão(ões) · Área total: {form.area_ha||'—'} ha
                          </div>
                        )}
                      </div>
                    )
                    return <FI label="TALHÃO" ph="Ex: Talhão 5, Zona 65..." val={form.talhao} onChange={e=>{setForm(f=>({...f,talhao:e.target.value,localizacao:e.target.value}));autoGPS()}}/>
                  })()}
                </>
              )
            })()}
            <FI label="ÁREA (HA)" ph="Ex: 50.5" val={form.area_ha} onChange={e=>{setForm(f=>({...f,area_ha:e.target.value}));autoGPS()}} type="number"/>

            <div style={sw.fw}>
              <label style={sw.fl}>TIPO DE SERVIÇO</label>
              <div style={{display:'flex',gap:8}}>
                {[['area_total','Área Total'],['catacao','Catação']].map(([v,lbl])=>(
                  <button key={v} type="button" style={{flex:1,background:form.tipo_servico===v?'#0e9f6e':'#f1f8f4',color:form.tipo_servico===v?'#fff':'#0b1210',border:'none',borderRadius:10,padding:'12px 8px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                    onClick={()=>setForm(f=>({...f,tipo_servico:v}))}>{lbl}</button>
                ))}
              </div>
            </div>

            <label style={{display:'flex',alignItems:'center',gap:8,background:form.teste?'#fff3e0':'#f9fbfa',border:`1px solid ${form.teste?'#f2960f':'#eef5f0'}`,borderRadius:10,padding:'10px 14px',cursor:'pointer'}}>
              <input type="checkbox" checked={!!form.teste} onChange={e=>setForm(f=>({...f,teste:e.target.checked}))} style={{width:16,height:16,accentColor:'#f2960f'}}/>
              <span style={{fontSize:12,color:form.teste?'#a3690a':'#5c7568',fontWeight:600}}>🧪 Voo teste?</span>
            </label>

            <FS label="DRONE" val={form.drone} onChange={e=>{setForm(f=>({...f,drone:e.target.value}));autoGPS()}}>
              <option value="">Selecione o Drone...</option>
              {DRONES.map(d=><option key={d}>{d}</option>)}
            </FS>
            {form.drone==='Outros'&&<FI label="NOME DO DRONE" ph="..." val={form.droneOutro} onChange={e=>setForm(f=>({...f,droneOutro:e.target.value}))}/>}

            {/* GPS — exibe silenciosamente */}
            {form.gps_lat&&(
              <div style={{...sw.fw,background:'#e3f7ec',borderRadius:10,padding:'8px 14px',display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:14}}>📍</span>
                <span style={{fontSize:12,color:'#0e9f6e',fontWeight:500}}>{form.gps_lat}, {form.gps_lng}</span>
                <a href={`https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}`} target="_blank" rel="noreferrer" style={{marginLeft:'auto',fontSize:11,color:'#0e9f6e',textDecoration:'none'}}>🗺️ Maps</a>
              </div>
            )}

            {voosCompartilhados.length>0&&(
              <div style={{background:'#fffbea',border:'2px solid #ffb020',borderRadius:12,padding:14,marginTop:4}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:'#7a5c00',marginBottom:10}}>🤝 Voos Disponíveis ({voosCompartilhados.length})</div>
                {voosCompartilhados.map(v=>(
                  <div key={v.id} style={{background:'#fff',borderRadius:10,padding:'10px 12px',marginBottom:8,border:'1px solid #f0d070'}}>
                    <div style={{fontWeight:700,fontSize:13,color:'#0b1210'}}>{v.cliente} — {v.fazenda}</div>
                    <div style={{fontSize:11,color:'#5c7568',marginTop:2}}>Piloto: {v.piloto_nome}</div>
                    <button style={{marginTop:8,background:'#ffb020',color:'#3a2a00',border:'none',borderRadius:16,padding:'6px 14px',fontSize:12,fontWeight:700,cursor:'pointer',width:'100%'}}
                      onClick={()=>{ setTrechoModal(v); setTrechoForm(initTrechoForm()) }}>➕ Adicionar meu trecho</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={sw.btnBar}>
            <div style={{display:'flex',gap:8}}>
              <HomeExitBtn/>
              <button style={{...sw.btnG,background:'#fdeaea',color:'#e5484d',flex:'0 0 90px'}} onClick={()=>{
                setConfirmDialog({message:'Limpar TODO o formulário? Isso apaga todos os dados preenchidos.',onConfirm:()=>limpar()})
              }}>🗑️ Limpar</button>
              <button style={{...sw.btnG,flex:1}} onClick={()=>{ saveToSupabase({status:statusAtual()}); setWizardStep(2) }}>Próximo →</button>
            </div>
          </div>
        </>
      )}

      {/* ══ STEP 2 — APLICAÇÃO ══ */}
      {wizardStep===2&&(
        <>
          <div style={sw.body}>
            <div style={sw.pageTitle}>Aplicação</div>
            <div style={sw.pageSub}>Passo 2 de 5: Produto e parâmetros</div>

            {/* Produtos */}
            {form.produtos.map((p,i)=>{
              const parts=p?p.split(' - '):[''];const nome=parts[0]||'';const dosagem=parts.slice(1).join(' - ')||''
              const selectVal=PRODUTOS_LIST.includes(nome)?nome:(nome?'Outros':'')
              return (
                <div key={i} style={{marginBottom:14}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 120px auto',gap:8,alignItems:'end'}}>
                    <div>
                      <label style={sw.fl}>PRODUTO {form.produtos.length>1?i+1:''}</label>
                      <div style={{position:'relative'}}>
                        <select style={{...sw.fs,paddingRight:32}} value={selectVal}
                          onChange={e=>{
                            const arr=[...form.produtos]
                            const nomeSel=e.target.value
                            if(nomeSel==='Outros'){arr[i]=''}
                            else{
                              const pd=produtosDB.find(x=>x.nome===nomeSel)
                              const doseAuto=(pd?.dose_auto!==false&&pd?.dose_padrao!=null)?String(pd.dose_padrao):dosagem
                              arr[i]=nomeSel+(doseAuto?` - ${doseAuto}`:'')
                            }
                            setForm(f=>({...f,produtos:arr}))
                          }}>
                          <option value="">Selecione...</option>
                          {PRODUTOS_LIST.map(pr=><option key={pr}>{pr}</option>)}
                        </select>
                        <span style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:'#aaa',pointerEvents:'none',fontSize:11}}>▼</span>
                      </div>
                    </div>
                    <div>
                      <label style={sw.fl}>DOSAGEM ({unidadeDoProduto(nome)}/ha)</label>
                      <input style={{...sw.fi}} placeholder="Ex: 1.1" value={dosagem}
                        onChange={e=>{const arr=[...form.produtos];arr[i]=nome?`${nome} - ${e.target.value}`:e.target.value;setForm(f=>({...f,produtos:arr}))}}/>
                    </div>
                    {form.produtos.length>1&&<button style={{background:'none',border:'none',color:'#e5484d',fontSize:22,cursor:'pointer',padding:'8px 4px'}} onClick={()=>setForm(f=>({...f,produtos:f.produtos.filter((_,j)=>j!==i)}))}>×</button>}
                  </div>
                  {(selectVal==='Outros'||(!PRODUTOS_LIST.includes(nome)&&nome))&&(
                    <input style={{...sw.fi,marginTop:8}} placeholder="Nome do produto..." value={nome==='Outros'?'':nome}
                      onChange={e=>{const arr=[...form.produtos];arr[i]=dosagem?`${e.target.value} - ${dosagem}`:e.target.value;setForm(f=>({...f,produtos:arr}))}}/>
                  )}
                  {nome&&dosagem&&(
                    <div style={{marginTop:6,fontSize:12,color:'#0e9f6e',fontWeight:600,background:'#e3f7ec',borderRadius:8,padding:'6px 10px',display:'inline-block'}}>
                      🧪 {nome} — Dosagem: {dosagem} {unidadeDoProduto(nome)}/ha
                    </div>
                  )}
                </div>
              )
            })}
            <button style={{width:'100%',background:'#f1f8f4',border:'1px dashed #c3e0d0',color:'#0e9f6e',borderRadius:18,padding:'11px',fontSize:13,fontWeight:500,cursor:'pointer',marginBottom:14}} onClick={()=>setForm(f=>({...f,produtos:[...f.produtos,'']}))}>+ Adicionar produto</button>

            {/* Tamanho da gota — número + µm */}
            <div style={sw.fw}>
              <label style={sw.fl}>TAMANHO DA GOTA</label>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <input type="number" style={{...sw.fi,flex:1}} placeholder="Ex: 200" value={form.tamanho_gota} onChange={e=>setForm(f=>({...f,tamanho_gota:e.target.value}))}/>
                <span style={{fontSize:15,fontWeight:600,color:'#5c7568',flexShrink:0}}>µm</span>
              </div>
            </div>

            <FI label="VELOCIDADE DO DRONE (km/h)" ph="Ex: 25" val={form.velocidade_drone} onChange={e=>setForm(f=>({...f,velocidade_drone:e.target.value}))}/>
            <FI label="FAIXA DE APLICAÇÃO (m)" ph="Ex: 5" val={form.faixa_i} onChange={e=>setForm(f=>({...f,faixa_i:e.target.value,faixa_f:e.target.value}))}/>
            <FI label="VAZÃO (L/ha)" ph="Ex: 2" val={form.vazao_i} onChange={e=>setForm(f=>({...f,vazao_i:e.target.value,vazao_f:e.target.value}))}/>
          </div>
          <div style={sw.btnBar}>
            <div style={{display:'flex',gap:8}}>
              <HomeExitBtn/>
              <button style={{...sw.btnG,background:'#f1f8f4',color:'#5c7568',flex:'0 0 80px'}} onClick={()=>setWizardStep(1)}>← Voltar</button>
              <button style={{...sw.btnG,flex:1}} onClick={()=>{ saveToSupabase({status:statusAtual()}); setWizardStep(3) }}>Próximo →</button>
            </div>
          </div>
        </>
      )}

      {/* ══ STEP 3 — CONDIÇÕES (início e fim lado a lado) ══ */}
      {wizardStep===3&&(()=>{
        const geral = classificarCondicaoGeral(form, '_i')
        return (
          <>
            <div style={sw.body}>
              <div style={sw.pageTitle}>Condições Climáticas</div>
              <div style={sw.pageSub}>Passo 3 de 5: Início e fim da aplicação</div>

              {/* Banner geral (baseado no início) */}
              {geral && (
                <div style={{background:geral.cor,borderRadius:12,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontSize:24}}>{geral.status==='apta'?'✅':geral.status==='alerta'?'⚡':'🚫'}</span>
                  <span style={{fontSize:15,fontWeight:700,color:'#fff',fontFamily:"'Syne',sans-serif"}}>{geral.label}</span>
                </div>
              )}

              {/* Botão clima */}
              <button style={{width:'100%',background:'#e3f7ec',border:'1px solid #c3e0d0',color:'#0e9f6e',borderRadius:18,padding:'10px',fontSize:13,fontWeight:600,cursor:'pointer',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}
                onClick={fetchClima}>
                🌤️ Buscar clima atual (GPS)
              </button>

              {/* Cards com início e fim lado a lado */}
              {['vento','umidade','temperatura','delta_t'].map(key=>{
                const valI = form[key+'_i'], valF = form[key+'_f']
                const classifI = valI ? classificarClimaParam(key, valI) : null
                const classifF = valF ? classificarClimaParam(key, valF) : null
                const classifPrincipal = classifI || classifF
                return (
                  <div key={key} style={{background:classifPrincipal?classifPrincipal.bg:'#f7fbf8',borderRadius:14,padding:'14px 16px',marginBottom:10,border:`1.5px solid ${classifPrincipal?classifPrincipal.cor+'44':'#dcebe3'}`}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <span style={{fontSize:22}}>{PARAM_ICONS[key]}</span>
                        <div style={{fontSize:11,fontWeight:700,color:'#5c7568',letterSpacing:.5,fontFamily:"'Syne',sans-serif"}}>{PARAM_LABELS[key]} <span style={{fontWeight:400,color:'#7ba38f'}}>({PARAM_UNITS[key]})</span></div>
                      </div>
                      {classifPrincipal && (
                        <div style={{display:'flex',alignItems:'center',gap:5}}>
                          <span style={{fontSize:15}}>{classifPrincipal.icon}</span>
                          <span style={{fontSize:11,fontWeight:700,color:classifPrincipal.cor}}>{classifPrincipal.label}</span>
                        </div>
                      )}
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                      <div>
                        <label style={{...sw.fl,marginBottom:4}}>INÍCIO</label>
                        <input style={{...sw.fi,background:'rgba(255,255,255,0.85)'}} type="number"
                          placeholder={`Ex: ${key==='vento'?'8':key==='umidade'?'65':key==='temperatura'?'28':'4'}`}
                          value={form[key+'_i']||''} onChange={e=>setForm(f=>{
                            const next={...f,[key+'_i']:e.target.value}
                            // Fim vem com o mesmo valor do início por padrão (facilita preenchimento), mas só enquanto o fim ainda não foi definido
                            if(!f[key+'_f']) next[key+'_f']=e.target.value
                            // Delta T automático (editável): recalcula ao mudar temp/umidade
                            if(key==='temperatura'||key==='umidade'){
                              const dt=calcDeltaT(next.temperatura_i,next.umidade_i)
                              if(dt!==null) next.delta_t_i=dt.toFixed(1)
                              if(!f.delta_t_f){
                                const dtF=calcDeltaT(next.temperatura_f,next.umidade_f)
                                if(dtF!==null) next.delta_t_f=dtF.toFixed(1)
                              }
                            }
                            return next
                          })}/>
                        {classifI&&<div style={{fontSize:10,color:classifI.cor,fontWeight:600,marginTop:3}}>{classifI.icon} {classifI.label}</div>}
                        {key==='delta_t'&&<div style={{fontSize:9,color:'#7ba38f',marginTop:2}}>calculado automático · editável</div>}
                      </div>
                      <div>
                        <label style={{...sw.fl,marginBottom:4}}>FIM</label>
                        <input style={{...sw.fi,background:'rgba(255,255,255,0.85)'}} type="number"
                          placeholder={form[key+'_i']||'—'}
                          value={form[key+'_f']||''} onChange={e=>setForm(f=>{
                            const next={...f,[key+'_f']:e.target.value}
                            if(key==='temperatura'||key==='umidade'){
                              const dt=calcDeltaT(next.temperatura_f,next.umidade_f)
                              if(dt!==null) next.delta_t_f=dt.toFixed(1)
                            }
                            return next
                          })}/>
                        {classifF&&<div style={{fontSize:10,color:classifF.cor,fontWeight:600,marginTop:3}}>{classifF.icon} {classifF.label}</div>}
                      </div>
                    </div>
                    {classifPrincipal && <div style={{fontSize:11,color:classifPrincipal.cor,fontWeight:500,marginTop:8}}>{classifPrincipal.diag}</div>}
                  </div>
                )
              })}

              <div style={{fontSize:11,color:'#7ba38f',textAlign:'center',marginTop:4}}>
                📊 Classificação conforme matriz técnica de pulverização (Delta T, vento, umidade e temperatura)
              </div>

              {/* Evidências climáticas (foto ou PDF de ferramenta agro) */}
              <div style={{marginTop:16,background:'#f1f8f4',borderRadius:12,padding:14,border:'1px solid #d7e6dc'}}>
                <div style={{fontSize:12,fontWeight:700,color:'#0e9f6e',marginBottom:10,fontFamily:"'Syne',sans-serif"}}>📎 EVIDÊNCIA CLIMÁTICA <span style={{fontWeight:400,color:'#7ba38f'}}>(foto ou PDF)</span></div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  {[[1,'INÍCIO'],[2,'FIM']].map(([slot,lbl])=>(
                    <div key={slot}>
                      <label style={{...sw.fl,marginBottom:4}}>{lbl}</label>
                      {[['evid-camera','image/*'],['evid-galeria','image/*'],['evid-pdf','.pdf']].map(([prefix,accept])=>(
                        <input key={prefix} id={`${prefix}-${slot}`} type="file" accept={accept} {...(prefix==='evid-camera'?{capture:'environment'}:{})} style={{display:'none'}}
                          onChange={async e=>{
                            const f=e.target.files[0];if(!f)return
                            await handleEvidFile(slot,lbl,f)
                            e.target.value=''
                          }}/>
                      ))}
                      <div onClick={()=>setFotoPickerOpen({tipo:'evid',idx:slot,lbl})}
                        style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',border:'1.5px dashed #c3e0d0',borderRadius:10,padding:'12px 6px',cursor:'pointer',background:'#fff',minHeight:70,overflow:'hidden'}}>
                        {obsFotos[slot]?.startsWith?.('pdf:')
                          ? <><span style={{fontSize:22}}>📄</span><span style={{fontSize:9,color:'#5c7568',marginTop:2,textAlign:'center',wordBreak:'break-all'}}>{obsFotos[slot].slice(4)}</span></>
                          : obsFotos[slot]
                            ? <img src={obsFotos[slot]} alt="" style={{width:'100%',height:60,objectFit:'cover',borderRadius:8}}/>
                            : storageObsFotos[slot]
                              ? <StorageFotoSlot supabase={supabase} path={storageObsFotos[slot]}/>
                              : <><span style={{fontSize:20}}>📷</span><span style={{fontSize:9,color:'#aaa',marginTop:2}}>Anexar</span></>}
                      </div>
                      {/* Card de metadata + flag incluir no relatório */}
                      {(()=>{
                        const chave = slot===1?'inicio':'fim'
                        const meta = form.evid_meta?.[chave]
                        if(!meta) return null
                        return (
                          <div style={{marginTop:5,background:'#fff',border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 9px'}}>
                            <div style={{fontSize:9,color:'#5c7568',lineHeight:1.6}}>
                              <div style={{fontWeight:700,color:'#0b1210',wordBreak:'break-all'}}>📄 {meta.arquivo}</div>
                              <div>📅 {meta.data_foto}</div>
                              <div>{meta.tipo} · {meta.tamanho}</div>
                              {meta.gps_lat && meta.gps_lng && (
                                <div>📍 <a href={`https://maps.google.com/?q=${meta.gps_lat},${meta.gps_lng}`} target="_blank" rel="noreferrer" style={{color:'#0e9f6e',fontWeight:600}}>{meta.gps_lat}, {meta.gps_lng}</a></div>
                              )}
                            </div>
                            <label style={{display:'flex',alignItems:'center',gap:5,marginTop:5,cursor:'pointer',fontSize:10,fontWeight:600,color:meta.incluir!==false?'#0e9f6e':'#7ba38f'}}>
                              <input type="checkbox" checked={meta.incluir!==false}
                                onChange={e=>setForm(fm=>({...fm,evid_meta:{...fm.evid_meta,[chave]:{...meta,incluir:e.target.checked}}}))}
                                style={{accentColor:'#0e9f6e'}}/>
                              Incluir no relatório
                            </label>
                          </div>
                        )
                      })()}
                      {(obsFotos[slot]||storageObsFotos[slot])&&(
                        <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:14,padding:'3px',fontSize:10,cursor:'pointer',width:'100%',marginTop:4}}
                          onClick={()=>{const a=[...obsFotos];a[slot]=null;setObsFotos(a);const b=[...obsFotoFiles];b[slot]=null;setObsFotoFiles(b);const chave=slot===1?'inicio':'fim';setForm(fm=>{const em={...(fm.evid_meta||{})};delete em[chave];return {...fm,evid_meta:em}})}}>🗑️ Remover</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={sw.btnBar}>
              <div style={{display:'flex',gap:8}}>
                <HomeExitBtn/>
                <button style={{...sw.btnG,background:'#f1f8f4',color:'#5c7568',flex:'0 0 80px'}} onClick={()=>setWizardStep(2)}>← Voltar</button>
                <button style={{...sw.btnG,flex:1}} onClick={()=>{ saveToSupabase({status:statusAtual()}); setWizardStep(opState==='finished'?5:4) }}>
                  {opState==='finished'?'Ir para Relatório →':'Próximo →'}
                </button>
              </div>
            </div>
          </>
        )
      })()}


      {wizardStep===4&&(
        <>
          <div style={sw.body}>
            <div style={sw.pageTitle}>Ação</div>
            <div style={sw.pageSub}>Passo 4 de 5: Controle do voo</div>

            {/* Botão principal — Iniciar / Pausar-Retomar com o cronômetro embutido — + Finalizar ao lado */}
            {opState!=='paused_day'&&opState!=='finished'&&(
              <div style={{display:'flex',gap:8,marginBottom:10}}>
                <button style={{flex:2,background:opState==='idle'?'linear-gradient(135deg,#0e9f6e,#22c476)':opState==='paused'?'#fff3e0':'#0e9f6e',
                    color:opState==='paused'?'#f2960f':'#fff',border:opState==='paused'?'1.5px solid #f2960f':'none',
                    borderRadius:16,padding:'14px 10px',display:'flex',alignItems:'center',justifyContent:'center',gap:8,cursor:'pointer',
                    fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,boxShadow:opState==='idle'?'0 6px 16px rgba(14,159,110,0.3)':'none'}}
                  disabled={saving}
                  onClick={()=>{
                    if(opState==='idle'){
                      const n=nowParts()
                      setForm(f=>({...f,dt_inicio_data:n.data,dt_inicio_hh:n.hh,dt_inicio_mm:n.mm}))
                      setChecklistItems({bateria:false,calibracao:false,area:false,clima:false,equipamento:false,comunicacao:false})
                      setChecklistOpen(true)
                    } else {
                      opPausar()
                    }
                  }}>
                  {opState==='idle' ? <>▶️ Iniciar Voo</> : (()=>{
                    const h=Math.floor(timerSecs/3600),m=Math.floor((timerSecs%3600)/60),sec=timerSecs%60
                    const pad=n=>String(n).padStart(2,'0')
                    return <>{opState==='paused'?'▶️ Retomar':'⏸️ Pausar'} · {pad(h)}:{pad(m)}:{pad(sec)}</>
                  })()}
                </button>
                <button style={{flex:1,background:'#fdeaea',border:'none',borderRadius:16,padding:'10px 4px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,cursor:'pointer',opacity:(opState==='running'||opState==='paused')?1:.4}}
                  disabled={opState!=='running'&&opState!=='paused'}
                  onClick={()=>{
                    const n=nowParts()
                    setForm(f=>({...f,dt_fim_data:n.data,dt_fim_hh:n.hh,dt_fim_mm:n.mm}))
                    opFinalizar()
                    setWizardStep(3)
                    showToast('🌤️ Preencha as condições climáticas do FIM da operação')
                  }}>
                  <span style={{fontSize:18}}>⏹️</span>
                  <span style={{fontSize:11,fontWeight:700,color:'#e5484d'}}>Finalizar</span>
                </button>
              </div>
            )}

            {(opState==='running'||opState==='paused')&&(()=>{
              const fmtHMS=secs=>{const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60),s=secs%60;const pad=n=>String(n).padStart(2,'0');return `${pad(h)}:${pad(m)}:${pad(s)}`}
              return (
                <div style={{display:'flex',justifyContent:'center',gap:16,marginBottom:14,fontSize:11,color:'#7ba38f',fontFamily:'ui-monospace,monospace'}}>
                  <span>▶️ Ativo: {fmtHMS(timerSecs)}</span>
                  <span>🕐 Total: {fmtHMS(timerTotalSecs)}</span>
                </div>
              )
            })()}

            {/* Pausas */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:600,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>PAUSAS</span>
              <button style={{background:'#f1f8f4',border:'1px solid #d7e6dc',color:'#0e9f6e',borderRadius:16,padding:'4px 10px',fontSize:11,cursor:'pointer'}}
                onClick={()=>setForm(f=>({...f,pausas:[...(f.pausas||[]),{inicio:new Date().toISOString(),fim:null,motivo:''}]}))}>+ Pausa</button>
            </div>
            {(form.pausas||[]).map((pausa,i)=>(
              <div key={i} style={{background:'#f7fbf8',borderRadius:10,padding:'10px 12px',marginBottom:8,border:'1px solid #e8eee8'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#5c7568'}}>Pausa {i+1}</span>
                  <button style={{background:'none',border:'none',color:'#e5484d',cursor:'pointer',fontSize:16}} onClick={()=>setForm(f=>({...f,pausas:f.pausas.filter((_,j)=>j!==i)}))}>×</button>
                </div>
                {(()=>{
                  const MOTIVOS_PAUSA = ['Vento fora dos padrões','Delta T fora dos padrões','Manutenção','Alimentação','Abastecimento','Troca de bateria']
                  const isOutro = pausa.outro || (pausa.motivo && !MOTIVOS_PAUSA.includes(pausa.motivo))
                  const motivoSel = isOutro ? 'Outro' : (pausa.motivo || '')
                  return (
                    <>
                      <div style={{position:'relative',marginBottom:4}}>
                        <select style={{...sw.fs,fontSize:13,padding:'10px 12px'}} value={motivoSel}
                          onChange={e=>{
                            const arr=[...form.pausas]
                            if(e.target.value==='Outro') arr[i]={...arr[i],motivo:'',outro:true}
                            else arr[i]={...arr[i],motivo:e.target.value,outro:false}
                            setForm(f=>({...f,pausas:arr}))
                          }}>
                          <option value="">Selecione o motivo...</option>
                          {MOTIVOS_PAUSA.map(m=><option key={m}>{m}</option>)}
                          <option>Outro</option>
                        </select>
                        <span style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:'#aaa',pointerEvents:'none',fontSize:11}}>▼</span>
                      </div>
                      {isOutro&&(
                        <input style={{...sw.fi,marginBottom:4,fontSize:13}} placeholder="Descreva o motivo..." value={pausa.motivo||''}
                          onChange={e=>{const arr=[...form.pausas];arr[i]={...arr[i],motivo:e.target.value,outro:true};setForm(f=>({...f,pausas:arr}))}}/>
                      )}
                    </>
                  )
                })()}
                <div style={{fontSize:11,color:'#7ba38f'}}>{new Date(pausa.inicio).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} → {pausa.fim?new Date(pausa.fim).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'em andamento'}</div>
              </div>
            ))}

            {/* Resumo da Operação */}
            <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',letterSpacing:.5,marginBottom:8,fontFamily:"'Syne',sans-serif"}}>RESUMO DA OPERAÇÃO</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
              <div style={{gridColumn:'1 / -1',background:'#fff',borderRadius:16,border:'1px solid #dcebe3',padding:'12px 14px',display:'flex',alignItems:'center',gap:12}}>
                <span style={{width:36,height:36,borderRadius:10,background:'#e3f7ec',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>🌱</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#0b1210',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{form.cultura&&`${form.cultura} – `}{clienteVal} – {form.fazenda}</div>
                  <div style={{fontSize:11,color:'#7ba38f',marginTop:1}}>{form.talhao&&`Talhão ${form.talhao} · `}{form.area_ha&&`${form.area_ha} ha`}</div>
                </div>
              </div>
              <div style={{gridColumn:'1 / -1',background:'#fff',borderRadius:16,border:'1px solid #dcebe3',padding:'12px 14px'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <span style={{width:28,height:28,borderRadius:8,background:'#e3f7ec',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>🔋</span>
                  <span style={{fontSize:10,fontWeight:700,color:'#7ba38f',letterSpacing:.3}}>QTDE DE VOOS (BATERIAS)</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:14}}>
                  <button type="button" style={{width:28,height:28,borderRadius:8,border:'1px solid #dcebe3',background:'#f7fbf8',color:'#0e9f6e',fontSize:16,fontWeight:700,cursor:'pointer',lineHeight:1}}
                    onClick={()=>setForm(f=>({...f,qtd_voos:Math.max(1,(parseInt(f.qtd_voos)||1)-1)}))}>−</button>
                  <span style={{fontSize:19,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{form.qtd_voos||1}</span>
                  <button type="button" style={{width:28,height:28,borderRadius:8,border:'1px solid #dcebe3',background:'#f7fbf8',color:'#0e9f6e',fontSize:16,fontWeight:700,cursor:'pointer',lineHeight:1}}
                    onClick={()=>setForm(f=>({...f,qtd_voos:(parseInt(f.qtd_voos)||1)+1}))}>+</button>
                </div>
              </div>
            </div>

            {/* Editar Horário — abre popup em vez de ficar sempre visível */}
            <button style={{background:'#fff',border:'1px solid #dcebe3',borderRadius:16,padding:'12px',width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:8,cursor:'pointer',marginBottom:16,color:'#0b1210',fontWeight:600,fontSize:13,fontFamily:"'Syne',sans-serif"}}
              onClick={()=>setHorarioModalOpen(true)}>
              🕐 Editar Horário
            </button>

            {/* Finalizado Parcial */}
            {(opState==='running'||opState==='paused')&&(
              <button style={{background:'#1a1a2e',color:'#fff',border:'none',borderRadius:20,padding:'12px',width:'100%',fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginBottom:12}}
                onClick={()=>setParcialModalOpen(true)}>
                🌙 Finalizado Parcial (continua amanhã)
              </button>
            )}

            {/* Retomar de finalizado parcial */}
            {opState==='paused_day'&&(()=>{
              const {total,feita,pct}=progressoParcial(form)
              return (
              <div style={{background:'#1a1a2e',borderRadius:12,padding:'14px',marginBottom:12,color:'#fff'}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:10,textAlign:'center'}}>🌙 Finalizado Parcial</div>
                {total>0&&(
                  <div style={{marginBottom:12}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#cddbd2',marginBottom:5}}>
                      <span>{feita.toFixed(1)} de {total.toFixed(1)} ha aplicados</span>
                      <span style={{fontWeight:700,color:'#ffb020'}}>{pct}%</span>
                    </div>
                    <div style={{height:8,background:'rgba(255,255,255,.15)',borderRadius:20,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${pct}%`,background:'#ffb020',borderRadius:20,transition:'width .3s'}}/>
                    </div>
                  </div>
                )}
                <div style={{display:'flex',gap:8,justifyContent:'center'}}>
                  <button style={{background:'transparent',color:'#fff',border:'1px solid rgba(255,255,255,.3)',borderRadius:18,padding:'10px 16px',fontWeight:600,fontSize:13,cursor:'pointer'}}
                    onClick={()=>setParcialModalOpen(true)}>✏️ Editar progresso</button>
                  <button style={{background:'#ffb020',color:'#0b1210',border:'none',borderRadius:18,padding:'10px 24px',fontWeight:700,fontSize:14,cursor:'pointer'}}
                    onClick={async()=>{
                      setOpState('running');setTimerSecs(0)
                      await saveToSupabase({status:'em_operacao'})
                      showToast('▶️ Operação retomada!')
                    }}>▶️ Retomar operação</button>
                </div>
              </div>
              )
            })()}

            {/* SOS */}
            {(opState==='running'||opState==='paused')&&(
              <button style={{background:sosLoading?'#a93226':'#e74c3c',color:'#fff',border:'none',borderRadius:20,padding:'13px',width:'100%',fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginBottom:12}}
                onClick={()=>!sosLoading&&setSosConfirm(true)} disabled={sosLoading}>
                🆘 {sosLoading?'ENVIANDO SOS...':'SOS — EMERGÊNCIA'}
              </button>
            )}

            {/* Salvo */}
            {relId&&opState!=='idle'&&(
              <div style={{background:'#e3f7ec',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#0e9f6e',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <span>✅ Dados salvos automaticamente</span>
                <button style={{background:'#0e9f6e',color:'#fff',border:'none',borderRadius:15,padding:'4px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>saveToSupabase({status:opState==='running'?'em_operacao':'pausado'})}>{saveStatus==='saving'?'...':'💾'}</button>
              </div>
            )}

          </div>
          <div style={sw.btnBar}>
            <div style={{display:'flex',gap:8}}>
              <HomeExitBtn/>
              <button style={{...sw.btnG,background:'#f1f8f4',color:'#5c7568',flex:'0 0 80px'}} onClick={()=>setWizardStep(3)}>← Voltar</button>
              <button style={{...sw.btnG,flex:1}} onClick={()=>{ saveToSupabase({status:statusAtual()}); setWizardStep(5) }}>Próximo →</button>
            </div>
          </div>
        </>
      )}

      {/* ══ STEP 5 — RELATÓRIO ══ */}
      {wizardStep===5&&(
        <>
          <div style={sw.body}>
            <div style={sw.pageTitle}>Relatório</div>
            <div style={sw.pageSub}>Passo 5 de 5: Fotos, KML e geração do relatório</div>


            {/* Foto mapa */}
            <div style={sw.fw}>
              <label style={sw.fl}>MAPA DE PÓS APLICAÇÃO</label>
              <div style={{border:'1.5px dashed #e0ece5',borderRadius:12,padding:18,textAlign:'center',cursor:'pointer',background:'#f8fbf9',...((fotoMapa||storageFotoMapa)?{padding:0,border:'none'}:{})}}
                onClick={()=>setFotoPickerOpen({tipo:'mapa',idx:0})}>
                <input id="mapa-galeria" type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setFotoMapa(ev.target.result);r.readAsDataURL(f);setFotoMapaFile(f)}}/>
                <input id="mapa-camera" type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setFotoMapa(ev.target.result);r.readAsDataURL(f);setFotoMapaFile(f)}}/>
                {fotoMapa?<img src={fotoMapa} alt="mapa" style={{width:'100%',borderRadius:12,maxHeight:180,objectFit:'cover'}}/>
                  :storageFotoMapa?<StorageFotoSlot supabase={supabase} path={storageFotoMapa} height={180}/>
                  :<><div style={{fontSize:28}}>🗺️</div><div style={{fontSize:13,color:'#aaa',marginTop:6}}>Toque para adicionar foto do mapa</div></>}
              </div>
            </div>

            {/* Bordadura (Ha) — descontada da área dos talhões para chegar na área efetivamente aplicada.
                Com mais de um talhão selecionado, permite uma bordadura por talhão. */}
            {(()=>{
              const talhoesSel = (form.talhao||'').split(',').map(s=>s.trim()).filter(Boolean)
              const bordaduraTravada = opState==='paused_day'
              if (talhoesSel.length > 1) {
                const total = talhoesSel.reduce((a,nome)=>a+(parseFloat(form.bordaduraPorTalhao?.[nome])||0),0)
                return (
                  <div style={sw.fw}>
                    <label style={sw.fl}>BORDADURA POR TALHÃO (Ha)</label>
                    {talhoesSel.map(nome=>(
                      <div key={nome} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                        <span style={{fontSize:13,color:'#0b1210',flex:1}}>{nome}</span>
                        <input type="number" style={{...sw.fi,width:90,...(bordaduraTravada?{opacity:.6,background:'#f1f8f4'}:{})}} placeholder="0" value={form.bordaduraPorTalhao?.[nome]||''} disabled={bordaduraTravada}
                          onChange={e=>setForm(f=>({...f,bordaduraPorTalhao:{...f.bordaduraPorTalhao,[nome]:e.target.value}}))}/>
                      </div>
                    ))}
                    {total>0&&form.area_ha&&(
                      <div style={{fontSize:12,color:'#0e9f6e',fontWeight:600,marginTop:4,marginBottom:4}}>
                        Bordadura total: {total} ha · Área aplicada: {Math.max(0,parseFloat(form.area_ha)-total).toFixed(2)} ha
                      </div>
                    )}
                    {bordaduraTravada&&<div style={{fontSize:11,color:'#7ba38f',marginBottom:14}}>🔒 Trava após Finalizado Parcial, pra não bagunçar o progresso já registrado</div>}
                  </div>
                )
              }
              return (
                <>
                  <FI label="BORDADURA (Ha)" ph="Ex: 10" val={form.bordadura} onChange={e=>setForm(f=>({...f,bordadura:e.target.value}))} type="number" disabled={bordaduraTravada}/>
                  {form.bordadura&&form.area_ha&&(
                    <div style={{fontSize:12,color:'#0e9f6e',fontWeight:600,marginTop:-8,marginBottom:bordaduraTravada?4:14}}>
                      Área aplicada (descontando bordadura): {areaLiquidaAtual(form)} ha
                    </div>
                  )}
                  {bordaduraTravada&&<div style={{fontSize:11,color:'#7ba38f',marginBottom:14}}>🔒 Trava após Finalizado Parcial, pra não bagunçar o progresso já registrado</div>}
                </>
              )
            })()}
            {/* KML */}
            <div style={sw.fw}>
              <label style={sw.fl}>ARQUIVOS KML</label>
              {kmlFiles.map((f,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:8,background:'#f1f8f4',borderRadius:10,padding:'10px 12px',marginBottom:6,border:'1px solid #e8eee8'}}>
                  <span>📄</span><span style={{flex:1,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
                  <button style={{background:'none',border:'none',color:'#e5484d',fontSize:18,cursor:'pointer'}} onClick={()=>setKmlFiles(a=>a.filter((_,j)=>j!==i))}>×</button>
                </div>
              ))}
              <label style={{display:'block',border:'1.5px dashed #e0ece5',borderRadius:10,padding:13,textAlign:'center',cursor:'pointer',background:'#f8fbf9'}}>
                <input type="file" accept=".kml,.kmz" multiple style={{display:'none'}} onChange={e=>setKmlFiles(a=>[...a,...Array.from(e.target.files)])}/>
                <span style={{fontSize:13,color:'#7ba38f'}}>📂 Adicionar KML / KMZ</span>
              </label>
            </div>

            {/* Obs — apenas uma */}
            <div style={sw.fw}>
              <label style={sw.fl}>OBSERVAÇÃO</label>
              <textarea style={{...sw.fi,resize:'none',height:80}} value={form.obs1} onChange={e=>setForm(f=>({...f,obs1:e.target.value}))}/>
            </div>

            {/* Foto de observação — apenas uma */}
            <div style={{marginBottom:16}}>
              <label style={sw.fl}>FOTO DE OBSERVAÇÃO</label>
              <div style={{display:'flex',flexDirection:'column',gap:4,maxWidth:160}}>
                <div style={{border:'1.5px dashed #e0ece5',borderRadius:12,padding:'10px 4px',textAlign:'center',cursor:'pointer',minHeight:66,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',overflow:'hidden',background:'#f8fbf9',...((obsFotos[0]||storageObsFotos[0])?{border:'none',padding:0}:{})}}
                  onClick={()=>setFotoPickerOpen({tipo:'obs',idx:0})}>
                  {obsFotos[0]?<img src={obsFotos[0]} alt="" style={{width:'100%',height:60,objectFit:'cover',borderRadius:10}}/>
                    :storageObsFotos[0]?<StorageFotoSlot supabase={supabase} path={storageObsFotos[0]}/>
                    :<><div style={{fontSize:22}}>📷</div><div style={{fontSize:10,color:'#aaa',marginTop:2}}>Adicionar foto</div></>}
                </div>
                {(obsFotos[0]||storageObsFotos[0])&&(
                  <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:14,padding:'3px',fontSize:10,cursor:'pointer'}}
                    onClick={async e=>{e.stopPropagation();const a=[...obsFotos];a[0]=null;setObsFotos(a);const b=[...obsFotoFiles];b[0]=null;setObsFotoFiles(b)}}>🗑️</button>
                )}
                <input id="obs-galeria-0" type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const a=[...obsFotos];a[0]=ev.target.result;setObsFotos(a)};r.readAsDataURL(f);const a=[...obsFotoFiles];a[0]=f;setObsFotoFiles(a)}}/>
                <input id="obs-camera-0" type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const a=[...obsFotos];a[0]=ev.target.result;setObsFotos(a)};r.readAsDataURL(f);const a=[...obsFotoFiles];a[0]=f;setObsFotoFiles(a)}}/>
              </div>
            </div>

            {/* Expectativa de gasto por produto — dose x área aplicada (já descontando bordadura) */}
            {form.area_ha&&(()=>{
              const gastos = calcularGastoProdutos(form.produtos.filter(Boolean).map(produtoComUnidade), areaLiquidaAtual(form))
              const comDose = gastos.filter(g=>g.dose!=null)
              if(!comDose.length) return null
              return (
                <div style={{background:'#f1f8f4',borderRadius:12,padding:14,marginBottom:16,border:'1px solid #d7e6dc'}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#0e9f6e',marginBottom:8,fontFamily:"'Syne',sans-serif"}}>⚗️ EXPECTATIVA DE GASTO POR PRODUTO</div>
                  {comDose.map((g,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'4px 0',borderBottom:i<comDose.length-1?'1px solid #e8eee8':'none'}}>
                      <span style={{color:'#0b1210'}}>{g.nome}</span>
                      <span style={{fontWeight:600,color:'#0e9f6e'}}>{g.total} {g.unidade}</span>
                    </div>
                  ))}
                </div>
              )
            })()}

          </div>
          <div style={sw.btnBar}>
            <div style={{display:'flex',gap:6}}>
              <HomeExitBtn/>
              <button style={{...sw.btnG,background:'#f1f8f4',color:'#5c7568',flex:'0 0 42px',padding:'11px 4px',fontSize:16}} onClick={()=>setWizardStep(4)}>←</button>
              <button style={{...sw.btnG,background:'#fff',color:'#0e9f6e',border:'1.5px solid #0e9f6e',flex:'0 0 42px',padding:'11px 4px',fontSize:16}} disabled={saveStatus==='saving'} onClick={async()=>{await saveToSupabase();showToast('💾 Progresso salvo!')}}>
                {saveStatus==='saving'?'…':'💾'}
              </button>
              <button style={{...sw.btnG,flex:1,opacity:(opState==='finished'||opState==='paused_day')?1:.5,cursor:(opState==='finished'||opState==='paused_day')?'pointer':'default'}} disabled={(opState!=='finished'&&opState!=='paused_day')||saving} onClick={gerarRelatorioFinal}>
                {saving?'Aguarde...':opState==='paused_day'?'📋 Gerar Relatório Parcial':'📋 Gerar Relatório'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* CHECKLIST PRÉ-VOO */}
      {checklistOpen && (
        <div style={s.modalOverlay} onClick={()=>{}}>
          <div style={{...s.modal,paddingBottom:28}} onClick={e=>e.stopPropagation()}>
            <div style={{...s.modalTitle,marginBottom:4}}>
              ✅ Checklist Pré-Voo
              <button style={s.modalClose} onClick={()=>setChecklistOpen(false)}>✕</button>
            </div>
            <div style={{fontSize:12,color:'#5c7568',marginBottom:18}}>Confirme os itens antes de iniciar. Você pode pular se preferir.</div>
            {[
              ['bateria','🔋','Bateria carregada e verificada'],
              ['calibracao','🧭','Drone calibrado (bússola e IMU)'],
              ['area','📍','Área de operação verificada e segura'],
              ['clima','🌤️','Condições climáticas favoráveis'],
              ['equipamento','🔧','Equipamento e bocais verificados'],
              ['comunicacao','📡','Comunicação com a equipe estabelecida'],
            ].map(([key,icon,label])=>(
              <div key={key} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 0',borderBottom:'1px solid #eef5f0',cursor:'pointer'}}
                onClick={()=>setChecklistItems(c=>({...c,[key]:!c[key]}))}>
                <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${checklistItems[key]?'#0e9f6e':'#d7e6dc'}`,background:checklistItems[key]?'#0e9f6e':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .15s'}}>
                  {checklistItems[key]&&<span style={{color:'#fff',fontSize:13,fontWeight:700}}>✓</span>}
                </div>
                <span style={{fontSize:15}}>{icon}</span>
                <span style={{fontSize:14,color:checklistItems[key]?'#0b1210':'#5c7568',fontWeight:checklistItems[key]?500:400}}>{label}</span>
              </div>
            ))}
            <div style={{marginTop:6,padding:'8px 0',fontSize:12,color:'#5c7568',textAlign:'center'}}>
              {Object.values(checklistItems).filter(Boolean).length} / {Object.keys(checklistItems).length} itens confirmados
            </div>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button style={{...s.shareBtn,background:'#f1f8f4',color:'#5c7568',flex:1,fontSize:13}} onClick={()=>{setChecklistOpen(false);opIniciar()}}>
                Pular checklist
              </button>
              <button style={{...s.shareBtn,background:'#0e9f6e',flex:2,position:'relative',overflow:'hidden'}} onClick={()=>{setChecklistOpen(false);opIniciar()}}>
                {Object.values(checklistItems).every(Boolean)?'✅ Tudo pronto — Iniciar!':'▶ Iniciar assim mesmo'}
                <div style={{position:'absolute',bottom:0,left:0,right:0,height:3,background:'#ffb020'}}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RELATÓRIO */}
      {modalOpen&&(
        <div style={s.modalOverlay} onClick={()=>setModalOpen(false)}>
          <div style={s.modal} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>Relatório{opState==='paused_day'?' Parcial':''} <button style={s.modalClose} onClick={()=>setModalOpen(false)}>✕</button></div>
            {opState==='paused_day'&&(()=>{
              const {total,feita,pct}=progressoParcial(form)
              return total>0 ? (
                <div style={{background:'#f1f8f4',border:'1px solid #d7e6dc',borderRadius:10,padding:'10px 12px',marginBottom:14,fontSize:12,color:'#5c7568'}}>
                  🌙 Progresso parcial: <strong style={{color:'#0e9f6e'}}>{feita.toFixed(1)} de {total.toFixed(1)} ha ({pct}%)</strong>
                </div>
              ) : null
            })()}
            <ReportView form={{...form, piloto_nome: form.piloto_nome||profile?.nome||profile?.email||''}} clienteVal={clienteVal} droneVal={droneVal} kmlFiles={kmlFiles} prodFmt={produtoComUnidade}/>
            {opState==='finished'&&(
              <button style={{...s.shareBtn,background:'#0b1210',marginTop:12}} onClick={async()=>{
                const rel=await saveToSupabase({status:'finalizado'})
                if(rel){const doc=await gerarPDFRelatorio(rel,{supabase,localObsFotos:obsFotos,localFotoMapa:fotoMapa});await salvarOuCompartilharPdf(doc,'relatorio-orofly.pdf');showToast('✅ PDF pronto!')}
              }}>📄 Baixar PDF</button>
            )}
            <button style={{...s.shareBtn,background:'#25D366',marginTop:8}} onClick={compartilharWhatsApp}>💬 WhatsApp{(fotoMapaFile||storageFotoMapa)?' (com foto do mapa)':''}</button>
          </div>
        </div>
      )}

      {/* EDITAR HORÁRIO */}
      {horarioModalOpen&&(
        <div style={s.modalOverlay} onClick={()=>setHorarioModalOpen(false)}>
          <div style={s.modal} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>🕐 Editar Horário <button style={s.modalClose} onClick={()=>setHorarioModalOpen(false)}>✕</button></div>
            <p style={{fontSize:12,color:'#7ba38f',marginBottom:14}}>O sistema preenche sozinho — edite só se precisar ajustar.</p>
            <DtRow prefix="dt_inicio" form={form} setForm={setForm} label="INÍCIO" />
            <DtRow prefix="dt_fim" form={form} setForm={setForm} label="FIM" />
            <button style={{...s.shareBtn,background:'#0e9f6e',marginTop:8}} onClick={()=>setHorarioModalOpen(false)}>Pronto</button>
          </div>
        </div>
      )}

      {/* CONTINUAR VOO — sempre pergunta qual, mesmo com 1 só */}
      {continuarModalOpen&&(
        <div style={s.modalOverlay} onClick={()=>setContinuarModalOpen(false)}>
          <div style={s.modal} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>Qual voo continuar? <button style={s.modalClose} onClick={()=>setContinuarModalOpen(false)}>✕</button></div>
            {continuarLoading ? (
              <p style={{fontSize:13,color:'#7ba38f',textAlign:'center',padding:'20px 0'}}>⏳ Buscando voos em aberto...</p>
            ) : flightsAbertos.length===0 ? (
              <p style={{fontSize:13,color:'#7ba38f',textAlign:'center',padding:'20px 0'}}>Nenhum voo em aberto no momento.</p>
            ) : (
              <>
                <p style={{fontSize:13,color:'#5c7568',marginBottom:14,lineHeight:1.5}}>Você tem {flightsAbertos.length} voo{flightsAbertos.length>1?'s':''} em aberto.</p>
                {flightsAbertos.map(rel=>(
                  <div key={rel.id} onClick={()=>abrirVooAberto(rel.id)} style={{background:'#f7fbf8',borderRadius:14,padding:'12px 14px',marginBottom:8,cursor:'pointer',border:'1px solid #e8eee8'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{fontSize:14,fontWeight:700,color:'#0b1210'}}>{rel.cliente||'—'} — {rel.fazenda||'—'}</div>
                      <span style={{fontSize:10,fontWeight:700,color:'#0e9f6e',background:'#e3f7ec',borderRadius:20,padding:'3px 9px',whiteSpace:'nowrap',marginLeft:8}}>{STATUS_LABEL[rel.status]||rel.status}</span>
                    </div>
                    {rel.localizacao&&<div style={{fontSize:12,color:'#7ba38f',marginTop:2}}>Talhão {rel.localizacao}</div>}
                    <div style={{fontSize:11,color:'#7ba38f',marginTop:2}}>{new Date(rel.dt_inicio||rel.created_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* FINALIZADO PARCIAL — marcar progresso */}
      {parcialModalOpen&&(()=>{
        const {total,feita,pct}=progressoParcial(form)
        return (
        <div style={s.modalOverlay} onClick={()=>setParcialModalOpen(false)}>
          <div style={s.modal} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>🌙 Finalizado Parcial <button style={s.modalClose} onClick={()=>setParcialModalOpen(false)}>✕</button></div>
            <p style={{fontSize:13,color:'#5c7568',marginBottom:14,lineHeight:1.5}}>Registra quanto já foi aplicado. Amanhã é só retomar e continuar de onde parou.</p>
            <FI label="ÁREA FEITA ATÉ AGORA (HA)" ph="Ex: 32" val={form.area_feita} onChange={e=>setForm(f=>({...f,area_feita:e.target.value}))} type="number"/>
            {total>0&&(
              <div style={{marginTop:2,marginBottom:18}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#5c7568',marginBottom:6}}>
                  <span>{feita.toFixed(1)} de {total.toFixed(1)} ha</span>
                  <span style={{fontWeight:700,color:'#0e9f6e'}}>{pct}%</span>
                </div>
                <div style={{height:10,background:'#eef5f0',borderRadius:20,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${pct}%`,background:'#0e9f6e',borderRadius:20,transition:'width .3s'}}/>
                </div>
              </div>
            )}
            <button style={{...s.shareBtn,background:'#1a1a2e'}} onClick={async()=>{
              setParcialModalOpen(false)
              setOpState('paused_day')
              // Desconta do estoque só o incremento desde a última baixa (parcial ou início) —
              // ex: já tinha baixado 20ha, agora tá em 32ha → desconta só os 12ha novos.
              const jaDeduzido = parseFloat(form.area_deduzida)||0
              const deltaBaixa = Math.max(0, feita-jaDeduzido)
              const n=nowParts()
              setForm(f=>({...f,dt_fim_data:n.data,dt_fim_hh:n.hh,dt_fim_mm:n.mm}))
              const relSalvo = await saveToSupabase({status:'pausado_dia',area_deduzida:feita,dt_fim:n.iso})
              if(relSalvo && deltaBaixa>0) await darBaixaEstoque(relSalvo.id, deltaBaixa)
              // O voo já está salvo no servidor — pode ser retomado depois por "Continuar voo" ou
              // "Meus Relatórios". Antes de sair, registra as condições climáticas do fim do dia.
              setWizardStep(3)
              showToast('🌙 Finalizado Parcial salvo! Preencha as condições climáticas do fim do dia')
            }}>🌙 Confirmar Finalizado Parcial</button>
          </div>
        </div>
        )
      })()}

      {/* CONFIRM SOS */}
      {sosConfirm&&(
        <div style={s.modalOverlay} onClick={()=>setSosConfirm(false)}>
          <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
            <div style={{...s.modalTitle,color:'#e5484d'}}>🆘 Confirmar SOS</div>
            <p style={{fontSize:15,color:'#0b1210',marginBottom:8,lineHeight:1.6}}>Isso vai alertar <strong>todos os administradores</strong> imediatamente com sua localização GPS.</p>
            <p style={{fontSize:13,color:'#e74c3c',marginBottom:24}}>Use apenas em caso de emergência real.</p>
            <div style={{display:'flex',gap:10}}>
              <button style={{...s.shareBtn,background:'#f1f8f4',color:'#5c7568',flex:1}} onClick={()=>setSosConfirm(false)}>Cancelar</button>
              <button style={{...s.shareBtn,background:'#e5484d',flex:1}} onClick={acionarSOS}>🆘 Confirmar SOS</button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM SAIR */}
      <ExitConfirmModal/>
      <ConfirmDialogModal/>

      {/* CONFIRM FINALIZAR */}
      {finalizeConfirm&&(
        <div style={s.modalOverlay} onClick={()=>setFinalizeConfirm(null)}>
          <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalTitle}>⚠️ Campos obrigatórios</div>
            <p style={{fontSize:14,color:'#5c7568',marginBottom:8}}>Os seguintes campos estão incompletos:</p>
            <ul style={{paddingLeft:20,marginBottom:20}}>{finalizeConfirm.erros.map(e=><li key={e} style={{fontSize:14,color:'#e5484d',marginBottom:4}}>{e}</li>)}</ul>
            <div style={{display:'flex',gap:10}}>
              <button style={{...s.shareBtn,background:'#f1f8f4',color:'#5c7568',flex:1}} onClick={()=>setFinalizeConfirm(null)}>Voltar</button>
              <button style={{...s.shareBtn,background:'#f2960f',flex:1}} onClick={executarFinalizacao}>Finalizar assim mesmo</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CÂMERA / GALERIA */}
      {fotoPickerOpen && (
        <div style={s.modalOverlay} onClick={()=>setFotoPickerOpen(null)}>
          <div style={{...s.modal,paddingBottom:32}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:'#0b1210',marginBottom:20}}>{fotoPickerOpen.tipo==='evid'?`📎 Evidência — ${fotoPickerOpen.lbl}`:'📷 Adicionar foto'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <button style={{background:'#0e9f6e',color:'#fff',border:'none',borderRadius:20,padding:14,fontSize:15,fontFamily:"'Syne',sans-serif",fontWeight:600,cursor:'pointer'}}
                onClick={()=>{
                  const id = fotoPickerOpen.tipo==='mapa' ? 'mapa-camera' : fotoPickerOpen.tipo==='evid' ? `evid-camera-${fotoPickerOpen.idx}` : `obs-camera-${fotoPickerOpen.idx}`
                  setFotoPickerOpen(null)
                  setTimeout(()=>document.getElementById(id)?.click(),150)
                }}>📸 Tirar foto com câmera</button>
              <button style={{background:'#2f6fed',color:'#fff',border:'none',borderRadius:20,padding:14,fontSize:15,fontFamily:"'Syne',sans-serif",fontWeight:600,cursor:'pointer'}}
                onClick={()=>{
                  const id = fotoPickerOpen.tipo==='mapa' ? 'mapa-galeria' : fotoPickerOpen.tipo==='evid' ? `evid-galeria-${fotoPickerOpen.idx}` : `obs-galeria-${fotoPickerOpen.idx}`
                  setFotoPickerOpen(null)
                  setTimeout(()=>document.getElementById(id)?.click(),150)
                }}>🖼️ Escolher da galeria</button>
              {fotoPickerOpen.tipo==='evid'&&(
                <button style={{background:'#6b4fa0',color:'#fff',border:'none',borderRadius:20,padding:14,fontSize:15,fontFamily:"'Syne',sans-serif",fontWeight:600,cursor:'pointer'}}
                  onClick={()=>{
                    const id = `evid-pdf-${fotoPickerOpen.idx}`
                    setFotoPickerOpen(null)
                    setTimeout(()=>document.getElementById(id)?.click(),150)
                  }}>📄 Anexar PDF</button>
              )}
              <button style={{background:'#f1f8f4',color:'#5c7568',border:'none',borderRadius:20,padding:12,fontSize:14,cursor:'pointer'}}
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
  if (!url) return <div style={{fontSize:10,color:'#5c7568',padding:8}}>⏳</div>
  return <img src={url} alt="foto" style={{width:'100%',height,objectFit:'cover',borderRadius:8,display:'block'}} />
}

function ReportView({form,clienteVal,droneVal,kmlFiles=[],prodFmt}) {
  const fmt=p=>{const d=form[p+'_data'],hh=form[p+'_hh'],mm=form[p+'_mm'];if(!d)return'—';return`${d.split('-').reverse().join('/')} ${hh||'00'}:${mm||'00'}`}
  const rows=[
    ['Cliente',clienteVal],['Fazenda',form.fazenda],['Área',form.area_ha?form.area_ha+' ha':null],
    ['Qtde de voos',form.qtd_voos&&parseInt(form.qtd_voos)>1?form.qtd_voos:null],
    ['Piloto',form.piloto_nome],['Drone',droneVal],
    ...form.produtos.filter(Boolean).map((p,i)=>['Produto '+(i+1),prodFmt?prodFmt(p):p]),
    ['Gota',form.tamanho_gota],['Velocidade',form.velocidade_drone],
    ['Início',fmt('dt_inicio')],['Fim',fmt('dt_fim')],
    ...(form.pausas||[]).map((p,i)=>['Pausa '+(i+1),p.motivo||'—']),
    ...COND_KEYS.map((k,i)=>[COND_LABELS[i]+' ini',form[k+'_i']]),
    ...COND_KEYS.map((k,i)=>[COND_LABELS[i]+' fim',form[k+'_f']]),
    ['Observação',form.obs1||form.obs2],
  ].filter(([,v])=>v)
  return <div>{rows.map(([l,v])=>(
    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #eef5f0',fontSize:13}}>
      <span style={{color:'#5c7568',fontWeight:500,minWidth:110}}>{l}</span>
      <span style={{color:'#0b1210',textAlign:'right',flex:1,wordBreak:'break-word'}}>{v}</span>
    </div>
  ))}</div>
}

function buildTxt(form,clienteVal,droneVal,prodFmt,parcial=false){
  const numBR = (n,dec=2) => n==null||isNaN(n) ? '—' : n.toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec})
  const fmtHora=p=>{const hh=form[p+'_hh'],mm=form[p+'_mm'];return (hh||mm)?`${hh||'00'}:${mm||'00'}`:'—'}
  const fmtDataCurta=p=>{const d=form[p+'_data'];if(!d)return'—';const partes=d.split('-');return partes.length===3?`${partes[2]}/${partes[1]}`:d}
  const nomeCurto = n => { if(!n) return '—'; const p=n.trim().split(/\s+/).filter(Boolean); return p.length<=1?(p[0]||'—'):`${p[0]} ${p[p.length-1]}` }
  const linha='┄┄┄┄┄┄┄┄┄┄┄┄┄┄'

  const areaTotal = parseFloat(form.area_ha)||0
  const bordTotal = bordaduraAtual(form)
  const areaAplicada = areaLiquidaAtual(form)
  const {feita:areaFeita,pct:pctFeito} = progressoParcial(form)
  const gastos = calcularGastoProdutos(form.produtos.filter(Boolean).map(prodFmt||(p=>p)), areaAplicada)

  const localTxt = `${form.id_fazenda?`[${form.id_fazenda}] `:''}${form.fazenda||'—'}${form.talhao?` | Talhão: ${form.talhao}`:''}`

  let t = `🚁 *RELATÓRIO OROFLY${parcial?' — PARCIAL 🌙':''}*\n`
  t += `👤 *Cliente:* ${clienteVal||'—'}\n`
  t += `📍 *Local:* ${localTxt}\n`
  t += `⏰ *Período:* ${fmtDataCurta('dt_inicio')} (${fmtHora('dt_inicio')} ➔ ${fmtHora('dt_fim')})\n`
  t += `👨‍✈️ *Piloto:* ${nomeCurto(form.piloto_nome)} | 🛸 *Drone:* ${droneVal||'—'}\n`
  t += `${linha}\n`
  if(parcial) {
    t += `🌙 *Progresso até agora:* ${numBR(areaFeita)} de ${numBR(areaAplicada)} ha (${pctFeito}%)\n`
    t += `⏳ Operação continua — este é um relatório parcial, não o voo finalizado.\n`
  } else {
    t += `📏 *Área Total:* ${numBR(areaTotal)} ha${bordTotal>0?` (Aplicada: ${numBR(areaAplicada)} ha | Bord: ${numBR(bordTotal)} ha)`:''}\n`
  }

  const gastosValidos = gastos.filter(g=>g.nome)
  if(gastosValidos.length){
    t += `${linha}\n🧪 *Produtos:*\n`
    gastosValidos.forEach(g=>{
      const doseTxt = g.dose!=null ? String(g.dose).replace('.',',') : '—'
      t += `* ${g.nome}: ${doseTxt} ${g.unidade}/ha${g.total!=null?` (Total: ${numBR(g.total)} ${g.unidade})`:''}\n`
    })
  }

  if(form.vazao_i||form.tamanho_gota||form.velocidade_drone||form.faixa_i){
    t += `${linha}\n⚙️ *Parâmetros:*\n`
    t += `* Vazão: ${form.vazao_i||'—'} L/ha | Gota: ${form.tamanho_gota||'—'} µm\n`
    t += `* Velocidade: ${form.velocidade_drone||'—'} km/h | Faixa: ${form.faixa_i||'—'} m\n`
  }

  const anyIni = ['vento','umidade','temperatura','delta_t'].some(k=>form[k+'_i'])
  if(anyIni){
    t += `${linha}\n🌤️ *Clima (Início ➔ Fim):*\n`
    t += `* Vento: ${form.vento_i||'—'} ➔ ${form.vento_f||'—'} km/h\n`
    t += `* Umidade: ${form.umidade_i||'—'}% ➔ ${form.umidade_f||'—'}%\n`
    t += `* Temp: ${form.temperatura_i||'—'}°C ➔ ${form.temperatura_f||'—'}°C\n`
    t += `* Delta T: ${form.delta_t_i||'—'}°C ➔ ${form.delta_t_f||'—'}°C\n`
  }

  if(form.obs1) t += `${linha}\n📝 *Obs:* ${form.obs1}\n`

  if(form.gps_lat && form.gps_lng){
    t += `${linha}\n📍 ${form.gps_lat}, ${form.gps_lng}\nhttps://maps.google.com/?q=${form.gps_lat},${form.gps_lng}\n`
  }
  return t
}

function Sec({title,icon,children}){return <div style={s.section}><div style={s.sectionHeader}>{icon} {title}</div>{children}</div>}

const s={
  wrap:{maxWidth:480,margin:'0 auto',minHeight:'100vh',display:'flex',flexDirection:'column',background:'#f1f8f4',fontFamily:"'DM Sans',sans-serif"},
  // ── Header verde novo design ──
  header:{background:'#0e9f6e',padding:'calc(env(safe-area-inset-top,0px)+14px) 18px 12px'},
  headerInner:{display:'flex',alignItems:'center',justifyContent:'space-between'},
  logo:{display:'flex',alignItems:'center',gap:8},
  logoTxt:{fontFamily:"'Syne',sans-serif",fontSize:19,fontWeight:700,color:'#fff',letterSpacing:-0.5},
  dot:{color:'rgba(255,255,255,0.6)'},
  headerSub:{fontSize:11,color:'rgba(255,255,255,0.7)',marginTop:3},
  logoutBtn:{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:16,padding:'5px 10px',fontSize:12,cursor:'pointer'},
  switchBtn:{background:'#ffb020',border:'none',color:'#0b1210',borderRadius:16,padding:'5px 10px',fontSize:12,cursor:'pointer',fontWeight:600},
  // ── Steps bar ──
  stepsBar:{background:'#0e9f6e',padding:'6px 18px 14px',display:'flex',flexDirection:'column',alignItems:'center',gap:4},
  stepsRow:{display:'flex',alignItems:'center',gap:0},
  stepCircle:{width:26,height:26,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700},
  stepDone:{background:'#fff',color:'#0e9f6e'},
  stepActive:{background:'#fff',color:'#0e9f6e',boxShadow:'0 0 0 3px rgba(255,255,255,0.35)'},
  stepNext:{background:'rgba(255,255,255,0.2)',color:'rgba(255,255,255,0.7)'},
  stepLine:{width:30,height:2,background:'rgba(255,255,255,0.3)'},
  stepLineDone:{width:30,height:2,background:'#fff'},
  stepLabel:{fontSize:10,color:'rgba(255,255,255,0.8)',letterSpacing:0.3},
  // ── Status / op bar ──
  statusBar:{background:'#0e9f6e',padding:'6px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:12,color:'rgba(255,255,255,0.85)'},
  statusDot:{display:'inline-block',width:7,height:7,background:'#ffb020',borderRadius:'50%',marginRight:5},
  opBar:{display:'flex',gap:8,padding:'10px 16px',background:'#fff',borderBottom:'1px solid #e8f0ec'},
  opBtn:{flex:1,padding:'10px 4px',border:'none',borderRadius:12,fontFamily:"'Syne',sans-serif",fontSize:12,fontWeight:600,cursor:'pointer',color:'#fff'},
  // ── Body e cards ──
  body:{padding:14,flex:1,display:'flex',flexDirection:'column',gap:10,paddingBottom:80},
  section:{background:'#fff',borderRadius:14,border:'0.5px solid #dcebe3',overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'},
  sectionHeader:{background:'#f2f9f5',padding:'9px 14px',fontFamily:"'Syne',sans-serif",fontSize:10,fontWeight:600,letterSpacing:1,textTransform:'uppercase',color:'#0e9f6e',borderBottom:'0.5px solid #dcebe3'},
  field:{padding:'11px 14px',borderBottom:'0.5px solid #f0f5f2'},
  label:{fontSize:10,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:4,fontFamily:"'Syne',sans-serif",textTransform:'uppercase'},
  input:{width:'100%',border:'none',outline:'none',fontFamily:"'DM Sans',sans-serif",fontSize:14,color:'#0b1210',background:'transparent'},
  textarea:{width:'100%',border:'none',outline:'none',fontFamily:"'DM Sans',sans-serif",fontSize:14,color:'#0b1210',background:'transparent',resize:'none'},
  select:{width:'100%',border:'none',outline:'none',fontFamily:"'DM Sans',sans-serif",fontSize:14,color:'#0b1210',background:'transparent',appearance:'none',cursor:'pointer'},
  dtRow:{display:'flex',alignItems:'center',gap:6},
  dateInput:{flex:1,border:'none',outline:'none',fontFamily:"'DM Sans',sans-serif",fontSize:14,color:'#0b1210',background:'transparent',appearance:'none'},
  timeSelects:{display:'flex',alignItems:'center',gap:2},
  timeSelect:{background:'#f2f9f5',border:'1px solid #d7e6dc',borderRadius:7,color:'#0b1210',fontSize:14,padding:'3px 4px',width:48,textAlign:'center',appearance:'none',cursor:'pointer',outline:'none'},
  timeSep:{fontSize:16,fontWeight:600,color:'#5c7568'},
  nowBtn:{background:'#f2f9f5',border:'1px solid #d7e6dc',color:'#0e9f6e',borderRadius:16,padding:'4px 10px',fontSize:12,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0},
  gpsRow:{display:'flex',alignItems:'center',gap:8},
  gpsBtn:{background:'#0e9f6e',color:'#fff',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0},
  mapsLink:{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#0e9f6e',textDecoration:'none',marginTop:6},
  tabs:{display:'flex',borderBottom:'0.5px solid #dcebe3'},
  tab:{flex:1,padding:9,fontSize:12,fontWeight:600,textAlign:'center',cursor:'pointer',color:'#7ba38f',borderBottom:'2px solid transparent',fontFamily:"'Syne',sans-serif",letterSpacing:.5},
  tabActive:{color:'#0e9f6e',borderBottomColor:'#0e9f6e'},
  prodInput:{background:'#f1f8f4',border:'1px solid #dcebe3',borderRadius:10,padding:'8px 10px',fontSize:14,fontFamily:"'DM Sans',sans-serif",color:'#0b1210',outline:'none'},
  remBtn:{background:'none',border:'none',color:'#e5484d',fontSize:20,cursor:'pointer',flexShrink:0},
  addBtn:{background:'#f2f9f5',border:'1px dashed #c3e0d0',color:'#0e9f6e',borderRadius:10,padding:'10px 12px',fontSize:13,fontWeight:500,cursor:'pointer',width:'100%',display:'flex',alignItems:'center',justifyContent:'center'},
  obsFotos:{display:'flex',gap:8,padding:'0 14px 14px'},
  fotoSlot:{flex:1,border:'1.5px dashed #d7e6dc',borderRadius:12,padding:'10px 4px',textAlign:'center',cursor:'pointer',minHeight:66,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',overflow:'hidden',background:'#f8fbf9'},
  fotoSlotImg:{width:'100%',height:56,objectFit:'cover',borderRadius:8},
  photoArea:{margin:'0 14px 14px',border:'1.5px dashed #d7e6dc',borderRadius:12,padding:18,textAlign:'center',cursor:'pointer',display:'block',background:'#f8fbf9'},
  kmlItem:{display:'flex',alignItems:'center',gap:8,background:'#f1f8f4',borderRadius:10,padding:'8px 14px',margin:'4px 14px 0',border:'0.5px solid #dcebe3'},
  kmlAdd:{margin:'8px 14px 14px',border:'1.5px dashed #d7e6dc',borderRadius:12,padding:13,textAlign:'center',cursor:'pointer',display:'block'},
  footer:{padding:'0 14px 16px',display:'flex',flexDirection:'column',gap:10},
  btnPrimary:{background:'#0e9f6e',color:'#fff',border:'none',borderRadius:14,padding:16,fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:600,cursor:'pointer',position:'relative',overflow:'hidden'},
  btnAccent:{position:'absolute',bottom:0,left:0,right:0,height:3,background:'#ffb020'},
  btnSecondary:{background:'transparent',color:'#0e9f6e',border:'1.5px solid #0e9f6e',borderRadius:14,padding:13,fontSize:14,fontWeight:500,cursor:'pointer'},
  // ── Timer circular ──
  timerWrap:{display:'flex',flexDirection:'column',alignItems:'center',padding:'16px 0 10px'},
  // ── Bottom nav ──
  bottomNav:{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'#fff',borderTop:'0.5px solid #dcebe3',display:'flex',zIndex:50,paddingBottom:'env(safe-area-inset-bottom,0px)'},
  navItem:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',padding:'8px 4px 10px',gap:2,cursor:'pointer',border:'none',background:'none'},
  navIcon:{fontSize:20,color:'#b0c4b8'},
  navIconActive:{fontSize:20,color:'#0e9f6e'},
  navLabel:{fontSize:9,color:'#b0c4b8',fontWeight:500,fontFamily:"'Syne',sans-serif"},
  navLabelActive:{fontSize:9,color:'#0e9f6e',fontWeight:700,fontFamily:"'Syne',sans-serif"},
  // ── Modals ──
  modalOverlay:{position:'fixed',inset:0,background:'rgba(0,0,0,.55)',zIndex:100,display:'flex',alignItems:'flex-end',justifyContent:'center'},
  modal:{background:'#fff',borderRadius:'20px 20px 0 0',padding:'24px 20px 32px',width:'100%',maxWidth:480,maxHeight:'85vh',overflowY:'auto'},
  modalTitle:{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:700,color:'#0b1210',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'},
  modalClose:{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#5c7568'},
  shareBtn:{color:'#fff',border:'none',borderRadius:14,padding:14,fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:600,cursor:'pointer',width:'100%'},
  toast:{position:'fixed',bottom:80,left:'50%',transform:'translateX(-50%)',background:'#0b1210',color:'#fff',padding:'12px 24px',borderRadius:100,fontSize:13,fontWeight:500,zIndex:200,whiteSpace:'nowrap',borderBottom:'3px solid #ffb020'},
}

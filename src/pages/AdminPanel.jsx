import React, { useState, useEffect, useCallback, useRef } from 'react'
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { gerarPDFCliente, gerarWordCliente, gerarPDFFazendaPeriodo, gerarPDFAgenda, areaLiquida } from '../lib/pdf'
import { registrarPush, salvarSubscription } from '../lib/notifications'
import { pedirPermissaoNotificacaoLocal, notificarLocal } from '../lib/localNotify'
import { salvarOuCompartilharPdf, salvarOuCompartilharBlob, compartilharNativo } from '../lib/nativeShare'
import ProfileModal from '../components/ProfileModal'
import MapaFazendaViewer from '../components/MapaFazendaViewer'
import { CATEGORIA_DESPESA_OPTS, CATEGORIA_ICON } from '../lib/categoriasDespesa'
import { calcDeltaT, classificarClimaParam } from '../lib/clima'

// URL absoluta: dentro do app nativo (Capacitor) a origem é https://localhost,
// que não tem as funções serverless — sempre chama o site publicado de verdade.
const API_BASE = 'https://orofly.vercel.app'
const STATUS_LABEL = { rascunho:'Rascunho', em_operacao:'Em operação', pausado:'Pausado', pausado_dia:'🌙 Finalizado Parcial', finalizado:'Finalizado', sos:'🆘 SOS', sos_resolvido:'✅ SOS Resolvido' }
const STATUS_COLOR = { rascunho:'#5c7568', em_operacao:'#00A86B', pausado:'#f2960f', pausado_dia:'#1a1a2e', finalizado:'#2f6fed', sos:'#e5484d', sos_resolvido:'#5c7568' }
const STATUS_BG    = { rascunho:'#F4F7F5', em_operacao:'#e3f7ec', pausado:'#fdf3e0', pausado_dia:'#e8e8f5', finalizado:'#e6f1fb', sos:'#fdeaea', sos_resolvido:'#F4F7F5' }
const COND_KEYS    = ['faixa','vazao','vento','umidade','temperatura','delta_t']
const COND_LABELS  = ['Faixa','Vazão','Vento','Umidade','Temperatura','Delta T']
const PRODUTOS_LIST = ['Triclon','Triomax','Moddus','Suiker','Roundup','Essenza','Spotlight','Agile','Volt','Mag8','Outros']
const PRODUTO_FAZENDA_OPTS = ['Inseticida','Herbicida','Fungicida']

function gerarOrdemServico() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789' // sem caracteres ambíguos (0/o, 1/l/i)
  let s=''; for(let i=0;i<6;i++) s+=chars[Math.floor(Math.random()*chars.length)]
  return s
}

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

// Dropdown flutuante com checkboxes — substitui o <select multiple> nativo (feio e exige ctrl+clique)
function MultiSelectDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const toggle = (opt) => onChange(selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt])
  return (
    <div style={{ position:'relative' }}>
      <div style={{ fontSize:10, fontWeight:700, color:'#7ba38f', marginBottom:3 }}>{label.toUpperCase()}</div>
      <div onClick={() => setOpen(o => !o)}
        style={{ width:'100%', border:'1px solid #d7e6dc', borderRadius:8, padding:'7px 10px', fontSize:12, color:selected.length?'#0b1210':'#aaa', background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', boxSizing:'border-box' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selected.length ? `${selected.length} selecionado(s)` : 'Todos'}</span>
        <span style={{ color:'#aaa', fontSize:10, marginLeft:4, flexShrink:0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:90 }}/>
          <div style={{ position:'absolute', top:'100%', left:0, right:0, marginTop:4, background:'#fff', border:'1px solid #d7e6dc', borderRadius:10, boxShadow:'0 10px 30px rgba(0,0,0,.18)', zIndex:91, padding:6, maxHeight:220, overflowY:'auto' }}>
            {options.length === 0 ? (
              <div style={{ padding:10, fontSize:12, color:'#aaa', textAlign:'center' }}>Sem opções</div>
            ) : options.map(o => {
              const sel = selected.includes(o)
              return (
                <div key={o} onClick={() => toggle(o)}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', cursor:'pointer', borderRadius:6, background:sel?'#e3f7ec':'transparent' }}>
                  <div style={{ width:15, height:15, borderRadius:4, border:`2px solid ${sel?'#00A86B':'#c3d4c9'}`, background:sel?'#00A86B':'#fff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {sel && <span style={{ color:'#fff', fontSize:9, fontWeight:700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize:12, color:'#0b1210' }}>{o}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminPanel({ onSwitchMode }) {
  const { profile, signOut, refreshProfile } = useAuth()
  const [confirmSair, setConfirmSair] = useState(false)
  const sairComConfirmacao = () => setConfirmSair(true)
  const [showPerfil, setShowPerfil] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(null)
  useEffect(() => {
    if (!profile?.avatar_url) { setAvatarUrl(null); return }
    supabase.storage.from('relatorios').createSignedUrl(profile.avatar_url, 3600).then(({data,error})=>{
      if (error) console.error('Erro ao gerar URL do avatar:', error)
      if (data?.signedUrl) setAvatarUrl(data.signedUrl)
    })
  }, [profile?.avatar_url])
  const isMobile = useIsMobile()
  const [tab, setTab] = useState(profile?.role==='supervisor' ? 'agenda' : 'relatorios')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Configurações do Sistema — hoje só o provedor de clima (Meteoblue/Open-Meteo), mas a
  // tabela app_settings (chave/valor) e essa tela foram feitas genéricas de propósito pra
  // caber novas opções no futuro sem precisar de migração de banco nem tela nova.
  const [weatherProvider, setWeatherProvider] = useState(null)
  const [weatherProviderCarregando, setWeatherProviderCarregando] = useState(false)
  const [weatherProviderSalvando, setWeatherProviderSalvando] = useState(false)
  const [weatherLogStats, setWeatherLogStats] = useState(null)
  const [weatherStatus, setWeatherStatus] = useState(null) // {estado:'ok'|'backup'|'erro', mensagem}
  const [weatherStatusTestando, setWeatherStatusTestando] = useState(false)
  const [weatherLogs, setWeatherLogs] = useState(null) // últimas chamadas (repositório de logs)
  // Agro Finance — módulo trazido do projeto do Isaque (sócio). Só a Calculadora de
  // Orçamento por enquanto (Dashboard/Caixa/Custos/DRE ficaram de fora a pedido do Ricardo).
  const [calc, setCalc] = useState({
    cliente: 'Sao tomé', cultura: 'Soja', areaTotal: '50', tipoServico: 'Pulverização Agrícola', distancia: '100', rendimento: '12',
    custoBateriaHora: '85', combustivelKm: '1,20', diaria: '120', desgasteHora: '45', margem: '40', precoMercado: '110',
  })
  useEffect(() => {
    if (tab === 'configuracoes' && weatherProvider === null) { carregarConfiguracoes(); testarConexaoClima(); carregarWeatherLogs() }
  }, [tab]) // eslint-disable-line
  const [relatorios, setRelatorios] = useState([])
  const [pilotos, setPilotos] = useState([])
  const [times, setTimes] = useState([])
  const [fazendaTimes, setFazendaTimes] = useState([])
  const [pilotoFazendas, setPilotoFazendas] = useState([])
  const [pilotoFazendasModal, setPilotoFazendasModal] = useState(null) // piloto sendo editado
  const [incidentes, setIncidentes] = useState([])
  const [incidenteFocoId, setIncidenteFocoId] = useState(null)
  const [usuariosSubTab, setUsuariosSubTab] = useState('usuarios')
  const [novoTimeNome, setNovoTimeNome] = useState('')
  const [equipeClienteAberto, setEquipeClienteAberto] = useState({}) // {`${timeId}-${cliente}`: bool}
  const isSupervisor = profile?.role === 'supervisor'
  const [voosPorPiloto, setVoosPorPiloto] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [mapaResumo, setMapaResumo] = useState(null)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifVisto, setNotifVisto] = useState(() => { try { return localStorage.getItem('orofly_notif_visto_'+profile?.id) || null } catch { return null } })
  const [editModal, setEditModal] = useState(null)
  const [editFotoMapa, setEditFotoMapa] = useState(null)
  const [editFotoMapaFile, setEditFotoMapaFile] = useState(null)
  const [editObsFotos, setEditObsFotos] = useState([null,null,null])
  const [editObsFotoFiles, setEditObsFotoFiles] = useState([null,null,null])
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmDeleteDespesa, setConfirmDeleteDespesa] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [filters, setFilters] = useState({ cliente:'', fazenda:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })
  const [selectedKmlIds, setSelectedKmlIds] = useState([])
  const [newUser, setNewUser] = useState({ nome:'', email:'', senha:'', role:'piloto' })
  const [criandoUser, setCriandoUser] = useState(false)
  const [droneHorasLimite, setDroneHorasLimite] = useState(() => {
    try { return JSON.parse(localStorage.getItem('orofly_drone_horas')||'{}') } catch { return {} }
  })
  // Dashboard filters
  const [dashPeriodo, setDashPeriodo] = useState('mes') // hoje/semana/mes/trimestre/ano/custom
  const [dashDataIni, setDashDataIni] = useState('')
  const [dashDataFim, setDashDataFim] = useState('')
  const [dashClientes, setDashClientes] = useState([])
  const [dashPilotos, setDashPilotos] = useState([])
  const [dashDrones, setDashDrones] = useState([])
  const [dashFazendas, setDashFazendas] = useState([])
  const [dashProdutos, setDashProdutos] = useState([])
  const [precoHa, setPrecoHa] = useState(() => { try { return parseFloat(localStorage.getItem('orofly_preco_ha')||'0') } catch { return 0 } })
  const [workingDaysAnual, setWorkingDaysAnual] = useState(() => { try { return parseInt(localStorage.getItem('orofly_working_days')||'144') } catch { return 144 } })
  const [metaMensalHa, setMetaMensalHa] = useState(() => { try { return parseFloat(localStorage.getItem('orofly_meta_mensal')||'0') } catch { return 0 } })
  const [pushAtivo, setPushAtivo] = useState(false)
  const [heatMetrica, setHeatMetrica] = useState('voos') // 'voos' | 'area' | 'horas'

  // Sustentabilidade — premissas editáveis (persistidas localmente), com defaults de referência do setor
  const numLS = (key,def) => { try { const v=parseFloat(localStorage.getItem(key)); return isNaN(v)?def:v } catch { return def } }
  const [sustAviacaoLha, setSustAviacaoLha] = useState(()=>numLS('orofly_sust_aviacao_lha',3.5))
  const [sustAviacaoFator, setSustAviacaoFator] = useState(()=>numLS('orofly_sust_aviacao_fator',2.5))
  const [sustTerrestreLha, setSustTerrestreLha] = useState(()=>numLS('orofly_sust_terrestre_lha',1.2))
  const [sustTerrestreFator, setSustTerrestreFator] = useState(()=>numLS('orofly_sust_terrestre_fator',2.68))
  const [sustDroneLha, setSustDroneLha] = useState(()=>numLS('orofly_sust_drone_lha',0))
  const [sustPeriodo, setSustPeriodo] = useState('ano')
  const [sustDataIni, setSustDataIni] = useState('')
  const [sustDataFim, setSustDataFim] = useState('')

  // Inventário
  const [invDrones, setInvDrones] = useState([])
  const [invProdutos, setInvProdutos] = useState([])
  const [invClientes, setInvClientes] = useState([])
  const [invFazendas, setInvFazendas] = useState([])
  const [invTalhoes, setInvTalhoes] = useState([])
  const [fzForm, setFzForm] = useState({cliente:'',nome:'',produto:'',cep:'',lat:'',lng:'',id_fazenda:'',mapa_lat_min:'',mapa_lat_max:'',mapa_lng_min:'',mapa_lng_max:''})
  const [fzMapaFile, setFzMapaFile] = useState(null)
  const [fzMapaExistente, setFzMapaExistente] = useState(null) // mapa_pdf_path da fazenda em edição
  const [fzMapaUploading, setFzMapaUploading] = useState(false)
  const [mapaViewerFazenda, setMapaViewerFazenda] = useState(null)
  const [relatorioPeriodoFz, setRelatorioPeriodoFz] = useState(null) // fazenda (com BI) selecionada pro modal de relatório do período
  const [relatorioPeriodoForm, setRelatorioPeriodoForm] = useState({dataIni:'',dataFim:''})
  const [relatorioPeriodoLoading, setRelatorioPeriodoLoading] = useState('') // '' | 'pdf' | 'whats'
  const [fzModal, setFzModal] = useState(false)
  const [fzEditId, setFzEditId] = useState(null)
  const [fzGeoLoading, setFzGeoLoading] = useState(false)
  const [tlForm, setTlForm] = useState({}) // {fazendaId: {nome,area_ha}}
  const [fzSearch, setFzSearch] = useState('')
  const [fzProdutoFiltro, setFzProdutoFiltro] = useState('')
  const [fzClienteFiltro, setFzClienteFiltro] = useState('')
  const [fzStatusFiltro, setFzStatusFiltro] = useState('') // '' | 'concluida' | 'parcial' | 'nao_iniciada'
  const [fzExpandido, setFzExpandido] = useState({})
  const [invMovimentos, setInvMovimentos] = useState([])
  const [custos, setCustos] = useState([])
  const [osSearch, setOsSearch] = useState('')
  const [osSearchCliente, setOsSearchCliente] = useState('')
  const [fotoLightbox, setFotoLightbox] = useState(null)
  const [custosFiltros, setCustosFiltros] = useState({piloto:'',categoria:'',clienteFazenda:'',dataIni:'',dataFim:''})
  const [custosSubTab, setCustosSubTab] = useState('notas')
  const [veicFiltros, setVeicFiltros] = useState({veiculo:'',dataIni:'',dataFim:''})
  const [agenda, setAgenda] = useState([])
  const [agendaForm, setAgendaForm] = useState({piloto_id:'',cliente:'',fazenda:'',talhao:'',data_prevista:'',produtos:[{produto:'',dose:''}],drone:'',veiculo_id:'',observacao:''})
  const [agendaSaving, setAgendaSaving] = useState(false)
  const [agendaClima, setAgendaClima] = useState(null)
  const [agendaClimaLoading, setAgendaClimaLoading] = useState(false)
  const [agendaExportLoading, setAgendaExportLoading] = useState('') // '' | 'pdf' | 'whats'

  // Previsão do tempo da fazenda selecionada, pro dia agendado — só funciona se a fazenda
  // tiver lat/lng cadastrados (Fazendas & Clientes > editar fazenda).
  useEffect(() => {
    if(!agendaForm.fazenda || !agendaForm.cliente || !agendaForm.data_prevista){ setAgendaClima(null); return }
    const fz = invFazendas.find(f=>f.cliente===agendaForm.cliente && f.nome===agendaForm.fazenda)
    if(!fz?.lat || !fz?.lng){ setAgendaClima(null); return }
    let cancelled = false
    setAgendaClimaLoading(true)
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${fz.lat}&longitude=${fz.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max&hourly=temperature_2m,relativehumidity_2m&timezone=auto&forecast_days=16`)
      .then(r=>r.json())
      .then(data=>{
        if(cancelled) return
        const idx = (data.daily?.time||[]).indexOf(agendaForm.data_prevista)
        if(idx<0){ setAgendaClima({foraDoAlcance:true}); return }
        const idxHora = (data.hourly?.time||[]).findIndex(t=>t.startsWith(agendaForm.data_prevista)&&t.endsWith('T13:00'))
        const tempMeioDia = idxHora>=0 ? data.hourly.temperature_2m[idxHora] : data.daily.temperature_2m_max[idx]
        const umidMeioDia = idxHora>=0 ? data.hourly.relativehumidity_2m[idxHora] : null
        const deltaT = umidMeioDia!=null ? calcDeltaT(tempMeioDia,umidMeioDia) : null
        setAgendaClima({
          tempMax:data.daily.temperature_2m_max[idx], tempMin:data.daily.temperature_2m_min[idx],
          chuvaProb:data.daily.precipitation_probability_max[idx], ventoMax:data.daily.windspeed_10m_max[idx],
          deltaT, deltaTClass: deltaT!=null?classificarClimaParam('delta_t',deltaT.toFixed(1)):null,
        })
      })
      .catch(()=>{ if(!cancelled) setAgendaClima(null) })
      .finally(()=>{ if(!cancelled) setAgendaClimaLoading(false) })
    return () => { cancelled = true }
  }, [agendaForm.fazenda, agendaForm.cliente, agendaForm.data_prevista, invFazendas])
  const [agendaFiltros, setAgendaFiltros] = useState({piloto:'',status:''})
  const [mapaSubTab, setMapaSubTab] = useState('voos')
  const [gpsLogins, setGpsLogins] = useState([])
  const [veiculos, setVeiculos] = useState([])
  const [viagens, setViagens] = useState([])
  const [manutencoes, setManutencoes] = useState([])
  const [veiculoForm, setVeiculoForm] = useState({placa:'',marca:'',modelo:'',ano:'',km_atual:'',proxima_manutencao_km:'',proxima_manutencao_data:''})
  const [veiculoModal, setVeiculoModal] = useState(null)
  const [viagemForm, setViagemForm] = useState({})
  const [manutForm, setManutForm] = useState({})
  const [veicSaving, setVeicSaving] = useState(false)
  const [movForm, setMovForm] = useState({produto:'',tipo:'entrada',quantidade:'',obs:''})
  const [movSaving, setMovSaving] = useState(false)
  const [movFiltros, setMovFiltros] = useState({produto:'',fazenda:'',tipo:'',dataIni:'',dataFim:''})
  const [invTab, setInvTab] = useState('drones')
  const [fzTab, setFzTab] = useState('visao')
  const [droneModal, setDroneModal] = useState(null)
  const [produtoModal, setProdutoModal] = useState(null)
  const [clienteModal, setClienteModal] = useState(null)
  const [droneForm, setDroneForm] = useState({})
  const [produtoForm, setProdutoForm] = useState({})
  const [clienteForm, setClienteForm] = useState({})
  const [invSaving, setInvSaving] = useState(false)

  function initClienteForm(c={}) {
    return { nome:c.nome||'', ativo:c.ativo!==false, obs:c.obs||'', preco_catacao:c.preco_catacao??'', preco_area_total:c.preco_area_total??'' }
  }

  async function salvarCliente() {
    setInvSaving(true)
    try {
      const payload = { ...clienteForm, preco_catacao: clienteForm.preco_catacao!==''&&clienteForm.preco_catacao!=null?parseFloat(clienteForm.preco_catacao):null, preco_area_total: clienteForm.preco_area_total!==''&&clienteForm.preco_area_total!=null?parseFloat(clienteForm.preco_area_total):null }
      if (clienteModal === 'novo') {
        const { error } = await supabase.from('clientes').insert(payload)
        if (error) throw error
        showToast('✅ Cliente cadastrado!')
      } else {
        const { error } = await supabase.from('clientes').update(payload).eq('id', clienteModal.id)
        if (error) throw error
        showToast('✅ Cliente atualizado!')
      }
      setClienteModal(null); fetchInventario()
    } catch(e) { showToast('Erro: '+e.message,'error') }
    setInvSaving(false)
  }

  async function deletarCliente(id) {
    if (!window.confirm('Deletar este cliente?')) return
    await supabase.from('clientes').delete().eq('id', id)
    showToast('🗑️ Cliente removido'); fetchInventario()
  }

  function initDroneForm(d={}) {
    return { nome:d.nome||'', modelo:d.modelo||'', serial:d.serial||'', fabricante:d.fabricante||'DJI', ano_aquisicao:d.ano_aquisicao||'', horas_limite:d.horas_limite||100, ativo:d.ativo!==false, obs:d.obs||'' }
  }
  function initProdutoForm(p={}) {
    return { nome:p.nome||'', fabricante:p.fabricante||'', unidade:p.unidade||'L', estoque_atual:p.estoque_atual||0, estoque_minimo:p.estoque_minimo||0, validade:p.validade||'', registro_mapa:p.registro_mapa||'', ativo:p.ativo!==false, obs:p.obs||'', dose_padrao:p.dose_padrao??'', dose_auto:p.dose_auto!==false }
  }

  async function fetchInventario() {
    try {
      const [{ data: drones, error: e1 }, { data: produtos, error: e2 }, { data: clientes, error: e3 }] = await Promise.all([
        supabase.from('drones').select('*').order('nome'),
        supabase.from('produtos').select('*').order('nome'),
        supabase.from('clientes').select('*').order('nome'),
      ])
      if (!e1 && drones) setInvDrones(drones)
      if (!e2 && produtos) setInvProdutos(produtos)
      if (!e3 && clientes) setInvClientes(clientes)
      // Fazendas e talhões (podem não existir ainda)
      const { data: fz } = await supabase.from('fazendas').select('*').order('nome')
      if (fz) setInvFazendas(fz)
      const { data: tl } = await supabase.from('talhoes').select('*').order('nome')
      if (tl) setInvTalhoes(tl)
      // Movimentos de estoque (pode não existir ainda — ver SQL de setup)
      const { data: mov } = await supabase.from('movimentos_estoque').select('*').order('created_at',{ascending:false}).limit(500)
      if (mov) setInvMovimentos(mov)
      // Veículos, viagens e manutenções (podem não existir ainda)
      const { data: veic } = await supabase.from('veiculos').select('*').order('placa')
      if (veic) setVeiculos(veic)
      const { data: viag } = await supabase.from('viagens').select('*').order('data',{ascending:false}).limit(200)
      if (viag) setViagens(viag)
      const { data: manut } = await supabase.from('manutencoes_veiculo').select('*').order('data',{ascending:false}).limit(200)
      if (manut) setManutencoes(manut)
    } catch(e) {
      console.warn('Tabelas de inventário não encontradas. Execute o SQL no Supabase.')
    }
  }

  async function salvarMovimento() {
    if (!movForm.produto || !movForm.quantidade) { showToast('Preencha produto e quantidade', 'error'); return }
    setMovSaving(true)
    try {
      const qtdAbs = Math.abs(parseFloat(movForm.quantidade)) || 0
      const sinalQtd = movForm.tipo === 'entrada' ? qtdAbs : -qtdAbs
      const produtoInfo = invProdutos.find(p => p.nome === movForm.produto)
      const { error } = await supabase.rpc('registrar_movimento_estoque', {
        p_produto_nome: movForm.produto, p_quantidade: sinalQtd, p_tipo: movForm.tipo,
        p_unidade: produtoInfo?.unidade || null, p_relatorio_id: null,
        p_obs: movForm.obs || null, p_criado_por: profile?.nome || profile?.email || null
      })
      if (error) throw error
      showToast('✅ Movimento registrado!')
      setMovForm({produto:'',tipo:'entrada',quantidade:'',obs:''})
      fetchInventario()
    } catch(e) { showToast('Erro: '+e.message, 'error') }
    setMovSaving(false)
  }

  async function salvarDrone() {
    setInvSaving(true)
    try {
      const payload = { ...droneForm, ano_aquisicao: droneForm.ano_aquisicao ? parseInt(droneForm.ano_aquisicao) : null, horas_limite: parseInt(droneForm.horas_limite)||100 }
      if (droneModal === 'novo') {
        const { error } = await supabase.from('drones').insert(payload)
        if (error) throw error
        showToast('✅ Drone cadastrado!')
      } else {
        const { error } = await supabase.from('drones').update(payload).eq('id', droneModal.id)
        if (error) throw error
        showToast('✅ Drone atualizado!')
      }
      setDroneModal(null); fetchInventario(); fetchAll()
    } catch(e) { showToast('Erro: '+e.message,'error') }
    setInvSaving(false)
  }

  async function deletarDrone(id) {
    if (!window.confirm('Deletar este drone?')) return
    await supabase.from('drones').delete().eq('id', id)
    showToast('🗑️ Drone removido'); fetchInventario()
  }

  async function salvarProduto() {
    setInvSaving(true)
    try {
      const payload = { ...produtoForm, estoque_atual: parseFloat(produtoForm.estoque_atual)||0, estoque_minimo: parseFloat(produtoForm.estoque_minimo)||0, validade: produtoForm.validade||null, dose_padrao: produtoForm.dose_padrao!==''&&produtoForm.dose_padrao!=null?parseFloat(produtoForm.dose_padrao):null }
      if (produtoModal === 'novo') {
        const { error } = await supabase.from('produtos').insert(payload)
        if (error) throw error
        showToast('✅ Produto cadastrado!')
      } else {
        const { error } = await supabase.from('produtos').update(payload).eq('id', produtoModal.id)
        if (error) throw error
        showToast('✅ Produto atualizado!')
      }
      setProdutoModal(null); fetchInventario()
    } catch(e) { showToast('Erro: '+e.message,'error') }
    setInvSaving(false)
  }

  async function deletarProduto(id) {
    if (!window.confirm('Deletar este produto?')) return
    await supabase.from('produtos').delete().eq('id', id)
    showToast('🗑️ Produto removido'); fetchInventario()
  }

  const showToast = useCallback((msg, type='success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }, [])

  useEffect(() => { fetchAll(); fetchInventario(); ativarPush() }, [])

  // Notificação local (Android) quando um piloto inicia um voo — só pro admin de verdade
  // (não o supervisor, que também cai nesse painel). Funciona enquanto o app estiver aberto
  // (foreground ou segundo plano); é o caminho sem depender de servidor de push, já que o
  // Web Push comum não roda de forma confiável dentro do WebView do Capacitor.
  const vooNotificadoRef = useRef(new Set())
  useEffect(() => {
    if (profile?.role !== 'admin') return
    pedirPermissaoNotificacaoLocal()
    const channel = supabase.channel('voos-iniciados-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'relatorios' }, (payload) => {
        const rel = payload.new
        if (!rel || rel.status !== 'em_operacao') return
        if (rel.piloto_id === profile.id) return
        if (vooNotificadoRef.current.has(rel.id)) return
        vooNotificadoRef.current.add(rel.id)
        notificarLocal({
          titulo: '🚁 Voo iniciado — ' + (rel.piloto_nome || 'Piloto'),
          corpo: `${rel.cliente || '—'} · ${rel.fazenda || '—'}`,
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id, profile?.role])

  // Auto-atualiza os relatórios a cada 30s enquanto o Mapa de Voos estiver aberto
  useEffect(() => {
    if (tab !== 'mapa') return
    refetchRelatorios()
    const id = setInterval(refetchRelatorios, 30000)
    return () => clearInterval(id)
  }, [tab])

  async function refetchRelatorios() {
    const { data } = await supabase.from('relatorios').select('*').order('created_at', { ascending: false })
    if (data) setRelatorios(data)
  }

  // Registra push notification do admin automaticamente
  async function ativarPush() {
    try {
      const sub = await registrarPush()
      if (sub) {
        await salvarSubscription(supabase, profile.id, sub)
        setPushAtivo(true)
      }
    } catch(e) { console.warn('Push não disponível:', e) }
  }

  async function fetchAll() {
    setLoading(true)
    const [{ data: rels }, usersRes, { data: desp }, { data: agend }, { data: logins }, { data: tms }, { data: fzTimes }, { data: pilFz }, { data: incs }] = await Promise.all([
      supabase.from('relatorios').select('*').order('created_at', { ascending: false }),
      fetch(`${API_BASE}/api/list-users`),
      supabase.from('despesas').select('*').order('created_at', { ascending: false }),
      supabase.from('agendamentos').select('*').order('data_prevista', { ascending: true }),
      supabase.from('gps_logins').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('times').select('*').order('nome'),
      supabase.from('fazenda_times').select('*'),
      supabase.from('piloto_fazendas').select('*'),
      supabase.from('incidentes').select('*').order('created_at', { ascending: false }),
    ])
    const rs = rels || []
    setRelatorios(rs)
    setCustos(desp || [])
    setAgenda(agend || [])
    setGpsLogins(logins || [])
    setTimes(tms || [])
    setFazendaTimes(fzTimes || [])
    setPilotoFazendas(pilFz || [])
    setIncidentes(incs || [])
    if (usersRes.ok) { const d = await usersRes.json(); setPilotos(d.users || []) }
    const counts = {}
    rs.forEach(r => { counts[r.piloto_id] = (counts[r.piloto_id] || 0) + 1 })
    setVoosPorPiloto(counts)
    setLoading(false)
  }

  const filtered = relatorios.filter(r => {
    if (filters.cliente && !r.cliente?.toLowerCase().includes(filters.cliente.toLowerCase())) return false
    if (filters.fazenda && !r.fazenda?.toLowerCase().includes(filters.fazenda.toLowerCase())) return false
    if (filters.piloto && !r.piloto_nome?.toLowerCase().includes(filters.piloto.toLowerCase())) return false
    if (filters.drone && !r.drone?.toLowerCase().includes(filters.drone.toLowerCase())) return false
    if (filters.status && r.status !== filters.status) return false
    if (filters.dataIni && new Date(r.created_at) < new Date(filters.dataIni)) return false
    if (filters.dataFim && new Date(r.created_at) > new Date(filters.dataFim + 'T23:59:59')) return false
    return true
  })

  const sosAtivos = relatorios.filter(r => r.status === 'sos')

  const notificacoes = [
    ...relatorios.filter(r=>r.dt_inicio).map(r=>({
      id:'ini-'+r.id, ts:r.dt_inicio, icone:'🚀',
      texto:`${r.piloto_nome||'Piloto'} iniciou voo — ${r.cliente||'—'} / ${r.fazenda||'—'}`,
      onClick:()=>{setTab('relatorios');setSelected(r)},
    })),
    ...relatorios.filter(r=>r.status==='finalizado'&&r.dt_fim).map(r=>({
      id:'fim-'+r.id, ts:r.dt_fim, icone:'✅',
      texto:`${r.piloto_nome||'Piloto'} finalizou voo — ${r.cliente||'—'} / ${r.fazenda||'—'}`,
      onClick:()=>{setTab('relatorios');setSelected(r)},
    })),
    ...custos.filter(c=>c.categoria==='Gasolina').map(c=>({
      id:'gas-'+c.id, ts:c.created_at, icone:'⛽',
      texto:`${c.piloto_nome||'Piloto'} lançou nota de Gasolina — R$ ${parseFloat(c.valor).toFixed(2)}`,
      onClick:()=>{setTab('custos');setCustosSubTab('notas')},
    })),
  ].filter(n=>n.ts).sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,50)

  const notifNaoVistas = notificacoes.filter(n=>!notifVisto || new Date(n.ts) > new Date(notifVisto)).length

  function fecharNotificacoes() {
    const agora = new Date().toISOString()
    try { localStorage.setItem('orofly_notif_visto_'+profile?.id, agora) } catch {}
    setNotifVisto(agora)
    setShowNotifs(false)
  }

  // Despesas vinculadas a um voo: por relatorio_id OU por OS em texto (cobre notas
  // salvas antes da OS resolver o relatorio_id, ou lançadas por outro piloto)
  function custosDoRel(rel) {
    return custos.filter(c =>
      (c.relatorio_id && c.relatorio_id === rel.id) ||
      (c.ordem_servico && rel.ordem_servico && c.ordem_servico.toLowerCase() === rel.ordem_servico.toLowerCase())
    )
  }

  function calcTempo(ini, fim, pausas) {
    if (!ini || !fim) return null
    const t = Math.round((new Date(fim) - new Date(ini)) / 60000)
    if (t <= 0) return null
    let p = 0
    ;(pausas || []).forEach(pa => { if (pa.inicio && pa.fim) p += Math.max(0, Math.round((new Date(pa.fim) - new Date(pa.inicio)) / 60000)) })
    const f = m => { const h = Math.floor(m / 60), min = m % 60; return h > 0 ? `${h}h${String(min).padStart(2,'0')}m` : `${min}m` }
    return { total: f(t), efetivo: f(t - p), temPausa: p > 0 }
  }

  function resetEdit() {
    setEditModal(null); setEditFotoMapa(null); setEditFotoMapaFile(null)
    setEditObsFotos([null,null,null]); setEditObsFotoFiles([null,null,null])
  }

  async function salvarEdicao() {
    if (!editModal) return
    setSaving(true)
    let fotoMapaUrl = editModal.foto_mapa_url
    if (editFotoMapaFile) {
      const path = `${editModal.piloto_id}/${editModal.id}/mapa.jpg`
      await supabase.storage.from('relatorios').upload(path, editFotoMapaFile, { upsert: true })
      fotoMapaUrl = path
    }
    let obsUrls = [...(editModal.obs_fotos_urls || [null, null, null])]
    for (let i = 0; i < 3; i++) {
      if (editObsFotoFiles[i]) {
        const path = `${editModal.piloto_id}/${editModal.id}/obs_${i}.jpg`
        await supabase.storage.from('relatorios').upload(path, editObsFotoFiles[i], { upsert: true })
        obsUrls[i] = path
      }
    }
    const { id, created_at, updated_at, ...campos } = editModal
    const { error } = await supabase.from('relatorios').update({ ...campos, foto_mapa_url: fotoMapaUrl, obs_fotos_urls: obsUrls }).eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); setSaving(false); return }
    showToast('✅ Salvo!'); resetEdit(); fetchAll(); setSaving(false)
  }

  async function deletarRelatorio(id) {
    await supabase.from('relatorios').delete().eq('id', id)
    showToast('🗑️ Deletado'); setConfirmDelete(null); setSelected(null); fetchAll()
  }

  async function deletarDespesa(id) {
    await supabase.from('despesas').delete().eq('id', id)
    showToast('🗑️ Despesa deletada'); setConfirmDeleteDespesa(null); fetchAll()
  }

  async function resolverSOS(rel) {
    const obs_resolucao = `🆘 SOS acionado em ${new Date(rel.created_at).toLocaleString('pt-BR')} | ✅ Resolvido por ${profile.nome} em ${new Date().toLocaleString('pt-BR')}`
    await supabase.from('relatorios').update({
      status: 'sos_resolvido',
      obs2: obs_resolucao
    }).eq('id', rel.id)
    showToast('✅ SOS marcado como resolvido')
    fetchAll()
  }

  // Mesmo padrão de texto usado no app do piloto pro compartilhamento no WhatsApp, só que
  // montado a partir da linha crua do banco (rel) em vez do form em edição.
  function buildTxtAdmin(rel) {
    const fmtData = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
    const fmtHora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'
    const nomeCurto = n => { if(!n) return '—'; const p=n.trim().split(/\s+/).filter(Boolean); return p.length<=1?(p[0]||'—'):`${p[0]} ${p[p.length-1]}` }
    const linha='┄┄┄┄┄┄┄┄┄┄┄┄┄┄'
    const fz = invFazendas.find(f=>f.cliente===rel.cliente && f.nome===rel.fazenda)
    const localTxt = `${fz?.id_fazenda?`[${fz.id_fazenda}] `:''}${rel.fazenda||'—'}${rel.localizacao?` | Talhão: ${rel.localizacao}`:''}`
    let t = `🚁 *RELATÓRIO OROFLY*\n`
    t += `👤 *Cliente:* ${rel.cliente||'—'}\n`
    t += `📍 *Local:* ${localTxt}\n`
    t += `⏰ *Período:* ${fmtData(rel.dt_inicio)} (${fmtHora(rel.dt_inicio)} ➔ ${fmtHora(rel.dt_fim)})\n`
    t += `👨‍✈️ *Piloto:* ${nomeCurto(rel.piloto_nome)} | 🛸 *Drone:* ${rel.drone||'—'}\n`
    t += `${linha}\n`
    t += `📏 *Área Total:* ${rel.area_ha||'—'} ha${rel.bordadura?` (Aplicada: ${areaLiquida(rel)} ha | Bord: ${rel.bordadura} ha)`:''}\n`
    if((rel.produtos||[]).length){
      t += `${linha}\n🧪 *Produtos:*\n`
      rel.produtos.forEach(p=>{ t += `* ${p}\n` })
    }
    if(rel.obs1) t += `${linha}\n📝 *Obs:* ${rel.obs1}\n`
    if(rel.gps_lat && rel.gps_lng) t += `${linha}\n📍 ${rel.gps_lat}, ${rel.gps_lng}\nhttps://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}\n`
    return t
  }

  // Texto pro WhatsApp do relatório de área aplicada por fazenda/período (resumo — o PDF
  // completo com a tabela de voos vai anexado, quando o app nativo/Web Share suportar).
  function buildTxtFazendaPeriodo(fz, voosPeriodo, dataIni, dataFim, areaTotalCadastrada) {
    const fmtD = v => v ? new Date(v+'T12:00:00').toLocaleDateString('pt-BR') : '—'
    const areaAplicada = voosPeriodo.reduce((a,r)=>a+areaLiquida(r),0)
    const pct = areaTotalCadastrada>0 ? Math.min(100,(areaAplicada/areaTotalCadastrada)*100) : null
    const linha='┄┄┄┄┄┄┄┄┄┄┄┄┄┄'
    let t = `🌾 *RELATÓRIO DE ÁREA APLICADA — OROFLY*\n`
    t += `👤 *Cliente:* ${fz.cliente}\n`
    t += `📍 *Fazenda:* ${fz.nome}\n`
    t += `📅 *Período:* ${fmtD(dataIni)} a ${fmtD(dataFim)}\n`
    t += `${linha}\n`
    t += `✈️ *Voos no período:* ${voosPeriodo.length}\n`
    t += `📏 *Área aplicada:* ${areaAplicada.toFixed(2)} ha\n`
    if(pct!=null) t += `📊 *Avanço da fazenda:* ${pct.toFixed(0)}% (${areaAplicada.toFixed(1)} / ${areaTotalCadastrada.toFixed(1)} ha)\n`
    return t
  }

  async function gerarRelatorioPeriodo(fz, dataIni, dataFim, tipo) {
    if(!dataIni || !dataFim){ showToast('Escolha o período (data inicial e final)','error'); return }
    setRelatorioPeriodoLoading(tipo)
    try {
      const voosPeriodo = relatorios.filter(r=>{
        if(r.cliente!==fz.cliente || r.fazenda!==fz.nome || r.status!=='finalizado') return false
        const dRef = (r.dt_inicio || r.created_at || '').slice(0,10)
        return dRef && dRef>=dataIni && dRef<=dataFim
      })
      const doc = await gerarPDFFazendaPeriodo({ fazenda: fz, voos: voosPeriodo, dataIni, dataFim, areaTotalCadastrada: fz.areaTotal })
      const nomeBase = `${fz.nome?.replace(/\s+/g,'-').toLowerCase()}-${dataIni}-a-${dataFim}`
      if(tipo==='whats'){
        const texto = buildTxtFazendaPeriodo(fz, voosPeriodo, dataIni, dataFim, fz.areaTotal)
        const file = new File([doc.output('blob')], `relatorio-${nomeBase}.pdf`, {type:'application/pdf'})
        await compartilharNativo({ text: texto, file, filename: `relatorio-${nomeBase}.pdf`, webFallbackUrl: 'https://wa.me/?text='+encodeURIComponent(texto) })
      } else {
        await salvarOuCompartilharPdf(doc, `relatorio-${nomeBase}.pdf`)
        showToast('✅ PDF do período gerado!')
      }
      setRelatorioPeriodoFz(null)
    } catch(e){ console.error(e); showToast('Erro ao gerar relatório do período','error') } finally { setRelatorioPeriodoLoading('') }
  }

  // Tenta anexar a foto do mapa de pós-aplicação junto do texto. Só funciona de verdade no
  // app Android empacotado ou em navegador mobile com Web Share API de arquivos — desktop
  // não tem como anexar arquivo num link wa.me, cai só no texto (limitação do WhatsApp Web).
  async function enviarWhatsApp(rel) {
    const texto = buildTxtAdmin(rel)
    let file = null
    if (rel.foto_mapa_url) {
      try {
        const { data: signed } = await supabase.storage.from('relatorios').createSignedUrl(rel.foto_mapa_url, 60)
        if (signed?.signedUrl) {
          const res = await fetch(signed.signedUrl)
          const blob = await res.blob()
          file = new File([blob], 'mapa.jpg', { type: blob.type || 'image/jpeg' })
        }
      } catch (e) { console.error('Erro ao buscar foto do mapa:', e) }
    }
    await compartilharNativo({ text: texto, file, filename: 'mapa.jpg', webFallbackUrl: 'https://wa.me/?text=' + encodeURIComponent(texto) })
  }

  async function excluirTodosRascunhos() {
    const ids = relatorios.filter(r=>r.status==='rascunho').map(r=>r.id)
    if(ids.length===0) return
    if(!window.confirm(`Excluir TODOS os ${ids.length} rascunhos (de todos os pilotos)? Essa ação não pode ser desfeita.`)) return
    const { error } = await supabase.from('relatorios').delete().in('id', ids)
    if(error){ showToast('Erro: '+error.message,'error'); return }
    showToast(`🗑️ ${ids.length} rascunho(s) excluído(s)`); fetchAll()
  }

  async function excluirTodosTestes() {
    const ids = relatorios.filter(r=>r.teste).map(r=>r.id)
    if(ids.length===0) return
    if(!window.confirm(`Excluir TODOS os ${ids.length} voos marcados como teste (qualquer status, de todos os pilotos)? Essa ação não pode ser desfeita.`)) return
    const { error } = await supabase.from('relatorios').delete().in('id', ids)
    if(error){ showToast('Erro: '+error.message,'error'); return }
    showToast(`🧪 ${ids.length} voo(s) de teste excluído(s)`); fetchAll()
  }

  async function marcarIncidenteStatus(inc, status) {
    const { error } = await supabase.from('incidentes').update({ status }).eq('id', inc.id)
    if(error){ showToast('Erro: '+error.message,'error'); return }
    const msg = { aberto:'🔄 Reaberto', em_tratativa:'▶️ Em tratativa', fechado:'✅ Fechado' }
    showToast(msg[status]||'Atualizado'); fetchAll()
  }

  async function salvarDetalhesIncidente(inc, resolucao, custo) {
    const { error } = await supabase.from('incidentes').update({
      resolucao: resolucao ? resolucao.trim() : null,
      custo: custo!=='' && custo!=null ? parseFloat(custo) : null,
    }).eq('id', inc.id)
    if(error){ showToast('Erro: '+error.message,'error'); return }
    showToast('💾 Detalhes salvos'); fetchAll()
  }

  async function excluirIncidente(inc) {
    if(!window.confirm(`Excluir definitivamente este incidente${inc.ordem_servico?` (OS ${inc.ordem_servico})`:''}?\n\nApaga o registro e as fotos por completo — essa ação não pode ser desfeita.`)) return
    const fotos = [inc.foto1_url, inc.foto2_url].filter(Boolean)
    if(fotos.length>0) await supabase.storage.from('relatorios').remove(fotos)
    const { error } = await supabase.from('incidentes').delete().eq('id', inc.id)
    if(error){ showToast('Erro: '+error.message,'error'); return }
    showToast('🗑️ Incidente excluído'); fetchAll()
  }

  async function toggleAtivo(piloto) {
    try {
      const res = await fetch(`${API_BASE}/api/toggle-user`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: piloto.id, ativo: !piloto.ativo }) })
      const d = await res.json(); if (d.error) throw new Error(d.error)
      showToast(piloto.ativo ? '⛔ Desativado' : '✅ Ativado'); fetchAll()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  async function toggleRoleTo(piloto, novoRole) {
    if (piloto.id === profile?.id) { showToast('Você não pode alterar o próprio perfil de acesso — peça a outro admin', 'error'); return }
    try {
      const res = await fetch(`${API_BASE}/api/toggle-role`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: piloto.id, role: novoRole }) })
      const d = await res.json(); if (d.error) throw new Error(d.error)
      showToast(novoRole === 'admin' ? '⚙️ Virou Admin' : novoRole==='supervisor' ? '🧑‍🤝‍🧑 Virou Supervisor' : '🚁 Virou Piloto')
      fetchAll()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  async function setUserTime(piloto, time_id) {
    try {
      const res = await fetch(`${API_BASE}/api/set-time`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: piloto.id, time_id }) })
      const d = await res.json(); if (d.error) throw new Error(d.error)
      showToast('✅ Time atualizado'); fetchAll()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  async function criarTime() {
    if(!novoTimeNome.trim()){ showToast('Digite o nome do time','error'); return }
    const { error } = await supabase.from('times').insert({ nome: novoTimeNome.trim() })
    if(error){ showToast('Erro: '+error.message,'error'); return }
    setNovoTimeNome(''); showToast('✅ Time criado'); fetchAll()
  }

  async function excluirTime(time) {
    if(!window.confirm(`Excluir o time "${time.nome}"? Os pilotos dele ficam sem time, e as permissões de fazenda desse time são removidas.`)) return
    await supabase.from('fazenda_times').delete().eq('time_id', time.id)
    const { error } = await supabase.from('times').delete().eq('id', time.id)
    if(error){ showToast('Erro: '+error.message,'error'); return }
    showToast('🗑️ Time excluído'); fetchAll()
  }

  // Configurações do Sistema — carrega a preferência de provedor de clima (app_settings)
  // e um resumo de uso das APIs (weather_api_log), pra dar visibilidade de consumo antes
  // de bater no limite mensal gratuito da Meteoblue.
  async function carregarConfiguracoes() {
    setWeatherProviderCarregando(true)
    try {
      const { data } = await supabase.from('app_settings').select('valor').eq('chave','weather_provider').single()
      setWeatherProvider(data?.valor === 'open_meteo' ? 'open_meteo' : 'meteoblue')
    } catch { setWeatherProvider('meteoblue') }
    finally { setWeatherProviderCarregando(false) }
    carregarWeatherLogStats()
  }

  async function carregarWeatherLogStats() {
    try {
      const agora = new Date()
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString()
      const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString()
      const [{ count: totalMeteoblue }, { count: totalOpenMeteo }, { count: hojeMeteoblue }, { count: falhasMes }] = await Promise.all([
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).eq('provider','meteoblue').gte('criado_em', inicioMes),
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).eq('provider','open_meteo').gte('criado_em', inicioMes),
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).gte('criado_em', inicioHoje),
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).eq('sucesso', false).gte('criado_em', inicioMes),
      ])
      setWeatherLogStats({ totalMeteoblue: totalMeteoblue||0, totalOpenMeteo: totalOpenMeteo||0, hoje: hojeMeteoblue||0, falhasMes: falhasMes||0 })
    } catch { setWeatherLogStats(null) }
  }

  async function salvarProvedorClima(novo) {
    if (novo === weatherProvider) return
    setWeatherProviderSalvando(true)
    try {
      const { error } = await supabase.from('app_settings')
        .upsert({ chave:'weather_provider', valor: novo, atualizado_por: profile?.id, atualizado_em: new Date().toISOString() }, { onConflict:'chave' })
      if (error) throw error
      setWeatherProvider(novo)
      showToast(`✅ Provedor de clima: ${novo==='meteoblue'?'Meteoblue':'Open-Meteo'}`)
      testarConexaoClima()
    } catch (e) { showToast('Erro: '+e.message, 'error') }
    finally { setWeatherProviderSalvando(false) }
  }

  // Chama o próprio /api/clima com uma coordenada de teste (Ribeirão Preto) só pra ver
  // qual provedor respondeu de verdade — é a fonte de verdade do badge de status, não
  // adianta confiar só na preferência salva (a chave pode estar errada, por exemplo).
  async function testarConexaoClima() {
    setWeatherStatusTestando(true)
    try {
      const r = await fetch('/api/clima?lat=-21.1775&lon=-47.8103')
      const data = await r.json()
      if (!r.ok) { setWeatherStatus({ estado:'erro', mensagem: data?.error || `HTTP ${r.status}` }); return }
      if (data.provider_active === 'meteoblue') setWeatherStatus({ estado:'ok', mensagem:'' })
      else setWeatherStatus({ estado:'backup', mensagem: data?.erro_provedor_preferido || data?.aviso || '' })
    } catch (e) {
      setWeatherStatus({ estado:'erro', mensagem: e.message })
    } finally {
      setWeatherStatusTestando(false)
      carregarWeatherLogs() // o teste em si já gerou uma linha nova no log
    }
  }

  async function carregarWeatherLogs() {
    try {
      const { data } = await supabase.from('weather_api_log').select('provider,sucesso,erro,criado_em').order('criado_em',{ascending:false}).limit(20)
      setWeatherLogs(data || [])
    } catch { setWeatherLogs([]) }
  }

  async function toggleFazendaTime(fazendaId, timeId) {
    const existente = fazendaTimes.find(ft=>ft.fazenda_id===fazendaId && ft.time_id===timeId)
    if(existente){
      await supabase.from('fazenda_times').delete().eq('id', existente.id)
    } else {
      await supabase.from('fazenda_times').insert({ fazenda_id: fazendaId, time_id: timeId })
    }
    fetchAll()
  }

  async function toggleFazendaPiloto(fazendaId, pilotoId) {
    const existente = pilotoFazendas.find(pf=>pf.fazenda_id===fazendaId && pf.piloto_id===pilotoId)
    if(existente){
      await supabase.from('piloto_fazendas').delete().eq('id', existente.id)
    } else {
      await supabase.from('piloto_fazendas').insert({ fazenda_id: fazendaId, piloto_id: pilotoId })
    }
    fetchAll()
  }

  // Lista de fazendas agrupada por cliente, colapsável — reaproveitada tanto na permissão
  // por time (Equipes) quanto na permissão individual por piloto.
  function ChecklistFazendasPorCliente({ chavePrefixo, marcadas, onToggle }) {
    return (
      <div style={{border:'1px solid #eef5f0',borderRadius:12,overflow:'hidden'}}>
        {[...new Set(invFazendas.map(fz=>fz.cliente))].sort().map(cliente=>{
          const fazendasCli = invFazendas.filter(fz=>fz.cliente===cliente)
          const marcadasCli = fazendasCli.filter(fz=>marcadas.includes(fz.id)).length
          const chave = `${chavePrefixo}-${cliente}`
          const aberto = equipeClienteAberto[chave] ?? marcadasCli>0
          return (
            <div key={cliente} style={{borderBottom:'1px solid #f0f5f2'}}>
              <div onClick={()=>setEquipeClienteAberto(s=>({...s,[chave]:!aberto}))}
                style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',cursor:'pointer',background:'#f9fbfa'}}>
                <span style={{fontSize:12,fontWeight:700,color:'#0b1210'}}>🏢 {cliente}</span>
                <span style={{fontSize:11,color:marcadasCli>0?'#00A86B':'#aaa',fontWeight:600}}>{marcadasCli>0?`${marcadasCli}/${fazendasCli.length} liberada(s)`:`${fazendasCli.length} fazenda(s)`} {aberto?'▲':'▼'}</span>
              </div>
              {aberto && fazendasCli.map(fz=>{
                const ativo = marcadas.includes(fz.id)
                return (
                  <div key={fz.id} onClick={()=>onToggle(fz.id)}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px 7px 26px',cursor:'pointer',fontSize:12,background:ativo?'#e3f7ec':'#fff',borderTop:'1px solid #f7fbf8'}}>
                    <div style={{width:14,height:14,borderRadius:4,border:`2px solid ${ativo?'#00A86B':'#c3d4c9'}`,background:ativo?'#00A86B':'#fff',flexShrink:0}}/>
                    <span style={{color:ativo?'#0b1210':'#5c7568',fontWeight:ativo?600:400}}>{fz.nome}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  async function resetarSenha(piloto) {
    const novaSenha = window.prompt(`Nova senha para ${piloto.nome} (mínimo 6 caracteres):`)
    if (!novaSenha) return
    if (novaSenha.length < 6) { showToast('Senha mínima 6 caracteres', 'error'); return }
    try {
      const res = await fetch(`${API_BASE}/api/reset-password`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: piloto.id, novaSenha }) })
      const d = await res.json(); if (d.error) throw new Error(d.error)
      showToast('🔑 Senha redefinida!')
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  async function deletarUsuario(piloto) {
    if (piloto.id === profile?.id) { showToast('Você não pode deletar sua própria conta', 'error'); return }
    if (!window.confirm(`Deletar o usuário ${piloto.nome} (${piloto.email})?\n\nEssa ação NÃO pode ser desfeita — remove o login e o perfil por completo.`)) return
    try {
      const res = await fetch(`${API_BASE}/api/delete-user`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: piloto.id }) })
      const d = await res.json(); if (d.error) throw new Error(d.error)
      showToast('🗑️ Usuário deletado'); fetchAll()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  async function gerarPDF(rel, localFotoMapa, localObsFotos, tipo='cliente') {
    showToast('⏳ Gerando ' + (tipo==='word'?'Word':'PDF Cliente') + '...')
    try {
      const { data: relAtual } = await supabase.from('relatorios').select('*').eq('id', rel.id).single()
      const relFinal = relAtual || rel
      const opts = { supabase, localFotoMapa: localFotoMapa||null, localObsFotos: localObsFotos?.some(Boolean)?localObsFotos:null }
      const nomeBase = `${relFinal.cliente?.replace(/\s+/g,'-').toLowerCase()}-${new Date(relFinal.created_at).toLocaleDateString('pt-BR').replace(/\//g,'-')}`

      if (tipo === 'word') {
        const blob = await gerarWordCliente(relFinal, opts)
        await salvarOuCompartilharBlob(blob, `relatorio-cliente-${nomeBase}.doc`)
      } else {
        // Busca trechos se for voo compartilhado
        let trechos = []
        if (relFinal.compartilhado) {
          const { data: t } = await supabase.from('relatorio_trechos').select('*').eq('relatorio_id', relFinal.id).order('created_at')
          if (t) trechos = t
        }
        const doc = await gerarPDFCliente(relFinal, { ...opts, trechos })
        await salvarOuCompartilharPdf(doc, `relatorio-cliente-${nomeBase}.pdf`)
      }
      showToast('✅ ' + (tipo==='word'?'Word':'PDF Cliente') + ' baixado!')
    } catch (e) { console.error(e); showToast('Erro ao gerar arquivo', 'error') }
  }

  async function criarUsuario(e) {
    e.preventDefault()
    if (!newUser.nome || !newUser.email || !newUser.senha) { showToast('⚠️ Preencha tudo', 'error'); return }
    setCriandoUser(true)
    try {
      const res = await fetch(`${API_BASE}/api/create-user`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newUser) })
      const text = await res.text(); let data
      try { data = JSON.parse(text) } catch { throw new Error('Função não encontrada.') }
      if (data.error) throw new Error(data.error)
      showToast('✅ Usuário criado!'); setNewUser({ nome: '', email: '', senha: '', role: 'piloto' }); fetchAll()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
    setCriandoUser(false)
  }

  const fmt = v => v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

  const NavContent = () => (
    <>
      <div style={{ padding: '24px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c476" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <span style={{ fontFamily:"'Syne',sans-serif", fontSize: 19, fontWeight: 700, color: '#fff', letterSpacing: -0.5 }}>Orofly<span style={{ color: '#ffb020' }}>.</span></span>
          <span style={{ background: '#ffb020', color: '#0b1210', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>ADMIN</span>
        </div>
        <div style={{ fontSize: 10, color: pushAtivo ? '#22c476' : '#4a6e56', letterSpacing: 1 }}>
          {pushAtivo ? '🔔 Notificações ativas' : 'Painel de Administração'}
        </div>
      </div>

      {/* ALERTA SOS */}
      {sosAtivos.length > 0 && (
        <div style={{ margin: '0 12px 8px', background: '#e5484d', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }} onClick={() => setTab('mapa')}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>🆘 {sosAtivos.length} SOS ATIVO{sosAtivos.length > 1 ? 'S' : ''}</div>
          <div style={{ fontSize: 11, color: '#fcc', marginTop: 2 }}>Toque para ver no mapa</div>
        </div>
      )}

      <nav style={{ padding: '4px 12px', flex: 1 }}>
        {(isSupervisor ? [
          ['OPERAÇÕES', [
            ['agenda', '📅', 'Agenda', agenda.filter(a=>a.status==='pendente').length],
          ]],
          ['CONFIGURAÇÕES', [
            ['pilotos', '👥', 'Equipes', pilotos.length],
          ]],
        ] : [
          ['RESUMO', [
            ['dashboard', '📊', 'Início', ''],
            ['sustentabilidade', '🌱', 'Sustentabilidade', ''],
            ['mapa', '🗺️', 'Mapa de Voos', relatorios.filter(r=>r.gps_lat).length],
            ['kml', '🛰️', 'Trajetos KML', relatorios.filter(r=>(r.kml_paths||[]).length>0).length],
          ]],
          ['GESTÃO', [
            ['fazendas', '🌾', 'Fazendas', invFazendas.length],
            ['inventario', '📦', 'Inventário', invDrones.length + invProdutos.length],
          ]],
          ['OPERAÇÕES', [
            ['relatorios', '📋', 'Relatórios', filtered.length],
            ['buscaOS', '🔍', 'Buscar OS', ''],
            ['agenda', '📅', 'Agenda', agenda.filter(a=>a.status==='pendente').length],
            ['incidentes', '⚠️', 'Incidentes', incidentes.filter(i=>i.status!=='resolvido').length],
            ['custos', '💰', 'Financeiro', custos.length],
            ['agrofinance', '💹', 'Agro Finance', ''],
          ]],
          ['CONFIGURAÇÕES', [
            ['pilotos', '👥', 'Usuários', pilotos.length],
            ['configuracoes', '⚙️', 'Configurações do Sistema', ''],
          ]],
        ]).map(([secao, itens]) => (
          <div key={secao} style={{marginBottom:14}}>
            <div style={{fontSize:9,fontWeight:700,color:'#4a6e56',letterSpacing:1.2,padding:'0 12px',marginBottom:6}}>{secao}</div>
            {itens.map(([id, icon, lbl, cnt]) => (
              <button key={id} style={{ display:'flex', alignItems:'center', gap:10, width:'100%', background: tab===id?'linear-gradient(135deg,#00A86B,#00875A)':'transparent', border:'none', borderRadius:18, padding:'9px 12px', cursor:'pointer', color: tab===id?'#fff':'#7ba38f', fontSize:13, fontFamily:"'DM Sans',sans-serif", fontWeight:500, marginBottom:3, boxShadow: tab===id?'0 6px 16px rgba(14,159,110,0.35)':'none', transition:'all .15s' }}
                onClick={() => { setTab(id); setSidebarOpen(false) }}>
                <span style={{width:26,height:26,borderRadius:9,background:tab===id?'rgba(255,255,255,0.2)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>{icon}</span>
                <span style={{ flex:1, textAlign:'left' }}>{lbl}</span>
                {cnt!==''&&<span style={{ background: tab===id?'#ffb020':'#1e3828', color: tab===id?'#0b1210':'#5c7568', fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:20 }}>{cnt}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div style={{ padding:'10px 20px', borderTop:'1px solid #1e3828', borderBottom:'1px solid #1e3828', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4 }}>
        {[
          ['Em voo', relatorios.filter(r=>r.status==='em_operacao').length, '#22c476'],
          ['Pausados', relatorios.filter(r=>r.status==='pausado').length, '#f2960f'],
          ['SOS', sosAtivos.length, '#e5484d']
        ].map(([lbl,val,cor]) => (
          <div key={lbl} style={{ textAlign:'center' }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:700, color:cor }}>{val}</div>
            <div style={{ fontSize:9, color:'#4a6e56' }}>{lbl}</div>
          </div>
        ))}
      </div>

      <div style={{ padding:'14px 20px' }}>
        <button style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8, background:'transparent', border:'1px solid #1e3828', color:'#7ba38f', borderRadius:16, padding:'8px', fontSize:12, cursor:'pointer', marginBottom:10, position:'relative' }} onClick={()=>setShowNotifs(true)}>
          🔔 Notificações
          {notifNaoVistas>0 && <span style={{ background:'#e5484d', color:'#fff', fontSize:10, fontWeight:700, borderRadius:20, minWidth:16, height:16, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px' }}>{notifNaoVistas>9?'9+':notifNaoVistas}</span>}
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, cursor:'pointer' }} onClick={()=>setShowPerfil(true)}>
          <div style={{ width:30, height:30, borderRadius:'50%', background:'#00A86B', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:13, overflow:'hidden', flexShrink:0 }}>
            {avatarUrl?<img src={avatarUrl} alt="avatar" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:profile?.nome?.[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'#fff' }}>{profile?.nome}</div>
            <div style={{ fontSize:10, color:'#7ba38f' }}>Admin</div>
          </div>
        </div>
        <button style={{ width:'100%', background:'transparent', border:'1px solid #1e3828', color:'#7ba38f', borderRadius:16, padding:'7px', fontSize:12, cursor:'pointer', marginBottom:8 }} onClick={()=>setShowPerfil(true)}>⚙️ Meu Perfil</button>
        {onSwitchMode && (
          <button style={{ width:'100%', background:'#ffb020', border:'none', color:'#0b1210', borderRadius:16, padding:'8px', fontSize:12, cursor:'pointer', fontFamily:"'Syne',sans-serif", fontWeight:700, marginBottom:8 }} onClick={onSwitchMode}>
            🚁 Modo Piloto
          </button>
        )}
        <button style={{ width:'100%', background:'transparent', border:'1px solid #1e3828', color:'#4a6e56', borderRadius:16, padding:'7px', fontSize:12, cursor:'pointer' }} onClick={sairComConfirmacao}>Sair</button>
        <div style={{ textAlign:'center', fontSize:10, color:'#2d4a38', marginTop:8, letterSpacing:1 }}>v3.8</div>
      </div>
    </>
  )

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'#F4F7F5', fontFamily:"'DM Sans',sans-serif" }}>

      {!isMobile && (
        <aside style={{ width:240, background:'linear-gradient(180deg,#0b1210 0%,#0a1613 100%)', display:'flex', flexDirection:'column', position:'sticky', top:0, height:'100vh', flexShrink:0, overflowY:'auto' }}>
          <NavContent />
        </aside>
      )}

      {isMobile && sidebarOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex' }}>
          <div style={{ width:260, background:'#0b1210', display:'flex', flexDirection:'column', overflowY:'auto' }}><NavContent /></div>
          <div style={{ flex:1, background:'rgba(0,0,0,.5)' }} onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>

        {isMobile && (
          <div style={{ background:'#0b1210', padding:'11px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <button style={{ background:'transparent', border:'none', color:'#7ba38f', fontSize:22, cursor:'pointer' }} onClick={() => setSidebarOpen(true)}>☰</button>
              <span style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, color:'#fff' }}>Orofly<span style={{ color:'#ffb020' }}>.</span></span>
              {sosAtivos.length > 0 && <span style={{ background:'#e5484d', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20 }}>🆘 {sosAtivos.length}</span>}
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {(isSupervisor ? [['agenda','📅'],['pilotos','👥']] : [['relatorios','📋'],['dashboard','📊'],['mapa','🗺️'],['inventario','📦'],['pilotos','👥']]).map(([id,ic]) => (
                <button key={id} style={{ background: tab===id?'#1a3a22':'transparent', border:'none', borderRadius:16, padding:'6px 10px', cursor:'pointer', fontSize:16, color: tab===id?'#fff':'#7ba38f' }} onClick={() => setTab(id)}>{ic}</button>
              ))}
              {onSwitchMode && <button style={{ background:'#ffb020', border:'none', borderRadius:16, padding:'5px 10px', fontSize:11, cursor:'pointer', fontWeight:700 }} onClick={onSwitchMode}>🚁</button>}
              <button style={{ position:'relative', background:'transparent', border:'1px solid #2d4a38', color:'#7ba38f', borderRadius:16, padding:'5px 10px', fontSize:14, cursor:'pointer' }} onClick={()=>setShowNotifs(true)}>
                🔔
                {notifNaoVistas>0 && <span style={{ position:'absolute', top:-4, right:-4, background:'#e5484d', color:'#fff', fontSize:9, fontWeight:700, borderRadius:20, minWidth:14, height:14, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px' }}>{notifNaoVistas>9?'9+':notifNaoVistas}</span>}
              </button>
              <button style={{ background:'transparent', border:'1px solid #2d4a38', color:'#7ba38f', borderRadius:16, padding:'5px 10px', fontSize:11, cursor:'pointer' }} onClick={sairComConfirmacao}>Sair</button>
            </div>
          </div>
        )}

        <main style={{ flex:1, overflow:'auto', padding: isMobile?'12px':'28px 32px' }}>

          {/* ===== RELATÓRIOS ===== */}
          {tab === 'relatorios' && (
            <div>
              <div style={{ marginBottom:18, display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:10 }}>
                <div>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>Relatórios de Voo</div>
                  <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>{filtered.length} de {relatorios.length}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end' }}>
                  {relatorios.some(r=>r.status==='rascunho') && (
                    <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                      onClick={excluirTodosRascunhos}>🗑️ Excluir todos os rascunhos</button>
                  )}
                  {relatorios.some(r=>r.teste) && (()=>{
                    const testes = relatorios.filter(r=>r.teste)
                    const porStatus = {}
                    testes.forEach(r=>{ porStatus[r.status]=(porStatus[r.status]||0)+1 })
                    const resumo = Object.entries(porStatus).map(([st,n])=>`${STATUS_LABEL[st]||st}: ${n}`).join(' · ')
                    return (
                      <div style={{textAlign:'right'}}>
                        <button style={{background:'#fff3e0',color:'#a3690a',border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                          onClick={excluirTodosTestes}>🧪 Excluir todos os testes ({testes.length})</button>
                        <div style={{fontSize:10,color:'#a3690a',marginTop:3}}>{resumo}</div>
                      </div>
                    )
                  })()}
                </div>
              </div>
              {sosAtivos.length > 0 && (
                <div style={{ background:'#fdeaea', border:'2px solid #e5484d', borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#e5484d', marginBottom:8 }}>🆘 SOS ATIVOS — {sosAtivos.length} alerta(s)</div>
                  {sosAtivos.map(r => (
                    <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingBottom:8, borderBottom:'1px solid #f5c6c6' }}>
                      <div>
                        <div style={{ fontSize:13, color:'#0b1210', fontWeight:600 }}>{r.piloto_nome} — {r.cliente||'sem cliente'}</div>
                        <div style={{ fontSize:11, color:'#e5484d', marginTop:2 }}>{r.obs1}</div>
                        {r.gps_lat && <a href={`https://maps.google.com/?q=${r.gps_lat},${r.gps_lng}`} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'#e5484d', fontWeight:600 }}>📍 Ver localização</a>}
                      </div>
                      <button
                        style={{ background:'#00A86B', color:'#fff', border:'none', borderRadius:16, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', marginLeft:12 }}
                        onClick={() => resolverSOS(r)}
                      >
                        ✅ Resolver
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, background:'#fff', padding:12, borderRadius:12, border:'1px solid #d7e6dc', alignItems:'center' }}>
                {[['Cliente','cliente'],['Fazenda','fazenda'],['Piloto','piloto'],['Drone','drone']].map(([ph,k]) => (
                  <input key={k} style={sG.fi} placeholder={`🔍 ${ph}...`} value={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.value }))} />
                ))}
                <select style={sG.fi} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                  <option value="">Todos status</option>
                  <option value="em_operacao">🟢 Em operação</option>
                  <option value="pausado">🟡 Pausado</option>
                  <option value="finalizado">✅ Finalizado</option>
                  <option value="sos">🆘 SOS Ativo</option>
                  <option value="sos_resolvido">✅ SOS Resolvido</option>
                  <option value="rascunho">Rascunho</option>
                </select>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:'#5c7568', whiteSpace:'nowrap' }}>De:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataIni} onChange={e => setFilters(f => ({ ...f, dataIni: e.target.value }))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:'#5c7568', whiteSpace:'nowrap' }}>Até:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataFim} onChange={e => setFilters(f => ({ ...f, dataFim: e.target.value }))} />
                </div>
                {Object.values(filters).some(Boolean) && (
                  <button style={{ background:'none', border:'1px solid #e0b0a8', color:'#e5484d', borderRadius:16, padding:'7px 12px', fontSize:12, cursor:'pointer' }} onClick={() => setFilters({ cliente:'', fazenda:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })}>✕ Limpar</button>
                )}
              </div>

              {loading ? <div style={{ textAlign:'center', color:'#5c7568', padding:40 }}>Carregando...</div>
              : filtered.length === 0 ? <div style={{ textAlign:'center', color:'#5c7568', padding:40 }}>Nenhum relatório</div>
              : isMobile ? (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {filtered.map(rel => {
                    const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
                    const isSel = selected?.id === rel.id
                    return (
                      <div key={rel.id} style={{ background:'#fff', borderRadius:12, border:`1px solid ${rel.status==='sos'?'#e5484d':isSel?'#00A86B':'#d7e6dc'}`, overflow:'hidden' }}>
                        <div style={{ padding:'13px 15px', cursor:'pointer' }} onClick={() => setSelected(isSel ? null : rel)}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                            <div style={{ fontWeight:600, fontSize:14, color:'#0b1210' }}>{rel.cliente||'—'}</div>
                            <span style={{ background: STATUS_BG[rel.status]||'#F4F7F5', color: STATUS_COLOR[rel.status]||'#5c7568', fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span>
                          </div>
                          <div style={{ fontSize:12, color:'#5c7568' }}>{rel.fazenda}{rel.produto?` · ${rel.produto}`:''} · {rel.piloto_nome}{rel.ordem_servico?` · OS ${rel.ordem_servico}`:''}</div>
                          <div style={{ fontSize:11, color:'#aaa', marginTop:3 }}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}{tempo?` · ${tempo.total}`:''}</div>
                        </div>
                        {isSel && (
                          <div style={{ padding:'10px 15px', borderTop:'1px solid #eef5f0', background:'#f7fbf8' }}>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom: (rel.kml_arquivos?.length > 0) ? 10 : 0 }}>
                              <button style={sG.actBtn('#2f6fed')} onClick={e => { e.stopPropagation(); setEditModal({...rel}) }}>✏️ Editar</button>
                              <button style={sG.actBtn('#22c476')} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'cliente') }}>🟢 Cliente</button>
                              <button style={sG.actBtn('#1a5fa5')} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'word') }}>📝 Word</button>
                              {rel.gps_lat && <a style={{ ...sG.actBtn('#00A86B'), textDecoration:'none' }} href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer">🗺️</a>}
                              <button style={sG.actBtn('#e5484d')} onClick={e => { e.stopPropagation(); setConfirmDelete(rel) }}>🗑️</button>
                            </div>
                            {(() => {
                              const totalCustos = custosDoRel(rel).reduce((a,c)=>a+parseFloat(c.valor||0),0)
                              return totalCustos>0 && <div style={{ fontSize:12, color:'#5c7568', marginBottom:10 }}>💰 Despesas vinculadas: <strong style={{color:'#00A86B'}}>R$ {totalCustos.toFixed(2)}</strong></div>
                            })()}
                            {/* KML no mobile */}
                            {rel.kml_arquivos?.length > 0 && (
                              <KmlViewer rel={rel} supabase={supabase} />
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ background:'#fff', borderRadius:12, border:'1px solid #d7e6dc', overflow:'hidden' }}>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', minWidth:700 }}>
                      <thead>
                        <tr style={{ background:'#F4F7F5' }}>
                          {['Cliente','Fazenda','Piloto','Drone','Status','Data','Tempo','Custo','Ações'].map(h => (
                            <th key={h} style={{ padding:'11px 14px', textAlign:'left', fontSize:11, fontWeight:700, color:'#5c7568', letterSpacing:0.5, borderBottom:'1px solid #d7e6dc', whiteSpace:'nowrap', fontFamily:"'Syne',sans-serif" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((rel, i) => {
                          const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
                          const isSel = selected?.id === rel.id
                          return (
                            <React.Fragment key={rel.id}>
                              <tr style={{ background: rel.status==='sos'?'#fdeaea':isSel?'#e3f7ec':i%2===0?'#fff':'#f7fbf8', cursor:'pointer' }} onClick={() => setSelected(isSel ? null : rel)}>
                                <td style={{ ...sG.td, fontWeight:600 }}>{rel.cliente||'—'}</td>
                                <td style={sG.td}>
                                  {rel.fazenda||'—'}
                                  {rel.ordem_servico && (
                                    <div>
                                      <span style={{fontFamily:'ui-monospace,monospace',fontSize:10,fontWeight:600,color:'#5c7568',background:'#eef5f0',padding:'1px 6px',borderRadius:20}}>OS {rel.ordem_servico}</span>
                                    </div>
                                  )}
                                  {(rel.tipo_servico||(rel.qtd_voos&&rel.qtd_voos>1)) && (
                                    <div style={{fontSize:10,color:'#7ba38f',marginTop:1}}>
                                      {rel.tipo_servico&&(rel.tipo_servico==='catacao'?'Catação':'Área Total')}
                                      {rel.tipo_servico&&rel.qtd_voos>1?' · ':''}
                                      {rel.qtd_voos>1?`${rel.qtd_voos} voos`:''}
                                    </div>
                                  )}
                                </td>
                                <td style={sG.td}>{rel.piloto_nome||'—'}</td>
                                <td style={sG.td}>{rel.drone||'—'}</td>
                                <td style={sG.td}><span style={{ background: STATUS_BG[rel.status]||'#F4F7F5', color: STATUS_COLOR[rel.status]||'#5c7568', fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span></td>
                                <td style={sG.td}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}</td>
                                <td style={sG.td}>{tempo ? <span style={{ fontSize:12 }}>{tempo.total}{tempo.temPausa?<span style={{ color:'#5c7568' }}> /{tempo.efetivo}</span>:''}</span> : '—'}</td>
                                <td style={sG.td}>{(() => { const t=custosDoRel(rel).reduce((a,c)=>a+parseFloat(c.valor||0),0); return t>0 ? <span style={{fontWeight:600,color:'#f2960f'}}>R$ {t.toFixed(2)}</span> : <span style={{color:'#c3d4c9'}}>—</span> })()}</td>
                                <td style={{ ...sG.td, whiteSpace:'nowrap' }}>
                                  <button title="Editar" style={sG.iconBtn} onClick={e => { e.stopPropagation(); setEditModal({...rel}) }}>✏️</button>
                                  <button title="Enviar relatório no WhatsApp" style={{...sG.iconBtn,color:'#25D366'}} onClick={e => { e.stopPropagation(); enviarWhatsApp(rel) }}>💬</button>
                                  <button title="PDF Cliente" style={{...sG.iconBtn,color:'#22c476'}} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'cliente') }}>🟢</button>
                                  <button title="Word / Google Docs" style={{...sG.iconBtn,color:'#2f6fed'}} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'word') }}>📝</button>
                                  {rel.gps_lat && <a title="Maps" style={{ ...sG.iconBtn, textDecoration:'none' }} href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>🗺️</a>}
                                  <button title="Deletar" style={{ ...sG.iconBtn, color:'#e5484d' }} onClick={e => { e.stopPropagation(); setConfirmDelete(rel) }}>🗑️</button>
                                </td>
                              </tr>
                              {isSel && (() => {
                                const custosVinculados = custosDoRel(rel)
                                const totalCustos = custosVinculados.reduce((a,c)=>a+parseFloat(c.valor||0),0)
                                const CAT_ICON = CATEGORIA_ICON
                                return (
                                <tr>
                                  <td colSpan={8} style={{ background:'#f0f8f4', borderBottom:'2px solid #d7e6dc', padding:0 }}>
                                    <div style={{ display:'flex', gap:20, padding:'16px 20px', flexWrap:'wrap' }}>
                                      <DetailCol title="Localização" items={[['Local',rel.localizacao],['GPS',rel.gps_lat?`${rel.gps_lat}, ${rel.gps_lng}`:'—']]} />
                                      <DetailCol title="Cond. Início" items={COND_KEYS.map((k,ii)=>[COND_LABELS[ii],rel[k+'_i']])} />
                                      <DetailCol title="Cond. Fim" items={COND_KEYS.map((k,ii)=>[COND_LABELS[ii],rel[k+'_f']])} />
                                      <DetailCol title="Horários" items={[['Início',fmt(rel.dt_inicio)],['Fim',fmt(rel.dt_fim)],...(tempo?[['Total',tempo.total],...(tempo.temPausa?[['Efetivo',tempo.efetivo]]:[])]:[] )]} />
                                      <DetailCol title="Outros" items={[['OS',rel.ordem_servico],...((rel.produtos||[]).map((p,ii)=>['Prod.'+(ii+1),p])),['Tipo Serviço',rel.tipo_servico==='catacao'?'Catação':rel.tipo_servico==='area_total'?'Área Total':null],['Qtde Voos',rel.qtd_voos>1?rel.qtd_voos:null],['Gota',rel.tamanho_gota],['Vel.',rel.velocidade_drone],['Obs 1',rel.obs1],['Obs 2',rel.obs2]]} />
                                      <div style={{minWidth:200,flex:1}}>
                                        <div style={{fontSize:10,fontWeight:700,color:'#00A86B',letterSpacing:1,marginBottom:5,fontFamily:"'Syne',sans-serif"}}>CUSTO DO VOO</div>
                                        {custosVinculados.length===0 ? (
                                          <div style={{fontSize:11,color:'#5c7568'}}>—</div>
                                        ) : (
                                          <>
                                            <div style={{fontSize:11,fontWeight:700,color:'#0b1210',marginBottom:6}}>Total: R$ {totalCustos.toFixed(2)} ({custosVinculados.length})</div>
                                            {custosVinculados.map(c=>(
                                              <div key={c.id} style={{fontSize:11,marginBottom:6,paddingBottom:6,borderBottom:'1px solid #dcebe3',cursor:'pointer'}}
                                                onClick={()=>{setTab('custos');setCustosSubTab('notas');setCustosFiltros(f=>({...f,piloto:c.piloto_nome||''}))}}>
                                                <div style={{display:'flex',justifyContent:'space-between'}}>
                                                  <span style={{color:'#0b1210',fontWeight:600}}>{CAT_ICON[c.categoria]||'🧾'} {c.categoria}</span>
                                                  <span style={{color:'#00A86B',fontWeight:700}}>R$ {parseFloat(c.valor||0).toFixed(2)}</span>
                                                </div>
                                                <div style={{color:'#7ba38f',marginTop:2}}>{c.piloto_nome||'—'} · {new Date(c.data).toLocaleDateString('pt-BR')}</div>
                                                {c.observacao && <div style={{color:'#5c7568',marginTop:2,fontStyle:'italic'}}>{c.observacao}</div>}
                                              </div>
                                            ))}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    {/* KML VIEWER */}
                                    {(rel.kml_arquivos?.length > 0 || rel.kml_paths?.length > 0) && (
                                      <div style={{ padding:'0 20px 16px' }}>
                                        <KmlViewer rel={rel} supabase={supabase} />
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )})()}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== DASHBOARD ===== */}
          {tab === 'dashboard' && (() => {
            // ── Filtro de período ──
            const hoje = new Date()
            const periodoRange = () => {
              const ini = new Date()
              if(dashPeriodo==='hoje') { ini.setHours(0,0,0,0); return {ini, fim:new Date()} }
              if(dashPeriodo==='semana') { ini.setDate(ini.getDate()-7); return {ini, fim:new Date()} }
              if(dashPeriodo==='mes') { ini.setDate(1); ini.setHours(0,0,0,0); return {ini, fim:new Date()} }
              if(dashPeriodo==='trimestre') { ini.setMonth(ini.getMonth()-3); return {ini, fim:new Date()} }
              if(dashPeriodo==='ano') { ini.setMonth(0,1); ini.setHours(0,0,0,0); return {ini, fim:new Date()} }
              if(dashPeriodo==='custom' && dashDataIni && dashDataFim) return {ini:new Date(dashDataIni), fim:new Date(dashDataFim+'T23:59:59')}
              ini.setDate(1); ini.setHours(0,0,0,0); return {ini, fim:new Date()}
            }
            const {ini:pIni, fim:pFim} = periodoRange()

            // ── Filtra relatórios ──
            const rel = relatorios.filter(r => {
              if(r.status !== 'finalizado') return false
              if(r.dt_inicio) { const d=new Date(r.dt_inicio); if(d<pIni||d>pFim) return false }
              if(dashClientes.length && !dashClientes.includes(r.cliente)) return false
              if(dashPilotos.length && !dashPilotos.includes(r.piloto_nome)) return false
              if(dashDrones.length && !dashDrones.includes(r.drone)) return false
              if(dashFazendas.length && !dashFazendas.includes(r.fazenda)) return false
              if(dashProdutos.length && !(r.produtos||[]).some(p=>dashProdutos.includes(p.split(' - ')[0]))) return false
              return true
            })
            const relTodos = relatorios.filter(r => r.status==='finalizado')

            // ── Cálculos base ──
            const totalArea = rel.reduce((a,r)=>a+parseFloat(r.area_ha||0),0)
            const totalVoos = rel.length
            const totalMins = rel.reduce((a,r)=>{
              if(!r.dt_inicio||!r.dt_fim) return a
              return a+Math.max(0,Math.round((new Date(r.dt_fim)-new Date(r.dt_inicio))/60000))
            },0)
            const eficiencia = totalMins>0 ? ((totalArea/(totalMins/60))||0).toFixed(1) : 0
            const receita = precoHa>0 ? (totalArea*precoHa).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : null

            // ── Receita estimada por preço cadastrado no cliente (catação/área total) ──
            const clientePorNome = {}
            invClientes.forEach(c=>{ clientePorNome[c.nome]=c })
            let receitaClientes = 0, voosComPreco = 0
            rel.forEach(r=>{
              const cli = clientePorNome[r.cliente]
              if(!cli) return
              const preco = r.tipo_servico==='catacao' ? cli.preco_catacao : r.tipo_servico==='area_total' ? cli.preco_area_total : null
              if(preco>0){ receitaClientes += preco*parseFloat(r.area_ha||0); voosComPreco++ }
            })
            const fmtH = m => { const h=Math.floor(m/60),mn=m%60; return `${h}h${String(mn).padStart(2,'0')}m` }

            // ── Área por dia (últimos 30 dias) ──
            const areaPorDia = {}
            rel.forEach(r => {
              if(!r.dt_inicio) return
              const d = new Date(r.dt_inicio).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
              areaPorDia[d] = (areaPorDia[d]||0) + parseFloat(r.area_ha||0)
            })
            const areaTimeline = Object.entries(areaPorDia).slice(-30).map(([d,a])=>({dia:d,area:parseFloat(a.toFixed(1))}))

            // ── Área por cliente ──
            const areaCliente = {}
            rel.forEach(r => { const c=r.cliente||'—'; areaCliente[c]=(areaCliente[c]||0)+parseFloat(r.area_ha||0) })
            const topClientes = Object.entries(areaCliente).sort((a,b)=>b[1]-a[1]).slice(0,6)
              .map(([name,value])=>({name:name.replace('Raizen - ','R. '),value:parseFloat(value.toFixed(1))}))

            // ── Área por fazenda ──
            const fazendaStats = {}
            rel.forEach(r => {
              const f=r.fazenda||'—'
              if(!fazendaStats[f]) fazendaStats[f]={area:0,voos:0,cliente:r.cliente||'—'}
              fazendaStats[f].area+=parseFloat(r.area_ha||0)
              fazendaStats[f].voos++
            })
            const rankingFazendas = Object.entries(fazendaStats).sort((a,b)=>b[1].area-a[1].area).slice(0,10)
            const fazendasChart = rankingFazendas.slice(0,8).map(([name,s])=>({name:name.length>14?name.slice(0,13)+'…':name,value:parseFloat(s.area.toFixed(1))}))

            // ── Stats pilotos ──
            const pilotoStats = {}
            rel.forEach(r => {
              const n=r.piloto_nome||'—'
              if(!pilotoStats[n]) pilotoStats[n]={voos:0,area:0,minutos:0}
              pilotoStats[n].voos++
              pilotoStats[n].area+=parseFloat(r.area_ha||0)
              if(r.dt_inicio&&r.dt_fim) pilotoStats[n].minutos+=Math.max(0,Math.round((new Date(r.dt_fim)-new Date(r.dt_inicio))/60000))
            })
            const rankingPilotos = Object.entries(pilotoStats).sort((a,b)=>b[1].area-a[1].area).slice(0,8)
            const pilotosChart = rankingPilotos.slice(0,6).map(([name,s])=>({name:name.split(' ')[0],area:parseFloat(s.area.toFixed(1)),voos:s.voos,horas:parseFloat((s.minutos/60).toFixed(1))}))

            // ── Heatmap dias da semana ──
            const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
            const heatStats = [0,1,2,3,4,5,6].map(()=>({voos:0,area:0,horas:0}))
            rel.forEach(r => {
              if(!r.dt_inicio) return
              const st = heatStats[new Date(r.dt_inicio).getDay()]
              st.voos++
              st.area += parseFloat(r.area_ha||0)
              if(r.dt_fim) st.horas += Math.max(0,(new Date(r.dt_fim)-new Date(r.dt_inicio))/3600000)
            })
            const heatData = diasSemana.map((d,i)=>({dia:d, voos:heatStats[i].voos, area:parseFloat(heatStats[i].area.toFixed(1)), horas:parseFloat(heatStats[i].horas.toFixed(1))}))
            const HEAT_METRICA_INFO = { voos:{label:'Voos',unidade:''}, area:{label:'Área',unidade:'ha'}, horas:{label:'Horas',unidade:'h'} }

            // ── Produtos mais usados ──
            const prodUso = {}
            rel.forEach(r => {
              (r.produtos||[]).filter(Boolean).forEach(p => {
                const nome = p.split(' - ')[0]
                prodUso[nome] = (prodUso[nome]||0) + parseFloat(r.area_ha||0)
              })
            })
            const topProdutos = Object.entries(prodUso).sort((a,b)=>b[1]-a[1]).slice(0,6)
              .map(([name,value])=>({name,value:parseFloat(value.toFixed(1))}))

            // ── Horas por drone ──
            const droneStats = {}
            relTodos.forEach(r => {
              const d=r.drone||'—'
              if(!droneStats[d]) droneStats[d]={voos:0,minutos:0}
              droneStats[d].voos++
              if(r.dt_inicio&&r.dt_fim) droneStats[d].minutos+=Math.max(0,Math.round((new Date(r.dt_fim)-new Date(r.dt_inicio))/60000))
            })

            // ── KPIs de topo (sempre "ao vivo" — ano/mês corrente, não seguem os filtros abaixo) ──
            const anoAtual = hoje.getFullYear()
            const areaEsteAno = relTodos.filter(r=>r.dt_inicio && new Date(r.dt_inicio).getFullYear()===anoAtual).reduce((a,r)=>a+parseFloat(r.area_ha||0),0)
            const minutosAno = relTodos.filter(r=>r.dt_inicio && new Date(r.dt_inicio).getFullYear()===anoAtual).reduce((a,r)=>{
              if(!r.dt_inicio||!r.dt_fim) return a
              return a+Math.max(0,Math.round((new Date(r.dt_fim)-new Date(r.dt_inicio))/60000))
            },0)
            const pilotosAtivosAgora = new Set(relatorios.filter(r=>r.status==='em_operacao').map(r=>r.piloto_nome)).size
            const dronesEmManutencao = Object.entries(droneStats).filter(([drone,st])=>{
              const limite = droneHorasLimite[drone]||100
              return (st.minutos/60)/limite >= 0.9
            }).length

            // ── Projeções ──
            const diasDecorridos = Math.max(1,Math.round((new Date()-pIni)/86400000))
            const diasNoMes = new Date(hoje.getFullYear(),hoje.getMonth()+1,0).getDate()
            const ritmoHa = totalArea/diasDecorridos
            const projecaoMes = (ritmoHa*diasNoMes).toFixed(0)
            const diasRestantes = diasNoMes - hoje.getDate()
            const projecaoRestante = (ritmoHa*diasRestantes).toFixed(0)

            // ── Working Days ──
            const workingDaysMes = Math.round(workingDaysAnual / 12)
            const diaUtil = d => { const dia=new Date(d).getDay(); return dia!==0&&dia!==6 } // exclui fim de semana
            const workingDaysDecorridos = Array.from({length:hoje.getDate()},(_,i)=>{
              const d=new Date(hoje.getFullYear(),hoje.getMonth(),i+1); return diaUtil(d)?1:0
            }).reduce((a,b)=>a+b,0)
            const workingDaysRestantes = Array.from({length:diasNoMes-hoje.getDate()},(_,i)=>{
              const d=new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate()+i+1); return diaUtil(d)?1:0
            }).reduce((a,b)=>a+b,0)
            const haPerWorkingDay = workingDaysDecorridos>0 ? totalArea/workingDaysDecorridos : 0
            const projecaoWorkingDay = (haPerWorkingDay*(workingDaysDecorridos+workingDaysRestantes)).toFixed(0)
            const taxaAtingimentoMeta = metaMensalHa>0 ? ((parseFloat(projecaoWorkingDay)/metaMensalHa)*100).toFixed(0) : null

            // ── Forecast Semanal ──
            const semanas = [1,2,3,4].map(s => {
              const iniSem = new Date(hoje.getFullYear(), hoje.getMonth(), 1 + (s-1)*7)
              const fimSem = new Date(hoje.getFullYear(), hoje.getMonth(), Math.min(s*7, diasNoMes))
              const realizado = relTodos.filter(r => {
                if(r.status!=='finalizado'||!r.dt_inicio) return false
                const d=new Date(r.dt_inicio)
                return d>=iniSem && d<=fimSem
              }).reduce((a,r)=>a+parseFloat(r.area_ha||0),0)
              const diasSem = Math.min(s*7,diasNoMes) - (1+(s-1)*7) + 1
              const planejado = metaMensalHa>0 ? (metaMensalHa/4) : (ritmoHa*diasSem)
              const isCurrent = hoje.getDate() >= (1+(s-1)*7) && hoje.getDate() <= Math.min(s*7,diasNoMes)
              const isPast = hoje.getDate() > Math.min(s*7,diasNoMes)
              return { s, label:`Sem ${s}`, iniSem, fimSem, realizado: parseFloat(realizado.toFixed(1)), planejado: parseFloat(planejado.toFixed(1)), isCurrent, isPast }
            })

            // ── Estoque preditivo ──
            const consumoPorHa = {}
            rel.forEach(r => {
              (r.produtos||[]).filter(Boolean).forEach(p => {
                const nome = p.split(' - ')[0]
                const dose = parseFloat(p.split(' - ')[1]||0)
                if(dose>0) consumoPorHa[nome] = ((consumoPorHa[nome]||0) + dose*parseFloat(r.area_ha||0))
              })
            })

            const COLORS = ['#00A86B','#22c476','#ffb020','#2f6fed','#8e44ad','#f2960f','#e5484d','#5c7568']

            const Card = ({title,value,sub,color='#00A86B',icon}) => (
              <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:'18px',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>{title}</div>
                    <div style={{fontSize:isMobile?22:28,fontWeight:700,color,fontFamily:"'Syne',sans-serif",lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{value}</div>
                    {sub&&<div style={{fontSize:11,color:'#7ba38f',marginTop:4}}>{sub}</div>}
                  </div>
                  {icon&&<div style={{width:44,height:44,borderRadius:14,background:color+'1a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{icon}</div>}
                </div>
              </div>
            )

            const SecTitle = ({children,action}) => (
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:'#0b1210'}}>{children}</div>
                {action}
              </div>
            )

            return (
              <div>
                {/* ── Breadcrumb + título ── */}
                <div style={{fontSize:11,color:'#7ba38f',fontWeight:600,marginBottom:4}}>Início / Dashboard</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:'#0b1210',marginBottom:16}}>Visão Geral</div>

                {/* ── RESUMO EXECUTIVO (visão geral ao vivo, independente dos filtros abaixo) ── */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                  <div style={{background:'#fff',borderRadius:16,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:44,height:44,borderRadius:12,background:'#00A86B',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🌱</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',letterSpacing:.3}}>ÁREA PULVERIZADA ESTE ANO</div>
                      <div style={{fontSize:19,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif",fontVariantNumeric:'tabular-nums'}}>{areaEsteAno.toFixed(1)} ha</div>
                    </div>
                  </div>
                  <div style={{background:'#fff',borderRadius:16,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:44,height:44,borderRadius:12,background:'#2f6fed',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>⏱️</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',letterSpacing:.3}}>TOTAL HORAS VOO ANO</div>
                      <div style={{fontSize:19,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif",fontVariantNumeric:'tabular-nums'}}>{fmtH(minutosAno)}</div>
                    </div>
                  </div>
                  <div style={{background:'#fff',borderRadius:16,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:44,height:44,borderRadius:12,background:'#8e44ad',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🧑‍✈️</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',letterSpacing:.3}}>PILOTOS ATIVOS AGORA</div>
                      <div style={{fontSize:19,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif",fontVariantNumeric:'tabular-nums'}}>{pilotosAtivosAgora}</div>
                    </div>
                  </div>
                  <div style={{background:'#fff',borderRadius:16,border:`1px solid ${dronesEmManutencao>0?'#f2960f':'#dcebe3'}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:44,height:44,borderRadius:12,background:dronesEmManutencao>0?'#f2960f':'#5c7568',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🔧</span>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',letterSpacing:.3}}>DRONES EM MANUTENÇÃO</div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{fontSize:19,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{dronesEmManutencao}</div>
                        {dronesEmManutencao>0&&<span style={{background:'#f2960f',color:'#fff',fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:20}}>PRIORIDADE</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── FILTROS ── */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'16px',marginBottom:16}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,marginBottom:12,color:'#0b1210'}}>🔍 Filtros</div>
                  {/* Período */}
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                    {[['hoje','Hoje'],['semana','7 dias'],['mes','Este mês'],['trimestre','Trimestre'],['ano','Este ano'],['custom','Personalizado']].map(([v,l])=>(
                      <button key={v} style={{background:dashPeriodo===v?'#00A86B':'#F4F7F5',color:dashPeriodo===v?'#fff':'#5c7568',border:'none',borderRadius:16,padding:'5px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                        onClick={()=>setDashPeriodo(v)}>{l}</button>
                    ))}
                  </div>
                  {dashPeriodo==='custom'&&(
                    <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                      <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none'}} value={dashDataIni} onChange={e=>setDashDataIni(e.target.value)}/>
                      <span style={{alignSelf:'center',color:'#7ba38f'}}>até</span>
                      <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none'}} value={dashDataFim} onChange={e=>setDashDataFim(e.target.value)}/>
                    </div>
                  )}
                  {/* Multi-select filters */}
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(5,1fr)',gap:8}}>
                    {[
                      ['Clientes',dashClientes,setDashClientes,[...new Set(relatorios.map(r=>r.cliente).filter(Boolean))]],
                      ['Fazendas',dashFazendas,setDashFazendas,[...new Set(relatorios.map(r=>r.fazenda).filter(Boolean))].sort()],
                      ['Pilotos',dashPilotos,setDashPilotos,[...new Set(relatorios.map(r=>r.piloto_nome).filter(Boolean))]],
                      ['Drones',dashDrones,setDashDrones,[...new Set(relatorios.map(r=>r.drone).filter(Boolean))]],
                      ['Produtos',dashProdutos,setDashProdutos,[...new Set(relatorios.flatMap(r=>(r.produtos||[]).map(p=>p.split(' - ')[0])).filter(Boolean))].sort()],
                    ].map(([lbl,sel,setSel,opts])=>(
                      <MultiSelectDropdown key={lbl} label={lbl} options={opts} selected={sel} onChange={setSel}/>
                    ))}
                  </div>
                  {(dashClientes.length||dashPilotos.length||dashDrones.length||dashFazendas.length||dashProdutos.length)>0&&(
                    <button style={{marginTop:8,background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:16,padding:'4px 12px',fontSize:12,cursor:'pointer'}}
                      onClick={()=>{setDashClientes([]);setDashPilotos([]);setDashDrones([]);setDashFazendas([]);setDashProdutos([])}}>✕ Limpar filtros</button>
                  )}
                </div>

                {/* ── KPIs ── */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(5,1fr)',gap:12,marginBottom:16}}>
                  <Card title="ÁREA APLICADA" value={totalArea.toFixed(1)+' ha'} sub={`${totalVoos} voos`} icon="📐"/>
                  <Card title="HORAS VOADAS" value={fmtH(totalMins)} sub={`${eficiencia} ha/h eficiência`} color="#2f6fed" icon="⏱️"/>
                  <Card title="PILOTOS ATIVOS" value={Object.keys(pilotoStats).length} sub="no período" color="#8e44ad" icon="👨‍✈️"/>
                  <Card title="RECEITA (PREÇO CLIENTE)" value={receitaClientes.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} sub={voosComPreco>0?`${voosComPreco} voo(s) com preço cadastrado`:'nenhum cliente com preço cadastrado'} color="#00A86B" icon="💵"/>
                  <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'16px',boxShadow:'0 1px 4px rgba(0,0,0,.04)'}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:8,fontFamily:"'Syne',sans-serif"}}>💰 PREÇO / HA</div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <span style={{fontSize:13,color:'#5c7568',fontWeight:600}}>R$</span>
                      <input
                        type="number"
                        value={precoHa||''}
                        placeholder="0,00"
                        style={{flex:1,border:'1px solid #d7e6dc',borderRadius:8,padding:'6px 10px',fontSize:18,fontWeight:700,color:'#f2960f',outline:'none',textAlign:'right',width:'100%'}}
                        onChange={e=>{
                          const v=parseFloat(e.target.value)||0
                          setPrecoHa(v)
                          localStorage.setItem('orofly_preco_ha',v)
                        }}/>
                    </div>
                    {precoHa>0
                      ? <div style={{fontSize:11,color:'#00A86B',fontWeight:600}}>= {(totalArea*precoHa).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div>
                      : <div style={{fontSize:10,color:'#7ba38f'}}>Digite o valor por hectare</div>
                    }
                  </div>
                </div>

                {/* ── KPIs SECUNDÁRIOS ── */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                  <Card title="PROJEÇÃO MÊS" value={projecaoMes+' ha'} sub={`+${projecaoRestante} ha previstos`} color="#22c476" icon="📈"/>
                  <Card title="MÉDIA DIÁRIA" value={ritmoHa.toFixed(1)+' ha/dia'} sub="no período" color="#2f6fed" icon="📅"/>
                  <Card title="MÉDIA POR VOO" value={totalVoos>0?(totalArea/totalVoos).toFixed(1)+' ha':'—'} sub="eficiência/voo" color="#f2960f" icon="✈️"/>
                  <Card title="DRONES EM USO" value={Object.keys(droneStats).length} sub={`${relatorios.filter(r=>r.status==='em_operacao').length} voando agora`} color="#e5484d" icon="🚁"/>
                </div>


                {/* ── GRÁFICO TIMELINE ── */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'20px',marginBottom:16}}>
                  <SecTitle>📈 Área Aplicada ao Longo do Tempo (ha)</SecTitle>
                  {areaTimeline.length===0 ? <div style={{color:'#7ba38f',fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem dados no período</div> : (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={areaTimeline} margin={{top:5,right:10,left:-20,bottom:5}}>
                        <defs>
                          <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00A86B" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00A86B" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                        <XAxis dataKey="dia" tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false}/>
                        <YAxis tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false} axisLine={false}/>
                        <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}} formatter={(v)=>[v+' ha','Área']}/>
                        <Area type="monotone" dataKey="area" stroke="#00A86B" strokeWidth={2} fill="url(#gradArea)"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* ── GRÁFICOS CLIENTES + PRODUTOS ── */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16,marginBottom:16}}>
                  <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'20px'}}>
                    <SecTitle>🏢 Área por Cliente (ha)</SecTitle>
                    {topClientes.length===0 ? <div style={{color:'#7ba38f',fontSize:13}}>Sem dados</div> : (
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={topClientes} layout="vertical" margin={{top:0,right:10,left:10,bottom:0}}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0" horizontal={false}/>
                          <XAxis type="number" tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false} axisLine={false}/>
                          <YAxis dataKey="name" type="category" tick={{fontSize:10,fill:'#5c7568'}} tickLine={false} width={70}/>
                          <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}} formatter={(v)=>[v+' ha','Área']}/>
                          <Bar dataKey="value" fill="#00A86B" radius={[0,6,6,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'20px'}}>
                    <SecTitle>🧪 Produtos Mais Aplicados (ha)</SecTitle>
                    {topProdutos.length===0 ? <div style={{color:'#7ba38f',fontSize:13}}>Sem dados</div> : (() => {
                      const totalProdutos = topProdutos.reduce((a,p)=>a+p.value,0)
                      return (
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie data={topProdutos} cx="50%" cy="50%" outerRadius={75} dataKey="value" nameKey="name" label={({value})=>`${value} ha`} labelLine={false} fontSize={9}>
                              {topProdutos.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                            </Pie>
                            <Tooltip formatter={(value,name)=>[`${totalProdutos>0?((value/totalProdutos)*100).toFixed(0):0}%`,name]}/>
                          </PieChart>
                        </ResponsiveContainer>
                      )
                    })()}
                  </div>
                </div>

                {/* ── RANKING FAZENDAS ── */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'20px',marginBottom:16}}>
                  <SecTitle>🌾 Área por Fazenda</SecTitle>
                  {rankingFazendas.length===0 ? <div style={{color:'#7ba38f',fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem dados no período</div> : (
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={fazendasChart} layout="vertical" margin={{top:0,right:10,left:10,bottom:0}}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0" horizontal={false}/>
                          <XAxis type="number" tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false} axisLine={false}/>
                          <YAxis dataKey="name" type="category" tick={{fontSize:10,fill:'#5c7568'}} tickLine={false} width={90}/>
                          <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}} formatter={(v)=>[v+' ha','Área']}/>
                          <Bar dataKey="value" fill="#00A86B" radius={[0,6,6,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                      <div style={{overflowX:'auto'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                          <thead>
                            <tr style={{background:'#F4F7F5'}}>
                              {['#','Fazenda','Cliente','Voos','ha','% total'].map(h=>(
                                <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rankingFazendas.map(([nome,s],i)=>(
                              <tr key={nome} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                                <td style={{padding:'8px 10px',fontWeight:700,color:i===0?'#ffb020':i===1?'#aaa':i===2?'#cd7f32':'#7ba38f'}}>
                                  {i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}º`}
                                </td>
                                <td style={{padding:'8px 10px',fontWeight:500}}>{nome}</td>
                                <td style={{padding:'8px 10px',color:'#5c7568'}}>{s.cliente}</td>
                                <td style={{padding:'8px 10px',color:'#5c7568'}}>{s.voos}</td>
                                <td style={{padding:'8px 10px',fontWeight:700,color:'#00A86B'}}>{s.area.toFixed(1)}</td>
                                <td style={{padding:'8px 10px',color:'#5c7568'}}>{totalArea>0?((s.area/totalArea)*100).toFixed(0):0}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── RANKING PILOTOS ── */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'20px',marginBottom:16}}>
                  <SecTitle>🏆 Performance de Pilotos</SecTitle>
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:10,fontFamily:"'Syne',sans-serif"}}>ÁREA VOADA (ha)</div>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={pilotosChart} margin={{top:0,right:0,left:-30,bottom:0}}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                          <XAxis dataKey="name" tick={{fontSize:10,fill:'#5c7568'}} tickLine={false}/>
                          <YAxis tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false} axisLine={false}/>
                          <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}} formatter={(v)=>[v+' ha','Área']}/>
                          <Bar dataKey="area" radius={[6,6,0,0]}>
                            {pilotosChart.map((_,i)=><Cell key={i} fill={i===0?'#ffb020':i===1?'#aaa':i===2?'#cd7f32':COLORS[0]}/>)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                        <thead>
                          <tr style={{background:'#F4F7F5'}}>
                            {['#','Piloto','Voos','ha','ha/h'].map(h=>(
                              <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rankingPilotos.map(([nome,st],i)=>(
                            <tr key={nome} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                              <td style={{padding:'8px 10px',fontWeight:700,color:i===0?'#ffb020':i===1?'#aaa':i===2?'#cd7f32':'#7ba38f'}}>
                                {i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}º`}
                              </td>
                              <td style={{padding:'8px 10px',fontWeight:500}}>{nome}</td>
                              <td style={{padding:'8px 10px',color:'#5c7568'}}>{st.voos}</td>
                              <td style={{padding:'8px 10px',fontWeight:700,color:'#00A86B'}}>{st.area.toFixed(1)}</td>
                              <td style={{padding:'8px 10px',color:'#5c7568'}}>{st.minutos>0?(st.area/(st.minutos/60)).toFixed(1):'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* ── HEATMAP DIAS DA SEMANA ── */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'20px',marginBottom:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:4}}>
                    <SecTitle>📅 Produtividade por Dia da Semana</SecTitle>
                    <div style={{display:'flex',gap:6}}>
                      {Object.entries(HEAT_METRICA_INFO).map(([key,info])=>(
                        <button key={key} style={{background:heatMetrica===key?'#00A86B':'#F4F7F5',color:heatMetrica===key?'#fff':'#5c7568',border:'none',borderRadius:14,padding:'5px 12px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                          onClick={()=>setHeatMetrica(key)}>{info.label}</button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={heatData} margin={{top:5,right:10,left:-30,bottom:5}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                      <XAxis dataKey="dia" tick={{fontSize:11,fill:'#5c7568'}} tickLine={false}/>
                      <YAxis tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false} axisLine={false}/>
                      <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}} formatter={(v)=>[`${v}${HEAT_METRICA_INFO[heatMetrica].unidade?' '+HEAT_METRICA_INFO[heatMetrica].unidade:''}`,HEAT_METRICA_INFO[heatMetrica].label]}/>
                      <Bar dataKey={heatMetrica} radius={[6,6,0,0]}>
                        {heatData.map((entry,i)=><Cell key={i} fill={entry[heatMetrica]===Math.max(...heatData.map(d=>d[heatMetrica]))?'#ffb020':'#00A86B'}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{fontSize:11,color:'#7ba38f',textAlign:'center',marginTop:4}}>⭐ Dia mais produtivo: {heatData.reduce((a,b)=>a[heatMetrica]>b[heatMetrica]?a:b,{[heatMetrica]:0,dia:'—'}).dia}</div>
                </div>

                {/* ── DRONES + MANUTENÇÃO ── */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'20px',marginBottom:16}}>
                  <SecTitle>🚁 Controle de Horas por Drone</SecTitle>
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    {Object.entries(droneStats).sort((a,b)=>b[1].minutos-a[1].minutos).map(([drone,st])=>{
                      const horas=st.minutos/60
                      const limite=droneHorasLimite[drone]||100
                      const pct=Math.min(100,(horas/limite)*100)
                      const alerta=pct>=90, aviso=pct>=70&&pct<90
                      const cor=alerta?'#e5484d':aviso?'#f2960f':'#00A86B'
                      // Previsão de quando vai bater o limite
                      const horasPorVoo = st.voos>0 ? horas/st.voos : 0
                      const voosRestantes = horasPorVoo>0 ? Math.floor((limite-horas)/horasPorVoo) : null
                      return (
                        <div key={drone} style={{background:alerta?'#fdeaea':aviso?'#fdf3e0':'#f7fbf8',borderRadius:10,padding:'12px 14px',border:`1px solid ${alerta?'#f5c6c6':aviso?'#f5e0a0':'#dcebe3'}`}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexWrap:'wrap',gap:6}}>
                            <div>
                              <span style={{fontWeight:600,fontSize:14}}>{drone}</span>
                              {alerta&&<span style={{marginLeft:8,background:'#e5484d',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ MANUTENÇÃO</span>}
                              {aviso&&!alerta&&<span style={{marginLeft:8,background:'#f2960f',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚡ ATENÇÃO</span>}
                              {voosRestantes!==null&&!alerta&&<span style={{marginLeft:8,fontSize:11,color:'#7ba38f'}}>~{voosRestantes} voos para manutenção</span>}
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{fontWeight:700,color:cor}}>{fmtH(st.minutos)}</span>
                              <span style={{color:'#7ba38f',fontSize:12}}>/</span>
                              <input type="number" value={limite} min={1} style={{width:60,border:'1px solid #d7e6dc',borderRadius:6,padding:'3px 6px',fontSize:12,textAlign:'center',outline:'none'}}
                                onChange={e=>{const n={...droneHorasLimite,[drone]:parseInt(e.target.value)||100};setDroneHorasLimite(n);localStorage.setItem('orofly_drone_horas',JSON.stringify(n))}}/>
                              <span style={{fontSize:11,color:'#7ba38f'}}>h</span>
                            </div>
                          </div>
                          <div style={{background:'#e0e0e0',borderRadius:20,height:8,overflow:'hidden'}}>
                            <div style={{background:`linear-gradient(90deg,${cor},${cor}bb)`,height:'100%',borderRadius:20,width:`${pct}%`,transition:'width .5s'}}/>
                          </div>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#7ba38f',marginTop:4}}>
                            <span>{st.voos} voos registrados</span>
                            <span>{pct.toFixed(0)}% do limite</span>
                          </div>
                        </div>
                      )
                    })}
                    {Object.keys(droneStats).length===0&&<div style={{color:'#7ba38f',fontSize:13}}>Nenhum dado de drone ainda</div>}
                  </div>
                </div>

                {/* ── WORKING DAYS + FORECAST SEMANAL ── */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'20px',marginBottom:16}}>
                  <SecTitle>📅 Working Days &amp; Forecast Mensal</SecTitle>

                  {/* Config */}
                  <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16,padding:'12px',background:'#F4F7F5',borderRadius:10}}>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <label style={{fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>DIAS ÚTEIS/ANO</label>
                      <input type="number" value={workingDaysAnual} style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'6px 10px',fontSize:13,width:80,outline:'none',textAlign:'center'}}
                        onChange={e=>{const v=parseInt(e.target.value)||144;setWorkingDaysAnual(v);localStorage.setItem('orofly_working_days',v)}}/>
                      <span style={{fontSize:10,color:'#7ba38f'}}>≈ {workingDaysMes} dias/mês</span>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <label style={{fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>META MENSAL (ha)</label>
                      <input type="number" value={metaMensalHa||''} placeholder="Ex: 5000" style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'6px 10px',fontSize:13,width:100,outline:'none',textAlign:'center'}}
                        onChange={e=>{const v=parseFloat(e.target.value)||0;setMetaMensalHa(v);localStorage.setItem('orofly_meta_mensal',v)}}/>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:4,justifyContent:'flex-end'}}>
                      <div style={{fontSize:12,color:'#5c7568'}}>Working days decorridos: <strong style={{color:'#00A86B'}}>{workingDaysDecorridos}</strong></div>
                      <div style={{fontSize:12,color:'#5c7568'}}>Working days restantes: <strong style={{color:'#2f6fed'}}>{workingDaysRestantes}</strong></div>
                      <div style={{fontSize:12,color:'#5c7568'}}>ha/dia útil: <strong style={{color:'#00A86B'}}>{haPerWorkingDay.toFixed(1)}</strong></div>
                    </div>
                    {taxaAtingimentoMeta && (
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,marginLeft:'auto'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>PREVISÃO META</div>
                        <div style={{fontSize:28,fontWeight:700,color:parseInt(taxaAtingimentoMeta)>=100?'#00A86B':parseInt(taxaAtingimentoMeta)>=70?'#f2960f':'#e5484d',fontFamily:"'Syne',sans-serif"}}>{taxaAtingimentoMeta}%</div>
                        <div style={{fontSize:10,color:'#7ba38f'}}>{projecaoWorkingDay} / {metaMensalHa} ha</div>
                      </div>
                    )}
                  </div>

                  {/* Tabela semanal */}
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',minWidth:400}}>
                      <thead>
                        <tr style={{background:'#F4F7F5'}}>
                          {['Semana','Período','Realizado (ha)','Planejado (ha)','% Meta','Status'].map(h=>(
                            <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif",whiteSpace:'nowrap'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {semanas.map(({s,label,iniSem,fimSem,realizado,planejado,isCurrent,isPast})=>{
                          const pct = planejado>0 ? ((realizado/planejado)*100).toFixed(0) : '—'
                          const pctNum = parseInt(pct)
                          const corPct = pctNum>=100?'#00A86B':pctNum>=70?'#f2960f':'#e5484d'
                          const fmtSemData = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
                          return (
                            <tr key={s} style={{background:isCurrent?'#e3f7ec':s%2===0?'#f7fbf8':'#fff',fontWeight:isCurrent?600:400}}>
                              <td style={{padding:'9px 10px',fontSize:13}}>
                                <span style={{background:isCurrent?'#00A86B':isPast?'#d7e6dc':'#F4F7F5',color:isCurrent?'#fff':isPast?'#5c7568':'#7ba38f',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700}}>{label}</span>
                                {isCurrent&&<span style={{marginLeft:6,fontSize:10,color:'#00A86B'}}>← atual</span>}
                              </td>
                              <td style={{padding:'9px 10px',fontSize:12,color:'#5c7568'}}>{fmtSemData(iniSem)} – {fmtSemData(fimSem)}</td>
                              <td style={{padding:'9px 10px',fontSize:14,fontWeight:700,color:isPast||isCurrent?'#0b1210':'#aaa'}}>
                                {isPast||isCurrent ? realizado : <span style={{color:'#ccc'}}>—</span>}
                              </td>
                              <td style={{padding:'9px 10px',fontSize:13,color:'#5c7568'}}>{planejado}</td>
                              <td style={{padding:'9px 10px'}}>
                                {(isPast||isCurrent)&&pct!=='—'&&(
                                  <div>
                                    <div style={{fontSize:13,fontWeight:700,color:corPct}}>{pct}%</div>
                                    <div style={{background:'#f0f0f0',borderRadius:20,height:5,marginTop:3,overflow:'hidden',width:60}}>
                                      <div style={{background:corPct,height:'100%',borderRadius:20,width:`${Math.min(100,parseInt(pct)||0)}%`}}/>
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td style={{padding:'9px 10px',fontSize:12}}>
                                {isCurrent ? '🟢 Em andamento' : isPast ? (pctNum>=100?'✅ Meta atingida':'⚠️ Abaixo da meta') : '⏳ Aguardando'}
                              </td>
                            </tr>
                          )
                        })}
                        {/* Total */}
                        <tr style={{background:'#F4F7F5',fontWeight:700,borderTop:'2px solid #d7e6dc'}}>
                          <td colSpan={2} style={{padding:'10px',fontSize:12,fontFamily:"'Syne',sans-serif",color:'#0b1210'}}>TOTAL DO MÊS</td>
                          <td style={{padding:'10px',fontSize:14,color:'#00A86B'}}>{totalArea.toFixed(1)}</td>
                          <td style={{padding:'10px',fontSize:13,color:'#5c7568'}}>{metaMensalHa||projecaoMes}</td>
                          <td colSpan={2} style={{padding:'10px',fontSize:13,color:taxaAtingimentoMeta&&parseInt(taxaAtingimentoMeta)>=100?'#00A86B':'#f2960f'}}>
                            {taxaAtingimentoMeta ? `Previsão: ${taxaAtingimentoMeta}% da meta` : `Projeção: ${projecaoMes} ha`}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── ANÁLISE PREDITIVA ── */}
                <div style={{background:'linear-gradient(135deg,#0b1210,#00A86B)',borderRadius:14,padding:'20px',marginBottom:16,color:'#fff'}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,marginBottom:14}}>🔮 Análise Preditiva</div>
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12}}>
                    <div style={{background:'rgba(255,255,255,.08)',borderRadius:10,padding:14}}>
                      <div style={{fontSize:11,opacity:.7,marginBottom:4}}>PROJEÇÃO DO MÊS ATUAL</div>
                      <div style={{fontSize:24,fontWeight:700,color:'#ffb020'}}>{projecaoMes} ha</div>
                      <div style={{fontSize:11,opacity:.7,marginTop:4}}>Faltam {diasRestantes} dias • +{projecaoRestante} ha previstos</div>
                    </div>
                    <div style={{background:'rgba(255,255,255,.08)',borderRadius:10,padding:14}}>
                      <div style={{fontSize:11,opacity:.7,marginBottom:4}}>RITMO ATUAL</div>
                      <div style={{fontSize:24,fontWeight:700,color:'#ffb020'}}>{ritmoHa.toFixed(1)} ha/dia</div>
                      <div style={{fontSize:11,opacity:.7,marginTop:4}}>Média dos últimos {diasDecorridos} dias</div>
                    </div>
                    {/* Alertas preditivos */}
                    {Object.entries(droneStats).map(([drone,st])=>{
                      const horas=st.minutos/60
                      const limite=droneHorasLimite[drone]||100
                      const horasPorVoo=st.voos>0?horas/st.voos:0
                      const voosRestantes=horasPorVoo>0?Math.floor((limite-horas)/horasPorVoo):null
                      if(voosRestantes!==null&&voosRestantes<=5&&voosRestantes>=0) return (
                        <div key={drone} style={{background:'rgba(192,57,43,.3)',borderRadius:10,padding:14,border:'1px solid rgba(192,57,43,.5)'}}>
                          <div style={{fontSize:11,opacity:.8,marginBottom:4}}>⚠️ MANUTENÇÃO PRÓXIMA</div>
                          <div style={{fontSize:16,fontWeight:700}}>{drone}</div>
                          <div style={{fontSize:12,opacity:.8,marginTop:4}}>{voosRestantes===0?'Limite atingido!':voosRestantes<=2?`Apenas ${voosRestantes} voo(s) restantes!`:`~${voosRestantes} voos até manutenção`}</div>
                        </div>
                      )
                      return null
                    }).filter(Boolean)}
                    {/* Estoque crítico */}
                    {invProdutos.filter(p=>p.estoque_minimo>0&&p.estoque_atual<=p.estoque_minimo).map(p=>(
                      <div key={p.id} style={{background:'rgba(240,192,64,.2)',borderRadius:10,padding:14,border:'1px solid rgba(240,192,64,.4)'}}>
                        <div style={{fontSize:11,opacity:.8,marginBottom:4}}>📦 ESTOQUE CRÍTICO</div>
                        <div style={{fontSize:16,fontWeight:700}}>{p.nome}</div>
                        <div style={{fontSize:12,opacity:.8,marginTop:4}}>{p.estoque_atual} {p.unidade} restantes (mín: {p.estoque_minimo})</div>
                      </div>
                    ))}
                    {/* Manutenção de veículos próxima */}
                    {veiculos.filter(v=>{
                      const alertaKm = v.proxima_manutencao_km && v.km_atual >= (v.proxima_manutencao_km - 500)
                      const alertaData = v.proxima_manutencao_data && new Date(v.proxima_manutencao_data) <= new Date(Date.now()+7*86400000)
                      return alertaKm || alertaData
                    }).map(v=>(
                      <div key={v.id} style={{background:'rgba(192,57,43,.3)',borderRadius:10,padding:14,border:'1px solid rgba(192,57,43,.5)'}}>
                        <div style={{fontSize:11,opacity:.8,marginBottom:4}}>🚗 MANUTENÇÃO DE VEÍCULO</div>
                        <div style={{fontSize:16,fontWeight:700}}>{v.placa}</div>
                        <div style={{fontSize:12,opacity:.8,marginTop:4}}>
                          {v.proxima_manutencao_km?`${(v.proxima_manutencao_km-v.km_atual).toFixed(0)} km restantes`:''}
                          {v.proxima_manutencao_km&&v.proxima_manutencao_data?' · ':''}
                          {v.proxima_manutencao_data?new Date(v.proxima_manutencao_data).toLocaleDateString('pt-BR'):''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )
          })()}



          {/* ===== SUSTENTABILIDADE ===== */}
          {tab === 'sustentabilidade' && (() => {
            const periodoRange = () => {
              const ini = new Date()
              if(sustPeriodo==='mes'){ ini.setDate(1); ini.setHours(0,0,0,0); return {ini,fim:new Date()} }
              if(sustPeriodo==='trimestre'){ ini.setMonth(ini.getMonth()-3); return {ini,fim:new Date()} }
              if(sustPeriodo==='ano'){ ini.setMonth(0,1); ini.setHours(0,0,0,0); return {ini,fim:new Date()} }
              if(sustPeriodo==='custom' && sustDataIni && sustDataFim) return {ini:new Date(sustDataIni), fim:new Date(sustDataFim+'T23:59:59')}
              ini.setMonth(0,1); ini.setHours(0,0,0,0); return {ini,fim:new Date()}
            }
            const {ini:pIni, fim:pFim} = periodoRange()
            const relPeriodo = relatorios.filter(r=>r.status==='finalizado'&&r.dt_inicio&&new Date(r.dt_inicio)>=pIni&&new Date(r.dt_inicio)<=pFim)
            const areaTotalSust = relPeriodo.reduce((a,r)=>a+parseFloat(r.area_ha||0),0)

            const combustivelAviacao = areaTotalSust*sustAviacaoLha
            const combustivelTerrestre = areaTotalSust*sustTerrestreLha
            const combustivelDrone = areaTotalSust*sustDroneLha
            const combustivelEvitado = Math.max(0,combustivelAviacao-combustivelDrone)
            const co2EvitadoKg = combustivelEvitado*sustAviacaoFator
            const co2EvitadoTon = co2EvitadoKg/1000
            const co2TerrestreKg = Math.max(0,combustivelTerrestre-combustivelDrone)*sustTerrestreFator

            // Equivalências ilustrativas (referências públicas aproximadas — não são medições da operação)
            const arvoresEquivalentes = Math.round(co2EvitadoKg/21)
            const kmCarroEquivalentes = Math.round(co2EvitadoKg/0.12)

            // Série mensal pra gráfico
            const porMes = {}
            relPeriodo.forEach(r=>{
              const d = new Date(r.dt_inicio)
              const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
              if(!porMes[key]) porMes[key]={key,label:d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}),area:0}
              porMes[key].area += parseFloat(r.area_ha||0)
            })
            const serieMensal = Object.values(porMes).sort((a,b)=>a.key.localeCompare(b.key)).map(m=>({
              mes:m.label,
              co2: parseFloat((m.area*Math.max(0,sustAviacaoLha-sustDroneLha)*sustAviacaoFator).toFixed(0))
            }))

            const comparativo = [
              {name:'Avião Agrícola', lha: sustAviacaoLha},
              {name:'Pulverização Terrestre', lha: sustTerrestreLha},
              {name:'Drone Orofly', lha: sustDroneLha},
            ]

            const KpiCard = ({title,value,sub,color='#00A86B',icon}) => (
              <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:'18px',boxShadow:'0 1px 4px rgba(0,0,0,.04)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:'#7ba38f',letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>{title}</div>
                    <div style={{fontSize:isMobile?20:24,fontWeight:700,color,fontFamily:"'Syne',sans-serif",lineHeight:1.1}}>{value}</div>
                    {sub&&<div style={{fontSize:11,color:'#7ba38f',marginTop:4}}>{sub}</div>}
                  </div>
                  {icon&&<div style={{width:40,height:40,borderRadius:12,background:color+'1a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{icon}</div>}
                </div>
              </div>
            )

            return (
              <div>
                {/* HERO */}
                <div style={{background:'linear-gradient(135deg,#0b1210,#00A86B)',borderRadius:20,padding:isMobile?'22px 18px':'28px 26px',marginBottom:20,color:'#fff',position:'relative',overflow:'hidden'}}>
                  <div style={{position:'absolute',top:-40,right:-30,width:180,height:180,borderRadius:'50%',background:'rgba(255,255,255,0.07)'}}/>
                  <div style={{position:'absolute',bottom:-30,left:-20,width:120,height:120,borderRadius:'50%',background:'rgba(255,176,32,0.12)'}}/>
                  <div style={{position:'relative'}}>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:1.5,opacity:.8,marginBottom:8}}>🌱 RELATÓRIO DE SUSTENTABILIDADE</div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?24:34,fontWeight:700,marginBottom:10,lineHeight:1.1}}>{co2EvitadoTon.toFixed(1)} toneladas de CO₂ evitadas</div>
                    <div style={{fontSize:13,opacity:.85,maxWidth:600}}>Comparando a aplicação por drone com a alternativa em aviação agrícola tripulada, para a área pulverizada no período selecionado — {areaTotalSust.toFixed(0)} ha.</div>
                  </div>
                </div>

                {/* Filtro de período */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:16,marginBottom:16}}>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {[['mes','Este mês'],['trimestre','Trimestre'],['ano','Este ano'],['custom','Personalizado']].map(([v,l])=>(
                      <button key={v} style={{background:sustPeriodo===v?'#00A86B':'#F4F7F5',color:sustPeriodo===v?'#fff':'#5c7568',border:'none',borderRadius:16,padding:'6px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                        onClick={()=>setSustPeriodo(v)}>{l}</button>
                    ))}
                  </div>
                  {sustPeriodo==='custom' && (
                    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                      <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none'}} value={sustDataIni} onChange={e=>setSustDataIni(e.target.value)}/>
                      <span style={{alignSelf:'center',color:'#7ba38f'}}>até</span>
                      <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none'}} value={sustDataFim} onChange={e=>setSustDataFim(e.target.value)}/>
                    </div>
                  )}
                </div>

                {/* KPIs */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                  <KpiCard title="ÁREA PULVERIZADA" value={areaTotalSust.toFixed(1)+' ha'} sub={`${relPeriodo.length} voo(s) no período`} icon="📐"/>
                  <KpiCard title="COMBUSTÍVEL EVITADO" value={combustivelEvitado.toFixed(0)+' L'} sub="vs. avião agrícola" color="#2f6fed" icon="⛽"/>
                  <KpiCard title="CO₂ EVITADO" value={co2EvitadoTon.toFixed(1)+' t'} sub={`${co2EvitadoKg.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg`} color="#00A86B" icon="🌍"/>
                  <KpiCard title="EQUIVALE A" value={arvoresEquivalentes.toLocaleString('pt-BR')+' árvores'} sub={`ou ${kmCarroEquivalentes.toLocaleString('pt-BR')} km de carro`} color="#ffb020" icon="🌳"/>
                </div>

                {/* Comparativo de consumo por hectare */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:20,marginBottom:16}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:'#0b1210',marginBottom:14}}>⛽ Consumo de Combustível por Hectare — Comparativo</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={comparativo} layout="vertical" margin={{top:0,right:30,left:10,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0" horizontal={false}/>
                      <XAxis type="number" tick={{fontSize:10,fill:'#7ba38f'}} unit=" L/ha"/>
                      <YAxis type="category" dataKey="name" width={150} tick={{fontSize:12,fill:'#5c7568'}}/>
                      <Tooltip formatter={v=>[v+' L/ha','Consumo']}/>
                      <Bar dataKey="lha" radius={[0,6,6,0]}>
                        {comparativo.map((c,i)=><Cell key={i} fill={i===0?'#e5484d':i===1?'#f2960f':'#00A86B'}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Evolução mensal de CO2 evitado */}
                {serieMensal.length>0 && (
                  <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:20,marginBottom:16}}>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:'#0b1210',marginBottom:14}}>📈 CO₂ Evitado ao Longo do Tempo (kg)</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={serieMensal} margin={{top:5,right:10,left:-20,bottom:5}}>
                        <defs>
                          <linearGradient id="gradCo2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00A86B" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00A86B" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                        <XAxis dataKey="mes" tick={{fontSize:10,fill:'#7ba38f'}}/>
                        <YAxis tick={{fontSize:10,fill:'#7ba38f'}}/>
                        <Tooltip formatter={v=>[v+' kg','CO₂ evitado']}/>
                        <Area type="monotone" dataKey="co2" stroke="#00A86B" strokeWidth={2} fill="url(#gradCo2)"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Comparativo secundário: pulverização terrestre */}
                <div style={{background:'#F4F7F5',borderRadius:14,padding:16,marginBottom:16,fontSize:12,color:'#5c7568'}}>
                  Para referência: comparado à <strong>pulverização terrestre</strong> (não à aviação), o drone evitaria aproximadamente <strong style={{color:'#00A86B'}}>{co2TerrestreKg.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg de CO₂</strong> no mesmo período — a pulverização terrestre já é bem mais eficiente que o avião, então essa comparação tende a ser mais conservadora.
                </div>

                {/* Premissas / metodologia (editável) */}
                <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:20,marginBottom:16}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:'#0b1210',marginBottom:6}}>⚙️ Premissas do Cálculo (ajustáveis)</div>
                  <div style={{fontSize:12,color:'#5c7568',marginBottom:14}}>Valores de referência do setor — ajuste se tiver dados mais precisos da sua operação ou de um parecer técnico.</div>
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)',gap:14}}>
                    {[
                      ['Avião agrícola (L/ha)', sustAviacaoLha, setSustAviacaoLha, 'orofly_sust_aviacao_lha'],
                      ['Fator CO₂ aviação (kg/L)', sustAviacaoFator, setSustAviacaoFator, 'orofly_sust_aviacao_fator'],
                      ['Pulverização terrestre (L/ha)', sustTerrestreLha, setSustTerrestreLha, 'orofly_sust_terrestre_lha'],
                      ['Fator CO₂ diesel (kg/L)', sustTerrestreFator, setSustTerrestreFator, 'orofly_sust_terrestre_fator'],
                      ['Combustível drone/gerador (L/ha)', sustDroneLha, setSustDroneLha, 'orofly_sust_drone_lha'],
                    ].map(([lbl,val,setVal,key])=>(
                      <div key={key}>
                        <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:4}}>{lbl.toUpperCase()}</div>
                        <input type="number" step="0.01" style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                          value={val} onChange={e=>{const v=parseFloat(e.target.value)||0;setVal(v);localStorage.setItem(key,v)}}/>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:'#aaa',marginTop:14,lineHeight:1.5}}>
                    * Estimativas baseadas em referências públicas de consumo de combustível em aviação agrícola e pulverização terrestre, e em fatores de emissão usuais de diesel/gasolina de aviação. Recomendamos validar os valores com um parecer técnico/ambiental antes de usar em material oficial de certificação (ex: relatórios ESG, Bonsucro, RenovaBio).
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ===== MAPA ===== */}
          {tab === 'mapa' && (
            <div>
              <div style={{ marginBottom:18, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                <div>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>🗺️ Mapa de Voos</div>
                  <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>{filtered.filter(r=>r.gps_lat).length} voos com GPS · atualiza a cada 30s</div>
                </div>
              </div>

              <div style={{display:'flex',gap:8,marginBottom:16}}>
                {[['voos','✈️ Voos'],['operacoes','📍 Operações']].map(([id,lbl])=>(
                  <button key={id} style={{background:mapaSubTab===id?'#00A86B':'#F4F7F5',color:mapaSubTab===id?'#fff':'#5c7568',border:'none',borderRadius:16,padding:'7px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                    onClick={()=>setMapaSubTab(id)}>{lbl}</button>
                ))}
              </div>

              {mapaSubTab==='operacoes' && (
                <div>
                  <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:'10px 14px',marginBottom:14,fontSize:12,color:'#5c7568'}}>
                    Mostra onde os pilotos logaram (azul) e onde iniciaram voos (verde), com um raio de 10km em cada ponto — círculos sobrepostos indicam áreas de operação concentrada.
                  </div>
                  <MapaOperacoes logins={gpsLogins} voos={relatorios.filter(r=>r.gps_lat)} height={isMobile?300:520}/>
                </div>
              )}

              {mapaSubTab==='voos' && (<>
              {sosAtivos.length > 0 && (
                <div style={{ background:'#fdeaea', border:'2px solid #e5484d', borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#e5484d', marginBottom:8 }}>🆘 SOS ATIVOS</div>
                  {sosAtivos.map(r => (
                    <div key={r.id} style={{ fontSize:13, display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingBottom:8, borderBottom:'1px solid #f5c6c6' }}>
                      <div>
                        <div style={{ fontWeight:600 }}>{r.piloto_nome} — {r.obs1}</div>
                        {r.gps_lat && <a href={`https://maps.google.com/?q=${r.gps_lat},${r.gps_lng}`} target="_blank" rel="noreferrer" style={{ color:'#e5484d', fontWeight:600, fontSize:12 }}>📍 Abrir no Maps</a>}
                      </div>
                      <button style={{ background:'#00A86B', color:'#fff', border:'none', borderRadius:16, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', marginLeft:12 }} onClick={() => resolverSOS(r)}>✅ Resolver</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, background:'#fff', padding:12, borderRadius:12, border:'1px solid #d7e6dc', alignItems:'center' }}>
                {[['Cliente','cliente'],['Piloto','piloto'],['Drone','drone']].map(([ph,k]) => (
                  <input key={k} style={sG.fi} placeholder={`🔍 ${ph}...`} value={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.value }))} />
                ))}
                <select style={sG.fi} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                  <option value="">Todos status</option>
                  <option value="em_operacao">🟢 Em operação</option>
                  <option value="pausado">🟡 Pausado</option>
                  <option value="finalizado">✅ Finalizado</option>
                  <option value="sos">🆘 SOS Ativo</option>
                  <option value="sos_resolvido">✅ SOS Resolvido</option>
                  <option value="rascunho">Rascunho</option>
                </select>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:'#5c7568', whiteSpace:'nowrap' }}>De:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataIni} onChange={e => setFilters(f => ({ ...f, dataIni: e.target.value }))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:'#5c7568', whiteSpace:'nowrap' }}>Até:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataFim} onChange={e => setFilters(f => ({ ...f, dataFim: e.target.value }))} />
                </div>
                {Object.values(filters).some(Boolean) && (
                  <button style={{ background:'none', border:'1px solid #e0b0a8', color:'#e5484d', borderRadius:16, padding:'7px 12px', fontSize:12, cursor:'pointer' }} onClick={() => setFilters({ cliente:'', fazenda:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })}>✕ Limpar</button>
                )}
              </div>

              {filtered.filter(r=>r.gps_lat).length > 0 ? (
                <>
                  {/* MAPA LEAFLET com todos os pontos (respeita os filtros acima) */}
                  <MapaLeaflet relatorios={filtered} height={isMobile?300:500}
                    onPontoClick={id=>{const rel=filtered.find(r=>r.id===id); if(rel) setMapaResumo(rel)}}/>

                  {/* Lista de voos com GPS */}
                  <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:16 }}>
                    {filtered.filter(r => r.gps_lat).map(rel => (
                      <div key={rel.id} onClick={()=>setMapaResumo(rel)}
                        style={{ background:'#fff', borderRadius:12, border:`1px solid ${rel.status==='sos'?'#e5484d':'#d7e6dc'}`, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer' }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13, color:'#0b1210' }}>{rel.cliente||'—'} — {rel.piloto_nome}</div>
                          <div style={{ fontSize:11, color:'#5c7568', marginTop:2 }}>{rel.gps_lat}, {rel.gps_lng} · {new Date(rel.created_at).toLocaleDateString('pt-BR')}</div>
                        </div>
                        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                          <span style={{ background: STATUS_BG[rel.status]||'#F4F7F5', color: STATUS_COLOR[rel.status]||'#5c7568', fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span>
                          <a href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ background:'#00A86B', color:'#fff', borderRadius:8, padding:'5px 10px', fontSize:12, textDecoration:'none', whiteSpace:'nowrap' }}>📍 Ver</a>
                          <span style={{ color:'#7ba38f' }}>›</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ textAlign:'center', color:'#5c7568', padding:60, background:'#fff', borderRadius:12, border:'1px solid #d7e6dc' }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🗺️</div>
                  <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Nenhum voo com GPS</div>
                  <div style={{ fontSize:13 }}>Os voos aparecerão aqui quando os pilotos capturarem o GPS durante a operação.</div>
                </div>
              )}
              </>)}
            </div>
          )}

          {/* RESUMO RÁPIDO — clicou num ponto do mapa */}
          {mapaResumo && (
            <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,0.55)',zIndex:1500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setMapaResumo(null)}>
              <div style={{background:'#fff',borderRadius:20,width:'100%',maxWidth:420,maxHeight:'85vh',overflowY:'auto',padding:22}} onClick={e=>e.stopPropagation()}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>{mapaResumo.cliente||'—'} — {mapaResumo.fazenda||'—'}</div>
                    <div style={{fontSize:12,color:'#5c7568',marginTop:2}}>👨‍✈️ {mapaResumo.piloto_nome||'—'}</div>
                  </div>
                  <button style={{background:'none',border:'none',fontSize:18,color:'#7ba38f',cursor:'pointer'}} onClick={()=>setMapaResumo(null)}>✕</button>
                </div>
                <span style={{background:STATUS_BG[mapaResumo.status]||'#F4F7F5',color:STATUS_COLOR[mapaResumo.status]||'#5c7568',fontSize:11,fontWeight:600,padding:'3px 9px',borderRadius:20,display:'inline-block',marginTop:8,marginBottom:14}}>{STATUS_LABEL[mapaResumo.status]||mapaResumo.status}</span>
                {[
                  ['Talhão', mapaResumo.localizacao],
                  ['Área', mapaResumo.area_ha ? `${mapaResumo.area_ha} ha${mapaResumo.bordadura?` (bordadura ${mapaResumo.bordadura} ha)`:''}` : null],
                  ['Drone', mapaResumo.drone],
                  ['Produtos', (mapaResumo.produtos||[]).join(', ')],
                  ['Data', mapaResumo.dt_inicio ? new Date(mapaResumo.dt_inicio).toLocaleDateString('pt-BR') : new Date(mapaResumo.created_at).toLocaleDateString('pt-BR')],
                  ['OS', mapaResumo.ordem_servico],
                  ['Observação', mapaResumo.obs1||mapaResumo.obs2],
                ].filter(([,v])=>v).map(([l,v])=>(
                  <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #eef5f0',fontSize:13}}>
                    <span style={{color:'#5c7568',fontWeight:500,minWidth:90}}>{l}</span>
                    <span style={{color:'#0b1210',textAlign:'right',flex:1,wordBreak:'break-word'}}>{v}</span>
                  </div>
                ))}
                {mapaResumo.gps_lat && mapaResumo.gps_lng && (
                  <div style={{background:'#eef5f0',borderRadius:10,padding:'10px 12px',marginTop:10,fontSize:12,color:'#5c7568'}}>
                    📍 {mapaResumo.gps_lat}, {mapaResumo.gps_lng}
                    <a href={`https://maps.google.com/?q=${mapaResumo.gps_lat},${mapaResumo.gps_lng}`} target="_blank" rel="noreferrer" style={{display:'block',marginTop:6,color:'#00A86B',fontWeight:600,textDecoration:'none'}}>🗺️ Abrir no Google Maps</a>
                  </div>
                )}
                <button style={{width:'100%',marginTop:16,background:'#00A86B',color:'#fff',border:'none',borderRadius:100,padding:12,fontSize:13,fontWeight:700,cursor:'pointer'}}
                  onClick={()=>{setOsSearch(mapaResumo.ordem_servico||'');setTab('buscaOS');setMapaResumo(null)}}>Ver relatório completo →</button>
              </div>
            </div>
          )}

          {/* ===== TRAJETOS KML ===== */}
          {tab === 'kml' && (() => {
            const comKml = filtered.filter(r => (r.kml_paths||[]).length > 0)
            const selecionados = comKml.filter(r => selectedKmlIds.includes(r.id))
            const toggleKml = (id) => setSelectedKmlIds(ids => ids.includes(id) ? ids.filter(x=>x!==id) : [...ids, id])
            return (
              <div>
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>🛰️ Trajetos KML</div>
                  <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>{comKml.length} voos com trajeto KML enviado · selecione quais sobrepor no mapa</div>
                </div>

                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, background:'#fff', padding:12, borderRadius:12, border:'1px solid #d7e6dc', alignItems:'center' }}>
                  {[['Cliente','cliente'],['Piloto','piloto'],['Drone','drone']].map(([ph,k]) => (
                    <input key={k} style={sG.fi} placeholder={`🔍 ${ph}...`} value={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.value }))} />
                  ))}
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <span style={{ fontSize:11, color:'#5c7568', whiteSpace:'nowrap' }}>De:</span>
                    <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataIni} onChange={e => setFilters(f => ({ ...f, dataIni: e.target.value }))} />
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <span style={{ fontSize:11, color:'#5c7568', whiteSpace:'nowrap' }}>Até:</span>
                    <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataFim} onChange={e => setFilters(f => ({ ...f, dataFim: e.target.value }))} />
                  </div>
                  {Object.values(filters).some(Boolean) && (
                    <button style={{ background:'none', border:'1px solid #e0b0a8', color:'#e5484d', borderRadius:16, padding:'7px 12px', fontSize:12, cursor:'pointer' }} onClick={() => setFilters({ cliente:'', fazenda:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })}>✕ Limpar</button>
                  )}
                </div>

                {comKml.length === 0 ? (
                  <div style={{ textAlign:'center', color:'#5c7568', padding:60, background:'#fff', borderRadius:12, border:'1px solid #d7e6dc' }}>
                    <div style={{ fontSize:40, marginBottom:12 }}>🛰️</div>
                    <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Nenhum voo com KML</div>
                    <div style={{ fontSize:13 }}>Os trajetos aparecem aqui quando o piloto envia o arquivo KML/KMZ da aeronave no relatório.</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:14 }}>
                      {comKml.map(rel => (
                        <label key={rel.id} style={{ display:'flex', alignItems:'center', gap:10, background:'#fff', borderRadius:10, border:'1px solid #d7e6dc', padding:'9px 14px', cursor:'pointer', fontSize:13 }}>
                          <input type="checkbox" checked={selectedKmlIds.includes(rel.id)} onChange={() => toggleKml(rel.id)} />
                          <span style={{ fontWeight:600, color:'#0b1210' }}>{rel.cliente||'—'} — {rel.piloto_nome}</span>
                          <span style={{ color:'#5c7568', fontSize:11 }}>{rel.drone} · {new Date(rel.created_at).toLocaleDateString('pt-BR')}</span>
                          <span style={{ marginLeft:'auto', background: STATUS_BG[rel.status]||'#F4F7F5', color: STATUS_COLOR[rel.status]||'#5c7568', fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span>
                        </label>
                      ))}
                    </div>

                    {selectedKmlIds.length > 0 && (
                      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
                        <button style={{ background:'none', border:'1px solid #e0b0a8', color:'#e5484d', borderRadius:18, padding:'9px 14px', fontSize:13, cursor:'pointer' }} onClick={() => setSelectedKmlIds([])}>✕ Limpar seleção</button>
                      </div>
                    )}

                    {selecionados.length > 0 && (
                      <MapaTrajetosKml voos={selecionados} supabase={supabase} height={isMobile?300:500} />
                    )}
                  </>
                )}
              </div>
            )
          })()}

          {/* ===== USUÁRIOS ===== */}
          {/* ===== INVENTÁRIO ===== */}
          {tab === 'inventario' && (() => {
            const fmtData = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—'
            const hoje = new Date()
            const diasParaVencer = v => v ? Math.round((new Date(v)-hoje)/(1000*60*60*24)) : null

            // Calcula horas voadas por drone (cruzando com relatórios)
            const horasDrone = {}
            relatorios.filter(r=>r.status==='finalizado'&&r.dt_inicio&&r.dt_fim).forEach(r=>{
              const key = r.drone?.trim().toLowerCase()
              if (!key) return
              const mins = Math.max(0,Math.round((new Date(r.dt_fim)-new Date(r.dt_inicio))/60000))
              horasDrone[key] = (horasDrone[key]||0) + mins
            })
            const fmtH = m => { const h=Math.floor(m/60),mn=m%60; return `${h}h${String(mn).padStart(2,'0')}m` }

            return (
              <div>
                {/* Header */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18,flexWrap:'wrap',gap:10}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:'#0b1210'}}>📦 Inventário</div>
                    <div style={{fontSize:12,color:'#5c7568',marginTop:2}}>{invDrones.length} drones · {invProdutos.length} produtos · {invClientes.length} clientes</div>
                  </div>
                  {['drones','produtos'].includes(invTab) && (
                    <button style={{background:'#00A86B',color:'#fff',border:'none',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                      onClick={()=>{
                        if(invTab==='drones'){setDroneForm(initDroneForm());setDroneModal('novo')}
                        else{setProdutoForm(initProdutoForm());setProdutoModal('novo')}
                      }}>
                      + {invTab==='drones'?'Novo Drone':'Novo Produto'}
                    </button>
                  )}
                </div>

                {/* Sub-tabs */}
                <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
                  {[['drones','🚁 Drones'],['produtos','🧪 Produtos'],['veiculos','🚗 Veículos'],['movimentos','📊 Movimentos']].map(([id,lbl])=>(
                    <button key={id} style={{background:invTab===id?'#00A86B':'#F4F7F5',color:invTab===id?'#fff':'#5c7568',border:'none',borderRadius:16,padding:'7px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                      onClick={()=>setInvTab(id)}>{lbl}</button>
                  ))}
                </div>

                {/* ── VEÍCULOS ── */}
                {invTab==='veiculos' && (() => {
                  const hoje = new Date()
                  async function salvarVeiculo(){
                    if(!veiculoForm.placa){showToast('Informe a placa','error');return}
                    setVeicSaving(true)
                    try {
                      const payload = {
                        placa: veiculoForm.placa.toUpperCase(), marca: veiculoForm.marca||null, modelo: veiculoForm.modelo||null,
                        ano: veiculoForm.ano?parseInt(veiculoForm.ano):null, km_atual: parseFloat(veiculoForm.km_atual)||0,
                        proxima_manutencao_km: veiculoForm.proxima_manutencao_km?parseFloat(veiculoForm.proxima_manutencao_km):null,
                        proxima_manutencao_data: veiculoForm.proxima_manutencao_data||null, ativo:true,
                      }
                      const {error} = veiculoModal==='novo'
                        ? await supabase.from('veiculos').insert(payload)
                        : await supabase.from('veiculos').update(payload).eq('id',veiculoModal.id)
                      if(error) throw error
                      showToast('🚗 Veículo salvo!'); setVeiculoModal(null); setVeiculoForm({placa:'',marca:'',modelo:'',ano:'',km_atual:'',proxima_manutencao_km:'',proxima_manutencao_data:''}); fetchInventario()
                    } catch(e){ showToast('Erro: '+e.message,'error') } finally { setVeicSaving(false) }
                  }
                  async function excluirVeiculo(v){
                    if(!window.confirm(`Excluir o veículo ${v.placa}?`)) return
                    await supabase.from('veiculos').delete().eq('id',v.id); fetchInventario()
                  }
                  async function salvarViagem(veiculo){
                    const vf = viagemForm[veiculo.id]||{}
                    if(!vf.data||!vf.km_final){showToast('Informe data e km final','error');return}
                    try {
                      let relatorio_id = null
                      const os = (vf.ordem_servico||'').trim()
                      if(os){
                        const {data:relMatch} = await supabase.from('relatorios').select('id').ilike('ordem_servico',os).maybeSingle()
                        if(relMatch) relatorio_id = relMatch.id
                      }
                      const kmIni = parseFloat(vf.km_inicial)||veiculo.km_atual||0
                      const kmFim = parseFloat(vf.km_final)
                      await supabase.from('viagens').insert({
                        veiculo_id: veiculo.id, motorista: vf.motorista||null, data: vf.data,
                        destino: vf.destino||null, km_inicial: kmIni, km_final: kmFim,
                        ordem_servico: os||null, relatorio_id, observacao: vf.observacao||null,
                      })
                      await supabase.from('veiculos').update({km_atual: kmFim}).eq('id',veiculo.id)
                      showToast('🛣️ Viagem registrada!'); setViagemForm(f=>({...f,[veiculo.id]:{}})); fetchInventario()
                    } catch(e){ showToast('Erro: '+e.message,'error') }
                  }
                  async function salvarManutencao(veiculo){
                    const mf = manutForm[veiculo.id]||{}
                    if(!mf.tipo||!mf.data){showToast('Informe tipo e data','error');return}
                    try {
                      await supabase.from('manutencoes_veiculo').insert({
                        veiculo_id: veiculo.id, tipo: mf.tipo, data: mf.data,
                        km: mf.km?parseFloat(mf.km):null, custo: mf.custo?parseFloat(mf.custo):null, observacao: mf.observacao||null,
                      })
                      if(mf.proximo_km||mf.proxima_data){
                        await supabase.from('veiculos').update({
                          proxima_manutencao_km: mf.proximo_km?parseFloat(mf.proximo_km):veiculo.proxima_manutencao_km,
                          proxima_manutencao_data: mf.proxima_data||veiculo.proxima_manutencao_data,
                        }).eq('id',veiculo.id)
                      }
                      showToast('🔧 Manutenção registrada!'); setManutForm(f=>({...f,[veiculo.id]:{}})); fetchInventario()
                    } catch(e){ showToast('Erro: '+e.message,'error') }
                  }

                  return (
                    <div>
                      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
                        <button style={{background:'#00A86B',color:'#fff',border:'none',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                          onClick={()=>{setVeiculoForm({placa:'',marca:'',modelo:'',ano:'',km_atual:'',proxima_manutencao_km:'',proxima_manutencao_data:''});setVeiculoModal('novo')}}>+ Novo Veículo</button>
                      </div>

                      {veiculos.length===0 ? (
                        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:40,textAlign:'center',color:'#5c7568'}}>Nenhum veículo cadastrado ainda.</div>
                      ) : (
                        <div style={{display:'flex',flexDirection:'column',gap:14}}>
                          {veiculos.map(v=>{
                            const alertaKm = v.proxima_manutencao_km && v.km_atual >= (v.proxima_manutencao_km - 500)
                            const alertaData = v.proxima_manutencao_data && new Date(v.proxima_manutencao_data) <= new Date(hoje.getTime()+7*86400000)
                            const alerta = alertaKm || alertaData
                            const vf = viagemForm[v.id]||{}
                            const mf = manutForm[v.id]||{}
                            const manutVeic = manutencoes.filter(m=>m.veiculo_id===v.id).slice(0,3)
                            const viagensVeic = viagens.filter(vg=>vg.veiculo_id===v.id).slice(0,3)
                            return (
                              <div key={v.id} style={{background:'#fff',borderRadius:20,border:`1px solid ${alerta?'#f2960f':'#dcebe3'}`,padding:18,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                                  <div>
                                    <div style={{fontWeight:700,fontSize:16,fontFamily:"'Syne',sans-serif"}}>🚗 {v.placa} {alerta&&<span style={{background:'#fff3e0',color:'#f2960f',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,marginLeft:6}}>⚠️ Manutenção próxima</span>}</div>
                                    <div style={{fontSize:12,color:'#5c7568',marginTop:2}}>{v.marca} {v.modelo}{v.ano?` · ${v.ano}`:''} · {(v.km_atual||0).toLocaleString('pt-BR')} km</div>
                                  </div>
                                  <div style={{display:'flex',gap:6}}>
                                    <button style={{background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:14,padding:'5px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>{setVeiculoForm({placa:v.placa,marca:v.marca||'',modelo:v.modelo||'',ano:v.ano||'',km_atual:v.km_atual||'',proxima_manutencao_km:v.proxima_manutencao_km||'',proxima_manutencao_data:v.proxima_manutencao_data||''});setVeiculoModal(v)}}>✏️</button>
                                    <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:14,padding:'5px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>excluirVeiculo(v)}>🗑️</button>
                                  </div>
                                </div>

                                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:14,marginTop:12}}>
                                  {/* Nova viagem */}
                                  <div style={{background:'#f9fbfa',borderRadius:14,padding:12}}>
                                    <div style={{fontSize:11,fontWeight:700,color:'#5c7568',marginBottom:8}}>🛣️ Registrar Viagem</div>
                                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
                                      <input type="date" style={{...sG.fi,flex:'1 1 120px'}} value={vf.data||''} onChange={e=>setViagemForm(f=>({...f,[v.id]:{...vf,data:e.target.value}}))}/>
                                      <input style={{...sG.fi,flex:'1 1 120px'}} placeholder="Motorista" value={vf.motorista||''} onChange={e=>setViagemForm(f=>({...f,[v.id]:{...vf,motorista:e.target.value}}))}/>
                                    </div>
                                    <input style={{...sG.fi,width:'100%',marginBottom:6}} placeholder="Destino" value={vf.destino||''} onChange={e=>setViagemForm(f=>({...f,[v.id]:{...vf,destino:e.target.value}}))}/>
                                    <div style={{display:'flex',gap:6,marginBottom:6}}>
                                      <input type="number" style={{...sG.fi,flex:1}} placeholder={`Km inicial (${v.km_atual||0})`} value={vf.km_inicial||''} onChange={e=>setViagemForm(f=>({...f,[v.id]:{...vf,km_inicial:e.target.value}}))}/>
                                      <input type="number" style={{...sG.fi,flex:1}} placeholder="Km final" value={vf.km_final||''} onChange={e=>setViagemForm(f=>({...f,[v.id]:{...vf,km_final:e.target.value}}))}/>
                                    </div>
                                    <input style={{...sG.fi,width:'100%',marginBottom:8}} placeholder="Ordem de serviço (opcional)" value={vf.ordem_servico||''} onChange={e=>setViagemForm(f=>({...f,[v.id]:{...vf,ordem_servico:e.target.value}}))}/>
                                    <button style={{...sG.btn}} onClick={()=>salvarViagem(v)}>Salvar Viagem</button>
                                    {viagensVeic.length>0 && (
                                      <div style={{marginTop:10,borderTop:'1px solid #eef5f0',paddingTop:8}}>
                                        {viagensVeic.map(vg=>(
                                          <div key={vg.id} style={{fontSize:11,color:'#5c7568',padding:'3px 0'}}>{new Date(vg.data).toLocaleDateString('pt-BR')} · {vg.destino||'—'} · {((vg.km_final||0)-(vg.km_inicial||0)).toFixed(0)} km{vg.ordem_servico?` · OS ${vg.ordem_servico}`:''}</div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Nova manutenção */}
                                  <div style={{background:'#f9fbfa',borderRadius:14,padding:12}}>
                                    <div style={{fontSize:11,fontWeight:700,color:'#5c7568',marginBottom:8}}>🔧 Registrar Manutenção</div>
                                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
                                      <select style={{...sG.fi,flex:'1 1 120px'}} value={mf.tipo||''} onChange={e=>setManutForm(f=>({...f,[v.id]:{...mf,tipo:e.target.value}}))}>
                                        <option value="">Tipo...</option>
                                        <option>Troca de óleo</option><option>Revisão</option><option>Pneus</option><option>Freios</option><option>Outro</option>
                                      </select>
                                      <input type="date" style={{...sG.fi,flex:'1 1 120px'}} value={mf.data||''} onChange={e=>setManutForm(f=>({...f,[v.id]:{...mf,data:e.target.value}}))}/>
                                    </div>
                                    <div style={{display:'flex',gap:6,marginBottom:6}}>
                                      <input type="number" style={{...sG.fi,flex:1}} placeholder="Km na manutenção" value={mf.km||''} onChange={e=>setManutForm(f=>({...f,[v.id]:{...mf,km:e.target.value}}))}/>
                                      <input type="number" style={{...sG.fi,flex:1}} placeholder="Custo R$" value={mf.custo||''} onChange={e=>setManutForm(f=>({...f,[v.id]:{...mf,custo:e.target.value}}))}/>
                                    </div>
                                    <div style={{display:'flex',gap:6,marginBottom:8}}>
                                      <input type="number" style={{...sG.fi,flex:1}} placeholder="Próxima em (km)" value={mf.proximo_km||''} onChange={e=>setManutForm(f=>({...f,[v.id]:{...mf,proximo_km:e.target.value}}))}/>
                                      <input type="date" style={{...sG.fi,flex:1}} placeholder="Próxima data" value={mf.proxima_data||''} onChange={e=>setManutForm(f=>({...f,[v.id]:{...mf,proxima_data:e.target.value}}))}/>
                                    </div>
                                    <button style={{...sG.btn,background:'#f2960f'}} onClick={()=>salvarManutencao(v)}>Salvar Manutenção</button>
                                    {manutVeic.length>0 && (
                                      <div style={{marginTop:10,borderTop:'1px solid #eef5f0',paddingTop:8}}>
                                        {manutVeic.map(m=>(
                                          <div key={m.id} style={{fontSize:11,color:'#5c7568',padding:'3px 0'}}>{new Date(m.data).toLocaleDateString('pt-BR')} · {m.tipo}{m.custo?` · R$ ${parseFloat(m.custo).toFixed(2)}`:''}</div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {veiculoModal && (
                        <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setVeiculoModal(null)}>
                          <div style={{background:'#fff',borderRadius:20,width:'100%',maxWidth:380,padding:22}} onClick={e=>e.stopPropagation()}>
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>{veiculoModal==='novo'?'🚗 Novo Veículo':'✏️ Editar Veículo'}</div>
                            <div style={{display:'flex',flexDirection:'column',gap:10}}>
                              <input style={sG.fi} placeholder="Placa" value={veiculoForm.placa} onChange={e=>setVeiculoForm(f=>({...f,placa:e.target.value}))}/>
                              <div style={{display:'flex',gap:8}}>
                                <input style={{...sG.fi,flex:1}} placeholder="Marca" value={veiculoForm.marca} onChange={e=>setVeiculoForm(f=>({...f,marca:e.target.value}))}/>
                                <input style={{...sG.fi,flex:1}} placeholder="Modelo" value={veiculoForm.modelo} onChange={e=>setVeiculoForm(f=>({...f,modelo:e.target.value}))}/>
                              </div>
                              <div style={{display:'flex',gap:8}}>
                                <input type="number" style={{...sG.fi,flex:1}} placeholder="Ano" value={veiculoForm.ano} onChange={e=>setVeiculoForm(f=>({...f,ano:e.target.value}))}/>
                                <input type="number" style={{...sG.fi,flex:1}} placeholder="Km atual" value={veiculoForm.km_atual} onChange={e=>setVeiculoForm(f=>({...f,km_atual:e.target.value}))}/>
                              </div>
                              <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginTop:4}}>PRÓXIMA MANUTENÇÃO (OPCIONAL)</div>
                              <div style={{display:'flex',gap:8}}>
                                <input type="number" style={{...sG.fi,flex:1}} placeholder="Km" value={veiculoForm.proxima_manutencao_km} onChange={e=>setVeiculoForm(f=>({...f,proxima_manutencao_km:e.target.value}))}/>
                                <input type="date" style={{...sG.fi,flex:1}} value={veiculoForm.proxima_manutencao_data} onChange={e=>setVeiculoForm(f=>({...f,proxima_manutencao_data:e.target.value}))}/>
                              </div>
                            </div>
                            <div style={{display:'flex',gap:8,marginTop:20}}>
                              <button style={{flex:1,background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:100,padding:12,fontSize:13,cursor:'pointer'}} onClick={()=>setVeiculoModal(null)}>Cancelar</button>
                              <button style={{flex:2,...sG.btn,opacity:veicSaving?.6:1}} disabled={veicSaving} onClick={salvarVeiculo}>{veicSaving?'Salvando...':'💾 Salvar'}</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* ── MOVIMENTOS DE ESTOQUE ── */}
                {invTab==='movimentos' && (()=>{
                  const TIPO_LABEL = {baixa_relatorio:'📋 Baixa (relatório)',entrada:'📦 Entrada',perda:'⚠️ Perda',ajuste:'🔧 Ajuste'}
                  const MOV_COLORS = ['#00A86B','#22c476','#ffb020','#2f6fed','#8e44ad','#f2960f','#e5484d','#5c7568']

                  // Join com relatorios pra saber fazenda/cliente das baixas automáticas
                  const relatorioById = {}
                  relatorios.forEach(r=>{relatorioById[r.id]=r})
                  const fazendaDoMovimento = m => m.relatorio_id ? relatorioById[m.relatorio_id]?.fazenda : null
                  const fazendasDisponiveis = [...new Set(relatorios.map(r=>r.fazenda).filter(Boolean))].sort()

                  const movFiltrados = invMovimentos.filter(m=>{
                    if(movFiltros.produto && m.produto_nome!==movFiltros.produto) return false
                    if(movFiltros.tipo && m.tipo!==movFiltros.tipo) return false
                    if(movFiltros.fazenda && fazendaDoMovimento(m)!==movFiltros.fazenda) return false
                    if(movFiltros.dataIni && new Date(m.created_at)<new Date(movFiltros.dataIni)) return false
                    if(movFiltros.dataFim && new Date(m.created_at)>new Date(movFiltros.dataFim+'T23:59:59')) return false
                    return true
                  })

                  const totalEntradas = movFiltrados.filter(m=>m.quantidade>0).reduce((a,m)=>a+m.quantidade,0)
                  const totalSaidas = movFiltrados.filter(m=>m.quantidade<0).reduce((a,m)=>a+Math.abs(m.quantidade),0)
                  const porProduto = {}
                  movFiltrados.filter(m=>m.quantidade<0).forEach(m=>{porProduto[m.produto_nome]=(porProduto[m.produto_nome]||0)+Math.abs(m.quantidade)})
                  const rankingProdutos = Object.entries(porProduto).sort((a,b)=>b[1]-a[1])
                  const maisConsumido = rankingProdutos[0]
                  const chartProdutos = rankingProdutos.slice(0,8).map(([name,value])=>({name,value:parseFloat(value.toFixed(1))}))

                  // Movimentação por dia (saídas), últimos 30 pontos do período filtrado
                  const porDia = {}
                  movFiltrados.forEach(m=>{
                    const d = new Date(m.created_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
                    if(!porDia[d]) porDia[d]={dia:d,entradas:0,saidas:0}
                    if(m.quantidade>0) porDia[d].entradas+=m.quantidade
                    else porDia[d].saidas+=Math.abs(m.quantidade)
                  })
                  const chartTempo = Object.values(porDia).slice(-30).map(x=>({...x,entradas:parseFloat(x.entradas.toFixed(1)),saidas:parseFloat(x.saidas.toFixed(1))}))

                  // Distribuição por tipo
                  const porTipo = {}
                  movFiltrados.forEach(m=>{porTipo[m.tipo]=(porTipo[m.tipo]||0)+Math.abs(m.quantidade)})
                  const chartTipo = Object.entries(porTipo).map(([tipo,value])=>({name:TIPO_LABEL[tipo]||tipo,value:parseFloat(value.toFixed(1))}))

                  const filtrosAtivos = Object.values(movFiltros).some(Boolean)

                  return (
                    <div>
                      {/* Filtros */}
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16,background:'#fff',padding:12,borderRadius:12,border:'1px solid #d7e6dc',alignItems:'center'}}>
                        <select style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 160px'}}
                          value={movFiltros.produto} onChange={e=>setMovFiltros(f=>({...f,produto:e.target.value}))}>
                          <option value="">Todos os produtos</option>
                          {invProdutos.map(p=><option key={p.id} value={p.nome}>{p.nome}</option>)}
                        </select>
                        <select style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 160px'}}
                          value={movFiltros.fazenda} onChange={e=>setMovFiltros(f=>({...f,fazenda:e.target.value}))}>
                          <option value="">Todas as fazendas</option>
                          {fazendasDisponiveis.map(fz=><option key={fz} value={fz}>{fz}</option>)}
                        </select>
                        <select style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',flex:'0 0 170px'}}
                          value={movFiltros.tipo} onChange={e=>setMovFiltros(f=>({...f,tipo:e.target.value}))}>
                          <option value="">Todos os tipos</option>
                          <option value="baixa_relatorio">📋 Baixa (relatório)</option>
                          <option value="entrada">📦 Entrada</option>
                          <option value="perda">⚠️ Perda</option>
                          <option value="ajuste">🔧 Ajuste</option>
                        </select>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontSize:11,color:'#5c7568'}}>De:</span>
                          <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',minWidth:120}} value={movFiltros.dataIni} onChange={e=>setMovFiltros(f=>({...f,dataIni:e.target.value}))}/>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontSize:11,color:'#5c7568'}}>Até:</span>
                          <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',minWidth:120}} value={movFiltros.dataFim} onChange={e=>setMovFiltros(f=>({...f,dataFim:e.target.value}))}/>
                        </div>
                        {filtrosAtivos && (
                          <button style={{background:'none',border:'1px solid #e0b0a8',color:'#e5484d',borderRadius:16,padding:'7px 12px',fontSize:12,cursor:'pointer'}}
                            onClick={()=>setMovFiltros({produto:'',fazenda:'',tipo:'',dataIni:'',dataFim:''})}>✕ Limpar</button>
                        )}
                      </div>

                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)',gap:12,marginBottom:16}}>
                        <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:14}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>ENTRADAS (FILTRADO)</div>
                          <div style={{fontSize:20,fontWeight:700,color:'#00A86B'}}>+{totalEntradas.toFixed(1)}</div>
                        </div>
                        <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:14}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>SAÍDAS (FILTRADO)</div>
                          <div style={{fontSize:20,fontWeight:700,color:'#e5484d'}}>-{totalSaidas.toFixed(1)}</div>
                        </div>
                        <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:14}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>PRODUTO MAIS CONSUMIDO</div>
                          <div style={{fontSize:15,fontWeight:700,color:'#0b1210'}}>{maisConsumido?`${maisConsumido[0]} (${maisConsumido[1].toFixed(1)})`:'—'}</div>
                        </div>
                      </div>

                      {/* Gráficos */}
                      {movFiltrados.length>0 && (
                        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1.3fr 1fr',gap:12,marginBottom:16}}>
                          <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:16}}>
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:'#0b1210',marginBottom:10}}>📊 Consumo por Produto</div>
                            {chartProdutos.length===0 ? <div style={{color:'#7ba38f',fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem saídas no período</div> : (
                              <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={chartProdutos} layout="vertical" margin={{left:10,right:10}}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                                  <XAxis type="number" tick={{fontSize:10,fill:'#7ba38f'}}/>
                                  <YAxis type="category" dataKey="name" width={100} tick={{fontSize:10,fill:'#5c7568'}}/>
                                  <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}}/>
                                  <Bar dataKey="value" fill="#00A86B" radius={[0,6,6,0]}/>
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:16}}>
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:'#0b1210',marginBottom:10}}>🥧 Por Tipo</div>
                            {chartTipo.length===0 ? <div style={{color:'#7ba38f',fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem dados</div> : (
                              <ResponsiveContainer width="100%" height={220}>
                                <PieChart>
                                  <Pie data={chartTipo} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({name,percent})=>`${(percent*100).toFixed(0)}%`}>
                                    {chartTipo.map((_,i)=><Cell key={i} fill={MOV_COLORS[i%MOV_COLORS.length]}/>)}
                                  </Pie>
                                  <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}}/>
                                  <Legend wrapperStyle={{fontSize:11}}/>
                                </PieChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:16,gridColumn:isMobile?'auto':'1 / -1'}}>
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:'#0b1210',marginBottom:10}}>📈 Movimentação ao Longo do Tempo</div>
                            {chartTempo.length===0 ? <div style={{color:'#7ba38f',fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem dados no período</div> : (
                              <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={chartTempo} margin={{top:5,right:10,left:-20,bottom:5}}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                                  <XAxis dataKey="dia" tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false}/>
                                  <YAxis tick={{fontSize:10,fill:'#7ba38f'}} tickLine={false} axisLine={false}/>
                                  <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}}/>
                                  <Legend wrapperStyle={{fontSize:11}}/>
                                  <Bar dataKey="entradas" name="Entradas" fill="#00A86B" radius={[4,4,0,0]}/>
                                  <Bar dataKey="saidas" name="Saídas" fill="#e5484d" radius={[4,4,0,0]}/>
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Novo movimento manual */}
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:16,marginBottom:16}}>
                        <div style={{fontSize:13,fontWeight:700,color:'#0b1210',marginBottom:10,fontFamily:"'Syne',sans-serif"}}>+ Novo Movimento</div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                          <select style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',flex:'1 1 160px'}}
                            value={movForm.produto} onChange={e=>setMovForm(f=>({...f,produto:e.target.value}))}>
                            <option value="">Produto...</option>
                            {invProdutos.filter(p=>p.ativo).map(p=><option key={p.id}>{p.nome}</option>)}
                          </select>
                          <select style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',flex:'0 0 160px'}}
                            value={movForm.tipo} onChange={e=>setMovForm(f=>({...f,tipo:e.target.value}))}>
                            <option value="entrada">📦 Entrada (compra)</option>
                            <option value="perda">⚠️ Perda</option>
                            <option value="ajuste">🔧 Ajuste</option>
                          </select>
                          <input style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',flex:'0 0 120px'}}
                            type="number" placeholder="Quantidade" value={movForm.quantidade} onChange={e=>setMovForm(f=>({...f,quantidade:e.target.value}))}/>
                          <input style={{border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',flex:'1 1 200px'}}
                            placeholder="Observação (opcional)" value={movForm.obs} onChange={e=>setMovForm(f=>({...f,obs:e.target.value}))}/>
                          <button style={{background:'#00A86B',color:'#fff',border:'none',borderRadius:16,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:movSaving?'default':'pointer',opacity:movSaving?.6:1}}
                            disabled={movSaving} onClick={salvarMovimento}>{movSaving?'Salvando...':'Salvar'}</button>
                        </div>
                        <div style={{fontSize:11,color:'#7ba38f',marginTop:8}}>Entrada soma ao estoque · Perda e Ajuste você digita a quantidade a remover (ou negativa, para ajuste que soma).</div>
                      </div>

                      {/* Histórico */}
                      {invMovimentos.length===0 ? (
                        <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:40,textAlign:'center',color:'#5c7568'}}>
                          Nenhum movimento ainda.<br/>As baixas aparecem aqui automaticamente quando um relatório é finalizado, ou rode o SQL de setup se a tabela ainda não existir.
                        </div>
                      ) : movFiltrados.length===0 ? (
                        <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:30,textAlign:'center',color:'#5c7568',fontSize:13}}>
                          Nenhum movimento encontrado com esses filtros.
                        </div>
                      ) : (
                        <div style={{overflowX:'auto'}}>
                          <div style={{fontSize:11,color:'#7ba38f',marginBottom:8}}>{movFiltrados.length} movimento(s)</div>
                          <table style={{width:'100%',borderCollapse:'collapse',minWidth:600}}>
                            <thead>
                              <tr style={{background:'#F4F7F5'}}>
                                {['Data','Produto','Tipo','Fazenda','Quantidade','Obs'].map(h=>(
                                  <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif",whiteSpace:'nowrap'}}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {movFiltrados.slice(0,200).map((m,i)=>(
                                <tr key={m.id} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                                  <td style={{padding:'8px 10px',fontSize:12,color:'#5c7568',whiteSpace:'nowrap'}}>{new Date(m.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                                  <td style={{padding:'8px 10px',fontSize:13,fontWeight:600,color:'#0b1210'}}>{m.produto_nome}</td>
                                  <td style={{padding:'8px 10px',fontSize:12,color:'#5c7568'}}>{TIPO_LABEL[m.tipo]||m.tipo}</td>
                                  <td style={{padding:'8px 10px',fontSize:12,color:'#5c7568'}}>{fazendaDoMovimento(m)||'—'}</td>
                                  <td style={{padding:'8px 10px',fontSize:13,fontWeight:700,color:m.quantidade<0?'#e5484d':'#00A86B'}}>{m.quantidade>0?'+':''}{m.quantidade} {m.unidade||''}</td>
                                  <td style={{padding:'8px 10px',fontSize:12,color:'#5c7568'}}>{m.obs||'—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* ── DRONES ── */}
                {invTab==='drones' && (
                  <div>
                    {invDrones.length===0 ? (
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:40,textAlign:'center',color:'#5c7568'}}>
                        Nenhum drone cadastrado ainda.<br/>Clique em "+ Novo Drone" para começar.
                      </div>
                    ) : (
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(300px,1fr))',gap:12}}>
                        {invDrones.map(d => {
                          const horasMin = horasDrone[d.nome?.trim().toLowerCase()] || 0
                          const limite = d.horas_limite || 100
                          const pct = Math.min(100,(horasMin/60/limite)*100)
                          const alerta = pct>=90, aviso = pct>=70&&pct<90
                          const cor = alerta?'#e5484d':aviso?'#f2960f':'#00A86B'
                          return (
                            <div key={d.id} style={{background:'#fff',borderRadius:12,border:`1px solid ${alerta?'#f5c6c6':aviso?'#f5e0a0':'#d7e6dc'}`,padding:16,position:'relative'}}>
                              {!d.ativo && <span style={{position:'absolute',top:12,right:12,background:'#fee',color:'#e5484d',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>INATIVO</span>}
                              {alerta && <span style={{position:'absolute',top:12,right:12,background:'#e5484d',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ MANUTENÇÃO</span>}
                              {aviso && !alerta && <span style={{position:'absolute',top:12,right:12,background:'#f2960f',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚡ ATENÇÃO</span>}
                              <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:'#0b1210',marginBottom:2}}>{d.nome}</div>
                              <div style={{fontSize:12,color:'#5c7568',marginBottom:10}}>{d.fabricante} {d.modelo} {d.serial?`· S/N: ${d.serial}`:''}</div>
                              {/* Barra horas */}
                              <div style={{marginBottom:10}}>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                                  <span style={{color:'#5c7568'}}>Horas voadas</span>
                                  <span style={{fontWeight:700,color:cor}}>{fmtH(horasMin)} / {limite}h</span>
                                </div>
                                <div style={{background:'#eef5f0',borderRadius:20,height:7,overflow:'hidden'}}>
                                  <div style={{background:cor,height:'100%',borderRadius:20,width:`${pct}%`,transition:'width .5s'}}/>
                                </div>
                              </div>
                              {d.obs && <div style={{fontSize:11,color:'#5c7568',marginBottom:8,fontStyle:'italic'}}>{d.obs}</div>}
                              <div style={{display:'flex',gap:6}}>
                                <button style={{flex:1,background:'#F4F7F5',color:'#00A86B',border:'none',borderRadius:16,padding:'6px',fontSize:12,cursor:'pointer',fontWeight:600}}
                                  onClick={()=>{setDroneForm(initDroneForm(d));setDroneModal(d)}}>✏️ Editar</button>
                                <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:16,padding:'6px 10px',fontSize:12,cursor:'pointer'}}
                                  onClick={()=>deletarDrone(d.id)}>🗑️</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PRODUTOS ── */}
                {invTab==='produtos' && (
                  <div>
                    {invProdutos.length===0 ? (
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:40,textAlign:'center',color:'#5c7568'}}>
                        Nenhum produto cadastrado ainda.<br/>Clique em "+ Novo Produto" para começar.
                      </div>
                    ) : (
                      <div style={{overflowX:'auto'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',minWidth:560}}>
                          <thead>
                            <tr style={{background:'#F4F7F5'}}>
                              {['Produto','Fabricante','Estoque','Mínimo','Validade','Registro MAPA',''].map(h=>(
                                <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:11,fontWeight:700,color:'#5c7568',fontFamily:"'Syne',sans-serif"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {invProdutos.map((p,i)=>{
                              const dias = diasParaVencer(p.validade)
                              const vencendo = dias !== null && dias <= 30
                              const vencido = dias !== null && dias < 0
                              const baixo = p.estoque_atual <= p.estoque_minimo && p.estoque_minimo > 0
                              return (
                                <tr key={p.id} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                                  <td style={{padding:'9px 12px'}}>
                                    <div style={{fontWeight:600,fontSize:13,color:p.ativo?'#0b1210':'#aaa'}}>{p.nome}</div>
                                    {!p.ativo && <span style={{fontSize:10,color:'#e5484d'}}>inativo</span>}
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:'#5c7568'}}>{p.fabricante||'—'}</td>
                                  <td style={{padding:'9px 12px'}}>
                                    <span style={{fontWeight:700,color:baixo?'#e5484d':'#00A86B',fontSize:13}}>{p.estoque_atual} {p.unidade}</span>
                                    {baixo && <span style={{marginLeft:4,fontSize:10,color:'#e5484d'}}>⚠️ baixo</span>}
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:'#5c7568'}}>{p.estoque_minimo} {p.unidade}</td>
                                  <td style={{padding:'9px 12px'}}>
                                    <span style={{fontSize:12,color:vencido?'#e5484d':vencendo?'#f2960f':'#0b1210',fontWeight:vencido||vencendo?700:400}}>
                                      {fmtData(p.validade)}
                                      {vencido && ' ⛔'}{vencendo && !vencido && ` (${dias}d)`}
                                    </span>
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:'#5c7568'}}>{p.registro_mapa||'—'}</td>
                                  <td style={{padding:'9px 12px',whiteSpace:'nowrap'}}>
                                    <button style={{background:'#F4F7F5',color:'#00A86B',border:'none',borderRadius:14,padding:'4px 8px',fontSize:11,cursor:'pointer',marginRight:4}}
                                      onClick={()=>{setProdutoForm(initProdutoForm(p));setProdutoModal(p)}}>✏️</button>
                                    <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:14,padding:'4px 8px',fontSize:11,cursor:'pointer'}}
                                      onClick={()=>deletarProduto(p.id)}>🗑️</button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* MODAL DRONE */}
                {droneModal && (
                  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,maxHeight:'90vh',overflowY:'auto',padding:24}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>
                        {droneModal==='novo'?'🚁 Novo Drone':'✏️ Editar Drone'}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                        {[['NOME / IDENTIFICAÇÃO','nome','text','Ex: OROFLY_01'],['FABRICANTE','fabricante','text','DJI'],['MODELO','modelo','text','T70'],['Nº DE SÉRIE','serial','text',''],['ANO DE AQUISIÇÃO','ano_aquisicao','number','2024'],['LIMITE DE HORAS','horas_limite','number','100']].map(([lbl,key,type,ph])=>(
                          <div key={key} style={{gridColumn:key==='nome'?'1/-1':'auto'}}>
                            <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>{lbl}</div>
                            <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                              type={type} placeholder={ph} value={droneForm[key]||''}
                              onChange={e=>setDroneForm(f=>({...f,[key]:e.target.value}))} />
                          </div>
                        ))}
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>OBSERVAÇÕES</div>
                          <textarea style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',resize:'none',height:60,boxSizing:'border-box'}}
                            value={droneForm.obs||''} onChange={e=>setDroneForm(f=>({...f,obs:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setDroneForm(f=>({...f,ativo:!f.ativo}))}>
                          <div style={{width:36,height:20,borderRadius:10,background:droneForm.ativo?'#00A86B':'#d7e6dc',position:'relative',transition:'all .2s',flexShrink:0}}>
                            <div style={{width:14,height:14,borderRadius:7,background:'#fff',position:'absolute',top:3,left:droneForm.ativo?19:3,transition:'all .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:'#0b1210'}}>Drone ativo</span>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:20}}>
                        <button style={{flex:1,background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:18,padding:12,fontSize:13,cursor:'pointer'}}
                          onClick={()=>setDroneModal(null)}>Cancelar</button>
                        <button style={{flex:2,background:'#00A86B',color:'#fff',border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}}
                          disabled={invSaving} onClick={salvarDrone}>{invSaving?'Salvando...':'💾 Salvar'}</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* MODAL PRODUTO */}
                {produtoModal && (
                  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,maxHeight:'90vh',overflowY:'auto',padding:24}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>
                        {produtoModal==='novo'?'🧪 Novo Produto':'✏️ Editar Produto'}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                        {[['NOME DO PRODUTO','nome','text','Ex: Triclon'],['FABRICANTE','fabricante','text','Syngenta'],['UNIDADE','unidade','text','L'],['REGISTRO MAPA','registro_mapa','text','BR-00000']].map(([lbl,key,type,ph])=>(
                          <div key={key} style={{gridColumn:key==='nome'?'1/-1':'auto'}}>
                            <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>{lbl}</div>
                            <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                              type={type} placeholder={ph} value={produtoForm[key]||''}
                              onChange={e=>setProdutoForm(f=>({...f,[key]:e.target.value}))} />
                          </div>
                        ))}
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>ESTOQUE ATUAL</div>
                          <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="number" step="0.1" value={produtoForm.estoque_atual||0}
                            onChange={e=>setProdutoForm(f=>({...f,estoque_atual:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>ESTOQUE MÍNIMO</div>
                          <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="number" step="0.1" value={produtoForm.estoque_minimo||0}
                            onChange={e=>setProdutoForm(f=>({...f,estoque_minimo:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>DOSE PADRÃO ({produtoForm.unidade||'L'}/ha)</div>
                          <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="number" step="0.001" placeholder="Ex: 0.6" value={produtoForm.dose_padrao??''}
                            onChange={e=>setProdutoForm(f=>({...f,dose_padrao:e.target.value}))} />
                        </div>
                        <div style={{display:'flex',alignItems:'flex-end',paddingBottom:6}}>
                          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#5c7568',cursor:'pointer'}}>
                            <input type="checkbox" checked={produtoForm.dose_auto!==false}
                              onChange={e=>setProdutoForm(f=>({...f,dose_auto:e.target.checked}))}/>
                            Pré-preencher no app
                          </label>
                        </div>
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>VALIDADE</div>
                          <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="date" value={produtoForm.validade||''}
                            onChange={e=>setProdutoForm(f=>({...f,validade:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>OBSERVAÇÕES</div>
                          <textarea style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',resize:'none',height:60,boxSizing:'border-box'}}
                            value={produtoForm.obs||''} onChange={e=>setProdutoForm(f=>({...f,obs:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setProdutoForm(f=>({...f,ativo:!f.ativo}))}>
                          <div style={{width:36,height:20,borderRadius:10,background:produtoForm.ativo?'#00A86B':'#d7e6dc',position:'relative',transition:'all .2s',flexShrink:0}}>
                            <div style={{width:14,height:14,borderRadius:7,background:'#fff',position:'absolute',top:3,left:produtoForm.ativo?19:3,transition:'all .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:'#0b1210'}}>Produto ativo</span>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:20}}>
                        <button style={{flex:1,background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:18,padding:12,fontSize:13,cursor:'pointer'}}
                          onClick={()=>setProdutoModal(null)}>Cancelar</button>
                        <button style={{flex:2,background:'#00A86B',color:'#fff',border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}}
                          disabled={invSaving} onClick={salvarProduto}>{invSaving?'Salvando...':'💾 Salvar'}</button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )
          })()}

          {/* ===== FAZENDAS & CLIENTES ===== */}
          {tab === 'fazendas' && (() => {
            const q = fzSearch.trim().toLowerCase()
            const fazendasFiltradas = invFazendas
              .filter(f=>!q || f.cliente?.toLowerCase().includes(q)||f.nome?.toLowerCase().includes(q))
              .filter(f=>!fzProdutoFiltro || f.produto===fzProdutoFiltro)
              .filter(f=>!fzClienteFiltro || f.cliente===fzClienteFiltro)

            const fazendasBI = fazendasFiltradas.map(fz => {
              const talhoesFz = invTalhoes.filter(t=>t.fazenda_id===fz.id)
              const areaTotal = talhoesFz.reduce((a,t)=>a+parseFloat(t.area_ha||0),0)
              const relatoriosFz = relatorios.filter(r=>
                r.fazenda===fz.nome && r.cliente===fz.cliente && r.status==='finalizado' &&
                (!fz.campanha_inicio || new Date(r.created_at) >= new Date(fz.campanha_inicio))
              )
              const areaRealizada = relatoriosFz.reduce((a,r)=>a+areaLiquida(r),0)
              // Bordadura conta como "feito" — é faixa de segurança deliberadamente não
              // pulverizada, não trabalho pendente (senão a fazenda nunca fecha 100%).
              const bordaduraRealizada = relatoriosFz.reduce((a,r)=>a+(parseFloat(r.bordadura)||0),0)
              const pct = areaTotal>0 ? Math.min(100,((areaRealizada+bordaduraRealizada)/areaTotal)*100) : null
              const porPiloto = {}
              relatoriosFz.forEach(r=>{
                const n = r.piloto_nome||'—'
                porPiloto[n] = (porPiloto[n]||0) + areaLiquida(r)
              })
              const rankingPilotos = Object.entries(porPiloto).sort((a,b)=>b[1]-a[1])
              return { ...fz, areaTotal, areaRealizada, pct, numTalhoes: talhoesFz.length, numVoos: relatoriosFz.length, rankingPilotos }
            })

            const somaTotal = fazendasBI.reduce((a,f)=>a+f.areaTotal,0)
            const somaRealizada = fazendasBI.reduce((a,f)=>a+f.areaRealizada,0)
            const pctGeral = somaTotal>0 ? Math.min(100,(somaRealizada/somaTotal)*100) : 0
            const comCadastro = fazendasBI.filter(f=>f.areaTotal>0)
            const chartFazendas = [...comCadastro].sort((a,b)=>b.pct-a.pct).slice(0,10)
              .map(f=>({ name: f.nome.length>16?f.nome.slice(0,15)+'…':f.nome, pct: parseFloat(f.pct.toFixed(1)) }))

            // Sem talhão cadastrado com área conta como "não iniciada" também — na prática,
            // se não tem nem área lançada, o trabalho ainda nem começou de verdade.
            function fzStatus(f) {
              if (f.pct===null || f.pct===0) return 'nao_iniciada'
              if (f.pct>=100) return 'concluida'
              return 'parcial'
            }
            const fazendasBIFiltradas = fzStatusFiltro ? fazendasBI.filter(f=>fzStatus(f)===fzStatusFiltro) : fazendasBI
            const qtdConcluidas = fazendasBI.filter(f=>fzStatus(f)==='concluida').length
            const qtdParciais = fazendasBI.filter(f=>fzStatus(f)==='parcial').length
            const qtdNaoIniciadas = fazendasBI.filter(f=>fzStatus(f)==='nao_iniciada').length

            async function zerarProgresso(fz) {
              if(!window.confirm(`Zerar o progresso de "${fz.nome}"?\n\nIsso reinicia a % de conclusão a partir de agora (o histórico de voos é mantido, só não conta mais pro cálculo). Use para uma nova aplicação/reaplicação na mesma área.`)) return
              const { error } = await supabase.from('fazendas').update({ campanha_inicio: new Date().toISOString() }).eq('id', fz.id)
              if(error){ showToast('Erro: '+error.message,'error'); return }
              showToast('🔄 Progresso zerado!'); fetchInventario()
            }

            async function geocodificarCep(cepBruto) {
              const cep = (cepBruto||'').replace(/\D/g,'')
              if(cep.length!==8) return null
              const viaCep = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then(r=>r.json())
              if(viaCep.erro) return null
              const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(viaCep.localidade)}&count=5&language=pt&format=json`).then(r=>r.json())
              const match = (geo.results||[]).find(r=>r.admin1?.toLowerCase().includes((viaCep.uf||'').toLowerCase())) || geo.results?.[0]
              if(!match) return null
              return { lat: match.latitude, lng: match.longitude, cidade: viaCep.localidade, uf: viaCep.uf }
            }

            async function buscarCoordenadasPorCep() {
              setFzGeoLoading(true)
              try {
                const r = await geocodificarCep(fzForm.cep)
                if(!r) throw new Error('CEP não encontrado ou sem coordenada pra essa cidade')
                setFzForm(f=>({...f,lat:String(r.lat),lng:String(r.lng)}))
                showToast(`📍 Coordenadas de ${r.cidade}/${r.uf} preenchidas — ajuste se souber a posição exata da fazenda`)
              } catch(e){ showToast('Erro: '+e.message,'error') } finally { setFzGeoLoading(false) }
            }

            async function salvarNovaFazenda() {
              if(!fzForm.cliente||!fzForm.nome){ showToast('Preencha cliente e nome','error'); return }
              const nomeNorm = fzForm.nome.trim()
              const norm = s => s.trim().toLowerCase().replace(/\s+/g,' ')
              if(!fzEditId){
                const mesmoCliente = invFazendas.find(fz=>norm(fz.nome)===norm(nomeNorm) && fz.cliente===fzForm.cliente)
                if(mesmoCliente){ showToast(`"${mesmoCliente.nome}" já está cadastrada para ${fzForm.cliente}. Use a fazenda existente na lista.`,'error'); return }
                const outroCliente = invFazendas.find(fz=>norm(fz.nome)===norm(nomeNorm) && fz.cliente!==fzForm.cliente)
                if(outroCliente && !window.confirm(`Já existe uma fazenda chamada "${outroCliente.nome}" cadastrada para o cliente ${outroCliente.cliente}.\n\nSe for a mesma fazenda, cancele e corrija o cliente correto. Cadastrar mesmo assim como uma fazenda separada para ${fzForm.cliente}?`)) return
              }
              setInvSaving(true)
              try {
                let lat = fzForm.lat, lng = fzForm.lng
                // Tem CEP mas não ajustou lat/long manualmente ainda — geocodifica automático
                // pra não depender do admin lembrar de clicar em "Buscar coord." antes de salvar.
                if(fzForm.cep && !lat && !lng){
                  const r = await geocodificarCep(fzForm.cep)
                  if(r){ lat = r.lat; lng = r.lng }
                }
                const payload = {cliente:fzForm.cliente,nome:nomeNorm,produto:fzForm.produto||null,
                  cep:fzForm.cep||null,lat:lat?parseFloat(lat):null,lng:lng?parseFloat(lng):null,id_fazenda:fzForm.id_fazenda||null,
                  mapa_lat_min:fzForm.mapa_lat_min?parseFloat(fzForm.mapa_lat_min):null,
                  mapa_lat_max:fzForm.mapa_lat_max?parseFloat(fzForm.mapa_lat_max):null,
                  mapa_lng_min:fzForm.mapa_lng_min?parseFloat(fzForm.mapa_lng_min):null,
                  mapa_lng_max:fzForm.mapa_lng_max?parseFloat(fzForm.mapa_lng_max):null}
                let savedId = fzEditId
                if(fzEditId){
                  const {error} = await supabase.from('fazendas').update(payload).eq('id',fzEditId)
                  if(error) throw error
                } else {
                  const {data,error} = await supabase.from('fazendas').insert({...payload,ativo:true}).select().single()
                  if(error) throw error
                  savedId = data.id
                }
                // Sobe o PDF do mapa (se um novo arquivo foi escolhido) — só depois de ter o id da fazenda
                if(fzMapaFile && savedId){
                  setFzMapaUploading(true)
                  const path = `mapas/${savedId}/mapa.pdf`
                  const {error: upErr} = await supabase.storage.from('relatorios').upload(path, fzMapaFile, {upsert:true, contentType:'application/pdf'})
                  if(upErr) throw upErr
                  const {error: pathErr} = await supabase.from('fazendas').update({mapa_pdf_path:path}).eq('id',savedId)
                  if(pathErr) throw pathErr
                }
                showToast(fzEditId?'✅ Fazenda atualizada!':'✅ Fazenda cadastrada!')
                setFzForm({cliente:'',nome:'',produto:'',cep:'',lat:'',lng:'',id_fazenda:'',mapa_lat_min:'',mapa_lat_max:'',mapa_lng_min:'',mapa_lng_max:''})
                setFzEditId(null); setFzMapaFile(null); setFzMapaExistente(null); setFzModal(false); fetchInventario()
              } catch(e){ showToast('Erro: '+e.message,'error') } finally { setInvSaving(false); setFzMapaUploading(false) }
            }

            return (
              <div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18,flexWrap:'wrap',gap:10}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:'#0b1210'}}>🌾 Fazendas & Clientes</div>
                    <div style={{fontSize:12,color:'#5c7568',marginTop:2}}>{invFazendas.length} fazendas · {invClientes.length} clientes</div>
                  </div>
                  {fzTab==='clientes' && (
                    <button style={{background:'#00A86B',color:'#fff',border:'none',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                      onClick={()=>{setClienteForm(initClienteForm());setClienteModal('novo')}}>
                      + Novo Cliente
                    </button>
                  )}
                  {fzTab==='fazendas' && (
                    <button style={{background:'#00A86B',color:'#fff',border:'none',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                      onClick={()=>{setFzForm({cliente:'',nome:'',produto:'',cep:'',lat:'',lng:'',id_fazenda:'',mapa_lat_min:'',mapa_lat_max:'',mapa_lng_min:'',mapa_lng_max:''});setFzEditId(null);setFzMapaFile(null);setFzMapaExistente(null);setFzModal(true)}}>
                      + Nova Fazenda
                    </button>
                  )}
                </div>

                {/* Sub-tabs */}
                <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
                  {[['visao','📊 Visão Geral'],['fazendas','🌾 Fazendas'],['clientes','🏢 Clientes']].map(([id,lbl])=>(
                    <button key={id} style={{background:fzTab===id?'#00A86B':'#F4F7F5',color:fzTab===id?'#fff':'#5c7568',border:'none',borderRadius:16,padding:'7px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                      onClick={()=>setFzTab(id)}>{lbl}</button>
                  ))}
                </div>

                {/* ── VISÃO GERAL (BI) ── */}
                {fzTab==='visao' && (
                  <div>
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:14}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>FAZENDAS CADASTRADAS</div>
                        <div style={{fontSize:20,fontWeight:700,color:'#0b1210'}}>{invFazendas.length}</div>
                      </div>
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:14}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>ÁREA TOTAL CADASTRADA</div>
                        <div style={{fontSize:20,fontWeight:700,color:'#0b1210'}}>{somaTotal.toFixed(1)} ha</div>
                      </div>
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:14}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>ÁREA REALIZADA</div>
                        <div style={{fontSize:20,fontWeight:700,color:'#00A86B'}}>{somaRealizada.toFixed(1)} ha</div>
                      </div>
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:14}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>% CONCLUÍDO (GERAL)</div>
                        <div style={{fontSize:20,fontWeight:700,color:'#2f6fed'}}>{pctGeral.toFixed(1)}%</div>
                      </div>
                    </div>

                    {chartFazendas.length>0 && (
                      <div style={{background:'#fff',borderRadius:14,border:'1px solid #dcebe3',padding:16,marginBottom:16}}>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:'#0b1210',marginBottom:10}}>📊 % Concluído por Fazenda (top 10)</div>
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={chartFazendas} layout="vertical" margin={{left:10,right:20}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                            <XAxis type="number" domain={[0,100]} tick={{fontSize:10,fill:'#7ba38f'}} unit="%"/>
                            <YAxis type="category" dataKey="name" width={110} tick={{fontSize:10,fill:'#5c7568'}}/>
                            <Tooltip contentStyle={{borderRadius:10,border:'1px solid #dcebe3',fontSize:12}} formatter={v=>`${v}%`}/>
                            <Bar dataKey="pct" fill="#00A86B" radius={[0,6,6,0]}/>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                      <input style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'8px 12px',fontSize:13,outline:'none',flex:'1 1 220px',boxSizing:'border-box'}}
                        placeholder="🔍 Buscar por cliente ou fazenda..." value={fzSearch} onChange={e=>setFzSearch(e.target.value)}/>
                      <div style={{flex:'0 0 200px'}}>
                        <MultiSelectDropdown label="Produto" options={['Inseticida','Herbicida','Fungicida']}
                          selected={fzProdutoFiltro?[fzProdutoFiltro]:[]}
                          onChange={arr=>setFzProdutoFiltro(arr.length?arr[arr.length-1]:'')}/>
                      </div>
                    </div>

                    <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
                      {[
                        ['', `Todas (${fazendasBI.length})`, '#5c7568', '#F4F7F5'],
                        ['concluida', `✅ Concluídas (${qtdConcluidas})`, '#00A86B', '#e3f7ec'],
                        ['parcial', `🟡 Parciais (${qtdParciais})`, '#a3690a', '#fff3e0'],
                        ['nao_iniciada', `⬜ Não iniciadas (${qtdNaoIniciadas})`, '#5c7568', '#F4F7F5'],
                      ].map(([val,label,cor,bg])=>(
                        <button key={val} style={{background:fzStatusFiltro===val?cor:bg,color:fzStatusFiltro===val?'#fff':cor,border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                          onClick={()=>setFzStatusFiltro(val)}>{label}</button>
                      ))}
                    </div>

                    {fazendasBIFiltradas.length===0 ? (
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:40,textAlign:'center',color:'#5c7568'}}>
                        Nenhuma fazenda encontrada.
                      </div>
                    ) : (
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
                        {fazendasBIFiltradas.map(fz=>(
                          <div key={fz.id} style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:14}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                              <div>
                                <div style={{fontWeight:700,fontSize:14}}>🌾 {fz.nome}</div>
                                <div style={{fontSize:11,color:'#5c7568'}}>{fz.cliente}{fz.produto?` · ${fz.produto}`:''}</div>
                              </div>
                              {fz.pct!==null && fz.numVoos>0 && (
                                <button style={{background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:15,padding:'4px 8px',fontSize:10,cursor:'pointer'}}
                                  onClick={()=>zerarProgresso(fz)}>🔄 Zerar</button>
                              )}
                            </div>
                            {fz.pct===null ? (
                              <div style={{fontSize:12,color:'#aaa',fontStyle:'italic'}}>Sem talhões cadastrados com área</div>
                            ) : (
                              <>
                                <div style={{background:'#eef5f0',borderRadius:20,height:8,overflow:'hidden',marginBottom:6}}>
                                  <div style={{width:`${fz.pct}%`,height:'100%',background:fz.pct>=100?'#00A86B':'#ffb020',borderRadius:20}}/>
                                </div>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                                  <span style={{color:'#5c7568'}}>{fz.areaRealizada.toFixed(1)} / {fz.areaTotal.toFixed(1)} ha</span>
                                  <span style={{fontWeight:700,color:'#00A86B'}}>{fz.pct.toFixed(0)}%</span>
                                </div>
                                {fz.campanha_inicio && <div style={{fontSize:10,color:'#aaa',marginTop:4}}>Ciclo desde {new Date(fz.campanha_inicio).toLocaleDateString('pt-BR')}</div>}
                                {fz.rankingPilotos.length>0 && (
                                  <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #F4F7F5'}}>
                                    <div style={{fontSize:9,fontWeight:700,color:'#7ba38f',letterSpacing:.3,marginBottom:4}}>QUEM FEZ</div>
                                    {fz.rankingPilotos.map(([nome,area])=>(
                                      <div key={nome} style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#5c7568',padding:'2px 0'}}>
                                        <span>{nome}</span>
                                        <span style={{fontWeight:600,color:'#0b1210'}}>{area.toFixed(1)} ha</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                            <button style={{width:'100%',marginTop:10,background:'#F4F7F5',color:'#00A86B',border:'1px solid #d7e6dc',borderRadius:12,padding:'8px 10px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                              onClick={()=>{setRelatorioPeriodoForm({dataIni:'',dataFim:''});setRelatorioPeriodoFz(fz)}}>📄 Relatório do período</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── RELATÓRIO DE ÁREA POR PERÍODO (modal) ── */}
                {relatorioPeriodoFz && (
                  <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,.7)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:14}}
                    onClick={()=>!relatorioPeriodoLoading && setRelatorioPeriodoFz(null)}>
                    <div style={{background:'#fff',borderRadius:20,width:'100%',maxWidth:420,padding:20}} onClick={e=>e.stopPropagation()}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>📄 Relatório do Período</div>
                        <button style={{background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:14,padding:'5px 10px',fontSize:12,cursor:'pointer'}}
                          onClick={()=>setRelatorioPeriodoFz(null)} disabled={!!relatorioPeriodoLoading}>✕</button>
                      </div>
                      <div style={{fontSize:12,color:'#5c7568',marginBottom:16}}>🌾 {relatorioPeriodoFz.nome} — {relatorioPeriodoFz.cliente}</div>
                      <div style={{display:'flex',gap:10,marginBottom:16}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:3}}>DE</div>
                          <input type="date" style={{...sG.fi,width:'100%',boxSizing:'border-box'}} value={relatorioPeriodoForm.dataIni}
                            onChange={e=>setRelatorioPeriodoForm(f=>({...f,dataIni:e.target.value}))}/>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:3}}>ATÉ</div>
                          <input type="date" style={{...sG.fi,width:'100%',boxSizing:'border-box'}} value={relatorioPeriodoForm.dataFim}
                            onChange={e=>setRelatorioPeriodoForm(f=>({...f,dataFim:e.target.value}))}/>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                        {[['7',7],['30',30],['Mês atual','mes']].map(([lbl,val])=>(
                          <button key={lbl} style={{background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:14,padding:'5px 12px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                            onClick={()=>{
                              const hoje=new Date()
                              if(val==='mes'){
                                const ini=new Date(hoje.getFullYear(),hoje.getMonth(),1)
                                setRelatorioPeriodoForm({dataIni:ini.toISOString().slice(0,10),dataFim:hoje.toISOString().slice(0,10)})
                              } else {
                                const ini=new Date(hoje); ini.setDate(ini.getDate()-val)
                                setRelatorioPeriodoForm({dataIni:ini.toISOString().slice(0,10),dataFim:hoje.toISOString().slice(0,10)})
                              }
                            }}>{val==='mes'?lbl:`Últimos ${lbl}d`}</button>
                        ))}
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:16}}>
                        <button style={{flex:1,background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:relatorioPeriodoLoading?.6:1}}
                          disabled={!!relatorioPeriodoLoading}
                          onClick={()=>gerarRelatorioPeriodo(relatorioPeriodoFz,relatorioPeriodoForm.dataIni,relatorioPeriodoForm.dataFim,'pdf')}>
                          {relatorioPeriodoLoading==='pdf'?'Gerando...':'📄 Baixar PDF'}
                        </button>
                        <button style={{flex:1,background:'#25D366',color:'#fff',border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:relatorioPeriodoLoading?.6:1}}
                          disabled={!!relatorioPeriodoLoading}
                          onClick={()=>gerarRelatorioPeriodo(relatorioPeriodoFz,relatorioPeriodoForm.dataIni,relatorioPeriodoForm.dataFim,'whats')}>
                          {relatorioPeriodoLoading==='whats'?'Gerando...':'📲 WhatsApp'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── FAZENDAS & TALHÕES (cadastro) ── */}
                {fzTab==='fazendas' && (
                  <div>
                    {invFazendas.length>0 && (
                      <div style={{background:'#fff',borderRadius:16,border:'1px solid #dcebe3',padding:12,marginBottom:16,display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
                        <div style={{flex:'2 1 220px'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:3}}>BUSCAR</div>
                          <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            placeholder="🔍 Cliente ou fazenda..." value={fzSearch} onChange={e=>setFzSearch(e.target.value)}/>
                        </div>
                        <div style={{flex:'1 1 180px'}}>
                          <MultiSelectDropdown label="Cliente" options={[...new Set(invFazendas.map(f=>f.cliente).filter(Boolean))].sort()}
                            selected={fzClienteFiltro?[fzClienteFiltro]:[]}
                            onChange={arr=>setFzClienteFiltro(arr.length?arr[arr.length-1]:'')}/>
                        </div>
                        <div style={{flex:'1 1 180px'}}>
                          <MultiSelectDropdown label="Produto" options={['Inseticida','Herbicida','Fungicida']}
                            selected={fzProdutoFiltro?[fzProdutoFiltro]:[]}
                            onChange={arr=>setFzProdutoFiltro(arr.length?arr[arr.length-1]:'')}/>
                        </div>
                        {(fzSearch||fzClienteFiltro||fzProdutoFiltro) && (
                          <button style={{background:'none',border:'1px solid #e0b0a8',color:'#e5484d',borderRadius:12,padding:'8px 12px',fontSize:12,cursor:'pointer'}}
                            onClick={()=>{setFzSearch('');setFzClienteFiltro('');setFzProdutoFiltro('')}}>✕ Limpar</button>
                        )}
                      </div>
                    )}

                    {invFazendas.length===0 ? (
                      <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:40,textAlign:'center',color:'#5c7568'}}>
                        Nenhuma fazenda cadastrada ainda.<br/>Clique em "+ Nova Fazenda" para começar.
                      </div>
                    ) : (()=>{
                      if (q && fazendasFiltradas.length===0) return (
                        <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:30,textAlign:'center',color:'#5c7568',fontSize:13}}>
                          Nenhuma fazenda encontrada para "{fzSearch}".
                        </div>
                      )
                      return [...new Set(fazendasFiltradas.map(f=>f.cliente))].map(cli=>(
                        <div key={cli} style={{marginBottom:20}}>
                          <div style={{display:'inline-block',fontSize:12,fontWeight:700,color:'#fff',background:'#00A86B',marginBottom:10,padding:'4px 12px',borderRadius:20,fontFamily:"'Syne',sans-serif"}}>🏢 {cli}</div>
                          {fazendasFiltradas.filter(f=>f.cliente===cli).map(fz=>{
                            const talhoesFz = invTalhoes.filter(t=>t.fazenda_id===fz.id)
                            const areaFz = talhoesFz.reduce((a,t)=>a+parseFloat(t.area_ha||0),0)
                            const tf = tlForm[fz.id]||{nome:'',area_ha:''}
                            const aberto = !!fzExpandido[fz.id]
                            return (
                              <div key={fz.id} style={{background:'#fff',borderRadius:16,border:'1px solid #dcebe3',marginBottom:8,boxShadow:'0 2px 8px rgba(11,18,16,0.04)',overflow:'hidden'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',cursor:'pointer'}}
                                  onClick={()=>setFzExpandido(s=>({...s,[fz.id]:!s[fz.id]}))}>
                                  <span style={{fontWeight:700,fontSize:14,display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                                    🌾 {fz.nome}
                                    {fz.produto && <span style={{background:'#e6f0ea',color:'#145c38',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,flexShrink:0}}>{fz.produto}</span>}
                                    <span style={{fontSize:11,color:'#7ba38f',fontWeight:500,flexShrink:0}}>{talhoesFz.length} talhão(ões){areaFz>0?` · ${areaFz.toFixed(1)} ha`:''}</span>
                                  </span>
                                  <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                                    {fz.mapa_pdf_path && (
                                      <button style={{background:'#e3f7ec',color:'#00A86B',border:'none',borderRadius:15,padding:'4px 10px',fontSize:11,cursor:'pointer'}}
                                        onClick={(e)=>{ e.stopPropagation(); setMapaViewerFazenda(fz) }}>🗺️</button>
                                    )}
                                    <button style={{background:'#F4F7F5',color:'#00A86B',border:'none',borderRadius:15,padding:'4px 10px',fontSize:11,cursor:'pointer'}}
                                      onClick={(e)=>{
                                        e.stopPropagation()
                                        setFzForm({cliente:fz.cliente,nome:fz.nome,produto:fz.produto||'',cep:fz.cep||'',lat:fz.lat??'',lng:fz.lng??'',id_fazenda:fz.id_fazenda||'',
                                          mapa_lat_min:fz.mapa_lat_min??'',mapa_lat_max:fz.mapa_lat_max??'',mapa_lng_min:fz.mapa_lng_min??'',mapa_lng_max:fz.mapa_lng_max??''})
                                        setFzEditId(fz.id); setFzMapaFile(null); setFzMapaExistente(fz.mapa_pdf_path||null); setFzModal(true)
                                      }}>✏️</button>
                                    <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:15,padding:'4px 10px',fontSize:11,cursor:'pointer'}}
                                      onClick={async(e)=>{
                                        e.stopPropagation()
                                        if(!window.confirm(`Excluir fazenda ${fz.nome} e todos os talhões?`))return
                                        await supabase.from('fazendas').delete().eq('id',fz.id);fetchInventario()
                                      }}>🗑️</button>
                                    <span style={{color:'#aaa',fontSize:11}}>{aberto?'▲':'▼'}</span>
                                  </div>
                                </div>
                                {aberto && (
                                  <div style={{padding:'0 16px 16px'}}>
                                    {(fz.lat&&fz.lng)&&<div style={{fontSize:11,color:'#7ba38f',marginBottom:8}}>📍 {fz.lat}, {fz.lng}{fz.cep?` · CEP ${fz.cep}`:''}</div>}
                                    <div style={{background:'#f9fbfa',borderRadius:14,padding:12}}>
                                      <div style={{fontSize:10,fontWeight:700,color:'#5c7568',marginBottom:8}}>📐 TALHÕES</div>
                                      {talhoesFz.length===0 && <div style={{fontSize:12,color:'#aaa',fontStyle:'italic',marginBottom:8}}>Nenhum talhão cadastrado ainda</div>}
                                      {talhoesFz.map(t=>(
                                        <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#fff',border:'1px solid #eef5f0',borderRadius:8,padding:'7px 10px',marginBottom:5,fontSize:13}}>
                                          <span>📐 {t.nome} {t.area_ha?<strong style={{color:'#00A86B'}}>· {t.area_ha} ha</strong>:''}</span>
                                          <button style={{background:'none',border:'none',color:'#e5484d',cursor:'pointer',fontSize:14}}
                                            onClick={async()=>{await supabase.from('talhoes').delete().eq('id',t.id);fetchInventario()}}>×</button>
                                        </div>
                                      ))}
                                      <div style={{display:'flex',gap:6,marginTop:8}}>
                                        <input style={{border:'1px solid #d7e6dc',borderRadius:7,padding:'6px 8px',fontSize:12,outline:'none',flex:2}}
                                          placeholder="Novo talhão..." value={tf.nome}
                                          onChange={e=>setTlForm(s=>({...s,[fz.id]:{...tf,nome:e.target.value}}))}/>
                                        <input style={{border:'1px solid #d7e6dc',borderRadius:7,padding:'6px 8px',fontSize:12,outline:'none',flex:1}}
                                          placeholder="Área (ha)" type="number" value={tf.area_ha}
                                          onChange={e=>setTlForm(s=>({...s,[fz.id]:{...tf,area_ha:e.target.value}}))}/>
                                        <button style={{background:'#e3f7ec',color:'#00A86B',border:'none',borderRadius:15,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                                          onClick={async()=>{
                                            if(!tf.nome){alert('Nome do talhão');return}
                                            const {error}=await supabase.from('talhoes').insert({fazenda_id:fz.id,nome:tf.nome,area_ha:tf.area_ha?parseFloat(tf.area_ha):null,ativo:true})
                                            if(error){alert('Erro: '+error.message);return}
                                            setTlForm(s=>({...s,[fz.id]:{nome:'',area_ha:''}}));fetchInventario()
                                          }}>+ Add</button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ))
                    })()}

                    {/* MODAL NOVA FAZENDA */}
                    {fzModal && (
                      <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setFzModal(false)}>
                        <div style={{background:'#fff',borderRadius:20,width:'100%',maxWidth:380,padding:22,maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
                          <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>{fzEditId?'🌾 Editar Fazenda':'🌾 Nova Fazenda'}</div>
                          <div style={{display:'flex',flexDirection:'column',gap:12}}>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>CLIENTE</div>
                              <select style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                value={fzForm.cliente} onChange={e=>setFzForm(f=>({...f,cliente:e.target.value}))}>
                                <option value="">Selecione...</option>
                                {invClientes.filter(c=>c.ativo).map(c=><option key={c.id}>{c.nome}</option>)}
                              </select>
                            </div>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>NOME DA FAZENDA</div>
                              <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                placeholder="Ex: Fazenda Jamaica" value={fzForm.nome} onChange={e=>setFzForm(f=>({...f,nome:e.target.value}))}/>
                            </div>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>ID DA FAZENDA (OPCIONAL)</div>
                              <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                placeholder="Preenchimento manual" value={fzForm.id_fazenda} onChange={e=>setFzForm(f=>({...f,id_fazenda:e.target.value}))}/>
                            </div>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>PRODUTO (OPCIONAL)</div>
                              <select style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                value={fzForm.produto} onChange={e=>setFzForm(f=>({...f,produto:e.target.value}))}>
                                <option value="">Selecione...</option>
                                {PRODUTO_FAZENDA_OPTS.map(p=><option key={p}>{p}</option>)}
                              </select>
                            </div>
                            <div style={{borderTop:'1px solid #eef5f0',paddingTop:12}}>
                              <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>CEP (OPCIONAL)</div>
                              <div style={{display:'flex',gap:6}}>
                                <input style={{flex:1,border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                  placeholder="00000-000" value={fzForm.cep} onChange={e=>setFzForm(f=>({...f,cep:e.target.value}))}/>
                                <button style={{background:'#e3f7ec',color:'#00A86B',border:'none',borderRadius:8,padding:'0 12px',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}
                                  disabled={fzGeoLoading} onClick={buscarCoordenadasPorCep}>{fzGeoLoading?'...':'🔍 Buscar coord.'}</button>
                              </div>
                              <div style={{fontSize:10,color:'#aaa',marginTop:4}}>Usado pra puxar a previsão do tempo da fazenda na Agenda</div>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                              <div style={{flex:1}}>
                                <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>LATITUDE</div>
                                <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                  type="number" placeholder="Ex: -22.9068" value={fzForm.lat} onChange={e=>setFzForm(f=>({...f,lat:e.target.value}))}/>
                              </div>
                              <div style={{flex:1}}>
                                <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>LONGITUDE</div>
                                <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                  type="number" placeholder="Ex: -43.1729" value={fzForm.lng} onChange={e=>setFzForm(f=>({...f,lng:e.target.value}))}/>
                              </div>
                            </div>

                            <div style={{borderTop:'1px solid #eef5f0',paddingTop:12}}>
                              <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>🗺️ MAPA DA FAZENDA (OPCIONAL)</div>
                              <div style={{fontSize:11,color:'#7ba38f',marginBottom:8}}>PDF do mapa que a fazenda manda — o piloto vê a posição dele em cima desse mapa durante o voo.</div>
                              <label style={{display:'flex',alignItems:'center',gap:8,border:'1px dashed #d7e6dc',borderRadius:8,padding:'10px 12px',fontSize:12,color:'#5c7568',cursor:'pointer'}}>
                                📄 {fzMapaFile ? fzMapaFile.name : fzMapaExistente ? 'Mapa já cadastrado — escolher outro arquivo' : 'Escolher arquivo PDF...'}
                                <input type="file" accept="application/pdf" style={{display:'none'}} onChange={e=>setFzMapaFile(e.target.files[0]||null)}/>
                              </label>
                              {(fzMapaFile || fzMapaExistente) && (
                                <>
                                  <div style={{fontSize:10,color:'#aaa',margin:'10px 0 6px'}}>Coordenadas dos 4 cantos do mapa (vem no PDF se for georreferenciado, ou peça pra quem gerou o mapa):</div>
                                  <div style={{display:'flex',gap:6,marginBottom:6}}>
                                    <input style={{flex:1,border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 9px',fontSize:12,outline:'none',boxSizing:'border-box'}}
                                      type="number" placeholder="Lat mínima (sul)" value={fzForm.mapa_lat_min} onChange={e=>setFzForm(f=>({...f,mapa_lat_min:e.target.value}))}/>
                                    <input style={{flex:1,border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 9px',fontSize:12,outline:'none',boxSizing:'border-box'}}
                                      type="number" placeholder="Lat máxima (norte)" value={fzForm.mapa_lat_max} onChange={e=>setFzForm(f=>({...f,mapa_lat_max:e.target.value}))}/>
                                  </div>
                                  <div style={{display:'flex',gap:6}}>
                                    <input style={{flex:1,border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 9px',fontSize:12,outline:'none',boxSizing:'border-box'}}
                                      type="number" placeholder="Long mínima (oeste)" value={fzForm.mapa_lng_min} onChange={e=>setFzForm(f=>({...f,mapa_lng_min:e.target.value}))}/>
                                    <input style={{flex:1,border:'1px solid #d7e6dc',borderRadius:8,padding:'7px 9px',fontSize:12,outline:'none',boxSizing:'border-box'}}
                                      type="number" placeholder="Long máxima (leste)" value={fzForm.mapa_lng_max} onChange={e=>setFzForm(f=>({...f,mapa_lng_max:e.target.value}))}/>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <div style={{display:'flex',gap:8,marginTop:20}}>
                            <button style={{flex:1,background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:100,padding:12,fontSize:13,cursor:'pointer'}} onClick={()=>setFzModal(false)}>Cancelar</button>
                            <button style={{flex:2,background:'#00A86B',color:'#fff',border:'none',borderRadius:100,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}} disabled={invSaving} onClick={salvarNovaFazenda}>{fzMapaUploading?'Enviando mapa...':invSaving?'Salvando...':'💾 Salvar'}</button>
                          </div>
                        </div>
                      </div>
                    )}
                    {mapaViewerFazenda && <MapaFazendaViewer supabase={supabase} fazenda={mapaViewerFazenda} onClose={()=>setMapaViewerFazenda(null)}/>}
                  </div>
                )}

                {/* ── CLIENTES (cadastro) ── */}
                {fzTab==='clientes' && (
                  <div>
                    {invClientes.length===0 ? (
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:40,textAlign:'center',color:'#5c7568'}}>
                        Nenhum cliente cadastrado ainda.<br/>Clique em "+ Novo Cliente" para começar.
                      </div>
                    ) : (
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(260px,1fr))',gap:12}}>
                        {invClientes.map(c=>(
                          <div key={c.id} style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:16,position:'relative'}}>
                            {!c.ativo && <span style={{position:'absolute',top:12,right:12,background:'#fee',color:'#e5484d',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>INATIVO</span>}
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:'#0b1210',marginBottom:4}}>🏢 {c.nome}</div>
                            {c.obs && <div style={{fontSize:11,color:'#5c7568',marginBottom:8,fontStyle:'italic'}}>{c.obs}</div>}
                            <div style={{display:'flex',gap:6,marginTop:8}}>
                              <button style={{flex:1,background:'#F4F7F5',color:'#00A86B',border:'none',borderRadius:16,padding:'6px',fontSize:12,cursor:'pointer',fontWeight:600}}
                                onClick={()=>{setClienteForm(initClienteForm(c));setClienteModal(c)}}>✏️ Editar</button>
                              <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:16,padding:'6px 10px',fontSize:12,cursor:'pointer'}}
                                onClick={()=>deletarCliente(c.id)}>🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* MODAL CLIENTE */}
                {clienteModal && (
                  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:400,padding:24}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>
                        {clienteModal==='novo'?'🏢 Novo Cliente':'✏️ Editar Cliente'}
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:12}}>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>NOME DO CLIENTE</div>
                          <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            placeholder="Ex: Raizen - Bonfim" value={clienteForm.nome||''}
                            onChange={e=>setClienteForm(f=>({...f,nome:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>OBSERVAÇÕES</div>
                          <textarea style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',resize:'none',height:60,boxSizing:'border-box'}}
                            value={clienteForm.obs||''} onChange={e=>setClienteForm(f=>({...f,obs:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:6}}>PREÇO POR TIPO DE SERVIÇO (R$/ha)</div>
                          <div style={{display:'flex',gap:8}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:10,color:'#7ba38f',marginBottom:3}}>Catação</div>
                              <input type="number" style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                placeholder="0,00" value={clienteForm.preco_catacao} onChange={e=>setClienteForm(f=>({...f,preco_catacao:e.target.value}))} />
                            </div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:10,color:'#7ba38f',marginBottom:3}}>Área Total</div>
                              <input type="number" style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                placeholder="0,00" value={clienteForm.preco_area_total} onChange={e=>setClienteForm(f=>({...f,preco_area_total:e.target.value}))} />
                            </div>
                          </div>
                          <div style={{fontSize:11,color:'#7ba38f',marginTop:4}}>Usado pra calcular a receita quando o piloto marca o tipo de serviço no voo.</div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setClienteForm(f=>({...f,ativo:!f.ativo}))}>
                          <div style={{width:36,height:20,borderRadius:10,background:clienteForm.ativo?'#00A86B':'#d7e6dc',position:'relative',transition:'all .2s',flexShrink:0}}>
                            <div style={{width:14,height:14,borderRadius:7,background:'#fff',position:'absolute',top:3,left:clienteForm.ativo?19:3,transition:'all .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:'#0b1210'}}>Cliente ativo</span>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:20}}>
                        <button style={{flex:1,background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:18,padding:12,fontSize:13,cursor:'pointer'}}
                          onClick={()=>setClienteModal(null)}>Cancelar</button>
                        <button style={{flex:2,background:'#00A86B',color:'#fff',border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}}
                          disabled={invSaving} onClick={salvarCliente}>{invSaving?'Salvando...':'💾 Salvar'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ===== INCIDENTES ===== */}
          {tab === 'incidentes' && (() => {
            const norm = normIncidenteStatus
            const abertos = incidentes.filter(i=>norm(i.status)==='aberto')
            const emTratativa = incidentes.filter(i=>norm(i.status)==='em_tratativa')
            const fechados = incidentes.filter(i=>norm(i.status)==='fechado')
            const custoTotal = incidentes.reduce((a,i)=>a+(parseFloat(i.custo)||0),0)

            const porTipo = {}
            incidentes.forEach(i=>{ porTipo[i.tipo]=(porTipo[i.tipo]||0)+1 })

            const porPiloto = {}
            incidentes.forEach(i=>{
              const n = i.piloto_nome||'—'
              porPiloto[n] = (porPiloto[n]||0)+1
            })
            const rankingPiloto = Object.entries(porPiloto).sort((a,b)=>b[1]-a[1]).slice(0,5)

            const KpiCard = (label, valor, cor) => (
              <div style={{background:'#fff',borderRadius:14,border:'1px solid #d7e6dc',padding:'12px 16px'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>{label}</div>
                <div style={{fontSize:20,fontWeight:700,color:cor||'#0b1210',fontFamily:"'Syne',sans-serif"}}>{valor}</div>
              </div>
            )

            return (
              <div>
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>⚠️ Incidentes</div>
                  <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>Chamados abertos pelos pilotos — acompanhe, dê andamento e feche</div>
                </div>

                {incidentes.length>0 && (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:10,marginBottom:16}}>
                      {KpiCard('ABERTOS', abertos.length, '#a3690a')}
                      {KpiCard('EM TRATATIVA', emTratativa.length, '#2952a3')}
                      {KpiCard('FECHADOS', fechados.length, '#00A86B')}
                      {KpiCard('CUSTO TOTAL', `R$ ${custoTotal.toFixed(2)}`, '#c0392b')}
                    </div>
                    {(Object.keys(porTipo).length>0 || rankingPiloto.length>0) && (
                      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:18}}>
                        <div style={{flex:1,minWidth:200,background:'#fff',borderRadius:14,border:'1px solid #d7e6dc',padding:14}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:8}}>POR TIPO</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {Object.entries(porTipo).map(([t,n])=>(
                              <span key={t} style={{fontSize:11,fontWeight:600,background:'#F4F7F5',color:'#5c7568',padding:'4px 10px',borderRadius:20}}>{INCIDENTE_TIPO_LABEL[t]||t}: {n}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{flex:1,minWidth:200,background:'#fff',borderRadius:14,border:'1px solid #d7e6dc',padding:14}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:8}}>POR PILOTO</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {rankingPiloto.map(([n,c])=>(
                              <span key={n} style={{fontSize:11,fontWeight:600,background:'#F4F7F5',color:'#5c7568',padding:'4px 10px',borderRadius:20}}>{n}: {c}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {incidentes.length===0 ? (
                  <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:40,textAlign:'center',color:'#5c7568'}}>Nenhum incidente registrado.</div>
                ) : (
                  <>
                    {abertos.map(inc=><IncidenteCard key={inc.id} inc={inc} focoId={incidenteFocoId} supabase={supabase}
                      onToggleFoco={setIncidenteFocoId} onSalvarDetalhes={salvarDetalhesIncidente} onStatusChange={marcarIncidenteStatus}
                      onExcluir={excluirIncidente} onFotoClick={setFotoLightbox}/>)}
                    {emTratativa.map(inc=><IncidenteCard key={inc.id} inc={inc} focoId={incidenteFocoId} supabase={supabase}
                      onToggleFoco={setIncidenteFocoId} onSalvarDetalhes={salvarDetalhesIncidente} onStatusChange={marcarIncidenteStatus}
                      onExcluir={excluirIncidente} onFotoClick={setFotoLightbox}/>)}
                    {fechados.length>0 && (
                      <>
                        <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',margin:'16px 0 8px'}}>FECHADOS</div>
                        {fechados.map(inc=><IncidenteCard key={inc.id} inc={inc} focoId={incidenteFocoId} supabase={supabase}
                          onToggleFoco={setIncidenteFocoId} onSalvarDetalhes={salvarDetalhesIncidente} onStatusChange={marcarIncidenteStatus}
                          onExcluir={excluirIncidente} onFotoClick={setFotoLightbox}/>)}
                      </>
                    )}
                  </>
                )}
                {fotoLightbox && <FotoLightbox supabase={supabase} path={fotoLightbox} bucket="relatorios" onClose={()=>setFotoLightbox(null)} />}
              </div>
            )
          })()}

          {/* ===== CUSTOS (notas de despesa) ===== */}
          {tab === 'custos' && (() => {
            const pilotosDisponiveis = [...new Set(custos.map(c=>c.piloto_nome).filter(Boolean))].sort()
            const relatorioById = {}
            relatorios.forEach(r=>{relatorioById[r.id]=r})

            function relDaNota(c) {
              return c.relatorio_id ? relatorioById[c.relatorio_id]
                : c.ordem_servico ? relatorios.find(r=>r.ordem_servico && r.ordem_servico.toLowerCase()===c.ordem_servico.toLowerCase())
                : null
            }
            function chaveClienteFazenda(c) {
              const rel = relDaNota(c)
              return rel ? `${rel.cliente||'—'} — ${rel.fazenda||'—'}` : 'Sem voo vinculado'
            }
            const clienteFazendaOpcoes = [...new Set(custos.map(chaveClienteFazenda))].sort()

            const custosFiltrados = custos.filter(c=>{
              if(custosFiltros.piloto && c.piloto_nome!==custosFiltros.piloto) return false
              if(custosFiltros.categoria && c.categoria!==custosFiltros.categoria) return false
              if(custosFiltros.clienteFazenda && chaveClienteFazenda(c)!==custosFiltros.clienteFazenda) return false
              if(custosFiltros.dataIni && new Date(c.data)<new Date(custosFiltros.dataIni)) return false
              if(custosFiltros.dataFim && new Date(c.data)>new Date(custosFiltros.dataFim)) return false
              return true
            })

            const totalGeral = custosFiltrados.reduce((a,c)=>a+parseFloat(c.valor||0),0)
            const porCategoria = {}
            custosFiltrados.forEach(c=>{porCategoria[c.categoria]=(porCategoria[c.categoria]||0)+parseFloat(c.valor||0)})
            const maiorCategoria = Object.entries(porCategoria).sort((a,b)=>b[1]-a[1])[0]

            const porPiloto = {}
            custosFiltrados.forEach(c=>{
              const n=c.piloto_nome||'—'
              if(!porPiloto[n]) porPiloto[n]={total:0,qtd:0}
              porPiloto[n].total+=parseFloat(c.valor||0); porPiloto[n].qtd++
            })
            const rankingPiloto = Object.entries(porPiloto).sort((a,b)=>b[1].total-a[1].total)

            // Por Cliente/Fazenda — via o voo vinculado (relatorio_id ou OS em texto)
            const porClienteFazenda = {}
            custosFiltrados.forEach(c=>{
              const chave = chaveClienteFazenda(c)
              if(!porClienteFazenda[chave]) porClienteFazenda[chave]={total:0,qtd:0}
              porClienteFazenda[chave].total+=parseFloat(c.valor||0); porClienteFazenda[chave].qtd++
            })
            const rankingClienteFazenda = Object.entries(porClienteFazenda).sort((a,b)=>b[1].total-a[1].total)

            const categoriaChart = Object.entries(porCategoria).sort((a,b)=>b[1]-a[1]).map(([nome,valor])=>({name:`${CATEGORIA_ICON[nome]||''} ${nome}`,value:parseFloat(valor.toFixed(2))}))
            const CORES_CAT = ['#00A86B','#f2960f','#2f6fed','#8e44ad','#e5484d']

            // Evolução diária no período filtrado
            const porDia = {}
            custosFiltrados.forEach(c=>{
              const key = new Date(c.data).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
              porDia[key] = (porDia[key]||0)+parseFloat(c.valor||0)
            })
            const evolucaoDiaria = Object.entries(porDia)
              .sort((a,b)=>new Date(a[0].split('/').reverse().join('-'))-new Date(b[0].split('/').reverse().join('-')))
              .map(([dia,valor])=>({dia,valor:parseFloat(valor.toFixed(2))}))

            const filtrosAtivos = Object.values(custosFiltros).some(Boolean)

            return (
              <div>
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>💰 Financeiro</div>
                  <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>{custos.length} notas registradas</div>
                </div>

                {/* Sub-abas */}
                <div style={{display:'flex',background:'#eef5f0',borderRadius:16,padding:4,gap:4,marginBottom:16,maxWidth:360}}>
                  <button style={{flex:1,background:custosSubTab==='notas'?'#fff':'transparent',color:custosSubTab==='notas'?'#0b1210':'#5c7568',border:'none',borderRadius:12,padding:'9px 8px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:custosSubTab==='notas'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
                    onClick={()=>setCustosSubTab('notas')}>🧾 Notas de Despesa</button>
                  <button style={{flex:1,background:custosSubTab==='veiculos'?'#fff':'transparent',color:custosSubTab==='veiculos'?'#0b1210':'#5c7568',border:'none',borderRadius:12,padding:'9px 8px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:custosSubTab==='veiculos'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
                    onClick={()=>setCustosSubTab('veiculos')}>🚗 Veículos</button>
                </div>

                {custosSubTab==='notas' && (<>
                {/* Filtros */}
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16,background:'#fff',padding:12,borderRadius:16,border:'1px solid #dcebe3',alignItems:'center'}}>
                  <select style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 160px'}}
                    value={custosFiltros.piloto} onChange={e=>setCustosFiltros(f=>({...f,piloto:e.target.value}))}>
                    <option value="">Todos os pilotos</option>
                    {pilotosDisponiveis.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                  <select style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none',flex:'0 0 160px'}}
                    value={custosFiltros.categoria} onChange={e=>setCustosFiltros(f=>({...f,categoria:e.target.value}))}>
                    <option value="">Todas categorias</option>
                    {CATEGORIA_DESPESA_OPTS.map(([c])=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <select style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 200px'}}
                    value={custosFiltros.clienteFazenda} onChange={e=>setCustosFiltros(f=>({...f,clienteFazenda:e.target.value}))}>
                    <option value="">Todos clientes/fazendas</option>
                    {clienteFazendaOpcoes.map(cf=><option key={cf} value={cf}>{cf}</option>)}
                  </select>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <span style={{fontSize:11,color:'#5c7568'}}>De:</span>
                    <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={custosFiltros.dataIni} onChange={e=>setCustosFiltros(f=>({...f,dataIni:e.target.value}))}/>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <span style={{fontSize:11,color:'#5c7568'}}>Até:</span>
                    <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={custosFiltros.dataFim} onChange={e=>setCustosFiltros(f=>({...f,dataFim:e.target.value}))}/>
                  </div>
                  {filtrosAtivos && (
                    <button style={{background:'none',border:'1px solid #f0b0a8',color:'#e5484d',borderRadius:12,padding:'7px 12px',fontSize:12,cursor:'pointer'}}
                      onClick={()=>setCustosFiltros({piloto:'',categoria:'',clienteFazenda:'',dataIni:'',dataFim:''})}>✕ Limpar</button>
                  )}
                </div>

                {/* KPIs */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)',gap:12,marginBottom:16}}>
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>TOTAL (FILTRADO)</div>
                    <div style={{fontSize:22,fontWeight:700,color:'#00A86B',fontFamily:"'Syne',sans-serif"}}>R$ {totalGeral.toFixed(2)}</div>
                  </div>
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>NOTAS NO PERÍODO</div>
                    <div style={{fontSize:22,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{custosFiltrados.length}</div>
                  </div>
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>MAIOR CATEGORIA</div>
                    <div style={{fontSize:16,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{maiorCategoria?`${CATEGORIA_ICON[maiorCategoria[0]]||''} ${maiorCategoria[0]}`:'—'}</div>
                    {maiorCategoria&&<div style={{fontSize:11,color:'#7ba38f',marginTop:2}}>R$ {maiorCategoria[1].toFixed(2)}</div>}
                  </div>
                </div>

                {/* Ranking por piloto */}
                {rankingPiloto.length>0 && (
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:'18px',marginBottom:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <SecTitle>Total por Piloto</SecTitle>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <thead><tr style={{background:'#F4F7F5'}}>{['Piloto','Notas','Total'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {rankingPiloto.map(([nome,st],i)=>(
                            <tr key={nome} style={{background:i%2===0?'#fff':'#f9fbfa'}}>
                              <td style={{padding:'8px 10px',fontWeight:500}}>{nome}</td>
                              <td style={{padding:'8px 10px',color:'#5c7568'}}>{st.qtd}</td>
                              <td style={{padding:'8px 10px',fontWeight:700,color:'#00A86B'}}>R$ {st.total.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Ranking por Cliente/Fazenda */}
                {rankingClienteFazenda.length>0 && (
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:'18px',marginBottom:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <SecTitle>Total por Cliente / Fazenda</SecTitle>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <thead><tr style={{background:'#F4F7F5'}}>{['Cliente / Fazenda','Notas','Total'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {rankingClienteFazenda.map(([nome,st],i)=>(
                            <tr key={nome} style={{background:custosFiltros.clienteFazenda===nome?'#e3f7ec':i%2===0?'#fff':'#f9fbfa',cursor:'pointer'}}
                              onClick={()=>setCustosFiltros(f=>({...f,clienteFazenda:f.clienteFazenda===nome?'':nome}))}>
                              <td style={{padding:'8px 10px',fontWeight:500,color:nome==='Sem voo vinculado'?'#aaa':'#0b1210',fontStyle:nome==='Sem voo vinculado'?'italic':'normal'}}>{nome}</td>
                              <td style={{padding:'8px 10px',color:'#5c7568'}}>{st.qtd}</td>
                              <td style={{padding:'8px 10px',fontWeight:700,color:'#00A86B'}}>R$ {st.total.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Gráficos: categoria + evolução */}
                {custosFiltrados.length>0 && (
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16,marginBottom:16}}>
                    <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <SecTitle>Por Categoria</SecTitle>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={categoriaChart} cx="50%" cy="50%" outerRadius={70} dataKey="value" nameKey="name" label={({value})=>`R$ ${value}`} labelLine={false} fontSize={9}>
                            {categoriaChart.map((_,i)=><Cell key={i} fill={CORES_CAT[i%CORES_CAT.length]}/>)}
                          </Pie>
                          <Tooltip formatter={(v,name)=>[`R$ ${v.toFixed(2)}`,name]}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <SecTitle>Evolução no Período</SecTitle>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={evolucaoDiaria} margin={{top:5,right:10,left:-20,bottom:5}}>
                          <defs>
                            <linearGradient id="gradCustos" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f2960f" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#f2960f" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eef5f0"/>
                          <XAxis dataKey="dia" tick={{fontSize:10,fill:'#7ba38f'}}/>
                          <YAxis tick={{fontSize:10,fill:'#7ba38f'}}/>
                          <Tooltip formatter={v=>[`R$ ${v.toFixed(2)}`,'Gasto']}/>
                          <Area type="monotone" dataKey="valor" stroke="#f2960f" strokeWidth={2} fill="url(#gradCustos)"/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Lista de notas */}
                {custosFiltrados.length===0 ? (
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:40,textAlign:'center',color:'#5c7568'}}>Nenhuma nota encontrada.</div>
                ) : (
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',overflow:'hidden',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <thead>
                          <tr style={{background:'#F4F7F5'}}>
                            {['Categoria','Piloto','Valor','Data','Voo Vinculado','Foto','Ações'].map(h=>(
                              <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'#5c7568',letterSpacing:.5,borderBottom:'1px solid #d7e6dc',whiteSpace:'nowrap',fontFamily:"'Syne',sans-serif"}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {custosFiltrados.map((c,i)=>{
                            const rel = relDaNota(c)
                            return (
                              <tr key={c.id} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                                <td style={{padding:'11px 14px',borderBottom:'1px solid #eef5f0'}}>
                                  <div style={{fontWeight:600}}>{CATEGORIA_ICON[c.categoria]||'🧾'} {c.categoria}</div>
                                  {c.observacao && <div style={{fontSize:11,color:'#7ba38f',fontStyle:'italic',marginTop:2}}>{c.observacao}</div>}
                                </td>
                                <td style={{padding:'11px 14px',borderBottom:'1px solid #eef5f0'}}>{c.piloto_nome||'—'}</td>
                                <td style={{padding:'11px 14px',borderBottom:'1px solid #eef5f0',fontWeight:700,color:'#00A86B'}}>R$ {parseFloat(c.valor).toFixed(2)}</td>
                                <td style={{padding:'11px 14px',borderBottom:'1px solid #eef5f0',whiteSpace:'nowrap'}}>{new Date(c.data).toLocaleDateString('pt-BR')}</td>
                                <td style={{padding:'11px 14px',borderBottom:'1px solid #eef5f0'}}>
                                  {c.ordem_servico ? (
                                    <span style={{fontSize:11,fontWeight:600,color: rel?'#00A86B':'#f2960f'}}>
                                      {rel?`✅ ${rel.cliente} — ${rel.fazenda}`:`⚠️ OS ${c.ordem_servico} sem voo`}
                                    </span>
                                  ) : <span style={{color:'#c3d4c9'}}>—</span>}
                                </td>
                                <td style={{padding:'11px 14px',borderBottom:'1px solid #eef5f0'}}>
                                  {c.foto_url ? (
                                    <FotoThumb supabase={supabase} path={c.foto_url} bucket="relatorios" onClick={()=>setFotoLightbox(c.foto_url)}/>
                                  ) : <div style={{width:40,height:40,borderRadius:8,background:'#f7fbf8',border:'1px dashed #dcebe3',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#c3d4c9'}}>—</div>}
                                </td>
                                <td style={{padding:'11px 14px',borderBottom:'1px solid #eef5f0',whiteSpace:'nowrap'}}>
                                  {rel && <button title="Ir para o voo" style={sG.iconBtn} onClick={()=>{setSelected(rel);setTab('relatorios')}}>➡️</button>}
                                  <button title="Deletar" style={{...sG.iconBtn,color:'#e5484d'}} onClick={()=>setConfirmDeleteDespesa(c)}>🗑️</button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                </>)}

                {/* LIGHTBOX FOTO DA NOTA */}
                {fotoLightbox && (
                  <FotoLightbox supabase={supabase} path={fotoLightbox} bucket="relatorios" onClose={()=>setFotoLightbox(null)} />
                )}

                {custosSubTab==='veiculos' && (() => {
                  const veicById = {}
                  veiculos.forEach(v=>{veicById[v.id]=v})

                  const viagensF = viagens.filter(vg=>{
                    if(veicFiltros.veiculo && vg.veiculo_id!==veicFiltros.veiculo) return false
                    if(veicFiltros.dataIni && new Date(vg.data)<new Date(veicFiltros.dataIni)) return false
                    if(veicFiltros.dataFim && new Date(vg.data)>new Date(veicFiltros.dataFim)) return false
                    return true
                  })
                  const manutF = manutencoes.filter(m=>{
                    if(veicFiltros.veiculo && m.veiculo_id!==veicFiltros.veiculo) return false
                    if(veicFiltros.dataIni && new Date(m.data)<new Date(veicFiltros.dataIni)) return false
                    if(veicFiltros.dataFim && new Date(m.data)>new Date(veicFiltros.dataFim)) return false
                    return true
                  })
                  const despesasF = custos.filter(c=>{
                    if(!c.veiculo_id) return false
                    if(veicFiltros.veiculo && c.veiculo_id!==veicFiltros.veiculo) return false
                    if(veicFiltros.dataIni && new Date(c.data)<new Date(veicFiltros.dataIni)) return false
                    if(veicFiltros.dataFim && new Date(c.data)>new Date(veicFiltros.dataFim)) return false
                    return true
                  })

                  const totalKm = viagensF.reduce((a,vg)=>a+Math.max(0,(vg.km_final||0)-(vg.km_inicial||0)),0)
                  const totalManut = manutF.reduce((a,m)=>a+parseFloat(m.custo||0),0)
                  const totalDespesas = despesasF.reduce((a,c)=>a+parseFloat(c.valor||0),0)
                  const totalGastoFrota = totalManut+totalDespesas
                  const custoPorKm = totalKm>0 ? totalGastoFrota/totalKm : 0

                  const porVeiculo = {}
                  veiculos.forEach(v=>{ porVeiculo[v.id] = {placa:v.placa, km:0, manut:0, despesa:0} })
                  viagensF.forEach(vg=>{ if(porVeiculo[vg.veiculo_id]) porVeiculo[vg.veiculo_id].km += Math.max(0,(vg.km_final||0)-(vg.km_inicial||0)) })
                  manutF.forEach(m=>{ if(porVeiculo[m.veiculo_id]) porVeiculo[m.veiculo_id].manut += parseFloat(m.custo||0) })
                  despesasF.forEach(c=>{ if(porVeiculo[c.veiculo_id]) porVeiculo[c.veiculo_id].despesa += parseFloat(c.valor||0) })
                  const rankingVeiculo = Object.values(porVeiculo).filter(v=>v.km>0||v.manut>0||v.despesa>0).sort((a,b)=>(b.manut+b.despesa)-(a.manut+a.despesa))

                  const timeline = [
                    ...viagensF.map(vg=>({tipo:'viagem', data:vg.data, id:'vg-'+vg.id, veiculo:veicById[vg.veiculo_id]?.placa||'—', detalhe:`🛣️ ${vg.destino||'Viagem'} · ${Math.max(0,(vg.km_final||0)-(vg.km_inicial||0)).toFixed(0)} km${vg.motorista?` · ${vg.motorista}`:''}${vg.ordem_servico?` · OS ${vg.ordem_servico}`:''}`, valor:null})),
                    ...manutF.map(m=>({tipo:'manutencao', data:m.data, id:'mn-'+m.id, veiculo:veicById[m.veiculo_id]?.placa||'—', detalhe:`🔧 ${m.tipo}${m.km?` · ${parseFloat(m.km).toLocaleString('pt-BR')} km`:''}${m.observacao?` · ${m.observacao}`:''}`, valor:m.custo?parseFloat(m.custo):null})),
                    ...despesasF.map(c=>({tipo:'despesa', data:c.data, id:'ds-'+c.id, veiculo:veicById[c.veiculo_id]?.placa||'—', detalhe:`${CATEGORIA_ICON[c.categoria]||'🧾'} ${c.categoria} · ${c.piloto_nome||'—'}`, valor:parseFloat(c.valor||0)})),
                  ].sort((a,b)=>new Date(b.data)-new Date(a.data))

                  const filtrosVeicAtivos = Object.values(veicFiltros).some(Boolean)

                  return (
                    <div>
                      {/* Filtros */}
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16,background:'#fff',padding:12,borderRadius:16,border:'1px solid #dcebe3',alignItems:'center'}}>
                        <select style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 160px'}}
                          value={veicFiltros.veiculo} onChange={e=>setVeicFiltros(f=>({...f,veiculo:e.target.value}))}>
                          <option value="">Todos os veículos</option>
                          {veiculos.map(v=><option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>)}
                        </select>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontSize:11,color:'#5c7568'}}>De:</span>
                          <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={veicFiltros.dataIni} onChange={e=>setVeicFiltros(f=>({...f,dataIni:e.target.value}))}/>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontSize:11,color:'#5c7568'}}>Até:</span>
                          <input type="date" style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={veicFiltros.dataFim} onChange={e=>setVeicFiltros(f=>({...f,dataFim:e.target.value}))}/>
                        </div>
                        {filtrosVeicAtivos && (
                          <button style={{background:'none',border:'1px solid #f0b0a8',color:'#e5484d',borderRadius:12,padding:'7px 12px',fontSize:12,cursor:'pointer'}}
                            onClick={()=>setVeicFiltros({veiculo:'',dataIni:'',dataFim:''})}>✕ Limpar</button>
                        )}
                      </div>

                      {/* KPIs */}
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>GASTO TOTAL (FROTA)</div>
                          <div style={{fontSize:22,fontWeight:700,color:'#00A86B',fontFamily:"'Syne',sans-serif"}}>R$ {totalGastoFrota.toFixed(2)}</div>
                        </div>
                        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>MANUTENÇÃO</div>
                          <div style={{fontSize:22,fontWeight:700,color:'#f2960f',fontFamily:"'Syne',sans-serif"}}>R$ {totalManut.toFixed(2)}</div>
                        </div>
                        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>KM RODADOS</div>
                          <div style={{fontSize:22,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>{totalKm.toLocaleString('pt-BR')}</div>
                        </div>
                        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:4}}>CUSTO / KM</div>
                          <div style={{fontSize:22,fontWeight:700,color:'#0b1210',fontFamily:"'Syne',sans-serif"}}>R$ {custoPorKm.toFixed(2)}</div>
                        </div>
                      </div>

                      {/* Ranking por veículo */}
                      {rankingVeiculo.length>0 && (
                        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:'18px',marginBottom:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <SecTitle>Total por Veículo</SecTitle>
                          <div style={{overflowX:'auto'}}>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                              <thead><tr style={{background:'#F4F7F5'}}>{['Veículo','Km rodados','Manutenção','Despesas','Total'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'#7ba38f',fontFamily:"'Syne',sans-serif"}}>{h}</th>)}</tr></thead>
                              <tbody>
                                {rankingVeiculo.map(v=>(
                                  <tr key={v.placa} style={{background:'#fff'}}>
                                    <td style={{padding:'8px 10px',fontWeight:500}}>🚗 {v.placa}</td>
                                    <td style={{padding:'8px 10px',color:'#5c7568'}}>{v.km.toLocaleString('pt-BR')} km</td>
                                    <td style={{padding:'8px 10px',color:'#f2960f'}}>R$ {v.manut.toFixed(2)}</td>
                                    <td style={{padding:'8px 10px',color:'#5c7568'}}>R$ {v.despesa.toFixed(2)}</td>
                                    <td style={{padding:'8px 10px',fontWeight:700,color:'#00A86B'}}>R$ {(v.manut+v.despesa).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Linha do tempo */}
                      {timeline.length===0 ? (
                        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:40,textAlign:'center',color:'#5c7568'}}>Nenhum registro de viagem, manutenção ou despesa de veículo encontrado.</div>
                      ) : (
                        <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:'8px 0',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          {timeline.map((ev,i)=>(
                            <div key={ev.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 18px',borderBottom:i<timeline.length-1?'1px solid #f6faf7':'none'}}>
                              <div>
                                <div style={{fontSize:13,fontWeight:600}}>{ev.detalhe}</div>
                                <div style={{fontSize:11,color:'#7ba38f',marginTop:2}}>🚗 {ev.veiculo} · {new Date(ev.data).toLocaleDateString('pt-BR')}</div>
                              </div>
                              {ev.valor!=null && <div style={{fontWeight:700,fontSize:14,color:ev.tipo==='manutencao'?'#f2960f':'#00A86B',fontFamily:"'Syne',sans-serif"}}>R$ {ev.valor.toFixed(2)}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {/* ===== BUSCAR OS ===== */}
          {tab === 'buscaOS' && (() => {
            const q = osSearch.trim().toLowerCase()
            const relEncontrado = q ? relatorios.find(r=>r.ordem_servico && r.ordem_servico.toLowerCase()===q) : null
            const despesasOS = q ? custos.filter(c=>c.ordem_servico && c.ordem_servico.toLowerCase()===q) : []
            const viagensOS = q ? viagens.filter(v=>v.ordem_servico && v.ordem_servico.toLowerCase()===q) : []
            const incidentesOS = q ? incidentes.filter(i=>i.ordem_servico && i.ordem_servico.toLowerCase()===q) : []
            const manutencoesRel = [] // manutenções não são vinculadas por OS (custo de veículo não é por voo)
            const totalDespesas = despesasOS.reduce((a,c)=>a+parseFloat(c.valor||0),0)
            const CAT_ICON = CATEGORIA_ICON
            const tempo = relEncontrado ? calcTempo(relEncontrado.dt_inicio, relEncontrado.dt_fim, relEncontrado.pausas) : null
            const INC_TIPO_LABEL = INCIDENTE_TIPO_LABEL
            const INC_STATUS = INCIDENTE_STATUS

            const ultimasOS = [...relatorios]
              .filter(r=>r.ordem_servico)
              .sort((a,b)=> new Date(b.created_at||b.dt_inicio||0) - new Date(a.created_at||a.dt_inicio||0))
              .slice(0,10)
            const qCliente = osSearchCliente.trim().toLowerCase()
            const resultadosClienteFazenda = qCliente
              ? relatorios.filter(r=>r.ordem_servico && ((r.cliente||'').toLowerCase().includes(qCliente) || (r.fazenda||'').toLowerCase().includes(qCliente)))
                  .sort((a,b)=> new Date(b.created_at||b.dt_inicio||0) - new Date(a.created_at||a.dt_inicio||0))
                  .slice(0,15)
              : []
            const LinhaOS = (r) => (
              <div key={r.id} onClick={()=>{setOsSearch(r.ordem_servico);setOsSearchCliente('')}}
                style={{cursor:'pointer',background:'#f7fbf8',borderRadius:10,padding:'8px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <div style={{fontSize:12}}><b style={{fontFamily:'ui-monospace,monospace'}}>{r.ordem_servico}</b> — {r.cliente} · {r.fazenda}</div>
                <div style={{fontSize:11,color:'#7ba38f'}}>{r.dt_inicio?new Date(r.dt_inicio).toLocaleDateString('pt-BR'):''}</div>
              </div>
            )

            return (
              <div>
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>🔍 Buscar Ordem de Serviço</div>
                  <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>Digite a OS pra ver o voo, as despesas e as viagens vinculadas a ela</div>
                </div>

                <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,marginBottom:18,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                  <input autoFocus style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:12,padding:'12px 14px',fontSize:15,outline:'none',boxSizing:'border-box',fontFamily:'ui-monospace,monospace'}}
                    placeholder="Ex: wcjvee" value={osSearch} onChange={e=>setOsSearch(e.target.value)} />
                </div>

                {!q ? (
                  <div style={{display:'flex',flexDirection:'column',gap:16}}>
                    <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:12}}>🕒 Últimas OS</div>
                      {ultimasOS.length===0 ? <div style={{fontSize:13,color:'#7ba38f'}}>Nenhum voo com OS ainda.</div> : (
                        <div style={{display:'flex',flexDirection:'column',gap:6}}>{ultimasOS.map(LinhaOS)}</div>
                      )}
                    </div>
                    <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:10}}>🔎 Buscar por Cliente/Fazenda</div>
                      <input style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:12,padding:'10px 12px',fontSize:13,outline:'none',boxSizing:'border-box',marginBottom:qCliente?12:0}}
                        placeholder="Ex: Fazenda Santa Rita" value={osSearchCliente} onChange={e=>setOsSearchCliente(e.target.value)} />
                      {qCliente && (
                        resultadosClienteFazenda.length===0
                          ? <div style={{fontSize:13,color:'#7ba38f'}}>Nada encontrado.</div>
                          : <div style={{display:'flex',flexDirection:'column',gap:6}}>{resultadosClienteFazenda.map(LinhaOS)}</div>
                      )}
                    </div>
                  </div>
                ) : !relEncontrado && despesasOS.length===0 && viagensOS.length===0 ? (
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:40,textAlign:'center',color:'#5c7568'}}>Nenhum voo, despesa ou viagem encontrado com a OS "{osSearch}".</div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:16}}>
                    {!relEncontrado && (
                      <div style={{background:'#fff3e0',color:'#7a5200',borderRadius:14,padding:'12px 16px',fontSize:13}}>
                        ⚠️ Não encontrei nenhum voo com essa OS, mas existem notas/viagens vinculadas a ela (abaixo). Confira se digitou certo.
                      </div>
                    )}

                    {relEncontrado && (
                      <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
                          <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>{relEncontrado.cliente} — {relEncontrado.fazenda}</div>
                          <span style={{background:STATUS_BG[relEncontrado.status]||'#F4F7F5',color:STATUS_COLOR[relEncontrado.status]||'#5c7568',fontSize:11,fontWeight:600,padding:'3px 9px',borderRadius:20}}>{STATUS_LABEL[relEncontrado.status]||relEncontrado.status}</span>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:14}}>
                          <div><div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>PILOTO</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.piloto_nome||'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>DRONE</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.drone||'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>ÁREA</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.area_ha?`${relEncontrado.area_ha} ha`:'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>TEMPO</div><div style={{fontSize:13,fontWeight:600}}>{tempo?.total||'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>DATA</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.dt_inicio?new Date(relEncontrado.dt_inicio).toLocaleDateString('pt-BR'):'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>TIPO SERVIÇO</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.tipo_servico==='catacao'?'Catação':relEncontrado.tipo_servico==='area_total'?'Área Total':'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>QTDE VOOS</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.qtd_voos||1}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:'#7ba38f'}}>PRODUTOS</div><div style={{fontSize:13,fontWeight:600}}>{(relEncontrado.produtos||[]).join(', ')||'—'}</div></div>
                        </div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          <button style={{background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}} onClick={()=>{setSelected(relEncontrado);setTab('relatorios')}}>Ver relatório completo</button>
                          <button style={{background:'#22c476',color:'#fff',border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}} onClick={()=>gerarPDF(relEncontrado,null,null,'cliente')}>🟢 PDF Cliente</button>
                        </div>
                      </div>
                    )}

                    <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700}}>💰 Despesas Vinculadas</div>
                        {despesasOS.length>0 && <div style={{fontSize:15,fontWeight:700,color:'#00A86B'}}>Total: R$ {totalDespesas.toFixed(2)}</div>}
                      </div>
                      {despesasOS.length===0 ? <div style={{fontSize:13,color:'#7ba38f'}}>Nenhuma despesa vinculada a essa OS.</div> : (
                        <div style={{display:'flex',flexDirection:'column',gap:8}}>
                          {despesasOS.map(c=>(
                            <div key={c.id} style={{background:'#f7fbf8',borderRadius:12,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6}}>
                              <div>
                                <div style={{fontSize:13,fontWeight:600}}>{CAT_ICON[c.categoria]||'🧾'} {c.categoria} — {c.piloto_nome||'—'}</div>
                                <div style={{fontSize:11,color:'#7ba38f'}}>{new Date(c.data).toLocaleDateString('pt-BR')}{c.observacao?` · ${c.observacao}`:''}</div>
                              </div>
                              <div style={{fontSize:14,fontWeight:700,color:'#00A86B'}}>R$ {parseFloat(c.valor).toFixed(2)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:14}}>🚗 Viagens Vinculadas</div>
                      {viagensOS.length===0 ? <div style={{fontSize:13,color:'#7ba38f'}}>Nenhuma viagem vinculada a essa OS.</div> : (
                        <div style={{display:'flex',flexDirection:'column',gap:8}}>
                          {viagensOS.map(v=>(
                            <div key={v.id} style={{background:'#f7fbf8',borderRadius:12,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6}}>
                              <div>
                                <div style={{fontSize:13,fontWeight:600}}>🚗 {veiculos.find(x=>x.id===v.veiculo_id)?.placa || '—'} — {v.motorista||'—'}</div>
                                <div style={{fontSize:11,color:'#7ba38f'}}>{new Date(v.data).toLocaleDateString('pt-BR')}{v.destino?` · ${v.destino}`:''}</div>
                              </div>
                              <div style={{fontSize:14,fontWeight:700,color:'#2f6fed'}}>{Math.max(0,(v.km_final||0)-(v.km_inicial||0)).toFixed(0)} km</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {incidentesOS.length>0 && (
                      <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:14}}>⚠️ Incidente Vinculado</div>
                        <div style={{display:'flex',flexDirection:'column',gap:8}}>
                          {incidentesOS.map(inc=>{
                            const ST = INC_STATUS[inc.status==='resolvido'?'fechado':inc.status] || INC_STATUS.aberto
                            return (
                              <div key={inc.id} style={{background:'#f7fbf8',borderRadius:12,padding:'10px 14px'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
                                  <div style={{fontSize:13,fontWeight:600}}>{INC_TIPO_LABEL[inc.tipo]||inc.tipo} — {inc.piloto_nome}</div>
                                  <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:ST.bg,color:ST.cor}}>{ST.label}</span>
                                </div>
                                <div style={{fontSize:12,color:'#5c7568',marginBottom:6}}>{inc.descricao}</div>
                                <button style={{background:'none',border:'none',color:'#00A86B',fontSize:12,fontWeight:600,cursor:'pointer',padding:0}}
                                  onClick={()=>{setIncidenteFocoId(inc.id);setTab('incidentes')}}>Ver incidente completo →</button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* ===== AGENDA (voos programados) ===== */}
          {tab === 'agenda' && (() => {
            const fazendasDoCliente = invFazendas.filter(f=>f.cliente===agendaForm.cliente)
            const hoje = new Date(); hoje.setHours(0,0,0,0)

            const fzSelecionada = invFazendas.find(f=>f.cliente===agendaForm.cliente && f.nome===agendaForm.fazenda)
            // Trava de permissão: individual (Usuários > 📍) tem prioridade sobre o time — se o
            // piloto tem alguma fazenda marcada individualmente, só essas valem pra ele, ignorando
            // o time. Sem individual, vale a permissão do time. Sem nenhuma restrição configurada
            // (nem individual nem de time) pra essa fazenda, não trava ninguém.
            const timesPermitidosFazenda = fzSelecionada ? fazendaTimes.filter(ft=>ft.fazenda_id===fzSelecionada.id).map(ft=>ft.time_id) : []
            const pilotoPodeFazenda = (p) => {
              if(!fzSelecionada) return true
              const individuais = pilotoFazendas.filter(pf=>pf.piloto_id===p.id).map(pf=>pf.fazenda_id)
              if(individuais.length>0) return individuais.includes(fzSelecionada.id)
              return timesPermitidosFazenda.length===0 || timesPermitidosFazenda.includes(p.time_id)
            }
            const pilotosAtivos = pilotos.filter(p=>p.ativo!==false && pilotoPodeFazenda(p))
            const talhoesDaFazendaAgenda = fzSelecionada ? invTalhoes.filter(t=>t.fazenda_id===fzSelecionada.id) : []
            const talhoesSelecionadosAgenda = (agendaForm.talhao||'').split(',').map(s=>s.trim()).filter(Boolean)

            // Mesmo cálculo de progresso usado no wizard do piloto — olha os relatórios
            // finalizados dessa fazenda desde o último "zerar" e mostra quanto já foi feito
            // em cada talhão, como se o admin estivesse montando um voo novo.
            function progressoTalhaoAgenda(t) {
              const areaTotal = parseFloat(t.area_ha)||0
              if(areaTotal<=0 || !fzSelecionada) return null
              let areaRealizada = 0
              let bordaduraRealizada = 0
              relatorios.forEach(r=>{
                if(r.status!=='finalizado') return
                if(r.cliente!==fzSelecionada.cliente || r.fazenda!==fzSelecionada.nome) return
                if(fzSelecionada.campanha_inicio && new Date(r.created_at) < new Date(fzSelecionada.campanha_inicio)) return
                const nomesVoo = (r.localizacao||'').split(',').map(s=>s.trim()).filter(Boolean)
                if(!nomesVoo.includes(t.nome)) return
                const somaRegistrada = nomesVoo.reduce((a,n)=>{
                  const tt = talhoesDaFazendaAgenda.find(x=>x.nome===n)
                  return a + (tt?parseFloat(tt.area_ha)||0:0)
                },0)
                const fracao = somaRegistrada>0 ? areaTotal/somaRegistrada : 1/nomesVoo.length
                areaRealizada += areaLiquida(r) * fracao
                bordaduraRealizada += (parseFloat(r.bordadura)||0) * fracao
              })
              const feito = areaRealizada + bordaduraRealizada
              return { areaTotal, areaRealizada, bordaduraRealizada, pct: Math.min(100,(feito/areaTotal)*100) }
            }

            function toggleTalhaoAgenda(nome){
              const novos = talhoesSelecionadosAgenda.includes(nome)
                ? talhoesSelecionadosAgenda.filter(n=>n!==nome)
                : [...talhoesSelecionadosAgenda, nome]
              setAgendaForm(f=>({...f,talhao:novos.join(', ')}))
            }

            // Área usada pra estimar quanto de produto o piloto precisa levar: soma dos
            // talhões marcados, ou — se nenhum talhão foi marcado — a fazenda inteira.
            const areaEstimadaAgenda = talhoesSelecionadosAgenda.length>0
              ? talhoesDaFazendaAgenda.filter(t=>talhoesSelecionadosAgenda.includes(t.nome)).reduce((a,t)=>a+(parseFloat(t.area_ha)||0),0)
              : talhoesDaFazendaAgenda.reduce((a,t)=>a+(parseFloat(t.area_ha)||0),0)

            function qtdEstimadaProduto(nomeProduto, dose) {
              const doseN = parseFloat(String(dose).replace(',','.'))
              if(!doseN || !areaEstimadaAgenda) return null
              const unidade = invProdutos.find(p=>p.nome===nomeProduto)?.unidade || 'L'
              return { qtd: doseN*areaEstimadaAgenda, unidade }
            }

            // Warning de conflito: outro agendamento pendente pra mesma fazenda/talhão
            const conflitosAgenda = agendaForm.cliente && agendaForm.fazenda ? agenda.filter(a=>{
              if(a.status!=='pendente') return false
              if(a.cliente!==agendaForm.cliente || a.fazenda!==agendaForm.fazenda) return false
              if(talhoesSelecionadosAgenda.length===0) return true
              const talhoesA = (a.talhao||'').split(',').map(s=>s.trim()).filter(Boolean)
              if(talhoesA.length===0) return true
              return talhoesA.some(t=>talhoesSelecionadosAgenda.includes(t))
            }) : []

            async function salvarAgendamento(){
              if(!agendaForm.piloto_id||!agendaForm.cliente||!agendaForm.fazenda||!agendaForm.data_prevista){
                showToast('Preencha piloto, cliente, fazenda e data','error'); return
              }
              setAgendaSaving(true)
              try {
                const piloto = pilotos.find(p=>p.id===agendaForm.piloto_id)
                const produtosValidos = agendaForm.produtos.filter(p=>p.produto).map(p=>{
                  const est = qtdEstimadaProduto(p.produto, p.dose)
                  return { produto:p.produto, dose:p.dose||null, qtd_estimada:est?.qtd??null, unidade:est?.unidade??null }
                })
                const { error } = await supabase.from('agendamentos').insert({
                  piloto_id: agendaForm.piloto_id, piloto_nome: piloto?.nome||piloto?.email, time_id: piloto?.time_id||null,
                  cliente: agendaForm.cliente, fazenda: agendaForm.fazenda, talhao: agendaForm.talhao||null,
                  data_prevista: agendaForm.data_prevista,
                  produto: produtosValidos[0]?.produto||null, dose: produtosValidos[0]?.dose||null,
                  produtos: produtosValidos.length?produtosValidos:null,
                  drone: agendaForm.drone||null, veiculo_id: agendaForm.veiculo_id||null,
                  observacao: agendaForm.observacao||null, status:'pendente',
                  ordem_servico: gerarOrdemServico(),
                })
                if(error) throw error
                showToast('📅 Agendamento criado!')
                setAgendaForm({piloto_id:'',cliente:'',fazenda:'',talhao:'',data_prevista:'',produtos:[{produto:'',dose:''}],drone:'',veiculo_id:'',observacao:''})
                fetchAll()
              } catch(e){ showToast('Erro: '+e.message,'error') } finally { setAgendaSaving(false) }
            }

            async function mudarStatus(a,status){
              await supabase.from('agendamentos').update({status}).eq('id',a.id)
              fetchAll()
            }
            async function excluirAgendamento(a){
              if(!window.confirm(`Excluir agendamento de ${a.piloto_nome} em ${a.fazenda}?`)) return
              await supabase.from('agendamentos').delete().eq('id',a.id)
              fetchAll()
            }

            const agendaFiltrada = agenda.filter(a=>{
              if(agendaFiltros.piloto && a.piloto_id!==agendaFiltros.piloto) return false
              if(agendaFiltros.status && a.status!==agendaFiltros.status) return false
              return true
            })

            const STATUS_BADGE = {
              pendente:{ label:'Pendente', bg:'#fff3e0', cor:'#f2960f' },
              concluido:{ label:'Concluído', bg:'#e3f7ec', cor:'#00A86B' },
              cancelado:{ label:'Cancelado', bg:'#fdeaea', cor:'#e5484d' },
              recusado:{ label:'Recusado pelo piloto', bg:'#fdeaea', cor:'#e5484d' },
            }

            const filtroLabelAgenda = [
              agendaFiltros.piloto ? pilotos.find(p=>p.id===agendaFiltros.piloto)?.nome : null,
              agendaFiltros.status ? (STATUS_BADGE[agendaFiltros.status]?.label||agendaFiltros.status) : null,
            ].filter(Boolean).join(' · ') || null

            // Texto pro WhatsApp: cronograma agrupado por dia, na ordem da lista já filtrada.
            function buildTxtAgenda(lista) {
              const fmtDia = v => v ? new Date(v+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit'}) : '—'
              const linha='┄┄┄┄┄┄┄┄┄┄┄┄┄┄'
              let t = `📅 *CRONOGRAMA DE AGENDAMENTOS — OROFLY*\n`
              t += `Gerado em ${new Date().toLocaleString('pt-BR')}\n`
              if(filtroLabelAgenda) t += `Filtro: ${filtroLabelAgenda}\n`
              const porDia = {}
              ;[...lista].sort((a,b)=>new Date(a.data_prevista)-new Date(b.data_prevista)).forEach(a=>{
                (porDia[a.data_prevista] = porDia[a.data_prevista]||[]).push(a)
              })
              Object.entries(porDia).forEach(([dia,itens])=>{
                t += `${linha}\n📆 *${fmtDia(dia)}*\n`
                itens.forEach(a=>{
                  const badge = STATUS_BADGE[a.status]||STATUS_BADGE.pendente
                  t += `• ${a.piloto_nome} — ${a.cliente} / ${a.fazenda}${a.talhao?` (${a.talhao})`:''}\n`
                  if(a.veiculo_id) t += `   🚗 ${veiculos.find(v=>v.id===a.veiculo_id)?.placa||'—'}\n`
                  const produtosLista = a.produtos?.length ? a.produtos : (a.produto?[{produto:a.produto,dose:a.dose}]:[])
                  produtosLista.forEach(p=>{
                    t += `   🧪 ${p.produto}${p.dose?` ${p.dose}`:''}${p.qtd_estimada?` — leva ≈${Number(p.qtd_estimada).toLocaleString('pt-BR',{maximumFractionDigits:2})} ${p.unidade||''}`:''}\n`
                  })
                  t += `   ${badge.label}${a.ordem_servico?` · OS ${a.ordem_servico}`:''}\n`
                })
              })
              return t
            }

            async function exportarAgenda(tipo) {
              if(agendaFiltrada.length===0){ showToast('Nenhum agendamento pra exportar','error'); return }
              setAgendaExportLoading(tipo)
              try {
                const doc = gerarPDFAgenda(agendaFiltrada, { filtroLabel: filtroLabelAgenda })
                const nomeBase = `cronograma-agenda-${new Date().toISOString().slice(0,10)}`
                if(tipo==='whats'){
                  const texto = buildTxtAgenda(agendaFiltrada)
                  const file = new File([doc.output('blob')], `${nomeBase}.pdf`, {type:'application/pdf'})
                  await compartilharNativo({ text: texto, file, filename: `${nomeBase}.pdf`, webFallbackUrl: 'https://wa.me/?text='+encodeURIComponent(texto) })
                } else {
                  await salvarOuCompartilharPdf(doc, `${nomeBase}.pdf`)
                  showToast('✅ PDF do cronograma gerado!')
                }
              } catch(e){ console.error(e); showToast('Erro ao exportar agenda','error') } finally { setAgendaExportLoading('') }
            }

            return (
              <div>
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>📅 Agenda</div>
                  <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>{agenda.filter(a=>a.status==='pendente').length} pendentes · {agenda.length} no total</div>
                </div>

                {/* Novo agendamento */}
                <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:16,marginBottom:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#0b1210',marginBottom:12,fontFamily:"'Syne',sans-serif"}}>+ Novo Agendamento</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                    <select style={{...sG.fi,flex:'1 1 160px'}} value={agendaForm.piloto_id} onChange={e=>setAgendaForm(f=>({...f,piloto_id:e.target.value}))}>
                      <option value="">Piloto...</option>
                      {pilotosAtivos.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                    <select style={{...sG.fi,flex:'1 1 160px'}} value={agendaForm.cliente} onChange={e=>setAgendaForm(f=>({...f,cliente:e.target.value,fazenda:'',talhao:''}))}>
                      <option value="">Cliente...</option>
                      {invClientes.filter(c=>c.ativo).map(c=><option key={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                    {fazendasDoCliente.length>0 ? (
                      <select style={{...sG.fi,flex:'1 1 160px'}} value={agendaForm.fazenda} onChange={e=>setAgendaForm(f=>({...f,fazenda:e.target.value,talhao:''}))}>
                        <option value="">Fazenda...</option>
                        {fazendasDoCliente.map(fz=><option key={fz.id}>{fz.nome}</option>)}
                      </select>
                    ) : (
                      <input style={{...sG.fi,flex:'1 1 160px'}} placeholder="Nome da fazenda" value={agendaForm.fazenda} onChange={e=>setAgendaForm(f=>({...f,fazenda:e.target.value}))}/>
                    )}
                    <input type="date" style={{...sG.fi,flex:'1 1 140px'}} value={agendaForm.data_prevista} onChange={e=>setAgendaForm(f=>({...f,data_prevista:e.target.value}))}/>
                  </div>

                  {talhoesDaFazendaAgenda.length>0 && (
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:10,fontWeight:700,color:'#5c7568',letterSpacing:.5,marginBottom:4}}>TALHÕES (OPCIONAL)</div>
                      <div style={{border:'1px solid #d7e6dc',borderRadius:10,overflow:'hidden',maxHeight:160,overflowY:'auto'}}>
                        {talhoesDaFazendaAgenda.map(t=>{
                          const sel = talhoesSelecionadosAgenda.includes(t.nome)
                          const prog = progressoTalhaoAgenda(t)
                          const finalizado = prog && prog.pct>=100
                          const parcial = prog && prog.pct>0 && prog.pct<100
                          return (
                            <div key={t.id} onClick={()=>toggleTalhaoAgenda(t.nome)}
                              style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',cursor:'pointer',fontSize:12,background:sel?'#e3f7ec':finalizado?'#eafaf0':parcial?'#fff8e6':'#fff',borderBottom:'1px solid #f0f5f2'}}>
                              <div style={{width:14,height:14,borderRadius:4,border:`2px solid ${sel?'#00A86B':'#c3d4c9'}`,background:sel?'#00A86B':'#fff',flexShrink:0}}/>
                              <span style={{flex:1}}>{t.nome}
                                {finalizado&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:'#fff',background:'#00A86B',padding:'1px 6px',borderRadius:20}}>✓ Concluído</span>}
                                {parcial&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:'#a3690a',background:'#ffe9b8',padding:'1px 6px',borderRadius:20}}>{prog.pct.toFixed(0)}%</span>}
                              </span>
                              {t.area_ha&&<span style={{color:'#00A86B',fontWeight:600}}>{t.area_ha} ha</span>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {conflitosAgenda.length>0 && (
                    <div style={{background:'#fff3e0',border:'1px solid #f2960f',borderRadius:10,padding:'8px 12px',marginBottom:8,fontSize:12,color:'#a3690a'}}>
                      ⚠️ Já existe agendamento pendente pra essa fazenda/talhão: {conflitosAgenda.map(c=>`${c.piloto_nome} (${new Date(c.data_prevista+'T12:00:00').toLocaleDateString('pt-BR')})`).join(', ')}
                    </div>
                  )}

                  {areaEstimadaAgenda>0 && (
                    <div style={{fontSize:11,color:'#7ba38f',marginBottom:6}}>📐 Área considerada pra estimativa: {areaEstimadaAgenda.toFixed(1)} ha{talhoesSelecionadosAgenda.length===0&&talhoesDaFazendaAgenda.length>0?' (fazenda inteira — nenhum talhão marcado)':''}</div>
                  )}
                  {agendaForm.produtos.map((p,i)=>{
                    const est = qtdEstimadaProduto(p.produto, p.dose)
                    return (
                      <div key={i} style={{marginBottom:8}}>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          <select style={{...sG.fi,flex:'1 1 160px'}} value={p.produto} onChange={e=>{
                            const prod = invProdutos.find(x=>x.nome===e.target.value)
                            setAgendaForm(f=>{ const arr=[...f.produtos]; arr[i]={...arr[i],produto:e.target.value,dose:prod?.dose_padrao?String(prod.dose_padrao):arr[i].dose}; return {...f,produtos:arr} })
                          }}>
                            <option value="">Produto (opcional)...</option>
                            {invProdutos.filter(x=>x.ativo).map(x=><option key={x.id}>{x.nome}</option>)}
                          </select>
                          <input style={{...sG.fi,flex:'1 1 140px'}} placeholder="Dose (ex: 2 L/ha)" value={p.dose} onChange={e=>setAgendaForm(f=>{ const arr=[...f.produtos]; arr[i]={...arr[i],dose:e.target.value}; return {...f,produtos:arr} })}/>
                          {agendaForm.produtos.length>1 && (
                            <button type="button" style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:10,width:36,cursor:'pointer'}}
                              onClick={()=>setAgendaForm(f=>({...f,produtos:f.produtos.filter((_,idx)=>idx!==i)}))}>✕</button>
                          )}
                        </div>
                        {est && (
                          <div style={{fontSize:11,color:'#00A86B',fontWeight:600,marginTop:3}}>≈ leva {est.qtd.toLocaleString('pt-BR',{maximumFractionDigits:2})} {est.unidade}</div>
                        )}
                      </div>
                    )
                  })}
                  <button type="button" style={{background:'none',border:'1px dashed #c3e0d0',color:'#00A86B',borderRadius:10,padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:8}}
                    onClick={()=>setAgendaForm(f=>({...f,produtos:[...f.produtos,{produto:'',dose:''}]}))}>+ Adicionar produto</button>

                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                    <select style={{...sG.fi,flex:'1 1 160px'}} value={agendaForm.drone} onChange={e=>setAgendaForm(f=>({...f,drone:e.target.value}))}>
                      <option value="">Drone (opcional)...</option>
                      {invDrones.filter(d=>d.ativo!==false).map(d=><option key={d.id} value={d.nome}>{d.nome}</option>)}
                    </select>
                    <select style={{...sG.fi,flex:'1 1 160px'}} value={agendaForm.veiculo_id} onChange={e=>setAgendaForm(f=>({...f,veiculo_id:e.target.value}))}>
                      <option value="">Carro (opcional)...</option>
                      {veiculos.filter(v=>v.ativo!==false).map(v=><option key={v.id} value={v.id}>🚗 {v.placa}{v.modelo?` — ${v.modelo}`:''}</option>)}
                    </select>
                  </div>

                  {agendaForm.drone && agendaForm.data_prevista && (()=>{
                    const conflito = agenda.find(a=>a.status==='pendente' && a.drone===agendaForm.drone && a.data_prevista===agendaForm.data_prevista && a.piloto_id!==agendaForm.piloto_id)
                    return conflito ? (
                      <div style={{background:'#fff3e0',border:'1px solid #f2960f',borderRadius:10,padding:'8px 12px',marginBottom:8,fontSize:12,color:'#a3690a'}}>
                        ⚠️ Esse drone já está agendado pra {conflito.piloto_nome} nesse dia ({conflito.cliente} — {conflito.fazenda}).
                      </div>
                    ) : null
                  })()}

                  {agendaForm.fazenda && agendaForm.data_prevista && (
                    agendaClimaLoading ? (
                      <div style={{fontSize:12,color:'#7ba38f',marginBottom:12}}>🌦️ Buscando previsão do tempo da fazenda...</div>
                    ) : agendaClima?.foraDoAlcance ? (
                      <div style={{fontSize:12,color:'#aaa',marginBottom:12,fontStyle:'italic'}}>Data fora do alcance da previsão (máx. 16 dias)</div>
                    ) : agendaClima ? (
                      <div style={{background:'#F4F7F5',borderRadius:12,padding:'10px 14px',marginBottom:12,display:'flex',flexDirection:'column',gap:8,fontSize:12,color:'#0b1210'}}>
                        <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                          <span>🌦️ <strong>Previsão em {agendaForm.fazenda}:</strong></span>
                          <span>🌡️ {agendaClima.tempMin?.toFixed(0)}° - {agendaClima.tempMax?.toFixed(0)}°C</span>
                          <span>💧 {agendaClima.chuvaProb}% chuva</span>
                          <span>💨 {agendaClima.ventoMax?.toFixed(0)} km/h</span>
                        </div>
                        {agendaClima.deltaTClass && (
                          <div style={{display:'inline-flex',alignItems:'center',gap:5,alignSelf:'flex-start',background:agendaClima.deltaTClass.bg,color:agendaClima.deltaTClass.cor,fontWeight:700,padding:'3px 9px',borderRadius:20}}>
                            {agendaClima.deltaTClass.icon} Delta T {agendaClima.deltaT.toFixed(1)}°C — {agendaClima.deltaTClass.label}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{fontSize:11,color:'#aaa',marginBottom:12,fontStyle:'italic'}}>Essa fazenda não tem coordenadas cadastradas — edite em "Fazendas & Clientes" pra ver a previsão aqui.</div>
                    )
                  )}

                  <input style={{...sG.fi,marginBottom:12}} placeholder="Observação (opcional)" value={agendaForm.observacao} onChange={e=>setAgendaForm(f=>({...f,observacao:e.target.value}))}/>
                  <button style={{...sG.btn,opacity:agendaSaving?.6:1}} disabled={agendaSaving} onClick={salvarAgendamento}>{agendaSaving?'Salvando...':'📅 Agendar'}</button>
                </div>

                {/* Filtros */}
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
                  <select style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={agendaFiltros.piloto} onChange={e=>setAgendaFiltros(f=>({...f,piloto:e.target.value}))}>
                    <option value="">Todos os pilotos</option>
                    {pilotosAtivos.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                  <select style={{border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={agendaFiltros.status} onChange={e=>setAgendaFiltros(f=>({...f,status:e.target.value}))}>
                    <option value="">Todos os status</option>
                    <option value="pendente">Pendente</option>
                    <option value="concluido">Concluído</option>
                    <option value="cancelado">Cancelado</option>
                    <option value="recusado">Recusado pelo piloto</option>
                  </select>
                  <div style={{flex:1}}/>
                  <button style={{background:'#F4F7F5',color:'#00A86B',border:'1px solid #d7e6dc',borderRadius:12,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer',opacity:agendaExportLoading?.6:1}}
                    disabled={!!agendaExportLoading} onClick={()=>exportarAgenda('pdf')}>
                    {agendaExportLoading==='pdf'?'Gerando...':'📄 Exportar PDF'}
                  </button>
                  <button style={{background:'#25D366',color:'#fff',border:'none',borderRadius:12,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer',opacity:agendaExportLoading?.6:1}}
                    disabled={!!agendaExportLoading} onClick={()=>exportarAgenda('whats')}>
                    {agendaExportLoading==='whats'?'Gerando...':'📲 WhatsApp'}
                  </button>
                </div>

                {/* Lista */}
                {agendaFiltrada.length===0 ? (
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #dcebe3',padding:40,textAlign:'center',color:'#5c7568'}}>Nenhum agendamento encontrado.</div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    {agendaFiltrada.map(a=>{
                      const atrasado = a.status==='pendente' && new Date(a.data_prevista)<hoje
                      const badge = STATUS_BADGE[a.status]||STATUS_BADGE.pendente
                      return (
                        <div key={a.id} style={{background:'#fff',borderRadius:18,border:'1px solid #dcebe3',padding:14,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,boxShadow:'0 4px 14px rgba(11,18,16,0.04)'}}>
                          <div>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{fontWeight:700,fontSize:14}}>{a.piloto_nome}</span>
                              <span style={{background:badge.bg,color:badge.cor,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>{badge.label}</span>
                              {atrasado&&<span style={{background:'#fdeaea',color:'#e5484d',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ Atrasado</span>}
                              {a.ordem_servico&&<span style={{background:'#eef5f0',color:'#5c7568',fontFamily:'ui-monospace,monospace',fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20}}>OS {a.ordem_servico}</span>}
                            </div>
                            <div style={{fontSize:12,color:'#5c7568',marginTop:3}}>{a.cliente} — {a.fazenda}{a.talhao?` (${a.talhao})`:''}{a.produto?` · ${a.produto}${a.dose?` ${a.dose}`:''}`:''}{a.drone?` · 🚁 ${a.drone}`:''}</div>
                            <div style={{fontSize:11,color:'#7ba38f',marginTop:2}}>{new Date(a.data_prevista+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'})}</div>
                            {a.observacao&&<div style={{fontSize:11,color:'#5c7568',marginTop:4,fontStyle:'italic'}}>{a.observacao}</div>}
                            {a.status==='recusado'&&a.motivo_recusa&&<div style={{fontSize:11,color:'#e5484d',marginTop:4}}>Motivo: {a.motivo_recusa}</div>}
                          </div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {a.status==='pendente'&&(
                              <>
                                <button style={{background:'#e3f7ec',color:'#00A86B',border:'none',borderRadius:16,padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer'}} onClick={()=>mudarStatus(a,'concluido')}>✓ Concluído</button>
                                <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:16,padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer'}} onClick={()=>mudarStatus(a,'cancelado')}>Cancelar</button>
                              </>
                            )}
                            <button style={{background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:16,padding:'6px 12px',fontSize:11,cursor:'pointer'}} onClick={()=>excluirAgendamento(a)}>🗑️</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {/* ===== PILOTOS ===== */}
          {tab === 'pilotos' && (
            <div>
              <div style={{ marginBottom:18 }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>{isSupervisor?'Equipes':'Gestão de Usuários'}</div>
                <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>{pilotos.length} usuários · {times.length} time(s)</div>
              </div>

              <div style={{display:'flex',background:'#eef5f0',borderRadius:16,padding:4,gap:4,marginBottom:18,maxWidth:320}}>
                <button style={{flex:1,background:usuariosSubTab==='usuarios'?'#fff':'transparent',color:usuariosSubTab==='usuarios'?'#0b1210':'#5c7568',border:'none',borderRadius:12,padding:'8px 10px',fontSize:12,fontWeight:700,cursor:'pointer',boxShadow:usuariosSubTab==='usuarios'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
                  onClick={()=>setUsuariosSubTab('usuarios')}>👥 Usuários</button>
                <button style={{flex:1,background:usuariosSubTab==='equipes'?'#fff':'transparent',color:usuariosSubTab==='equipes'?'#0b1210':'#5c7568',border:'none',borderRadius:12,padding:'8px 10px',fontSize:12,fontWeight:700,cursor:'pointer',boxShadow:usuariosSubTab==='equipes'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
                  onClick={()=>setUsuariosSubTab('equipes')}>🧑‍🤝‍🧑 Equipes</button>
              </div>

              {usuariosSubTab==='equipes' && (
                <div>
                  <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:16,marginBottom:16,display:'flex',gap:8,maxWidth:420}}>
                    <input style={{...sG.input,flex:1}} placeholder="Nome do novo time (ex: Time Norte)" value={novoTimeNome} onChange={e=>setNovoTimeNome(e.target.value)}/>
                    <button style={{...sG.btn,width:'auto',padding:'0 18px'}} onClick={criarTime}>+ Criar</button>
                  </div>
                  {times.length===0 ? (
                    <div style={{background:'#fff',borderRadius:12,border:'1px solid #d7e6dc',padding:30,textAlign:'center',color:'#5c7568',fontSize:13}}>Nenhum time cadastrado ainda.</div>
                  ) : (
                    <div style={{display:'flex',flexDirection:'column',gap:12}}>
                      {times.map(t=>{
                        const membros = pilotos.filter(p=>p.time_id===t.id)
                        const fazendasDoTime = fazendaTimes.filter(ft=>ft.time_id===t.id).map(ft=>ft.fazenda_id)
                        return (
                          <div key={t.id} style={{background:'#fff',borderRadius:16,border:'1px solid #d7e6dc',padding:16}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                              <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700}}>🧑‍🤝‍🧑 {t.nome}</div>
                              <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:16,padding:'4px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>excluirTime(t)}>🗑️ Excluir</button>
                            </div>
                            <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:6}}>PILOTOS ({membros.length})</div>
                            <div style={{fontSize:12,color:'#5c7568',marginBottom:12}}>{membros.length?membros.map(m=>m.nome).join(', '):'Nenhum piloto nesse time ainda — atribua na aba Usuários.'}</div>
                            <div style={{fontSize:11,fontWeight:700,color:'#7ba38f',marginBottom:6}}>FAZENDAS QUE ESSE TIME PODE OPERAR</div>
                            <ChecklistFazendasPorCliente chavePrefixo={t.id} marcadas={fazendasDoTime} onToggle={fzId=>toggleFazendaTime(fzId,t.id)}/>
                            <div style={{fontSize:10,color:'#aaa',marginTop:8}}>Sem nenhuma fazenda marcada = time sem restrição (agendamento e app do piloto mostram tudo, a menos que o piloto tenha permissão individual — ver aba Usuários).</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {usuariosSubTab==='usuarios' && (
              <div style={{ display:'flex', gap:20, flexDirection: isMobile?'column':'row', alignItems:'flex-start' }}>
                <div style={{ background:'#fff', borderRadius:12, border:'1px solid #d7e6dc', padding:20, width: isMobile?'100%':280, flexShrink:0 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700, marginBottom:16 }}>+ Novo usuário</div>
                  <form onSubmit={criarUsuario} style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {[['Nome completo','nome','text','João Silva'],['E-mail','email','email','piloto@email.com'],['Senha','senha','password','Mínimo 6 caracteres']].map(([lbl,key,type,ph]) => (
                      <div key={key}>
                        <div style={sG.label}>{lbl.toUpperCase()}</div>
                        <input style={sG.input} type={type} placeholder={ph} value={newUser[key]} autoComplete="new-password" onChange={e => setNewUser(u => ({ ...u, [key]: e.target.value }))} />
                      </div>
                    ))}
                    <div>
                      <div style={sG.label}>PERFIL</div>
                      <select style={sG.input} value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}>
                        <option value="piloto">🚁 Piloto</option>
                        <option value="supervisor">🧑‍🤝‍🧑 Supervisor</option>
                        <option value="admin">⚙️ Administrador</option>
                      </select>
                    </div>
                    <button type="submit" style={{ ...sG.btn, opacity: criandoUser?.6:1 }} disabled={criandoUser}>{criandoUser?'Criando...':'Criar usuário'}</button>
                  </form>
                </div>
                <div style={{ flex:1, overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', background:'#fff', borderRadius:12, border:'1px solid #d7e6dc', overflow:'hidden' }}>
                    <thead><tr style={{ background:'#F4F7F5' }}>{['Usuário','E-mail','Perfil','Time','Voos','Status','Ações'].map(h => <th key={h} style={{ padding:'10px 13px', textAlign:'left', fontSize:11, fontWeight:700, color:'#5c7568', borderBottom:'1px solid #d7e6dc', fontFamily:"'Syne',sans-serif" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {pilotos.map((p, i) => (
                        <tr key={p.id} style={{ background: i%2===0?'#fff':'#f7fbf8', opacity: p.ativo?1:.5 }}>
                          <td style={sG.td}><div style={{ display:'flex', alignItems:'center', gap:8 }}><div style={{ width:30, height:30, borderRadius:'50%', background: p.role==='admin'?'#faeeda':p.role==='supervisor'?'#eef2fb':'#e3f7ec', color: p.role==='admin'?'#854f0b':p.role==='supervisor'?'#2952a3':'#00A86B', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:12 }}>{p.nome?.[0]?.toUpperCase()||'?'}</div><span style={{ fontWeight:500 }}>{p.nome}</span></div></td>
                          <td style={{ ...sG.td, color:'#5c7568', fontSize:12 }}>{p.email}</td>
                          <td style={sG.td}>
                            {p.id === profile?.id ? (
                              <span style={{ background: p.role==='admin'?'#faeeda':p.role==='supervisor'?'#eef2fb':'#e3f7ec', color: p.role==='admin'?'#854f0b':p.role==='supervisor'?'#2952a3':'#00875A', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{p.role==='admin'?'⚙️ Admin':p.role==='supervisor'?'🧑‍🤝‍🧑 Supervisor':'🚁 Piloto'}</span>
                            ) : (
                              <select style={{...sG.input,padding:'4px 8px',fontSize:11,width:'auto'}} value={p.role||'piloto'} onChange={e=>toggleRoleTo(p,e.target.value)}>
                                <option value="piloto">🚁 Piloto</option>
                                <option value="supervisor">🧑‍🤝‍🧑 Supervisor</option>
                                <option value="admin">⚙️ Admin</option>
                              </select>
                            )}
                          </td>
                          <td style={sG.td}>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <select style={{...sG.input,padding:'4px 8px',fontSize:11,width:'auto'}} value={p.time_id||''} onChange={e=>setUserTime(p,e.target.value||null)}>
                                <option value="">— Sem time —</option>
                                {times.map(t=><option key={t.id} value={t.id}>{t.nome}</option>)}
                              </select>
                              {(()=>{ const n = pilotoFazendas.filter(pf=>pf.piloto_id===p.id).length
                                return (
                                  <button title="Fazendas individuais" style={{background:n>0?'#e3f7ec':'#F4F7F5',color:n>0?'#00A86B':'#5c7568',border:'none',borderRadius:12,padding:'4px 8px',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}
                                    onClick={()=>setPilotoFazendasModal(p)}>📍{n>0?` ${n}`:''}</button>
                                )
                              })()}
                            </div>
                          </td>
                          <td style={{ ...sG.td, fontFamily:"'Syne',sans-serif", fontWeight:700, color:'#00A86B', textAlign:'center' }}>{voosPorPiloto[p.id]||0}</td>
                          <td style={{ ...sG.td }}><span style={{ background: p.ativo?'#e3f7ec':'#fee', color: p.ativo?'#00A86B':'#e5484d', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{p.ativo?'Ativo':'Inativo'}</span></td>
                          <td style={{ ...sG.td, whiteSpace:'nowrap' }}>
                            <button style={{ background: p.ativo?'#fee':'#e3f7ec', color: p.ativo?'#e5484d':'#00A86B', border:'none', borderRadius:16, padding:'5px 10px', fontSize:12, cursor:'pointer', marginRight:4 }} onClick={() => toggleAtivo(p)}>{p.ativo?'Desativar':'Ativar'}</button>
                            <button style={{ background:'#eef2fb', color:'#2952a3', border:'none', borderRadius:16, padding:'5px 10px', fontSize:12, cursor:'pointer', marginRight:4 }} onClick={() => resetarSenha(p)}>🔑 Senha</button>
                            {p.id !== profile?.id && (
                              <button style={{ background:'#fee', color:'#e5484d', border:'none', borderRadius:16, padding:'5px 10px', fontSize:12, cursor:'pointer' }} onClick={() => deletarUsuario(p)}>🗑️ Deletar</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          )}

          {tab === 'configuracoes' && (
            <div>
              <div style={{ marginBottom:18 }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210' }}>⚙️ Configurações do Sistema</div>
                <div style={{ fontSize:12, color:'#5c7568', marginTop:2 }}>Opções globais que afetam o app inteiro.</div>
              </div>

              <div style={{ background:'#fff', borderRadius:14, border:'1px solid #dcebe3', padding:20, marginBottom:16, maxWidth:520 }}>
                <SecTitle>🌦️ Provedor de Dados Meteorológicos</SecTitle>
                <div style={{ fontSize:12.5, color:'#5c7568', marginBottom:14 }}>
                  Escolha qual API alimenta os cards e gráficos da tela de Previsão do Tempo (Temperatura, Chuva, Vento e Delta T). Se o provedor escolhido falhar, o sistema tenta o outro automaticamente antes de mostrar erro.
                </div>
                {weatherProviderCarregando ? (
                  <div style={{ fontSize:12.5, color:'#7ba38f' }}>Carregando...</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {[
                      { id:'meteoblue', label:'Meteoblue', desc:'API Principal (paga, mais precisa)' },
                      { id:'open_meteo', label:'Open-Meteo', desc:'API de Backup (gratuita)' },
                    ].map(op => (
                      <label key={op.id} style={{ display:'flex', alignItems:'center', gap:10, background: weatherProvider===op.id?'#e3f7ec':'#F4F7F5', border: weatherProvider===op.id?'1px solid #00A86B':'1px solid transparent', borderRadius:12, padding:'11px 14px', cursor: weatherProviderSalvando?'default':'pointer', opacity: weatherProviderSalvando?.6:1 }}>
                        <input type="radio" name="weatherProvider" checked={weatherProvider===op.id} disabled={weatherProviderSalvando}
                          onChange={()=>salvarProvedorClima(op.id)} style={{ width:16, height:16, accentColor:'#00A86B', flexShrink:0 }}/>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700, color:'#0b1210' }}>{op.label}</div>
                          <div style={{ fontSize:11, color:'#7ba38f' }}>{op.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #eef5f0', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  {weatherStatusTestando ? (
                    <span style={{ fontSize:12, color:'#7ba38f' }}>🔍 Testando conexão...</span>
                  ) : !weatherStatus ? (
                    <span style={{ fontSize:12, color:'#7ba38f' }}>Status não testado ainda.</span>
                  ) : weatherStatus.estado==='ok' ? (
                    <span style={{ fontSize:12, fontWeight:700, color:'#00A86B', background:'#e3f7ec', borderRadius:20, padding:'5px 12px' }}>🟢 Meteoblue Conectado (API OK)</span>
                  ) : weatherStatus.estado==='backup' ? (
                    <span style={{ fontSize:12, fontWeight:700, color:'#a3690a', background:'#fff3e0', borderRadius:20, padding:'5px 12px' }}>🟡 Usando Open-Meteo (Backup Ativo){weatherStatus.mensagem?` — ${weatherStatus.mensagem}`:''}</span>
                  ) : (
                    <span style={{ fontSize:12, fontWeight:700, color:'#e5484d', background:'#fdeaea', borderRadius:20, padding:'5px 12px' }}>🔴 Erro na Chave Meteoblue: {weatherStatus.mensagem}</span>
                  )}
                  <button onClick={testarConexaoClima} disabled={weatherStatusTestando} style={{ background:'none', border:'none', color:'#00A86B', fontSize:11.5, fontWeight:700, cursor:'pointer', padding:0 }}>🔄 Testar novamente</button>
                </div>
              </div>

              <div style={{ background:'#fff', borderRadius:14, border:'1px solid #dcebe3', padding:20, marginBottom:16, maxWidth:520 }}>
                <SecTitle>📊 Consumo das APIs de Clima (este mês)</SecTitle>
                {!weatherLogStats ? (
                  <div style={{ fontSize:12.5, color:'#7ba38f' }}>Carregando...</div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div style={{ background:'#F4F7F5', borderRadius:12, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#7ba38f', letterSpacing:.5 }}>METEOBLUE</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0b1210' }}>{weatherLogStats.totalMeteoblue}</div>
                      <div style={{ fontSize:10.5, color:'#7ba38f' }}>chamadas</div>
                    </div>
                    <div style={{ background:'#F4F7F5', borderRadius:12, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#7ba38f', letterSpacing:.5 }}>OPEN-METEO</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0b1210' }}>{weatherLogStats.totalOpenMeteo}</div>
                      <div style={{ fontSize:10.5, color:'#7ba38f' }}>chamadas</div>
                    </div>
                    <div style={{ background:'#F4F7F5', borderRadius:12, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#7ba38f', letterSpacing:.5 }}>HOJE</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0b1210' }}>{weatherLogStats.hoje}</div>
                      <div style={{ fontSize:10.5, color:'#7ba38f' }}>chamadas</div>
                    </div>
                    <div style={{ background: weatherLogStats.falhasMes>0?'#fdeaea':'#F4F7F5', borderRadius:12, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:700, color: weatherLogStats.falhasMes>0?'#e5484d':'#7ba38f', letterSpacing:.5 }}>FALHAS</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color: weatherLogStats.falhasMes>0?'#e5484d':'#0b1210' }}>{weatherLogStats.falhasMes}</div>
                      <div style={{ fontSize:10.5, color: weatherLogStats.falhasMes>0?'#e5484d':'#7ba38f' }}>no mês</div>
                    </div>
                  </div>
                )}
                <button onClick={carregarWeatherLogStats} style={{ marginTop:12, background:'none', border:'none', color:'#00A86B', fontSize:11.5, fontWeight:700, cursor:'pointer', padding:0 }}>🔄 Atualizar números</button>
              </div>

              <div style={{ background:'#fff', borderRadius:14, border:'1px solid #dcebe3', padding:20, marginBottom:16, maxWidth:520 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <SecTitle>📜 Repositório de Logs</SecTitle>
                  <button onClick={carregarWeatherLogs} style={{ background:'none', border:'none', color:'#00A86B', fontSize:11.5, fontWeight:700, cursor:'pointer', padding:0, marginBottom:8 }}>🔄</button>
                </div>
                <div style={{ fontSize:11.5, color:'#7ba38f', marginBottom:10 }}>Últimas 20 chamadas às APIs de clima — pra identificar erros sem precisar abrir o painel da Vercel.</div>
                {weatherLogs===null ? (
                  <div style={{ fontSize:12.5, color:'#7ba38f' }}>Carregando...</div>
                ) : weatherLogs.length===0 ? (
                  <div style={{ fontSize:12.5, color:'#7ba38f' }}>Nenhuma chamada registrada ainda.</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:320, overflowY:'auto' }}>
                    {weatherLogs.map((l,i)=>(
                      <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, background: l.sucesso?'#f9fbfa':'#fdeaea', borderRadius:10, padding:'8px 10px', fontSize:11.5 }}>
                        <span style={{ flexShrink:0 }}>{l.sucesso?'✅':'❌'}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, color:'#0b1210' }}>
                            {l.provider==='meteoblue'?'Meteoblue':'Open-Meteo'}
                            <span style={{ fontWeight:400, color:'#7ba38f', marginLeft:6 }}>{new Date(l.criado_em).toLocaleString('pt-BR')}</span>
                          </div>
                          {l.erro && <div style={{ color:'#e5484d', marginTop:2, wordBreak:'break-word' }}>{l.erro}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ background:'#f9fbfa', borderRadius:14, border:'1px dashed #dcebe3', padding:18, maxWidth:520, textAlign:'center', color:'#a9beb1', fontSize:12 }}>
                Mais configurações (idioma, limites globais de vento etc) aparecem aqui conforme forem adicionadas.
              </div>
            </div>
          )}

          {tab === 'agrofinance' && (
            <div>
              <div style={{marginBottom:18}}>
                <div style={{fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#0b1210'}}>💹 Agro Finance</div>
                <div style={{fontSize:12,color:'#5c7568',marginTop:2}}>Calcule o preço ideal para cada aplicação.</div>
              </div>
              <CalculadoraOrcamento calc={calc} setCalc={setCalc} isMobile={isMobile}/>
            </div>
          )}
        </main>
      </div>

      {/* MODAL FAZENDAS INDIVIDUAIS DO PILOTO */}
      {pilotoFazendasModal && (()=>{
        const marcadas = pilotoFazendas.filter(pf=>pf.piloto_id===pilotoFazendasModal.id).map(pf=>pf.fazenda_id)
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,0.55)',zIndex:1500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setPilotoFazendasModal(null)}>
            <div style={{background:'#fff',borderRadius:20,width:'100%',maxWidth:460,maxHeight:'85vh',overflowY:'auto',padding:22}} onClick={e=>e.stopPropagation()}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>📍 Fazendas de {pilotoFazendasModal.nome}</div>
                <button style={{background:'none',border:'none',fontSize:18,color:'#7ba38f',cursor:'pointer'}} onClick={()=>setPilotoFazendasModal(null)}>✕</button>
              </div>
              <p style={{fontSize:12,color:'#5c7568',marginBottom:14,lineHeight:1.5}}>Permissão individual — se marcar alguma fazenda aqui, esse piloto passa a ver <strong>só</strong> essas, ignorando a permissão do time dele. Sem nenhuma marcada, vale a regra do time (ou tudo, se não tiver time).</p>
              <ChecklistFazendasPorCliente chavePrefixo={'piloto-'+pilotoFazendasModal.id} marcadas={marcadas} onToggle={fzId=>toggleFazendaPiloto(fzId,pilotoFazendasModal.id)}/>
              <button style={{width:'100%',marginTop:16,background:'#00A86B',color:'#fff',border:'none',borderRadius:100,padding:12,fontSize:13,fontWeight:700,cursor:'pointer'}} onClick={()=>setPilotoFazendasModal(null)}>Pronto</button>
            </div>
          </div>
        )
      })()}

      {/* MODAL EDITAR */}
      {editModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems: isMobile?'flex-end':'center', justifyContent:'center', padding: isMobile?0:24 }}>
          <div style={{ background:'#fff', borderRadius: isMobile?'20px 20px 0 0':16, width:'100%', maxWidth: isMobile?'100%':920, maxHeight: isMobile?'95vh':'90vh', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'15px 20px', borderBottom:'1px solid #eef5f0', flexShrink:0 }}>
              <span style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700 }}>✏️ Editar Relatório</span>
              <button style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#5c7568' }} onClick={resetEdit}>✕</button>
            </div>
            <div style={{ padding:'16px 20px', overflowY:'auto', flex:1 }}>
              <SecTitle>IDENTIFICAÇÃO</SecTitle>
              <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr 1fr':'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                {[['Cliente','cliente'],['Fazenda','fazenda'],['Área (ha)','area_ha'],['Piloto','piloto_nome'],['Drone','drone']].map(([l,k]) => (
                  <div key={k}><div style={sG.label}>{l.toUpperCase()}</div><input style={sG.input} value={editModal[k]||''} onChange={e => setEditModal(m => ({ ...m, [k]: e.target.value }))} /></div>
                ))}
                <div>
                  <div style={sG.label}>STATUS</div>
                  <select style={sG.input} value={editModal.status||''} onChange={e => setEditModal(m => ({ ...m, status: e.target.value }))}>
                    <option value="rascunho">Rascunho</option><option value="em_operacao">Em operação</option>
                    <option value="pausado">Pausado</option><option value="finalizado">Finalizado</option>
                  </select>
                </div>
              </div>
              <SecTitle>CONDIÇÕES</SecTitle>
              <div style={{ display:'grid', gridTemplateColumns: isMobile?'repeat(3,1fr)':'repeat(6,1fr)', gap:8, marginBottom:8 }}>
                {COND_KEYS.map((k,i) => (<div key={k}><div style={{ ...sG.label, fontSize:9 }}>{COND_LABELS[i]} INI</div><input style={{ ...sG.input, padding:'6px 8px', fontSize:12 }} value={editModal[k+'_i']||''} onChange={e => setEditModal(m => ({ ...m, [k+'_i']: e.target.value }))} /></div>))}
              </div>
              <div style={{ display:'grid', gridTemplateColumns: isMobile?'repeat(3,1fr)':'repeat(6,1fr)', gap:8, marginBottom:14 }}>
                {COND_KEYS.map((k,i) => (<div key={k+'f'}><div style={{ ...sG.label, fontSize:9 }}>{COND_LABELS[i]} FIM</div><input style={{ ...sG.input, padding:'6px 8px', fontSize:12 }} value={editModal[k+'_f']||''} onChange={e => setEditModal(m => ({ ...m, [k+'_f']: e.target.value }))} /></div>))}
              </div>
              <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr':'1fr 1fr', gap:10, marginBottom:14 }}>
                {[['Obs 1','obs1'],['Obs 2','obs2']].map(([l,k]) => (<div key={k}><div style={sG.label}>{l}</div><textarea style={{ ...sG.input, resize:'none', minHeight:56 }} value={editModal[k]||''} onChange={e => setEditModal(m => ({ ...m, [k]: e.target.value }))} /></div>))}
              </div>
              <SecTitle>FOTOS</SecTitle>
              <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr':'1fr 1fr', gap:14 }}>
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <div style={sG.label}>MAPA</div>
                    {(editFotoMapa || editModal.foto_mapa_url) && (
                      <button style={{ background:'none', border:'none', color:'#e5484d', fontSize:11, cursor:'pointer', padding:'2px 6px' }}
                        onClick={async () => {
                          if (editModal.foto_mapa_url && !editFotoMapaFile) {
                            await supabase.storage.from('relatorios').remove([editModal.foto_mapa_url])
                            setEditModal(m => ({ ...m, foto_mapa_url: null }))
                          }
                          setEditFotoMapa(null); setEditFotoMapaFile(null)
                          showToast('🗑️ Foto mapa removida')
                        }}>🗑️ Remover</button>
                    )}
                  </div>
                  <label style={{ display:'block', border:'1.5px dashed #d7e6dc', borderRadius:10, padding:10, textAlign:'center', cursor:'pointer', marginTop:4 }}>
                    <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setEditFotoMapa(ev.target.result); r.readAsDataURL(f); setEditFotoMapaFile(f) }} />
                    {editFotoMapa ? <img src={editFotoMapa} alt="mapa" style={{ width:'100%', maxHeight:120, objectFit:'cover', borderRadius:8 }} />
                      : editModal.foto_mapa_url ? <StoragePhoto supabase={supabase} path={editModal.foto_mapa_url} bucket="relatorios" />
                      : <div style={{ padding:'16px 0', fontSize:12, color:'#5c7568' }}>🗺️ Clique para adicionar</div>}
                  </label>
                </div>
                <div>
                  <div style={sG.label}>OBSERVAÇÕES</div>
                  <div style={{ display:'flex', gap:8, marginTop:4 }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
                        <label style={{ border:'1.5px dashed #d7e6dc', borderRadius:10, padding:8, textAlign:'center', cursor:'pointer', minHeight:70, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                          <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{const a=[...editObsFotos];a[i]=ev.target.result;setEditObsFotos(a)}; r.readAsDataURL(f); const a=[...editObsFotoFiles];a[i]=f;setEditObsFotoFiles(a) }} />
                          {editObsFotos[i] ? <img src={editObsFotos[i]} alt="" style={{ width:'100%', height:60, objectFit:'cover', borderRadius:6 }} />
                            : editModal.obs_fotos_urls?.[i] ? <StoragePhoto supabase={supabase} path={editModal.obs_fotos_urls[i]} bucket="relatorios" small />
                            : <span style={{ fontSize:18 }}>📷</span>}
                        </label>
                        {(editObsFotos[i] || editModal.obs_fotos_urls?.[i]) && (
                          <button style={{ background:'#fdeaea', color:'#e5484d', border:'none', borderRadius:14, padding:'3px', fontSize:10, cursor:'pointer', width:'100%' }}
                            onClick={async () => {
                              if (editModal.obs_fotos_urls?.[i] && !editObsFotoFiles[i]) {
                                await supabase.storage.from('relatorios').remove([editModal.obs_fotos_urls[i]])
                                const urls = [...(editModal.obs_fotos_urls||[])]
                                urls[i] = null
                                setEditModal(m => ({ ...m, obs_fotos_urls: urls }))
                              }
                              const fotos = [...editObsFotos]; fotos[i] = null; setEditObsFotos(fotos)
                              const files = [...editObsFotoFiles]; files[i] = null; setEditObsFotoFiles(files)
                              showToast('🗑️ Foto removida')
                            }}>🗑️</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* KML */}
              <SecTitle>ARQUIVOS KML</SecTitle>
              <div style={{ marginBottom:8 }}>
                {(editModal.kml_arquivos||[]).length > 0 && (
                  <div style={{ marginBottom:8 }}>
                    {(editModal.kml_arquivos||[]).map((nome, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'#F4F7F5', borderRadius:8, padding:'8px 12px', marginBottom:6, border:'1px solid #d7e6dc' }}>
                        <span>📄</span>
                        <span style={{ flex:1, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nome}</span>
                        {editModal.kml_paths?.[i] && (
                          <button style={{ background:'#2f6fed', color:'#fff', border:'none', borderRadius:14, padding:'4px 10px', fontSize:11, cursor:'pointer' }}
                            onClick={async () => {
                              const { data } = await supabase.storage.from('relatorios').createSignedUrl(editModal.kml_paths[i], 60)
                              if (data?.signedUrl) {
                                const r = await fetch(data.signedUrl); const b = await r.blob()
                                const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; a.click(); URL.revokeObjectURL(a.href)
                              }
                            }}>⬇</button>
                        )}
                        <button style={{ background:'#fdeaea', color:'#e5484d', border:'none', borderRadius:14, padding:'4px 10px', fontSize:11, cursor:'pointer' }}
                          onClick={async () => {
                            // Remove do Storage se tiver path
                            if (editModal.kml_paths?.[i]) {
                              await supabase.storage.from('relatorios').remove([editModal.kml_paths[i]])
                            }
                            const novosNomes = editModal.kml_arquivos.filter((_,j)=>j!==i)
                            const novosPaths = (editModal.kml_paths||[]).filter((_,j)=>j!==i)
                            setEditModal(m => ({ ...m, kml_arquivos: novosNomes, kml_paths: novosPaths }))
                            showToast('🗑️ KML removido')
                          }}>🗑️</button>
                      </div>
                    ))}
                  </div>
                )}
                <label style={{ display:'flex', alignItems:'center', gap:8, border:'1.5px dashed #d7e6dc', borderRadius:10, padding:'10px 14px', cursor:'pointer', fontSize:13, color:'#5c7568' }}>
                  <input type="file" accept=".kml,.kmz" multiple style={{ display:'none' }} onChange={async e => {
                    const files = Array.from(e.target.files)
                    if (!files.length) return
                    showToast('⏳ Enviando KML...')
                    const novosNomes = [...(editModal.kml_arquivos||[])]
                    const novosPaths = [...(editModal.kml_paths||[])]
                    for (const file of files) {
                      const path = `${editModal.piloto_id}/${editModal.id}/kml/${file.name}`
                      await supabase.storage.from('relatorios').upload(path, file, { upsert: true })
                      novosNomes.push(file.name)
                      novosPaths.push(path)
                    }
                    setEditModal(m => ({ ...m, kml_arquivos: novosNomes, kml_paths: novosPaths }))
                    showToast('✅ KML adicionado!')
                  }} />
                  📂 Adicionar KML / KMZ
                </label>
              </div>
            </div>
            <div style={{ borderTop:'1px solid #eef5f0', flexShrink:0 }}>
              {/* Linha de exportação */}
              <div style={{ display:'flex', gap:6, padding:'10px 20px 0', flexWrap:'wrap' }}>
                <div style={{ fontSize:11, color:'#5c7568', width:'100%', marginBottom:4, fontWeight:600 }}>EXPORTAR:</div>
                {[
                  ['🟢 PDF Cliente', '#22c476', 'cliente'],
                  ['📝 Word / Docs', '#2f6fed', 'word'],
                ].map(([label, bg, tipo]) => (
                  <button key={tipo} style={{ background:bg, color:'#fff', border:'none', borderRadius:16, padding:'7px 14px', fontSize:12, cursor:'pointer', fontWeight:600, opacity:saving?.6:1 }}
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true)
                      // Upload fotos novas se houver
                      let fotoMapaUrl = editModal.foto_mapa_url
                      if (editFotoMapaFile) {
                        const path = `${editModal.piloto_id}/${editModal.id}/mapa.jpg`
                        await supabase.storage.from('relatorios').upload(path, editFotoMapaFile, { upsert: true })
                        fotoMapaUrl = path
                      }
                      let obsUrls = [...(editModal.obs_fotos_urls || [null,null,null])]
                      for (let i=0; i<3; i++) {
                        if (editObsFotoFiles[i]) {
                          const path = `${editModal.piloto_id}/${editModal.id}/obs_${i}.jpg`
                          await supabase.storage.from('relatorios').upload(path, editObsFotoFiles[i], { upsert:true })
                          obsUrls[i] = path
                        }
                      }
                      setSaving(false)
                      await gerarPDF({ ...editModal, foto_mapa_url: fotoMapaUrl, obs_fotos_urls: obsUrls }, editFotoMapa, editObsFotos, tipo)
                    }}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Linha de ação */}
              <div style={{ display:'flex', gap:8, padding:'10px 20px 12px' }}>
                <button style={{ ...sG.btn, background:'#F4F7F5', color:'#5c7568', flex:1 }} onClick={resetEdit}>Cancelar</button>
                <button style={{ ...sG.btn, flex:2, opacity:saving?.6:1 }} disabled={saving} onClick={salvarEdicao}>{saving?'Salvando...':'💾 Salvar'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNotifs && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:490 }} onClick={fecharNotificacoes} />
          <div style={{ position:'fixed', top:isMobile?58:20, right:isMobile?10:20, left:isMobile?10:'auto', width:isMobile?'auto':360, maxHeight:460, overflowY:'auto', background:'#fff', borderRadius:16, boxShadow:'0 12px 40px rgba(0,0,0,.25)', zIndex:500, border:'1px solid #d7e6dc' }}>
            <div style={{ padding:'14px 16px', borderBottom:'1px solid #eef5f0', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'#fff', borderRadius:'16px 16px 0 0' }}>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14 }}>🔔 Notificações</div>
              <button onClick={fecharNotificacoes} style={{ background:'transparent', border:'none', fontSize:16, cursor:'pointer', color:'#7ba38f' }}>✕</button>
            </div>
            {notificacoes.length===0 ? (
              <div style={{ padding:24, textAlign:'center', color:'#7ba38f', fontSize:13 }}>Nenhuma notificação ainda</div>
            ) : notificacoes.map(n=>{
              const naoVista = !notifVisto || new Date(n.ts) > new Date(notifVisto)
              return (
                <div key={n.id} onClick={()=>{n.onClick();fecharNotificacoes()}} style={{ padding:'12px 16px', borderBottom:'1px solid #f6faf7', cursor:'pointer', background:naoVista?'#f0faf5':'#fff', display:'flex', gap:10, alignItems:'flex-start' }}>
                  <span style={{ fontSize:16, flexShrink:0 }}>{n.icone}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12.5, color:'#0b1210', fontWeight:naoVista?600:400 }}>{n.texto}</div>
                    <div style={{ fontSize:10, color:'#7ba38f', marginTop:2 }}>{new Date(n.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                  {naoVista && <span style={{ width:8, height:8, borderRadius:'50%', background:'#00A86B', flexShrink:0, marginTop:5 }}/>}
                </div>
              )
            })}
          </div>
        </>
      )}

      {confirmSair && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:380, padding:24 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, marginBottom:10 }}>Sair da conta?</div>
            <p style={{ fontSize:14, marginBottom:18, color:'#5c7568' }}>Você vai precisar entrar de novo com seu e-mail e senha.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...sG.btn, background:'#F4F7F5', color:'#5c7568', flex:1 }} onClick={() => setConfirmSair(false)}>Cancelar</button>
              <button style={{ ...sG.btn, background:'#e5484d', flex:1 }} onClick={signOut}>Sair</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:380, padding:24 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, marginBottom:10 }}>🗑️ Confirmar exclusão</div>
            <p style={{ fontSize:14, marginBottom:6 }}>Deletar relatório de <strong>{confirmDelete.cliente}</strong>?</p>
            <p style={{ fontSize:12, color:'#e5484d', marginBottom:18 }}>Esta ação não pode ser desfeita.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...sG.btn, background:'#F4F7F5', color:'#5c7568', flex:1 }} onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button style={{ ...sG.btn, background:'#e5484d', flex:1 }} onClick={() => deletarRelatorio(confirmDelete.id)}>Deletar</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteDespesa && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:380, padding:24 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, marginBottom:10 }}>🗑️ Confirmar exclusão</div>
            <p style={{ fontSize:14, marginBottom:6 }}>Deletar despesa de <strong>{confirmDeleteDespesa.categoria} — R$ {parseFloat(confirmDeleteDespesa.valor).toFixed(2)}</strong>?</p>
            <p style={{ fontSize:12, color:'#e5484d', marginBottom:18 }}>Esta ação não pode ser desfeita.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...sG.btn, background:'#F4F7F5', color:'#5c7568', flex:1 }} onClick={() => setConfirmDeleteDespesa(null)}>Cancelar</button>
              <button style={{ ...sG.btn, background:'#e5484d', flex:1 }} onClick={() => deletarDespesa(confirmDeleteDespesa.id)}>Deletar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background: toast.type==='error'?'#e5484d':'#0b1210', color:'#fff', padding:'12px 24px', borderRadius:100, fontSize:13, fontWeight:500, zIndex:400, whiteSpace:'nowrap', borderBottom:'3px solid #ffb020', boxShadow:'0 4px 20px rgba(0,0,0,.2)' }}>{toast.msg}</div>}
      {showPerfil && <ProfileModal profile={profile} onClose={()=>setShowPerfil(false)} onSaved={async()=>{await refreshProfile();setShowPerfil(false);showToast('✅ Perfil atualizado!')}}/>}
    </div>
  )
}

function SecTitle({ children }) {
  return <div style={{ fontSize:10, fontWeight:700, color:'#00A86B', letterSpacing:1, marginBottom:8, paddingBottom:4, borderBottom:'1px solid #e3f7ec', fontFamily:"'Syne',sans-serif" }}>{children}</div>
}

// Calculadora de Orçamento de Serviço (Agro Finance) — mesmos campos e fórmulas da
// ferramenta original do Isaque (chimerical-flan-a7ccc2.netlify.app), só que no visual
// claro do Orofly. Fórmulas conferidas número a número contra o print de referência:
// - Baterias = tempoEstimado(h) × custoBateriaHora
// - Deslocamento = (distância×2, ida e volta) × combustível/km
// - Diárias = diária × dias (jornada de 8h/dia, arredondado pra cima)
// - Desgaste = tempoEstimado(h) × desgasteHora
// - Preço sugerido/ha = custo/ha ÷ (1 - margem%)  [markup sobre o PREÇO, não sobre o custo —
//   é por isso que 40% de margem em cima de R$18/ha dá R$30/ha, não R$25/ha]
function CalculadoraOrcamento({ calc, setCalc, isMobile }) {
  const set = (k) => (e) => setCalc(c => ({ ...c, [k]: e.target.value }))
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n }

  const areaTotal = num(calc.areaTotal)
  const rendimento = num(calc.rendimento)
  const distancia = num(calc.distancia)
  const custoBateriaHora = num(calc.custoBateriaHora)
  const combustivelKm = num(calc.combustivelKm)
  const diaria = num(calc.diaria)
  const desgasteHora = num(calc.desgasteHora)
  const margem = num(calc.margem)
  const precoMercado = num(calc.precoMercado)

  const HORAS_POR_DIA = 8 // não veio campo pra isso na ferramenta original — jornada padrão
  const tempoEstimado = rendimento > 0 ? areaTotal / rendimento : 0
  const dias = tempoEstimado > 0 ? Math.max(1, Math.ceil(tempoEstimado / HORAS_POR_DIA)) : 0

  const kmIdaVolta = distancia * 2
  const custoBaterias = tempoEstimado * custoBateriaHora
  const custoDeslocamento = kmIdaVolta * combustivelKm
  const custoDiarias = diaria * dias
  const custoDesgaste = tempoEstimado * desgasteHora
  const custoTotal = custoBaterias + custoDeslocamento + custoDiarias + custoDesgaste
  const custoPorHectare = areaTotal > 0 ? custoTotal / areaTotal : 0
  const margemFrac = Math.min(0.95, Math.max(0, margem / 100))
  const precoSugeridoHa = margemFrac < 1 ? custoPorHectare / (1 - margemFrac) : 0
  const precoFinal = precoSugeridoHa * areaTotal
  const lucroEstimado = precoFinal - custoTotal

  const temDados = areaTotal > 0 && rendimento > 0
  const competitivo = precoMercado > 0 ? precoSugeridoHa <= precoMercado : null
  const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const inputSt = { width: '100%', border: '1px solid #d7e6dc', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, outline: 'none', color: '#0b1210', background: '#F4F7F5', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" }
  const labelSt = { fontSize: 10.5, fontWeight: 700, color: '#7ba38f', letterSpacing: .5, marginBottom: 5, display: 'block' }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #dcebe3', padding: 20 }}>
          <SecTitle>📋 Dados da Aplicação</SecTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelSt}>CLIENTE</label><input style={inputSt} value={calc.cliente} onChange={set('cliente')} placeholder="Nome do cliente" /></div>
            <div><label style={labelSt}>CULTURA</label>
              <select style={inputSt} value={calc.cultura} onChange={set('cultura')}>
                {['Soja', 'Milho', 'Algodão', 'Cana-de-açúcar', 'Café', 'Feijão', 'Trigo', 'Outro'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div><label style={labelSt}>ÁREA TOTAL (HECTARES)</label><input type="number" style={inputSt} value={calc.areaTotal} onChange={set('areaTotal')} placeholder="0" /></div>
            <div><label style={labelSt}>TIPO DE SERVIÇO</label>
              <select style={inputSt} value={calc.tipoServico} onChange={set('tipoServico')}>
                {['Pulverização Agrícola', 'Semeadura / Plantio', 'Mapeamento / Sensoriamento', 'Distribuição de Sólidos', 'Outro'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div><label style={labelSt}>DISTÂNCIA ATÉ O LOCAL (KM)</label><input type="number" style={inputSt} value={calc.distancia} onChange={set('distancia')} placeholder="0" /></div>
            <div><label style={labelSt}>RENDIMENTO ESPERADO (HA/HORA)</label><input type="number" style={inputSt} value={calc.rendimento} onChange={set('rendimento')} placeholder="0" /></div>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #dcebe3', padding: 20 }}>
          <SecTitle>💰 Custos Operacionais</SecTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelSt}>CUSTO BATERIA / HORA (R$)</label><input type="number" style={inputSt} value={calc.custoBateriaHora} onChange={set('custoBateriaHora')} placeholder="0" /></div>
            <div><label style={labelSt}>COMBUSTÍVEL / KM (R$)</label><input type="number" style={inputSt} value={calc.combustivelKm} onChange={set('combustivelKm')} placeholder="0" /></div>
            <div><label style={labelSt}>DIÁRIA / ALIMENTAÇÃO (R$)</label><input type="number" style={inputSt} value={calc.diaria} onChange={set('diaria')} placeholder="0" /></div>
            <div><label style={labelSt}>DESGASTE EQUIPAMENTO / HORA (R$)</label><input type="number" style={inputSt} value={calc.desgasteHora} onChange={set('desgasteHora')} placeholder="0" /></div>
            <div><label style={labelSt}>MARGEM DE LUCRO DESEJADA (%)</label><input type="number" style={inputSt} value={calc.margem} onChange={set('margem')} placeholder="0" /></div>
            <div><label style={labelSt}>PREÇO DE MERCADO/HA (R$) REFERÊNCIA</label><input type="number" style={inputSt} value={calc.precoMercado} onChange={set('precoMercado')} placeholder="0" /></div>
          </div>
        </div>
      </div>

      {!temDados ? (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px dashed #dcebe3', padding: 30, textAlign: 'center', color: '#a9beb1', fontSize: 13 }}>
          Preencha pelo menos Área Total e Rendimento Esperado pra ver o cálculo.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.3fr 1fr', gap: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #dcebe3', padding: 20 }}>
            <SecTitle>📊 Composição do Preço</SecTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
              {[
                ['📐 Área total', `${fmt(areaTotal)} ha`],
                ['⏱️ Tempo estimado', `${tempoEstimado.toFixed(1)}h (${dias} dia${dias === 1 ? '' : 's'})`],
                ['🔋 Baterias', `R$ ${fmt(custoBaterias)}`],
                [`🚙 Deslocamento (${fmt(kmIdaVolta)} km)`, `R$ ${fmt(custoDeslocamento)}`],
                ['🏨 Diárias', `R$ ${fmt(custoDiarias)}`],
                ['🛠️ Desgaste equipamento', `R$ ${fmt(custoDesgaste)}`],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #eef5f0' }}>
                  <span style={{ color: '#5c7568' }}>{l}</span><span style={{ color: '#0b1210' }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', fontWeight: 700 }}>
                <span style={{ color: '#0b1210' }}>Custo Operacional Total</span><span style={{ color: '#0b1210' }}>R$ {fmt(custoTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #eef5f0' }}>
                <span style={{ color: '#5c7568' }}>💵 Custo / hectare</span><span style={{ color: '#0b1210' }}>R$ {fmt(custoPorHectare)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #eef5f0' }}>
                <span style={{ color: '#5c7568' }}>✅ Margem aplicada</span><span style={{ color: '#0b1210' }}>{margem || 0}%</span>
              </div>
              {precoMercado > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #eef5f0' }}>
                  <span style={{ color: '#5c7568' }}>🏷️ Preço mercado (ref.)</span><span style={{ color: '#0b1210' }}>R$ {fmt(precoMercado)}/ha</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 2px', borderTop: '2px solid #00A86B', marginTop: 4 }}>
                <span style={{ fontWeight: 700, color: '#0b1210' }}>💰 PREÇO SUGERIDO / ha</span>
                <span style={{ fontWeight: 800, color: '#00A86B', fontFamily: "'Syne',sans-serif" }}>R$ {fmt(precoSugeridoHa)}</span>
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #dcebe3', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#7ba38f', letterSpacing: 1 }}>PREÇO FINAL SUGERIDO</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: isMobile ? 30 : 36, fontWeight: 800, color: '#00A86B', margin: '8px 0' }}>R$ {fmt(precoFinal)}</div>
            <div style={{ fontSize: 12.5, color: '#5c7568' }}>R$ {fmt(precoSugeridoHa)} / hectare</div>
            <div style={{ fontSize: 11.5, color: '#7ba38f', marginTop: 4 }}>Lucro estimado: R$ {fmt(lucroEstimado)} ({margem || 0}%)</div>
            {competitivo !== null && (
              <div style={{ marginTop: 14, fontSize: 11.5, fontWeight: 700, borderRadius: 20, padding: '6px 14px', background: competitivo ? '#e3f7ec' : '#fff3e0', color: competitivo ? '#00875A' : '#a3690a' }}>
                {competitivo ? '✅ Competitivo — abaixo ou igual ao mercado' : '⚠️ Acima do preço de mercado — avalie a margem'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const INCIDENTE_TIPO_LABEL = {drone:'🚁 Drone',veiculo:'🚗 Veículo',pessoal:'🤕 Pessoal',outro:'❓ Outro'}
const INCIDENTE_STATUS = {
  aberto: { label:'Aberto', bg:'#fff3e0', cor:'#a3690a' },
  em_tratativa: { label:'Em Tratativa', bg:'#e6f1fb', cor:'#2952a3' },
  fechado: { label:'Fechado', bg:'#e3f7ec', cor:'#00A86B' },
}
function normIncidenteStatus(s) { return s==='resolvido' ? 'fechado' : (s||'aberto') } // compat com status antigo, antes da migração

// Componente de módulo (não recriado a cada render do AdminPanel) — se fosse definido
// dentro da aba, qualquer re-render do painel (polling etc.) trocava a identidade da
// função e resetava o estado local (expandido/rascunho) do card no meio do uso.
function IncidenteCard({ inc, focoId, supabase, onToggleFoco, onSalvarDetalhes, onStatusChange, onExcluir, onFotoClick }) {
  const [expandido, setExpandido] = useState(inc.id===focoId)
  const [resolucao, setResolucao] = useState(inc.resolucao||'')
  const [custo, setCusto] = useState(inc.custo!=null?String(inc.custo):'')
  const norm = normIncidenteStatus
  const ST = INCIDENTE_STATUS[norm(inc.status)] || INCIDENTE_STATUS.aberto
  return (
    <div id={`incidente-${inc.id}`} style={{background:'#fff',borderRadius:16,border:inc.id===focoId?'2px solid #00A86B':'1px solid #d7e6dc',padding:16,marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,marginBottom:8}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2,flexWrap:'wrap'}}>
            <span style={{fontSize:13,fontWeight:700}}>{INCIDENTE_TIPO_LABEL[inc.tipo]||inc.tipo}</span>
            <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:ST.bg,color:ST.cor}}>{ST.label}</span>
            {inc.custo!=null && parseFloat(inc.custo)>0 && (
              <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:'#fdeaea',color:'#c0392b'}}>R$ {parseFloat(inc.custo).toFixed(2)}</span>
            )}
          </div>
          <div style={{fontSize:12,color:'#5c7568'}}>{inc.piloto_nome} · {new Date(inc.created_at).toLocaleString('pt-BR')}{inc.ordem_servico?` · OS ${inc.ordem_servico}`:''}</div>
        </div>
        <button style={{background:'#F4F7F5',color:'#5c7568',border:'none',borderRadius:16,padding:'5px 10px',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}
          onClick={()=>{ setExpandido(e=>!e); if(focoId===inc.id) onToggleFoco(null) }}>{expandido?'▲ Fechar':'Detalhes ▼'}</button>
      </div>
      <div style={{fontSize:13,color:'#0b1210',marginBottom:(inc.foto1_url||inc.foto2_url||inc.gps_lat)?10:0}}>{inc.descricao}</div>
      {(inc.foto1_url||inc.foto2_url) && (
        <div style={{display:'flex',gap:8,marginBottom:inc.gps_lat?10:0}}>
          {[inc.foto1_url,inc.foto2_url].filter(Boolean).map((path,i)=>(
            <FotoThumb key={i} supabase={supabase} path={path} bucket="relatorios" onClick={()=>onFotoClick(path)}/>
          ))}
        </div>
      )}
      {inc.gps_lat && inc.gps_lng && (
        <a href={`https://maps.google.com/?q=${inc.gps_lat},${inc.gps_lng}`} target="_blank" rel="noreferrer" style={{fontSize:12,color:'#00A86B',fontWeight:600,textDecoration:'none'}}>📍 Ver localização no Maps</a>
      )}
      {!expandido && inc.resolucao && (
        <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid #f0f5f2',fontSize:12,color:'#5c7568'}}><b style={{color:'#7ba38f'}}>Resolução:</b> {inc.resolucao}</div>
      )}
      {expandido && (
        <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid #f0f5f2'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:4}}>RESOLUÇÃO / ANDAMENTO</div>
          <textarea style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:8,fontSize:12,minHeight:60,marginBottom:10,boxSizing:'border-box',fontFamily:'inherit'}}
            value={resolucao} onChange={e=>setResolucao(e.target.value)} placeholder="O que foi feito / observações..." />
          <div style={{maxWidth:160,marginBottom:12}}>
            <div style={{fontSize:10,fontWeight:700,color:'#7ba38f',marginBottom:4}}>CUSTO (R$)</div>
            <input type="number" step="0.01" style={{width:'100%',border:'1px solid #d7e6dc',borderRadius:8,padding:8,fontSize:12,boxSizing:'border-box'}}
              value={custo} onChange={e=>setCusto(e.target.value)} placeholder="0,00" />
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button style={{background:'#00A86B',color:'#fff',border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}
              onClick={()=>onSalvarDetalhes(inc,resolucao,custo)}>💾 Salvar</button>
            {norm(inc.status)==='aberto' && (
              <button style={{background:'#e6f1fb',color:'#2952a3',border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                onClick={()=>onStatusChange(inc,'em_tratativa')}>▶️ Iniciar Tratativa</button>
            )}
            {norm(inc.status)!=='fechado' && (
              <button style={{background:'#e3f7ec',color:'#00A86B',border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                onClick={()=>onStatusChange(inc,'fechado')}>✅ Fechar</button>
            )}
            {norm(inc.status)==='fechado' && (
              <button style={{background:'#fff3e0',color:'#a3690a',border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                onClick={()=>onStatusChange(inc,'aberto')}>🔄 Reabrir</button>
            )}
            <button style={{background:'#fdeaea',color:'#e5484d',border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer',marginLeft:'auto'}}
              onClick={()=>onExcluir(inc)}>🗑️ Excluir</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FotoThumb({ supabase, path, bucket, onClick }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!path) return
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl)
    })
  }, [path, bucket, supabase])
  if (!url) return <div style={{ width:40, height:40, borderRadius:8, background:'#F4F7F5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:'#7ba38f' }}>⏳</div>
  return <img src={url} alt="foto" onClick={onClick} style={{ width:40, height:40, objectFit:'cover', borderRadius:8, display:'block', cursor:'pointer', border:'1px solid #dcebe3' }} />
}

function FotoLightbox({ supabase, path, bucket, onClose }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    setUrl(null)
    if (!path) return
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl)
    })
  }, [path, bucket, supabase])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function baixar(e) {
    e.stopPropagation()
    try {
      const r = await fetch(url); const b = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = path.split('/').pop() || 'foto.jpg'
      a.click(); URL.revokeObjectURL(a.href)
    } catch { window.open(url, '_blank') }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,0.85)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={onClose}>
      <div style={{maxWidth:500,width:'100%'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
          <button style={{background:'rgba(255,255,255,0.15)',color:'#fff',border:'none',borderRadius:20,width:32,height:32,cursor:'pointer',fontSize:16}} onClick={onClose}>✕</button>
        </div>
        {!url ? (
          <div style={{background:'#fff',borderRadius:12,padding:30,textAlign:'center',color:'#5c7568'}}>⏳ Carregando...</div>
        ) : (
          <>
            <img src={url} alt="foto" style={{width:'100%',maxHeight:'70vh',objectFit:'contain',borderRadius:8,display:'block',background:'#fff'}} onClick={e=>e.stopPropagation()} />
            <div style={{display:'flex',gap:8,marginTop:10}}>
              <button style={{flex:1,background:'rgba(255,255,255,0.15)',color:'#fff',border:'none',borderRadius:14,padding:'10px',fontSize:13,fontWeight:600,cursor:'pointer'}} onClick={onClose}>Fechar</button>
              <button style={{flex:1,background:'#2f6fed',color:'#fff',border:'none',borderRadius:14,padding:'10px',fontSize:13,fontWeight:600,cursor:'pointer'}} onClick={baixar}>⬇ Baixar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StoragePhoto({ supabase, path, bucket, small }) {
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!path) return
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!error && data?.signedUrl) setUrl(data.signedUrl)
      setLoading(false)
    })
  }, [path, bucket, supabase])
  if (loading) return <div style={{ fontSize:10, color:'#5c7568', padding:'8px 0' }}>⏳ carregando...</div>
  if (!url) return <div style={{ fontSize:10, color:'#e5484d', padding:'8px 0' }}>⚠️ Foto não encontrada</div>

  async function baixar(e) {
    e.stopPropagation()
    try {
      const r = await fetch(url); const b = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = path.split('/').pop() || 'foto.jpg'
      a.click(); URL.revokeObjectURL(a.href)
    } catch { window.open(url, '_blank') }
  }

  if (small) return (
    <div style={{ width:'100%' }}>
      <img src={url} alt="foto" style={{ width:'100%', height:60, objectFit:'cover', borderRadius:6, display:'block' }} />
      <div style={{ display:'flex', gap:4, marginTop:4 }}>
        <a href={url} target="_blank" rel="noreferrer"
          style={{ flex:1, background:'#e3f7ec', color:'#00A86B', borderRadius:5, padding:'3px', fontSize:10, textDecoration:'none', textAlign:'center', fontWeight:500 }}
          onClick={e => e.stopPropagation()}>🔍</a>
        <button style={{ flex:1, background:'#2f6fed', color:'#fff', border:'none', borderRadius:5, padding:'3px', fontSize:10, cursor:'pointer', fontWeight:500 }} onClick={baixar}>⬇</button>
      </div>
    </div>
  )

  return (
    <div>
      <img src={url} alt="foto" style={{ width:'100%', maxHeight:130, objectFit:'cover', borderRadius:8, display:'block' }} />
      <div style={{ display:'flex', gap:6, marginTop:6 }}>
        <a href={url} target="_blank" rel="noreferrer"
          style={{ flex:1, background:'#e3f7ec', color:'#00A86B', borderRadius:6, padding:'6px', fontSize:11, textDecoration:'none', textAlign:'center', fontWeight:500 }}
          onClick={e => e.stopPropagation()}>
          🔍 Ver
        </a>
        <button style={{ flex:1, background:'#2f6fed', color:'#fff', border:'none', borderRadius:14, padding:'6px', fontSize:11, cursor:'pointer', fontWeight:500 }} onClick={baixar}>
          ⬇ Baixar
        </button>
      </div>
      <div style={{ fontSize:10, color:'#5c7568', marginTop:4 }}>Clique na área acima para trocar</div>
    </div>
  )
}

// Mapa Leaflet com todos os pontos GPS dos voos
function MapaLeaflet({ relatorios, height = 400, onPontoClick }) {
  const [mapUrl, setMapUrl] = useState(null)
  const urlRef = useRef(null)

  // Iframe é sandboxed (allow-scripts, sem same-origin), então a única forma de avisar o
  // React de um clique num ponto do mapa é via postMessage — não dá pra chamar callback direto.
  useEffect(() => {
    if (!onPontoClick) return
    const handler = (e) => { if (e.data?.oroflyMapClick) onPontoClick(e.data.oroflyMapClick) }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onPontoClick])

  useEffect(() => {
    const pontos = relatorios.filter(r => r.gps_lat && r.gps_lng)
    if (pontos.length === 0) return

    const markers = pontos.map(r => {
      const cor = r.status === 'sos' ? '#e5484d' : r.status === 'em_operacao' ? '#00A86B' : r.status === 'pausado' ? '#f2960f' : '#2f6fed'
      const label = `${(r.cliente||'—').replace(/'/g,"\\'")} — ${(r.piloto_nome||'').replace(/'/g,"\\'")} — ${new Date(r.created_at).toLocaleDateString('pt-BR')}`
      return `L.circleMarker([${r.gps_lat},${r.gps_lng}],{color:'${cor}',fillColor:'${cor}',fillOpacity:0.85,radius:9,weight:2}).bindPopup('${label}').on('click',function(){window.parent.postMessage({oroflyMapClick:'${r.id}'},'*')}).addTo(map)`
    }).join(';\n')

    const center = pontos[Math.floor(pontos.length / 2)]
    const allCoords = `[${pontos.map(r=>`[${r.gps_lat},${r.gps_lng}]`).join(',')}]`

    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
      <style>*{margin:0;padding:0;box-sizing:border-box}html,body,#map{width:100%;height:100%}</style>
    </head><body>
      <div id="map"></div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
        var map = L.map('map',{zoomControl:true}).setView([${center.gps_lat},${center.gps_lng}],11);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri',maxZoom:19}).addTo(map);
        ${markers};
        var coords = ${allCoords};
        if(coords.length>1){map.fitBounds(L.latLngBounds(coords),{padding:[30,30]});}
      </script>
    </body></html>`

    // Revogar URL antiga antes de criar nova
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    urlRef.current = url
    setMapUrl(url)
  }, [relatorios])

  useEffect(() => {
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [])

  if (!mapUrl) return (
    <div style={{ height, background:'#F4F7F5', borderRadius:12, border:'1px solid #d7e6dc', display:'flex', alignItems:'center', justifyContent:'center', color:'#5c7568', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:24 }}>🗺️</div>
      <div style={{ fontSize:13 }}>Carregando mapa...</div>
    </div>
  )

  return (
    <div style={{ background:'#fff', borderRadius:12, border:'1px solid #d7e6dc', overflow:'hidden', marginBottom:16 }}>
      <iframe
        src={mapUrl}
        style={{ width:'100%', height, border:'none', display:'block' }}
        title="Mapa de Voos Orofly"
        sandbox="allow-scripts"
      />
      <div style={{ padding:'8px 14px', background:'#F4F7F5', fontSize:11, color:'#5c7568', display:'flex', gap:16, flexWrap:'wrap' }}>
        <span><span style={{ color:'#2f6fed' }}>●</span> Finalizado</span>
        <span><span style={{ color:'#00A86B' }}>●</span> Em voo</span>
        <span><span style={{ color:'#f2960f' }}>●</span> Pausado</span>
        <span><span style={{ color:'#e5484d' }}>●</span> SOS</span>
        <span style={{ marginLeft:'auto' }}>{relatorios.filter(r=>r.gps_lat).length} voos plotados</span>
      </div>
    </div>
  )
}

// Mapa de Operações: onde os pilotos logaram (azul) e onde iniciaram voos (verde),
// cada ponto com um círculo de 10km — sobreposição indica área de operação concentrada
function MapaOperacoes({ logins, voos, height = 400 }) {
  const [mapUrl, setMapUrl] = useState(null)
  const urlRef = useRef(null)

  useEffect(() => {
    const pontosLogin = (logins||[]).filter(l => l.lat && l.lng)
    const pontosVoo = (voos||[]).filter(v => v.gps_lat && v.gps_lng)
    const todos = [...pontosLogin.map(p=>[p.lat,p.lng]), ...pontosVoo.map(p=>[p.gps_lat,p.gps_lng])]
    if (todos.length === 0) return

    const markersLogin = pontosLogin.map(l => {
      const label = `📍 Login — ${(l.piloto_nome||'—').replace(/'/g,"\\'")} — ${new Date(l.created_at).toLocaleString('pt-BR')}`
      return `L.circleMarker([${l.lat},${l.lng}],{color:'#2f6fed',fillColor:'#2f6fed',fillOpacity:0.9,radius:7,weight:2}).bindPopup('${label}').addTo(map);
              L.circle([${l.lat},${l.lng}],{radius:10000,color:'#2f6fed',weight:1,fillColor:'#2f6fed',fillOpacity:0.05}).addTo(map)`
    }).join(';\n')

    const markersVoo = pontosVoo.map(v => {
      const label = `🚁 Voo — ${(v.cliente||'—').replace(/'/g,"\\'")} — ${(v.piloto_nome||'—').replace(/'/g,"\\'")}`
      return `L.circleMarker([${v.gps_lat},${v.gps_lng}],{color:'#00A86B',fillColor:'#00A86B',fillOpacity:0.9,radius:7,weight:2}).bindPopup('${label}').addTo(map);
              L.circle([${v.gps_lat},${v.gps_lng}],{radius:10000,color:'#00A86B',weight:1,fillColor:'#00A86B',fillOpacity:0.05}).addTo(map)`
    }).join(';\n')

    const center = todos[Math.floor(todos.length / 2)]
    const allCoords = `[${todos.map(c=>`[${c[0]},${c[1]}]`).join(',')}]`

    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
      <style>*{margin:0;padding:0;box-sizing:border-box}html,body,#map{width:100%;height:100%}</style>
    </head><body>
      <div id="map"></div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
        var map = L.map('map',{zoomControl:true}).setView([${center[0]},${center[1]}],10);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri',maxZoom:19}).addTo(map);
        ${markersLogin};
        ${markersVoo};
        var coords = ${allCoords};
        if(coords.length>1){map.fitBounds(L.latLngBounds(coords),{padding:[30,30]});}
      </script>
    </body></html>`

    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    urlRef.current = url
    setMapUrl(url)
  }, [logins, voos])

  useEffect(() => {
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [])

  const pontosLogin = (logins||[]).filter(l => l.lat && l.lng)
  const pontosVoo = (voos||[]).filter(v => v.gps_lat && v.gps_lng)

  if (pontosLogin.length + pontosVoo.length === 0) return (
    <div style={{ textAlign:'center', color:'#5c7568', padding:60, background:'#fff', borderRadius:12, border:'1px solid #d7e6dc' }}>
      <div style={{ fontSize:40, marginBottom:12 }}>📍</div>
      <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Nenhum dado de operação ainda</div>
      <div style={{ fontSize:13 }}>Aparece aqui assim que os pilotos fizerem login com GPS habilitado.</div>
    </div>
  )

  if (!mapUrl) return (
    <div style={{ height, background:'#F4F7F5', borderRadius:12, border:'1px solid #d7e6dc', display:'flex', alignItems:'center', justifyContent:'center', color:'#5c7568', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:24 }}>🗺️</div>
      <div style={{ fontSize:13 }}>Carregando mapa...</div>
    </div>
  )

  return (
    <div style={{ background:'#fff', borderRadius:12, border:'1px solid #d7e6dc', overflow:'hidden', marginBottom:16 }}>
      <iframe
        src={mapUrl}
        style={{ width:'100%', height, border:'none', display:'block' }}
        title="Mapa de Operações Orofly"
        sandbox="allow-scripts"
      />
      <div style={{ padding:'8px 14px', background:'#F4F7F5', fontSize:11, color:'#5c7568', display:'flex', gap:16, flexWrap:'wrap' }}>
        <span><span style={{ color:'#2f6fed' }}>●</span> Login ({pontosLogin.length})</span>
        <span><span style={{ color:'#00A86B' }}>●</span> Início de voo ({pontosVoo.length})</span>
        <span style={{ marginLeft:'auto' }}>Círculos = raio de 10km</span>
      </div>
    </div>
  )
}

function parseKmlCoords(text) {
  const match = text.match(/<coordinates>([\s\S]*?)<\/coordinates>/)
  if (!match) return []
  return match[1].trim().split(/\s+/).map(c => {
    const [lng, lat] = c.split(',').map(Number)
    return { lat, lng }
  }).filter(c => !isNaN(c.lat) && !isNaN(c.lng))
}

function parseKmlMeta(text) {
  const get = (name) => {
    const r = new RegExp(`<Data name="${name}">\\s*<value>([^<]*)<\\/value>`)
    const m = text.match(r); return m ? m[1].trim() : null
  }
  return {
    piloto: get('Pilot Name'), aeronave: get('Aircraft Name'),
    area: get('Task Area'), velocidade: get('Task Flight Speed'),
    altura: get('Height'), espacamento: get('Route Spacing'),
  }
}

function MapaTrajetosKml({ voos, supabase, height = 500 }) {
  const [mapUrl, setMapUrl] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const urlRef = useRef(null)
  const CORES = ['#e74c3c','#00A86B','#2f6fed','#f2960f','#8e44ad','#16a085','#d35400','#2c3e50','#e5484d','#27ae60']

  useEffect(() => {
    let cancelado = false
    async function montar() {
      setCarregando(true)
      const trajetos = []
      for (const rel of voos) {
        const path = (rel.kml_paths || [])[0]
        if (!path) continue
        try {
          const { data: signed } = await supabase.storage.from('relatorios').createSignedUrl(path, 3600)
          if (!signed?.signedUrl) continue
          const res = await fetch(signed.signedUrl)
          const text = await res.text()
          const coords = parseKmlCoords(text)
          if (coords.length > 1) trajetos.push({ rel, coords })
        } catch (e) { console.error(e) }
      }
      if (cancelado) return
      if (trajetos.length === 0) { setMapUrl(null); setCarregando(false); return }

      const allCoords = trajetos.flatMap(t => t.coords.map(c => [c.lat, c.lng]))
      const center = allCoords[Math.floor(allCoords.length / 2)]
      const linesJs = trajetos.map((t, i) => {
        const cor = CORES[i % CORES.length]
        const label = `${(t.rel.cliente||'—').replace(/'/g,"\\'")} — ${(t.rel.piloto_nome||'').replace(/'/g,"\\'")} — ${new Date(t.rel.created_at).toLocaleDateString('pt-BR')}`
        const latlngs = JSON.stringify(t.coords.map(c => [c.lat, c.lng]))
        return `L.polyline(${latlngs},{color:'${cor}',weight:3,opacity:0.85}).bindPopup('${label}').addTo(map);`
      }).join('\n')

      const html = `<!DOCTYPE html><html><head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
        <style>*{margin:0;padding:0;box-sizing:border-box}html,body,#map{width:100%;height:100%}</style>
      </head><body>
        <div id="map"></div>
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
          var map = L.map('map',{zoomControl:true}).setView([${center[0]},${center[1]}],12);
          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri',maxZoom:19}).addTo(map);
          ${linesJs}
          var coords = ${JSON.stringify(allCoords)};
          if(coords.length>1){map.fitBounds(L.latLngBounds(coords),{padding:[30,30]});}
        </script>
      </body></html>`

      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      setMapUrl(url)
      setCarregando(false)
    }
    montar()
    return () => { cancelado = true }
  }, [voos, supabase])

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  if (carregando) return (
    <div style={{ height, background:'#F4F7F5', borderRadius:12, border:'1px solid #d7e6dc', display:'flex', alignItems:'center', justifyContent:'center', color:'#5c7568', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:24 }}>🛰️</div>
      <div style={{ fontSize:13 }}>Carregando trajetos KML...</div>
    </div>
  )

  if (!mapUrl) return (
    <div style={{ textAlign:'center', color:'#5c7568', padding:40, background:'#fff', borderRadius:12, border:'1px solid #d7e6dc' }}>
      Nenhum trajeto válido nos KMLs selecionados.
    </div>
  )

  return (
    <div style={{ background:'#fff', borderRadius:12, border:'1px solid #d7e6dc', overflow:'hidden', marginBottom:16 }}>
      <iframe src={mapUrl} style={{ width:'100%', height, border:'none', display:'block' }} title="Trajetos KML Orofly" sandbox="allow-scripts" />
      <div style={{ padding:'10px 14px', background:'#F4F7F5', fontSize:11, color:'#5c7568', display:'flex', gap:12, flexWrap:'wrap' }}>
        {voos.map((v, i) => (
          <span key={v.id}><span style={{ color: CORES[i % CORES.length] }}>●</span> {v.cliente||'—'} — {v.piloto_nome} ({new Date(v.created_at).toLocaleDateString('pt-BR')})</span>
        ))}
      </div>
    </div>
  )
}

function KmlViewer({ rel, supabase }) {
  const [kmlData, setKmlData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [mapUrl, setMapUrl] = useState(null)

  async function carregarKml() {
    if (expanded) { setExpanded(false); setShowMap(false); setMapUrl(null); return }
    setLoading(true)
    try {
      const paths = rel.kml_paths || []
      const nomes = rel.kml_arquivos || []
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from('relatorios').createSignedUrl(paths[0], 3600)
        if (signed?.signedUrl) {
          const res = await fetch(signed.signedUrl)
          const text = await res.text()
          const coords = parseKmlCoords(text)
          const meta = parseKmlMeta(text)
          setKmlData({ coords, meta, nome: nomes[0], path: paths[0], signedUrl: signed.signedUrl })
          setExpanded(true)
        }
      } else if (nomes.length > 0) {
        setKmlData({ coords: [], meta: {}, nome: nomes[0], path: null })
        setExpanded(true)
      }
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  // Mapa com Leaflet (OpenStreetMap) renderizado como HTML inline
  function abrirMapaLeaflet() {
    if (!kmlData?.coords?.length) return
    const coords = kmlData.coords
    const center = coords[Math.floor(coords.length/2)]
    const latlngs = JSON.stringify(coords.map(c => [c.lat, c.lng]))

    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
      <style>*{margin:0;padding:0}#map{width:100%;height:100vh}</style>
    </head><body>
      <div id="map"></div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
        var map = L.map('map').setView([${center.lat}, ${center.lng}], 16);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri',maxZoom:19}).addTo(map);
        var coords = ${latlngs};
        var line = L.polyline(coords, {color:'#e74c3c', weight:3, opacity:0.9}).addTo(map);
        L.marker(coords[0]).bindPopup('Início').addTo(map);
        L.marker(coords[coords.length-1]).bindPopup('Fim').addTo(map);
        map.fitBounds(line.getBounds(), {padding:[20,20]});
      </script>
    </body></html>`

    const blob = new Blob([html], {type:'text/html'})
    const url = URL.createObjectURL(blob)
    setMapUrl(url)
    setShowMap(true)
  }

  async function baixarKml() {
    if (!kmlData?.path) return
    const { data: signed } = await supabase.storage.from('relatorios').createSignedUrl(kmlData.path, 60)
    if (signed?.signedUrl) {
      const r = await fetch(signed.signedUrl); const b = await r.blob()
      const a = document.createElement('a'); a.href = URL.createObjectURL(b)
      a.download = kmlData.nome || 'trajeto.kml'; a.click(); URL.revokeObjectURL(a.href)
    }
  }

  const nomes = rel.kml_arquivos || []
  if (nomes.length === 0) return null

  return (
    <div style={{ marginTop:8 }}>
      <div style={{ fontSize:10, fontWeight:700, color:'#00A86B', letterSpacing:1, marginBottom:8, fontFamily:"'Syne',sans-serif" }}>ARQUIVOS KML</div>
      {nomes.map((nome, i) => (
        <div key={i} style={{ background:'#fff', border:'1px solid #d7e6dc', borderRadius:10, overflow:'hidden', marginBottom:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', cursor:'pointer', background: expanded&&i===0?'#e3f7ec':'#fff' }}
            onClick={() => i === 0 && carregarKml()}>
            <span>📄</span>
            <span style={{ flex:1, fontSize:13, fontWeight:500, color:'#0b1210' }}>{nome}</span>
            {loading && i===0 && <span style={{ fontSize:11, color:'#5c7568' }}>⏳ carregando...</span>}
            {i===0 && !loading && <span style={{ fontSize:11, color:'#00A86B' }}>{expanded ? '▲ Fechar' : '▼ Ver trajeto'}</span>}
          </div>

          {expanded && i === 0 && kmlData && (
            <div style={{ borderTop:'1px solid #e3f7ec' }}>
              {/* META */}
              {kmlData.meta && Object.values(kmlData.meta).some(Boolean) && (
                <div style={{ display:'flex', gap:14, flexWrap:'wrap', padding:'10px 14px', background:'#f7fbf8', borderBottom:'1px solid #eef5f0' }}>
                  {[['✈️ Aeronave', kmlData.meta.aeronave], ['👤 Piloto', kmlData.meta.piloto], ['📐 Área', kmlData.meta.area ? parseFloat(kmlData.meta.area).toFixed(2)+' ha' : null], ['⚡', kmlData.meta.velocidade ? kmlData.meta.velocidade+' m/s' : null], ['↕️', kmlData.meta.altura ? kmlData.meta.altura+' m' : null], ['↔️', kmlData.meta.espacamento ? kmlData.meta.espacamento+' m' : null]].filter(([,v])=>v).map(([l,v])=>(
                    <span key={l} style={{ fontSize:12 }}><span style={{ color:'#5c7568' }}>{l} </span><strong>{v}</strong></span>
                  ))}
                  <span style={{ fontSize:12, color:'#5c7568' }}>📍 {kmlData.coords.length} pontos</span>
                </div>
              )}

              {/* MAPA LEAFLET */}
              {showMap && mapUrl ? (
                <div style={{ position:'relative' }}>
                  <iframe src={mapUrl} style={{ width:'100%', height:320, border:'none', display:'block' }} title="Trajeto KML" />
                  <button style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,.6)', color:'#fff', border:'none', borderRadius:14, padding:'4px 10px', fontSize:11, cursor:'pointer' }}
                    onClick={() => { setShowMap(false); URL.revokeObjectURL(mapUrl); setMapUrl(null) }}>✕ Fechar mapa</button>
                </div>
              ) : (
                <div style={{ padding:'10px 14px' }}>
                  {kmlData.coords.length > 0 && (
                    <button style={{ background:'#00A86B', color:'#fff', border:'none', borderRadius:16, padding:'8px 16px', fontSize:13, cursor:'pointer', fontWeight:600, marginRight:8 }}
                      onClick={abrirMapaLeaflet}>
                      🗺️ Ver trajeto no mapa
                    </button>
                  )}
                  {kmlData.path && (
                    <button style={{ background:'#2f6fed', color:'#fff', border:'none', borderRadius:16, padding:'8px 16px', fontSize:13, cursor:'pointer', fontWeight:600 }}
                      onClick={baixarKml}>
                      ⬇ Baixar KML
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function DetailCol({ title, items }) {
  const valid = items.filter(([,v]) => v && v !== '—')
  if (!valid.length) return null
  return (
    <div style={{ minWidth:120, flex:1 }}>
      <div style={{ fontSize:10, fontWeight:700, color:'#00A86B', letterSpacing:1, marginBottom:5, fontFamily:"'Syne',sans-serif" }}>{title.toUpperCase()}</div>
      {valid.map(([l,v]) => (
        <div key={l} style={{ display:'flex', gap:4, marginBottom:3, fontSize:11 }}>
          <span style={{ color:'#5c7568', minWidth:65, flexShrink:0 }}>{l}:</span>
          <span style={{ color:'#0b1210', wordBreak:'break-word' }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

const sG = {
  td: { padding:'11px 14px', fontSize:13, color:'#0b1210', borderBottom:'1px solid #eef5f0', verticalAlign:'middle' },
  iconBtn: { background:'none', border:'none', cursor:'pointer', fontSize:15, padding:'3px 4px', borderRadius:10 },
  label: { fontSize:11, fontWeight:600, color:'#5c7568', letterSpacing:.5, marginBottom:4, fontFamily:"'Syne',sans-serif" },
  input: { width:'100%', border:'1px solid #d7e6dc', borderRadius:12, padding:'9px 11px', fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:'none', color:'#0b1210', background:'#F4F7F5', appearance:'none', WebkitAppearance:'none' },
  btn: { background:'#00A86B', color:'#fff', border:'none', borderRadius:100, padding:'11px', fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:600, cursor:'pointer', width:'100%', boxShadow:'0 4px 14px rgba(14,159,110,0.3)' },
  fi: { border:'1px solid #d7e6dc', borderRadius:12, padding:'7px 10px', fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:'none', color:'#0b1210', background:'#F4F7F5', minWidth:110, appearance:'none' },
  actBtn: (bg) => ({ color:'#fff', background:bg, border:'none', borderRadius:16, padding:'6px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }),
}

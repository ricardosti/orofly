import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAdminTheme as useTheme } from '../lib/theme'
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { gerarPDFCliente, gerarWordCliente, gerarPDFFazendaPeriodo, gerarPDFAgenda, areaLiquida, setEmpresaConfig } from '../lib/pdf'
import { registrarPush, salvarSubscription } from '../lib/notifications'
import { pedirPermissaoNotificacaoLocal, notificarLocal } from '../lib/localNotify'
import { salvarOuCompartilharPdf, salvarOuCompartilharBlob, compartilharNativo } from '../lib/nativeShare'
import ProfileModal from '../components/ProfileModal'
import MapaFazendaViewer from '../components/MapaFazendaViewer'
import RegionTreeSelect from '../components/RegionTreeSelect'
import ImportarFazendasModal from '../components/ImportarFazendasModal'
import { CATEGORIA_DESPESA_OPTS, CATEGORIA_ICON } from '../lib/categoriasDespesa'
import { calcDeltaT, classificarClimaParam, setLimitesClima } from '../lib/clima'
import { apiUrl } from '../lib/apiBase'
import { resolverTemplate, montarTextoWhatsapp, DEFAULT_WHATSAPP_CONFIG, DEFAULT_PDF_CONFIG, MOCK_RELATORIO } from '../lib/reportTemplates'

// URL absoluta: dentro do app nativo (Capacitor) a origem é https://localhost,
// que não tem as funções serverless — sempre chama o site publicado de verdade.
const API_BASE = 'https://orofly.vercel.app'
const STATUS_LABEL = { rascunho:'Rascunho', em_operacao:'Em operação', pausado:'Pausado', pausado_dia:'Finalizado Parcial', finalizado:'Finalizado', sos:'🆘 SOS', sos_resolvido:'✅ SOS Resolvido' }
// Funções (em vez de objeto fixo) porque as cores dependem do tema atual (claro/escuro).
// Pílulas sóbrias: fundo suave + texto na mesma família de cor (sem preenchimento sólido).
const statusColor = (theme) => ({ rascunho:theme.textMuted, em_operacao:'#15803D', pausado:'#B45309', pausado_dia:'#B45309', finalizado:'#15803D', sos:theme.dangerText, sos_resolvido:theme.textMuted })
const statusBg    = (theme) => ({ rascunho:theme.bg, em_operacao:'#DCFCE7', pausado:'#FEF3C7', pausado_dia:'#FEF3C7', finalizado:'#DCFCE7', sos:theme.dangerBg, sos_resolvido:theme.bg })
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
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const toggle = (opt) => onChange(selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt])
  return (
    <div style={{ position:'relative' }}>
      <div style={{ fontSize:10, fontWeight:700, color:theme.textFaint2, marginBottom:3 }}>{label.toUpperCase()}</div>
      <div onClick={() => setOpen(o => !o)}
        style={{ width:'100%', border:`1px solid ${theme.cardBorder2}`, borderRadius:8, padding:'7px 10px', fontSize:12, color:selected.length?theme.text:'#aaa', background:theme.card, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', boxSizing:'border-box' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selected.length ? `${selected.length} selecionado(s)` : 'Todos'}</span>
        <span style={{ color:'#aaa', fontSize:10, marginLeft:4, flexShrink:0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:90 }}/>
          <div style={{ position:'absolute', top:'100%', left:0, right:0, marginTop:4, background:theme.card, border:`1px solid ${theme.cardBorder2}`, borderRadius:10, boxShadow:'0 10px 30px rgba(0,0,0,.18)', zIndex:91, padding:6, maxHeight:220, overflowY:'auto' }}>
            {options.length === 0 ? (
              <div style={{ padding:10, fontSize:12, color:'#aaa', textAlign:'center' }}>Sem opções</div>
            ) : options.map(o => {
              const sel = selected.includes(o)
              return (
                <div key={o} onClick={() => toggle(o)}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', cursor:'pointer', borderRadius:6, background:sel?theme.successBg:'transparent' }}>
                  <div style={{ width:15, height:15, borderRadius:4, border:`2px solid ${sel?'#059669':'#c3d4c9'}`, background:sel?'#059669':'#fff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {sel && <span style={{ color:'#fff', fontSize:9, fontWeight:700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize:12, color:theme.text }}>{o}</span>
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
  const { theme, adminPalette, setAdminPalette, paletteList } = useTheme()
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
  // Sidebar em accordion — {grupoId: true|false}. Grupo sem entrada aqui ainda (nunca
  // clicado) usa o padrão de "aberto se contém a aba ativa", calculado na hora do render.
  const [sidebarGruposAbertos, setSidebarGruposAbertos] = useState({})
  // Popover discreto de conta (perfil/notificações/Modo Piloto/sair), no rodapé compacto da
  // sidebar — substitui a pilha de botões grandes que existia antes ali.
  const [contaMenuAberto, setContaMenuAberto] = useState(false)
  const [sidebarBusca, setSidebarBusca] = useState('')
  // Configurações do Sistema — Clima (Meteoblue/Tomorrow.io/Open-Meteo) usa app_settings
  // (chave/valor) genérica de propósito, pra caber novas opções no futuro sem precisar de
  // migração de banco nem tela nova.
  const PROVEDORES_CLIMA_PADRAO = ['meteoblue', 'tomorrow', 'open_meteo']
  const [weatherProviderOrdem, setWeatherProviderOrdem] = useState(PROVEDORES_CLIMA_PADRAO)
  const [weatherProviderCarregando, setWeatherProviderCarregando] = useState(false)
  const [weatherProviderSalvando, setWeatherProviderSalvando] = useState(false)
  const [weatherLogStats, setWeatherLogStats] = useState(null)
  const [weatherStatus, setWeatherStatus] = useState(null) // {estado:'ok'|'backup'|'erro', mensagem}
  const [weatherStatusTestando, setWeatherStatusTestando] = useState(false)
  const [weatherDiagnostico, setWeatherDiagnostico] = useState(null) // {meteoblue:{ok,erro}, tomorrow:{...}, open_meteo:{...}}
  const [weatherDiagnosticoTestando, setWeatherDiagnosticoTestando] = useState(false)
  const [weatherLogs, setWeatherLogs] = useState(null) // últimas chamadas (repositório de logs)
  // Dev / Benchmark — comparador ao vivo das 3 APIs de clima pra mesma coordenada.
  // Coordenada padrão é a mesma usada no teste de conexão (Ribeirão Preto), o admin pode trocar.
  const [devBenchLat, setDevBenchLat] = useState('-21.1775')
  const [devBenchLng, setDevBenchLng] = useState('-47.8103')
  const [devBenchResultados, setDevBenchResultados] = useState(null)
  const [devBenchTestando, setDevBenchTestando] = useState(false)
  async function rodarBenchmarkClima() {
    setDevBenchTestando(true)
    try {
      const r = await fetch(apiUrl(`/api/clima?lat=${devBenchLat}&lon=${devBenchLng}&diagnostico=1`))
      const data = await r.json()
      setDevBenchResultados(data?.diagnostico || null)
    } catch (e) {
      setDevBenchResultados(null)
      showToast('Erro ao rodar benchmark: '+e.message, 'error')
    } finally {
      setDevBenchTestando(false)
    }
  }
  // Orçamento (ex-Agro Finance) — agora vive dentro de Financeiro, como sub-aba. Módulo
  // trazido do projeto do Isaque (sócio); só a Calculadora por enquanto.
  const [calc, setCalc] = useState({
    cliente: 'Sao tomé', cultura: 'Soja', areaTotal: '50', tipoServico: 'Pulverização Agrícola', distancia: '100', rendimento: '12',
    custoBateriaHora: '85', combustivelKm: '1,20', diaria: '120', desgasteHora: '45', margem: '40', precoMercado: '110',
  })
  // Regras da calculadora que dá pra personalizar (as demais fazem parte da fórmula em si
  // e não fariam sentido como "configuração"). Persistidas em app_settings, igual o
  // alternador de clima, pra sobreviver a reload/outros admins.
  const CALC_CONFIG_PADRAO = { horasPorDia: 8, margemMaxPct: 95, multiplicadorDeslocamento: 2 }
  const [calcConfig, setCalcConfig] = useState(CALC_CONFIG_PADRAO)
  const [calcConfigSaving, setCalcConfigSaving] = useState(false)
  const [calcConfigLoaded, setCalcConfigLoaded] = useState(false)
  const [custosSubTab, setCustosSubTab] = useState('notas')
  const [configSubTab, setConfigSubTab] = useState('geral')
  const [arquivosLista, setArquivosLista] = useState([]) // nunca undefined — tela de Arquivos depende disso
  const [arquivosLoading, setArquivosLoading] = useState(false)
  const [arquivosLoaded, setArquivosLoaded] = useState(false)
  const [arquivosErro, setArquivosErro] = useState('')
  const [arquivosFiltroCategoria, setArquivosFiltroCategoria] = useState('')
  const [arquivosExcluindo, setArquivosExcluindo] = useState('')
  async function carregarCalcConfig() {
    try {
      const { data } = await supabase.from('app_settings').select('valor').eq('chave', 'orcamento_config').maybeSingle()
      if (data?.valor) setCalcConfig({ ...CALC_CONFIG_PADRAO, ...JSON.parse(data.valor) })
    } catch { /* sem linha configurada ainda — mantém o padrão */ }
  }
  async function salvarCalcConfig(novaConfig) {
    setCalcConfigSaving(true)
    try {
      await supabase.from('app_settings').upsert({ chave: 'orcamento_config', valor: JSON.stringify(novaConfig), atualizado_em: new Date().toISOString() })
      setCalcConfig(novaConfig)
      showToast('✅ Regras do orçamento salvas!')
    } catch (e) { showToast('Erro ao salvar: ' + e.message, 'error') } finally { setCalcConfigSaving(false) }
  }
  // Config geral: dados da empresa (rodapé de PDF/WhatsApp), limites de alerta climático
  // (vento/Delta T) e valores padrão do wizard de voo. Um único registro em app_settings
  // (chave 'config_geral') pra não multiplicar linhas na tabela. Carregada uma vez ao abrir
  // o app (não só na tela de Configurações), porque empresa/limites afetam PDF e telas de
  // clima usadas em qualquer lugar do Admin.
  const EMPRESA_CFG_PADRAO = { nome: 'Orofly', telefone: '(16) 98262-3711', site: 'www.orofly.com.br', email: 'contato@orofly.com.br', logo_url: '' }
  const LIMITES_CFG_PADRAO = { ventoMin: 3, ventoMax: 15, deltaTMin: 2, deltaTIdealMax: 7, deltaTAlertaMax: 8 }
  const WIZARD_CFG_PADRAO = { velocidadeDrone: '', altura: '', faixa: '' }
  const [configGeral, setConfigGeral] = useState({ empresa: EMPRESA_CFG_PADRAO, limitesClima: LIMITES_CFG_PADRAO, wizardDefaults: WIZARD_CFG_PADRAO })
  const [configGeralSaving, setConfigGeralSaving] = useState(false)
  const [configGeralLoaded, setConfigGeralLoaded] = useState(false)
  async function carregarConfigGeral() {
    try {
      const { data } = await supabase.from('app_settings').select('valor').eq('chave', 'config_geral').maybeSingle()
      const cfg = data?.valor ? JSON.parse(data.valor) : {}
      const nova = {
        empresa: { ...EMPRESA_CFG_PADRAO, ...cfg.empresa },
        limitesClima: { ...LIMITES_CFG_PADRAO, ...cfg.limitesClima },
        wizardDefaults: { ...WIZARD_CFG_PADRAO, ...cfg.wizardDefaults },
      }
      setConfigGeral(nova)
      setEmpresaConfig(nova.empresa)
      setLimitesClima(nova.limitesClima)
    } catch { setEmpresaConfig(EMPRESA_CFG_PADRAO); setLimitesClima(LIMITES_CFG_PADRAO) }
  }
  async function salvarConfigGeral(nova) {
    setConfigGeralSaving(true)
    try {
      await supabase.from('app_settings').upsert({ chave: 'config_geral', valor: JSON.stringify(nova), atualizado_em: new Date().toISOString() })
      setConfigGeral(nova)
      setEmpresaConfig(nova.empresa)
      setLimitesClima(nova.limitesClima)
      showToast('✅ Configurações salvas!')
    } catch (e) { showToast('Erro ao salvar: ' + e.message, 'error') } finally { setConfigGeralSaving(false) }
  }
  useEffect(() => { if (!configGeralLoaded) { setConfigGeralLoaded(true); carregarConfigGeral() } }, [configGeralLoaded]) // eslint-disable-line

  // Personalização de Relatórios — templates de WhatsApp/PDF por cliente (ou globais).
  // Carregado só quando o admin entra na sub-aba, igual ao padrão dos outros loaders.
  const [reportTemplates, setReportTemplates] = useState([])
  const [reportTemplatesLoading, setReportTemplatesLoading] = useState(false)
  const [reportTemplatesLoaded, setReportTemplatesLoaded] = useState(false)
  const [templateEditor, setTemplateEditor] = useState(null) // template sendo criado/editado, ou null
  async function carregarReportTemplates() {
    setReportTemplatesLoading(true)
    try {
      const { data, error } = await supabase.from('report_templates').select('*').order('nome')
      if (error) throw error
      setReportTemplates(data || [])
    } catch (e) { showToast('Erro ao carregar templates: ' + e.message, 'error') } finally { setReportTemplatesLoading(false) }
  }
  useEffect(() => {
    if (tab === 'configuracoes' && configSubTab === 'personalizacao' && !reportTemplatesLoaded) {
      setReportTemplatesLoaded(true); carregarReportTemplates()
    }
  }, [tab, configSubTab]) // eslint-disable-line
  async function excluirReportTemplate(tpl) {
    if (!window.confirm(`Excluir o template "${tpl.nome}"? Essa ação não pode ser desfeita.`)) return
    try {
      const { error } = await supabase.from('report_templates').delete().eq('id', tpl.id)
      if (error) throw error
      showToast('🗑️ Template excluído'); carregarReportTemplates()
    } catch (e) { showToast('Erro ao excluir: ' + e.message, 'error') }
  }
  async function definirTemplatePadrao(tpl) {
    try {
      // O índice único parcial só permite UM is_default=true por cliente_nome (ou por "global"
      // quando cliente_nome é null) — por isso zera os outros do mesmo grupo ANTES de marcar
      // este como padrão, senão o upsert final é rejeitado pelo banco.
      let q = supabase.from('report_templates').update({ is_default: false }).eq('is_default', true)
      q = tpl.cliente_nome ? q.eq('cliente_nome', tpl.cliente_nome) : q.is('cliente_nome', null)
      await q
      const { error } = await supabase.from('report_templates').update({ is_default: true }).eq('id', tpl.id)
      if (error) throw error
      showToast('⭐ Template definido como padrão'); carregarReportTemplates()
    } catch (e) { showToast('Erro ao definir padrão: ' + e.message, 'error') }
  }
  async function salvarReportTemplate(draft) {
    try {
      const payload = {
        nome: draft.nome, cliente_nome: draft.cliente_nome || null, logo_url: draft.logo_url || null,
        whatsapp_config: draft.whatsapp_config || {}, pdf_config: draft.pdf_config || {},
      }
      if (draft.id) {
        const { error } = await supabase.from('report_templates').update(payload).eq('id', draft.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('report_templates').insert(payload)
        if (error) throw error
      }
      showToast('✅ Template salvo!'); setTemplateEditor(null); carregarReportTemplates()
    } catch (e) { showToast('Erro ao salvar template: ' + e.message, 'error') }
  }

  useEffect(() => {
    if (tab === 'configuracoes' && weatherLogStats === null) { carregarConfiguracoes(); testarConexaoClima(); carregarWeatherLogs() }
    if (tab === 'custos' && custosSubTab === 'orcamento' && !calcConfigLoaded) { setCalcConfigLoaded(true); carregarCalcConfig() }
    if (tab === 'arquivos' && !arquivosLoaded) { setArquivosLoaded(true); carregarArquivos() }
    if (tab === 'dev' && weatherLogs === null) { carregarWeatherLogs() }
  }, [tab, custosSubTab]) // eslint-disable-line
  const [relatorios, setRelatorios] = useState([])
  const [pilotos, setPilotos] = useState([])
  const [times, setTimes] = useState([])
  const [fazendaTimes, setFazendaTimes] = useState([])
  const [pilotoFazendas, setPilotoFazendas] = useState([])
  const [pilotoFazendasModal, setPilotoFazendasModal] = useState(null) // piloto sendo editado
  const [pilotoFazendasAba, setPilotoFazendasAba] = useState('individual') // 'individual' (checklist por cliente) ou 'lote' (árvore de seleção em massa)
  const [incidentes, setIncidentes] = useState([])
  const [incidenteFocoId, setIncidenteFocoId] = useState(null)
  const [novoTimeNome, setNovoTimeNome] = useState('')
  const [importarFazendasAberto, setImportarFazendasAberto] = useState(false)
  const [kanbanAberto, setKanbanAberto] = useState(false)
  const [equipeClienteAberto, setEquipeClienteAberto] = useState({}) // {`${timeId}-${cliente}`: bool}
  const isSupervisor = profile?.role === 'supervisor'
  const [voosPorPiloto, setVoosPorPiloto] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [acaoMenuAbertoId, setAcaoMenuAbertoId] = useState(null) // id do relatório com o menu "⋯" de ações aberto na tabela
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
  const [novoUsuarioModalAberto, setNovoUsuarioModalAberto] = useState(false)
  const [usuariosBusca, setUsuariosBusca] = useState('')
  const [usuariosFiltroPerfil, setUsuariosFiltroPerfil] = useState('')
  const [usuariosFiltroStatus, setUsuariosFiltroStatus] = useState('') // '' | 'ativo' | 'inativo'
  const [usuarioAcoesAbertoId, setUsuarioAcoesAbertoId] = useState(null)
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
  // Consolidado do período (capa + um relatório completo por talhão/voo em anexo, igual o
  // PDF Cliente individual): null em relatorioPeriodoTalhoesSel = todos os talhões da fazenda.
  const [relatorioPeriodoTalhoesSel, setRelatorioPeriodoTalhoesSel] = useState(null)
  const [relatorioPeriodoObs, setRelatorioPeriodoObs] = useState('')
  const [relatorioPeriodoFotoBase64, setRelatorioPeriodoFotoBase64] = useState(null)
  const [fzModal, setFzModal] = useState(false)
  const [fzEditId, setFzEditId] = useState(null)
  const [fzGeoLoading, setFzGeoLoading] = useState(false)
  const [tlForm, setTlForm] = useState({}) // {fazendaId: {nome,area_ha}}
  const [talhaoEditId, setTalhaoEditId] = useState(null)
  const [talhaoEditForm, setTalhaoEditForm] = useState({nome:'',area_ha:''})
  const [fzSearch, setFzSearch] = useState('')
  const [fzProdutoFiltro, setFzProdutoFiltro] = useState('')
  const [fzClienteFiltro, setFzClienteFiltro] = useState('')
  const [fzStatusFiltro, setFzStatusFiltro] = useState('') // '' | 'concluida' | 'parcial' | 'nao_iniciada'
  const [fzVisaoView, setFzVisaoView] = useState('tabela') // 'tabela' | 'cards' — visão das fazendas na aba Visão Geral
  const [fzExpandido, setFzExpandido] = useState({})
  const [invMovimentos, setInvMovimentos] = useState([])
  const [custos, setCustos] = useState([])
  const [osSearch, setOsSearch] = useState('')
  const [osSearchCliente, setOsSearchCliente] = useState('')
  const [fotoLightbox, setFotoLightbox] = useState(null)
  const [custosFiltros, setCustosFiltros] = useState({piloto:'',categoria:'',clienteFazenda:'',dataIni:'',dataFim:''})
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
      const talhoesFzAtual = invTalhoes.filter(t=>t.fazenda_id===fz.id)
      const talhoesCatalogo = talhoesFzAtual.map(t=>({nome:t.nome, area_ha:t.area_ha}))
      const talhoesSel = relatorioPeriodoTalhoesSel ?? talhoesFzAtual.map(t=>t.nome)
      const voosPeriodo = relatorios.filter(r=>{
        if(r.cliente!==fz.cliente || r.fazenda!==fz.nome || r.status!=='finalizado') return false
        const dRef = (r.dt_inicio || r.created_at || '').slice(0,10)
        if(!(dRef && dRef>=dataIni && dRef<=dataFim)) return false
        const talhoesDoVoo = (r.localizacao||'').split(',').map(s=>s.trim()).filter(Boolean)
        return talhoesDoVoo.length===0 || talhoesDoVoo.some(n=>talhoesSel.includes(n))
      })
      let pdfConfig
      try {
        const tpl = await resolverTemplate(supabase, fz.cliente)
        if (tpl?.pdf_config && Object.keys(tpl.pdf_config).length) pdfConfig = tpl.pdf_config
      } catch (e) { console.warn('Falha ao resolver template de PDF, usando padrão:', e) }
      const doc = await gerarPDFFazendaPeriodo({
        fazenda: fz, voos: voosPeriodo, dataIni, dataFim, areaTotalCadastrada: fz.areaTotal,
        talhoesCatalogo, talhoesSelecionados: talhoesSel, observacaoAdmin: relatorioPeriodoObs,
        fotoGeralBase64: relatorioPeriodoFotoBase64, supabase, pdfConfig,
      })
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
    // Se existir um template personalizado (por cliente ou padrão global) com config de
    // WhatsApp, usa a config dele; senão usa o DEFAULT_WHATSAPP_CONFIG (o padrão novo, com
    // quebra por talhão) — montarTextoWhatsapp já cai nesse default quando `tpl` é null.
    const fz = invFazendas.find(f => f.cliente === rel.cliente && f.nome === rel.fazenda)
    const talhoesCatalogo = fz ? invTalhoes.filter(t => t.fazenda_id === fz.id).map(t => ({ nome: t.nome, area_ha: t.area_ha })) : []
    let texto
    try {
      const tpl = await resolverTemplate(supabase, rel.cliente)
      texto = montarTextoWhatsapp({ ...rel, id_fazenda: fz?.id_fazenda }, tpl?.whatsapp_config, { talhoesCatalogo })
    } catch (e) {
      console.warn('Falha ao resolver template de WhatsApp, usando config padrão:', e)
      texto = montarTextoWhatsapp({ ...rel, id_fazenda: fz?.id_fazenda }, null, { talhoesCatalogo })
    }
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

  // Junta todos os caminhos de arquivo (fotos, mapa) de uma leva de relatórios — usado
  // antes de apagar em massa, pra não deixar arquivo órfão no Storage (custa espaço e
  // Egress pra sempre, já que nada mais referencia esse caminho depois da linha apagada).
  function caminhosDeArquivos(lista) {
    const caminhos = []
    lista.forEach(r => {
      if (r.foto_mapa_url) caminhos.push(r.foto_mapa_url)
      ;(r.obs_fotos_urls||[]).forEach(p => { if (p) caminhos.push(p) })
    })
    return caminhos
  }
  async function excluirArquivosRelatorios(lista) {
    const caminhos = caminhosDeArquivos(lista)
    if (caminhos.length === 0) return
    const { error } = await supabase.storage.from('relatorios').remove(caminhos)
    if (error) console.error('Falha ao limpar arquivos órfãos:', error.message) // não bloqueia a exclusão do relatório por isso
  }

  // Tela de Arquivos — em vez de varrer o bucket inteiro às cegas (pastas por piloto_id, sem
  // fim claro, arriscado), usa os caminhos já conhecidos via `relatorios` (fotos/KML) + a
  // pasta `logos/` (empresa/templates). Cada chamada de listagem é isolada em try/catch —
  // se uma pasta falhar, ela só não aparece, não derruba a tela inteira.
  async function carregarArquivos() {
    setArquivosLoading(true); setArquivosErro('')
    try {
      const itens = []
      ;(relatorios||[]).forEach(r => {
        const relLabel = `${r.cliente||'—'} — ${r.fazenda||'—'}`
        if (r.foto_mapa_url) itens.push({ path:r.foto_mapa_url, categoria:'foto', relatorioId:r.id, relLabel, data:r.created_at })
        ;(r.obs_fotos_urls||[]).forEach(p => { if (p) itens.push({ path:p, categoria:'foto', relatorioId:r.id, relLabel, data:r.created_at }) })
        ;(r.kml_paths||[]).forEach(p => { if (p) itens.push({ path:p, categoria:'kml', relatorioId:r.id, relLabel, data:r.created_at }) })
      })

      let logoItens = []
      try {
        const { data } = await supabase.storage.from('relatorios').list('logos', { limit:200 })
        logoItens = (data||[]).filter(f=>f?.name).map(f=>({ path:`logos/${f.name}`, categoria:'logo', relLabel:'Logo da empresa/template', data:f.created_at, tamanho:f.metadata?.size??null }))
      } catch (e) { console.warn('[Arquivos] falha ao listar pasta logos:', e?.message) }

      const pastas = [...new Set(itens.map(it => it.path.split('/').slice(0,-1).join('/')).filter(Boolean))]
      const tamanhoPorPath = {}
      for (const pasta of pastas) {
        try {
          const { data } = await supabase.storage.from('relatorios').list(pasta, { limit:200 })
          ;(data||[]).forEach(f => { if (f?.name) tamanhoPorPath[`${pasta}/${f.name}`] = f.metadata?.size ?? null })
        } catch (e) { console.warn('[Arquivos] falha ao listar pasta', pasta, e?.message) }
      }

      const itensFinal = itens.map(it => ({ ...it, tamanho: tamanhoPorPath[it.path] ?? null, nome: it.path.split('/').pop()||it.path }))
        .concat(logoItens.map(it => ({ ...it, nome: it.path.split('/').pop()||it.path })))

      setArquivosLista(itensFinal)
    } catch (e) {
      console.error('[Arquivos] erro geral ao carregar:', e)
      setArquivosErro('Não foi possível carregar a lista de arquivos agora. Tenta de novo em instantes.')
      setArquivosLista([])
    } finally {
      setArquivosLoading(false)
    }
  }

  async function excluirArquivoIndividual(item) {
    if (!window.confirm(`Excluir "${item.nome}"? Essa ação não pode ser desfeita.`)) return
    setArquivosExcluindo(item.path)
    try {
      const { error } = await supabase.storage.from('relatorios').remove([item.path])
      if (error) throw error
      if (item.relatorioId && item.categoria !== 'logo') {
        const rel = relatorios.find(r => r.id === item.relatorioId)
        if (rel) {
          const patch = {}
          if (rel.foto_mapa_url === item.path) patch.foto_mapa_url = null
          if ((rel.obs_fotos_urls||[]).includes(item.path)) patch.obs_fotos_urls = rel.obs_fotos_urls.filter(p => p !== item.path)
          if ((rel.kml_paths||[]).includes(item.path)) patch.kml_paths = rel.kml_paths.filter(p => p !== item.path)
          if (Object.keys(patch).length) await supabase.from('relatorios').update(patch).eq('id', rel.id)
        }
      }
      setArquivosLista(l => l.filter(x => x.path !== item.path))
      showToast('🗑️ Arquivo excluído')
    } catch (e) {
      showToast('Erro ao excluir: ' + (e?.message||'desconhecido'), 'error')
    } finally {
      setArquivosExcluindo('')
    }
  }

  async function excluirTodosRascunhos() {
    const lista = relatorios.filter(r=>r.status==='rascunho')
    if(lista.length===0) return
    if(!window.confirm(`Excluir TODOS os ${lista.length} rascunhos (de todos os pilotos)? Essa ação não pode ser desfeita.`)) return
    await excluirArquivosRelatorios(lista)
    const { error } = await supabase.from('relatorios').delete().in('id', lista.map(r=>r.id))
    if(error){ showToast('Erro: '+error.message,'error'); return }
    showToast(`🗑️ ${lista.length} rascunho(s) excluído(s)`); fetchAll()
  }

  async function excluirTodosTestes() {
    const lista = relatorios.filter(r=>r.teste)
    if(lista.length===0) return
    if(!window.confirm(`Excluir TODOS os ${lista.length} voos marcados como teste (qualquer status, de todos os pilotos)? Essa ação não pode ser desfeita.`)) return
    await excluirArquivosRelatorios(lista)
    const { error } = await supabase.from('relatorios').delete().in('id', lista.map(r=>r.id))
    if(error){ showToast('Erro: '+error.message,'error'); return }
    showToast(`🧪 ${lista.length} voo(s) de teste excluído(s)`); fetchAll()
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
      const { data } = await supabase.from('app_settings').select('valor').eq('chave','weather_provider').maybeSingle()
      let ordem = PROVEDORES_CLIMA_PADRAO
      if (data?.valor) {
        try { ordem = JSON.parse(data.valor) } catch { ordem = [data.valor] } // compat com formato antigo (string simples)
        if (!Array.isArray(ordem)) ordem = [ordem]
        ordem = ordem.filter(p => PROVEDORES_CLIMA_PADRAO.includes(p))
        PROVEDORES_CLIMA_PADRAO.forEach(p => { if (!ordem.includes(p)) ordem.push(p) })
      }
      setWeatherProviderOrdem(ordem)
    } catch { setWeatherProviderOrdem(PROVEDORES_CLIMA_PADRAO) }
    finally { setWeatherProviderCarregando(false) }
    carregarWeatherLogStats()
  }

  async function carregarWeatherLogStats() {
    try {
      const agora = new Date()
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString()
      const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString()
      const [{ count: totalMeteoblue }, { count: totalTomorrow }, { count: totalOpenMeteo }, { count: hojeChamadas }, { count: falhasMes }] = await Promise.all([
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).eq('provider','meteoblue').gte('criado_em', inicioMes),
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).eq('provider','tomorrow').gte('criado_em', inicioMes),
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).eq('provider','open_meteo').gte('criado_em', inicioMes),
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).gte('criado_em', inicioHoje),
        supabase.from('weather_api_log').select('id', { count:'exact', head:true }).eq('sucesso', false).gte('criado_em', inicioMes),
      ])
      setWeatherLogStats({ totalMeteoblue: totalMeteoblue||0, totalTomorrow: totalTomorrow||0, totalOpenMeteo: totalOpenMeteo||0, hoje: hojeChamadas||0, falhasMes: falhasMes||0 })
    } catch { setWeatherLogStats(null) }
  }

  async function salvarOrdemProvedores(novaOrdem) {
    setWeatherProviderSalvando(true)
    try {
      const { error } = await supabase.from('app_settings')
        .upsert({ chave:'weather_provider', valor: JSON.stringify(novaOrdem), atualizado_por: profile?.id, atualizado_em: new Date().toISOString() }, { onConflict:'chave' })
      if (error) throw error
      setWeatherProviderOrdem(novaOrdem)
      showToast('✅ Ordem de prioridade do clima salva!')
      testarConexaoClima()
    } catch (e) { showToast('Erro: '+e.message, 'error') }
    finally { setWeatherProviderSalvando(false) }
  }
  function moverProvedor(idx, direcao) {
    const novaOrdem = [...weatherProviderOrdem]
    const alvo = idx + direcao
    if (alvo < 0 || alvo >= novaOrdem.length) return
    ;[novaOrdem[idx], novaOrdem[alvo]] = [novaOrdem[alvo], novaOrdem[idx]]
    salvarOrdemProvedores(novaOrdem)
  }

  // Chama o próprio /api/clima com uma coordenada de teste (Ribeirão Preto) só pra ver
  // qual provedor respondeu de verdade — é a fonte de verdade do badge de status, não
  // adianta confiar só na ordem salva (uma chave pode estar errada, por exemplo).
  async function testarConexaoClima() {
    setWeatherStatusTestando(true)
    try {
      const r = await fetch(apiUrl('/api/clima?lat=-21.1775&lon=-47.8103'))
      const data = await r.json()
      if (!r.ok) { setWeatherStatus({ estado:'erro', mensagem: data?.error || `HTTP ${r.status}` }); return }
      if (data.provider_active === weatherProviderOrdem[0]) setWeatherStatus({ estado:'ok', mensagem:'' })
      else setWeatherStatus({ estado:'backup', provedorAtivo: data.provider_active, mensagem: data?.aviso || '' })
    } catch (e) {
      setWeatherStatus({ estado:'erro', mensagem: e.message })
    } finally {
      setWeatherStatusTestando(false)
      carregarWeatherLogs() // o teste em si já gerou uma linha nova no log
    }
  }

  // Testa os 3 provedores de forma INDEPENDENTE (não é a cascata real — cada um é testado
  // isoladamente), pra mostrar no painel se cada API está "funcional" ou não agora mesmo.
  // Não conta como chamada de verdade no repositório de logs (o backend não grava nesse modo).
  async function testarDiagnosticoProvedores() {
    setWeatherDiagnosticoTestando(true)
    try {
      const r = await fetch(apiUrl('/api/clima?lat=-21.1775&lon=-47.8103&diagnostico=1'))
      const data = await r.json()
      setWeatherDiagnostico(data?.diagnostico || null)
    } catch (e) {
      setWeatherDiagnostico(null)
    } finally {
      setWeatherDiagnosticoTestando(false)
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

  // Versão em lote de toggleFazendaPiloto — usada pela árvore de seleção por grupo
  // (RegionTreeSelect). Faz UM delete + UM insert em vez de várias chamadas em sequência
  // (uma por fazenda), pra não multiplicar round-trips ao Supabase quando o grupo tem
  // dezenas de fazendas. Mesma regra: se o grupo inteiro já está marcado, desmarca tudo;
  // senão, marca só o que ainda falta.
  async function toggleGrupoFazendasPiloto(fazendaIds, pilotoId) {
    if (!fazendaIds.length) return
    const marcadasAtuais = pilotoFazendas.filter(pf=>pf.piloto_id===pilotoId).map(pf=>pf.fazenda_id)
    const todasJaMarcadas = fazendaIds.every(id=>marcadasAtuais.includes(id))
    if (todasJaMarcadas) {
      await supabase.from('piloto_fazendas').delete().eq('piloto_id', pilotoId).in('fazenda_id', fazendaIds)
    } else {
      const faltando = fazendaIds.filter(id=>!marcadasAtuais.includes(id))
      if (faltando.length) {
        await supabase.from('piloto_fazendas').insert(faltando.map(fazenda_id=>({ fazenda_id, piloto_id: pilotoId })))
      }
    }
    fetchAll()
  }

  // Lista de fazendas agrupada por cliente, colapsável — reaproveitada tanto na permissão
  // por time (Equipes) quanto na permissão individual por piloto.
  // Progresso de campo (mesma fórmula do BI de Fazendas & Clientes): % da área total já
  // pulverizada (bordadura conta como feito), a partir dos relatórios finalizados da fazenda.
  function progressoFazenda(fz) {
    const talhoesFz = invTalhoes.filter(t=>t.fazenda_id===fz.id)
    const areaTotal = talhoesFz.reduce((a,t)=>a+parseFloat(t.area_ha||0),0)
    const relatoriosFz = relatorios.filter(r=>r.fazenda===fz.nome && r.cliente===fz.cliente && r.status==='finalizado')
    const areaRealizada = relatoriosFz.reduce((a,r)=>a+areaLiquida(r),0)
    const bordaduraRealizada = relatoriosFz.reduce((a,r)=>a+(parseFloat(r.bordadura)||0),0)
    const pct = areaTotal>0 ? Math.min(100,((areaRealizada+bordaduraRealizada)/areaTotal)*100) : null
    return { pct, areaTotal }
  }

  // Quem mais já tem acesso a essa fazenda — outros pilotos (permissão individual) e outros
  // times (permissão de time) — pra avisar antes de duplicar/entrar em conflito de atribuição.
  function quemMaisTemFazenda(fz, { excluirPilotoId, excluirTimeId } = {}) {
    const outrosPilotos = pilotoFazendas.filter(pf=>pf.fazenda_id===fz.id && pf.piloto_id!==excluirPilotoId)
      .map(pf=>pilotos.find(p=>p.id===pf.piloto_id)?.nome).filter(Boolean)
    const outrosTimes = fazendaTimes.filter(ft=>ft.fazenda_id===fz.id && ft.time_id!==excluirTimeId)
      .map(ft=>times.find(t=>t.id===ft.time_id)?.nome).filter(Boolean)
    return { outrosPilotos, outrosTimes }
  }

  function ChecklistFazendasPorCliente({ chavePrefixo, marcadas, onToggle, excluirPilotoId, excluirTimeId }) {
    const [filtroProgresso, setFiltroProgresso] = useState('')
    const passaFiltro = (fz) => {
      if (!filtroProgresso) return true
      const { pct } = progressoFazenda(fz)
      if (filtroProgresso === 'concluidas') return pct != null && pct >= 100
      if (filtroProgresso === 'andamento') return pct != null && pct > 0 && pct < 100
      if (filtroProgresso === 'naoIniciadas') return pct != null && pct === 0
      if (filtroProgresso === 'semCadastro') return pct == null
      if (filtroProgresso === 'conflito') {
        const { outrosPilotos, outrosTimes } = quemMaisTemFazenda(fz, { excluirPilotoId, excluirTimeId })
        return outrosPilotos.length > 0 || outrosTimes.length > 0
      }
      if (filtroProgresso === 'marcadas') return marcadas.includes(fz.id)
      return true
    }
    const FILTROS = [
      ['', 'Todos'], ['marcadas', '✓ Marcadas'], ['concluidas', '✅ 100%'], ['andamento', '🟡 Em andamento'],
      ['naoIniciadas', '⚪ Não iniciadas'], ['conflito', '⚠️ Já atribuídas'], ['semCadastro', '❔ Sem área cadastrada'],
    ]
    return (
      <div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
          {FILTROS.map(([v,lbl])=>(
            <button key={v} type="button" onClick={()=>setFiltroProgresso(v)}
              style={{background:filtroProgresso===v?'#059669':theme.bg,color:filtroProgresso===v?'#fff':theme.textMuted,border:`1px solid ${filtroProgresso===v?'#059669':theme.cardBorder2}`,borderRadius:20,padding:'5px 11px',fontSize:11,fontWeight:600,cursor:'pointer'}}>
              {lbl}
            </button>
          ))}
        </div>
        <div style={{border:`1px solid ${theme.divider}`,borderRadius:12,overflow:'hidden'}}>
        {[...new Set(invFazendas.map(fz=>fz.cliente))].sort().map(cliente=>{
          const fazendasCliTodas = invFazendas.filter(fz=>fz.cliente===cliente)
          const fazendasCli = fazendasCliTodas.filter(passaFiltro)
          if (fazendasCli.length === 0) return null
          const marcadasCli = fazendasCliTodas.filter(fz=>marcadas.includes(fz.id)).length
          const chave = `${chavePrefixo}-${cliente}`
          const aberto = equipeClienteAberto[chave] ?? marcadasCli>0
          return (
            <div key={cliente} style={{borderBottom:'1px solid #f0f5f2'}}>
              <div onClick={()=>setEquipeClienteAberto(s=>({...s,[chave]:!aberto}))}
                style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',cursor:'pointer',background:'#f9fbfa'}}>
                <span style={{fontSize:12,fontWeight:700,color:theme.text}}>🏢 {cliente}</span>
                <span style={{fontSize:11,color:marcadasCli>0?'#059669':'#aaa',fontWeight:600}}>{marcadasCli>0?`${marcadasCli}/${fazendasCliTodas.length} liberada(s)`:`${fazendasCli.length} fazenda(s)`} {aberto?'▲':'▼'}</span>
              </div>
              {aberto && fazendasCli.map(fz=>{
                const ativo = marcadas.includes(fz.id)
                const { pct } = progressoFazenda(fz)
                const { outrosPilotos, outrosTimes } = quemMaisTemFazenda(fz, { excluirPilotoId, excluirTimeId })
                const temConflito = outrosPilotos.length>0 || outrosTimes.length>0
                return (
                  <div key={fz.id} onClick={()=>onToggle(fz.id)}
                    style={{padding:'7px 14px 7px 26px',cursor:'pointer',fontSize:12,background:ativo?theme.successBg:'#fff',borderTop:'1px solid #f7fbf8'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:14,height:14,borderRadius:4,border:`2px solid ${ativo?'#059669':'#c3d4c9'}`,background:ativo?'#059669':'#fff',flexShrink:0}}/>
                      <span style={{color:ativo?theme.text:theme.textMuted,fontWeight:ativo?600:400,flex:1}}>{fz.nome}</span>
                      {pct!=null && (
                        <span title="Progresso de campo (área já aplicada)" style={{fontSize:10,fontWeight:700,color: pct>=100?'#059669':pct>=50?'#c98a1c':theme.textFaint2,background:theme.bg,borderRadius:20,padding:'2px 7px',flexShrink:0}}>
                          {pct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                    {temConflito && (
                      <div style={{marginTop:3,marginLeft:22,fontSize:10.5,color:theme.warningText2,background:theme.warningBg,borderRadius:8,padding:'3px 7px',display:'inline-block'}}>
                        ⚠️ Já atribuída a: {[...outrosPilotos, ...outrosTimes.map(n=>`time ${n}`)].join(', ')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        </div>
      </div>
    )
  }

  // Kanban de atribuição de fazendas — visão alternativa à checklist/árvore por lote:
  // um card por fazenda, uma coluna por piloto, arrastar move. Usa o mesmo mecanismo de
  // permissão individual (piloto_fazendas) já usado no resto da tela, mas trata como
  // atribuição EXCLUSIVA — arrastar pra uma coluna substitui qualquer piloto individual
  // que a fazenda já tinha (o modelo de dados permite vários pilotos por fazenda, mas um
  // quadro Kanban clássico não representa isso — cada card mora numa coluna só).
  // Nada é salvo até clicar "Salvar alterações" — mudanças ficam só em memória (pendentes).
  function AtribuirAreasKanbanModal({ onClose }) {
    const [filtroCliente, setFiltroCliente] = useState('')
    const [busca, setBusca] = useState('')
    const [pendentes, setPendentes] = useState({})
    const [salvando, setSalvando] = useState(false)
    const [arrastando, setArrastando] = useState(null)

    const pilotosAtivos = pilotos.filter(p => (p.role||'piloto')==='piloto' && p.ativo)
    const CORES = ['#059669','#2f6fed','#c98a1c','#7c3aed','#dc2626','#0891b2']

    function estadoAtual(fazendaId) {
      const row = pilotoFazendas.find(pf => pf.fazenda_id === fazendaId)
      return row ? row.piloto_id : null
    }
    function colunaDe(fazendaId) {
      return Object.prototype.hasOwnProperty.call(pendentes, fazendaId) ? pendentes[fazendaId] : estadoAtual(fazendaId)
    }

    const q = busca.trim().toLowerCase()
    const fazendasFiltradas = invFazendas.filter(fz =>
      (!filtroCliente || fz.cliente === filtroCliente) &&
      (!q || fz.nome.toLowerCase().includes(q) || fz.cliente.toLowerCase().includes(q))
    )
    const mudancas = Object.keys(pendentes).filter(fid => pendentes[fid] !== estadoAtual(fid))
    const atribuidas = fazendasFiltradas.filter(fz => colunaDe(fz.id)).length

    function onDrop(e, pilotoIdOuNull) {
      e.preventDefault()
      const fazendaId = e.dataTransfer.getData('text/plain')
      if (!fazendaId) return
      setPendentes(p => ({ ...p, [fazendaId]: pilotoIdOuNull }))
      setArrastando(null)
    }

    async function salvar() {
      setSalvando(true)
      try {
        for (const fazendaId of mudancas) {
          await supabase.from('piloto_fazendas').delete().eq('fazenda_id', fazendaId)
          const novoPiloto = pendentes[fazendaId]
          if (novoPiloto) await supabase.from('piloto_fazendas').insert({ fazenda_id: fazendaId, piloto_id: novoPiloto })
        }
        showToast(`✅ ${mudancas.length} atribuição(ões) salva(s)!`)
        fetchInventario()
        onClose()
      } catch (e) {
        showToast('Erro: ' + e.message, 'error')
      } finally {
        setSalvando(false)
      }
    }

    function Card({ fz }) {
      const { pct } = progressoFazenda(fz)
      const areaTotal = invTalhoes.filter(t => t.fazenda_id === fz.id).reduce((a,t) => a + parseFloat(t.area_ha||0), 0)
      return (
        <div draggable
          onDragStart={e => { e.dataTransfer.setData('text/plain', fz.id); setArrastando(fz.id) }}
          onDragEnd={() => setArrastando(null)}
          style={{ background: theme.card, border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, padding: 12, marginBottom: 8, cursor: 'grab', opacity: arrastando === fz.id ? 0.4 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: theme.text }}>{fz.nome}</div>
            <div style={{ fontSize: 11, color: theme.textMuted, whiteSpace: 'nowrap' }}>{areaTotal.toFixed(0)} ha</div>
          </div>
          <div style={{ fontSize: 11, color: theme.textFaint2, marginTop: 2 }}>{fz.cliente}{fz.produto ? ` · ${fz.produto}` : ''}</div>
          {pct != null && (
            <div style={{ height: 6, background: theme.divider, borderRadius: 20, overflow: 'hidden', marginTop: 8 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#059669' : '#2f6fed', borderRadius: 20 }} />
            </div>
          )}
        </div>
      )
    }

    function Coluna({ titulo, cor, icone, pilotoId }) {
      const fazendasCol = fazendasFiltradas.filter(fz => colunaDe(fz.id) === pilotoId)
      return (
        <div onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, pilotoId)}
          style={{ background: theme.bg, borderRadius: 16, minWidth: 250, flex: '0 0 250px', display: 'flex', flexDirection: 'column', maxHeight: '58vh' }}>
          <div style={{ background: cor, color: '#fff', borderRadius: '16px 16px 0 0', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{icone}</span>
            <span style={{ flex: 1, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</span>
            <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{fazendasCol.length} área{fazendasCol.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ padding: 10, overflowY: 'auto', flex: 1 }}>
            {fazendasCol.length === 0 ? (
              <div style={{ fontSize: 11, color: theme.textFaint2, textAlign: 'center', padding: '20px 0' }}>Arraste fazendas pra cá</div>
            ) : fazendasCol.map(fz => <Card key={fz.id} fz={fz} />)}
          </div>
        </div>
      )
    }

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,16,0.55)', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
        <div style={{ background: theme.card, borderRadius: 20, width: '100%', maxWidth: 1100, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: '20px 24px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
              <div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 700, color: theme.text }}>Atribuir áreas</div>
                <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>Arraste as áreas para o piloto responsável — nada é salvo até você confirmar</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ background: theme.bg, color: theme.textMuted, border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 13, cursor: 'pointer' }} onClick={onClose}>Cancelar</button>
                <button disabled={!mudancas.length || salvando} onClick={salvar}
                  style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: mudancas.length ? 'pointer' : 'default', opacity: (!mudancas.length || salvando) ? .5 : 1 }}>
                  {salvando ? 'Salvando...' : `💾 Salvar alterações${mudancas.length ? ` (${mudancas.length})` : ''}`}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <input style={{ ...sG.input, flex: '1 1 200px', width: 'auto' }} placeholder="🔍 Buscar fazenda..." value={busca} onChange={e => setBusca(e.target.value)} />
              <select style={{ ...sG.input, flex: '0 1 180px', width: 'auto' }} value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}>
                <option value="">Cliente (todos)</option>
                {invClientes.filter(c => c.ativo).map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, padding: '0 24px 20px', overflowX: 'auto', flex: 1 }}>
            {pilotosAtivos.map((p, i) => (
              <Coluna key={p.id} titulo={`Piloto: ${p.nome.split(' ')[0]}`} cor={CORES[i % CORES.length]} icone="✈️" pilotoId={p.id} />
            ))}
            <Coluna titulo="Sem piloto" cor="#6b7280" icone="📋" pilotoId={null} />
          </div>
          <div style={{ padding: '12px 24px', borderTop: `1px solid ${theme.divider}`, fontSize: 12, color: theme.textMuted }}>
            Total: {fazendasFiltradas.length} área(s) · {atribuidas} atribuída(s) · {fazendasFiltradas.length - atribuidas} sem piloto
          </div>
        </div>
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
        // Resolve template do cliente (se houver) e passa o pdf_config adiante — se não
        // houver template nenhum, pdfConfig fica undefined e o PDF sai idêntico ao de sempre.
        let pdfConfig
        try {
          const tpl = await resolverTemplate(supabase, relFinal.cliente)
          if (tpl?.pdf_config && Object.keys(tpl.pdf_config).length) pdfConfig = tpl.pdf_config
        } catch (e) { console.warn('Falha ao resolver template de PDF, usando padrão:', e) }
        const doc = await gerarPDFCliente(relFinal, { ...opts, trechos, pdfConfig })
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
      showToast('✅ Usuário criado!'); setNewUser({ nome: '', email: '', senha: '', role: 'piloto' }); setNovoUsuarioModalAberto(false); fetchAll()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
    setCriandoUser(false)
  }

  const fmt = v => v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

  const NavContent = () => (
    <>
      <div style={{ padding: '24px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <span style={{ fontFamily:"'Syne',sans-serif", fontSize: 19, fontWeight: 700, color: '#fff', letterSpacing: -0.5 }}>Orofly<span style={{ color: '#D97706' }}>.</span></span>
          <span style={{ background: '#D97706', color: theme.text, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>ADMIN</span>
        </div>
        <div style={{ fontSize: 10, color: pushAtivo ? '#059669' : '#64748B', letterSpacing: 1, marginBottom: 12 }}>
          {pushAtivo ? '🔔 Notificações ativas' : 'Painel de Administração'}
        </div>
        <input value={sidebarBusca} onChange={e=>setSidebarBusca(e.target.value)} placeholder="Buscar no menu..."
          style={{ width:'100%', boxSizing:'border-box', padding:'8px 12px', background:'rgba(255,255,255,0.05)', border:'1px solid #1E293B', borderRadius:8, fontSize:12, color:'#fff', outline:'none' }}/>
      </div>

      {/* ALERTA SOS */}
      {sosAtivos.length > 0 && (
        <div style={{ margin: '0 12px 8px', background: theme.dangerText, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }} onClick={() => setTab('mapa')}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>🆘 {sosAtivos.length} SOS ATIVO{sosAtivos.length > 1 ? 'S' : ''}</div>
          <div style={{ fontSize: 11, color: '#fcc', marginTop: 2 }}>Toque para ver no mapa</div>
        </div>
      )}

      <nav style={{ padding: '4px 12px', flex: 1 }}>
        {(isSupervisor ? [
          ['op', '🚁 Operações', [
            ['agenda', '📅', 'Agenda', agenda.filter(a=>a.status==='pendente').length],
          ]],
          ['cfg', '⚙️ Configurações', [
            ['pilotos', '👥', 'Equipes', pilotos.length],
          ]],
        ] : [
          // Reorganizado em grupos com accordion — os ids das abas (1º item de cada linha)
          // são os mesmos de sempre, só a organização visual mudou. "Planejamento de Voo" e
          // "Ordens de Serviço" citados no pedido original não viraram itens novos porque não
          // existe tela própria pra eles ainda — Buscar OS já cobre a parte de OS.
          ['dash', '📊 Dashboard', [
            ['dashboard', '📊', 'Início', ''],
            ['sustentabilidade', '🌱', 'Sustentabilidade', ''],
            ['mapa', '🗺️', 'Mapa de Voos', relatorios.filter(r=>r.gps_lat).length],
            ['kml', '🛰️', 'Trajetos KML', relatorios.filter(r=>(r.kml_paths||[]).length>0).length],
          ]],
          ['voos', '🚁 Voos & Operações', [
            ['buscaOS', '🔍', 'Ordens de Serviço', ''],
            ['agenda', '📅', 'Agenda', agenda.filter(a=>a.status==='pendente').length],
          ]],
          ['gestao', '🗂️ Gestão', [
            ['fazendas', '🌾', 'Fazendas & Clientes', invFazendas.length],
            ['inventario', '📦', 'Inventário', invDrones.length + invProdutos.length],
            ['arquivos', '🗂️', 'Arquivos', ''],
          ]],
          ['adminfin', '💼 Administrativo & Financeiro', [
            ['relatorios', '📋', 'Relatórios', filtered.length],
            ['custos', '💰', 'Financeiro', custos.length],
            ['incidentes', '⚠️', 'Incidentes', incidentes.filter(i=>i.status!=='resolvido').length],
          ]],
          ['cfg', '⚙️ Configurações', [
            ['pilotos', '👥', 'Usuários', pilotos.length],
            ['configuracoes', '⚙️', 'Configurações do Sistema', ''],
          ]],
          ['dev', '🛠️ Desenvolvedor', [
            ['dev', '🩺', 'Benchmark Clima & Logs', ''],
          ]],
        ])
        // Busca rápida: filtra os itens de cada grupo pelo rótulo (ou pelo nome do grupo);
        // grupo sem nenhum item batendo some da lista inteira enquanto a busca estiver ativa.
        .map(([grupoId, secao, itens]) => {
          const buscaNorm = sidebarBusca.trim().toLowerCase()
          const itensFiltrados = !buscaNorm ? itens
            : (secao.toLowerCase().includes(buscaNorm) ? itens : itens.filter(([,,lbl]) => lbl.toLowerCase().includes(buscaNorm)))
          return [grupoId, secao, itensFiltrados]
        })
        .filter(([,,itensFiltrados]) => itensFiltrados.length > 0)
        .map(([grupoId, secao, itens]) => {
          const contemAtivo = itens.some(([id]) => id === tab)
          const aberto = sidebarBusca.trim() ? true : (sidebarGruposAbertos[grupoId] ?? contemAtivo)
          return (
            <div key={grupoId} style={{marginBottom:1}}>
              <button onClick={() => setSidebarGruposAbertos(g => ({...g, [grupoId]: !aberto}))}
                style={{display:'flex', alignItems:'center', width:'100%', background: aberto?'rgba(255,255,255,0.08)':'none', border:'none', borderRadius:8, padding:'9px 12px', cursor:'pointer'}}>
                <span style={{flex:1, textAlign:'left', fontSize:11.5, fontWeight:700, color:'#64748B', letterSpacing:1}}>{secao}</span>
                <span style={{fontSize:13, fontWeight:700, color:'#94A3B8', width:14, textAlign:'center'}}>{aberto?'−':'+'}</span>
              </button>
              <div style={{display:'grid', gridTemplateRows: aberto?'1fr':'0fr', transition:'grid-template-rows .3s ease-in-out'}}>
                <div style={{overflow:'hidden', minHeight:0}}>
                  <div style={{display:'flex', flexDirection:'column', gap:2, margin:'4px 0 6px 16px', paddingLeft:10, borderLeft:'2px solid rgba(255,255,255,0.15)'}}>
                    {itens.map(([id, icon, lbl, cnt]) => (
                      <button key={id} style={{ display:'flex', alignItems:'center', gap:8, width:'100%', background: tab===id?'#059669':'transparent', border:'none', borderRadius:6, padding:'6px 9px', cursor:'pointer', color: tab===id?'#fff':'#CBD5E1', fontSize:12.5, fontFamily:"'DM Sans',sans-serif", fontWeight: tab===id?600:500, transition:'all .12s', boxSizing:'border-box' }}
                        onClick={() => { setTab(id); setSidebarOpen(false) }}>
                        <span style={{width:18,height:18,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0,opacity:.9}}>{icon}</span>
                        <span style={{ flex:1, textAlign:'left' }}>{lbl}</span>
                        {cnt!==''&&<span style={{ background: tab===id?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.1)', color: tab===id?'#fff':'#94A3B8', fontSize:10.5, fontWeight:600, padding:'1px 6px', borderRadius:10 }}>{cnt}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      {/* Card de telemetria ao vivo — status operacional em destaque no rodapé do menu. */}
      <div style={{ padding:'0 12px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, padding:'8px 10px', fontSize:11, fontWeight:600, flexWrap:'wrap' }}>
          <span style={{display:'flex',alignItems:'center',gap:6,color:'#4ADE80'}}><span style={{width:6,height:6,borderRadius:'50%',background:'#22C55E',flexShrink:0}}/>{relatorios.filter(r=>r.status==='em_operacao').length} em voo</span>
          <span style={{display:'flex',alignItems:'center',gap:6,color:'#FBBF24'}}><span style={{width:6,height:6,borderRadius:'50%',background:'#F59E0B',flexShrink:0}}/>{relatorios.filter(r=>r.status==='pausado').length} pausados</span>
          {sosAtivos.length>0 && <span style={{display:'flex',alignItems:'center',gap:6,color:theme.dangerText}}><span style={{width:6,height:6,borderRadius:'50%',background:theme.dangerText,flexShrink:0}}/>{sosAtivos.length} SOS</span>}
        </div>
      </div>

      <div style={{ padding:'10px 12px', position:'relative' }}>
        <button style={{ width:'100%', display:'flex', alignItems:'center', gap:10, background: contaMenuAberto?'rgba(255,255,255,0.09)':'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:8, cursor:'pointer', textAlign:'left', boxSizing:'border-box' }}
          onClick={()=>setContaMenuAberto(v=>!v)}>
          <div style={{ width:32, height:32, borderRadius:'50%', background:'#334155', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:12, overflow:'hidden', flexShrink:0 }}>
            {avatarUrl?<img src={avatarUrl} alt="avatar" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:profile?.nome?.[0]?.toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', lineHeight:1.2 }}>{profile?.nome}</div>
            <div style={{ fontSize:10.5, color:'#94A3B8' }}>Admin</div>
          </div>
          {notifNaoVistas>0 && <span style={{ background:theme.dangerText, color:'#fff', fontSize:9, fontWeight:700, borderRadius:20, minWidth:15, height:15, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px', flexShrink:0 }}>{notifNaoVistas>9?'9+':notifNaoVistas}</span>}
          <span style={{ color:'#64748B', fontSize:12, flexShrink:0 }}>⚙️</span>
        </button>

        {contaMenuAberto && (
          <>
            <div style={{ position:'fixed', inset:0, zIndex:19 }} onClick={()=>setContaMenuAberto(false)}/>
            <div style={{ position:'absolute', bottom:'calc(100% + 4px)', left:12, right:12, background:'#111827', border:'1px solid #1E293B', borderRadius:8, boxShadow:'0 12px 28px rgba(0,0,0,0.45)', overflow:'hidden', zIndex:20 }}>
              <button style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', background:'transparent', border:'none', color:'#e2e8f0', fontSize:12.5, padding:'9px 12px', cursor:'pointer', textAlign:'left' }}
                onClick={()=>{setShowNotifs(true); setContaMenuAberto(false)}}>
                Notificações
                {notifNaoVistas>0 && <span style={{ background:theme.dangerText, color:'#fff', fontSize:9, fontWeight:700, borderRadius:20, minWidth:15, height:15, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px' }}>{notifNaoVistas>9?'9+':notifNaoVistas}</span>}
              </button>
              <button style={{ width:'100%', background:'transparent', border:'none', color:'#e2e8f0', fontSize:12.5, padding:'9px 12px', cursor:'pointer', textAlign:'left' }}
                onClick={()=>{setShowPerfil(true); setContaMenuAberto(false)}}>Meu Perfil</button>
              {onSwitchMode && (
                <button style={{ width:'100%', background:'transparent', border:'none', color:'#e2e8f0', fontSize:12.5, padding:'9px 12px', cursor:'pointer', textAlign:'left' }}
                  onClick={()=>{setContaMenuAberto(false); onSwitchMode()}}>Modo Piloto</button>
              )}
              <div style={{ height:1, background:'#1E293B' }}/>
              <button style={{ width:'100%', background:'transparent', border:'none', color:theme.dangerText, fontSize:12.5, padding:'9px 12px', cursor:'pointer', textAlign:'left' }}
                onClick={()=>{setContaMenuAberto(false); sairComConfirmacao()}}>Sair</button>
            </div>
          </>
        )}
        <div style={{ textAlign:'center', fontSize:9, color:'#334155', marginTop:6, letterSpacing:1 }}>v3.8</div>
      </div>
    </>
  )

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:theme.bg, fontFamily:"'DM Sans',sans-serif" }}>

      {!isMobile && (
        <aside style={{ width:240, background:`linear-gradient(180deg,${theme.text} 0%,#0B1120 100%)`, display:'flex', flexDirection:'column', position:'sticky', top:0, height:'100vh', flexShrink:0, overflowY:'auto' }}>
          <NavContent />
        </aside>
      )}

      {isMobile && sidebarOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex' }}>
          <div style={{ width:260, background:theme.text, display:'flex', flexDirection:'column', overflowY:'auto' }}><NavContent /></div>
          <div style={{ flex:1, background:'rgba(0,0,0,.5)' }} onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>

        {isMobile && (
          <div style={{ background:theme.text, padding:'11px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <button style={{ background:'transparent', border:'none', color:theme.textFaint2, fontSize:22, cursor:'pointer' }} onClick={() => setSidebarOpen(true)}>☰</button>
              <span style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, color:'#fff' }}>Orofly<span style={{ color:'#D97706' }}>.</span></span>
              {sosAtivos.length > 0 && <span style={{ background:theme.dangerText, color:'#fff', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20 }}>🆘 {sosAtivos.length}</span>}
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {(isSupervisor ? [['agenda','📅'],['pilotos','👥']] : [['relatorios','📋'],['dashboard','📊'],['mapa','🗺️'],['inventario','📦'],['pilotos','👥']]).map(([id,ic]) => (
                <button key={id} style={{ background: tab===id?'#1E293B':'transparent', border:'none', borderRadius:16, padding:'6px 10px', cursor:'pointer', fontSize:16, color: tab===id?'#fff':theme.textFaint2 }} onClick={() => setTab(id)}>{ic}</button>
              ))}
              {onSwitchMode && <button style={{ background:'#D97706', border:'none', borderRadius:16, padding:'5px 10px', fontSize:11, cursor:'pointer', fontWeight:700 }} onClick={onSwitchMode}>🚁</button>}
              <button style={{ position:'relative', background:'transparent', border:'1px solid #334155', color:theme.textFaint2, borderRadius:16, padding:'5px 10px', fontSize:14, cursor:'pointer' }} onClick={()=>setShowNotifs(true)}>
                🔔
                {notifNaoVistas>0 && <span style={{ position:'absolute', top:-4, right:-4, background:theme.dangerText, color:'#fff', fontSize:9, fontWeight:700, borderRadius:20, minWidth:14, height:14, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px' }}>{notifNaoVistas>9?'9+':notifNaoVistas}</span>}
              </button>
              <button style={{ background:'transparent', border:'1px solid #334155', color:theme.textFaint2, borderRadius:16, padding:'5px 10px', fontSize:11, cursor:'pointer' }} onClick={sairComConfirmacao}>Sair</button>
            </div>
          </div>
        )}

        <main style={{ flex:1, overflow:'auto', padding: isMobile?'12px':'28px 32px' }}>

          {/* ===== RELATÓRIOS ===== */}
          {tab === 'relatorios' && (
            <div>
              <div style={{ marginBottom:18, display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:10 }}>
                <div>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>Relatórios de Voo</div>
                  <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>{filtered.length} de {relatorios.length}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end' }}>
                  {relatorios.some(r=>r.status==='rascunho') && (
                    <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                      onClick={excluirTodosRascunhos}>🗑️ Excluir todos os rascunhos</button>
                  )}
                  {relatorios.some(r=>r.teste) && (()=>{
                    const testes = relatorios.filter(r=>r.teste)
                    const porStatus = {}
                    testes.forEach(r=>{ porStatus[r.status]=(porStatus[r.status]||0)+1 })
                    const resumo = Object.entries(porStatus).map(([st,n])=>`${STATUS_LABEL[st]||st}: ${n}`).join(' · ')
                    return (
                      <div style={{textAlign:'right'}}>
                        <button style={{background:theme.warningBg,color:theme.warningText2,border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                          onClick={excluirTodosTestes}>🧪 Excluir todos os testes ({testes.length})</button>
                        <div style={{fontSize:10,color:theme.warningText2,marginTop:3}}>{resumo}</div>
                      </div>
                    )
                  })()}
                </div>
              </div>
              {sosAtivos.length > 0 && (
                <div style={{ background:theme.dangerBg, border:`2px solid ${theme.dangerText}`, borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:theme.dangerText, marginBottom:8 }}>🆘 SOS ATIVOS — {sosAtivos.length} alerta(s)</div>
                  {sosAtivos.map(r => (
                    <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingBottom:8, borderBottom:'1px solid #f5c6c6' }}>
                      <div>
                        <div style={{ fontSize:13, color:theme.text, fontWeight:600 }}>{r.piloto_nome} — {r.cliente||'sem cliente'}</div>
                        <div style={{ fontSize:11, color:theme.dangerText, marginTop:2 }}>{r.obs1}</div>
                        {r.gps_lat && <a href={`https://maps.google.com/?q=${r.gps_lat},${r.gps_lng}`} target="_blank" rel="noreferrer" style={{ fontSize:11, color:theme.dangerText, fontWeight:600 }}>📍 Ver localização</a>}
                      </div>
                      <button
                        style={{ background:'#059669', color:'#fff', border:'none', borderRadius:16, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', marginLeft:12 }}
                        onClick={() => resolverSOS(r)}
                      >
                        ✅ Resolver
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, background:'#F8FAFC', padding:12, borderRadius:theme.radius||8, border:`1px solid ${theme.cardBorder2}`, alignItems:'center' }}>
                {[['Cliente','cliente'],['Fazenda','fazenda'],['Piloto','piloto'],['Drone','drone']].map(([ph,k]) => (
                  <input key={k} style={sG.fi} placeholder={`${ph}...`} value={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.value }))} />
                ))}
                <select style={sG.fi} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                  <option value="">Todos status</option>
                  <option value="em_operacao">Em operação</option>
                  <option value="pausado">Pausado</option>
                  <option value="finalizado">Finalizado</option>
                  <option value="sos">SOS Ativo</option>
                  <option value="sos_resolvido">SOS Resolvido</option>
                  <option value="rascunho">Rascunho</option>
                </select>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:theme.textMuted, whiteSpace:'nowrap' }}>De:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataIni} onChange={e => setFilters(f => ({ ...f, dataIni: e.target.value }))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:theme.textMuted, whiteSpace:'nowrap' }}>Até:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataFim} onChange={e => setFilters(f => ({ ...f, dataFim: e.target.value }))} />
                </div>
                {Object.values(filters).some(Boolean) && (
                  <button style={{ background:'none', border:'1px solid #e0b0a8', color:theme.dangerText, borderRadius:16, padding:'7px 12px', fontSize:12, cursor:'pointer' }} onClick={() => setFilters({ cliente:'', fazenda:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })}>✕ Limpar</button>
                )}
              </div>

              {loading ? <div style={{ textAlign:'center', color:theme.textMuted, padding:40 }}>Carregando...</div>
              : filtered.length === 0 ? <div style={{ textAlign:'center', color:theme.textMuted, padding:40 }}>Nenhum relatório</div>
              : isMobile ? (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {filtered.map(rel => {
                    const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
                    const isSel = selected?.id === rel.id
                    return (
                      <div key={rel.id} style={{ background:theme.card, borderRadius:12, border:`1px solid ${rel.status==='sos'?theme.dangerText:isSel?'#059669':theme.cardBorder2}`, overflow:'hidden' }}>
                        <div style={{ padding:'13px 15px', cursor:'pointer' }} onClick={() => setSelected(isSel ? null : rel)}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                            <div style={{ fontWeight:600, fontSize:14, color:theme.text }}>{rel.cliente||'—'}</div>
                            <span style={{ background: statusBg(theme)[rel.status]||theme.bg, color: statusColor(theme)[rel.status]||theme.textMuted, fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span>
                          </div>
                          <div style={{ fontSize:12, color:theme.textMuted }}>{rel.fazenda}{rel.produto?` · ${rel.produto}`:''} · {rel.piloto_nome}{rel.ordem_servico?` · OS ${rel.ordem_servico}`:''}</div>
                          <div style={{ fontSize:11, color:'#aaa', marginTop:3 }}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}{tempo?` · ${tempo.total}`:''}</div>
                        </div>
                        {isSel && (
                          <div style={{ padding:'10px 15px', borderTop:`1px solid ${theme.divider}`, background:'#f7fbf8' }}>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom: (rel.kml_arquivos?.length > 0) ? 10 : 0 }}>
                              <button style={sG.actBtn('#2f6fed')} onClick={e => { e.stopPropagation(); setEditModal({...rel}) }}>✏️ Editar</button>
                              <button style={sG.actBtn('#059669')} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'cliente') }}>🟢 Cliente</button>
                              <button style={sG.actBtn('#1a5fa5')} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'word') }}>📝 Word</button>
                              {rel.gps_lat && <a style={{ ...sG.actBtn('#059669'), textDecoration:'none' }} href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer">🗺️</a>}
                              <button style={sG.actBtn(theme.dangerText)} onClick={e => { e.stopPropagation(); setConfirmDelete(rel) }}>🗑️</button>
                            </div>
                            {(() => {
                              const totalCustos = custosDoRel(rel).reduce((a,c)=>a+parseFloat(c.valor||0),0)
                              return totalCustos>0 && <div style={{ fontSize:12, color:theme.textMuted, marginBottom:10 }}>💰 Despesas vinculadas: <strong style={{color:'#059669'}}>R$ {totalCustos.toFixed(2)}</strong></div>
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
                <div style={{ background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}`, overflow:'hidden' }}>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', minWidth:700 }}>
                      <thead>
                        <tr style={{ background:theme.bg }}>
                          {['Cliente','Fazenda','Piloto','Drone','Status','Data','Tempo','Custo','Ações'].map(h => (
                            <th key={h} style={{ padding:'12px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:theme.textFaint2, letterSpacing:0.4, textTransform:'uppercase', borderBottom:`1px solid ${theme.cardBorder2}`, whiteSpace:'nowrap', fontFamily:"'DM Sans',sans-serif" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((rel, i) => {
                          const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
                          const isSel = selected?.id === rel.id
                          return (
                            <React.Fragment key={rel.id}>
                              <tr style={{ background: rel.status==='sos'?theme.dangerBg:isSel?'#F8FAFC':'#fff', cursor:'pointer' }} onClick={() => setSelected(isSel ? null : rel)}>
                                <td style={{ ...sG.td, fontWeight:600 }}>{rel.cliente||'—'}</td>
                                <td style={sG.td}>
                                  {rel.fazenda||'—'}
                                  {rel.ordem_servico && (
                                    <div>
                                      <span style={{fontFamily:'ui-monospace,monospace',fontSize:10,fontWeight:600,color:theme.textMuted,background:theme.divider,padding:'1px 6px',borderRadius:20}}>OS {rel.ordem_servico}</span>
                                    </div>
                                  )}
                                  {(rel.tipo_servico||(rel.qtd_voos&&rel.qtd_voos>1)) && (
                                    <div style={{fontSize:10,color:theme.textFaint2,marginTop:1}}>
                                      {rel.tipo_servico&&(rel.tipo_servico==='catacao'?'Catação':'Área Total')}
                                      {rel.tipo_servico&&rel.qtd_voos>1?' · ':''}
                                      {rel.qtd_voos>1?`${rel.qtd_voos} voos`:''}
                                    </div>
                                  )}
                                </td>
                                <td style={sG.td}>{rel.piloto_nome||'—'}</td>
                                <td style={sG.td}>{rel.drone||'—'}</td>
                                <td style={sG.td}><span style={{ background: statusBg(theme)[rel.status]||theme.bg, color: statusColor(theme)[rel.status]||theme.textMuted, fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span></td>
                                <td style={sG.td}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}</td>
                                <td style={sG.td}>{tempo ? <span style={{ fontSize:12 }}>{tempo.total}{tempo.temPausa?<span style={{ color:theme.textMuted }}> /{tempo.efetivo}</span>:''}</span> : '—'}</td>
                                <td style={sG.td}>{(() => { const t=custosDoRel(rel).reduce((a,c)=>a+parseFloat(c.valor||0),0); return t>0 ? <span style={{fontWeight:600,color:theme.warningText}}>R$ {t.toFixed(2)}</span> : <span style={{color:'#c3d4c9'}}>—</span> })()}</td>
                                <td style={{ ...sG.td, whiteSpace:'nowrap', position:'relative' }}>
                                  <button title="Ações" style={{ background:'none', border:'1px solid #E2E8F0', borderRadius:6, cursor:'pointer', fontSize:14, color:'#64748B', width:28, height:28, lineHeight:1 }}
                                    onClick={e => { e.stopPropagation(); setAcaoMenuAbertoId(v => v===rel.id ? null : rel.id) }}>⋯</button>
                                  {acaoMenuAbertoId===rel.id && (
                                    <>
                                      <div style={{ position:'fixed', inset:0, zIndex:29 }} onClick={e => { e.stopPropagation(); setAcaoMenuAbertoId(null) }}/>
                                      <div style={{ position:'absolute', top:'calc(100% + 2px)', right:14, background:'#fff', border:'1px solid #E2E8F0', borderRadius:8, boxShadow:'0 8px 24px rgba(15,23,42,0.12)', overflow:'hidden', zIndex:30, minWidth:180 }} onClick={e => e.stopPropagation()}>
                                        {[
                                          ['Editar', () => setEditModal({...rel})],
                                          ['Enviar no WhatsApp', () => enviarWhatsApp(rel)],
                                          ['PDF Cliente', () => gerarPDF(rel,null,null,'cliente')],
                                          ['Word / Google Docs', () => gerarPDF(rel,null,null,'word')],
                                          ...(rel.gps_lat ? [['Abrir no Maps', () => window.open(`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`,'_blank')]] : []),
                                        ].map(([lbl,fn]) => (
                                          <button key={lbl} style={{ width:'100%', display:'block', textAlign:'left', background:'none', border:'none', color:'#0F172A', fontSize:12.5, padding:'9px 12px', cursor:'pointer' }}
                                            onClick={() => { setAcaoMenuAbertoId(null); fn() }}>{lbl}</button>
                                        ))}
                                        <div style={{ height:1, background:'#E2E8F0' }}/>
                                        <button style={{ width:'100%', display:'block', textAlign:'left', background:'none', border:'none', color:theme.dangerText, fontSize:12.5, padding:'9px 12px', cursor:'pointer' }}
                                          onClick={() => { setAcaoMenuAbertoId(null); setConfirmDelete(rel) }}>Deletar</button>
                                      </div>
                                    </>
                                  )}
                                </td>
                              </tr>
                              {isSel && (() => {
                                const custosVinculados = custosDoRel(rel)
                                const totalCustos = custosVinculados.reduce((a,c)=>a+parseFloat(c.valor||0),0)
                                const CAT_ICON = CATEGORIA_ICON
                                return (
                                <tr>
                                  <td colSpan={8} style={{ background:'#f0f8f4', borderBottom:`2px solid ${theme.cardBorder2}`, padding:0 }}>
                                    <div style={{ display:'flex', gap:20, padding:'16px 20px', flexWrap:'wrap' }}>
                                      <DetailCol title="Localização" items={[['Local',rel.localizacao],['GPS',rel.gps_lat?`${rel.gps_lat}, ${rel.gps_lng}`:'—'],['Área Total',rel.area_ha?`${rel.area_ha} ha`:null],['Área Aplicada',rel.area_ha?`${areaLiquida(rel)} ha`:null]]} />
                                      <DetailCol title="Cond. Início" items={COND_KEYS.map((k,ii)=>[COND_LABELS[ii],rel[k+'_i']])} />
                                      <DetailCol title="Cond. Fim" items={COND_KEYS.map((k,ii)=>[COND_LABELS[ii],rel[k+'_f']])} />
                                      <DetailCol title="Horários" items={[['Início',fmt(rel.dt_inicio)],['Fim',fmt(rel.dt_fim)],...(tempo?[['Total',tempo.total],...(tempo.temPausa?[['Efetivo',tempo.efetivo]]:[])]:[] )]} />
                                      <DetailCol title="Outros" items={[['OS',rel.ordem_servico],...((rel.produtos||[]).map((p,ii)=>['Prod.'+(ii+1),p])),['Tipo Serviço',rel.tipo_servico==='catacao'?'Catação':rel.tipo_servico==='area_total'?'Área Total':null],['Qtde Voos',rel.qtd_voos>1?rel.qtd_voos:null],['Gota',rel.tamanho_gota],['Vel.',rel.velocidade_drone],['Obs 1',rel.obs1],['Obs 2',rel.obs2]]} />
                                      <div style={{minWidth:200,flex:1}}>
                                        <div style={{fontSize:10,fontWeight:700,color:'#059669',letterSpacing:1,marginBottom:5,fontFamily:"'Syne',sans-serif"}}>CUSTO DO VOO</div>
                                        {custosVinculados.length===0 ? (
                                          <div style={{fontSize:11,color:theme.textMuted}}>—</div>
                                        ) : (
                                          <>
                                            <div style={{fontSize:11,fontWeight:700,color:theme.text,marginBottom:6}}>Total: R$ {totalCustos.toFixed(2)} ({custosVinculados.length})</div>
                                            {custosVinculados.map(c=>(
                                              <div key={c.id} style={{fontSize:11,marginBottom:6,paddingBottom:6,borderBottom:`1px solid ${theme.cardBorder}`,cursor:'pointer'}}
                                                onClick={()=>{setTab('custos');setCustosSubTab('notas');setCustosFiltros(f=>({...f,piloto:c.piloto_nome||''}))}}>
                                                <div style={{display:'flex',justifyContent:'space-between'}}>
                                                  <span style={{color:theme.text,fontWeight:600}}>{CAT_ICON[c.categoria]||'🧾'} {c.categoria}</span>
                                                  <span style={{color:'#059669',fontWeight:700}}>R$ {parseFloat(c.valor||0).toFixed(2)}</span>
                                                </div>
                                                <div style={{color:theme.textFaint2,marginTop:2}}>{c.piloto_nome||'—'} · {new Date(c.data).toLocaleDateString('pt-BR')}</div>
                                                {c.observacao && <div style={{color:theme.textMuted,marginTop:2,fontStyle:'italic'}}>{c.observacao}</div>}
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
            const fmtH = m => { const h=Math.floor(m/60),mn=m%60; return `${h}h ${String(mn).padStart(2,'0')}m` }

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

            const COLORS = ['#059669','#059669','#D97706','#2f6fed','#8e44ad',theme.warningText,theme.dangerText,theme.textMuted]

            const Card = ({title,value,sub,color='#059669',icon}) => (
              <div style={{background:theme.card,borderRadius:theme.radius||8,border:`1px solid ${theme.cardBorder2}`,padding:'16px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:theme.textFaint2,letterSpacing:.4,marginBottom:6,fontFamily:"'DM Sans',sans-serif",textTransform:'uppercase'}}>{title}</div>
                    <div style={{fontSize:isMobile?21:26,fontWeight:700,color:theme.text,fontFamily:"'DM Sans',sans-serif",lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{value}</div>
                    {sub&&<div style={{fontSize:11.5,color:theme.textFaint2,marginTop:5}}>{sub}</div>}
                  </div>
                  {icon&&<div style={{width:38,height:38,borderRadius:8,background:color+'14',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,flexShrink:0}}>{icon}</div>}
                </div>
              </div>
            )

            const SecTitle = ({children,action}) => (
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:theme.text}}>{children}</div>
                {action}
              </div>
            )

            return (
              <div>
                {/* ── Breadcrumb + título ── */}
                <div style={{fontSize:11,color:theme.textFaint2,fontWeight:600,marginBottom:4}}>Início / Dashboard</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:theme.text,marginBottom:16}}>Visão Geral</div>

                {/* ── RESUMO EXECUTIVO (visão geral ao vivo, independente dos filtros abaixo) ── */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                  <div style={{background:theme.card,borderRadius:16,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:44,height:44,borderRadius:12,background:'#059669',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🌱</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,letterSpacing:.3}}>ÁREA PULVERIZADA ESTE ANO</div>
                      <div style={{fontSize:19,fontWeight:700,color:theme.text,fontFamily:"'Syne',sans-serif",fontVariantNumeric:'tabular-nums'}}>{areaEsteAno.toFixed(1)} ha</div>
                    </div>
                  </div>
                  <div style={{background:theme.card,borderRadius:16,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:44,height:44,borderRadius:12,background:'#2f6fed',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>⏱️</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,letterSpacing:.3}}>TOTAL HORAS VOO ANO</div>
                      <div style={{fontSize:19,fontWeight:700,color:theme.text,fontFamily:"'Syne',sans-serif",fontVariantNumeric:'tabular-nums'}}>{fmtH(minutosAno)}</div>
                    </div>
                  </div>
                  <div style={{background:theme.card,borderRadius:16,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:44,height:44,borderRadius:12,background:'#8e44ad',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🧑‍✈️</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,letterSpacing:.3}}>PILOTOS ATIVOS AGORA</div>
                      <div style={{fontSize:19,fontWeight:700,color:theme.text,fontFamily:"'Syne',sans-serif",fontVariantNumeric:'tabular-nums'}}>{pilotosAtivosAgora}</div>
                    </div>
                  </div>
                  <div style={{background:theme.card,borderRadius:16,border:`1px solid ${dronesEmManutencao>0?theme.warningText:theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:44,height:44,borderRadius:12,background:dronesEmManutencao>0?theme.warningText:theme.textMuted,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🔧</span>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,letterSpacing:.3}}>DRONES EM MANUTENÇÃO</div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{fontSize:19,fontWeight:700,color:theme.text,fontFamily:"'Syne',sans-serif"}}>{dronesEmManutencao}</div>
                        {dronesEmManutencao>0&&<span style={{background:theme.warningText,color:'#fff',fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:20}}>PRIORIDADE</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── FILTROS ── */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'16px',marginBottom:16}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,marginBottom:12,color:theme.text}}>🔍 Filtros</div>
                  {/* Período */}
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                    {[['hoje','Hoje'],['semana','7 dias'],['mes','Este mês'],['trimestre','Trimestre'],['ano','Este ano'],['custom','Personalizado']].map(([v,l])=>(
                      <button key={v} style={{background:dashPeriodo===v?'#059669':theme.bg,color:dashPeriodo===v?'#fff':theme.textMuted,border:'none',borderRadius:16,padding:'5px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                        onClick={()=>setDashPeriodo(v)}>{l}</button>
                    ))}
                  </div>
                  {dashPeriodo==='custom'&&(
                    <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                      <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none'}} value={dashDataIni} onChange={e=>setDashDataIni(e.target.value)}/>
                      <span style={{alignSelf:'center',color:theme.textFaint2}}>até</span>
                      <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none'}} value={dashDataFim} onChange={e=>setDashDataFim(e.target.value)}/>
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
                    <button style={{marginTop:8,background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:16,padding:'4px 12px',fontSize:12,cursor:'pointer'}}
                      onClick={()=>{setDashClientes([]);setDashPilotos([]);setDashDrones([]);setDashFazendas([]);setDashProdutos([])}}>✕ Limpar filtros</button>
                  )}
                </div>

                {/* ── KPIs ── */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(5,1fr)',gap:12,marginBottom:16}}>
                  <Card title="ÁREA APLICADA" value={totalArea.toFixed(1)+' ha'} sub={`${totalVoos} voos`} icon="📐"/>
                  <Card title="HORAS VOADAS" value={fmtH(totalMins)} sub={`${eficiencia} ha/h eficiência`} color="#2f6fed" icon="⏱️"/>
                  <Card title="PILOTOS ATIVOS" value={Object.keys(pilotoStats).length} sub="no período" color="#8e44ad" icon="👨‍✈️"/>
                  <Card title="RECEITA (PREÇO CLIENTE)" value={receitaClientes.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} sub={voosComPreco>0?`${voosComPreco} voo(s) com preço cadastrado`:'nenhum cliente com preço cadastrado'} color="#059669" icon="💵"/>
                  <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'16px',boxShadow:'0 1px 4px rgba(0,0,0,.04)'}}>
                    <div style={{fontSize:11,fontWeight:600,color:theme.textFaint2,letterSpacing:.5,marginBottom:8,fontFamily:"'Syne',sans-serif"}}>💰 PREÇO / HA</div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <span style={{fontSize:13,color:theme.textMuted,fontWeight:600}}>R$</span>
                      <input
                        type="number"
                        value={precoHa||''}
                        placeholder="0,00"
                        style={{flex:1,border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'6px 10px',fontSize:18,fontWeight:700,color:theme.warningText,outline:'none',textAlign:'right',width:'100%'}}
                        onChange={e=>{
                          const v=parseFloat(e.target.value)||0
                          setPrecoHa(v)
                          localStorage.setItem('orofly_preco_ha',v)
                        }}/>
                    </div>
                    {precoHa>0
                      ? <div style={{fontSize:11,color:'#059669',fontWeight:600}}>= {(totalArea*precoHa).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div>
                      : <div style={{fontSize:10,color:theme.textFaint2}}>Digite o valor por hectare</div>
                    }
                  </div>
                </div>

                {/* ── KPIs SECUNDÁRIOS ── */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                  <Card title="PROJEÇÃO MÊS" value={projecaoMes+' ha'} sub={`+${projecaoRestante} ha previstos`} color="#059669" icon="📈"/>
                  <Card title="MÉDIA DIÁRIA" value={ritmoHa.toFixed(1)+' ha/dia'} sub="no período" color="#2f6fed" icon="📅"/>
                  <Card title="MÉDIA POR VOO" value={totalVoos>0?(totalArea/totalVoos).toFixed(1)+' ha':'—'} sub="eficiência/voo" color={theme.warningText} icon="✈️"/>
                  <Card title="DRONES EM USO" value={Object.keys(droneStats).length} sub={`${relatorios.filter(r=>r.status==='em_operacao').length} voando agora`} color={theme.dangerText} icon="🚁"/>
                </div>


                {/* ── GRÁFICO TIMELINE ── */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'20px',marginBottom:16}}>
                  <SecTitle>📈 Área Aplicada ao Longo do Tempo (ha)</SecTitle>
                  {areaTimeline.length===0 ? <div style={{color:theme.textFaint2,fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem dados no período</div> : (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={areaTimeline} margin={{top:5,right:10,left:-20,bottom:5}}>
                        <defs>
                          <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#059669" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#059669" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={theme.divider}/>
                        <XAxis dataKey="dia" tick={{fontSize:10,fill:theme.textFaint2}} tickLine={false}/>
                        <YAxis tick={{fontSize:10,fill:theme.textFaint2}} tickLine={false} axisLine={false}/>
                        <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${theme.cardBorder}`,fontSize:12}} formatter={(v)=>[v+' ha','Área']}/>
                        <Area type="monotone" dataKey="area" stroke="#059669" strokeWidth={2} fill="url(#gradArea)"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* ── GRÁFICOS CLIENTES + PRODUTOS ── */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16,marginBottom:16}}>
                  <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'20px'}}>
                    <SecTitle>🏢 Área por Cliente (ha)</SecTitle>
                    {topClientes.length===0 ? <div style={{color:theme.textFaint2,fontSize:13}}>Sem dados</div> : (
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={topClientes} layout="vertical" margin={{top:0,right:10,left:10,bottom:0}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={theme.divider} horizontal={false}/>
                          <XAxis type="number" tick={{fontSize:10,fill:theme.textFaint2}} tickLine={false} axisLine={false}/>
                          <YAxis dataKey="name" type="category" tick={{fontSize:10,fill:theme.textMuted}} tickLine={false} width={70}/>
                          <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${theme.cardBorder}`,fontSize:12}} formatter={(v)=>[v+' ha','Área']}/>
                          <Bar dataKey="value" fill="#059669" radius={[0,6,6,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'20px'}}>
                    <SecTitle>🧪 Produtos Mais Aplicados (ha)</SecTitle>
                    {topProdutos.length===0 ? <div style={{color:theme.textFaint2,fontSize:13}}>Sem dados</div> : (() => {
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
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'20px',marginBottom:16}}>
                  <SecTitle>🌾 Área por Fazenda</SecTitle>
                  {rankingFazendas.length===0 ? <div style={{color:theme.textFaint2,fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem dados no período</div> : (
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={fazendasChart} layout="vertical" margin={{top:0,right:10,left:10,bottom:0}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={theme.divider} horizontal={false}/>
                          <XAxis type="number" tick={{fontSize:10,fill:theme.textFaint2}} tickLine={false} axisLine={false}/>
                          <YAxis dataKey="name" type="category" tick={{fontSize:10,fill:theme.textMuted}} tickLine={false} width={90}/>
                          <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${theme.cardBorder}`,fontSize:12}} formatter={(v)=>[v+' ha','Área']}/>
                          <Bar dataKey="value" fill="#059669" radius={[0,6,6,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                      <div style={{overflowX:'auto'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                          <thead>
                            <tr style={{background:theme.bg}}>
                              {['#','Fazenda','Cliente','Voos','ha','% total'].map(h=>(
                                <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rankingFazendas.map(([nome,s],i)=>(
                              <tr key={nome} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                                <td style={{padding:'8px 10px',fontWeight:700,color:i===0?'#D97706':i===1?'#aaa':i===2?'#cd7f32':theme.textFaint2}}>
                                  {i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}º`}
                                </td>
                                <td style={{padding:'8px 10px',fontWeight:500}}>{nome}</td>
                                <td style={{padding:'8px 10px',color:theme.textMuted}}>{s.cliente}</td>
                                <td style={{padding:'8px 10px',color:theme.textMuted}}>{s.voos}</td>
                                <td style={{padding:'8px 10px',fontWeight:700,color:'#059669'}}>{s.area.toFixed(1)}</td>
                                <td style={{padding:'8px 10px',color:theme.textMuted}}>{totalArea>0?((s.area/totalArea)*100).toFixed(0):0}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── RANKING PILOTOS ── */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'20px',marginBottom:16}}>
                  <SecTitle>🏆 Performance de Pilotos</SecTitle>
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:10,fontFamily:"'Syne',sans-serif"}}>ÁREA VOADA (ha)</div>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={pilotosChart} margin={{top:0,right:0,left:-30,bottom:0}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={theme.divider}/>
                          <XAxis dataKey="name" tick={{fontSize:10,fill:theme.textMuted}} tickLine={false}/>
                          <YAxis tick={{fontSize:10,fill:theme.textFaint2}} tickLine={false} axisLine={false}/>
                          <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${theme.cardBorder}`,fontSize:12}} formatter={(v)=>[v+' ha','Área']}/>
                          <Bar dataKey="area" radius={[6,6,0,0]}>
                            {pilotosChart.map((_,i)=><Cell key={i} fill={i===0?'#D97706':i===1?'#aaa':i===2?'#cd7f32':COLORS[0]}/>)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                        <thead>
                          <tr style={{background:theme.bg}}>
                            {['#','Piloto','Voos','ha','ha/h'].map(h=>(
                              <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif"}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rankingPilotos.map(([nome,st],i)=>(
                            <tr key={nome} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                              <td style={{padding:'8px 10px',fontWeight:700,color:i===0?'#D97706':i===1?'#aaa':i===2?'#cd7f32':theme.textFaint2}}>
                                {i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}º`}
                              </td>
                              <td style={{padding:'8px 10px',fontWeight:500}}>{nome}</td>
                              <td style={{padding:'8px 10px',color:theme.textMuted}}>{st.voos}</td>
                              <td style={{padding:'8px 10px',fontWeight:700,color:'#059669'}}>{st.area.toFixed(1)}</td>
                              <td style={{padding:'8px 10px',color:theme.textMuted}}>{st.minutos>0?(st.area/(st.minutos/60)).toFixed(1):'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* ── HEATMAP DIAS DA SEMANA ── */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'20px',marginBottom:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:4}}>
                    <SecTitle>📅 Produtividade por Dia da Semana</SecTitle>
                    <div style={{display:'flex',gap:6}}>
                      {Object.entries(HEAT_METRICA_INFO).map(([key,info])=>(
                        <button key={key} style={{background:heatMetrica===key?'#059669':theme.bg,color:heatMetrica===key?'#fff':theme.textMuted,border:'none',borderRadius:14,padding:'5px 12px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                          onClick={()=>setHeatMetrica(key)}>{info.label}</button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={heatData} margin={{top:5,right:10,left:-30,bottom:5}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.divider}/>
                      <XAxis dataKey="dia" tick={{fontSize:11,fill:theme.textMuted}} tickLine={false}/>
                      <YAxis tick={{fontSize:10,fill:theme.textFaint2}} tickLine={false} axisLine={false}/>
                      <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${theme.cardBorder}`,fontSize:12}} formatter={(v)=>[`${v}${HEAT_METRICA_INFO[heatMetrica].unidade?' '+HEAT_METRICA_INFO[heatMetrica].unidade:''}`,HEAT_METRICA_INFO[heatMetrica].label]}/>
                      <Bar dataKey={heatMetrica} radius={[6,6,0,0]}>
                        {heatData.map((entry,i)=><Cell key={i} fill={entry[heatMetrica]===Math.max(...heatData.map(d=>d[heatMetrica]))?'#D97706':'#059669'}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{fontSize:11,color:theme.textFaint2,textAlign:'center',marginTop:4}}>⭐ Dia mais produtivo: {heatData.reduce((a,b)=>a[heatMetrica]>b[heatMetrica]?a:b,{[heatMetrica]:0,dia:'—'}).dia}</div>
                </div>

                {/* ── DRONES + MANUTENÇÃO ── */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'20px',marginBottom:16}}>
                  <SecTitle>🚁 Controle de Horas por Drone</SecTitle>
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    {Object.entries(droneStats).sort((a,b)=>b[1].minutos-a[1].minutos).map(([drone,st])=>{
                      const horas=st.minutos/60
                      const limite=droneHorasLimite[drone]||100
                      const pct=Math.min(100,(horas/limite)*100)
                      const alerta=pct>=90, aviso=pct>=70&&pct<90
                      const cor=alerta?theme.dangerText:aviso?theme.warningText:'#059669'
                      // Previsão de quando vai bater o limite
                      const horasPorVoo = st.voos>0 ? horas/st.voos : 0
                      const voosRestantes = horasPorVoo>0 ? Math.floor((limite-horas)/horasPorVoo) : null
                      return (
                        <div key={drone} style={{background:alerta?theme.dangerBg:aviso?theme.warningBg2:'#f7fbf8',borderRadius:10,padding:'12px 14px',border:`1px solid ${alerta?'#f5c6c6':aviso?'#f5e0a0':theme.cardBorder}`}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexWrap:'wrap',gap:6}}>
                            <div>
                              <span style={{fontWeight:600,fontSize:14}}>{drone}</span>
                              {alerta&&<span style={{marginLeft:8,background:theme.dangerText,color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ MANUTENÇÃO</span>}
                              {aviso&&!alerta&&<span style={{marginLeft:8,background:theme.warningText,color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚡ ATENÇÃO</span>}
                              {voosRestantes!==null&&!alerta&&<span style={{marginLeft:8,fontSize:11,color:theme.textFaint2}}>~{voosRestantes} voos para manutenção</span>}
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{fontWeight:700,color:cor}}>{fmtH(st.minutos)}</span>
                              <span style={{color:theme.textFaint2,fontSize:12}}>/</span>
                              <input type="number" value={limite} min={1} style={{width:60,border:`1px solid ${theme.cardBorder2}`,borderRadius:6,padding:'3px 6px',fontSize:12,textAlign:'center',outline:'none'}}
                                onChange={e=>{const n={...droneHorasLimite,[drone]:parseInt(e.target.value)||100};setDroneHorasLimite(n);localStorage.setItem('orofly_drone_horas',JSON.stringify(n))}}/>
                              <span style={{fontSize:11,color:theme.textFaint2}}>h</span>
                            </div>
                          </div>
                          <div style={{background:'#e0e0e0',borderRadius:20,height:8,overflow:'hidden'}}>
                            <div style={{background:`linear-gradient(90deg,${cor},${cor}bb)`,height:'100%',borderRadius:20,width:`${pct}%`,transition:'width .5s'}}/>
                          </div>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:theme.textFaint2,marginTop:4}}>
                            <span>{st.voos} voos registrados</span>
                            <span>{pct.toFixed(0)}% do limite</span>
                          </div>
                        </div>
                      )
                    })}
                    {Object.keys(droneStats).length===0&&<div style={{color:theme.textFaint2,fontSize:13}}>Nenhum dado de drone ainda</div>}
                  </div>
                </div>

                {/* ── WORKING DAYS + FORECAST SEMANAL ── */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'20px',marginBottom:16}}>
                  <SecTitle>📅 Working Days &amp; Forecast Mensal</SecTitle>

                  {/* Config */}
                  <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16,padding:'12px',background:theme.bg,borderRadius:10}}>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <label style={{fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif"}}>DIAS ÚTEIS/ANO</label>
                      <input type="number" value={workingDaysAnual} style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'6px 10px',fontSize:13,width:80,outline:'none',textAlign:'center'}}
                        onChange={e=>{const v=parseInt(e.target.value)||144;setWorkingDaysAnual(v);localStorage.setItem('orofly_working_days',v)}}/>
                      <span style={{fontSize:10,color:theme.textFaint2}}>≈ {workingDaysMes} dias/mês</span>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <label style={{fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif"}}>META MENSAL (ha)</label>
                      <input type="number" value={metaMensalHa||''} placeholder="Ex: 5000" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'6px 10px',fontSize:13,width:100,outline:'none',textAlign:'center'}}
                        onChange={e=>{const v=parseFloat(e.target.value)||0;setMetaMensalHa(v);localStorage.setItem('orofly_meta_mensal',v)}}/>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:4,justifyContent:'flex-end'}}>
                      <div style={{fontSize:12,color:theme.textMuted}}>Working days decorridos: <strong style={{color:'#059669'}}>{workingDaysDecorridos}</strong></div>
                      <div style={{fontSize:12,color:theme.textMuted}}>Working days restantes: <strong style={{color:'#2f6fed'}}>{workingDaysRestantes}</strong></div>
                      <div style={{fontSize:12,color:theme.textMuted}}>ha/dia útil: <strong style={{color:'#059669'}}>{haPerWorkingDay.toFixed(1)}</strong></div>
                    </div>
                    {taxaAtingimentoMeta && (
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,marginLeft:'auto'}}>
                        <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif"}}>PREVISÃO META</div>
                        <div style={{fontSize:28,fontWeight:700,color:parseInt(taxaAtingimentoMeta)>=100?'#059669':parseInt(taxaAtingimentoMeta)>=70?theme.warningText:theme.dangerText,fontFamily:"'Syne',sans-serif"}}>{taxaAtingimentoMeta}%</div>
                        <div style={{fontSize:10,color:theme.textFaint2}}>{projecaoWorkingDay} / {metaMensalHa} ha</div>
                      </div>
                    )}
                  </div>

                  {/* Tabela semanal */}
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',minWidth:400}}>
                      <thead>
                        <tr style={{background:theme.bg}}>
                          {['Semana','Período','Realizado (ha)','Planejado (ha)','% Meta','Status'].map(h=>(
                            <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif",whiteSpace:'nowrap'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {semanas.map(({s,label,iniSem,fimSem,realizado,planejado,isCurrent,isPast})=>{
                          const pct = planejado>0 ? ((realizado/planejado)*100).toFixed(0) : '—'
                          const pctNum = parseInt(pct)
                          const corPct = pctNum>=100?'#059669':pctNum>=70?theme.warningText:theme.dangerText
                          const fmtSemData = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
                          return (
                            <tr key={s} style={{background:isCurrent?theme.successBg:s%2===0?'#f7fbf8':'#fff',fontWeight:isCurrent?600:400}}>
                              <td style={{padding:'9px 10px',fontSize:13}}>
                                <span style={{background:isCurrent?'#059669':isPast?theme.cardBorder2:theme.bg,color:isCurrent?'#fff':isPast?theme.textMuted:theme.textFaint2,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700}}>{label}</span>
                                {isCurrent&&<span style={{marginLeft:6,fontSize:10,color:'#059669'}}>← atual</span>}
                              </td>
                              <td style={{padding:'9px 10px',fontSize:12,color:theme.textMuted}}>{fmtSemData(iniSem)} – {fmtSemData(fimSem)}</td>
                              <td style={{padding:'9px 10px',fontSize:14,fontWeight:700,color:isPast||isCurrent?theme.text:'#aaa'}}>
                                {isPast||isCurrent ? realizado : <span style={{color:'#ccc'}}>—</span>}
                              </td>
                              <td style={{padding:'9px 10px',fontSize:13,color:theme.textMuted}}>{planejado}</td>
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
                        <tr style={{background:theme.bg,fontWeight:700,borderTop:`2px solid ${theme.cardBorder2}`}}>
                          <td colSpan={2} style={{padding:'10px',fontSize:12,fontFamily:"'Syne',sans-serif",color:theme.text}}>TOTAL DO MÊS</td>
                          <td style={{padding:'10px',fontSize:14,color:'#059669'}}>{totalArea.toFixed(1)}</td>
                          <td style={{padding:'10px',fontSize:13,color:theme.textMuted}}>{metaMensalHa||projecaoMes}</td>
                          <td colSpan={2} style={{padding:'10px',fontSize:13,color:taxaAtingimentoMeta&&parseInt(taxaAtingimentoMeta)>=100?'#059669':theme.warningText}}>
                            {taxaAtingimentoMeta ? `Previsão: ${taxaAtingimentoMeta}% da meta` : `Projeção: ${projecaoMes} ha`}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── ANÁLISE PREDITIVA ── */}
                <div style={{background:`linear-gradient(135deg,${theme.text},#059669)`,borderRadius:14,padding:'20px',marginBottom:16,color:'#fff'}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,marginBottom:14}}>🔮 Análise Preditiva</div>
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12}}>
                    <div style={{background:'rgba(255,255,255,.08)',borderRadius:10,padding:14}}>
                      <div style={{fontSize:11,opacity:.7,marginBottom:4}}>PROJEÇÃO DO MÊS ATUAL</div>
                      <div style={{fontSize:24,fontWeight:700,color:'#D97706'}}>{projecaoMes} ha</div>
                      <div style={{fontSize:11,opacity:.7,marginTop:4}}>Faltam {diasRestantes} dias • +{projecaoRestante} ha previstos</div>
                    </div>
                    <div style={{background:'rgba(255,255,255,.08)',borderRadius:10,padding:14}}>
                      <div style={{fontSize:11,opacity:.7,marginBottom:4}}>RITMO ATUAL</div>
                      <div style={{fontSize:24,fontWeight:700,color:'#D97706'}}>{ritmoHa.toFixed(1)} ha/dia</div>
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

            const KpiCard = ({title,value,sub,color='#059669',icon}) => (
              <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:'18px',boxShadow:'0 1px 4px rgba(0,0,0,.04)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:theme.textFaint2,letterSpacing:.5,marginBottom:6,fontFamily:"'Syne',sans-serif"}}>{title}</div>
                    <div style={{fontSize:isMobile?20:24,fontWeight:700,color,fontFamily:"'Syne',sans-serif",lineHeight:1.1}}>{value}</div>
                    {sub&&<div style={{fontSize:11,color:theme.textFaint2,marginTop:4}}>{sub}</div>}
                  </div>
                  {icon&&<div style={{width:40,height:40,borderRadius:12,background:color+'1a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{icon}</div>}
                </div>
              </div>
            )

            return (
              <div>
                {/* HERO */}
                <div style={{background:`linear-gradient(135deg,${theme.text},#059669)`,borderRadius:20,padding:isMobile?'22px 18px':'28px 26px',marginBottom:20,color:'#fff',position:'relative',overflow:'hidden'}}>
                  <div style={{position:'absolute',top:-40,right:-30,width:180,height:180,borderRadius:'50%',background:'rgba(255,255,255,0.07)'}}/>
                  <div style={{position:'absolute',bottom:-30,left:-20,width:120,height:120,borderRadius:'50%',background:'rgba(255,176,32,0.12)'}}/>
                  <div style={{position:'relative'}}>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:1.5,opacity:.8,marginBottom:8}}>🌱 RELATÓRIO DE SUSTENTABILIDADE</div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?24:34,fontWeight:700,marginBottom:10,lineHeight:1.1}}>{co2EvitadoTon.toFixed(1)} toneladas de CO₂ evitadas</div>
                    <div style={{fontSize:13,opacity:.85,maxWidth:600}}>Comparando a aplicação por drone com a alternativa em aviação agrícola tripulada, para a área pulverizada no período selecionado — {areaTotalSust.toFixed(0)} ha.</div>
                  </div>
                </div>

                {/* Filtro de período */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:16,marginBottom:16}}>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {[['mes','Este mês'],['trimestre','Trimestre'],['ano','Este ano'],['custom','Personalizado']].map(([v,l])=>(
                      <button key={v} style={{background:sustPeriodo===v?'#059669':theme.bg,color:sustPeriodo===v?'#fff':theme.textMuted,border:'none',borderRadius:16,padding:'6px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                        onClick={()=>setSustPeriodo(v)}>{l}</button>
                    ))}
                  </div>
                  {sustPeriodo==='custom' && (
                    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                      <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none'}} value={sustDataIni} onChange={e=>setSustDataIni(e.target.value)}/>
                      <span style={{alignSelf:'center',color:theme.textFaint2}}>até</span>
                      <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none'}} value={sustDataFim} onChange={e=>setSustDataFim(e.target.value)}/>
                    </div>
                  )}
                </div>

                {/* KPIs */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                  <KpiCard title="ÁREA PULVERIZADA" value={areaTotalSust.toFixed(1)+' ha'} sub={`${relPeriodo.length} voo(s) no período`} icon="📐"/>
                  <KpiCard title="COMBUSTÍVEL EVITADO" value={combustivelEvitado.toFixed(0)+' L'} sub="vs. avião agrícola" color="#2f6fed" icon="⛽"/>
                  <KpiCard title="CO₂ EVITADO" value={co2EvitadoTon.toFixed(1)+' t'} sub={`${co2EvitadoKg.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg`} color="#059669" icon="🌍"/>
                  <KpiCard title="EQUIVALE A" value={arvoresEquivalentes.toLocaleString('pt-BR')+' árvores'} sub={`ou ${kmCarroEquivalentes.toLocaleString('pt-BR')} km de carro`} color="#D97706" icon="🌳"/>
                </div>

                {/* Comparativo de consumo por hectare */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:20,marginBottom:16}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:theme.text,marginBottom:14}}>⛽ Consumo de Combustível por Hectare — Comparativo</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={comparativo} layout="vertical" margin={{top:0,right:30,left:10,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.divider} horizontal={false}/>
                      <XAxis type="number" tick={{fontSize:10,fill:theme.textFaint2}} unit=" L/ha"/>
                      <YAxis type="category" dataKey="name" width={150} tick={{fontSize:12,fill:theme.textMuted}}/>
                      <Tooltip formatter={v=>[v+' L/ha','Consumo']}/>
                      <Bar dataKey="lha" radius={[0,6,6,0]}>
                        {comparativo.map((c,i)=><Cell key={i} fill={i===0?theme.dangerText:i===1?theme.warningText:'#059669'}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Evolução mensal de CO2 evitado */}
                {serieMensal.length>0 && (
                  <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:20,marginBottom:16}}>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:theme.text,marginBottom:14}}>📈 CO₂ Evitado ao Longo do Tempo (kg)</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={serieMensal} margin={{top:5,right:10,left:-20,bottom:5}}>
                        <defs>
                          <linearGradient id="gradCo2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#059669" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#059669" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={theme.divider}/>
                        <XAxis dataKey="mes" tick={{fontSize:10,fill:theme.textFaint2}}/>
                        <YAxis tick={{fontSize:10,fill:theme.textFaint2}}/>
                        <Tooltip formatter={v=>[v+' kg','CO₂ evitado']}/>
                        <Area type="monotone" dataKey="co2" stroke="#059669" strokeWidth={2} fill="url(#gradCo2)"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Comparativo secundário: pulverização terrestre */}
                <div style={{background:theme.bg,borderRadius:14,padding:16,marginBottom:16,fontSize:12,color:theme.textMuted}}>
                  Para referência: comparado à <strong>pulverização terrestre</strong> (não à aviação), o drone evitaria aproximadamente <strong style={{color:'#059669'}}>{co2TerrestreKg.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg de CO₂</strong> no mesmo período — a pulverização terrestre já é bem mais eficiente que o avião, então essa comparação tende a ser mais conservadora.
                </div>

                {/* Premissas / metodologia (editável) */}
                <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:20,marginBottom:16}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:theme.text,marginBottom:6}}>⚙️ Premissas do Cálculo (ajustáveis)</div>
                  <div style={{fontSize:12,color:theme.textMuted,marginBottom:14}}>Valores de referência do setor — ajuste se tiver dados mais precisos da sua operação ou de um parecer técnico.</div>
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)',gap:14}}>
                    {[
                      ['Avião agrícola (L/ha)', sustAviacaoLha, setSustAviacaoLha, 'orofly_sust_aviacao_lha'],
                      ['Fator CO₂ aviação (kg/L)', sustAviacaoFator, setSustAviacaoFator, 'orofly_sust_aviacao_fator'],
                      ['Pulverização terrestre (L/ha)', sustTerrestreLha, setSustTerrestreLha, 'orofly_sust_terrestre_lha'],
                      ['Fator CO₂ diesel (kg/L)', sustTerrestreFator, setSustTerrestreFator, 'orofly_sust_terrestre_fator'],
                      ['Combustível drone/gerador (L/ha)', sustDroneLha, setSustDroneLha, 'orofly_sust_drone_lha'],
                    ].map(([lbl,val,setVal,key])=>(
                      <div key={key}>
                        <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>{lbl.toUpperCase()}</div>
                        <input type="number" step="0.01" style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
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
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>🗺️ Mapa de Voos</div>
                  <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>{filtered.filter(r=>r.gps_lat).length} voos com GPS · atualiza a cada 30s</div>
                </div>
              </div>

              <div style={{display:'flex',gap:8,marginBottom:16}}>
                {[['voos','✈️ Voos'],['operacoes','📍 Operações']].map(([id,lbl])=>(
                  <button key={id} style={{background:mapaSubTab===id?'#059669':theme.bg,color:mapaSubTab===id?'#fff':theme.textMuted,border:'none',borderRadius:16,padding:'7px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                    onClick={()=>setMapaSubTab(id)}>{lbl}</button>
                ))}
              </div>

              {mapaSubTab==='operacoes' && (
                <div>
                  <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:'10px 14px',marginBottom:14,fontSize:12,color:theme.textMuted}}>
                    Mostra onde os pilotos logaram (azul) e onde iniciaram voos (verde), com um raio de 10km em cada ponto — círculos sobrepostos indicam áreas de operação concentrada.
                  </div>
                  <MapaOperacoes logins={gpsLogins} voos={relatorios.filter(r=>r.gps_lat)} height={isMobile?300:520}/>
                </div>
              )}

              {mapaSubTab==='voos' && (<>
              {sosAtivos.length > 0 && (
                <div style={{ background:theme.dangerBg, border:`2px solid ${theme.dangerText}`, borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:theme.dangerText, marginBottom:8 }}>🆘 SOS ATIVOS</div>
                  {sosAtivos.map(r => (
                    <div key={r.id} style={{ fontSize:13, display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingBottom:8, borderBottom:'1px solid #f5c6c6' }}>
                      <div>
                        <div style={{ fontWeight:600 }}>{r.piloto_nome} — {r.obs1}</div>
                        {r.gps_lat && <a href={`https://maps.google.com/?q=${r.gps_lat},${r.gps_lng}`} target="_blank" rel="noreferrer" style={{ color:theme.dangerText, fontWeight:600, fontSize:12 }}>📍 Abrir no Maps</a>}
                      </div>
                      <button style={{ background:'#059669', color:'#fff', border:'none', borderRadius:16, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', marginLeft:12 }} onClick={() => resolverSOS(r)}>✅ Resolver</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, background:'#F8FAFC', padding:12, borderRadius:theme.radius||8, border:`1px solid ${theme.cardBorder2}`, alignItems:'center' }}>
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
                  <span style={{ fontSize:11, color:theme.textMuted, whiteSpace:'nowrap' }}>De:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataIni} onChange={e => setFilters(f => ({ ...f, dataIni: e.target.value }))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:theme.textMuted, whiteSpace:'nowrap' }}>Até:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataFim} onChange={e => setFilters(f => ({ ...f, dataFim: e.target.value }))} />
                </div>
                {Object.values(filters).some(Boolean) && (
                  <button style={{ background:'none', border:'1px solid #e0b0a8', color:theme.dangerText, borderRadius:16, padding:'7px 12px', fontSize:12, cursor:'pointer' }} onClick={() => setFilters({ cliente:'', fazenda:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })}>✕ Limpar</button>
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
                        style={{ background:theme.card, borderRadius:12, border:`1px solid ${rel.status==='sos'?theme.dangerText:theme.cardBorder2}`, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer' }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13, color:theme.text }}>{rel.cliente||'—'} — {rel.piloto_nome}</div>
                          <div style={{ fontSize:11, color:theme.textMuted, marginTop:2 }}>{rel.gps_lat}, {rel.gps_lng} · {new Date(rel.created_at).toLocaleDateString('pt-BR')}</div>
                        </div>
                        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                          <span style={{ background: statusBg(theme)[rel.status]||theme.bg, color: statusColor(theme)[rel.status]||theme.textMuted, fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span>
                          <a href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ background:'#059669', color:'#fff', borderRadius:8, padding:'5px 10px', fontSize:12, textDecoration:'none', whiteSpace:'nowrap' }}>📍 Ver</a>
                          <span style={{ color:theme.textFaint2 }}>›</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ textAlign:'center', color:theme.textMuted, padding:60, background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}` }}>
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
              <div style={{background:theme.card,borderRadius:20,width:'100%',maxWidth:420,maxHeight:'85vh',overflowY:'auto',padding:22}} onClick={e=>e.stopPropagation()}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>{mapaResumo.cliente||'—'} — {mapaResumo.fazenda||'—'}</div>
                    <div style={{fontSize:12,color:theme.textMuted,marginTop:2}}>👨‍✈️ {mapaResumo.piloto_nome||'—'}</div>
                  </div>
                  <button style={{background:'none',border:'none',fontSize:18,color:theme.textFaint2,cursor:'pointer'}} onClick={()=>setMapaResumo(null)}>✕</button>
                </div>
                <span style={{background:statusBg(theme)[mapaResumo.status]||theme.bg,color:statusColor(theme)[mapaResumo.status]||theme.textMuted,fontSize:11,fontWeight:600,padding:'3px 9px',borderRadius:20,display:'inline-block',marginTop:8,marginBottom:14}}>{STATUS_LABEL[mapaResumo.status]||mapaResumo.status}</span>
                {[
                  ['Talhão', mapaResumo.localizacao],
                  ['Área', mapaResumo.area_ha ? `${mapaResumo.area_ha} ha${mapaResumo.bordadura?` (bordadura ${mapaResumo.bordadura} ha)`:''}` : null],
                  ['Drone', mapaResumo.drone],
                  ['Produtos', (mapaResumo.produtos||[]).join(', ')],
                  ['Data', mapaResumo.dt_inicio ? new Date(mapaResumo.dt_inicio).toLocaleDateString('pt-BR') : new Date(mapaResumo.created_at).toLocaleDateString('pt-BR')],
                  ['OS', mapaResumo.ordem_servico],
                  ['Observação', mapaResumo.obs1||mapaResumo.obs2],
                ].filter(([,v])=>v).map(([l,v])=>(
                  <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:`1px solid ${theme.divider}`,fontSize:13}}>
                    <span style={{color:theme.textMuted,fontWeight:500,minWidth:90}}>{l}</span>
                    <span style={{color:theme.text,textAlign:'right',flex:1,wordBreak:'break-word'}}>{v}</span>
                  </div>
                ))}
                {mapaResumo.gps_lat && mapaResumo.gps_lng && (
                  <div style={{background:theme.divider,borderRadius:10,padding:'10px 12px',marginTop:10,fontSize:12,color:theme.textMuted}}>
                    📍 {mapaResumo.gps_lat}, {mapaResumo.gps_lng}
                    <a href={`https://maps.google.com/?q=${mapaResumo.gps_lat},${mapaResumo.gps_lng}`} target="_blank" rel="noreferrer" style={{display:'block',marginTop:6,color:'#059669',fontWeight:600,textDecoration:'none'}}>🗺️ Abrir no Google Maps</a>
                  </div>
                )}
                <button style={{width:'100%',marginTop:16,background:'#059669',color:'#fff',border:'none',borderRadius:100,padding:12,fontSize:13,fontWeight:700,cursor:'pointer'}}
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
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>🛰️ Trajetos KML</div>
                  <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>{comKml.length} voos com trajeto KML enviado · selecione quais sobrepor no mapa</div>
                </div>

                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, background:'#F8FAFC', padding:12, borderRadius:theme.radius||8, border:`1px solid ${theme.cardBorder2}`, alignItems:'center' }}>
                  {[['Cliente','cliente'],['Piloto','piloto'],['Drone','drone']].map(([ph,k]) => (
                    <input key={k} style={sG.fi} placeholder={`🔍 ${ph}...`} value={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.value }))} />
                  ))}
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <span style={{ fontSize:11, color:theme.textMuted, whiteSpace:'nowrap' }}>De:</span>
                    <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataIni} onChange={e => setFilters(f => ({ ...f, dataIni: e.target.value }))} />
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <span style={{ fontSize:11, color:theme.textMuted, whiteSpace:'nowrap' }}>Até:</span>
                    <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataFim} onChange={e => setFilters(f => ({ ...f, dataFim: e.target.value }))} />
                  </div>
                  {Object.values(filters).some(Boolean) && (
                    <button style={{ background:'none', border:'1px solid #e0b0a8', color:theme.dangerText, borderRadius:16, padding:'7px 12px', fontSize:12, cursor:'pointer' }} onClick={() => setFilters({ cliente:'', fazenda:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })}>✕ Limpar</button>
                  )}
                </div>

                {comKml.length === 0 ? (
                  <div style={{ textAlign:'center', color:theme.textMuted, padding:60, background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}` }}>
                    <div style={{ fontSize:40, marginBottom:12 }}>🛰️</div>
                    <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Nenhum voo com KML</div>
                    <div style={{ fontSize:13 }}>Os trajetos aparecem aqui quando o piloto envia o arquivo KML/KMZ da aeronave no relatório.</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:14 }}>
                      {comKml.map(rel => (
                        <label key={rel.id} style={{ display:'flex', alignItems:'center', gap:10, background:theme.card, borderRadius:10, border:`1px solid ${theme.cardBorder2}`, padding:'9px 14px', cursor:'pointer', fontSize:13 }}>
                          <input type="checkbox" checked={selectedKmlIds.includes(rel.id)} onChange={() => toggleKml(rel.id)} />
                          <span style={{ fontWeight:600, color:theme.text }}>{rel.cliente||'—'} — {rel.piloto_nome}</span>
                          <span style={{ color:theme.textMuted, fontSize:11 }}>{rel.drone} · {new Date(rel.created_at).toLocaleDateString('pt-BR')}</span>
                          <span style={{ marginLeft:'auto', background: statusBg(theme)[rel.status]||theme.bg, color: statusColor(theme)[rel.status]||theme.textMuted, fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span>
                        </label>
                      ))}
                    </div>

                    {selectedKmlIds.length > 0 && (
                      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
                        <button style={{ background:'none', border:'1px solid #e0b0a8', color:theme.dangerText, borderRadius:18, padding:'9px 14px', fontSize:13, cursor:'pointer' }} onClick={() => setSelectedKmlIds([])}>✕ Limpar seleção</button>
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
            const fmtH = m => { const h=Math.floor(m/60),mn=m%60; return `${h}h ${String(mn).padStart(2,'0')}m` }

            return (
              <div>
                {/* Header */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18,flexWrap:'wrap',gap:10}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:theme.text}}>📦 Inventário</div>
                    <div style={{fontSize:12,color:theme.textMuted,marginTop:2}}>{invDrones.length} drones · {invProdutos.length} produtos · {invClientes.length} clientes</div>
                  </div>
                  {['drones','produtos'].includes(invTab) && (
                    <button style={{background:'#059669',color:'#fff',border:'none',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
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
                    <button key={id} style={{background:invTab===id?'#059669':theme.bg,color:invTab===id?'#fff':theme.textMuted,border:'none',borderRadius:16,padding:'7px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
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
                        <button style={{background:'#059669',color:'#fff',border:'none',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                          onClick={()=>{setVeiculoForm({placa:'',marca:'',modelo:'',ano:'',km_atual:'',proxima_manutencao_km:'',proxima_manutencao_data:''});setVeiculoModal('novo')}}>+ Novo Veículo</button>
                      </div>

                      {veiculos.length===0 ? (
                        <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:40,textAlign:'center',color:theme.textMuted}}>Nenhum veículo cadastrado ainda.</div>
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
                              <div key={v.id} style={{background:theme.card,borderRadius:20,border:`1px solid ${alerta?theme.warningText:theme.cardBorder}`,padding:18,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                                  <div>
                                    <div style={{fontWeight:700,fontSize:16,fontFamily:"'Syne',sans-serif"}}>🚗 {v.placa} {alerta&&<span style={{background:theme.warningBg,color:theme.warningText,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,marginLeft:6}}>⚠️ Manutenção próxima</span>}</div>
                                    <div style={{fontSize:12,color:theme.textMuted,marginTop:2}}>{v.marca} {v.modelo}{v.ano?` · ${v.ano}`:''} · {(v.km_atual||0).toLocaleString('pt-BR')} km</div>
                                  </div>
                                  <div style={{display:'flex',gap:6}}>
                                    <button style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:14,padding:'5px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>{setVeiculoForm({placa:v.placa,marca:v.marca||'',modelo:v.modelo||'',ano:v.ano||'',km_atual:v.km_atual||'',proxima_manutencao_km:v.proxima_manutencao_km||'',proxima_manutencao_data:v.proxima_manutencao_data||''});setVeiculoModal(v)}}>✏️</button>
                                    <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:14,padding:'5px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>excluirVeiculo(v)}>🗑️</button>
                                  </div>
                                </div>

                                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:14,marginTop:12}}>
                                  {/* Nova viagem */}
                                  <div style={{background:'#f9fbfa',borderRadius:14,padding:12}}>
                                    <div style={{fontSize:11,fontWeight:700,color:theme.textMuted,marginBottom:8}}>🛣️ Registrar Viagem</div>
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
                                      <div style={{marginTop:10,borderTop:`1px solid ${theme.divider}`,paddingTop:8}}>
                                        {viagensVeic.map(vg=>(
                                          <div key={vg.id} style={{fontSize:11,color:theme.textMuted,padding:'3px 0'}}>{new Date(vg.data).toLocaleDateString('pt-BR')} · {vg.destino||'—'} · {((vg.km_final||0)-(vg.km_inicial||0)).toFixed(0)} km{vg.ordem_servico?` · OS ${vg.ordem_servico}`:''}</div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Nova manutenção */}
                                  <div style={{background:'#f9fbfa',borderRadius:14,padding:12}}>
                                    <div style={{fontSize:11,fontWeight:700,color:theme.textMuted,marginBottom:8}}>🔧 Registrar Manutenção</div>
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
                                    <button style={{...sG.btn,background:theme.warningText}} onClick={()=>salvarManutencao(v)}>Salvar Manutenção</button>
                                    {manutVeic.length>0 && (
                                      <div style={{marginTop:10,borderTop:`1px solid ${theme.divider}`,paddingTop:8}}>
                                        {manutVeic.map(m=>(
                                          <div key={m.id} style={{fontSize:11,color:theme.textMuted,padding:'3px 0'}}>{new Date(m.data).toLocaleDateString('pt-BR')} · {m.tipo}{m.custo?` · R$ ${parseFloat(m.custo).toFixed(2)}`:''}</div>
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
                          <div style={{background:theme.card,borderRadius:20,width:'100%',maxWidth:380,padding:22}} onClick={e=>e.stopPropagation()}>
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
                              <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginTop:4}}>PRÓXIMA MANUTENÇÃO (OPCIONAL)</div>
                              <div style={{display:'flex',gap:8}}>
                                <input type="number" style={{...sG.fi,flex:1}} placeholder="Km" value={veiculoForm.proxima_manutencao_km} onChange={e=>setVeiculoForm(f=>({...f,proxima_manutencao_km:e.target.value}))}/>
                                <input type="date" style={{...sG.fi,flex:1}} value={veiculoForm.proxima_manutencao_data} onChange={e=>setVeiculoForm(f=>({...f,proxima_manutencao_data:e.target.value}))}/>
                              </div>
                            </div>
                            <div style={{display:'flex',gap:8,marginTop:20}}>
                              <button style={{flex:1,background:theme.bg,color:theme.textMuted,border:'none',borderRadius:100,padding:12,fontSize:13,cursor:'pointer'}} onClick={()=>setVeiculoModal(null)}>Cancelar</button>
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
                  const MOV_COLORS = ['#059669','#059669','#D97706','#2f6fed','#8e44ad',theme.warningText,theme.dangerText,theme.textMuted]

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
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16,background:theme.card,padding:12,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,alignItems:'center'}}>
                        <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 160px'}}
                          value={movFiltros.produto} onChange={e=>setMovFiltros(f=>({...f,produto:e.target.value}))}>
                          <option value="">Todos os produtos</option>
                          {invProdutos.map(p=><option key={p.id} value={p.nome}>{p.nome}</option>)}
                        </select>
                        <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 160px'}}
                          value={movFiltros.fazenda} onChange={e=>setMovFiltros(f=>({...f,fazenda:e.target.value}))}>
                          <option value="">Todas as fazendas</option>
                          {fazendasDisponiveis.map(fz=><option key={fz} value={fz}>{fz}</option>)}
                        </select>
                        <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',flex:'0 0 170px'}}
                          value={movFiltros.tipo} onChange={e=>setMovFiltros(f=>({...f,tipo:e.target.value}))}>
                          <option value="">Todos os tipos</option>
                          <option value="baixa_relatorio">📋 Baixa (relatório)</option>
                          <option value="entrada">📦 Entrada</option>
                          <option value="perda">⚠️ Perda</option>
                          <option value="ajuste">🔧 Ajuste</option>
                        </select>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontSize:11,color:theme.textMuted}}>De:</span>
                          <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',minWidth:120}} value={movFiltros.dataIni} onChange={e=>setMovFiltros(f=>({...f,dataIni:e.target.value}))}/>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontSize:11,color:theme.textMuted}}>Até:</span>
                          <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',minWidth:120}} value={movFiltros.dataFim} onChange={e=>setMovFiltros(f=>({...f,dataFim:e.target.value}))}/>
                        </div>
                        {filtrosAtivos && (
                          <button style={{background:'none',border:'1px solid #e0b0a8',color:theme.dangerText,borderRadius:16,padding:'7px 12px',fontSize:12,cursor:'pointer'}}
                            onClick={()=>setMovFiltros({produto:'',fazenda:'',tipo:'',dataIni:'',dataFim:''})}>✕ Limpar</button>
                        )}
                      </div>

                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)',gap:12,marginBottom:16}}>
                        <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                          <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>ENTRADAS (FILTRADO)</div>
                          <div style={{fontSize:20,fontWeight:700,color:'#059669'}}>+{totalEntradas.toFixed(1)}</div>
                        </div>
                        <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                          <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>SAÍDAS (FILTRADO)</div>
                          <div style={{fontSize:20,fontWeight:700,color:theme.dangerText}}>-{totalSaidas.toFixed(1)}</div>
                        </div>
                        <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                          <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>PRODUTO MAIS CONSUMIDO</div>
                          <div style={{fontSize:15,fontWeight:700,color:theme.text}}>{maisConsumido?`${maisConsumido[0]} (${maisConsumido[1].toFixed(1)})`:'—'}</div>
                        </div>
                      </div>

                      {/* Gráficos */}
                      {movFiltrados.length>0 && (
                        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1.3fr 1fr',gap:12,marginBottom:16}}>
                          <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:16}}>
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:theme.text,marginBottom:10}}>📊 Consumo por Produto</div>
                            {chartProdutos.length===0 ? <div style={{color:theme.textFaint2,fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem saídas no período</div> : (
                              <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={chartProdutos} layout="vertical" margin={{left:10,right:10}}>
                                  <CartesianGrid strokeDasharray="3 3" stroke={theme.divider}/>
                                  <XAxis type="number" tick={{fontSize:10,fill:theme.textFaint2}}/>
                                  <YAxis type="category" dataKey="name" width={100} tick={{fontSize:10,fill:theme.textMuted}}/>
                                  <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${theme.cardBorder}`,fontSize:12}}/>
                                  <Bar dataKey="value" fill="#059669" radius={[0,6,6,0]}/>
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:16}}>
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:theme.text,marginBottom:10}}>🥧 Por Tipo</div>
                            {chartTipo.length===0 ? <div style={{color:theme.textFaint2,fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem dados</div> : (
                              <ResponsiveContainer width="100%" height={220}>
                                <PieChart>
                                  <Pie data={chartTipo} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({name,percent})=>`${(percent*100).toFixed(0)}%`}>
                                    {chartTipo.map((_,i)=><Cell key={i} fill={MOV_COLORS[i%MOV_COLORS.length]}/>)}
                                  </Pie>
                                  <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${theme.cardBorder}`,fontSize:12}}/>
                                  <Legend wrapperStyle={{fontSize:11}}/>
                                </PieChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder}`,padding:16,gridColumn:isMobile?'auto':'1 / -1'}}>
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:700,color:theme.text,marginBottom:10}}>📈 Movimentação ao Longo do Tempo</div>
                            {chartTempo.length===0 ? <div style={{color:theme.textFaint2,fontSize:13,textAlign:'center',padding:'20px 0'}}>Sem dados no período</div> : (
                              <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={chartTempo} margin={{top:5,right:10,left:-20,bottom:5}}>
                                  <CartesianGrid strokeDasharray="3 3" stroke={theme.divider}/>
                                  <XAxis dataKey="dia" tick={{fontSize:10,fill:theme.textFaint2}} tickLine={false}/>
                                  <YAxis tick={{fontSize:10,fill:theme.textFaint2}} tickLine={false} axisLine={false}/>
                                  <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${theme.cardBorder}`,fontSize:12}}/>
                                  <Legend wrapperStyle={{fontSize:11}}/>
                                  <Bar dataKey="entradas" name="Entradas" fill="#059669" radius={[4,4,0,0]}/>
                                  <Bar dataKey="saidas" name="Saídas" fill={theme.dangerText} radius={[4,4,0,0]}/>
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Novo movimento manual */}
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:16,marginBottom:16}}>
                        <div style={{fontSize:13,fontWeight:700,color:theme.text,marginBottom:10,fontFamily:"'Syne',sans-serif"}}>+ Novo Movimento</div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                          <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',flex:'1 1 160px'}}
                            value={movForm.produto} onChange={e=>setMovForm(f=>({...f,produto:e.target.value}))}>
                            <option value="">Produto...</option>
                            {invProdutos.filter(p=>p.ativo).map(p=><option key={p.id}>{p.nome}</option>)}
                          </select>
                          <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',flex:'0 0 160px'}}
                            value={movForm.tipo} onChange={e=>setMovForm(f=>({...f,tipo:e.target.value}))}>
                            <option value="entrada">📦 Entrada (compra)</option>
                            <option value="perda">⚠️ Perda</option>
                            <option value="ajuste">🔧 Ajuste</option>
                          </select>
                          <input style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',flex:'0 0 120px'}}
                            type="number" placeholder="Quantidade" value={movForm.quantidade} onChange={e=>setMovForm(f=>({...f,quantidade:e.target.value}))}/>
                          <input style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',flex:'1 1 200px'}}
                            placeholder="Observação (opcional)" value={movForm.obs} onChange={e=>setMovForm(f=>({...f,obs:e.target.value}))}/>
                          <button style={{background:'#059669',color:'#fff',border:'none',borderRadius:16,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:movSaving?'default':'pointer',opacity:movSaving?.6:1}}
                            disabled={movSaving} onClick={salvarMovimento}>{movSaving?'Salvando...':'Salvar'}</button>
                        </div>
                        <div style={{fontSize:11,color:theme.textFaint2,marginTop:8}}>Entrada soma ao estoque · Perda e Ajuste você digita a quantidade a remover (ou negativa, para ajuste que soma).</div>
                      </div>

                      {/* Histórico */}
                      {invMovimentos.length===0 ? (
                        <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:40,textAlign:'center',color:theme.textMuted}}>
                          Nenhum movimento ainda.<br/>As baixas aparecem aqui automaticamente quando um relatório é finalizado, ou rode o SQL de setup se a tabela ainda não existir.
                        </div>
                      ) : movFiltrados.length===0 ? (
                        <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:30,textAlign:'center',color:theme.textMuted,fontSize:13}}>
                          Nenhum movimento encontrado com esses filtros.
                        </div>
                      ) : (
                        <div style={{overflowX:'auto'}}>
                          <div style={{fontSize:11,color:theme.textFaint2,marginBottom:8}}>{movFiltrados.length} movimento(s)</div>
                          <table style={{width:'100%',borderCollapse:'collapse',minWidth:600}}>
                            <thead>
                              <tr style={{background:theme.bg}}>
                                {['Data','Produto','Tipo','Fazenda','Quantidade','Obs'].map(h=>(
                                  <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif",whiteSpace:'nowrap'}}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {movFiltrados.slice(0,200).map((m,i)=>(
                                <tr key={m.id} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                                  <td style={{padding:'8px 10px',fontSize:12,color:theme.textMuted,whiteSpace:'nowrap'}}>{new Date(m.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                                  <td style={{padding:'8px 10px',fontSize:13,fontWeight:600,color:theme.text}}>{m.produto_nome}</td>
                                  <td style={{padding:'8px 10px',fontSize:12,color:theme.textMuted}}>{TIPO_LABEL[m.tipo]||m.tipo}</td>
                                  <td style={{padding:'8px 10px',fontSize:12,color:theme.textMuted}}>{fazendaDoMovimento(m)||'—'}</td>
                                  <td style={{padding:'8px 10px',fontSize:13,fontWeight:700,color:m.quantidade<0?theme.dangerText:'#059669'}}>{m.quantidade>0?'+':''}{m.quantidade} {m.unidade||''}</td>
                                  <td style={{padding:'8px 10px',fontSize:12,color:theme.textMuted}}>{m.obs||'—'}</td>
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
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:40,textAlign:'center',color:theme.textMuted}}>
                        Nenhum drone cadastrado ainda.<br/>Clique em "+ Novo Drone" para começar.
                      </div>
                    ) : (
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(300px,1fr))',gap:12}}>
                        {invDrones.map(d => {
                          const horasMin = horasDrone[d.nome?.trim().toLowerCase()] || 0
                          const limite = d.horas_limite || 100
                          const pct = Math.min(100,(horasMin/60/limite)*100)
                          const alerta = pct>=90, aviso = pct>=70&&pct<90
                          const cor = alerta?theme.dangerText:aviso?theme.warningText:'#059669'
                          return (
                            <div key={d.id} style={{background:theme.card,borderRadius:12,border:`1px solid ${alerta?'#f5c6c6':aviso?'#f5e0a0':theme.cardBorder2}`,padding:16,position:'relative'}}>
                              {!d.ativo && <span style={{position:'absolute',top:12,right:12,background:'#fee',color:theme.dangerText,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>INATIVO</span>}
                              {alerta && <span style={{position:'absolute',top:12,right:12,background:theme.dangerText,color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ MANUTENÇÃO</span>}
                              {aviso && !alerta && <span style={{position:'absolute',top:12,right:12,background:theme.warningText,color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚡ ATENÇÃO</span>}
                              <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:theme.text,marginBottom:2}}>{d.nome}</div>
                              <div style={{fontSize:12,color:theme.textMuted,marginBottom:10}}>{d.fabricante} {d.modelo} {d.serial?`· S/N: ${d.serial}`:''}</div>
                              {/* Barra horas */}
                              <div style={{marginBottom:10}}>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                                  <span style={{color:theme.textMuted}}>Horas voadas</span>
                                  <span style={{fontWeight:700,color:cor}}>{fmtH(horasMin)} / {limite}h</span>
                                </div>
                                <div style={{background:theme.divider,borderRadius:20,height:7,overflow:'hidden'}}>
                                  <div style={{background:cor,height:'100%',borderRadius:20,width:`${pct}%`,transition:'width .5s'}}/>
                                </div>
                              </div>
                              {d.obs && <div style={{fontSize:11,color:theme.textMuted,marginBottom:8,fontStyle:'italic'}}>{d.obs}</div>}
                              <div style={{display:'flex',gap:6}}>
                                <button style={{flex:1,background:theme.bg,color:'#059669',border:'none',borderRadius:16,padding:'6px',fontSize:12,cursor:'pointer',fontWeight:600}}
                                  onClick={()=>{setDroneForm(initDroneForm(d));setDroneModal(d)}}>✏️ Editar</button>
                                <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:16,padding:'6px 10px',fontSize:12,cursor:'pointer'}}
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
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:40,textAlign:'center',color:theme.textMuted}}>
                        Nenhum produto cadastrado ainda.<br/>Clique em "+ Novo Produto" para começar.
                      </div>
                    ) : (
                      <div style={{overflowX:'auto'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',minWidth:560}}>
                          <thead>
                            <tr style={{background:theme.bg}}>
                              {['Produto','Fabricante','Estoque','Mínimo','Validade','Registro MAPA',''].map(h=>(
                                <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:11,fontWeight:700,color:theme.textMuted,fontFamily:"'Syne',sans-serif"}}>{h}</th>
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
                                    <div style={{fontWeight:600,fontSize:13,color:p.ativo?theme.text:'#aaa'}}>{p.nome}</div>
                                    {!p.ativo && <span style={{fontSize:10,color:theme.dangerText}}>inativo</span>}
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:theme.textMuted}}>{p.fabricante||'—'}</td>
                                  <td style={{padding:'9px 12px'}}>
                                    <span style={{fontWeight:700,color:baixo?theme.dangerText:'#059669',fontSize:13}}>{p.estoque_atual} {p.unidade}</span>
                                    {baixo && <span style={{marginLeft:4,fontSize:10,color:theme.dangerText}}>⚠️ baixo</span>}
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:theme.textMuted}}>{p.estoque_minimo} {p.unidade}</td>
                                  <td style={{padding:'9px 12px'}}>
                                    <span style={{fontSize:12,color:vencido?theme.dangerText:vencendo?theme.warningText:theme.text,fontWeight:vencido||vencendo?700:400}}>
                                      {fmtData(p.validade)}
                                      {vencido && ' ⛔'}{vencendo && !vencido && ` (${dias}d)`}
                                    </span>
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:theme.textMuted}}>{p.registro_mapa||'—'}</td>
                                  <td style={{padding:'9px 12px',whiteSpace:'nowrap'}}>
                                    <button style={{background:theme.bg,color:'#059669',border:'none',borderRadius:14,padding:'4px 8px',fontSize:11,cursor:'pointer',marginRight:4}}
                                      onClick={()=>{setProdutoForm(initProdutoForm(p));setProdutoModal(p)}}>✏️</button>
                                    <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:14,padding:'4px 8px',fontSize:11,cursor:'pointer'}}
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
                    <div style={{background:theme.card,borderRadius:16,width:'100%',maxWidth:460,maxHeight:'90vh',overflowY:'auto',padding:24}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>
                        {droneModal==='novo'?'🚁 Novo Drone':'✏️ Editar Drone'}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                        {[['NOME / IDENTIFICAÇÃO','nome','text','Ex: OROFLY_01'],['FABRICANTE','fabricante','text','DJI'],['MODELO','modelo','text','T70'],['Nº DE SÉRIE','serial','text',''],['ANO DE AQUISIÇÃO','ano_aquisicao','number','2024'],['LIMITE DE HORAS','horas_limite','number','100']].map(([lbl,key,type,ph])=>(
                          <div key={key} style={{gridColumn:key==='nome'?'1/-1':'auto'}}>
                            <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>{lbl}</div>
                            <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                              type={type} placeholder={ph} value={droneForm[key]||''}
                              onChange={e=>setDroneForm(f=>({...f,[key]:e.target.value}))} />
                          </div>
                        ))}
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>OBSERVAÇÕES</div>
                          <textarea style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',resize:'none',height:60,boxSizing:'border-box'}}
                            value={droneForm.obs||''} onChange={e=>setDroneForm(f=>({...f,obs:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setDroneForm(f=>({...f,ativo:!f.ativo}))}>
                          <div style={{width:36,height:20,borderRadius:10,background:droneForm.ativo?'#059669':theme.cardBorder2,position:'relative',transition:'all .2s',flexShrink:0}}>
                            <div style={{width:14,height:14,borderRadius:7,background:theme.card,position:'absolute',top:3,left:droneForm.ativo?19:3,transition:'all .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:theme.text}}>Drone ativo</span>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:20}}>
                        <button style={{flex:1,background:theme.bg,color:theme.textMuted,border:'none',borderRadius:18,padding:12,fontSize:13,cursor:'pointer'}}
                          onClick={()=>setDroneModal(null)}>Cancelar</button>
                        <button style={{flex:2,background:'#059669',color:'#fff',border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}}
                          disabled={invSaving} onClick={salvarDrone}>{invSaving?'Salvando...':'💾 Salvar'}</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* MODAL PRODUTO */}
                {produtoModal && (
                  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div style={{background:theme.card,borderRadius:16,width:'100%',maxWidth:460,maxHeight:'90vh',overflowY:'auto',padding:24}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>
                        {produtoModal==='novo'?'🧪 Novo Produto':'✏️ Editar Produto'}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                        {[['NOME DO PRODUTO','nome','text','Ex: Triclon'],['FABRICANTE','fabricante','text','Syngenta'],['UNIDADE','unidade','text','L'],['REGISTRO MAPA','registro_mapa','text','BR-00000']].map(([lbl,key,type,ph])=>(
                          <div key={key} style={{gridColumn:key==='nome'?'1/-1':'auto'}}>
                            <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>{lbl}</div>
                            <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                              type={type} placeholder={ph} value={produtoForm[key]||''}
                              onChange={e=>setProdutoForm(f=>({...f,[key]:e.target.value}))} />
                          </div>
                        ))}
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>ESTOQUE ATUAL</div>
                          <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="number" step="0.1" value={produtoForm.estoque_atual||0}
                            onChange={e=>setProdutoForm(f=>({...f,estoque_atual:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>ESTOQUE MÍNIMO</div>
                          <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="number" step="0.1" value={produtoForm.estoque_minimo||0}
                            onChange={e=>setProdutoForm(f=>({...f,estoque_minimo:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>DOSE PADRÃO ({produtoForm.unidade||'L'}/ha)</div>
                          <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="number" step="0.001" placeholder="Ex: 0.6" value={produtoForm.dose_padrao??''}
                            onChange={e=>setProdutoForm(f=>({...f,dose_padrao:e.target.value}))} />
                        </div>
                        <div style={{display:'flex',alignItems:'flex-end',paddingBottom:6}}>
                          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:theme.textMuted,cursor:'pointer'}}>
                            <input type="checkbox" checked={produtoForm.dose_auto!==false}
                              onChange={e=>setProdutoForm(f=>({...f,dose_auto:e.target.checked}))}/>
                            Pré-preencher no app
                          </label>
                        </div>
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>VALIDADE</div>
                          <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="date" value={produtoForm.validade||''}
                            onChange={e=>setProdutoForm(f=>({...f,validade:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>OBSERVAÇÕES</div>
                          <textarea style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',resize:'none',height:60,boxSizing:'border-box'}}
                            value={produtoForm.obs||''} onChange={e=>setProdutoForm(f=>({...f,obs:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setProdutoForm(f=>({...f,ativo:!f.ativo}))}>
                          <div style={{width:36,height:20,borderRadius:10,background:produtoForm.ativo?'#059669':theme.cardBorder2,position:'relative',transition:'all .2s',flexShrink:0}}>
                            <div style={{width:14,height:14,borderRadius:7,background:theme.card,position:'absolute',top:3,left:produtoForm.ativo?19:3,transition:'all .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:theme.text}}>Produto ativo</span>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:20}}>
                        <button style={{flex:1,background:theme.bg,color:theme.textMuted,border:'none',borderRadius:18,padding:12,fontSize:13,cursor:'pointer'}}
                          onClick={()=>setProdutoModal(null)}>Cancelar</button>
                        <button style={{flex:2,background:'#059669',color:'#fff',border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}}
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
            // Ranking por % concluído vira só uma parede de barras 100% quando a maioria da
            // carteira já tá pronta — não separa sinal de ruído, e o gestor não teria o que
            // fazer com essa informação (não dá pra "agir" em cima do que já terminou).
            // Ordenar pela área que AINDA FALTA (em ha, não em %) já resolve isso sozinho: só
            // fica "cheio de barra 100%" se sobrar muita coisa pra fazer, o que já seria, em
            // si, a informação certa a mostrar. É a pergunta que quem opera a frota realmente
            // faz de manhã: "pra onde eu mando o drone hoje, e quanto falta lá?"
            const chartFazendas = [...comCadastro]
              .map(f => ({ ...f, pendente: Math.max(0, f.areaTotal * (1 - (f.pct||0)/100)) }))
              .filter(f => f.pendente > 0.05)
              .sort((a,b) => b.pendente - a.pendente)
              .slice(0,10)
              .map(f => ({ name: f.nome.length>16?f.nome.slice(0,15)+'…':f.nome, pendente: parseFloat(f.pendente.toFixed(1)), pct: parseFloat((f.pct||0).toFixed(1)) }))

            // Sem talhão cadastrado com área conta como "não iniciada" também — na prática,
            // se não tem nem área lançada, o trabalho ainda nem começou de verdade.
            function fzStatus(f) {
              if (f.pct===null || f.pct===0) return 'nao_iniciada'
              if (f.pct>=100) return 'concluida'
              return 'parcial'
            }
            const FZ_STATUS_INFO = {
              concluida: { label:'Concluída', bg:theme.successBg, cor:theme.successText||'#059669' },
              parcial: { label:'Parcial', bg:theme.warningBg, cor:theme.warningText2 },
              nao_iniciada: { label:'Não iniciada', bg:theme.divider, cor:theme.textMuted },
            }
            const FzBadge = ({status}) => {
              const s = FZ_STATUS_INFO[status]
              return (
                <span style={{display:'inline-flex',alignItems:'center',gap:5,background:s.bg,color:s.cor,fontSize:10.5,fontWeight:600,padding:'3px 8px',borderRadius:20,whiteSpace:'nowrap'}}>
                  <span style={{width:5,height:5,borderRadius:'50%',background:s.cor,flexShrink:0}}/>{s.label}
                </span>
              )
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
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:theme.text}}>🌾 Fazendas & Clientes</div>
                    <div style={{fontSize:12,color:theme.textMuted,marginTop:2}}>{invFazendas.length} fazendas · {invClientes.length} clientes</div>
                  </div>
                  {fzTab==='clientes' && (
                    <button style={{background:'#059669',color:'#fff',border:'none',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                      onClick={()=>{setClienteForm(initClienteForm());setClienteModal('novo')}}>
                      + Novo Cliente
                    </button>
                  )}
                  {fzTab==='fazendas' && (
                    <div style={{display:'flex',gap:8}}>
                      <button style={{background:theme.card,color:'#059669',border:'1px solid #059669',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                        onClick={()=>setImportarFazendasAberto(true)}>
                        📤 Importar planilha
                      </button>
                      <button style={{background:'#059669',color:'#fff',border:'none',borderRadius:18,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                        onClick={()=>{setFzForm({cliente:'',nome:'',produto:'',cep:'',lat:'',lng:'',id_fazenda:'',mapa_lat_min:'',mapa_lat_max:'',mapa_lng_min:'',mapa_lng_max:''});setFzEditId(null);setFzMapaFile(null);setFzMapaExistente(null);setFzModal(true)}}>
                        + Nova Fazenda
                      </button>
                    </div>
                  )}
                </div>

                {/* Sub-tabs */}
                <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
                  {[['visao','📊 Visão Geral'],['fazendas','🌾 Fazendas'],['clientes','🏢 Clientes'],['equipes','🧑‍🤝‍🧑 Equipes']].map(([id,lbl])=>(
                    <button key={id} style={{background:fzTab===id?'#059669':theme.bg,color:fzTab===id?'#fff':theme.textMuted,border:'none',borderRadius:16,padding:'7px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                      onClick={()=>setFzTab(id)}>{lbl}</button>
                  ))}
                </div>

                {/* ── VISÃO GERAL (BI) ── */}
                {fzTab==='visao' && (
                  <div>
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                        <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>FAZENDAS CADASTRADAS</div>
                        <div style={{fontSize:20,fontWeight:700,color:theme.text}}>{invFazendas.length}</div>
                      </div>
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                        <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>ÁREA TOTAL CADASTRADA</div>
                        <div style={{fontSize:20,fontWeight:700,color:theme.text}}>{somaTotal.toFixed(1)} ha</div>
                      </div>
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                        <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>ÁREA REALIZADA</div>
                        <div style={{fontSize:20,fontWeight:700,color:'#059669'}}>{somaRealizada.toFixed(1)} ha</div>
                      </div>
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                        <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>% CONCLUÍDO (GERAL)</div>
                        <div style={{fontSize:20,fontWeight:700,color:'#2f6fed'}}>{pctGeral.toFixed(1)}%</div>
                      </div>
                    </div>

                    {chartFazendas.length>0 && (
                      <div style={{background:theme.card,borderRadius:theme.radius||8,border:`1px solid ${theme.cardBorder}`,padding:20,marginBottom:16}}>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:600,color:theme.text,marginBottom:2}}>Maior área pendente</div>
                        <div style={{fontSize:12,color:theme.textFaint2,marginBottom:16}}>Top 10 fazendas por hectare ainda não aplicado</div>
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={chartFazendas} layout="vertical" margin={{left:10,right:36}} barCategoryGap={10}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme.divider} horizontal={false}/>
                            <XAxis type="number" tick={{fontSize:11,fill:theme.textFaint2}} unit=" ha" axisLine={{stroke:theme.divider}} tickLine={false}/>
                            <YAxis type="category" dataKey="name" width={110} tick={{fontSize:11,fill:theme.textMuted}} axisLine={{stroke:theme.divider}} tickLine={false}/>
                            <Tooltip cursor={{fill:theme.divider}} contentStyle={{borderRadius:theme.radius||8,border:`1px solid ${theme.cardBorder}`,fontSize:12,boxShadow:'0 4px 12px rgba(15,23,42,0.08)'}} formatter={(v,n,p)=>[`${v} ha pendentes (${p.payload.pct}% feito)`,'']}/>
                            <Bar dataKey="pendente" fill={theme.warningText} radius={[0,3,3,0]} maxBarSize={18}
                              label={({x,y,width,height,value})=>(
                                <text x={x+width+6} y={y+height/2} dy={4} fontSize={11} fill={theme.textFaint2}>{value} ha</text>
                              )}/>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                      <input style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'8px 12px',fontSize:13,outline:'none',flex:'1 1 220px',boxSizing:'border-box'}}
                        placeholder="🔍 Buscar por cliente ou fazenda..." value={fzSearch} onChange={e=>setFzSearch(e.target.value)}/>
                      <div style={{flex:'0 0 200px'}}>
                        <MultiSelectDropdown label="Produto" options={['Inseticida','Herbicida','Fungicida']}
                          selected={fzProdutoFiltro?[fzProdutoFiltro]:[]}
                          onChange={arr=>setFzProdutoFiltro(arr.length?arr[arr.length-1]:'')}/>
                      </div>
                    </div>

                    <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center',justifyContent:'space-between'}}>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        {[
                          ['', `Todas (${fazendasBI.length})`, theme.textMuted, theme.bg],
                          ['concluida', `Concluídas (${qtdConcluidas})`, '#059669', theme.successBg],
                          ['parcial', `Parciais (${qtdParciais})`, theme.warningText2, theme.warningBg],
                          ['nao_iniciada', `Não iniciadas (${qtdNaoIniciadas})`, theme.textMuted, theme.bg],
                        ].map(([val,label,cor,bg])=>(
                          <button key={val} style={{background:fzStatusFiltro===val?cor:bg,color:fzStatusFiltro===val?'#fff':cor,border:'none',borderRadius:theme.radius||8,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}
                            onClick={()=>setFzStatusFiltro(val)}>{label}</button>
                        ))}
                      </div>
                      <div style={{display:'flex',background:theme.divider,borderRadius:theme.radius||8,padding:3,gap:2,flexShrink:0}}>
                        {[['tabela','Tabela'],['cards','Cards']].map(([v,lbl])=>(
                          <button key={v} style={{background:fzVisaoView===v?theme.card:'transparent',color:fzVisaoView===v?theme.text:theme.textMuted,border:'none',borderRadius:6,padding:'5px 12px',fontSize:11.5,fontWeight:600,cursor:'pointer',boxShadow:fzVisaoView===v?'0 1px 2px rgba(15,23,42,0.08)':'none'}}
                            onClick={()=>setFzVisaoView(v)}>{lbl}</button>
                        ))}
                      </div>
                    </div>

                    {fazendasBIFiltradas.length===0 ? (
                      <div style={{background:theme.card,borderRadius:theme.radius||8,border:`1px solid ${theme.cardBorder2}`,padding:40,textAlign:'center',color:theme.textMuted}}>
                        Nenhuma fazenda encontrada.
                      </div>
                    ) : fzVisaoView==='tabela' ? (
                      <div style={{background:theme.card,borderRadius:theme.radius||8,border:`1px solid ${theme.cardBorder2}`,overflow:'auto'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
                          <thead>
                            <tr style={{borderBottom:`1px solid ${theme.cardBorder2}`}}>
                              {['Fazenda','Cliente / Produto','Status','Progresso','Área (ha)','Ciclo desde',''].map((h,i)=>(
                                <th key={h+i} style={{textAlign:i>=3&&i<=4?'right':'left',padding:'9px 12px',fontSize:10.5,fontWeight:600,color:theme.textFaint2,letterSpacing:.4,textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {fazendasBIFiltradas.map(fz=>(
                              <tr key={fz.id} style={{borderBottom:`1px solid ${theme.divider}`}}>
                                <td style={{padding:'9px 12px',fontWeight:600,color:theme.text,whiteSpace:'nowrap'}}>{fz.nome}</td>
                                <td style={{padding:'9px 12px',color:theme.textMuted,whiteSpace:'nowrap'}}>{fz.cliente}{fz.produto?` · ${fz.produto}`:''}</td>
                                <td style={{padding:'9px 12px'}}>{fz.pct!==null && <FzBadge status={fzStatus(fz)}/>}</td>
                                <td style={{padding:'9px 12px',minWidth:140}}>
                                  {fz.pct===null ? <span style={{fontSize:11.5,color:theme.textFaint,fontStyle:'italic'}}>sem talhões</span> : (
                                    <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'flex-end'}}>
                                      <div style={{flex:1,background:theme.divider,borderRadius:20,height:6,overflow:'hidden',maxWidth:90}}>
                                        <div style={{width:`${fz.pct}%`,height:'100%',background:fz.pct>=100?theme.primary:theme.warningText,borderRadius:20}}/>
                                      </div>
                                      <span style={{fontWeight:600,color:theme.text,fontSize:12,width:34,textAlign:'right'}}>{fz.pct.toFixed(0)}%</span>
                                    </div>
                                  )}
                                </td>
                                <td style={{padding:'9px 12px',textAlign:'right',color:theme.textMuted,whiteSpace:'nowrap'}}>
                                  {fz.pct!==null ? `${fz.areaRealizada.toFixed(1)} / ${fz.areaTotal.toFixed(1)}` : '—'}
                                </td>
                                <td style={{padding:'9px 12px',color:theme.textFaint,whiteSpace:'nowrap'}}>{fz.campanha_inicio ? new Date(fz.campanha_inicio).toLocaleDateString('pt-BR') : '—'}</td>
                                <td style={{padding:'9px 12px',whiteSpace:'nowrap'}}>
                                  <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                                    {fz.pct!==null && fz.numVoos>0 && (
                                      <button style={{background:'transparent',color:theme.textMuted,border:`1px solid ${theme.cardBorder2}`,borderRadius:6,padding:'4px 9px',fontSize:11,cursor:'pointer'}}
                                        onClick={()=>zerarProgresso(fz)}>Zerar</button>
                                    )}
                                    <button style={{background:'transparent',color:theme.primary,border:`1px solid ${theme.cardBorder2}`,borderRadius:6,padding:'4px 9px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                                      onClick={()=>{setRelatorioPeriodoForm({dataIni:'',dataFim:''});setRelatorioPeriodoTalhoesSel(null);setRelatorioPeriodoObs('');setRelatorioPeriodoFotoBase64(null);setRelatorioPeriodoFz(fz)}}>Relatório</button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
                        {fazendasBIFiltradas.map(fz=>(
                          <div key={fz.id} style={{background:theme.card,borderRadius:theme.radius||8,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8,gap:8}}>
                              <div style={{minWidth:0}}>
                                <div style={{fontWeight:700,fontSize:14,color:theme.text}}>{fz.nome}</div>
                                <div style={{fontSize:11,color:theme.textMuted}}>{fz.cliente}{fz.produto?` · ${fz.produto}`:''}</div>
                              </div>
                              {fz.pct!==null && <FzBadge status={fzStatus(fz)}/>}
                            </div>
                            {fz.pct===null ? (
                              <div style={{fontSize:12,color:theme.textFaint,fontStyle:'italic'}}>Sem talhões cadastrados com área</div>
                            ) : (
                              <>
                                <div style={{background:theme.divider,borderRadius:20,height:6,overflow:'hidden',marginBottom:6}}>
                                  <div style={{width:`${fz.pct}%`,height:'100%',background:fz.pct>=100?theme.primary:theme.warningText,borderRadius:20}}/>
                                </div>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                                  <span style={{color:theme.textMuted}}>{fz.areaRealizada.toFixed(1)} / {fz.areaTotal.toFixed(1)} ha</span>
                                  <span style={{fontWeight:700,color:theme.primary}}>{fz.pct.toFixed(0)}%</span>
                                </div>
                                {fz.campanha_inicio && <div style={{fontSize:10,color:theme.textFaint,marginTop:4}}>Ciclo desde {new Date(fz.campanha_inicio).toLocaleDateString('pt-BR')}</div>}
                                {fz.rankingPilotos.length>0 && (
                                  <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${theme.divider}`}}>
                                    <div style={{fontSize:9,fontWeight:700,color:theme.textFaint2,letterSpacing:.3,marginBottom:4}}>QUEM FEZ</div>
                                    {fz.rankingPilotos.map(([nome,area])=>(
                                      <div key={nome} style={{display:'flex',justifyContent:'space-between',fontSize:11,color:theme.textMuted,padding:'2px 0'}}>
                                        <span>{nome}</span>
                                        <span style={{fontWeight:600,color:theme.text}}>{area.toFixed(1)} ha</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                            <div style={{display:'flex',gap:8,marginTop:10}}>
                              {fz.pct!==null && fz.numVoos>0 && (
                                <button style={{background:'transparent',color:theme.textMuted,border:`1px solid ${theme.cardBorder2}`,borderRadius:theme.radius||8,padding:'7px 10px',fontSize:11.5,cursor:'pointer'}}
                                  onClick={()=>zerarProgresso(fz)}>Zerar</button>
                              )}
                              <button style={{flex:1,background:'transparent',color:theme.primary,border:`1px solid ${theme.cardBorder2}`,borderRadius:theme.radius||8,padding:'7px 10px',fontSize:11.5,fontWeight:600,cursor:'pointer'}}
                                onClick={()=>{setRelatorioPeriodoForm({dataIni:'',dataFim:''});setRelatorioPeriodoTalhoesSel(null);setRelatorioPeriodoObs('');setRelatorioPeriodoFotoBase64(null);setRelatorioPeriodoFz(fz)}}>Relatório do período</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── RELATÓRIO DE ÁREA POR PERÍODO (modal) ── */}
                {relatorioPeriodoFz && (()=>{
                  const talhoesFzPeriodo = invTalhoes.filter(t=>t.fazenda_id===relatorioPeriodoFz.id)
                  const talhoesSelAtual = relatorioPeriodoTalhoesSel ?? talhoesFzPeriodo.map(t=>t.nome)
                  const toggleTalhaoPeriodo = nome => setRelatorioPeriodoTalhoesSel(sel => {
                    const atual = sel ?? talhoesFzPeriodo.map(t=>t.nome)
                    return atual.includes(nome) ? atual.filter(n=>n!==nome) : [...atual,nome]
                  })
                  // Prévia de quantos voos entram no PDF com o filtro atual (data + talhões
                  // marcados) — cada um vira uma página cheia igual o PDF Cliente individual,
                  // então avisa antes pra não pegar o admin de surpresa com um arquivo enorme.
                  const { dataIni: diPrev, dataFim: dfPrev } = relatorioPeriodoForm
                  const voosPreviewCount = (diPrev && dfPrev) ? relatorios.filter(r=>{
                    if(r.cliente!==relatorioPeriodoFz.cliente || r.fazenda!==relatorioPeriodoFz.nome || r.status!=='finalizado') return false
                    const dRef = (r.dt_inicio || r.created_at || '').slice(0,10)
                    if(!(dRef && dRef>=diPrev && dRef<=dfPrev)) return false
                    const talhoesDoVoo = (r.localizacao||'').split(',').map(s=>s.trim()).filter(Boolean)
                    return talhoesDoVoo.length===0 || talhoesDoVoo.some(n=>talhoesSelAtual.includes(n))
                  }).length : null
                  return (
                  <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,.7)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:14}}
                    onClick={()=>!relatorioPeriodoLoading && setRelatorioPeriodoFz(null)}>
                    <div style={{background:theme.card,borderRadius:20,width:'100%',maxWidth:460,padding:20,maxHeight:'92vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>📄 Relatório do Período</div>
                        <button style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:14,padding:'5px 10px',fontSize:12,cursor:'pointer'}}
                          onClick={()=>setRelatorioPeriodoFz(null)} disabled={!!relatorioPeriodoLoading}>✕</button>
                      </div>
                      <div style={{fontSize:12,color:theme.textMuted,marginBottom:16}}>🌾 {relatorioPeriodoFz.nome} — {relatorioPeriodoFz.cliente}</div>
                      <div style={{display:'flex',gap:10,marginBottom:16}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:3}}>DE</div>
                          <input type="date" style={{...sG.fi,width:'100%',boxSizing:'border-box'}} value={relatorioPeriodoForm.dataIni}
                            onChange={e=>setRelatorioPeriodoForm(f=>({...f,dataIni:e.target.value}))}/>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:3}}>ATÉ</div>
                          <input type="date" style={{...sG.fi,width:'100%',boxSizing:'border-box'}} value={relatorioPeriodoForm.dataFim}
                            onChange={e=>setRelatorioPeriodoForm(f=>({...f,dataFim:e.target.value}))}/>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
                        {[['7',7],['30',30],['Mês atual','mes']].map(([lbl,val])=>(
                          <button key={lbl} style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:14,padding:'5px 12px',fontSize:11,fontWeight:600,cursor:'pointer'}}
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

                      {/* Consolidado: capa + um relatório completo (igual o PDF Cliente) por
                          voo de cada talhão marcado, anexado em sequência no mesmo arquivo. */}
                      <div style={{marginBottom:14}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>TALHÕES NO RELATÓRIO ({talhoesSelAtual.length}/{talhoesFzPeriodo.length})</div>
                          <button style={{background:'none',border:'none',color:'#059669',fontSize:11,fontWeight:600,cursor:'pointer'}}
                            onClick={()=>setRelatorioPeriodoTalhoesSel(talhoesSelAtual.length===talhoesFzPeriodo.length?[]:talhoesFzPeriodo.map(t=>t.nome))}>
                            {talhoesSelAtual.length===talhoesFzPeriodo.length?'Desmarcar todos':'Marcar todos'}
                          </button>
                        </div>
                        {talhoesFzPeriodo.length===0 ? (
                          <div style={{fontSize:12,color:theme.textFaint2,fontStyle:'italic'}}>Fazenda sem talhões cadastrados.</div>
                        ) : (
                          <div style={{maxHeight:150,overflowY:'auto',border:`1px solid ${theme.cardBorder2}`,borderRadius:10,padding:'4px 10px'}}>
                            {talhoesFzPeriodo.map(t=>(
                              <label key={t.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',fontSize:12.5,color:theme.text,cursor:'pointer',borderBottom:`1px solid ${theme.divider}`}}>
                                <input type="checkbox" checked={talhoesSelAtual.includes(t.nome)} onChange={()=>toggleTalhaoPeriodo(t.nome)} style={{width:15,height:15,accentColor:'#059669'}}/>
                                <span style={{flex:1}}>{t.nome}</span>
                                {t.area_ha && <span style={{color:theme.textFaint2,fontSize:11}}>{parseFloat(t.area_ha).toFixed(1)} ha</span>}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{marginBottom:14}}>
                        <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>OBSERVAÇÕES (opcional, aparece na capa)</div>
                        <textarea style={{...sG.fi,width:'100%',boxSizing:'border-box',minHeight:60,resize:'vertical',fontFamily:'inherit'}}
                          placeholder="Ex: período com condições climáticas favoráveis, sem intercorrências."
                          value={relatorioPeriodoObs} onChange={e=>setRelatorioPeriodoObs(e.target.value)}/>
                      </div>

                      <div style={{marginBottom:4}}>
                        <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>FOTO GERAL DA FAZENDA (opcional, aparece no topo da capa)</div>
                        {relatorioPeriodoFotoBase64 ? (
                          <div style={{position:'relative'}}>
                            <img src={relatorioPeriodoFotoBase64} alt="foto geral" style={{width:'100%',maxHeight:140,objectFit:'cover',borderRadius:10,display:'block'}}/>
                            <button style={{position:'absolute',top:6,right:6,background:'rgba(11,18,16,0.65)',color:'#fff',border:'none',borderRadius:20,width:24,height:24,cursor:'pointer'}}
                              onClick={()=>setRelatorioPeriodoFotoBase64(null)}>✕</button>
                          </div>
                        ) : (
                          <button style={{width:'100%',background:theme.bg,color:theme.textMuted,border:`1.5px dashed ${theme.cardBorder2}`,borderRadius:10,padding:'14px',fontSize:12,cursor:'pointer'}}
                            onClick={()=>document.getElementById('relatorio-periodo-foto-input')?.click()}>📷 Escolher foto</button>
                        )}
                        <input id="relatorio-periodo-foto-input" type="file" accept="image/*" style={{display:'none'}}
                          onChange={e=>{
                            const f=e.target.files[0]; if(!f) return
                            const r=new FileReader(); r.onload=ev=>setRelatorioPeriodoFotoBase64(ev.target.result); r.readAsDataURL(f)
                          }}/>
                      </div>

                      {voosPreviewCount!=null && (
                        <div style={{background:theme.warningBg,border:`1px solid ${theme.warningText||'#c98a1c'}`,borderRadius:10,padding:'8px 12px',fontSize:11.5,color:theme.warningText2||theme.warningText,marginBottom:4}}>
                          ⚠️ Esse PDF vai sair com <strong>{voosPreviewCount+1} página{voosPreviewCount+1===1?'':'s'}</strong> ({voosPreviewCount>0?`1 capa + ${voosPreviewCount} relatório${voosPreviewCount===1?'':'s'} de voo`:'só a capa, nenhum voo no período'}). As páginas seguintes à capa são o relatório normal do PDF Cliente, um por voo.
                        </div>
                      )}
                      <div style={{display:'flex',gap:8,marginTop:16}}>
                        <button style={{flex:1,background:theme.bg,color:theme.textMuted,border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:relatorioPeriodoLoading?.6:1}}
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
                  )
                })()}

                {/* ── FAZENDAS & TALHÕES (cadastro) ── */}
                {fzTab==='fazendas' && (
                  <div>
                    {invFazendas.length>0 && (
                      <div style={{background:theme.card,borderRadius:16,border:`1px solid ${theme.cardBorder}`,padding:12,marginBottom:16,display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
                        <div style={{flex:'2 1 220px'}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:3}}>BUSCAR</div>
                          <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
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
                          <button style={{background:'none',border:'1px solid #e0b0a8',color:theme.dangerText,borderRadius:12,padding:'8px 12px',fontSize:12,cursor:'pointer'}}
                            onClick={()=>{setFzSearch('');setFzClienteFiltro('');setFzProdutoFiltro('')}}>✕ Limpar</button>
                        )}
                      </div>
                    )}

                    {invFazendas.length===0 ? (
                      <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:40,textAlign:'center',color:theme.textMuted}}>
                        Nenhuma fazenda cadastrada ainda.<br/>Clique em "+ Nova Fazenda" para começar.
                      </div>
                    ) : (()=>{
                      if (q && fazendasFiltradas.length===0) return (
                        <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:30,textAlign:'center',color:theme.textMuted,fontSize:13}}>
                          Nenhuma fazenda encontrada para "{fzSearch}".
                        </div>
                      )
                      return [...new Set(fazendasFiltradas.map(f=>f.cliente))].map(cli=>(
                        <div key={cli} style={{marginBottom:20}}>
                          <div style={{display:'inline-block',fontSize:12,fontWeight:700,color:'#fff',background:'#059669',marginBottom:10,padding:'4px 12px',borderRadius:20,fontFamily:"'Syne',sans-serif"}}>🏢 {cli}</div>
                          {fazendasFiltradas.filter(f=>f.cliente===cli).map(fz=>{
                            const talhoesFz = invTalhoes.filter(t=>t.fazenda_id===fz.id)
                            const areaFz = talhoesFz.reduce((a,t)=>a+parseFloat(t.area_ha||0),0)
                            const tf = tlForm[fz.id]||{nome:'',area_ha:''}
                            const aberto = !!fzExpandido[fz.id]
                            return (
                              <div key={fz.id} style={{background:theme.card,borderRadius:16,border:`1px solid ${theme.cardBorder}`,marginBottom:8,boxShadow:'0 2px 8px rgba(11,18,16,0.04)',overflow:'hidden'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',cursor:'pointer'}}
                                  onClick={()=>setFzExpandido(s=>({...s,[fz.id]:!s[fz.id]}))}>
                                  <span style={{fontWeight:700,fontSize:14,display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                                    🌾 {fz.nome}
                                    {fz.produto && <span style={{background:theme.divider2,color:'#145c38',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,flexShrink:0}}>{fz.produto}</span>}
                                    <span style={{fontSize:11,color:theme.textFaint2,fontWeight:500,flexShrink:0}}>{talhoesFz.length} talhão(ões){areaFz>0?` · ${areaFz.toFixed(1)} ha`:''}</span>
                                  </span>
                                  <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                                    {fz.mapa_pdf_path && (
                                      <button style={{background:theme.successBg,color:'#059669',border:'none',borderRadius:15,padding:'4px 10px',fontSize:11,cursor:'pointer'}}
                                        onClick={(e)=>{ e.stopPropagation(); setMapaViewerFazenda(fz) }}>🗺️</button>
                                    )}
                                    <button style={{background:theme.bg,color:'#059669',border:'none',borderRadius:15,padding:'4px 10px',fontSize:11,cursor:'pointer'}}
                                      onClick={(e)=>{
                                        e.stopPropagation()
                                        setFzForm({cliente:fz.cliente,nome:fz.nome,produto:fz.produto||'',cep:fz.cep||'',lat:fz.lat??'',lng:fz.lng??'',id_fazenda:fz.id_fazenda||'',
                                          mapa_lat_min:fz.mapa_lat_min??'',mapa_lat_max:fz.mapa_lat_max??'',mapa_lng_min:fz.mapa_lng_min??'',mapa_lng_max:fz.mapa_lng_max??''})
                                        setFzEditId(fz.id); setFzMapaFile(null); setFzMapaExistente(fz.mapa_pdf_path||null); setFzModal(true)
                                      }}>✏️</button>
                                    <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:15,padding:'4px 10px',fontSize:11,cursor:'pointer'}}
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
                                    {(fz.lat&&fz.lng)&&<div style={{fontSize:11,color:theme.textFaint2,marginBottom:8}}>📍 {fz.lat}, {fz.lng}{fz.cep?` · CEP ${fz.cep}`:''}</div>}
                                    <div style={{background:'#f9fbfa',borderRadius:14,padding:12}}>
                                      <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,marginBottom:8}}>📐 TALHÕES</div>
                                      {talhoesFz.length===0 && <div style={{fontSize:12,color:'#aaa',fontStyle:'italic',marginBottom:8}}>Nenhum talhão cadastrado ainda</div>}
                                      {talhoesFz.map(t=> talhaoEditId===t.id ? (
                                        <div key={t.id} style={{display:'flex',gap:6,alignItems:'center',background:theme.card,border:`1px solid #059669`,borderRadius:8,padding:'7px 10px',marginBottom:5}}>
                                          <input style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:7,padding:'6px 8px',fontSize:12,outline:'none',flex:2}}
                                            placeholder="Nome do talhão" value={talhaoEditForm.nome}
                                            onChange={e=>setTalhaoEditForm(f=>({...f,nome:e.target.value}))}/>
                                          <input style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:7,padding:'6px 8px',fontSize:12,outline:'none',flex:1}}
                                            placeholder="Área (ha)" type="number" value={talhaoEditForm.area_ha}
                                            onChange={e=>setTalhaoEditForm(f=>({...f,area_ha:e.target.value}))}/>
                                          <button style={{background:theme.successBg,color:'#059669',border:'none',borderRadius:12,padding:'6px 10px',fontSize:13,fontWeight:700,cursor:'pointer',flexShrink:0}}
                                            onClick={async()=>{
                                              if(!talhaoEditForm.nome){alert('Nome do talhão');return}
                                              const {error}=await supabase.from('talhoes').update({nome:talhaoEditForm.nome,area_ha:talhaoEditForm.area_ha?parseFloat(talhaoEditForm.area_ha):null}).eq('id',t.id)
                                              if(error){alert('Erro: '+error.message);return}
                                              setTalhaoEditId(null);fetchInventario()
                                            }}>✓</button>
                                          <button style={{background:'none',border:'none',color:theme.textMuted,cursor:'pointer',fontSize:14,flexShrink:0}}
                                            onClick={()=>setTalhaoEditId(null)}>✕</button>
                                        </div>
                                      ) : (
                                        <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:theme.card,border:`1px solid ${theme.divider}`,borderRadius:8,padding:'7px 10px',marginBottom:5,fontSize:13}}>
                                          <span>📐 {t.nome} {t.area_ha?<strong style={{color:'#059669'}}>· {t.area_ha} ha</strong>:''}</span>
                                          <div style={{display:'flex',gap:4,flexShrink:0}}>
                                            <button style={{background:'none',border:'none',color:theme.textMuted,cursor:'pointer',fontSize:13}}
                                              onClick={()=>{setTalhaoEditId(t.id);setTalhaoEditForm({nome:t.nome||'',area_ha:t.area_ha??''})}}>✏️</button>
                                            <button style={{background:'none',border:'none',color:theme.dangerText,cursor:'pointer',fontSize:14}}
                                              onClick={async()=>{if(!window.confirm(`Excluir o talhão "${t.nome}"?`))return;await supabase.from('talhoes').delete().eq('id',t.id);fetchInventario()}}>×</button>
                                          </div>
                                        </div>
                                      ))}
                                      <div style={{display:'flex',gap:6,marginTop:8}}>
                                        <input style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:7,padding:'6px 8px',fontSize:12,outline:'none',flex:2}}
                                          placeholder="Novo talhão..." value={tf.nome}
                                          onChange={e=>setTlForm(s=>({...s,[fz.id]:{...tf,nome:e.target.value}}))}/>
                                        <input style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:7,padding:'6px 8px',fontSize:12,outline:'none',flex:1}}
                                          placeholder="Área (ha)" type="number" value={tf.area_ha}
                                          onChange={e=>setTlForm(s=>({...s,[fz.id]:{...tf,area_ha:e.target.value}}))}/>
                                        <button style={{background:theme.successBg,color:'#059669',border:'none',borderRadius:15,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}
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
                        <div style={{background:theme.card,borderRadius:20,width:'100%',maxWidth:380,padding:22,maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
                          <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>{fzEditId?'🌾 Editar Fazenda':'🌾 Nova Fazenda'}</div>
                          <div style={{display:'flex',flexDirection:'column',gap:12}}>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>CLIENTE</div>
                              <select style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                value={fzForm.cliente} onChange={e=>setFzForm(f=>({...f,cliente:e.target.value}))}>
                                <option value="">Selecione...</option>
                                {invClientes.filter(c=>c.ativo).map(c=><option key={c.id}>{c.nome}</option>)}
                              </select>
                            </div>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>NOME DA FAZENDA</div>
                              <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                placeholder="Ex: Fazenda Jamaica" value={fzForm.nome} onChange={e=>setFzForm(f=>({...f,nome:e.target.value}))}/>
                            </div>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>ID DA FAZENDA (OPCIONAL)</div>
                              <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                placeholder="Preenchimento manual" value={fzForm.id_fazenda} onChange={e=>setFzForm(f=>({...f,id_fazenda:e.target.value}))}/>
                            </div>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>PRODUTO (OPCIONAL)</div>
                              <select style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                value={fzForm.produto} onChange={e=>setFzForm(f=>({...f,produto:e.target.value}))}>
                                <option value="">Selecione...</option>
                                {PRODUTO_FAZENDA_OPTS.map(p=><option key={p}>{p}</option>)}
                              </select>
                            </div>
                            <div style={{borderTop:`1px solid ${theme.divider}`,paddingTop:12}}>
                              <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>CEP (OPCIONAL)</div>
                              <div style={{display:'flex',gap:6}}>
                                <input style={{flex:1,border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                  placeholder="00000-000" value={fzForm.cep} onChange={e=>setFzForm(f=>({...f,cep:e.target.value}))}/>
                                <button style={{background:theme.successBg,color:'#059669',border:'none',borderRadius:8,padding:'0 12px',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}
                                  disabled={fzGeoLoading} onClick={buscarCoordenadasPorCep}>{fzGeoLoading?'...':'🔍 Buscar coord.'}</button>
                              </div>
                              <div style={{fontSize:10,color:'#aaa',marginTop:4}}>Usado pra puxar a previsão do tempo da fazenda na Agenda</div>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                              <div style={{flex:1}}>
                                <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>LATITUDE</div>
                                <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                  type="number" placeholder="Ex: -22.9068" value={fzForm.lat} onChange={e=>setFzForm(f=>({...f,lat:e.target.value}))}/>
                              </div>
                              <div style={{flex:1}}>
                                <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>LONGITUDE</div>
                                <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                  type="number" placeholder="Ex: -43.1729" value={fzForm.lng} onChange={e=>setFzForm(f=>({...f,lng:e.target.value}))}/>
                              </div>
                            </div>

                            <div style={{borderTop:`1px solid ${theme.divider}`,paddingTop:12}}>
                              <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>🗺️ MAPA DA FAZENDA (OPCIONAL)</div>
                              <div style={{fontSize:11,color:theme.textFaint2,marginBottom:8}}>PDF do mapa que a fazenda manda — o piloto vê a posição dele em cima desse mapa durante o voo.</div>
                              <label style={{display:'flex',alignItems:'center',gap:8,border:`1px dashed ${theme.cardBorder2}`,borderRadius:8,padding:'10px 12px',fontSize:12,color:theme.textMuted,cursor:'pointer'}}>
                                📄 {fzMapaFile ? fzMapaFile.name : fzMapaExistente ? 'Mapa já cadastrado — escolher outro arquivo' : 'Escolher arquivo PDF...'}
                                <input type="file" accept="application/pdf" style={{display:'none'}} onChange={e=>setFzMapaFile(e.target.files[0]||null)}/>
                              </label>
                              {(fzMapaFile || fzMapaExistente) && (
                                <>
                                  <div style={{fontSize:10,color:'#aaa',margin:'10px 0 6px'}}>Coordenadas dos 4 cantos do mapa (vem no PDF se for georreferenciado, ou peça pra quem gerou o mapa):</div>
                                  <div style={{display:'flex',gap:6,marginBottom:6}}>
                                    <input style={{flex:1,border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 9px',fontSize:12,outline:'none',boxSizing:'border-box'}}
                                      type="number" placeholder="Lat mínima (sul)" value={fzForm.mapa_lat_min} onChange={e=>setFzForm(f=>({...f,mapa_lat_min:e.target.value}))}/>
                                    <input style={{flex:1,border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 9px',fontSize:12,outline:'none',boxSizing:'border-box'}}
                                      type="number" placeholder="Lat máxima (norte)" value={fzForm.mapa_lat_max} onChange={e=>setFzForm(f=>({...f,mapa_lat_max:e.target.value}))}/>
                                  </div>
                                  <div style={{display:'flex',gap:6}}>
                                    <input style={{flex:1,border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 9px',fontSize:12,outline:'none',boxSizing:'border-box'}}
                                      type="number" placeholder="Long mínima (oeste)" value={fzForm.mapa_lng_min} onChange={e=>setFzForm(f=>({...f,mapa_lng_min:e.target.value}))}/>
                                    <input style={{flex:1,border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'7px 9px',fontSize:12,outline:'none',boxSizing:'border-box'}}
                                      type="number" placeholder="Long máxima (leste)" value={fzForm.mapa_lng_max} onChange={e=>setFzForm(f=>({...f,mapa_lng_max:e.target.value}))}/>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <div style={{display:'flex',gap:8,marginTop:20}}>
                            <button style={{flex:1,background:theme.bg,color:theme.textMuted,border:'none',borderRadius:100,padding:12,fontSize:13,cursor:'pointer'}} onClick={()=>setFzModal(false)}>Cancelar</button>
                            <button style={{flex:2,background:'#059669',color:'#fff',border:'none',borderRadius:100,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}} disabled={invSaving} onClick={salvarNovaFazenda}>{fzMapaUploading?'Enviando mapa...':invSaving?'Salvando...':'💾 Salvar'}</button>
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
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:40,textAlign:'center',color:theme.textMuted}}>
                        Nenhum cliente cadastrado ainda.<br/>Clique em "+ Novo Cliente" para começar.
                      </div>
                    ) : (
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(260px,1fr))',gap:12}}>
                        {invClientes.map(c=>(
                          <div key={c.id} style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:16,position:'relative'}}>
                            {!c.ativo && <span style={{position:'absolute',top:12,right:12,background:'#fee',color:theme.dangerText,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>INATIVO</span>}
                            <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:theme.text,marginBottom:4}}>🏢 {c.nome}</div>
                            {c.obs && <div style={{fontSize:11,color:theme.textMuted,marginBottom:8,fontStyle:'italic'}}>{c.obs}</div>}
                            <div style={{display:'flex',gap:6,marginTop:8}}>
                              <button style={{flex:1,background:theme.bg,color:'#059669',border:'none',borderRadius:16,padding:'6px',fontSize:12,cursor:'pointer',fontWeight:600}}
                                onClick={()=>{setClienteForm(initClienteForm(c));setClienteModal(c)}}>✏️ Editar</button>
                              <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:16,padding:'6px 10px',fontSize:12,cursor:'pointer'}}
                                onClick={()=>deletarCliente(c.id)}>🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── EQUIPES (times + atribuição de fazendas por time/piloto) ── */}
                {fzTab==='equipes' && (
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:theme.text,marginBottom:10}}>🧑‍🤝‍🧑 Times</div>
                    <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:16,marginBottom:16,display:'flex',gap:8,maxWidth:420}}>
                      <input style={{...sG.input,flex:1}} placeholder="Nome do novo time (ex: Time Norte)" value={novoTimeNome} onChange={e=>setNovoTimeNome(e.target.value)}/>
                      <button style={{...sG.btn,width:'auto',padding:'0 18px'}} onClick={criarTime}>+ Criar</button>
                    </div>
                    {times.length===0 ? (
                      <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:30,textAlign:'center',color:theme.textMuted,fontSize:13,marginBottom:24}}>Nenhum time cadastrado ainda.</div>
                    ) : (
                      <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:24}}>
                        {times.map(t=>{
                          const membros = pilotos.filter(p=>p.time_id===t.id)
                          const fazendasDoTime = fazendaTimes.filter(ft=>ft.time_id===t.id).map(ft=>ft.fazenda_id)
                          return (
                            <div key={t.id} style={{background:theme.card,borderRadius:16,border:`1px solid ${theme.cardBorder2}`,padding:16}}>
                              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                                <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700}}>🧑‍🤝‍🧑 {t.nome}</div>
                                <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:16,padding:'4px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>excluirTime(t)}>🗑️ Excluir</button>
                              </div>
                              <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:6}}>PILOTOS ({membros.length})</div>
                              <div style={{fontSize:12,color:theme.textMuted,marginBottom:12}}>{membros.length?membros.map(m=>m.nome).join(', '):'Nenhum piloto nesse time ainda — atribua na lista abaixo.'}</div>
                              <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:6}}>FAZENDAS QUE ESSE TIME PODE OPERAR</div>
                              <ChecklistFazendasPorCliente chavePrefixo={t.id} marcadas={fazendasDoTime} onToggle={fzId=>toggleFazendaTime(fzId,t.id)} excluirTimeId={t.id}/>
                              <div style={{fontSize:10,color:'#aaa',marginTop:8}}>Sem nenhuma fazenda marcada = time sem restrição (agendamento e app do piloto mostram tudo, a menos que o piloto tenha permissão individual — ver abaixo).</div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10,marginBottom:4}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:theme.text}}>📍 Atribuição por piloto</div>
                      <button type="button" onClick={()=>setKanbanAberto(true)}
                        style={{background:theme.card,color:'#059669',border:'1px solid #059669',borderRadius:16,padding:'6px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                        🗂️ Atribuir por Kanban
                      </button>
                    </div>
                    <p style={{fontSize:12,color:theme.textMuted,marginBottom:12,lineHeight:1.5}}>Time de cada piloto e permissão individual de fazendas (tem prioridade sobre o time — ver aviso acima). Conta, senha e status ficam em Configurações → Usuários.</p>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,overflow:'hidden'}}>
                        <thead><tr style={{background:theme.bg}}>{['Piloto','Time','Fazendas individuais'].map(h=><th key={h} style={{padding:'12px 16px',textAlign:'left',fontSize:11,fontWeight:700,color:theme.textMuted,borderBottom:`1px solid ${theme.cardBorder2}`,fontFamily:"'Syne',sans-serif"}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {pilotos.map((p,i)=>(
                            <tr key={p.id} style={{background:i%2===0?theme.card:'#f7fbf8',opacity:p.ativo?1:.5}}>
                              <td style={{...sG.td,padding:'12px 16px',fontWeight:600,color:theme.text}}>{p.nome}</td>
                              <td style={{...sG.td,padding:'12px 16px'}}>
                                <select value={p.time_id||''} onChange={e=>setUserTime(p,e.target.value||null)}
                                  style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:20,padding:'4px 11px',fontSize:11,fontWeight:600,cursor:'pointer',appearance:'none',WebkitAppearance:'none'}}>
                                  <option value="">— Sem time —</option>
                                  {times.map(t=><option key={t.id} value={t.id}>{t.nome}</option>)}
                                </select>
                              </td>
                              <td style={{...sG.td,padding:'12px 16px'}}>
                                {(()=>{ const n = pilotoFazendas.filter(pf=>pf.piloto_id===p.id).length
                                  return (
                                    <button title="Fazendas individuais" style={{background:n>0?theme.successBg:theme.bg,color:n>0?'#059669':theme.textMuted,border:'none',borderRadius:12,padding:'5px 10px',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}
                                      onClick={()=>{setPilotoFazendasModal(p); setPilotoFazendasAba('individual')}}>📍{n>0?` ${n} liberada(s)`:' Nenhuma (segue o time)'}</button>
                                  )
                                })()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* MODAL CLIENTE */}
                {clienteModal && (
                  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div style={{background:theme.card,borderRadius:16,width:'100%',maxWidth:400,padding:24}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:16}}>
                        {clienteModal==='novo'?'🏢 Novo Cliente':'✏️ Editar Cliente'}
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:12}}>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>NOME DO CLIENTE</div>
                          <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            placeholder="Ex: Raizen - Bonfim" value={clienteForm.nome||''}
                            onChange={e=>setClienteForm(f=>({...f,nome:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>OBSERVAÇÕES</div>
                          <textarea style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',resize:'none',height:60,boxSizing:'border-box'}}
                            value={clienteForm.obs||''} onChange={e=>setClienteForm(f=>({...f,obs:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:6}}>PREÇO POR TIPO DE SERVIÇO (R$/ha)</div>
                          <div style={{display:'flex',gap:8}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:10,color:theme.textFaint2,marginBottom:3}}>Catação</div>
                              <input type="number" style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                placeholder="0,00" value={clienteForm.preco_catacao} onChange={e=>setClienteForm(f=>({...f,preco_catacao:e.target.value}))} />
                            </div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:10,color:theme.textFaint2,marginBottom:3}}>Área Total</div>
                              <input type="number" style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                                placeholder="0,00" value={clienteForm.preco_area_total} onChange={e=>setClienteForm(f=>({...f,preco_area_total:e.target.value}))} />
                            </div>
                          </div>
                          <div style={{fontSize:11,color:theme.textFaint2,marginTop:4}}>Usado pra calcular a receita quando o piloto marca o tipo de serviço no voo.</div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setClienteForm(f=>({...f,ativo:!f.ativo}))}>
                          <div style={{width:36,height:20,borderRadius:10,background:clienteForm.ativo?'#059669':theme.cardBorder2,position:'relative',transition:'all .2s',flexShrink:0}}>
                            <div style={{width:14,height:14,borderRadius:7,background:theme.card,position:'absolute',top:3,left:clienteForm.ativo?19:3,transition:'all .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:theme.text}}>Cliente ativo</span>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:20}}>
                        <button style={{flex:1,background:theme.bg,color:theme.textMuted,border:'none',borderRadius:18,padding:12,fontSize:13,cursor:'pointer'}}
                          onClick={()=>setClienteModal(null)}>Cancelar</button>
                        <button style={{flex:2,background:'#059669',color:'#fff',border:'none',borderRadius:18,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}}
                          disabled={invSaving} onClick={salvarCliente}>{invSaving?'Salvando...':'💾 Salvar'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {kanbanAberto && <AtribuirAreasKanbanModal onClose={()=>setKanbanAberto(false)}/>}

          {importarFazendasAberto && (
            <ImportarFazendasModal
              supabase={supabase}
              invClientes={invClientes}
              invFazendas={invFazendas}
              invTalhoes={invTalhoes}
              theme={theme}
              onClose={()=>setImportarFazendasAberto(false)}
              onImported={fetchInventario}
            />
          )}

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
              <div style={{background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder2}`,padding:'12px 16px'}}>
                <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>{label}</div>
                <div style={{fontSize:20,fontWeight:700,color:cor||theme.text,fontFamily:"'Syne',sans-serif"}}>{valor}</div>
              </div>
            )

            return (
              <div>
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>⚠️ Incidentes</div>
                  <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>Chamados abertos pelos pilotos — acompanhe, dê andamento e feche</div>
                </div>

                {incidentes.length>0 && (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:10,marginBottom:16}}>
                      {KpiCard('ABERTOS', abertos.length, theme.warningText2)}
                      {KpiCard('EM TRATATIVA', emTratativa.length, '#2952a3')}
                      {KpiCard('FECHADOS', fechados.length, '#059669')}
                      {KpiCard('CUSTO TOTAL', `R$ ${custoTotal.toFixed(2)}`, '#c0392b')}
                    </div>
                    {(Object.keys(porTipo).length>0 || rankingPiloto.length>0) && (
                      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:18}}>
                        <div style={{flex:1,minWidth:200,background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:8}}>POR TIPO</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {Object.entries(porTipo).map(([t,n])=>(
                              <span key={t} style={{fontSize:11,fontWeight:600,background:theme.bg,color:theme.textMuted,padding:'4px 10px',borderRadius:20}}>{INCIDENTE_TIPO_LABEL[t]||t}: {n}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{flex:1,minWidth:200,background:theme.card,borderRadius:14,border:`1px solid ${theme.cardBorder2}`,padding:14}}>
                          <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:8}}>POR PILOTO</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {rankingPiloto.map(([n,c])=>(
                              <span key={n} style={{fontSize:11,fontWeight:600,background:theme.bg,color:theme.textMuted,padding:'4px 10px',borderRadius:20}}>{n}: {c}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {incidentes.length===0 ? (
                  <div style={{background:theme.card,borderRadius:12,border:`1px solid ${theme.cardBorder2}`,padding:40,textAlign:'center',color:theme.textMuted}}>Nenhum incidente registrado.</div>
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
                        <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,margin:'16px 0 8px'}}>FECHADOS</div>
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
            const CORES_CAT = ['#059669',theme.warningText,'#2f6fed','#8e44ad',theme.dangerText]

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
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>💰 Financeiro</div>
                  <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>{custos.length} notas registradas</div>
                </div>

                {/* Sub-abas */}
                <div style={{display:'flex',background:theme.divider,borderRadius:16,padding:4,gap:4,marginBottom:16,maxWidth:360}}>
                  <button style={{flex:1,background:custosSubTab==='notas'?'#fff':'transparent',color:custosSubTab==='notas'?theme.text:theme.textMuted,border:'none',borderRadius:12,padding:'9px 8px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:custosSubTab==='notas'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
                    onClick={()=>setCustosSubTab('notas')}>🧾 Notas de Despesa</button>
                  <button style={{flex:1,background:custosSubTab==='veiculos'?'#fff':'transparent',color:custosSubTab==='veiculos'?theme.text:theme.textMuted,border:'none',borderRadius:12,padding:'9px 8px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:custosSubTab==='veiculos'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
                    onClick={()=>setCustosSubTab('veiculos')}>🚗 Veículos</button>
                  <button style={{flex:1,background:custosSubTab==='orcamento'?'#fff':'transparent',color:custosSubTab==='orcamento'?theme.text:theme.textMuted,border:'none',borderRadius:12,padding:'9px 8px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:custosSubTab==='orcamento'?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
                    onClick={()=>setCustosSubTab('orcamento')}>🧮 Orçamento</button>
                </div>

                {custosSubTab==='orcamento' && (
                  <RegrasOrcamento config={calcConfig} onSalvar={salvarCalcConfig} saving={calcConfigSaving} isMobile={isMobile}
                    calc={calc} setCalc={setCalc}/>
                )}

                {custosSubTab==='notas' && (<>
                {/* Filtros */}
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16,background:theme.card,padding:12,borderRadius:16,border:`1px solid ${theme.cardBorder}`,alignItems:'center'}}>
                  <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 160px'}}
                    value={custosFiltros.piloto} onChange={e=>setCustosFiltros(f=>({...f,piloto:e.target.value}))}>
                    <option value="">Todos os pilotos</option>
                    {pilotosDisponiveis.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                  <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none',flex:'0 0 160px'}}
                    value={custosFiltros.categoria} onChange={e=>setCustosFiltros(f=>({...f,categoria:e.target.value}))}>
                    <option value="">Todas categorias</option>
                    {CATEGORIA_DESPESA_OPTS.map(([c])=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 200px'}}
                    value={custosFiltros.clienteFazenda} onChange={e=>setCustosFiltros(f=>({...f,clienteFazenda:e.target.value}))}>
                    <option value="">Todos clientes/fazendas</option>
                    {clienteFazendaOpcoes.map(cf=><option key={cf} value={cf}>{cf}</option>)}
                  </select>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <span style={{fontSize:11,color:theme.textMuted}}>De:</span>
                    <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={custosFiltros.dataIni} onChange={e=>setCustosFiltros(f=>({...f,dataIni:e.target.value}))}/>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <span style={{fontSize:11,color:theme.textMuted}}>Até:</span>
                    <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={custosFiltros.dataFim} onChange={e=>setCustosFiltros(f=>({...f,dataFim:e.target.value}))}/>
                  </div>
                  {filtrosAtivos && (
                    <button style={{background:'none',border:'1px solid #f0b0a8',color:theme.dangerText,borderRadius:12,padding:'7px 12px',fontSize:12,cursor:'pointer'}}
                      onClick={()=>setCustosFiltros({piloto:'',categoria:'',clienteFazenda:'',dataIni:'',dataFim:''})}>✕ Limpar</button>
                  )}
                </div>

                {/* KPIs */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)',gap:12,marginBottom:16}}>
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>TOTAL (FILTRADO)</div>
                    <div style={{fontSize:22,fontWeight:700,color:'#059669',fontFamily:"'Syne',sans-serif"}}>R$ {totalGeral.toFixed(2)}</div>
                  </div>
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>NOTAS NO PERÍODO</div>
                    <div style={{fontSize:22,fontWeight:700,color:theme.text,fontFamily:"'Syne',sans-serif"}}>{custosFiltrados.length}</div>
                  </div>
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>MAIOR CATEGORIA</div>
                    <div style={{fontSize:16,fontWeight:700,color:theme.text,fontFamily:"'Syne',sans-serif"}}>{maiorCategoria?`${CATEGORIA_ICON[maiorCategoria[0]]||''} ${maiorCategoria[0]}`:'—'}</div>
                    {maiorCategoria&&<div style={{fontSize:11,color:theme.textFaint2,marginTop:2}}>R$ {maiorCategoria[1].toFixed(2)}</div>}
                  </div>
                </div>

                {/* Ranking por piloto */}
                {rankingPiloto.length>0 && (
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:'18px',marginBottom:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <SecTitle>Total por Piloto</SecTitle>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <thead><tr style={{background:theme.bg}}>{['Piloto','Notas','Total'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif"}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {rankingPiloto.map(([nome,st],i)=>(
                            <tr key={nome} style={{background:i%2===0?'#fff':'#f9fbfa'}}>
                              <td style={{padding:'8px 10px',fontWeight:500}}>{nome}</td>
                              <td style={{padding:'8px 10px',color:theme.textMuted}}>{st.qtd}</td>
                              <td style={{padding:'8px 10px',fontWeight:700,color:'#059669'}}>R$ {st.total.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Ranking por Cliente/Fazenda */}
                {rankingClienteFazenda.length>0 && (
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:'18px',marginBottom:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <SecTitle>Total por Cliente / Fazenda</SecTitle>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <thead><tr style={{background:theme.bg}}>{['Cliente / Fazenda','Notas','Total'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif"}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {rankingClienteFazenda.map(([nome,st],i)=>(
                            <tr key={nome} style={{background:custosFiltros.clienteFazenda===nome?theme.successBg:i%2===0?'#fff':'#f9fbfa',cursor:'pointer'}}
                              onClick={()=>setCustosFiltros(f=>({...f,clienteFazenda:f.clienteFazenda===nome?'':nome}))}>
                              <td style={{padding:'8px 10px',fontWeight:500,color:nome==='Sem voo vinculado'?'#aaa':theme.text,fontStyle:nome==='Sem voo vinculado'?'italic':'normal'}}>{nome}</td>
                              <td style={{padding:'8px 10px',color:theme.textMuted}}>{st.qtd}</td>
                              <td style={{padding:'8px 10px',fontWeight:700,color:'#059669'}}>R$ {st.total.toFixed(2)}</td>
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
                    <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
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
                    <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <SecTitle>Evolução no Período</SecTitle>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={evolucaoDiaria} margin={{top:5,right:10,left:-20,bottom:5}}>
                          <defs>
                            <linearGradient id="gradCustos" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={theme.warningText} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={theme.warningText} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={theme.divider}/>
                          <XAxis dataKey="dia" tick={{fontSize:10,fill:theme.textFaint2}}/>
                          <YAxis tick={{fontSize:10,fill:theme.textFaint2}}/>
                          <Tooltip formatter={v=>[`R$ ${v.toFixed(2)}`,'Gasto']}/>
                          <Area type="monotone" dataKey="valor" stroke={theme.warningText} strokeWidth={2} fill="url(#gradCustos)"/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Lista de notas */}
                {custosFiltrados.length===0 ? (
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:40,textAlign:'center',color:theme.textMuted}}>Nenhuma nota encontrada.</div>
                ) : (
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,overflow:'hidden',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <thead>
                          <tr style={{background:theme.bg}}>
                            {['Categoria','Piloto','Valor','Data','Voo Vinculado','Foto','Ações'].map(h=>(
                              <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:theme.textMuted,letterSpacing:.5,borderBottom:`1px solid ${theme.cardBorder2}`,whiteSpace:'nowrap',fontFamily:"'Syne',sans-serif"}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {custosFiltrados.map((c,i)=>{
                            const rel = relDaNota(c)
                            return (
                              <tr key={c.id} style={{background:i%2===0?'#fff':'#f7fbf8'}}>
                                <td style={{padding:'11px 14px',borderBottom:`1px solid ${theme.divider}`}}>
                                  <div style={{fontWeight:600}}>{CATEGORIA_ICON[c.categoria]||'🧾'} {c.categoria}</div>
                                  {c.observacao && <div style={{fontSize:11,color:theme.textFaint2,fontStyle:'italic',marginTop:2}}>{c.observacao}</div>}
                                </td>
                                <td style={{padding:'11px 14px',borderBottom:`1px solid ${theme.divider}`}}>{c.piloto_nome||'—'}</td>
                                <td style={{padding:'11px 14px',borderBottom:`1px solid ${theme.divider}`,fontWeight:700,color:'#059669'}}>R$ {parseFloat(c.valor).toFixed(2)}</td>
                                <td style={{padding:'11px 14px',borderBottom:`1px solid ${theme.divider}`,whiteSpace:'nowrap'}}>{new Date(c.data).toLocaleDateString('pt-BR')}</td>
                                <td style={{padding:'11px 14px',borderBottom:`1px solid ${theme.divider}`}}>
                                  {c.ordem_servico ? (
                                    <span style={{fontSize:11,fontWeight:600,color: rel?'#059669':theme.warningText}}>
                                      {rel?`✅ ${rel.cliente} — ${rel.fazenda}`:`⚠️ OS ${c.ordem_servico} sem voo`}
                                    </span>
                                  ) : <span style={{color:'#c3d4c9'}}>—</span>}
                                </td>
                                <td style={{padding:'11px 14px',borderBottom:`1px solid ${theme.divider}`}}>
                                  {c.foto_url ? (
                                    <FotoThumb supabase={supabase} path={c.foto_url} bucket="relatorios" onClick={()=>setFotoLightbox(c.foto_url)}/>
                                  ) : <div style={{width:40,height:40,borderRadius:8,background:'#f7fbf8',border:`1px dashed ${theme.cardBorder}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#c3d4c9'}}>—</div>}
                                </td>
                                <td style={{padding:'11px 14px',borderBottom:`1px solid ${theme.divider}`,whiteSpace:'nowrap'}}>
                                  {rel && <button title="Ir para o voo" style={sG.iconBtn} onClick={()=>{setSelected(rel);setTab('relatorios')}}>➡️</button>}
                                  <button title="Deletar" style={{...sG.iconBtn,color:theme.dangerText}} onClick={()=>setConfirmDeleteDespesa(c)}>🗑️</button>
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
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16,background:theme.card,padding:12,borderRadius:16,border:`1px solid ${theme.cardBorder}`,alignItems:'center'}}>
                        <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none',flex:'1 1 160px'}}
                          value={veicFiltros.veiculo} onChange={e=>setVeicFiltros(f=>({...f,veiculo:e.target.value}))}>
                          <option value="">Todos os veículos</option>
                          {veiculos.map(v=><option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>)}
                        </select>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontSize:11,color:theme.textMuted}}>De:</span>
                          <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={veicFiltros.dataIni} onChange={e=>setVeicFiltros(f=>({...f,dataIni:e.target.value}))}/>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontSize:11,color:theme.textMuted}}>Até:</span>
                          <input type="date" style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={veicFiltros.dataFim} onChange={e=>setVeicFiltros(f=>({...f,dataFim:e.target.value}))}/>
                        </div>
                        {filtrosVeicAtivos && (
                          <button style={{background:'none',border:'1px solid #f0b0a8',color:theme.dangerText,borderRadius:12,padding:'7px 12px',fontSize:12,cursor:'pointer'}}
                            onClick={()=>setVeicFiltros({veiculo:'',dataIni:'',dataFim:''})}>✕ Limpar</button>
                        )}
                      </div>

                      {/* KPIs */}
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:16}}>
                        <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>GASTO TOTAL (FROTA)</div>
                          <div style={{fontSize:22,fontWeight:700,color:'#059669',fontFamily:"'Syne',sans-serif"}}>R$ {totalGastoFrota.toFixed(2)}</div>
                        </div>
                        <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>MANUTENÇÃO</div>
                          <div style={{fontSize:22,fontWeight:700,color:theme.warningText,fontFamily:"'Syne',sans-serif"}}>R$ {totalManut.toFixed(2)}</div>
                        </div>
                        <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>KM RODADOS</div>
                          <div style={{fontSize:22,fontWeight:700,color:theme.text,fontFamily:"'Syne',sans-serif"}}>{totalKm.toLocaleString('pt-BR')}</div>
                        </div>
                        <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>CUSTO / KM</div>
                          <div style={{fontSize:22,fontWeight:700,color:theme.text,fontFamily:"'Syne',sans-serif"}}>R$ {custoPorKm.toFixed(2)}</div>
                        </div>
                      </div>

                      {/* Ranking por veículo */}
                      {rankingVeiculo.length>0 && (
                        <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:'18px',marginBottom:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          <SecTitle>Total por Veículo</SecTitle>
                          <div style={{overflowX:'auto'}}>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                              <thead><tr style={{background:theme.bg}}>{['Veículo','Km rodados','Manutenção','Despesas','Total'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:theme.textFaint2,fontFamily:"'Syne',sans-serif"}}>{h}</th>)}</tr></thead>
                              <tbody>
                                {rankingVeiculo.map(v=>(
                                  <tr key={v.placa} style={{background:theme.card}}>
                                    <td style={{padding:'8px 10px',fontWeight:500}}>🚗 {v.placa}</td>
                                    <td style={{padding:'8px 10px',color:theme.textMuted}}>{v.km.toLocaleString('pt-BR')} km</td>
                                    <td style={{padding:'8px 10px',color:theme.warningText}}>R$ {v.manut.toFixed(2)}</td>
                                    <td style={{padding:'8px 10px',color:theme.textMuted}}>R$ {v.despesa.toFixed(2)}</td>
                                    <td style={{padding:'8px 10px',fontWeight:700,color:'#059669'}}>R$ {(v.manut+v.despesa).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Linha do tempo */}
                      {timeline.length===0 ? (
                        <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:40,textAlign:'center',color:theme.textMuted}}>Nenhum registro de viagem, manutenção ou despesa de veículo encontrado.</div>
                      ) : (
                        <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:'8px 0',boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                          {timeline.map((ev,i)=>(
                            <div key={ev.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 18px',borderBottom:i<timeline.length-1?'1px solid #f6faf7':'none'}}>
                              <div>
                                <div style={{fontSize:13,fontWeight:600}}>{ev.detalhe}</div>
                                <div style={{fontSize:11,color:theme.textFaint2,marginTop:2}}>🚗 {ev.veiculo} · {new Date(ev.data).toLocaleDateString('pt-BR')}</div>
                              </div>
                              {ev.valor!=null && <div style={{fontWeight:700,fontSize:14,color:ev.tipo==='manutencao'?theme.warningText:'#059669',fontFamily:"'Syne',sans-serif"}}>R$ {ev.valor.toFixed(2)}</div>}
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
                <div style={{fontSize:11,color:theme.textFaint2}}>{r.dt_inicio?new Date(r.dt_inicio).toLocaleDateString('pt-BR'):''}</div>
              </div>
            )

            return (
              <div>
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>🔍 Buscar Ordem de Serviço</div>
                  <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>Digite a OS pra ver o voo, as despesas e as viagens vinculadas a ela</div>
                </div>

                <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,marginBottom:18,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                  <input autoFocus style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'12px 14px',fontSize:15,outline:'none',boxSizing:'border-box',fontFamily:'ui-monospace,monospace'}}
                    placeholder="Ex: wcjvee" value={osSearch} onChange={e=>setOsSearch(e.target.value)} />
                </div>

                {!q ? (
                  <div style={{display:'flex',flexDirection:'column',gap:16}}>
                    <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:12}}>🕒 Últimas OS</div>
                      {ultimasOS.length===0 ? <div style={{fontSize:13,color:theme.textFaint2}}>Nenhum voo com OS ainda.</div> : (
                        <div style={{display:'flex',flexDirection:'column',gap:6}}>{ultimasOS.map(LinhaOS)}</div>
                      )}
                    </div>
                    <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:10}}>🔎 Buscar por Cliente/Fazenda</div>
                      <input style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'10px 12px',fontSize:13,outline:'none',boxSizing:'border-box',marginBottom:qCliente?12:0}}
                        placeholder="Ex: Fazenda Santa Rita" value={osSearchCliente} onChange={e=>setOsSearchCliente(e.target.value)} />
                      {qCliente && (
                        resultadosClienteFazenda.length===0
                          ? <div style={{fontSize:13,color:theme.textFaint2}}>Nada encontrado.</div>
                          : <div style={{display:'flex',flexDirection:'column',gap:6}}>{resultadosClienteFazenda.map(LinhaOS)}</div>
                      )}
                    </div>
                  </div>
                ) : !relEncontrado && despesasOS.length===0 && viagensOS.length===0 ? (
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:40,textAlign:'center',color:theme.textMuted}}>Nenhum voo, despesa ou viagem encontrado com a OS "{osSearch}".</div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:16}}>
                    {!relEncontrado && (
                      <div style={{background:theme.warningBg,color:'#7a5200',borderRadius:14,padding:'12px 16px',fontSize:13}}>
                        ⚠️ Não encontrei nenhum voo com essa OS, mas existem notas/viagens vinculadas a ela (abaixo). Confira se digitou certo.
                      </div>
                    )}

                    {relEncontrado && (
                      <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
                          <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>{relEncontrado.cliente} — {relEncontrado.fazenda}</div>
                          <span style={{background:statusBg(theme)[relEncontrado.status]||theme.bg,color:statusColor(theme)[relEncontrado.status]||theme.textMuted,fontSize:11,fontWeight:600,padding:'3px 9px',borderRadius:20}}>{STATUS_LABEL[relEncontrado.status]||relEncontrado.status}</span>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:14}}>
                          <div><div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>PILOTO</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.piloto_nome||'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>DRONE</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.drone||'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>ÁREA</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.area_ha?`${relEncontrado.area_ha} ha`:'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>TEMPO</div><div style={{fontSize:13,fontWeight:600}}>{tempo?.total||'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>DATA</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.dt_inicio?new Date(relEncontrado.dt_inicio).toLocaleDateString('pt-BR'):'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>TIPO SERVIÇO</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.tipo_servico==='catacao'?'Catação':relEncontrado.tipo_servico==='area_total'?'Área Total':'—'}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>QTDE VOOS</div><div style={{fontSize:13,fontWeight:600}}>{relEncontrado.qtd_voos||1}</div></div>
                          <div><div style={{fontSize:10,fontWeight:700,color:theme.textFaint2}}>PRODUTOS</div><div style={{fontSize:13,fontWeight:600}}>{(relEncontrado.produtos||[]).join(', ')||'—'}</div></div>
                        </div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          <button style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}} onClick={()=>{setSelected(relEncontrado);setTab('relatorios')}}>Ver relatório completo</button>
                          <button style={{background:'#059669',color:'#fff',border:'none',borderRadius:16,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}} onClick={()=>gerarPDF(relEncontrado,null,null,'cliente')}>🟢 PDF Cliente</button>
                        </div>
                      </div>
                    )}

                    <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700}}>💰 Despesas Vinculadas</div>
                        {despesasOS.length>0 && <div style={{fontSize:15,fontWeight:700,color:'#059669'}}>Total: R$ {totalDespesas.toFixed(2)}</div>}
                      </div>
                      {despesasOS.length===0 ? <div style={{fontSize:13,color:theme.textFaint2}}>Nenhuma despesa vinculada a essa OS.</div> : (
                        <div style={{display:'flex',flexDirection:'column',gap:8}}>
                          {despesasOS.map(c=>(
                            <div key={c.id} style={{background:'#f7fbf8',borderRadius:12,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6}}>
                              <div>
                                <div style={{fontSize:13,fontWeight:600}}>{CAT_ICON[c.categoria]||'🧾'} {c.categoria} — {c.piloto_nome||'—'}</div>
                                <div style={{fontSize:11,color:theme.textFaint2}}>{new Date(c.data).toLocaleDateString('pt-BR')}{c.observacao?` · ${c.observacao}`:''}</div>
                              </div>
                              <div style={{fontSize:14,fontWeight:700,color:'#059669'}}>R$ {parseFloat(c.valor).toFixed(2)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:14}}>🚗 Viagens Vinculadas</div>
                      {viagensOS.length===0 ? <div style={{fontSize:13,color:theme.textFaint2}}>Nenhuma viagem vinculada a essa OS.</div> : (
                        <div style={{display:'flex',flexDirection:'column',gap:8}}>
                          {viagensOS.map(v=>(
                            <div key={v.id} style={{background:'#f7fbf8',borderRadius:12,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6}}>
                              <div>
                                <div style={{fontSize:13,fontWeight:600}}>🚗 {veiculos.find(x=>x.id===v.veiculo_id)?.placa || '—'} — {v.motorista||'—'}</div>
                                <div style={{fontSize:11,color:theme.textFaint2}}>{new Date(v.data).toLocaleDateString('pt-BR')}{v.destino?` · ${v.destino}`:''}</div>
                              </div>
                              <div style={{fontSize:14,fontWeight:700,color:'#2f6fed'}}>{Math.max(0,(v.km_final||0)-(v.km_inicial||0)).toFixed(0)} km</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {incidentesOS.length>0 && (
                      <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:20,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
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
                                <div style={{fontSize:12,color:theme.textMuted,marginBottom:6}}>{inc.descricao}</div>
                                <button style={{background:'none',border:'none',color:'#059669',fontSize:12,fontWeight:600,cursor:'pointer',padding:0}}
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
              pendente:{ label:'Pendente', bg:theme.warningBg, cor:theme.warningText },
              concluido:{ label:'Concluído', bg:theme.successBg, cor:'#059669' },
              cancelado:{ label:'Cancelado', bg:theme.dangerBg, cor:theme.dangerText },
              recusado:{ label:'Recusado pelo piloto', bg:theme.dangerBg, cor:theme.dangerText },
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
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>📅 Agenda</div>
                  <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>{agenda.filter(a=>a.status==='pendente').length} pendentes · {agenda.length} no total</div>
                </div>

                {/* Novo agendamento */}
                <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:16,marginBottom:16,boxShadow:'0 6px 20px rgba(11,18,16,0.05)'}}>
                  <div style={{fontSize:13,fontWeight:700,color:theme.text,marginBottom:12,fontFamily:"'Syne',sans-serif"}}>+ Novo Agendamento</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                    <select style={{...sG.fi,flex:'1 1 160px'}} value={agendaForm.piloto_id} onChange={e=>{
                      const pilotoId = e.target.value
                      // Sugere o drone e o carro que esse piloto costuma usar (último
                      // agendamento dele com cada um definido), pra não precisar procurar de
                      // novo toda vez — só preenche se o admin ainda não escolheu nada.
                      const ultimoComDrone = [...agenda].filter(a=>a.piloto_id===pilotoId && a.drone).sort((a,b)=>new Date(b.data_prevista)-new Date(a.data_prevista))[0]
                      const ultimoComCarro = [...agenda].filter(a=>a.piloto_id===pilotoId && a.veiculo_id).sort((a,b)=>new Date(b.data_prevista)-new Date(a.data_prevista))[0]
                      setAgendaForm(f=>({...f,piloto_id:pilotoId,
                        drone: f.drone || ultimoComDrone?.drone || '',
                        veiculo_id: f.veiculo_id || ultimoComCarro?.veiculo_id || '',
                      }))
                    }}>
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
                      <div style={{fontSize:10,fontWeight:700,color:theme.textMuted,letterSpacing:.5,marginBottom:4}}>TALHÕES (OPCIONAL)</div>
                      <div style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:10,overflow:'hidden',maxHeight:160,overflowY:'auto'}}>
                        {talhoesDaFazendaAgenda.map(t=>{
                          const sel = talhoesSelecionadosAgenda.includes(t.nome)
                          const prog = progressoTalhaoAgenda(t)
                          const finalizado = prog && prog.pct>=100
                          const parcial = prog && prog.pct>0 && prog.pct<100
                          return (
                            <div key={t.id} onClick={()=>toggleTalhaoAgenda(t.nome)}
                              style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',cursor:'pointer',fontSize:12,background:sel?theme.successBg:finalizado?'#eafaf0':parcial?'#fff8e6':'#fff',borderBottom:'1px solid #f0f5f2'}}>
                              <div style={{width:14,height:14,borderRadius:4,border:`2px solid ${sel?'#059669':'#c3d4c9'}`,background:sel?'#059669':'#fff',flexShrink:0}}/>
                              <span style={{flex:1}}>{t.nome}
                                {finalizado&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:'#fff',background:'#059669',padding:'1px 6px',borderRadius:20}}>✓ Concluído</span>}
                                {parcial&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:theme.warningText2,background:'#ffe9b8',padding:'1px 6px',borderRadius:20}}>{prog.pct.toFixed(0)}%</span>}
                              </span>
                              {t.area_ha&&<span style={{color:'#059669',fontWeight:600}}>{t.area_ha} ha</span>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {conflitosAgenda.length>0 && (
                    <div style={{background:theme.warningBg,border:`1px solid ${theme.warningText}`,borderRadius:10,padding:'8px 12px',marginBottom:8,fontSize:12,color:theme.warningText2}}>
                      ⚠️ Já existe agendamento pendente pra essa fazenda/talhão: {conflitosAgenda.map(c=>`${c.piloto_nome} (${new Date(c.data_prevista+'T12:00:00').toLocaleDateString('pt-BR')})`).join(', ')}
                    </div>
                  )}

                  {areaEstimadaAgenda>0 && (
                    <div style={{fontSize:11,color:theme.textFaint2,marginBottom:6}}>📐 Área considerada pra estimativa: {areaEstimadaAgenda.toFixed(1)} ha{talhoesSelecionadosAgenda.length===0&&talhoesDaFazendaAgenda.length>0?' (fazenda inteira — nenhum talhão marcado)':''}</div>
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
                            <button type="button" style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:10,width:36,cursor:'pointer'}}
                              onClick={()=>setAgendaForm(f=>({...f,produtos:f.produtos.filter((_,idx)=>idx!==i)}))}>✕</button>
                          )}
                        </div>
                        {est && (
                          <div style={{fontSize:11,color:'#059669',fontWeight:600,marginTop:3}}>≈ leva {est.qtd.toLocaleString('pt-BR',{maximumFractionDigits:2})} {est.unidade}</div>
                        )}
                      </div>
                    )
                  })}
                  <button type="button" style={{background:'none',border:'1px dashed #c3e0d0',color:'#059669',borderRadius:10,padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:8}}
                    onClick={()=>setAgendaForm(f=>({...f,produtos:[...f.produtos,{produto:'',dose:''}]}))}>+ Adicionar produto</button>

                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                    <select style={{...sG.fi,flex:'1 1 160px'}} value={agendaForm.drone} onChange={e=>setAgendaForm(f=>({...f,drone:e.target.value}))}>
                      <option value="">Drone (opcional)...</option>
                      {invDrones.filter(d=>d.ativo!==false).map(d=>{
                        const voando = relatorios.some(r=>r.status==='em_operacao' && r.drone===d.nome)
                        const agendadoOutro = agendaForm.data_prevista && agenda.some(a=>a.status==='pendente' && a.drone===d.nome && a.data_prevista===agendaForm.data_prevista && a.piloto_id!==agendaForm.piloto_id)
                        const tag = voando ? ' — 🔴 voando agora' : agendadoOutro ? ' — ⚠️ já agendado nesse dia' : ''
                        return <option key={d.id} value={d.nome}>{d.nome}{tag}</option>
                      })}
                    </select>
                    <select style={{...sG.fi,flex:'1 1 160px'}} value={agendaForm.veiculo_id} onChange={e=>setAgendaForm(f=>({...f,veiculo_id:e.target.value}))}>
                      <option value="">Carro (opcional)...</option>
                      {veiculos.filter(v=>v.ativo!==false).map(v=>{
                        // Um carro dá conta de 2 drones no mesmo dia (leva a equipe toda) — só
                        // avisa "lotado" a partir do 3º agendamento concorrente.
                        const qtdOutros = agendaForm.data_prevista ? agenda.filter(a=>a.status==='pendente' && a.veiculo_id===v.id && a.data_prevista===agendaForm.data_prevista && a.piloto_id!==agendaForm.piloto_id).length : 0
                        const tag = qtdOutros>=2 ? ' — 🔴 lotado nesse dia (2 já usando)' : qtdOutros===1 ? ' — ⚠️ já tem 1 uso nesse dia' : ''
                        return <option key={v.id} value={v.id}>🚗 {v.placa}{v.modelo?` — ${v.modelo}`:''}{tag}</option>
                      })}
                    </select>
                  </div>

                  {agendaForm.drone && agendaForm.data_prevista && (()=>{
                    const conflito = agenda.find(a=>a.status==='pendente' && a.drone===agendaForm.drone && a.data_prevista===agendaForm.data_prevista && a.piloto_id!==agendaForm.piloto_id)
                    return conflito ? (
                      <div style={{background:theme.warningBg,border:`1px solid ${theme.warningText}`,borderRadius:10,padding:'8px 12px',marginBottom:8,fontSize:12,color:theme.warningText2}}>
                        ⚠️ Esse drone já está agendado pra {conflito.piloto_nome} nesse dia ({conflito.cliente} — {conflito.fazenda}).
                      </div>
                    ) : null
                  })()}

                  {agendaForm.veiculo_id && agendaForm.data_prevista && (()=>{
                    // Carro aguenta 2 drones/pilotos no mesmo dia — só bloqueia visualmente
                    // quando já tem 2 outros agendamentos concorrentes (o 3º não cabe).
                    const conflitos = agenda.filter(a=>a.status==='pendente' && a.veiculo_id===agendaForm.veiculo_id && a.data_prevista===agendaForm.data_prevista && a.piloto_id!==agendaForm.piloto_id)
                    if(conflitos.length===0) return null
                    const lotado = conflitos.length>=2
                    return (
                      <div style={{background:lotado?theme.dangerBg:theme.warningBg,border:`1px solid ${lotado?theme.dangerText:theme.warningText}`,borderRadius:10,padding:'8px 12px',marginBottom:8,fontSize:12,color:lotado?'#a3221e':theme.warningText2}}>
                        {lotado?'🔴 Esse carro já está lotado nesse dia (2 outros agendamentos): ':'⚠️ Esse carro já tem 1 outro agendamento nesse dia (ainda cabe mais 1): '}
                        {conflitos.map(c=>`${c.piloto_nome} (${c.cliente} — ${c.fazenda})`).join(', ')}
                      </div>
                    )
                  })()}

                  {agendaForm.fazenda && agendaForm.data_prevista && (
                    agendaClimaLoading ? (
                      <div style={{fontSize:12,color:theme.textFaint2,marginBottom:12}}>🌦️ Buscando previsão do tempo da fazenda...</div>
                    ) : agendaClima?.foraDoAlcance ? (
                      <div style={{fontSize:12,color:'#aaa',marginBottom:12,fontStyle:'italic'}}>Data fora do alcance da previsão (máx. 16 dias)</div>
                    ) : agendaClima ? (
                      <div style={{background:theme.bg,borderRadius:12,padding:'10px 14px',marginBottom:12,display:'flex',flexDirection:'column',gap:8,fontSize:12,color:theme.text}}>
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
                  <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={agendaFiltros.piloto} onChange={e=>setAgendaFiltros(f=>({...f,piloto:e.target.value}))}>
                    <option value="">Todos os pilotos</option>
                    {pilotosAtivos.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                  <select style={{border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 10px',fontSize:12,outline:'none'}} value={agendaFiltros.status} onChange={e=>setAgendaFiltros(f=>({...f,status:e.target.value}))}>
                    <option value="">Todos os status</option>
                    <option value="pendente">Pendente</option>
                    <option value="concluido">Concluído</option>
                    <option value="cancelado">Cancelado</option>
                    <option value="recusado">Recusado pelo piloto</option>
                  </select>
                  <div style={{flex:1}}/>
                  <button style={{background:theme.bg,color:'#059669',border:`1px solid ${theme.cardBorder2}`,borderRadius:12,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer',opacity:agendaExportLoading?.6:1}}
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
                  <div style={{background:theme.card,borderRadius:20,border:`1px solid ${theme.cardBorder}`,padding:40,textAlign:'center',color:theme.textMuted}}>Nenhum agendamento encontrado.</div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    {agendaFiltrada.map(a=>{
                      const atrasado = a.status==='pendente' && new Date(a.data_prevista)<hoje
                      const badge = STATUS_BADGE[a.status]||STATUS_BADGE.pendente
                      return (
                        <div key={a.id} style={{background:theme.card,borderRadius:18,border:`1px solid ${theme.cardBorder}`,padding:14,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,boxShadow:'0 4px 14px rgba(11,18,16,0.04)'}}>
                          <div>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{fontWeight:700,fontSize:14}}>{a.piloto_nome}</span>
                              <span style={{background:badge.bg,color:badge.cor,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>{badge.label}</span>
                              {atrasado&&<span style={{background:theme.dangerBg,color:theme.dangerText,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ Atrasado</span>}
                              {a.ordem_servico&&<span style={{background:theme.divider,color:theme.textMuted,fontFamily:'ui-monospace,monospace',fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20}}>OS {a.ordem_servico}</span>}
                            </div>
                            <div style={{fontSize:12,color:theme.textMuted,marginTop:3}}>{a.cliente} — {a.fazenda}{a.talhao?` (${a.talhao})`:''}{a.produto?` · ${a.produto}${a.dose?` ${a.dose}`:''}`:''}{a.drone?` · 🚁 ${a.drone}`:''}</div>
                            <div style={{fontSize:11,color:theme.textFaint2,marginTop:2}}>{new Date(a.data_prevista+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'})}</div>
                            {a.observacao&&<div style={{fontSize:11,color:theme.textMuted,marginTop:4,fontStyle:'italic'}}>{a.observacao}</div>}
                            {a.status==='recusado'&&a.motivo_recusa&&<div style={{fontSize:11,color:theme.dangerText,marginTop:4}}>Motivo: {a.motivo_recusa}</div>}
                          </div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {a.status==='pendente'&&(
                              <>
                                <button style={{background:theme.successBg,color:'#059669',border:'none',borderRadius:16,padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer'}} onClick={()=>mudarStatus(a,'concluido')}>✓ Concluído</button>
                                <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:16,padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer'}} onClick={()=>mudarStatus(a,'cancelado')}>Cancelar</button>
                              </>
                            )}
                            <button style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:16,padding:'6px 12px',fontSize:11,cursor:'pointer'}} onClick={()=>excluirAgendamento(a)}>🗑️</button>
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
              <div style={{ marginBottom:18, display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
                <div>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>Gestão de Usuários</div>
                  <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>Conta, senha e status de acesso — atribuição de time e fazendas fica em Fazendas & Clientes → Equipes.</div>
                </div>
                <button type="button" onClick={()=>setNovoUsuarioModalAberto(true)}
                  style={{background:'#059669',color:'#fff',border:'none',borderRadius:12,padding:'11px 18px',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6,boxShadow:'0 4px 14px rgba(14,159,110,0.25)',whiteSpace:'nowrap'}}>
                  + Criar usuário
                </button>
              </div>

              {(()=>{
                const ROLE_ESTILO = {
                  piloto:     { bg:'#dcfce7', cor:'#16a34a', label:'🚁 Piloto' },
                  supervisor: { bg:'#dbeafe', cor:'#2563eb', label:'🧑‍🤝‍🧑 Supervisor' },
                  admin:      { bg:'#fde2e2', cor:'#dc2626', label:'⚙️ Admin' },
                }
                const totalUsuarios = pilotos.length
                const totalPilotosN = pilotos.filter(p=>(p.role||'piloto')==='piloto').length
                const totalSupervisoresN = pilotos.filter(p=>p.role==='supervisor').length
                const totalAdminsN = pilotos.filter(p=>p.role==='admin').length
                const CARDS = [
                  { label:'Total de usuários', valor:totalUsuarios, icone:'👥', bg:'#dcfce7', cor:'#16a34a' },
                  { label:'Pilotos', valor:totalPilotosN, icone:'🚁', bg:'#dbeafe', cor:'#2563eb' },
                  { label:'Supervisores', valor:totalSupervisoresN, icone:'🧑‍🤝‍🧑', bg:'#ffedd5', cor:'#ea580c' },
                  { label:'Admins', valor:totalAdminsN, icone:'⚙️', bg:'#ede9fe', cor:'#7c3aed' },
                ]
                const buscaNorm = usuariosBusca.trim().toLowerCase()
                const totalAtivos = pilotos.filter(p=>p.ativo).length
                const totalInativos = pilotos.filter(p=>!p.ativo).length
                const pilotosFiltrados = pilotos.filter(p => {
                  if (buscaNorm && !`${p.nome} ${p.email}`.toLowerCase().includes(buscaNorm)) return false
                  if (usuariosFiltroPerfil && (p.role||'piloto') !== usuariosFiltroPerfil) return false
                  if (usuariosFiltroStatus === 'ativo' && !p.ativo) return false
                  if (usuariosFiltroStatus === 'inativo' && p.ativo) return false
                  return true
                })
                return (
                <div>
                  {/* Cards de métricas */}
                  <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr 1fr':'repeat(4,1fr)', gap:14, marginBottom:18 }}>
                    {CARDS.map(c => (
                      <div key={c.label} style={{ background:theme.card, borderRadius:16, border:`1px solid ${theme.cardBorder2}`, padding:'16px 18px', display:'flex', alignItems:'center', gap:14 }}>
                        <div style={{ width:44, height:44, borderRadius:12, background:c.bg, color:c.cor, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>{c.icone}</div>
                        <div>
                          <div style={{ fontSize:12, color:theme.textMuted }}>{c.label}</div>
                          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:24, fontWeight:700, color:theme.text }}>{c.valor}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Barra de filtros */}
                  <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
                    <input style={{...sG.input, flex:'2 1 220px', width:'auto'}} placeholder="🔍 Buscar por nome ou e-mail..." value={usuariosBusca} onChange={e=>setUsuariosBusca(e.target.value)}/>
                    <select style={{...sG.input, flex:'1 1 140px', width:'auto'}} value={usuariosFiltroPerfil} onChange={e=>setUsuariosFiltroPerfil(e.target.value)}>
                      <option value="">Perfil (todos)</option>
                      <option value="piloto">🚁 Piloto</option>
                      <option value="supervisor">🧑‍🤝‍🧑 Supervisor</option>
                      <option value="admin">⚙️ Admin</option>
                    </select>
                    <select style={{...sG.input, flex:'1 1 140px', width:'auto'}} value={usuariosFiltroStatus} onChange={e=>setUsuariosFiltroStatus(e.target.value)}>
                      <option value="">Status (todos)</option>
                      <option value="ativo">🟢 Ativo ({totalAtivos})</option>
                      <option value="inativo">⚪ Inativo ({totalInativos})</option>
                    </select>
                  </div>

                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}`, overflow:'hidden' }}>
                      <thead><tr style={{ background:theme.bg }}>{['Usuário','Perfil','Voos','Status','Ações'].map(h => <th key={h} style={{ padding:'12px 16px', textAlign:'left', fontSize:11, fontWeight:700, color:theme.textMuted, borderBottom:`1px solid ${theme.cardBorder2}`, fontFamily:"'Syne',sans-serif" }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {pilotosFiltrados.length===0 ? (
                          <tr><td colSpan={5} style={{ ...sG.td, padding:'28px 16px', textAlign:'center', color:theme.textFaint2 }}>Nenhum usuário encontrado com esse filtro.</td></tr>
                        ) : pilotosFiltrados.map((p, i) => {
                          const re = ROLE_ESTILO[p.role||'piloto']
                          return (
                          <tr key={p.id} style={{ background: i%2===0?theme.card:'#f7fbf8', opacity: p.ativo?1:.5 }}>
                            <td style={{ ...sG.td, padding:'14px 16px' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <div style={{ width:36, height:36, borderRadius:'50%', background:re.bg, color:re.cor, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:13, flexShrink:0 }}>{p.nome?.[0]?.toUpperCase()||'?'}</div>
                                <div>
                                  <div style={{ fontWeight:600, color:theme.text }}>{p.nome}</div>
                                  <div style={{ fontSize:11.5, color:theme.textMuted }}>{p.email}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ ...sG.td, padding:'14px 16px' }}>
                              {p.id === profile?.id ? (
                                <span style={{ background:re.bg, color:re.cor, fontSize:11, fontWeight:700, padding:'4px 11px', borderRadius:20, display:'inline-block' }}>{re.label}</span>
                              ) : (
                                <select value={p.role||'piloto'} onChange={e=>toggleRoleTo(p,e.target.value)}
                                  style={{ background:re.bg, color:re.cor, border:'none', borderRadius:20, padding:'4px 11px', fontSize:11, fontWeight:700, cursor:'pointer', appearance:'none', WebkitAppearance:'none' }}>
                                  <option value="piloto">🚁 Piloto</option>
                                  <option value="supervisor">🧑‍🤝‍🧑 Supervisor</option>
                                  <option value="admin">⚙️ Admin</option>
                                </select>
                              )}
                            </td>
                            <td style={{ ...sG.td, padding:'14px 16px', fontFamily:"'Syne',sans-serif", fontWeight:700, color:'#059669', textAlign:'center' }}>{voosPorPiloto[p.id]||0}</td>
                            <td style={{ ...sG.td, padding:'14px 16px' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                                <span style={{ width:8, height:8, borderRadius:'50%', background: p.ativo?'#22c55e':'#9ca3af', flexShrink:0 }}/>
                                <span style={{ fontSize:12.5, color:theme.text }}>{p.ativo?'Ativo':'Inativo'}</span>
                              </div>
                            </td>
                            <td style={{ ...sG.td, padding:'14px 16px', position:'relative' }}>
                              <button title="Ações" onClick={()=>setUsuarioAcoesAbertoId(id=>id===p.id?null:p.id)}
                                style={{ background:'none', border:'none', fontSize:18, color:theme.textMuted, cursor:'pointer', padding:'2px 8px', borderRadius:8, lineHeight:1 }}>⋯</button>
                              {usuarioAcoesAbertoId===p.id && (
                                <>
                                  <div onClick={()=>setUsuarioAcoesAbertoId(null)} style={{ position:'fixed', inset:0, zIndex:90 }}/>
                                  <div style={{ position:'absolute', top:'100%', right:16, marginTop:2, background:theme.card, border:`1px solid ${theme.cardBorder2}`, borderRadius:12, boxShadow:'0 10px 30px rgba(0,0,0,.18)', zIndex:91, padding:6, minWidth:170 }}>
                                    <button onClick={()=>{toggleAtivo(p); setUsuarioAcoesAbertoId(null)}}
                                      style={{ width:'100%', textAlign:'left', background:'none', border:'none', borderRadius:8, padding:'8px 10px', fontSize:12.5, color: p.ativo?theme.dangerText:'#059669', cursor:'pointer' }}>
                                      {p.ativo?'🔒 Desativar':'✅ Ativar'}
                                    </button>
                                    <button onClick={()=>{resetarSenha(p); setUsuarioAcoesAbertoId(null)}}
                                      style={{ width:'100%', textAlign:'left', background:'none', border:'none', borderRadius:8, padding:'8px 10px', fontSize:12.5, color:'#2952a3', cursor:'pointer' }}>
                                      🔑 Redefinir senha
                                    </button>
                                    {p.id !== profile?.id && (
                                      <button onClick={()=>{deletarUsuario(p); setUsuarioAcoesAbertoId(null)}}
                                        style={{ width:'100%', textAlign:'left', background:'none', border:'none', borderRadius:8, padding:'8px 10px', fontSize:12.5, color:theme.dangerText, cursor:'pointer' }}>
                                        🗑️ Deletar usuário
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  </div>
                </div>
                )
              })()}

              {/* MODAL CRIAR USUÁRIO */}
              {novoUsuarioModalAberto && (
                <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,0.55)',zIndex:1500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setNovoUsuarioModalAberto(false)}>
                  <div style={{background:theme.card,borderRadius:20,width:'100%',maxWidth:380,padding:22}} onClick={e=>e.stopPropagation()}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700 }}>+ Novo usuário</div>
                      <button style={{background:'none',border:'none',fontSize:18,color:theme.textFaint2,cursor:'pointer'}} onClick={()=>setNovoUsuarioModalAberto(false)}>✕</button>
                    </div>
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
                </div>
              )}
            </div>
          )}

          {tab === 'configuracoes' && (
            <div>
              <div style={{ marginBottom:18 }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>⚙️ Configurações do Sistema</div>
                <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>Opções globais que afetam o app inteiro.</div>
              </div>

              {/* Sub-abas */}
              <div style={{display:'flex',background:theme.divider,borderRadius:16,padding:4,gap:4,marginBottom:16,maxWidth:420,flexWrap:'wrap'}}>
                {[
                  {id:'geral',label:'🏢 Geral'},
                  {id:'tema',label:'🎨 Tema'},
                  {id:'clima',label:'🌦️ Clima'},
                  {id:'personalizacao',label:'📄 Personalização de Relatórios'},
                ].map(t=>(
                  <button key={t.id} style={{flex:'1 1 auto',minWidth:110,background:configSubTab===t.id?'#fff':'transparent',color:configSubTab===t.id?theme.text:theme.textMuted,border:'none',borderRadius:12,padding:'9px 8px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:configSubTab===t.id?'0 2px 8px rgba(11,18,16,0.08)':'none'}}
                    onClick={()=>setConfigSubTab(t.id)}>{t.label}</button>
                ))}
              </div>

              {configSubTab==='tema' && (
                <div style={{ background:theme.card, borderRadius:theme.radius||14, border:`1px solid ${theme.cardBorder}`, padding:20, marginBottom:16, maxWidth:640 }}>
                  <SecTitle>🎨 Tema do Painel Admin</SecTitle>
                  <div style={{ fontSize:12.5, color:theme.textMuted, marginBottom:16 }}>
                    Escolha a paleta de cores do painel — não afeta o app do piloto no celular, nem a claro/escuro (que continua um botão separado). Fica salvo neste navegador.
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)', gap:12 }}>
                    {paletteList.map(p=>(
                      <button key={p.id} onClick={()=>setAdminPalette(p.id)}
                        style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, background: adminPalette===p.id?theme.successBg:theme.bg, border: adminPalette===p.id?`2px solid ${p.swatch}`:`1px solid ${theme.cardBorder2}`, borderRadius:theme.radius||10, padding:'16px 10px', cursor:'pointer' }}>
                        <div style={{ width:34, height:34, borderRadius:'50%', background:p.swatch, boxShadow: adminPalette===p.id?`0 0 0 4px ${p.swatch}22`:'none' }}/>
                        <span style={{ fontSize:12.5, fontWeight:600, color:theme.text, textAlign:'center' }}>{p.label}</span>
                        {adminPalette===p.id && <span style={{ fontSize:10, fontWeight:700, color:p.swatch }}>Selecionado</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {configSubTab==='clima' && (<>
              <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, marginBottom:16, maxWidth:520 }}>
                <SecTitle>🌦️ Prioridade dos Provedores de Clima</SecTitle>
                <div style={{ fontSize:12.5, color:theme.textMuted, marginBottom:14 }}>
                  O sistema tenta o 1º da lista; se falhar, cai pro 2º, e assim por diante — sem propagar erro pro app do piloto. Usa as setas pra reordenar.
                </div>
                {weatherProviderCarregando ? (
                  <div style={{ fontSize:12.5, color:theme.textFaint2 }}>Carregando...</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {weatherProviderOrdem.map((id,idx) => {
                      const info = { meteoblue:{ label:'Meteoblue', desc:'Principal (paga, mais precisa)' }, tomorrow:{ label:'Tomorrow.io', desc:'API de Alta Precisão (backup premium)' }, open_meteo:{ label:'Open-Meteo', desc:'Backup gratuito, sem limite' } }[id]
                      return (
                        <div key={id} style={{ display:'flex', alignItems:'center', gap:10, background: idx===0?theme.successBg:theme.bg, border: idx===0?'1px solid #059669':'1px solid transparent', borderRadius:12, padding:'11px 14px' }}>
                          <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, color:theme.textFaint2, fontSize:13, width:16 }}>{idx+1}º</span>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:13, fontWeight:700, color:theme.text }}>{info?.label||id}</div>
                            <div style={{ fontSize:11, color:theme.textFaint2 }}>{info?.desc}</div>
                          </div>
                          <button disabled={weatherProviderSalvando||idx===0} onClick={()=>moverProvedor(idx,-1)} style={{ background:'none', border:'none', fontSize:16, cursor: idx===0?'default':'pointer', opacity: idx===0?.3:1, color:theme.textMuted }}>▲</button>
                          <button disabled={weatherProviderSalvando||idx===weatherProviderOrdem.length-1} onClick={()=>moverProvedor(idx,1)} style={{ background:'none', border:'none', fontSize:16, cursor: idx===weatherProviderOrdem.length-1?'default':'pointer', opacity: idx===weatherProviderOrdem.length-1?.3:1, color:theme.textMuted }}>▼</button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${theme.divider}`, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  {weatherStatusTestando ? (
                    <span style={{ fontSize:12, color:theme.textFaint2 }}>🔍 Testando conexão...</span>
                  ) : !weatherStatus ? (
                    <span style={{ fontSize:12, color:theme.textFaint2 }}>Status não testado ainda.</span>
                  ) : weatherStatus.estado==='ok' ? (
                    <span style={{ fontSize:12, fontWeight:700, color:'#059669', background:theme.successBg, borderRadius:20, padding:'5px 12px' }}>🟢 {({meteoblue:'Meteoblue',tomorrow:'Tomorrow.io',open_meteo:'Open-Meteo'})[weatherProviderOrdem[0]]} Conectado (API OK)</span>
                  ) : weatherStatus.estado==='backup' ? (
                    <span style={{ fontSize:12, fontWeight:700, color:theme.warningText2, background:theme.warningBg, borderRadius:20, padding:'5px 12px' }}>🟡 Usando {({meteoblue:'Meteoblue',tomorrow:'Tomorrow.io',open_meteo:'Open-Meteo'})[weatherStatus.provedorAtivo]||'backup'} (Backup Ativo){weatherStatus.mensagem?` — ${weatherStatus.mensagem}`:''}</span>
                  ) : (
                    <span style={{ fontSize:12, fontWeight:700, color:theme.dangerText, background:theme.dangerBg, borderRadius:20, padding:'5px 12px' }}>🔴 {weatherStatus.mensagem}</span>
                  )}
                  <button onClick={testarConexaoClima} disabled={weatherStatusTestando} style={{ background:'none', border:'none', color:'#059669', fontSize:11.5, fontWeight:700, cursor:'pointer', padding:0 }}>🔄 Testar novamente</button>
                </div>
              </div>

              <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, marginBottom:16, maxWidth:520 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                  <SecTitle>🩺 Status Individual de Cada Provedor</SecTitle>
                </div>
                <div style={{ fontSize:11.5, color:theme.textFaint2, marginBottom:12 }}>Testa os 3 de forma independente (não é a cascata real) — mostra se cada API está funcional agora mesmo.</div>
                {weatherDiagnosticoTestando ? (
                  <div style={{ fontSize:12.5, color:theme.textFaint2 }}>🔍 Testando os 3 provedores...</div>
                ) : !weatherDiagnostico ? (
                  <button onClick={testarDiagnosticoProvedores} style={{ background:'#059669', color:'#fff', border:'none', borderRadius:10, padding:'9px 16px', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>🩺 Testar os 3 agora</button>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {['meteoblue','tomorrow','open_meteo'].map(id => {
                      const r = weatherDiagnostico[id]
                      const label = ({meteoblue:'Meteoblue',tomorrow:'Tomorrow.io',open_meteo:'Open-Meteo'})[id]
                      return (
                        <div key={id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background: r?.ok?theme.successBg:theme.dangerBg, borderRadius:10, padding:'8px 12px', fontSize:12.5 }}>
                          <span style={{ fontWeight:700, color:theme.text }}>{r?.ok?'🟢':'🔴'} {label}</span>
                          {!r?.ok && <span style={{ color:theme.dangerText, fontSize:11, maxWidth:220, textAlign:'right' }}>{r?.erro||'—'}</span>}
                        </div>
                      )
                    })}
                    <button onClick={testarDiagnosticoProvedores} style={{ marginTop:6, background:'none', border:'none', color:'#059669', fontSize:11.5, fontWeight:700, cursor:'pointer', padding:0, alignSelf:'flex-start' }}>🔄 Testar de novo</button>
                  </div>
                )}
              </div>

              <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, marginBottom:16, maxWidth:520 }}>
                <SecTitle>📊 Consumo das APIs de Clima (este mês)</SecTitle>
                {!weatherLogStats ? (
                  <div style={{ fontSize:12.5, color:theme.textFaint2 }}>Carregando...</div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div style={{ background:theme.bg, borderRadius:12, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:theme.textFaint2, letterSpacing:.5 }}>METEOBLUE</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:theme.text }}>{weatherLogStats.totalMeteoblue}</div>
                      <div style={{ fontSize:10.5, color:theme.textFaint2 }}>chamadas</div>
                    </div>
                    <div style={{ background:theme.bg, borderRadius:12, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:theme.textFaint2, letterSpacing:.5 }}>TOMORROW.IO</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:theme.text }}>{weatherLogStats.totalTomorrow}</div>
                      <div style={{ fontSize:10.5, color:theme.textFaint2 }}>chamadas</div>
                    </div>
                    <div style={{ background:theme.bg, borderRadius:12, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:theme.textFaint2, letterSpacing:.5 }}>OPEN-METEO</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:theme.text }}>{weatherLogStats.totalOpenMeteo}</div>
                      <div style={{ fontSize:10.5, color:theme.textFaint2 }}>chamadas</div>
                    </div>
                    <div style={{ background:theme.bg, borderRadius:12, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:theme.textFaint2, letterSpacing:.5 }}>HOJE</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:theme.text }}>{weatherLogStats.hoje}</div>
                      <div style={{ fontSize:10.5, color:theme.textFaint2 }}>chamadas</div>
                    </div>
                    <div style={{ background: weatherLogStats.falhasMes>0?theme.dangerBg:theme.bg, borderRadius:12, padding:'12px 14px', gridColumn:'1 / -1' }}>
                      <div style={{ fontSize:10, fontWeight:700, color: weatherLogStats.falhasMes>0?theme.dangerText:theme.textFaint2, letterSpacing:.5 }}>FALHAS</div>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color: weatherLogStats.falhasMes>0?theme.dangerText:theme.text }}>{weatherLogStats.falhasMes}</div>
                      <div style={{ fontSize:10.5, color: weatherLogStats.falhasMes>0?theme.dangerText:theme.textFaint2 }}>no mês</div>
                    </div>
                  </div>
                )}
                <button onClick={carregarWeatherLogStats} style={{ marginTop:12, background:'none', border:'none', color:'#059669', fontSize:11.5, fontWeight:700, cursor:'pointer', padding:0 }}>🔄 Atualizar números</button>
              </div>

              <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, marginBottom:16, maxWidth:520 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <SecTitle>📜 Repositório de Logs</SecTitle>
                  <button onClick={carregarWeatherLogs} style={{ background:'none', border:'none', color:'#059669', fontSize:11.5, fontWeight:700, cursor:'pointer', padding:0, marginBottom:8 }}>🔄</button>
                </div>
                <div style={{ fontSize:11.5, color:theme.textFaint2, marginBottom:10 }}>Últimas 20 chamadas às APIs de clima — pra identificar erros sem precisar abrir o painel da Vercel.</div>
                {weatherLogs===null ? (
                  <div style={{ fontSize:12.5, color:theme.textFaint2 }}>Carregando...</div>
                ) : weatherLogs.length===0 ? (
                  <div style={{ fontSize:12.5, color:theme.textFaint2 }}>Nenhuma chamada registrada ainda.</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:320, overflowY:'auto' }}>
                    {weatherLogs.map((l,i)=>(
                      <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, background: l.sucesso?'#f9fbfa':theme.dangerBg, borderRadius:10, padding:'8px 10px', fontSize:11.5 }}>
                        <span style={{ flexShrink:0 }}>{l.sucesso?'✅':'❌'}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, color:theme.text }}>
                            {({meteoblue:'Meteoblue',tomorrow:'Tomorrow.io',open_meteo:'Open-Meteo'})[l.provider]||l.provider}
                            <span style={{ fontWeight:400, color:theme.textFaint2, marginLeft:6 }}>{new Date(l.criado_em).toLocaleString('pt-BR')}</span>
                          </div>
                          {l.erro && <div style={{ color:theme.dangerText, marginTop:2, wordBreak:'break-word' }}>{l.erro}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </>)}

              {configSubTab==='geral' && (<>
                <ConfigGeralPainel config={configGeral} onSalvar={salvarConfigGeral} saving={configGeralSaving}/>
                <div style={{ background:'#f9fbfa', borderRadius:14, border:`1px dashed ${theme.cardBorder}`, padding:18, maxWidth:520, textAlign:'center', color:'#a9beb1', fontSize:12 }}>
                  Mais configurações aparecem aqui conforme forem adicionadas.
                </div>
              </>)}

              {configSubTab==='personalizacao' && (
                <PersonalizacaoRelatorios
                  configGeral={configGeral} onSalvarConfigGeral={salvarConfigGeral} configGeralSaving={configGeralSaving}
                  templates={reportTemplates} templatesLoading={reportTemplatesLoading}
                  onExcluir={excluirReportTemplate} onDefinirPadrao={definirTemplatePadrao}
                  editor={templateEditor} setEditor={setTemplateEditor} onSalvarTemplate={salvarReportTemplate}
                  invClientes={invClientes} isMobile={isMobile} showToast={showToast}
                />
              )}
            </div>
          )}

          {tab === 'arquivos' && (
            <ArquivosErrorBoundary>
              <TelaArquivos
                lista={arquivosLista} loading={arquivosLoading} erro={arquivosErro}
                filtroCategoria={arquivosFiltroCategoria} setFiltroCategoria={setArquivosFiltroCategoria}
                excluindo={arquivosExcluindo} onExcluir={excluirArquivoIndividual} onRecarregar={carregarArquivos}
                isMobile={isMobile}
              />
            </ArquivosErrorBoundary>
          )}

          {tab === 'dev' && (
            <div>
              <div style={{ marginBottom:18 }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>🛠️ Área do Desenvolvedor</div>
                <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>Benchmark comparativo das APIs de clima e histórico de chamadas.</div>
              </div>

              <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, marginBottom:16, maxWidth:640 }}>
                <SecTitle>🩺 Comparador das 3 APIs em Tempo Real</SecTitle>
                <div style={{ fontSize:11.5, color:theme.textFaint2, marginBottom:12 }}>Chama as 3 APIs em paralelo pra mesma coordenada — útil pra comparar precisão e velocidade antes de mudar a prioridade em Configurações {'>'} Clima.</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
                  <input style={{ border:`1px solid ${theme.cardBorder2}`, borderRadius:10, padding:'8px 11px', fontSize:12.5, outline:'none', width:130, background:theme.inputBg, color:theme.text }} placeholder="Latitude" value={devBenchLat} onChange={e=>setDevBenchLat(e.target.value)}/>
                  <input style={{ border:`1px solid ${theme.cardBorder2}`, borderRadius:10, padding:'8px 11px', fontSize:12.5, outline:'none', width:130, background:theme.inputBg, color:theme.text }} placeholder="Longitude" value={devBenchLng} onChange={e=>setDevBenchLng(e.target.value)}/>
                  <button onClick={rodarBenchmarkClima} disabled={devBenchTestando} style={{ background:'#059669', color:'#fff', border:'none', borderRadius:10, padding:'9px 16px', fontSize:12.5, fontWeight:700, cursor:'pointer', opacity:devBenchTestando?.7:1 }}>{devBenchTestando?'Testando...':'▶️ Rodar benchmark'}</button>
                </div>
                {!devBenchResultados ? (
                  <div style={{ fontSize:12.5, color:theme.textFaint2 }}>Ainda não rodou — clique em "Rodar benchmark".</div>
                ) : (
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5, minWidth:520 }}>
                      <thead>
                        <tr style={{ background:theme.bg, textAlign:'left' }}>
                          <th style={{ padding:'8px 10px' }}>Provedor</th>
                          <th style={{ padding:'8px 10px' }}>Status</th>
                          <th style={{ padding:'8px 10px' }}>Temp. (°C)</th>
                          <th style={{ padding:'8px 10px' }}>Umidade (%)</th>
                          <th style={{ padding:'8px 10px' }}>Vento (km/h)</th>
                          <th style={{ padding:'8px 10px' }}>Tempo (ms)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {['meteoblue','tomorrow','open_meteo'].map(id => {
                          const r = devBenchResultados[id]
                          const label = ({meteoblue:'Meteoblue',tomorrow:'Tomorrow.io',open_meteo:'Open-Meteo'})[id]
                          return (
                            <tr key={id} style={{ borderTop:`1px solid ${theme.divider}` }}>
                              <td style={{ padding:'8px 10px', fontWeight:700, color:theme.text }}>{label}</td>
                              <td style={{ padding:'8px 10px' }}>{r?.ok ? <span style={{color:'#059669',fontWeight:700}}>🟢 OK</span> : <span style={{color:theme.dangerText,fontWeight:700}}>🔴 {r?.erro||'Erro'}</span>}</td>
                              <td style={{ padding:'8px 10px', color:theme.text }}>{r?.temperatura!=null?r.temperatura.toFixed(1):'—'}</td>
                              <td style={{ padding:'8px 10px', color:theme.text }}>{r?.umidade!=null?Math.round(r.umidade):'—'}</td>
                              <td style={{ padding:'8px 10px', color:theme.text }}>{r?.vento!=null?r.vento.toFixed(1):'—'}</td>
                              <td style={{ padding:'8px 10px', color:theme.textMuted }}>{r?.tempoMs!=null?`${r.tempoMs} ms`:'—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, marginBottom:16, maxWidth:640 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                  <SecTitle>📜 Painel de Logs do Clima</SecTitle>
                  <button onClick={carregarWeatherLogs} style={{ background:'none', border:'none', color:'#059669', fontSize:11.5, fontWeight:700, cursor:'pointer', padding:0, marginBottom:8 }}>🔄</button>
                </div>
                <div style={{ fontSize:11.5, color:theme.textFaint2, marginBottom:10 }}>Últimas 20 chamadas reais do app (não inclui os testes do comparador acima). "Motivo/Status" mostra o erro exato quando falhou — geralmente inclui o código HTTP.</div>
                {weatherLogs===null ? (
                  <div style={{ fontSize:12.5, color:theme.textFaint2 }}>Carregando...</div>
                ) : weatherLogs.length===0 ? (
                  <div style={{ fontSize:12.5, color:theme.textFaint2 }}>Nenhuma chamada registrada ainda.</div>
                ) : (
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:480 }}>
                      <thead>
                        <tr style={{ background:theme.bg, textAlign:'left' }}>
                          <th style={{ padding:'7px 10px' }}>Data/Hora</th>
                          <th style={{ padding:'7px 10px' }}>Provedor</th>
                          <th style={{ padding:'7px 10px' }}>Status</th>
                          <th style={{ padding:'7px 10px' }}>Motivo (se falhou)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weatherLogs.map((l,i)=>(
                          <tr key={i} style={{ borderTop:`1px solid ${theme.divider}`, background: l.sucesso?'transparent':theme.dangerBg }}>
                            <td style={{ padding:'7px 10px', color:theme.textMuted, whiteSpace:'nowrap' }}>{new Date(l.criado_em).toLocaleString('pt-BR')}</td>
                            <td style={{ padding:'7px 10px', fontWeight:700, color:theme.text }}>{({meteoblue:'Meteoblue',tomorrow:'Tomorrow.io',open_meteo:'Open-Meteo'})[l.provider]||l.provider}</td>
                            <td style={{ padding:'7px 10px' }}>{l.sucesso ? '✅' : '❌'}</td>
                            <td style={{ padding:'7px 10px', color:theme.dangerText, wordBreak:'break-word' }}>{l.erro||'—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

        </main>
      </div>

      {/* MODAL FAZENDAS INDIVIDUAIS DO PILOTO */}
      {pilotoFazendasModal && (()=>{
        const marcadas = pilotoFazendas.filter(pf=>pf.piloto_id===pilotoFazendasModal.id).map(pf=>pf.fazenda_id)
        // Fazendas com progresso e conflito pré-calculados uma vez só aqui — a árvore por
        // lote (RegionTreeSelect) é um componente burro/apresentacional, não conhece
        // pilotoFazendas nem relatórios, só recebe os números prontos.
        const fazendasComInfo = invFazendas.map(fz => {
          const { pct } = progressoFazenda(fz)
          const { outrosPilotos, outrosTimes } = quemMaisTemFazenda(fz, { excluirPilotoId: pilotoFazendasModal.id })
          const conflito = outrosPilotos.length>0 || outrosTimes.length>0
          return { id:fz.id, nome:fz.nome, cliente:fz.cliente, pct, conflito, conflitoLabel: conflito ? [...outrosPilotos, ...outrosTimes.map(n=>`time ${n}`)].join(', ') : '' }
        })
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(11,18,16,0.55)',zIndex:1500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setPilotoFazendasModal(null)}>
            <div style={{background:theme.card,borderRadius:20,width:'100%',maxWidth:460,maxHeight:'85vh',overflowY:'auto',padding:22}} onClick={e=>e.stopPropagation()}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700}}>📍 Fazendas de {pilotoFazendasModal.nome}</div>
                <button style={{background:'none',border:'none',fontSize:18,color:theme.textFaint2,cursor:'pointer'}} onClick={()=>setPilotoFazendasModal(null)}>✕</button>
              </div>
              <p style={{fontSize:12,color:theme.textMuted,marginBottom:14,lineHeight:1.5}}>Permissão individual — se marcar alguma fazenda aqui, esse piloto passa a ver <strong>só</strong> essas, ignorando a permissão do time dele. Sem nenhuma marcada, vale a regra do time (ou tudo, se não tiver time).</p>

              <div style={{display:'flex',gap:6,marginBottom:12,background:theme.bg,borderRadius:12,padding:4}}>
                {[['individual','☑️ Uma por uma'],['lote','🗂️ Selecionar em lote']].map(([v,lbl])=>(
                  <button key={v} type="button" onClick={()=>setPilotoFazendasAba(v)}
                    style={{flex:1,background:pilotoFazendasAba===v?theme.card:'transparent',color:pilotoFazendasAba===v?theme.text:theme.textMuted,border:'none',borderRadius:9,padding:'7px 0',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                    {lbl}
                  </button>
                ))}
              </div>

              {pilotoFazendasAba==='individual' ? (
                <ChecklistFazendasPorCliente chavePrefixo={'piloto-'+pilotoFazendasModal.id} marcadas={marcadas} onToggle={fzId=>toggleFazendaPiloto(fzId,pilotoFazendasModal.id)} excluirPilotoId={pilotoFazendasModal.id}/>
              ) : (
                <>
                  <p style={{fontSize:11,color:theme.textFaint2,marginBottom:8,lineHeight:1.4}}>Marca o ✓ ao lado do cliente pra atribuir todas as fazendas dele de uma vez.</p>
                  <RegionTreeSelect
                    fazendas={fazendasComInfo}
                    marcadas={marcadas}
                    onToggleFazenda={fzId=>toggleFazendaPiloto(fzId,pilotoFazendasModal.id)}
                    onToggleGrupo={ids=>toggleGrupoFazendasPiloto(ids,pilotoFazendasModal.id)}
                    theme={theme}
                  />
                </>
              )}
              <button style={{width:'100%',marginTop:16,background:'#059669',color:'#fff',border:'none',borderRadius:100,padding:12,fontSize:13,fontWeight:700,cursor:'pointer'}} onClick={()=>setPilotoFazendasModal(null)}>Pronto</button>
            </div>
          </div>
        )
      })()}

      {/* MODAL EDITAR */}
      {editModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems: isMobile?'flex-end':'center', justifyContent:'center', padding: isMobile?0:24 }}>
          <div style={{ background:theme.card, borderRadius: isMobile?'20px 20px 0 0':16, width:'100%', maxWidth: isMobile?'100%':920, maxHeight: isMobile?'95vh':'90vh', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'15px 20px', borderBottom:`1px solid ${theme.divider}`, flexShrink:0 }}>
              <span style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700 }}>✏️ Editar Relatório</span>
              <button style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:theme.textMuted }} onClick={resetEdit}>✕</button>
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
                      <button style={{ background:'none', border:'none', color:theme.dangerText, fontSize:11, cursor:'pointer', padding:'2px 6px' }}
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
                  <label style={{ display:'block', border:`1.5px dashed ${theme.cardBorder2}`, borderRadius:10, padding:10, textAlign:'center', cursor:'pointer', marginTop:4 }}>
                    <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setEditFotoMapa(ev.target.result); r.readAsDataURL(f); setEditFotoMapaFile(f) }} />
                    {editFotoMapa ? <img src={editFotoMapa} alt="mapa" style={{ width:'100%', maxHeight:120, objectFit:'cover', borderRadius:8 }} />
                      : editModal.foto_mapa_url ? <StoragePhoto supabase={supabase} path={editModal.foto_mapa_url} bucket="relatorios" />
                      : <div style={{ padding:'16px 0', fontSize:12, color:theme.textMuted }}>🗺️ Clique para adicionar</div>}
                  </label>
                </div>
                <div>
                  <div style={sG.label}>OBSERVAÇÕES</div>
                  <div style={{ display:'flex', gap:8, marginTop:4 }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
                        <label style={{ border:`1.5px dashed ${theme.cardBorder2}`, borderRadius:10, padding:8, textAlign:'center', cursor:'pointer', minHeight:70, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                          <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{const a=[...editObsFotos];a[i]=ev.target.result;setEditObsFotos(a)}; r.readAsDataURL(f); const a=[...editObsFotoFiles];a[i]=f;setEditObsFotoFiles(a) }} />
                          {editObsFotos[i] ? <img src={editObsFotos[i]} alt="" style={{ width:'100%', height:60, objectFit:'cover', borderRadius:6 }} />
                            : editModal.obs_fotos_urls?.[i] ? <StoragePhoto supabase={supabase} path={editModal.obs_fotos_urls[i]} bucket="relatorios" small />
                            : <span style={{ fontSize:18 }}>📷</span>}
                        </label>
                        {(editObsFotos[i] || editModal.obs_fotos_urls?.[i]) && (
                          <button style={{ background:theme.dangerBg, color:theme.dangerText, border:'none', borderRadius:14, padding:'3px', fontSize:10, cursor:'pointer', width:'100%' }}
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
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:theme.bg, borderRadius:8, padding:'8px 12px', marginBottom:6, border:`1px solid ${theme.cardBorder2}` }}>
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
                        <button style={{ background:theme.dangerBg, color:theme.dangerText, border:'none', borderRadius:14, padding:'4px 10px', fontSize:11, cursor:'pointer' }}
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
                <label style={{ display:'flex', alignItems:'center', gap:8, border:`1.5px dashed ${theme.cardBorder2}`, borderRadius:10, padding:'10px 14px', cursor:'pointer', fontSize:13, color:theme.textMuted }}>
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
            <div style={{ borderTop:`1px solid ${theme.divider}`, flexShrink:0 }}>
              {/* Linha de exportação */}
              <div style={{ display:'flex', gap:6, padding:'10px 20px 0', flexWrap:'wrap' }}>
                <div style={{ fontSize:11, color:theme.textMuted, width:'100%', marginBottom:4, fontWeight:600 }}>EXPORTAR:</div>
                {[
                  ['🟢 PDF Cliente', '#059669', 'cliente'],
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
                <button style={{ ...sG.btn, background:theme.bg, color:theme.textMuted, flex:1 }} onClick={resetEdit}>Cancelar</button>
                <button style={{ ...sG.btn, flex:2, opacity:saving?.6:1 }} disabled={saving} onClick={salvarEdicao}>{saving?'Salvando...':'💾 Salvar'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNotifs && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:490 }} onClick={fecharNotificacoes} />
          <div style={{ position:'fixed', top:isMobile?58:20, right:isMobile?10:20, left:isMobile?10:'auto', width:isMobile?'auto':360, maxHeight:460, overflowY:'auto', background:theme.card, borderRadius:16, boxShadow:'0 12px 40px rgba(0,0,0,.25)', zIndex:500, border:`1px solid ${theme.cardBorder2}` }}>
            <div style={{ padding:'14px 16px', borderBottom:`1px solid ${theme.divider}`, display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:theme.card, borderRadius:'16px 16px 0 0' }}>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14 }}>🔔 Notificações</div>
              <button onClick={fecharNotificacoes} style={{ background:'transparent', border:'none', fontSize:16, cursor:'pointer', color:theme.textFaint2 }}>✕</button>
            </div>
            {notificacoes.length===0 ? (
              <div style={{ padding:24, textAlign:'center', color:theme.textFaint2, fontSize:13 }}>Nenhuma notificação ainda</div>
            ) : notificacoes.map(n=>{
              const naoVista = !notifVisto || new Date(n.ts) > new Date(notifVisto)
              return (
                <div key={n.id} onClick={()=>{n.onClick();fecharNotificacoes()}} style={{ padding:'12px 16px', borderBottom:'1px solid #f6faf7', cursor:'pointer', background:naoVista?'#f0faf5':'#fff', display:'flex', gap:10, alignItems:'flex-start' }}>
                  <span style={{ fontSize:16, flexShrink:0 }}>{n.icone}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12.5, color:theme.text, fontWeight:naoVista?600:400 }}>{n.texto}</div>
                    <div style={{ fontSize:10, color:theme.textFaint2, marginTop:2 }}>{new Date(n.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                  {naoVista && <span style={{ width:8, height:8, borderRadius:'50%', background:'#059669', flexShrink:0, marginTop:5 }}/>}
                </div>
              )
            })}
          </div>
        </>
      )}

      {confirmSair && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:theme.card, borderRadius:16, width:'100%', maxWidth:380, padding:24 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, marginBottom:10 }}>Sair da conta?</div>
            <p style={{ fontSize:14, marginBottom:18, color:theme.textMuted }}>Você vai precisar entrar de novo com seu e-mail e senha.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...sG.btn, background:theme.bg, color:theme.textMuted, flex:1 }} onClick={() => setConfirmSair(false)}>Cancelar</button>
              <button style={{ ...sG.btn, background:theme.dangerText, flex:1 }} onClick={signOut}>Sair</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:theme.card, borderRadius:16, width:'100%', maxWidth:380, padding:24 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, marginBottom:10 }}>🗑️ Confirmar exclusão</div>
            <p style={{ fontSize:14, marginBottom:6 }}>Deletar relatório de <strong>{confirmDelete.cliente}</strong>?</p>
            <p style={{ fontSize:12, color:theme.dangerText, marginBottom:18 }}>Esta ação não pode ser desfeita.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...sG.btn, background:theme.bg, color:theme.textMuted, flex:1 }} onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button style={{ ...sG.btn, background:theme.dangerText, flex:1 }} onClick={() => deletarRelatorio(confirmDelete.id)}>Deletar</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteDespesa && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:theme.card, borderRadius:16, width:'100%', maxWidth:380, padding:24 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, marginBottom:10 }}>🗑️ Confirmar exclusão</div>
            <p style={{ fontSize:14, marginBottom:6 }}>Deletar despesa de <strong>{confirmDeleteDespesa.categoria} — R$ {parseFloat(confirmDeleteDespesa.valor).toFixed(2)}</strong>?</p>
            <p style={{ fontSize:12, color:theme.dangerText, marginBottom:18 }}>Esta ação não pode ser desfeita.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...sG.btn, background:theme.bg, color:theme.textMuted, flex:1 }} onClick={() => setConfirmDeleteDespesa(null)}>Cancelar</button>
              <button style={{ ...sG.btn, background:theme.dangerText, flex:1 }} onClick={() => deletarDespesa(confirmDeleteDespesa.id)}>Deletar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background: toast.type==='error'?theme.dangerText:theme.text, color:'#fff', padding:'12px 24px', borderRadius:100, fontSize:13, fontWeight:500, zIndex:400, whiteSpace:'nowrap', borderBottom:'3px solid #D97706', boxShadow:'0 4px 20px rgba(0,0,0,.2)' }}>{toast.msg}</div>}
      {showPerfil && <ProfileModal profile={profile} onClose={()=>setShowPerfil(false)} onSaved={async()=>{await refreshProfile();setShowPerfil(false);showToast('✅ Perfil atualizado!')}}/>}
    </div>
  )
}

function SecTitle({ children }) {
  const { theme } = useTheme()
  return <div style={{ fontSize:10, fontWeight:700, color:'#059669', letterSpacing:1, marginBottom:8, paddingBottom:4, borderBottom:`1px solid ${theme.successBg}`, fontFamily:"'Syne',sans-serif" }}>{children}</div>
}

// Error boundary da tela de Arquivos — React Error Boundaries PRECISAM ser class component
// (não existe hook equivalente). Se qualquer coisa dentro de TelaArquivos quebrar em runtime
// (dado inesperado, null, etc), mostra uma mensagem amigável em vez de branquear a tela
// inteira do Admin. Note: por ser classe, não pode usar useTheme() — usa cores fixas, o que é
// aceitável aqui já que é uma tela de fallback de erro, não uma tela do dia a dia.
class ArquivosErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { erro: null } }
  static getDerivedStateFromError(erro) { return { erro } }
  componentDidCatch(erro, info) { console.error('[Arquivos] erro capturado pelo ErrorBoundary:', erro, info) }
  render() {
    if (this.state.erro) {
      return (
        <div style={{ background:'#fdeaea', border:'1px solid #f3b8b8', borderRadius:16, padding:24, textAlign:'center', color:'#a3221e' }}>
          <div style={{ fontSize:32, marginBottom:10 }}>⚠️</div>
          <div style={{ fontWeight:700, marginBottom:4 }}>A tela de Arquivos encontrou um problema</div>
          <div style={{ fontSize:12.5, marginBottom:14 }}>Isso não afeta o resto do sistema — só essa tela. Tenta recarregar a página.</div>
          <button onClick={() => this.setState({ erro:null })} style={{ background:'#fff', border:'1px solid #e5a3a3', color:'#a3221e', borderRadius:10, padding:'8px 16px', fontSize:12.5, fontWeight:600, cursor:'pointer' }}>Tentar de novo</button>
        </div>
      )
    }
    return this.props.children
  }
}

const CATEGORIA_ARQUIVO_LABEL = { foto:'📷 Foto de Relatório', kml:'🛰️ KML/KMZ', logo:'🏢 Logo' }
function fmtTamanho(bytes) {
  if (bytes == null || isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(0)} KB`
  return `${(bytes/1024/1024).toFixed(2)} MB`
}

// Tela de Gestão de Arquivos — dados vêm de `relatorios` (fotos/KML já referenciados lá) +
// pasta `logos/`, não de uma varredura cega do bucket inteiro (ver carregarArquivos no
// componente pai). `lista` nunca é undefined (o pai garante isso), mas ainda assim trata como
// se pudesse ser, por segurança extra.
function TelaArquivos({ lista, loading, erro, filtroCategoria, setFiltroCategoria, excluindo, onExcluir, onRecarregar, isMobile }) {
  const { theme } = useTheme()
  // Padrão: do mais pesado pro menor, como pedido — clicar no cabeçalho "Tamanho" alterna.
  const [ordemTamanho, setOrdemTamanho] = useState('desc')
  const [preview, setPreview] = useState(null) // { item, url, carregando, erro }
  const listaSegura = Array.isArray(lista) ? lista : []
  const filtrada = (filtroCategoria ? listaSegura.filter(it => it?.categoria === filtroCategoria) : listaSegura)
    .slice()
    .sort((a, b) => {
      const ta = typeof a?.tamanho === 'number' ? a.tamanho : -1
      const tb = typeof b?.tamanho === 'number' ? b.tamanho : -1
      return ordemTamanho === 'desc' ? tb - ta : ta - tb
    })
  const usoTotal = listaSegura.reduce((a, it) => a + (typeof it?.tamanho === 'number' ? it.tamanho : 0), 0)
  const contagemPorCategoria = listaSegura.reduce((acc, it) => { const c = it?.categoria || '—'; acc[c] = (acc[c]||0)+1; return acc }, {})

  async function visualizar(item) {
    setPreview({ item, url:null, carregando:true, erro:'' })
    try {
      const { data, error } = await supabase.storage.from('relatorios').createSignedUrl(item.path, 300)
      if (error || !data?.signedUrl) throw error || new Error('sem URL')
      setPreview({ item, url:data.signedUrl, carregando:false, erro:'' })
    } catch (e) {
      setPreview({ item, url:null, carregando:false, erro:'Não foi possível abrir esse arquivo agora.' })
    }
  }
  const ehImagem = cat => cat === 'foto' || cat === 'logo'

  return (
    <div>
      <div style={{ marginBottom:18, display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:theme.text }}>🗂️ Arquivos</div>
          <div style={{ fontSize:12, color:theme.textMuted, marginTop:2 }}>Fotos, KML e logos armazenados no Supabase Storage.</div>
        </div>
        <button onClick={onRecarregar} disabled={loading} style={{ background:theme.card, border:`1px solid ${theme.cardBorder}`, color:'#059669', borderRadius:10, padding:'8px 14px', fontSize:12.5, fontWeight:600, cursor:loading?'default':'pointer' }}>
          {loading ? '⏳ Carregando...' : '🔄 Atualizar'}
        </button>
      </div>

      <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:18, marginBottom:16, maxWidth:520 }}>
        <SecTitle>💾 Uso de Armazenamento (conhecido)</SecTitle>
        <div style={{ fontSize:11, color:theme.textFaint2, marginBottom:10 }}>Soma dos arquivos listados abaixo — não é necessariamente o total do bucket inteiro (ex: recibos de despesas não entram aqui).</div>
        <div style={{ fontFamily:"'Syne',sans-serif", fontSize:26, fontWeight:700, color:'#059669' }}>{fmtTamanho(usoTotal)}</div>
        <div style={{ display:'flex', gap:14, marginTop:8, flexWrap:'wrap', fontSize:12, color:theme.textMuted }}>
          {Object.entries(CATEGORIA_ARQUIVO_LABEL).map(([k,label]) => <span key={k}>{label}: {contagemPorCategoria[k]||0}</span>)}
        </div>
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
        <button onClick={() => setFiltroCategoria('')} style={{ background: filtroCategoria===''?'#059669':theme.card, color: filtroCategoria===''?'#fff':theme.textMuted, border:`1px solid ${filtroCategoria===''?'#059669':theme.cardBorder}`, borderRadius:20, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>Todos ({listaSegura.length})</button>
        {Object.entries(CATEGORIA_ARQUIVO_LABEL).map(([k,label]) => (
          <button key={k} onClick={() => setFiltroCategoria(k)} style={{ background: filtroCategoria===k?'#059669':theme.card, color: filtroCategoria===k?'#fff':theme.textMuted, border:`1px solid ${filtroCategoria===k?'#059669':theme.cardBorder}`, borderRadius:20, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>{label} ({contagemPorCategoria[k]||0})</button>
        ))}
      </div>

      {erro && (
        <div style={{ background:'#fff3e0', border:'1px solid #f2c98a', borderRadius:12, padding:'12px 16px', marginBottom:14, fontSize:12.5, color:'#a3690a' }}>⚠️ {erro}</div>
      )}

      {loading ? (
        <div style={{ textAlign:'center', color:theme.textMuted, padding:40 }}>⏳ Carregando arquivos...</div>
      ) : filtrada.length === 0 ? (
        <div style={{ background:theme.card, borderRadius:16, border:`1px dashed ${theme.cardBorder}`, padding:40, textAlign:'center', color:theme.textFaint2 }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
          Nenhum arquivo encontrado no storage.
        </div>
      ) : (
        <div style={{ background:theme.card, borderRadius:16, border:`1px solid ${theme.cardBorder}`, overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
              <thead>
                <tr style={{ background:theme.bg, textAlign:'left' }}>
                  <th style={{ padding:'10px 14px' }}>Nome</th>
                  <th style={{ padding:'10px 14px' }}>Categoria</th>
                  <th style={{ padding:'10px 14px' }}>Relatório</th>
                  <th style={{ padding:'10px 14px', cursor:'pointer', userSelect:'none' }} onClick={() => setOrdemTamanho(o => o==='desc'?'asc':'desc')}>
                    Tamanho {ordemTamanho==='desc' ? '▼' : '▲'}
                  </th>
                  <th style={{ padding:'10px 14px' }}>Data</th>
                  <th style={{ padding:'10px 14px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtrada.map((it, i) => (
                  <tr key={it?.path||i} style={{ borderTop:`1px solid ${theme.divider}` }}>
                    <td style={{ padding:'10px 14px', color:'#059669', fontWeight:600, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'pointer' }} onClick={() => visualizar(it)}>{it?.nome||'—'}</td>
                    <td style={{ padding:'10px 14px', color:theme.textMuted }}>{CATEGORIA_ARQUIVO_LABEL[it?.categoria]||it?.categoria||'—'}</td>
                    <td style={{ padding:'10px 14px', color:theme.textMuted }}>{it?.relLabel||'—'}</td>
                    <td style={{ padding:'10px 14px', color:theme.textMuted }}>{fmtTamanho(it?.tamanho)}</td>
                    <td style={{ padding:'10px 14px', color:theme.textMuted }}>{it?.data ? new Date(it.data).toLocaleDateString('pt-BR') : '—'}</td>
                    <td style={{ padding:'10px 14px', whiteSpace:'nowrap' }}>
                      <button onClick={() => visualizar(it)} style={{ background:theme.bg, color:theme.textMuted, border:`1px solid ${theme.cardBorder2}`, borderRadius:10, padding:'5px 10px', fontSize:11.5, cursor:'pointer', marginRight:6 }}>
                        👁️ Ver
                      </button>
                      <button disabled={excluindo===it?.path} onClick={() => onExcluir(it)} style={{ background:'#fdeaea', color:'#e5484d', border:'none', borderRadius:10, padding:'5px 10px', fontSize:11.5, cursor:excluindo===it?.path?'default':'pointer' }}>
                        {excluindo===it?.path ? '...' : '🗑️ Deletar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position:'fixed', inset:0, background:'rgba(11,18,16,0.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:theme.card, borderRadius:16, maxWidth:640, width:'100%', maxHeight:'88vh', overflow:'auto', padding:18 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, gap:10 }}>
              <div style={{ fontWeight:700, fontSize:14, color:theme.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{preview.item?.nome}</div>
              <button onClick={() => setPreview(null)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:theme.textMuted, flexShrink:0 }}>×</button>
            </div>
            {preview.carregando ? (
              <div style={{ textAlign:'center', color:theme.textMuted, padding:40 }}>⏳ Carregando...</div>
            ) : preview.erro ? (
              <div style={{ background:'#fff3e0', border:'1px solid #f2c98a', borderRadius:12, padding:'12px 16px', fontSize:12.5, color:'#a3690a' }}>⚠️ {preview.erro}</div>
            ) : ehImagem(preview.item?.categoria) ? (
              <img src={preview.url} alt={preview.item?.nome} style={{ width:'100%', borderRadius:10, display:'block' }}/>
            ) : (
              <div style={{ textAlign:'center', padding:'20px 0' }}>
                <div style={{ fontSize:13, color:theme.textMuted, marginBottom:14 }}>Esse tipo de arquivo (KML/KMZ) não tem visualização direta — abra ou baixe pra ver no seu app de mapas.</div>
                <a href={preview.url} target="_blank" rel="noreferrer" style={{ background:'#059669', color:'#fff', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:600, textDecoration:'none', display:'inline-block' }}>⬇️ Abrir/Baixar arquivo</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Painel de regras + calculadora, dentro de Financeiro > Orçamento. Explica exatamente como
// cada linha da calculadora é calculada (pra não virar caixa-preta) e deixa editável tudo
// que faz sentido variar por operação — jornada de trabalho, teto de margem e multiplicador
// de deslocamento. As fórmulas em si (o que multiplica o quê) são estruturais e não viram
// campo de configuração, só os números que podem variar.
function RegrasOrcamento({ config, onSalvar, saving, isMobile, calc, setCalc }) {
  const { theme } = useTheme()
  const [draft, setDraft] = useState(config)
  useEffect(() => { setDraft(config) }, [config])
  const alterado = JSON.stringify(draft) !== JSON.stringify(config)
  const inputSt = { width:110, border:`1px solid ${theme.cardBorder2}`, borderRadius:8, padding:'6px 9px', fontSize:13, outline:'none', color:theme.text, textAlign:'right' }

  const REGRAS = [
    { label:'🔋 Baterias', formula:'Tempo estimado (área ÷ rendimento) × custo da bateria/hora', config:null },
    { label:'🚙 Deslocamento', formula:`Distância × ${draft.multiplicadorDeslocamento} (ida${draft.multiplicadorDeslocamento===2?' e volta':''}) × combustível/km`, config:'multiplicadorDeslocamento' },
    { label:'🏨 Diárias', formula:`Diária × dias, com jornada de ${draft.horasPorDia}h/dia (arredondado pra cima)`, config:'horasPorDia' },
    { label:'🛠️ Desgaste', formula:'Tempo estimado × desgaste do equipamento/hora', config:null },
    { label:'💰 Preço sugerido/ha', formula:`Custo/ha ÷ (1 − margem%), com teto de ${draft.margemMaxPct}% de margem`, config:'margemMaxPct' },
  ]

  return (
    <div>
      <div style={{background:theme.card,borderRadius:16,border:`1px solid ${theme.cardBorder}`,padding:20,marginBottom:16}}>
        <SecTitle>📖 Como a calculadora calcula cada linha</SecTitle>
        <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:8}}>
          {REGRAS.map(r=>(
            <div key={r.label} style={{display:'flex',flexDirection:isMobile?'column':'row',justifyContent:'space-between',alignItems:isMobile?'flex-start':'center',gap:isMobile?4:12,padding:'8px 0',borderBottom:'1px solid #f0f5f2'}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:theme.text}}>{r.label}</div>
                <div style={{fontSize:12,color:theme.textMuted,marginTop:2}}>{r.formula}</div>
              </div>
              {r.config==='multiplicadorDeslocamento' && (
                <input type="number" style={inputSt} value={draft.multiplicadorDeslocamento} onChange={e=>setDraft(d=>({...d,multiplicadorDeslocamento:parseFloat(e.target.value)||1}))}/>
              )}
              {r.config==='horasPorDia' && (
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <input type="number" style={inputSt} value={draft.horasPorDia} onChange={e=>setDraft(d=>({...d,horasPorDia:parseFloat(e.target.value)||1}))}/>
                  <span style={{fontSize:12,color:theme.textFaint2}}>h/dia</span>
                </div>
              )}
              {r.config==='margemMaxPct' && (
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <input type="number" style={inputSt} value={draft.margemMaxPct} onChange={e=>setDraft(d=>({...d,margemMaxPct:Math.min(99,Math.max(0,parseFloat(e.target.value)||0))}))}/>
                  <span style={{fontSize:12,color:theme.textFaint2}}>% máx.</span>
                </div>
              )}
            </div>
          ))}
        </div>
        {alterado && (
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button disabled={saving} onClick={()=>onSalvar(draft)} style={{background:'#059669',color:'#fff',border:'none',borderRadius:10,padding:'9px 16px',fontSize:12.5,fontWeight:700,cursor:saving?'default':'pointer',opacity:saving?0.7:1}}>{saving?'Salvando...':'💾 Salvar regras'}</button>
            <button disabled={saving} onClick={()=>setDraft(config)} style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:10,padding:'9px 16px',fontSize:12.5,fontWeight:700,cursor:'pointer'}}>Cancelar</button>
          </div>
        )}
      </div>
      <CalculadoraOrcamento calc={calc} setCalc={setCalc} isMobile={isMobile} config={config}/>
    </div>
  )
}

// Configurações do Sistema > dados da empresa, limites de alerta climático e valores
// padrão do wizard. Um único registro em app_settings (config_geral), editado em bloco
// com "Salvar" só aparecendo quando algo muda — mesmo padrão do RegrasOrcamento.
function ConfigGeralPainel({ config, onSalvar, saving }) {
  const { theme } = useTheme()
  const [draft, setDraft] = useState(config)
  useEffect(() => { setDraft(config) }, [config])
  const alterado = JSON.stringify(draft) !== JSON.stringify(config)
  const inputSt = { width:'100%', border:`1px solid ${theme.cardBorder2}`, borderRadius:10, padding:'8px 11px', fontSize:13, outline:'none', color:theme.text, boxSizing:'border-box' }
  const labelSt = { fontSize:10.5, fontWeight:700, color:theme.textFaint2, letterSpacing:.5, marginBottom:5, display:'block' }
  const grid2 = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, marginBottom:16 }}>
      <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, maxWidth:520 }}>
        <SecTitle>🌬️ Limites de Alerta Climático</SecTitle>
        <div style={{ fontSize:11.5, color:theme.textFaint2, marginBottom:12 }}>Faixas que classificam vento e Delta T como Apto/Atenção/Não Conforme nas telas de clima do piloto.</div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={grid2}>
            <div><label style={labelSt}>VENTO MÍN. (km/h)</label><input type="number" style={inputSt} value={draft.limitesClima.ventoMin} onChange={e=>setDraft(d=>({...d,limitesClima:{...d.limitesClima,ventoMin:parseFloat(e.target.value)||0}}))}/></div>
            <div><label style={labelSt}>VENTO MÁX. (km/h)</label><input type="number" style={inputSt} value={draft.limitesClima.ventoMax} onChange={e=>setDraft(d=>({...d,limitesClima:{...d.limitesClima,ventoMax:parseFloat(e.target.value)||0}}))}/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
            <div><label style={labelSt}>DELTA T MÍN.</label><input type="number" style={inputSt} value={draft.limitesClima.deltaTMin} onChange={e=>setDraft(d=>({...d,limitesClima:{...d.limitesClima,deltaTMin:parseFloat(e.target.value)||0}}))}/></div>
            <div><label style={labelSt}>DELTA T IDEAL ATÉ</label><input type="number" style={inputSt} value={draft.limitesClima.deltaTIdealMax} onChange={e=>setDraft(d=>({...d,limitesClima:{...d.limitesClima,deltaTIdealMax:parseFloat(e.target.value)||0}}))}/></div>
            <div><label style={labelSt}>DELTA T LIMITE</label><input type="number" style={inputSt} value={draft.limitesClima.deltaTAlertaMax} onChange={e=>setDraft(d=>({...d,limitesClima:{...d.limitesClima,deltaTAlertaMax:parseFloat(e.target.value)||0}}))}/></div>
          </div>
        </div>
      </div>

      <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, maxWidth:520 }}>
        <SecTitle>🚁 Valores Padrão do Wizard de Voo</SecTitle>
        <div style={{ fontSize:11.5, color:theme.textFaint2, marginBottom:12 }}>Pré-preenche o Passo 2 (Aplicação) de todo novo voo — o piloto pode sempre alterar. Deixe em branco pra não sugerir nada.</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          <div><label style={labelSt}>VELOCIDADE (km/h)</label><input style={inputSt} placeholder="Ex: 25" value={draft.wizardDefaults.velocidadeDrone} onChange={e=>setDraft(d=>({...d,wizardDefaults:{...d.wizardDefaults,velocidadeDrone:e.target.value}}))}/></div>
          <div><label style={labelSt}>ALTURA (m)</label><input style={inputSt} placeholder="Ex: 3" value={draft.wizardDefaults.altura} onChange={e=>setDraft(d=>({...d,wizardDefaults:{...d.wizardDefaults,altura:e.target.value}}))}/></div>
          <div><label style={labelSt}>FAIXA (m)</label><input style={inputSt} placeholder="Ex: 5" value={draft.wizardDefaults.faixa} onChange={e=>setDraft(d=>({...d,wizardDefaults:{...d.wizardDefaults,faixa:e.target.value}}))}/></div>
        </div>
      </div>

      {alterado && (
        <div style={{display:'flex',gap:8,maxWidth:520}}>
          <button disabled={saving} onClick={()=>onSalvar(draft)} style={{background:'#059669',color:'#fff',border:'none',borderRadius:10,padding:'9px 16px',fontSize:12.5,fontWeight:700,cursor:saving?'default':'pointer',opacity:saving?0.7:1}}>{saving?'Salvando...':'💾 Salvar configurações'}</button>
          <button disabled={saving} onClick={()=>setDraft(config)} style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:10,padding:'9px 16px',fontSize:12.5,fontWeight:700,cursor:'pointer'}}>Cancelar</button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Configurações > Personalização de Relatórios — dados da empresa + logo (movidos de
// ConfigGeralPainel) e o CRUD/editor de templates de WhatsApp/PDF por cliente.
// ============================================================

// Upload simples de imagem (logo) pro bucket 'relatorios' — mesmo padrão do avatar em
// ProfileModal.jsx: guarda o PATH no banco, resolve a URL de exibição via createSignedUrl.
function LogoUploader({ path, onChange, pastaPrefixo }) {
  const { theme } = useTheme()
  const [preview, setPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => {
    if (!path) { setPreview(null); return }
    let ativo = true
    supabase.storage.from('relatorios').createSignedUrl(path, 3600).then(({ data }) => {
      if (ativo && data?.signedUrl) setPreview(data.signedUrl)
    })
    return () => { ativo = false }
  }, [path])
  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const novoPath = `${pastaPrefixo}-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('relatorios').upload(novoPath, file, { upsert: true })
      if (error) throw error
      onChange(novoPath)
    } catch (e2) { window.alert('Erro ao enviar logo: ' + e2.message) } finally { setUploading(false); if (inputRef.current) inputRef.current.value = '' }
  }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
      <div style={{ width:64, height:64, borderRadius:10, border:`1px solid ${theme.cardBorder2}`, background:theme.bg, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', flexShrink:0 }}>
        {preview ? <img src={preview} alt="logo" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }}/> : <span style={{ fontSize:22 }}>🖼️</span>}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        <label style={{ fontSize:11.5, fontWeight:700, color:'#059669', cursor:'pointer' }}>
          {uploading ? 'Enviando...' : (path ? 'Trocar logo' : '📤 Enviar logo')}
          <input ref={inputRef} type="file" accept="image/png,image/jpeg" onChange={handleFile} disabled={uploading} style={{ display:'none' }}/>
        </label>
        {path && <button onClick={()=>onChange('')} style={{ background:'none', border:'none', color:theme.dangerText, fontSize:11, fontWeight:700, cursor:'pointer', padding:0, textAlign:'left' }}>Remover</button>}
      </div>
    </div>
  )
}

// Switch verde simples — mesmo padrão de cor de "ativo" (#059669) usado no resto do app.
function ToggleRow({ label, checked, onChange }) {
  const { theme } = useTheme()
  return (
    <label style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'8px 0', cursor:'pointer' }}>
      <span style={{ fontSize:12.5, color:theme.text }}>{label}</span>
      <span onClick={()=>onChange(!checked)} style={{ width:38, height:22, borderRadius:12, background: checked?'#059669':theme.divider, position:'relative', flexShrink:0, transition:'background .15s' }}>
        <span style={{ position:'absolute', top:2, left: checked?18:2, width:18, height:18, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.3)', transition:'left .15s' }}/>
      </span>
    </label>
  )
}

const PDF_CORES_PRESET = [
  { label:'Verde Esmeralda', cor:'#059669' },
  { label:'Azul Institucional', cor:'#2f6fed' },
  { label:'Laranja', cor:'#f2960f' },
  { label:'Roxo', cor:'#8e44ad' },
  { label:'Vermelho', cor:'#e5484d' },
]

const PDF_SECOES_LABELS = {
  cabecalho: '🏷️ Cabeçalho (logo/empresa)',
  dadosOperacionais: '📋 Dados Operacionais',
  condicoesClimaticas: '🌤️ Condições Climáticas',
  insumos: '🧪 Insumos/Produtos',
  fotos: '🖼️ Fotos do Talhão',
  grafico: '📈 Gráfico de Parâmetros',
  assinatura: '✍️ Bloco de Assinatura',
  rodape: '📎 Rodapé (contato)',
}
// Cabeçalho e Rodapé ficam fixos no layout (topo/base de cada coluna) — não fazem parte do
// fluxo vertical sequencial das outras seções, então não entram na lista reordenável.
const PDF_SECOES_REORDENAVEIS = ['dadosOperacionais', 'condicoesClimaticas', 'insumos', 'fotos', 'grafico', 'assinatura']

function PersonalizacaoRelatorios({ configGeral, onSalvarConfigGeral, configGeralSaving, templates, templatesLoading, onExcluir, onDefinirPadrao, editor, setEditor, onSalvarTemplate, invClientes, isMobile, showToast }) {
  const { theme } = useTheme()
  const [draftEmpresa, setDraftEmpresa] = useState(configGeral.empresa)
  useEffect(() => { setDraftEmpresa(configGeral.empresa) }, [configGeral.empresa])
  const alteradoEmpresa = JSON.stringify(draftEmpresa) !== JSON.stringify(configGeral.empresa)
  const inputSt = { width:'100%', border:`1px solid ${theme.cardBorder2}`, borderRadius:10, padding:'8px 11px', fontSize:13, outline:'none', color:theme.text, boxSizing:'border-box' }
  const labelSt = { fontSize:10.5, fontWeight:700, color:theme.textFaint2, letterSpacing:.5, marginBottom:5, display:'block' }
  const grid2 = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, marginBottom:16 }}>
      <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20, maxWidth:520 }}>
        <SecTitle>🏢 Dados da Empresa</SecTitle>
        <div style={{ fontSize:11.5, color:theme.textFaint2, marginBottom:12 }}>Usados no rodapé dos PDFs de relatório/orçamento.</div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <label style={labelSt}>LOGO DA EMPRESA/PRESTADOR</label>
            <LogoUploader path={draftEmpresa.logo_url} onChange={p=>setDraftEmpresa(d=>({...d,logo_url:p}))} pastaPrefixo="logos/empresa"/>
          </div>
          <div><label style={labelSt}>NOME</label><input style={inputSt} value={draftEmpresa.nome} onChange={e=>setDraftEmpresa(d=>({...d,nome:e.target.value}))}/></div>
          <div style={grid2}>
            <div><label style={labelSt}>TELEFONE</label><input style={inputSt} value={draftEmpresa.telefone} onChange={e=>setDraftEmpresa(d=>({...d,telefone:e.target.value}))}/></div>
            <div><label style={labelSt}>SITE</label><input style={inputSt} value={draftEmpresa.site} onChange={e=>setDraftEmpresa(d=>({...d,site:e.target.value}))}/></div>
          </div>
          <div><label style={labelSt}>E-MAIL</label><input style={inputSt} value={draftEmpresa.email} onChange={e=>setDraftEmpresa(d=>({...d,email:e.target.value}))}/></div>
        </div>
        {alteradoEmpresa && (
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button disabled={configGeralSaving} onClick={()=>onSalvarConfigGeral({...configGeral,empresa:draftEmpresa})} style={{background:'#059669',color:'#fff',border:'none',borderRadius:10,padding:'9px 16px',fontSize:12.5,fontWeight:700,cursor:'pointer',opacity:configGeralSaving?0.7:1}}>{configGeralSaving?'Salvando...':'💾 Salvar'}</button>
            <button disabled={configGeralSaving} onClick={()=>setDraftEmpresa(configGeral.empresa)} style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:10,padding:'9px 16px',fontSize:12.5,fontWeight:700,cursor:'pointer'}}>Cancelar</button>
          </div>
        )}
      </div>

      <div style={{ background:theme.card, borderRadius:14, border:`1px solid ${theme.cardBorder}`, padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8, marginBottom:4 }}>
          <SecTitle>📄 Templates de Relatório</SecTitle>
          <button onClick={()=>setEditor({ nome:'', cliente_nome:null, logo_url:'', whatsapp_config:{...DEFAULT_WHATSAPP_CONFIG}, pdf_config:JSON.parse(JSON.stringify(DEFAULT_PDF_CONFIG)) })}
            style={{ background:'#059669', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>+ Novo Template</button>
        </div>
        <div style={{ fontSize:11.5, color:theme.textFaint2, marginBottom:12 }}>Controle o que aparece no WhatsApp e no PDF, por cliente ou como padrão global.</div>
        {templatesLoading ? (
          <div style={{ fontSize:12.5, color:theme.textFaint2 }}>Carregando...</div>
        ) : templates.length===0 ? (
          <div style={{ fontSize:12.5, color:theme.textFaint2, background:theme.bg, borderRadius:10, padding:16, textAlign:'center' }}>Nenhum template criado ainda — os relatórios usam o formato padrão do sistema.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {templates.map(tpl => (
              <div key={tpl.id} style={{ display:'flex', flexDirection:isMobile?'column':'row', alignItems:isMobile?'flex-start':'center', justifyContent:'space-between', gap:8, background:theme.bg, borderRadius:12, padding:'12px 14px' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:theme.text, display:'flex', alignItems:'center', gap:6 }}>
                    {tpl.nome}
                    {tpl.is_default && <span style={{ fontSize:10, fontWeight:700, color:'#a67c00', background:'#fff3cd', borderRadius:20, padding:'2px 8px' }}>⭐ Padrão</span>}
                  </div>
                  <div style={{ fontSize:11.5, color:theme.textFaint2, marginTop:2 }}>{tpl.cliente_nome || 'Todos / Padrão'}</div>
                </div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {!tpl.is_default && <button onClick={()=>onDefinirPadrao(tpl)} style={{ background:'none', border:`1px solid ${theme.cardBorder2}`, borderRadius:8, padding:'6px 10px', fontSize:11.5, fontWeight:700, color:theme.textMuted, cursor:'pointer' }}>Definir como Padrão</button>}
                  <button onClick={()=>setEditor({ ...tpl, whatsapp_config:{...DEFAULT_WHATSAPP_CONFIG,...(tpl.whatsapp_config||{})}, pdf_config:{...JSON.parse(JSON.stringify(DEFAULT_PDF_CONFIG)),...(tpl.pdf_config||{}),secoes:{...DEFAULT_PDF_CONFIG.secoes,...(tpl.pdf_config?.secoes||{})}} })} style={{ background:'none', border:`1px solid ${theme.cardBorder2}`, borderRadius:8, padding:'6px 10px', fontSize:11.5, fontWeight:700, color:theme.textMuted, cursor:'pointer' }}>Editar</button>
                  <button onClick={()=>onExcluir(tpl)} style={{ background:'none', border:`1px solid ${theme.dangerText}`, borderRadius:8, padding:'6px 10px', fontSize:11.5, fontWeight:700, color:theme.dangerText, cursor:'pointer' }}>Excluir</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editor && (
        <TemplateEditorModal template={editor} onClose={()=>setEditor(null)} onSalvar={onSalvarTemplate} invClientes={invClientes} isMobile={isMobile} showToast={showToast}/>
      )}
    </div>
  )
}

function TemplateEditorModal({ template, onClose, onSalvar, invClientes, isMobile, showToast }) {
  const { theme } = useTheme()
  const [draft, setDraft] = useState(template)
  const [subTab, setSubTab] = useState('whatsapp')
  const [previewLoading, setPreviewLoading] = useState(false)
  const inputSt = { width:'100%', border:`1px solid ${theme.cardBorder2}`, borderRadius:10, padding:'8px 11px', fontSize:13, outline:'none', color:theme.text, boxSizing:'border-box' }
  const labelSt = { fontSize:10.5, fontWeight:700, color:theme.textFaint2, letterSpacing:.5, marginBottom:5, display:'block' }

  const setWa = (k,v) => setDraft(d=>({...d, whatsapp_config:{...d.whatsapp_config,[k]:v}}))
  const setSecao = (k,v) => setDraft(d=>({...d, pdf_config:{...d.pdf_config, secoes:{...d.pdf_config.secoes,[k]:v}}}))
  const moverOrdem = (idx, dir) => setDraft(d=>{
    const ordem=[...d.pdf_config.ordem]; const alvo=idx+dir
    if(alvo<0||alvo>=ordem.length) return d
    ;[ordem[idx],ordem[alvo]]=[ordem[alvo],ordem[idx]]
    return {...d, pdf_config:{...d.pdf_config, ordem}}
  })

  const previewTexto = montarTextoWhatsapp(MOCK_RELATORIO, draft.whatsapp_config)

  async function visualizarPdf() {
    setPreviewLoading(true)
    try {
      const doc = await gerarPDFCliente(MOCK_RELATORIO, { pdfConfig: draft.pdf_config })
      await salvarOuCompartilharPdf(doc, 'preview-template.pdf')
    } catch (e) { showToast('Erro ao gerar prévia: ' + e.message, 'error') } finally { setPreviewLoading(false) }
  }

  const WA_GRUPOS = [
    { titulo:'Cabeçalho & Identificação', itens:[['areaFazendaTalhao','Nome do Cliente/Fazenda/Talhão'],['dataHorario','Data e Horário da Operação'],['piloto','Nome do Piloto/Operador'],['statusOperacao','Status (Finalizado / Finalizado Parcial)'],['ordemServico','Número da OS'],['tipoServico','Tipo de Serviço / Qtde de Voos']] },
    { titulo:'Dados do Voo & Clima', itens:[['area','Área Aplicada (ha)'],['tempoVoo','Tempo Total de Voo'],['alturaVelocidade','Altura do Drone (m) e Velocidade (km/h)'],['faixaAplicacao','Faixa de Aplicação (m)'],['vazaoDetalhada','Vazão (L/ha)'],['tamanhoGota','Tamanho de Gota'],['climaBasico','Temperatura/Umidade/Vento'],['deltaT','Delta T']] },
    { titulo:'Insumos & Calda', itens:[['produtos','Produtos e Dosagens'],['volumeTotal','Volume Total Aplicado (L)']] },
    { titulo:'Extras', itens:[['observacoes','Observações/Alertas'],['observacoes2','Observações 2'],['linkPdf','Link para o PDF no app']] },
  ]

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(11,18,16,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:14 }} onClick={onClose}>
      <div style={{ background:theme.card, borderRadius:16, maxWidth:920, width:'100%', maxHeight:'92vh', overflowY:'auto', padding:isMobile?16:24 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:700, color:theme.text }}>{template.id?'Editar Template':'Novo Template'}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:theme.textMuted }}>×</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
          <div><label style={labelSt}>NOME DO TEMPLATE</label><input style={inputSt} value={draft.nome} onChange={e=>setDraft(d=>({...d,nome:e.target.value}))} placeholder="Ex: Fazenda São José"/></div>
          <div><label style={labelSt}>CLIENTE VINCULADO</label>
            <select style={inputSt} value={draft.cliente_nome||''} onChange={e=>setDraft(d=>({...d,cliente_nome:e.target.value||null}))}>
              <option value="">Todos / Padrão</option>
              {invClientes.filter(c=>c.ativo).map(c=><option key={c.id} value={c.nome}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>LOGO CUSTOMIZADO (OPCIONAL)</label>
            <LogoUploader path={draft.logo_url} onChange={p=>setDraft(d=>({...d,logo_url:p}))} pastaPrefixo={`logos/template-${template.id||'novo'}`}/>
          </div>
        </div>

        <div style={{display:'flex',background:theme.divider,borderRadius:12,padding:4,gap:4,marginBottom:16,maxWidth:280}}>
          {[{id:'whatsapp',label:'📱 WhatsApp'},{id:'pdf',label:'📄 PDF'}].map(t=>(
            <button key={t.id} style={{flex:1,background:subTab===t.id?'#fff':'transparent',color:subTab===t.id?theme.text:theme.textMuted,border:'none',borderRadius:9,padding:'8px 6px',fontSize:12.5,fontWeight:700,cursor:'pointer'}} onClick={()=>setSubTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {subTab==='whatsapp' && (
          <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:16 }}>
            <div>
              {WA_GRUPOS.map(g=>(
                <div key={g.titulo} style={{ marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:theme.textFaint2, letterSpacing:.5, marginBottom:2, textTransform:'uppercase' }}>{g.titulo}</div>
                  <div style={{ borderTop:`1px solid ${theme.divider}` }}>
                    {g.itens.map(([k,lbl])=>(
                      <div key={k} style={{ borderBottom:`1px solid ${theme.divider}` }}>
                        <ToggleRow label={lbl} checked={!!draft.whatsapp_config[k]} onChange={v=>setWa(k,v)}/>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:theme.textFaint2, letterSpacing:.5, marginBottom:8 }}>📱 PREVIEW AO VIVO</div>
              <div style={{ background:'#dcf0d8', borderRadius:14, padding:14, fontFamily:"'DM Sans',sans-serif" }}>
                <div style={{ background:'#fff', borderRadius:10, padding:12, fontSize:12, whiteSpace:'pre-wrap', color:'#111', maxHeight:420, overflowY:'auto', wordBreak:'break-word' }}>{previewTexto}</div>
              </div>
            </div>
          </div>
        )}

        {subTab==='pdf' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:16, marginBottom:16 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:theme.textFaint2, letterSpacing:.5, marginBottom:2 }}>SEÇÕES DO PDF</div>
                <div style={{ borderTop:`1px solid ${theme.divider}` }}>
                  {Object.keys(PDF_SECOES_LABELS).map(k=>(
                    <div key={k} style={{ borderBottom:`1px solid ${theme.divider}` }}>
                      <ToggleRow label={PDF_SECOES_LABELS[k]} checked={draft.pdf_config.secoes[k]!==false} onChange={v=>setSecao(k,v)}/>
                    </div>
                  ))}
                </div>
                {draft.pdf_config.secoes.grafico!==false && (
                  <div style={{ fontSize:10.5, color:theme.textFaint2, marginTop:6 }}>* O PDF ainda não tem um bloco de gráfico — esse toggle fica reservado pra quando existir.</div>
                )}
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:theme.textFaint2, letterSpacing:.5, marginBottom:2 }}>ORDEM DAS SEÇÕES</div>
                <div style={{ fontSize:10.5, color:theme.textFaint2, marginBottom:6 }}>Cabeçalho e Rodapé são fixos (topo/base) e não entram aqui. As demais seções usam layout de 2 colunas fixo — a ordem abaixo é salva, mas ainda não é aplicada visualmente no PDF (ver observação no editor).</div>
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  {draft.pdf_config.ordem.filter(k=>PDF_SECOES_REORDENAVEIS.includes(k)).map((k,i,arr)=>(
                    <div key={k} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:theme.bg, borderRadius:8, padding:'6px 10px' }}>
                      <span style={{ fontSize:12, color:theme.text }}>{PDF_SECOES_LABELS[k]||k}</span>
                      <span style={{ display:'flex', gap:4 }}>
                        <button disabled={i===0} onClick={()=>moverOrdem(i,-1)} style={{ background:'none', border:'none', cursor:i===0?'default':'pointer', opacity:i===0?0.3:1, fontSize:13 }}>▲</button>
                        <button disabled={i===arr.length-1} onClick={()=>moverOrdem(i,1)} style={{ background:'none', border:'none', cursor:i===arr.length-1?'default':'pointer', opacity:i===arr.length-1?0.3:1, fontSize:13 }}>▼</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:theme.textFaint2, letterSpacing:.5, marginBottom:8 }}>COR DE DESTAQUE</div>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <input type="color" value={draft.pdf_config.corDestaque||'#059669'} onChange={e=>setDraft(d=>({...d,pdf_config:{...d.pdf_config,corDestaque:e.target.value}}))} style={{ width:40, height:32, border:'none', borderRadius:6, cursor:'pointer', background:'none' }}/>
                {PDF_CORES_PRESET.map(p=>(
                  <button key={p.cor} title={p.label} onClick={()=>setDraft(d=>({...d,pdf_config:{...d.pdf_config,corDestaque:p.cor}}))}
                    style={{ width:26, height:26, borderRadius:'50%', background:p.cor, border: draft.pdf_config.corDestaque===p.cor?`2px solid ${theme.text}`:'2px solid transparent', cursor:'pointer' }}/>
                ))}
              </div>
            </div>

            <button onClick={visualizarPdf} disabled={previewLoading} style={{ background:theme.bg, color:theme.text, border:`1px solid ${theme.cardBorder2}`, borderRadius:10, padding:'9px 16px', fontSize:12.5, fontWeight:700, cursor:previewLoading?'default':'pointer' }}>{previewLoading?'Gerando...':'👁️ Visualizar Prévia do PDF'}</button>
          </div>
        )}

        <div style={{ display:'flex', gap:8, marginTop:20, paddingTop:16, borderTop:`1px solid ${theme.divider}` }}>
          <button disabled={!draft.nome} onClick={()=>onSalvar(draft)} style={{ background:'#059669', color:'#fff', border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:700, cursor:draft.nome?'pointer':'default', opacity:draft.nome?1:0.6 }}>💾 Salvar Template</button>
          <button onClick={onClose} style={{ background:theme.bg, color:theme.textMuted, border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:700, cursor:'pointer' }}>Cancelar</button>
        </div>
      </div>
    </div>
  )
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
function CalculadoraOrcamento({ calc, setCalc, isMobile, config }) {
  const { theme } = useTheme()
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

  const HORAS_POR_DIA = config?.horasPorDia || 8
  const MULT_DESLOCAMENTO = config?.multiplicadorDeslocamento || 2
  const MARGEM_MAX = (config?.margemMaxPct ?? 95) / 100
  const tempoEstimado = rendimento > 0 ? areaTotal / rendimento : 0
  const dias = tempoEstimado > 0 ? Math.max(1, Math.ceil(tempoEstimado / HORAS_POR_DIA)) : 0

  const kmIdaVolta = distancia * MULT_DESLOCAMENTO
  const custoBaterias = tempoEstimado * custoBateriaHora
  const custoDeslocamento = kmIdaVolta * combustivelKm
  const custoDiarias = diaria * dias
  const custoDesgaste = tempoEstimado * desgasteHora
  const custoTotal = custoBaterias + custoDeslocamento + custoDiarias + custoDesgaste
  const custoPorHectare = areaTotal > 0 ? custoTotal / areaTotal : 0
  const margemFrac = Math.min(MARGEM_MAX, Math.max(0, margem / 100))
  const precoSugeridoHa = margemFrac < 1 ? custoPorHectare / (1 - margemFrac) : 0
  const precoFinal = precoSugeridoHa * areaTotal
  const lucroEstimado = precoFinal - custoTotal

  const temDados = areaTotal > 0 && rendimento > 0
  const competitivo = precoMercado > 0 ? precoSugeridoHa <= precoMercado : null
  const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const inputSt = { width: '100%', border: `1px solid ${theme.cardBorder2}`, borderRadius: 10, padding: '9px 11px', fontSize: 13.5, outline: 'none', color: theme.text, background: theme.bg, boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" }
  const labelSt = { fontSize: 10.5, fontWeight: 700, color: theme.textFaint2, letterSpacing: .5, marginBottom: 5, display: 'block' }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background:theme.card, borderRadius: 16, border: `1px solid ${theme.cardBorder}`, padding: 20 }}>
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

        <div style={{ background:theme.card, borderRadius: 16, border: `1px solid ${theme.cardBorder}`, padding: 20 }}>
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
        <div style={{ background:theme.card, borderRadius: 16, border: `1px dashed ${theme.cardBorder}`, padding: 30, textAlign: 'center', color: '#a9beb1', fontSize: 13 }}>
          Preencha pelo menos Área Total e Rendimento Esperado pra ver o cálculo.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.3fr 1fr', gap: 16 }}>
          <div style={{ background:theme.card, borderRadius: 16, border: `1px solid ${theme.cardBorder}`, padding: 20 }}>
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
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${theme.divider}` }}>
                  <span style={{ color: theme.textMuted }}>{l}</span><span style={{ color: theme.text }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', fontWeight: 700 }}>
                <span style={{ color: theme.text }}>Custo Operacional Total</span><span style={{ color: theme.text }}>R$ {fmt(custoTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${theme.divider}` }}>
                <span style={{ color: theme.textMuted }}>💵 Custo / hectare</span><span style={{ color: theme.text }}>R$ {fmt(custoPorHectare)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${theme.divider}` }}>
                <span style={{ color: theme.textMuted }}>✅ Margem aplicada</span><span style={{ color: theme.text }}>{margem || 0}%</span>
              </div>
              {precoMercado > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${theme.divider}` }}>
                  <span style={{ color: theme.textMuted }}>🏷️ Preço mercado (ref.)</span><span style={{ color: theme.text }}>R$ {fmt(precoMercado)}/ha</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 2px', borderTop: '2px solid #059669', marginTop: 4 }}>
                <span style={{ fontWeight: 700, color: theme.text }}>💰 PREÇO SUGERIDO / ha</span>
                <span style={{ fontWeight: 800, color: '#059669', fontFamily: "'Syne',sans-serif" }}>R$ {fmt(precoSugeridoHa)}</span>
              </div>
            </div>
          </div>

          <div style={{ background:theme.card, borderRadius: 16, border: `1px solid ${theme.cardBorder}`, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.textFaint2, letterSpacing: 1 }}>PREÇO FINAL SUGERIDO</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: isMobile ? 30 : 36, fontWeight: 800, color: '#059669', margin: '8px 0' }}>R$ {fmt(precoFinal)}</div>
            <div style={{ fontSize: 12.5, color: theme.textMuted }}>R$ {fmt(precoSugeridoHa)} / hectare</div>
            <div style={{ fontSize: 11.5, color: theme.textFaint2, marginTop: 4 }}>Lucro estimado: R$ {fmt(lucroEstimado)} ({margem || 0}%)</div>
            {competitivo !== null && (
              <div style={{ marginTop: 14, fontSize: 11.5, fontWeight: 700, borderRadius: 20, padding: '6px 14px', background: competitivo ? theme.successBg : theme.warningBg, color: competitivo ? '#047857' : theme.warningText2 }}>
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
  fechado: { label:'Fechado', bg:'#e3f7ec', cor:'#059669' },
}
function normIncidenteStatus(s) { return s==='resolvido' ? 'fechado' : (s||'aberto') } // compat com status antigo, antes da migração

// Componente de módulo (não recriado a cada render do AdminPanel) — se fosse definido
// dentro da aba, qualquer re-render do painel (polling etc.) trocava a identidade da
// função e resetava o estado local (expandido/rascunho) do card no meio do uso.
function IncidenteCard({ inc, focoId, supabase, onToggleFoco, onSalvarDetalhes, onStatusChange, onExcluir, onFotoClick }) {
  const { theme } = useTheme()
  const [expandido, setExpandido] = useState(inc.id===focoId)
  const [resolucao, setResolucao] = useState(inc.resolucao||'')
  const [custo, setCusto] = useState(inc.custo!=null?String(inc.custo):'')
  const norm = normIncidenteStatus
  const ST = INCIDENTE_STATUS[norm(inc.status)] || INCIDENTE_STATUS.aberto
  return (
    <div id={`incidente-${inc.id}`} style={{background:theme.card,borderRadius:16,border:inc.id===focoId?'2px solid #059669':`1px solid ${theme.cardBorder2}`,padding:16,marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,marginBottom:8}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2,flexWrap:'wrap'}}>
            <span style={{fontSize:13,fontWeight:700}}>{INCIDENTE_TIPO_LABEL[inc.tipo]||inc.tipo}</span>
            <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:ST.bg,color:ST.cor}}>{ST.label}</span>
            {inc.custo!=null && parseFloat(inc.custo)>0 && (
              <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:theme.dangerBg,color:'#c0392b'}}>R$ {parseFloat(inc.custo).toFixed(2)}</span>
            )}
          </div>
          <div style={{fontSize:12,color:theme.textMuted}}>{inc.piloto_nome} · {new Date(inc.created_at).toLocaleString('pt-BR')}{inc.ordem_servico?` · OS ${inc.ordem_servico}`:''}</div>
        </div>
        <button style={{background:theme.bg,color:theme.textMuted,border:'none',borderRadius:16,padding:'5px 10px',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}
          onClick={()=>{ setExpandido(e=>!e); if(focoId===inc.id) onToggleFoco(null) }}>{expandido?'▲ Fechar':'Detalhes ▼'}</button>
      </div>
      <div style={{fontSize:13,color:theme.text,marginBottom:(inc.foto1_url||inc.foto2_url||inc.gps_lat)?10:0}}>{inc.descricao}</div>
      {(inc.foto1_url||inc.foto2_url) && (
        <div style={{display:'flex',gap:8,marginBottom:inc.gps_lat?10:0}}>
          {[inc.foto1_url,inc.foto2_url].filter(Boolean).map((path,i)=>(
            <FotoThumb key={i} supabase={supabase} path={path} bucket="relatorios" onClick={()=>onFotoClick(path)}/>
          ))}
        </div>
      )}
      {inc.gps_lat && inc.gps_lng && (
        <a href={`https://maps.google.com/?q=${inc.gps_lat},${inc.gps_lng}`} target="_blank" rel="noreferrer" style={{fontSize:12,color:'#059669',fontWeight:600,textDecoration:'none'}}>📍 Ver localização no Maps</a>
      )}
      {!expandido && inc.resolucao && (
        <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid #f0f5f2',fontSize:12,color:theme.textMuted}}><b style={{color:theme.textFaint2}}>Resolução:</b> {inc.resolucao}</div>
      )}
      {expandido && (
        <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid #f0f5f2'}}>
          <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>RESOLUÇÃO / ANDAMENTO</div>
          <textarea style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:8,fontSize:12,minHeight:60,marginBottom:10,boxSizing:'border-box',fontFamily:'inherit'}}
            value={resolucao} onChange={e=>setResolucao(e.target.value)} placeholder="O que foi feito / observações..." />
          <div style={{maxWidth:160,marginBottom:12}}>
            <div style={{fontSize:10,fontWeight:700,color:theme.textFaint2,marginBottom:4}}>CUSTO (R$)</div>
            <input type="number" step="0.01" style={{width:'100%',border:`1px solid ${theme.cardBorder2}`,borderRadius:8,padding:8,fontSize:12,boxSizing:'border-box'}}
              value={custo} onChange={e=>setCusto(e.target.value)} placeholder="0,00" />
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button style={{background:'#059669',color:'#fff',border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}
              onClick={()=>onSalvarDetalhes(inc,resolucao,custo)}>💾 Salvar</button>
            {norm(inc.status)==='aberto' && (
              <button style={{background:'#e6f1fb',color:'#2952a3',border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                onClick={()=>onStatusChange(inc,'em_tratativa')}>▶️ Iniciar Tratativa</button>
            )}
            {norm(inc.status)!=='fechado' && (
              <button style={{background:theme.successBg,color:'#059669',border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                onClick={()=>onStatusChange(inc,'fechado')}>✅ Fechar</button>
            )}
            {norm(inc.status)==='fechado' && (
              <button style={{background:theme.warningBg,color:theme.warningText2,border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}
                onClick={()=>onStatusChange(inc,'aberto')}>🔄 Reabrir</button>
            )}
            <button style={{background:theme.dangerBg,color:theme.dangerText,border:'none',borderRadius:16,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:'pointer',marginLeft:'auto'}}
              onClick={()=>onExcluir(inc)}>🗑️ Excluir</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FotoThumb({ supabase, path, bucket, onClick }) {
  const { theme } = useTheme()
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!path) return
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl)
    })
  }, [path, bucket, supabase])
  if (!url) return <div style={{ width:40, height:40, borderRadius:8, background:theme.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:theme.textFaint2 }}>⏳</div>
  return <img src={url} alt="foto" onClick={onClick} style={{ width:40, height:40, objectFit:'cover', borderRadius:8, display:'block', cursor:'pointer', border:`1px solid ${theme.cardBorder}` }} />
}

function FotoLightbox({ supabase, path, bucket, onClose }) {
  const { theme } = useTheme()
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
          <div style={{background:theme.card,borderRadius:12,padding:30,textAlign:'center',color:theme.textMuted}}>⏳ Carregando...</div>
        ) : (
          <>
            <img src={url} alt="foto" style={{width:'100%',maxHeight:'70vh',objectFit:'contain',borderRadius:8,display:'block',background:theme.card}} onClick={e=>e.stopPropagation()} />
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
  const { theme } = useTheme()
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!path) return
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!error && data?.signedUrl) setUrl(data.signedUrl)
      setLoading(false)
    })
  }, [path, bucket, supabase])
  if (loading) return <div style={{ fontSize:10, color:theme.textMuted, padding:'8px 0' }}>⏳ carregando...</div>
  if (!url) return <div style={{ fontSize:10, color:theme.dangerText, padding:'8px 0' }}>⚠️ Foto não encontrada</div>

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
          style={{ flex:1, background:theme.successBg, color:'#059669', borderRadius:5, padding:'3px', fontSize:10, textDecoration:'none', textAlign:'center', fontWeight:500 }}
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
          style={{ flex:1, background:theme.successBg, color:'#059669', borderRadius:6, padding:'6px', fontSize:11, textDecoration:'none', textAlign:'center', fontWeight:500 }}
          onClick={e => e.stopPropagation()}>
          🔍 Ver
        </a>
        <button style={{ flex:1, background:'#2f6fed', color:'#fff', border:'none', borderRadius:14, padding:'6px', fontSize:11, cursor:'pointer', fontWeight:500 }} onClick={baixar}>
          ⬇ Baixar
        </button>
      </div>
      <div style={{ fontSize:10, color:theme.textMuted, marginTop:4 }}>Clique na área acima para trocar</div>
    </div>
  )
}

// Mapa Leaflet com todos os pontos GPS dos voos
function MapaLeaflet({ relatorios, height = 400, onPontoClick }) {
  const { theme } = useTheme()
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
      const cor = r.status === 'sos' ? theme.dangerText : r.status === 'em_operacao' ? '#059669' : r.status === 'pausado' ? theme.warningText : '#2f6fed'
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
    <div style={{ height, background:theme.bg, borderRadius:12, border:`1px solid ${theme.cardBorder2}`, display:'flex', alignItems:'center', justifyContent:'center', color:theme.textMuted, flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:24 }}>🗺️</div>
      <div style={{ fontSize:13 }}>Carregando mapa...</div>
    </div>
  )

  return (
    <div style={{ background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}`, overflow:'hidden', marginBottom:16 }}>
      <iframe
        src={mapUrl}
        style={{ width:'100%', height, border:'none', display:'block' }}
        title="Mapa de Voos Orofly"
        sandbox="allow-scripts"
      />
      <div style={{ padding:'8px 14px', background:theme.bg, fontSize:11, color:theme.textMuted, display:'flex', gap:16, flexWrap:'wrap' }}>
        <span><span style={{ color:'#2f6fed' }}>●</span> Finalizado</span>
        <span><span style={{ color:'#059669' }}>●</span> Em voo</span>
        <span><span style={{ color:theme.warningText }}>●</span> Pausado</span>
        <span><span style={{ color:theme.dangerText }}>●</span> SOS</span>
        <span style={{ marginLeft:'auto' }}>{relatorios.filter(r=>r.gps_lat).length} voos plotados</span>
      </div>
    </div>
  )
}

// Mapa de Operações: onde os pilotos logaram (azul) e onde iniciaram voos (verde),
// cada ponto com um círculo de 10km — sobreposição indica área de operação concentrada
function MapaOperacoes({ logins, voos, height = 400 }) {
  const { theme } = useTheme()
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
      return `L.circleMarker([${v.gps_lat},${v.gps_lng}],{color:'#059669',fillColor:'#059669',fillOpacity:0.9,radius:7,weight:2}).bindPopup('${label}').addTo(map);
              L.circle([${v.gps_lat},${v.gps_lng}],{radius:10000,color:'#059669',weight:1,fillColor:'#059669',fillOpacity:0.05}).addTo(map)`
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
    <div style={{ textAlign:'center', color:theme.textMuted, padding:60, background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}` }}>
      <div style={{ fontSize:40, marginBottom:12 }}>📍</div>
      <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Nenhum dado de operação ainda</div>
      <div style={{ fontSize:13 }}>Aparece aqui assim que os pilotos fizerem login com GPS habilitado.</div>
    </div>
  )

  if (!mapUrl) return (
    <div style={{ height, background:theme.bg, borderRadius:12, border:`1px solid ${theme.cardBorder2}`, display:'flex', alignItems:'center', justifyContent:'center', color:theme.textMuted, flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:24 }}>🗺️</div>
      <div style={{ fontSize:13 }}>Carregando mapa...</div>
    </div>
  )

  return (
    <div style={{ background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}`, overflow:'hidden', marginBottom:16 }}>
      <iframe
        src={mapUrl}
        style={{ width:'100%', height, border:'none', display:'block' }}
        title="Mapa de Operações Orofly"
        sandbox="allow-scripts"
      />
      <div style={{ padding:'8px 14px', background:theme.bg, fontSize:11, color:theme.textMuted, display:'flex', gap:16, flexWrap:'wrap' }}>
        <span><span style={{ color:'#2f6fed' }}>●</span> Login ({pontosLogin.length})</span>
        <span><span style={{ color:'#059669' }}>●</span> Início de voo ({pontosVoo.length})</span>
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
  const { theme } = useTheme()
  const [mapUrl, setMapUrl] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const urlRef = useRef(null)
  const CORES = ['#e74c3c','#059669','#2f6fed',theme.warningText,'#8e44ad','#16a085','#d35400','#2c3e50',theme.dangerText,'#27ae60']

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
    <div style={{ height, background:theme.bg, borderRadius:12, border:`1px solid ${theme.cardBorder2}`, display:'flex', alignItems:'center', justifyContent:'center', color:theme.textMuted, flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:24 }}>🛰️</div>
      <div style={{ fontSize:13 }}>Carregando trajetos KML...</div>
    </div>
  )

  if (!mapUrl) return (
    <div style={{ textAlign:'center', color:theme.textMuted, padding:40, background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}` }}>
      Nenhum trajeto válido nos KMLs selecionados.
    </div>
  )

  return (
    <div style={{ background:theme.card, borderRadius:12, border:`1px solid ${theme.cardBorder2}`, overflow:'hidden', marginBottom:16 }}>
      <iframe src={mapUrl} style={{ width:'100%', height, border:'none', display:'block' }} title="Trajetos KML Orofly" sandbox="allow-scripts" />
      <div style={{ padding:'10px 14px', background:theme.bg, fontSize:11, color:theme.textMuted, display:'flex', gap:12, flexWrap:'wrap' }}>
        {voos.map((v, i) => (
          <span key={v.id}><span style={{ color: CORES[i % CORES.length] }}>●</span> {v.cliente||'—'} — {v.piloto_nome} ({new Date(v.created_at).toLocaleDateString('pt-BR')})</span>
        ))}
      </div>
    </div>
  )
}

function KmlViewer({ rel, supabase }) {
  const { theme } = useTheme()
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
      <div style={{ fontSize:10, fontWeight:700, color:'#059669', letterSpacing:1, marginBottom:8, fontFamily:"'Syne',sans-serif" }}>ARQUIVOS KML</div>
      {nomes.map((nome, i) => (
        <div key={i} style={{ background:theme.card, border:`1px solid ${theme.cardBorder2}`, borderRadius:10, overflow:'hidden', marginBottom:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', cursor:'pointer', background: expanded&&i===0?theme.successBg:'#fff' }}
            onClick={() => i === 0 && carregarKml()}>
            <span>📄</span>
            <span style={{ flex:1, fontSize:13, fontWeight:500, color:theme.text }}>{nome}</span>
            {loading && i===0 && <span style={{ fontSize:11, color:theme.textMuted }}>⏳ carregando...</span>}
            {i===0 && !loading && <span style={{ fontSize:11, color:'#059669' }}>{expanded ? '▲ Fechar' : '▼ Ver trajeto'}</span>}
          </div>

          {expanded && i === 0 && kmlData && (
            <div style={{ borderTop:`1px solid ${theme.successBg}` }}>
              {/* META */}
              {kmlData.meta && Object.values(kmlData.meta).some(Boolean) && (
                <div style={{ display:'flex', gap:14, flexWrap:'wrap', padding:'10px 14px', background:'#f7fbf8', borderBottom:`1px solid ${theme.divider}` }}>
                  {[['✈️ Aeronave', kmlData.meta.aeronave], ['👤 Piloto', kmlData.meta.piloto], ['📐 Área', kmlData.meta.area ? parseFloat(kmlData.meta.area).toFixed(2)+' ha' : null], ['⚡', kmlData.meta.velocidade ? kmlData.meta.velocidade+' m/s' : null], ['↕️', kmlData.meta.altura ? kmlData.meta.altura+' m' : null], ['↔️', kmlData.meta.espacamento ? kmlData.meta.espacamento+' m' : null]].filter(([,v])=>v).map(([l,v])=>(
                    <span key={l} style={{ fontSize:12 }}><span style={{ color:theme.textMuted }}>{l} </span><strong>{v}</strong></span>
                  ))}
                  <span style={{ fontSize:12, color:theme.textMuted }}>📍 {kmlData.coords.length} pontos</span>
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
                    <button style={{ background:'#059669', color:'#fff', border:'none', borderRadius:16, padding:'8px 16px', fontSize:13, cursor:'pointer', fontWeight:600, marginRight:8 }}
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
  const { theme } = useTheme()
  const valid = items.filter(([,v]) => v && v !== '—')
  if (!valid.length) return null
  return (
    <div style={{ minWidth:120, flex:1 }}>
      <div style={{ fontSize:10, fontWeight:700, color:'#059669', letterSpacing:1, marginBottom:5, fontFamily:"'Syne',sans-serif" }}>{title.toUpperCase()}</div>
      {valid.map(([l,v]) => (
        <div key={l} style={{ display:'flex', gap:4, marginBottom:3, fontSize:11 }}>
          <span style={{ color:theme.textMuted, minWidth:65, flexShrink:0 }}>{l}:</span>
          <span style={{ color:theme.text, wordBreak:'break-word' }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// Tokens sóbrios (estilo Vercel/Linear/Stripe) usados na tabela de Relatórios e em outras
// telas densas do Admin — bordas finas, cinza-slate neutro, sem preenchimento colorido pesado.
const sG = {
  td: { padding:'12px 16px', fontSize:13, color:'#0F172A', borderBottom:'1px solid #E2E8F0', verticalAlign:'middle' },
  iconBtn: { background:'none', border:'none', cursor:'pointer', fontSize:15, padding:'3px 4px', borderRadius:6 },
  label: { fontSize:11, fontWeight:600, color:'#64748B', letterSpacing:.3, marginBottom:4, fontFamily:"'DM Sans',sans-serif" },
  input: { width:'100%', border:'1px solid #CBD5E1', borderRadius:6, padding:'9px 11px', fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:'none', color:'#0F172A', background:'#fff', appearance:'none', WebkitAppearance:'none' },
  btn: { background:'#059669', color:'#fff', border:'none', borderRadius:6, padding:'10px', fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:600, cursor:'pointer', width:'100%' },
  fi: { border:'1px solid #CBD5E1', borderRadius:6, padding:'7px 10px', fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:'none', color:'#0F172A', background:'#fff', minWidth:110, appearance:'none' },
  actBtn: (cor) => ({ color:cor||'#0F172A', background:'#fff', border:'1px solid #CBD5E1', borderRadius:6, padding:'6px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }),
}

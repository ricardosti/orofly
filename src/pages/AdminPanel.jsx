import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { gerarPDFRelatorio, gerarPDFCliente, gerarWordCliente } from '../lib/pdf'
import { registrarPush, salvarSubscription } from '../lib/notifications'

const STATUS_LABEL = { rascunho:'Rascunho', em_operacao:'Em operação', pausado:'Pausado', finalizado:'Finalizado', sos:'🆘 SOS', sos_resolvido:'✅ SOS Resolvido' }
const STATUS_COLOR = { rascunho:'#6b8070', em_operacao:'#1a7a4a', pausado:'#e8a020', finalizado:'#185fa5', sos:'#c0392b', sos_resolvido:'#6b8070' }
const STATUS_BG    = { rascunho:'#f4f8f5', em_operacao:'#e8f5ee', pausado:'#fdf3e0', finalizado:'#e6f1fb', sos:'#fdeaea', sos_resolvido:'#f4f8f5' }
const COND_KEYS    = ['faixa','vazao','vento','umidade','temperatura','delta_t']
const COND_LABELS  = ['Faixa','Vazão','Vento','Umidade','Temperatura','Delta T']
const PRODUTOS_LIST = ['Triclon','Triomax','Moddus','Suiker','Roundup','Essenza','Spotlight','Agile','Volt','Mag8','Outros']

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

export default function AdminPanel({ onSwitchMode }) {
  const { profile, signOut } = useAuth()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('relatorios')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [relatorios, setRelatorios] = useState([])
  const [pilotos, setPilotos] = useState([])
  const [voosPorPiloto, setVoosPorPiloto] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [editModal, setEditModal] = useState(null)
  const [editFotoMapa, setEditFotoMapa] = useState(null)
  const [editFotoMapaFile, setEditFotoMapaFile] = useState(null)
  const [editObsFotos, setEditObsFotos] = useState([null,null,null])
  const [editObsFotoFiles, setEditObsFotoFiles] = useState([null,null,null])
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [filters, setFilters] = useState({ cliente:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })
  const [newUser, setNewUser] = useState({ nome:'', email:'', senha:'', role:'piloto' })
  const [criandoUser, setCriandoUser] = useState(false)
  const [droneHorasLimite, setDroneHorasLimite] = useState(() => {
    try { return JSON.parse(localStorage.getItem('orofly_drone_horas')||'{}') } catch { return {} }
  })
  const [pushAtivo, setPushAtivo] = useState(false)

  // Inventário
  const [invDrones, setInvDrones] = useState([])
  const [invProdutos, setInvProdutos] = useState([])
  const [invTab, setInvTab] = useState('drones')
  const [droneModal, setDroneModal] = useState(null) // null | 'novo' | {objeto}
  const [produtoModal, setProdutoModal] = useState(null)
  const [droneForm, setDroneForm] = useState({})
  const [produtoForm, setProdutoForm] = useState({})
  const [invSaving, setInvSaving] = useState(false)

  function initDroneForm(d={}) {
    return { nome:d.nome||'', modelo:d.modelo||'', serial:d.serial||'', fabricante:d.fabricante||'DJI', ano_aquisicao:d.ano_aquisicao||'', horas_limite:d.horas_limite||100, ativo:d.ativo!==false, obs:d.obs||'' }
  }
  function initProdutoForm(p={}) {
    return { nome:p.nome||'', fabricante:p.fabricante||'', unidade:p.unidade||'L', estoque_atual:p.estoque_atual||0, estoque_minimo:p.estoque_minimo||0, validade:p.validade||'', registro_mapa:p.registro_mapa||'', ativo:p.ativo!==false, obs:p.obs||'' }
  }

  async function fetchInventario() {
    try {
      const [{ data: drones, error: e1 }, { data: produtos, error: e2 }] = await Promise.all([
        supabase.from('drones').select('*').order('nome'),
        supabase.from('produtos').select('*').order('nome'),
      ])
      if (!e1 && drones) setInvDrones(drones)
      if (!e2 && produtos) setInvProdutos(produtos)
    } catch(e) {
      console.warn('Tabelas de inventário não encontradas. Execute o SQL no Supabase.')
    }
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
      const payload = { ...produtoForm, estoque_atual: parseFloat(produtoForm.estoque_atual)||0, estoque_minimo: parseFloat(produtoForm.estoque_minimo)||0, validade: produtoForm.validade||null }
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
    const [{ data: rels }, usersRes] = await Promise.all([
      supabase.from('relatorios').select('*').order('created_at', { ascending: false }),
      fetch('/api/list-users')
    ])
    const rs = rels || []
    setRelatorios(rs)
    if (usersRes.ok) { const d = await usersRes.json(); setPilotos(d.users || []) }
    const counts = {}
    rs.forEach(r => { counts[r.piloto_id] = (counts[r.piloto_id] || 0) + 1 })
    setVoosPorPiloto(counts)
    setLoading(false)
  }

  const filtered = relatorios.filter(r => {
    if (filters.cliente && !r.cliente?.toLowerCase().includes(filters.cliente.toLowerCase())) return false
    if (filters.piloto && !r.piloto_nome?.toLowerCase().includes(filters.piloto.toLowerCase())) return false
    if (filters.drone && !r.drone?.toLowerCase().includes(filters.drone.toLowerCase())) return false
    if (filters.status && r.status !== filters.status) return false
    if (filters.dataIni && new Date(r.created_at) < new Date(filters.dataIni)) return false
    if (filters.dataFim && new Date(r.created_at) > new Date(filters.dataFim + 'T23:59:59')) return false
    return true
  })

  const sosAtivos = relatorios.filter(r => r.status === 'sos')

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

  async function resolverSOS(rel) {
    const obs_resolucao = `🆘 SOS acionado em ${new Date(rel.created_at).toLocaleString('pt-BR')} | ✅ Resolvido por ${profile.nome} em ${new Date().toLocaleString('pt-BR')}`
    await supabase.from('relatorios').update({
      status: 'sos_resolvido',
      obs2: obs_resolucao
    }).eq('id', rel.id)
    showToast('✅ SOS marcado como resolvido')
    fetchAll()
  }

  async function toggleAtivo(piloto) {
    try {
      const res = await fetch('/api/toggle-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: piloto.id, ativo: !piloto.ativo }) })
      const d = await res.json(); if (d.error) throw new Error(d.error)
      showToast(piloto.ativo ? '⛔ Desativado' : '✅ Ativado'); fetchAll()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  async function toggleRole(piloto) {
    const novoRole = piloto.role === 'admin' ? 'piloto' : 'admin'
    try {
      const res = await fetch('/api/toggle-role', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: piloto.id, role: novoRole }) })
      const d = await res.json(); if (d.error) throw new Error(d.error)
      showToast(novoRole === 'admin' ? '⚙️ Virou Admin' : '🚁 Virou Piloto')
      fetchAll()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  async function gerarPDF(rel, localFotoMapa, localObsFotos, tipo='interno') {
    showToast('⏳ Gerando ' + (tipo==='word'?'Word':tipo==='cliente'?'PDF Cliente':'PDF técnico') + '...')
    try {
      const { data: relAtual } = await supabase.from('relatorios').select('*').eq('id', rel.id).single()
      const relFinal = relAtual || rel
      const opts = { supabase, localFotoMapa: localFotoMapa||null, localObsFotos: localObsFotos?.some(Boolean)?localObsFotos:null }
      const nomeBase = `${relFinal.cliente?.replace(/\s+/g,'-').toLowerCase()}-${new Date(relFinal.created_at).toLocaleDateString('pt-BR').replace(/\//g,'-')}`

      if (tipo === 'cliente') {
        // Busca trechos se for voo compartilhado
        let trechos = []
        if (relFinal.compartilhado) {
          const { data: t } = await supabase.from('relatorio_trechos').select('*').eq('relatorio_id', relFinal.id).order('created_at')
          if (t) trechos = t
        }
        const doc = await gerarPDFCliente(relFinal, { ...opts, trechos })
        doc.save(`relatorio-cliente-${nomeBase}.pdf`)
      } else if (tipo === 'word') {
        const blob = await gerarWordCliente(relFinal, opts)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `relatorio-cliente-${nomeBase}.doc`
        a.click(); URL.revokeObjectURL(a.href)
      } else {
        const doc = await gerarPDFRelatorio(relFinal, opts)
        doc.save(`relatorio-tecnico-${nomeBase}.pdf`)
      }
      showToast('✅ ' + (tipo==='word'?'Word':tipo==='cliente'?'PDF Cliente':'PDF técnico') + ' baixado!')
    } catch (e) { console.error(e); showToast('Erro ao gerar arquivo', 'error') }
  }

  async function criarUsuario(e) {
    e.preventDefault()
    if (!newUser.nome || !newUser.email || !newUser.senha) { showToast('⚠️ Preencha tudo', 'error'); return }
    setCriandoUser(true)
    try {
      const res = await fetch('/api/create-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newUser) })
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2da05e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <span style={{ fontFamily:"'Syne',sans-serif", fontSize: 19, fontWeight: 700, color: '#fff', letterSpacing: -0.5 }}>Orofly<span style={{ color: '#f0c040' }}>.</span></span>
          <span style={{ background: '#f0c040', color: '#111a14', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>ADMIN</span>
        </div>
        <div style={{ fontSize: 10, color: pushAtivo ? '#2da05e' : '#4a6e56', letterSpacing: 1 }}>
          {pushAtivo ? '🔔 Notificações ativas' : 'Painel de Administração'}
        </div>
      </div>

      {/* ALERTA SOS */}
      {sosAtivos.length > 0 && (
        <div style={{ margin: '0 12px 8px', background: '#c0392b', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }} onClick={() => setTab('mapa')}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>🆘 {sosAtivos.length} SOS ATIVO{sosAtivos.length > 1 ? 'S' : ''}</div>
          <div style={{ fontSize: 11, color: '#fcc', marginTop: 2 }}>Toque para ver no mapa</div>
        </div>
      )}

      <nav style={{ padding: '4px 12px', flex: 1 }}>
        {[
          ['relatorios', '📋', 'Relatórios', filtered.length],
          ['dashboard', '📊', 'Dashboard', ''],
          ['mapa', '🗺️', 'Mapa de Voos', relatorios.filter(r=>r.gps_lat).length],
          ['inventario', '📦', 'Inventário', invDrones.length + invProdutos.length],
          ['pilotos', '👥', 'Usuários', pilotos.length]
        ].map(([id, icon, lbl, cnt]) => (
          <button key={id} style={{ display:'flex', alignItems:'center', gap:8, width:'100%', background: tab===id?'#1a3a22':'transparent', border:'none', borderRadius:10, padding:'9px 12px', cursor:'pointer', color: tab===id?'#fff':'#8aad94', fontSize:13, fontFamily:"'DM Sans',sans-serif", fontWeight:500, marginBottom:3 }}
            onClick={() => { setTab(id); setSidebarOpen(false) }}>
            <span>{icon}</span>
            <span style={{ flex:1, textAlign:'left' }}>{lbl}</span>
            <span style={{ background: tab===id?'#f0c040':'#1e3828', color: tab===id?'#111a14':'#6b8070', fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:20 }}>{cnt}</span>
          </button>
        ))}
      </nav>

      <div style={{ padding:'10px 20px', borderTop:'1px solid #1e3828', borderBottom:'1px solid #1e3828', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4 }}>
        {[
          ['Em voo', relatorios.filter(r=>r.status==='em_operacao').length, '#2da05e'],
          ['Pausados', relatorios.filter(r=>r.status==='pausado').length, '#e8a020'],
          ['SOS', sosAtivos.length, '#c0392b']
        ].map(([lbl,val,cor]) => (
          <div key={lbl} style={{ textAlign:'center' }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:700, color:cor }}>{val}</div>
            <div style={{ fontSize:9, color:'#4a6e56' }}>{lbl}</div>
          </div>
        ))}
      </div>

      <div style={{ padding:'14px 20px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <div style={{ width:30, height:30, borderRadius:'50%', background:'#1a7a4a', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:13 }}>{profile?.nome?.[0]?.toUpperCase()}</div>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'#fff' }}>{profile?.nome}</div>
            <div style={{ fontSize:10, color:'#8aad94' }}>Admin</div>
          </div>
        </div>
        {onSwitchMode && (
          <button style={{ width:'100%', background:'#f0c040', border:'none', color:'#111a14', borderRadius:8, padding:'8px', fontSize:12, cursor:'pointer', fontFamily:"'Syne',sans-serif", fontWeight:700, marginBottom:8 }} onClick={onSwitchMode}>
            🚁 Modo Piloto
          </button>
        )}
        <button style={{ width:'100%', background:'transparent', border:'1px solid #1e3828', color:'#4a6e56', borderRadius:8, padding:'7px', fontSize:12, cursor:'pointer' }} onClick={signOut}>Sair</button>
        <div style={{ textAlign:'center', fontSize:10, color:'#2d4a38', marginTop:8, letterSpacing:1 }}>v3.8</div>
      </div>
    </>
  )

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'#f4f8f5', fontFamily:"'DM Sans',sans-serif" }}>

      {!isMobile && (
        <aside style={{ width:240, background:'#111a14', display:'flex', flexDirection:'column', position:'sticky', top:0, height:'100vh', flexShrink:0, overflowY:'auto' }}>
          <NavContent />
        </aside>
      )}

      {isMobile && sidebarOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex' }}>
          <div style={{ width:260, background:'#111a14', display:'flex', flexDirection:'column', overflowY:'auto' }}><NavContent /></div>
          <div style={{ flex:1, background:'rgba(0,0,0,.5)' }} onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>

        {isMobile && (
          <div style={{ background:'#111a14', padding:'11px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <button style={{ background:'transparent', border:'none', color:'#8aad94', fontSize:22, cursor:'pointer' }} onClick={() => setSidebarOpen(true)}>☰</button>
              <span style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, color:'#fff' }}>Orofly<span style={{ color:'#f0c040' }}>.</span></span>
              {sosAtivos.length > 0 && <span style={{ background:'#c0392b', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20 }}>🆘 {sosAtivos.length}</span>}
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {[['relatorios','📋'],['dashboard','📊'],['mapa','🗺️'],['inventario','📦'],['pilotos','👥']].map(([id,ic]) => (
                <button key={id} style={{ background: tab===id?'#1a3a22':'transparent', border:'none', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontSize:16, color: tab===id?'#fff':'#8aad94' }} onClick={() => setTab(id)}>{ic}</button>
              ))}
              {onSwitchMode && <button style={{ background:'#f0c040', border:'none', borderRadius:8, padding:'5px 10px', fontSize:11, cursor:'pointer', fontWeight:700 }} onClick={onSwitchMode}>🚁</button>}
              <button style={{ background:'transparent', border:'1px solid #2d4a38', color:'#8aad94', borderRadius:8, padding:'5px 10px', fontSize:11, cursor:'pointer' }} onClick={signOut}>Sair</button>
            </div>
          </div>
        )}

        <main style={{ flex:1, overflow:'auto', padding: isMobile?'12px':'28px 32px' }}>

          {/* ===== RELATÓRIOS ===== */}
          {tab === 'relatorios' && (
            <div>
              <div style={{ marginBottom:18 }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#111a14' }}>Relatórios de Voo</div>
                <div style={{ fontSize:12, color:'#6b8070', marginTop:2 }}>{filtered.length} de {relatorios.length}</div>
              </div>

              {sosAtivos.length > 0 && (
                <div style={{ background:'#fdeaea', border:'2px solid #c0392b', borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#c0392b', marginBottom:8 }}>🆘 SOS ATIVOS — {sosAtivos.length} alerta(s)</div>
                  {sosAtivos.map(r => (
                    <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingBottom:8, borderBottom:'1px solid #f5c6c6' }}>
                      <div>
                        <div style={{ fontSize:13, color:'#111a14', fontWeight:600 }}>{r.piloto_nome} — {r.cliente||'sem cliente'}</div>
                        <div style={{ fontSize:11, color:'#c0392b', marginTop:2 }}>{r.obs1}</div>
                        {r.gps_lat && <a href={`https://maps.google.com/?q=${r.gps_lat},${r.gps_lng}`} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'#c0392b', fontWeight:600 }}>📍 Ver localização</a>}
                      </div>
                      <button
                        style={{ background:'#1a7a4a', color:'#fff', border:'none', borderRadius:8, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', marginLeft:12 }}
                        onClick={() => resolverSOS(r)}
                      >
                        ✅ Resolver
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, background:'#fff', padding:12, borderRadius:12, border:'1px solid #d0e4d8', alignItems:'center' }}>
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
                  <span style={{ fontSize:11, color:'#6b8070', whiteSpace:'nowrap' }}>De:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataIni} onChange={e => setFilters(f => ({ ...f, dataIni: e.target.value }))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:'#6b8070', whiteSpace:'nowrap' }}>Até:</span>
                  <input type="date" style={{ ...sG.fi, minWidth:120 }} value={filters.dataFim} onChange={e => setFilters(f => ({ ...f, dataFim: e.target.value }))} />
                </div>
                {Object.values(filters).some(Boolean) && (
                  <button style={{ background:'none', border:'1px solid #e0b0a8', color:'#c0392b', borderRadius:8, padding:'7px 12px', fontSize:12, cursor:'pointer' }} onClick={() => setFilters({ cliente:'', piloto:'', drone:'', status:'', dataIni:'', dataFim:'' })}>✕ Limpar</button>
                )}
              </div>

              {loading ? <div style={{ textAlign:'center', color:'#6b8070', padding:40 }}>Carregando...</div>
              : filtered.length === 0 ? <div style={{ textAlign:'center', color:'#6b8070', padding:40 }}>Nenhum relatório</div>
              : isMobile ? (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {filtered.map(rel => {
                    const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
                    const isSel = selected?.id === rel.id
                    return (
                      <div key={rel.id} style={{ background:'#fff', borderRadius:12, border:`1px solid ${rel.status==='sos'?'#c0392b':isSel?'#1a7a4a':'#d0e4d8'}`, overflow:'hidden' }}>
                        <div style={{ padding:'13px 15px', cursor:'pointer' }} onClick={() => setSelected(isSel ? null : rel)}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                            <div style={{ fontWeight:600, fontSize:14, color:'#111a14' }}>{rel.cliente||'—'}</div>
                            <span style={{ background: STATUS_BG[rel.status]||'#f4f8f5', color: STATUS_COLOR[rel.status]||'#6b8070', fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span>
                          </div>
                          <div style={{ fontSize:12, color:'#6b8070' }}>{rel.fazenda} · {rel.piloto_nome}</div>
                          <div style={{ fontSize:11, color:'#aaa', marginTop:3 }}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}{tempo?` · ${tempo.total}`:''}</div>
                        </div>
                        {isSel && (
                          <div style={{ padding:'10px 15px', borderTop:'1px solid #f0f4f1', background:'#f9fbfa' }}>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom: (rel.kml_arquivos?.length > 0) ? 10 : 0 }}>
                              <button style={sG.actBtn('#185fa5')} onClick={e => { e.stopPropagation(); setEditModal({...rel}) }}>✏️ Editar</button>
                              <button style={sG.actBtn('#111a14')} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'interno') }}>📄 PDF</button>
                              <button style={sG.actBtn('#2da05e')} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'cliente') }}>🟢 Cliente</button>
                              <button style={sG.actBtn('#1a5fa5')} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'word') }}>📝 Word</button>
                              {rel.gps_lat && <a style={{ ...sG.actBtn('#1a7a4a'), textDecoration:'none' }} href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer">🗺️</a>}
                              <button style={sG.actBtn('#c0392b')} onClick={e => { e.stopPropagation(); setConfirmDelete(rel) }}>🗑️</button>
                            </div>
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
                <div style={{ background:'#fff', borderRadius:12, border:'1px solid #d0e4d8', overflow:'hidden' }}>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', minWidth:700 }}>
                      <thead>
                        <tr style={{ background:'#f4f8f5' }}>
                          {['Cliente','Fazenda','Piloto','Drone','Status','Data','Tempo','Ações'].map(h => (
                            <th key={h} style={{ padding:'11px 14px', textAlign:'left', fontSize:11, fontWeight:700, color:'#6b8070', letterSpacing:0.5, borderBottom:'1px solid #d0e4d8', whiteSpace:'nowrap', fontFamily:"'Syne',sans-serif" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((rel, i) => {
                          const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
                          const isSel = selected?.id === rel.id
                          return (
                            <React.Fragment key={rel.id}>
                              <tr style={{ background: rel.status==='sos'?'#fdeaea':isSel?'#e8f5ee':i%2===0?'#fff':'#f9fbfa', cursor:'pointer' }} onClick={() => setSelected(isSel ? null : rel)}>
                                <td style={{ ...sG.td, fontWeight:600 }}>{rel.cliente||'—'}</td>
                                <td style={sG.td}>{rel.fazenda||'—'}</td>
                                <td style={sG.td}>{rel.piloto_nome||'—'}</td>
                                <td style={sG.td}>{rel.drone||'—'}</td>
                                <td style={sG.td}><span style={{ background: STATUS_BG[rel.status]||'#f4f8f5', color: STATUS_COLOR[rel.status]||'#6b8070', fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span></td>
                                <td style={sG.td}>{new Date(rel.created_at).toLocaleDateString('pt-BR')}</td>
                                <td style={sG.td}>{tempo ? <span style={{ fontSize:12 }}>{tempo.total}{tempo.temPausa?<span style={{ color:'#6b8070' }}> /{tempo.efetivo}</span>:''}</span> : '—'}</td>
                                <td style={{ ...sG.td, whiteSpace:'nowrap' }}>
                                  <button title="Editar" style={sG.iconBtn} onClick={e => { e.stopPropagation(); setEditModal({...rel}) }}>✏️</button>
                                  <button title="PDF Técnico" style={sG.iconBtn} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'interno') }}>📄</button>
                                  <button title="PDF Cliente" style={{...sG.iconBtn,color:'#2da05e'}} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'cliente') }}>🟢</button>
                                  <button title="Word / Google Docs" style={{...sG.iconBtn,color:'#185fa5'}} onClick={e => { e.stopPropagation(); gerarPDF(rel,null,null,'word') }}>📝</button>
                                  {rel.gps_lat && <a title="Maps" style={{ ...sG.iconBtn, textDecoration:'none' }} href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>🗺️</a>}
                                  <button title="Deletar" style={{ ...sG.iconBtn, color:'#c0392b' }} onClick={e => { e.stopPropagation(); setConfirmDelete(rel) }}>🗑️</button>
                                </td>
                              </tr>
                              {isSel && (
                                <tr>
                                  <td colSpan={8} style={{ background:'#f0f8f4', borderBottom:'2px solid #d0e4d8', padding:0 }}>
                                    <div style={{ display:'flex', gap:20, padding:'16px 20px', flexWrap:'wrap' }}>
                                      <DetailCol title="Localização" items={[['Local',rel.localizacao],['GPS',rel.gps_lat?`${rel.gps_lat}, ${rel.gps_lng}`:'—']]} />
                                      <DetailCol title="Cond. Início" items={COND_KEYS.map((k,ii)=>[COND_LABELS[ii],rel[k+'_i']])} />
                                      <DetailCol title="Cond. Fim" items={COND_KEYS.map((k,ii)=>[COND_LABELS[ii],rel[k+'_f']])} />
                                      <DetailCol title="Horários" items={[['Início',fmt(rel.dt_inicio)],['Fim',fmt(rel.dt_fim)],...(tempo?[['Total',tempo.total],...(tempo.temPausa?[['Efetivo',tempo.efetivo]]:[])]:[] )]} />
                                      <DetailCol title="Outros" items={[...((rel.produtos||[]).map((p,ii)=>['Prod.'+(ii+1),p])),['Gota',rel.tamanho_gota],['Vel.',rel.velocidade_drone],['Obs 1',rel.obs1],['Obs 2',rel.obs2]]} />
                                    </div>
                                    {/* KML VIEWER */}
                                    {(rel.kml_arquivos?.length > 0 || rel.kml_paths?.length > 0) && (
                                      <div style={{ padding:'0 20px 16px' }}>
                                        <KmlViewer rel={rel} supabase={supabase} />
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
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
            // Calcular dados
            const finalizados = relatorios.filter(r => r.status === 'finalizado' && r.dt_inicio && r.dt_fim)

            // Área por cliente/mês
            const areaClienteMes = {}
            finalizados.forEach(r => {
              const mes = new Date(r.dt_inicio).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})
              const key = `${r.cliente||'Sem cliente'}|${mes}`
              areaClienteMes[key] = (areaClienteMes[key]||0) + parseFloat(r.area_ha||0)
            })

            // Últimos 6 meses
            const meses = []
            for (let i=5; i>=0; i--) {
              const d = new Date(); d.setMonth(d.getMonth()-i)
              meses.push(d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}))
            }

            // Top clientes por área
            const areaCliente = {}
            finalizados.forEach(r => {
              const c = r.cliente||'Sem cliente'
              areaCliente[c] = (areaCliente[c]||0) + parseFloat(r.area_ha||0)
            })
            const topClientes = Object.entries(areaCliente).sort((a,b)=>b[1]-a[1]).slice(0,6)
            const maxArea = topClientes[0]?.[1] || 1

            // Ranking pilotos
            const pilotoStats = {}
            finalizados.forEach(r => {
              const n = r.piloto_nome||'—'
              if (!pilotoStats[n]) pilotoStats[n] = { voos:0, area:0, minutos:0 }
              pilotoStats[n].voos++
              pilotoStats[n].area += parseFloat(r.area_ha||0)
              const mins = Math.round((new Date(r.dt_fim)-new Date(r.dt_inicio))/60000)
              pilotoStats[n].minutos += Math.max(0,mins)
            })
            const rankingPilotos = Object.entries(pilotoStats).sort((a,b)=>b[1].area-a[1].area).slice(0,8)

            // Horas por drone
            const droneStats = {}
            finalizados.forEach(r => {
              const d = r.drone||'—'
              if (!droneStats[d]) droneStats[d] = { voos:0, minutos:0 }
              droneStats[d].voos++
              const mins = Math.round((new Date(r.dt_fim)-new Date(r.dt_inicio))/60000)
              droneStats[d].minutos += Math.max(0,mins)
            })

            const fmtH = m => { const h=Math.floor(m/60),min=m%60; return h>0?`${h}h${String(min).padStart(2,'0')}m`:`${min}m` }

            return (
              <div>
                <div style={{marginBottom:18}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:'#111a14'}}>📊 Dashboard</div>
                  <div style={{fontSize:12,color:'#6b8070',marginTop:2}}>{finalizados.length} operações finalizadas</div>
                </div>

                {/* CARDS RESUMO */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:24}}>
                  {[
                    ['Total de Voos', relatorios.length, '🚁', '#1a7a4a'],
                    ['Área Total (ha)', finalizados.reduce((a,r)=>a+parseFloat(r.area_ha||0),0).toFixed(1), '📐', '#185fa5'],
                    ['Pilotos Ativos', Object.keys(pilotoStats).length, '👤', '#e8a020'],
                    ['Drones em Uso', Object.keys(droneStats).length, '✈️', '#8e44ad'],
                  ].map(([lbl,val,icon,cor])=>(
                    <div key={lbl} style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:'16px',textAlign:'center'}}>
                      <div style={{fontSize:24,marginBottom:4}}>{icon}</div>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?20:26,fontWeight:700,color:cor}}>{val}</div>
                      <div style={{fontSize:11,color:'#6b8070',marginTop:2}}>{lbl}</div>
                    </div>
                  ))}
                </div>

                {/* ÁREA POR CLIENTE */}
                <div style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:'20px',marginBottom:16}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:16}}>📐 Área Aplicada por Cliente (ha)</div>
                  {topClientes.length === 0 ? <div style={{color:'#6b8070',fontSize:13}}>Nenhum dado ainda</div> : (
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      {topClientes.map(([cliente,area])=>(
                        <div key={cliente}>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                            <span style={{fontWeight:500,color:'#111a14'}}>{cliente}</span>
                            <span style={{fontWeight:700,color:'#1a7a4a'}}>{area.toFixed(1)} ha</span>
                          </div>
                          <div style={{background:'#f4f8f5',borderRadius:20,height:10,overflow:'hidden'}}>
                            <div style={{background:'linear-gradient(90deg,#1a7a4a,#2da05e)',height:'100%',borderRadius:20,width:`${(area/maxArea)*100}%`,transition:'width .5s'}}/>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* RANKING PILOTOS */}
                <div style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:'20px',marginBottom:16}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,marginBottom:16}}>🏆 Ranking de Pilotos</div>
                  {rankingPilotos.length === 0 ? <div style={{color:'#6b8070',fontSize:13}}>Nenhum dado ainda</div> : (
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',minWidth:isMobile?0:400}}>
                        <thead>
                          <tr style={{background:'#f4f8f5'}}>
                            {['#','Piloto','Voos','Área (ha)','Horas'].map(h=>(
                              <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:11,fontWeight:700,color:'#6b8070',letterSpacing:.5,fontFamily:"'Syne',sans-serif"}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rankingPilotos.map(([nome,stats],i)=>(
                            <tr key={nome} style={{background:i%2===0?'#fff':'#f9fbfa'}}>
                              <td style={{padding:'9px 12px',fontSize:13}}>
                                <span style={{fontWeight:700,color:i===0?'#f0c040':i===1?'#aaa':i===2?'#cd7f32':'#6b8070'}}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}º`}</span>
                              </td>
                              <td style={{padding:'9px 12px',fontSize:13,fontWeight:500}}>{nome}</td>
                              <td style={{padding:'9px 12px',fontSize:13}}>{stats.voos}</td>
                              <td style={{padding:'9px 12px',fontSize:13,fontWeight:600,color:'#1a7a4a'}}>{stats.area.toFixed(1)}</td>
                              <td style={{padding:'9px 12px',fontSize:13}}>{fmtH(stats.minutos)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* DRONES + MANUTENÇÃO */}
                <div style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:'20px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700}}>✈️ Controle de Horas por Drone</div>
                    <div style={{fontSize:11,color:'#6b8070'}}>Clique nas horas para definir limite de manutenção</div>
                  </div>
                  {Object.keys(droneStats).length === 0 ? <div style={{color:'#6b8070',fontSize:13}}>Nenhum dado ainda</div> : (
                    <div style={{display:'flex',flexDirection:'column',gap:10}}>
                      {Object.entries(droneStats).sort((a,b)=>b[1].minutos-a[1].minutos).map(([drone,stats])=>{
                        const horas = stats.minutos/60
                        const limite = droneHorasLimite[drone] || 100
                        const pct = Math.min(100,(horas/limite)*100)
                        const alerta = pct >= 90
                        const aviso = pct >= 70 && pct < 90
                        const cor = alerta?'#c0392b':aviso?'#e8a020':'#1a7a4a'
                        return (
                          <div key={drone} style={{background:alerta?'#fdeaea':aviso?'#fdf3e0':'#f9fbfa',borderRadius:10,padding:'12px 14px',border:`1px solid ${alerta?'#f5c6c6':aviso?'#f5e0a0':'#d0e4d8'}`}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexWrap:'wrap',gap:6}}>
                              <div>
                                <span style={{fontWeight:600,fontSize:14,color:'#111a14'}}>{drone}</span>
                                {alerta && <span style={{marginLeft:8,background:'#c0392b',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ MANUTENÇÃO</span>}
                                {aviso && <span style={{marginLeft:8,background:'#e8a020',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚡ ATENÇÃO</span>}
                              </div>
                              <div style={{display:'flex',alignItems:'center',gap:8}}>
                                <span style={{fontSize:13,fontWeight:700,color:cor}}>{fmtH(stats.minutos)}</span>
                                <span style={{fontSize:11,color:'#6b8070'}}>/ </span>
                                <input
                                  type="number"
                                  value={limite}
                                  min={1}
                                  style={{width:60,border:'1px solid #d0e4d8',borderRadius:6,padding:'3px 6px',fontSize:12,textAlign:'center',outline:'none'}}
                                  onChange={e=>{
                                    const novo = {...droneHorasLimite,[drone]:parseInt(e.target.value)||100}
                                    setDroneHorasLimite(novo)
                                    localStorage.setItem('orofly_drone_horas',JSON.stringify(novo))
                                  }}
                                />
                                <span style={{fontSize:11,color:'#6b8070'}}>h limite</span>
                              </div>
                            </div>
                            <div style={{background:'#e0e0e0',borderRadius:20,height:8,overflow:'hidden'}}>
                              <div style={{background:`linear-gradient(90deg,${cor},${cor}cc)`,height:'100%',borderRadius:20,width:`${pct}%`,transition:'width .5s'}}/>
                            </div>
                            <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#6b8070',marginTop:4}}>
                              <span>{stats.voos} voos registrados</span>
                              <span>{pct.toFixed(0)}% do limite</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ===== MAPA ===== */}
          {tab === 'mapa' && (
            <div>
              <div style={{ marginBottom:18 }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#111a14' }}>🗺️ Mapa de Voos</div>
                <div style={{ fontSize:12, color:'#6b8070', marginTop:2 }}>{relatorios.filter(r=>r.gps_lat).length} voos com GPS</div>
              </div>

              {sosAtivos.length > 0 && (
                <div style={{ background:'#fdeaea', border:'2px solid #c0392b', borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#c0392b', marginBottom:8 }}>🆘 SOS ATIVOS</div>
                  {sosAtivos.map(r => (
                    <div key={r.id} style={{ fontSize:13, display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingBottom:8, borderBottom:'1px solid #f5c6c6' }}>
                      <div>
                        <div style={{ fontWeight:600 }}>{r.piloto_nome} — {r.obs1}</div>
                        {r.gps_lat && <a href={`https://maps.google.com/?q=${r.gps_lat},${r.gps_lng}`} target="_blank" rel="noreferrer" style={{ color:'#c0392b', fontWeight:600, fontSize:12 }}>📍 Abrir no Maps</a>}
                      </div>
                      <button style={{ background:'#1a7a4a', color:'#fff', border:'none', borderRadius:8, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', marginLeft:12 }} onClick={() => resolverSOS(r)}>✅ Resolver</button>
                    </div>
                  ))}
                </div>
              )}

              {relatorios.filter(r=>r.gps_lat).length > 0 ? (
                <>
                  {/* MAPA LEAFLET com todos os pontos */}
                  <MapaLeaflet relatorios={relatorios} height={isMobile?300:500} />

                  {/* Lista de voos com GPS */}
                  <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:16 }}>
                    {relatorios.filter(r => r.gps_lat).map(rel => (
                      <div key={rel.id} style={{ background:'#fff', borderRadius:12, border:`1px solid ${rel.status==='sos'?'#c0392b':'#d0e4d8'}`, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13, color:'#111a14' }}>{rel.cliente||'—'} — {rel.piloto_nome}</div>
                          <div style={{ fontSize:11, color:'#6b8070', marginTop:2 }}>{rel.gps_lat}, {rel.gps_lng} · {new Date(rel.created_at).toLocaleDateString('pt-BR')}</div>
                        </div>
                        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                          <span style={{ background: STATUS_BG[rel.status]||'#f4f8f5', color: STATUS_COLOR[rel.status]||'#6b8070', fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{STATUS_LABEL[rel.status]||rel.status}</span>
                          <a href={`https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`} target="_blank" rel="noreferrer" style={{ background:'#1a7a4a', color:'#fff', borderRadius:8, padding:'5px 10px', fontSize:12, textDecoration:'none', whiteSpace:'nowrap' }}>📍 Ver</a>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ textAlign:'center', color:'#6b8070', padding:60, background:'#fff', borderRadius:12, border:'1px solid #d0e4d8' }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🗺️</div>
                  <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Nenhum voo com GPS</div>
                  <div style={{ fontSize:13 }}>Os voos aparecerão aqui quando os pilotos capturarem o GPS durante a operação.</div>
                </div>
              )}
            </div>
          )}

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
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:isMobile?18:22,fontWeight:700,color:'#111a14'}}>📦 Inventário</div>
                    <div style={{fontSize:12,color:'#6b8070',marginTop:2}}>{invDrones.length} drones · {invProdutos.length} produtos</div>
                  </div>
                  <button style={{background:'#1a7a4a',color:'#fff',border:'none',borderRadius:10,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                    onClick={()=>{ if(invTab==='drones'){setDroneForm(initDroneForm());setDroneModal('novo')} else {setProdutoForm(initProdutoForm());setProdutoModal('novo')} }}>
                    + {invTab==='drones'?'Novo Drone':'Novo Produto'}
                  </button>
                </div>

                {/* Sub-tabs */}
                <div style={{display:'flex',gap:8,marginBottom:16}}>
                  {[['drones','🚁 Drones'],['produtos','🧪 Produtos']].map(([id,lbl])=>(
                    <button key={id} style={{background:invTab===id?'#1a7a4a':'#f4f8f5',color:invTab===id?'#fff':'#6b8070',border:'none',borderRadius:8,padding:'7px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}
                      onClick={()=>setInvTab(id)}>{lbl}</button>
                  ))}
                </div>

                {/* ── DRONES ── */}
                {invTab==='drones' && (
                  <div>
                    {invDrones.length===0 ? (
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:40,textAlign:'center',color:'#6b8070'}}>
                        Nenhum drone cadastrado ainda.<br/>Clique em "+ Novo Drone" para começar.
                      </div>
                    ) : (
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(300px,1fr))',gap:12}}>
                        {invDrones.map(d => {
                          const horasMin = horasDrone[d.nome?.trim().toLowerCase()] || 0
                          const limite = d.horas_limite || 100
                          const pct = Math.min(100,(horasMin/60/limite)*100)
                          const alerta = pct>=90, aviso = pct>=70&&pct<90
                          const cor = alerta?'#c0392b':aviso?'#e8a020':'#1a7a4a'
                          return (
                            <div key={d.id} style={{background:'#fff',borderRadius:12,border:`1px solid ${alerta?'#f5c6c6':aviso?'#f5e0a0':'#d0e4d8'}`,padding:16,position:'relative'}}>
                              {!d.ativo && <span style={{position:'absolute',top:12,right:12,background:'#fee',color:'#c0392b',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>INATIVO</span>}
                              {alerta && <span style={{position:'absolute',top:12,right:12,background:'#c0392b',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚠️ MANUTENÇÃO</span>}
                              {aviso && !alerta && <span style={{position:'absolute',top:12,right:12,background:'#e8a020',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>⚡ ATENÇÃO</span>}
                              <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:'#111a14',marginBottom:2}}>{d.nome}</div>
                              <div style={{fontSize:12,color:'#6b8070',marginBottom:10}}>{d.fabricante} {d.modelo} {d.serial?`· S/N: ${d.serial}`:''}</div>
                              {/* Barra horas */}
                              <div style={{marginBottom:10}}>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                                  <span style={{color:'#6b8070'}}>Horas voadas</span>
                                  <span style={{fontWeight:700,color:cor}}>{fmtH(horasMin)} / {limite}h</span>
                                </div>
                                <div style={{background:'#f0f4f1',borderRadius:20,height:7,overflow:'hidden'}}>
                                  <div style={{background:cor,height:'100%',borderRadius:20,width:`${pct}%`,transition:'width .5s'}}/>
                                </div>
                              </div>
                              {d.obs && <div style={{fontSize:11,color:'#6b8070',marginBottom:8,fontStyle:'italic'}}>{d.obs}</div>}
                              <div style={{display:'flex',gap:6}}>
                                <button style={{flex:1,background:'#f4f8f5',color:'#1a7a4a',border:'none',borderRadius:8,padding:'6px',fontSize:12,cursor:'pointer',fontWeight:600}}
                                  onClick={()=>{setDroneForm(initDroneForm(d));setDroneModal(d)}}>✏️ Editar</button>
                                <button style={{background:'#fdeaea',color:'#c0392b',border:'none',borderRadius:8,padding:'6px 10px',fontSize:12,cursor:'pointer'}}
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
                      <div style={{background:'#fff',borderRadius:12,border:'1px solid #d0e4d8',padding:40,textAlign:'center',color:'#6b8070'}}>
                        Nenhum produto cadastrado ainda.<br/>Clique em "+ Novo Produto" para começar.
                      </div>
                    ) : (
                      <div style={{overflowX:'auto'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',minWidth:560}}>
                          <thead>
                            <tr style={{background:'#f4f8f5'}}>
                              {['Produto','Fabricante','Estoque','Mínimo','Validade','Registro MAPA',''].map(h=>(
                                <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:11,fontWeight:700,color:'#6b8070',fontFamily:"'Syne',sans-serif"}}>{h}</th>
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
                                <tr key={p.id} style={{background:i%2===0?'#fff':'#f9fbfa'}}>
                                  <td style={{padding:'9px 12px'}}>
                                    <div style={{fontWeight:600,fontSize:13,color:p.ativo?'#111a14':'#aaa'}}>{p.nome}</div>
                                    {!p.ativo && <span style={{fontSize:10,color:'#c0392b'}}>inativo</span>}
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:'#6b8070'}}>{p.fabricante||'—'}</td>
                                  <td style={{padding:'9px 12px'}}>
                                    <span style={{fontWeight:700,color:baixo?'#c0392b':'#1a7a4a',fontSize:13}}>{p.estoque_atual} {p.unidade}</span>
                                    {baixo && <span style={{marginLeft:4,fontSize:10,color:'#c0392b'}}>⚠️ baixo</span>}
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:'#6b8070'}}>{p.estoque_minimo} {p.unidade}</td>
                                  <td style={{padding:'9px 12px'}}>
                                    <span style={{fontSize:12,color:vencido?'#c0392b':vencendo?'#e8a020':'#111a14',fontWeight:vencido||vencendo?700:400}}>
                                      {fmtData(p.validade)}
                                      {vencido && ' ⛔'}{vencendo && !vencido && ` (${dias}d)`}
                                    </span>
                                  </td>
                                  <td style={{padding:'9px 12px',fontSize:12,color:'#6b8070'}}>{p.registro_mapa||'—'}</td>
                                  <td style={{padding:'9px 12px',whiteSpace:'nowrap'}}>
                                    <button style={{background:'#f4f8f5',color:'#1a7a4a',border:'none',borderRadius:6,padding:'4px 8px',fontSize:11,cursor:'pointer',marginRight:4}}
                                      onClick={()=>{setProdutoForm(initProdutoForm(p));setProdutoModal(p)}}>✏️</button>
                                    <button style={{background:'#fdeaea',color:'#c0392b',border:'none',borderRadius:6,padding:'4px 8px',fontSize:11,cursor:'pointer'}}
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
                            <div style={{fontSize:10,fontWeight:700,color:'#6b8070',letterSpacing:.5,marginBottom:4}}>{lbl}</div>
                            <input style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                              type={type} placeholder={ph} value={droneForm[key]||''}
                              onChange={e=>setDroneForm(f=>({...f,[key]:e.target.value}))} />
                          </div>
                        ))}
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#6b8070',letterSpacing:.5,marginBottom:4}}>OBSERVAÇÕES</div>
                          <textarea style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',resize:'none',height:60,boxSizing:'border-box'}}
                            value={droneForm.obs||''} onChange={e=>setDroneForm(f=>({...f,obs:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setDroneForm(f=>({...f,ativo:!f.ativo}))}>
                          <div style={{width:36,height:20,borderRadius:10,background:droneForm.ativo?'#1a7a4a':'#d0e4d8',position:'relative',transition:'all .2s',flexShrink:0}}>
                            <div style={{width:14,height:14,borderRadius:7,background:'#fff',position:'absolute',top:3,left:droneForm.ativo?19:3,transition:'all .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:'#111a14'}}>Drone ativo</span>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:20}}>
                        <button style={{flex:1,background:'#f4f8f5',color:'#6b8070',border:'none',borderRadius:10,padding:12,fontSize:13,cursor:'pointer'}}
                          onClick={()=>setDroneModal(null)}>Cancelar</button>
                        <button style={{flex:2,background:'#1a7a4a',color:'#fff',border:'none',borderRadius:10,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}}
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
                            <div style={{fontSize:10,fontWeight:700,color:'#6b8070',letterSpacing:.5,marginBottom:4}}>{lbl}</div>
                            <input style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                              type={type} placeholder={ph} value={produtoForm[key]||''}
                              onChange={e=>setProdutoForm(f=>({...f,[key]:e.target.value}))} />
                          </div>
                        ))}
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:'#6b8070',letterSpacing:.5,marginBottom:4}}>ESTOQUE ATUAL</div>
                          <input style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="number" step="0.1" value={produtoForm.estoque_atual||0}
                            onChange={e=>setProdutoForm(f=>({...f,estoque_atual:e.target.value}))} />
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:'#6b8070',letterSpacing:.5,marginBottom:4}}>ESTOQUE MÍNIMO</div>
                          <input style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="number" step="0.1" value={produtoForm.estoque_minimo||0}
                            onChange={e=>setProdutoForm(f=>({...f,estoque_minimo:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#6b8070',letterSpacing:.5,marginBottom:4}}>VALIDADE</div>
                          <input style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}}
                            type="date" value={produtoForm.validade||''}
                            onChange={e=>setProdutoForm(f=>({...f,validade:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#6b8070',letterSpacing:.5,marginBottom:4}}>OBSERVAÇÕES</div>
                          <textarea style={{width:'100%',border:'1px solid #d0e4d8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',resize:'none',height:60,boxSizing:'border-box'}}
                            value={produtoForm.obs||''} onChange={e=>setProdutoForm(f=>({...f,obs:e.target.value}))} />
                        </div>
                        <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setProdutoForm(f=>({...f,ativo:!f.ativo}))}>
                          <div style={{width:36,height:20,borderRadius:10,background:produtoForm.ativo?'#1a7a4a':'#d0e4d8',position:'relative',transition:'all .2s',flexShrink:0}}>
                            <div style={{width:14,height:14,borderRadius:7,background:'#fff',position:'absolute',top:3,left:produtoForm.ativo?19:3,transition:'all .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:'#111a14'}}>Produto ativo</span>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:20}}>
                        <button style={{flex:1,background:'#f4f8f5',color:'#6b8070',border:'none',borderRadius:10,padding:12,fontSize:13,cursor:'pointer'}}
                          onClick={()=>setProdutoModal(null)}>Cancelar</button>
                        <button style={{flex:2,background:'#1a7a4a',color:'#fff',border:'none',borderRadius:10,padding:12,fontSize:13,fontWeight:600,cursor:'pointer',opacity:invSaving?.6:1}}
                          disabled={invSaving} onClick={salvarProduto}>{invSaving?'Salvando...':'💾 Salvar'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ===== PILOTOS ===== */}
          {tab === 'pilotos' && (
            <div>
              <div style={{ marginBottom:18 }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize: isMobile?18:22, fontWeight:700, color:'#111a14' }}>Gestão de Usuários</div>
                <div style={{ fontSize:12, color:'#6b8070', marginTop:2 }}>{pilotos.length} usuários</div>
              </div>
              <div style={{ display:'flex', gap:20, flexDirection: isMobile?'column':'row', alignItems:'flex-start' }}>
                <div style={{ background:'#fff', borderRadius:12, border:'1px solid #d0e4d8', padding:20, width: isMobile?'100%':280, flexShrink:0 }}>
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
                        <option value="admin">⚙️ Administrador</option>
                      </select>
                    </div>
                    <button type="submit" style={{ ...sG.btn, opacity: criandoUser?.6:1 }} disabled={criandoUser}>{criandoUser?'Criando...':'Criar usuário'}</button>
                  </form>
                </div>
                <div style={{ flex:1, overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', background:'#fff', borderRadius:12, border:'1px solid #d0e4d8', overflow:'hidden' }}>
                    <thead><tr style={{ background:'#f4f8f5' }}>{['Usuário','E-mail','Perfil','Voos','Status','Ações'].map(h => <th key={h} style={{ padding:'10px 13px', textAlign:'left', fontSize:11, fontWeight:700, color:'#6b8070', borderBottom:'1px solid #d0e4d8', fontFamily:"'Syne',sans-serif" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {pilotos.map((p, i) => (
                        <tr key={p.id} style={{ background: i%2===0?'#fff':'#f9fbfa', opacity: p.ativo?1:.5 }}>
                          <td style={sG.td}><div style={{ display:'flex', alignItems:'center', gap:8 }}><div style={{ width:30, height:30, borderRadius:'50%', background: p.role==='admin'?'#faeeda':'#e8f5ee', color: p.role==='admin'?'#854f0b':'#1a7a4a', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:12 }}>{p.nome?.[0]?.toUpperCase()||'?'}</div><span style={{ fontWeight:500 }}>{p.nome}</span></div></td>
                          <td style={{ ...sG.td, color:'#6b8070', fontSize:12 }}>{p.email}</td>
                          <td style={sG.td}><span style={{ background: p.role==='admin'?'#faeeda':'#e8f5ee', color: p.role==='admin'?'#854f0b':'#0f6e56', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{p.role==='admin'?'⚙️ Admin':'🚁 Piloto'}</span></td>
                          <td style={{ ...sG.td, fontFamily:"'Syne',sans-serif", fontWeight:700, color:'#1a7a4a', textAlign:'center' }}>{voosPorPiloto[p.id]||0}</td>
                          <td style={{ ...sG.td }}><span style={{ background: p.ativo?'#e8f5ee':'#fee', color: p.ativo?'#1a7a4a':'#c0392b', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>{p.ativo?'Ativo':'Inativo'}</span></td>
                          <td style={{ ...sG.td, whiteSpace:'nowrap' }}>
                            <button style={{ background: p.role==='admin'?'#faeeda':'#e8f5ee', color: p.role==='admin'?'#854f0b':'#0f6e56', border:'none', borderRadius:8, padding:'5px 10px', fontSize:12, cursor:'pointer', marginRight:4 }} onClick={() => toggleRole(p)}>
                              {p.role==='admin'?'→ Piloto':'→ Admin'}
                            </button>
                            <button style={{ background: p.ativo?'#fee':'#e8f5ee', color: p.ativo?'#c0392b':'#1a7a4a', border:'none', borderRadius:8, padding:'5px 10px', fontSize:12, cursor:'pointer' }} onClick={() => toggleAtivo(p)}>{p.ativo?'Desativar':'Ativar'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL EDITAR */}
      {editModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems: isMobile?'flex-end':'center', justifyContent:'center', padding: isMobile?0:24 }}>
          <div style={{ background:'#fff', borderRadius: isMobile?'20px 20px 0 0':16, width:'100%', maxWidth: isMobile?'100%':920, maxHeight: isMobile?'95vh':'90vh', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'15px 20px', borderBottom:'1px solid #f0f4f1', flexShrink:0 }}>
              <span style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700 }}>✏️ Editar Relatório</span>
              <button style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#6b8070' }} onClick={resetEdit}>✕</button>
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
                      <button style={{ background:'none', border:'none', color:'#c0392b', fontSize:11, cursor:'pointer', padding:'2px 6px' }}
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
                  <label style={{ display:'block', border:'1.5px dashed #d0e4d8', borderRadius:10, padding:10, textAlign:'center', cursor:'pointer', marginTop:4 }}>
                    <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setEditFotoMapa(ev.target.result); r.readAsDataURL(f); setEditFotoMapaFile(f) }} />
                    {editFotoMapa ? <img src={editFotoMapa} alt="mapa" style={{ width:'100%', maxHeight:120, objectFit:'cover', borderRadius:8 }} />
                      : editModal.foto_mapa_url ? <StoragePhoto supabase={supabase} path={editModal.foto_mapa_url} bucket="relatorios" />
                      : <div style={{ padding:'16px 0', fontSize:12, color:'#6b8070' }}>🗺️ Clique para adicionar</div>}
                  </label>
                </div>
                <div>
                  <div style={sG.label}>OBSERVAÇÕES</div>
                  <div style={{ display:'flex', gap:8, marginTop:4 }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
                        <label style={{ border:'1.5px dashed #d0e4d8', borderRadius:10, padding:8, textAlign:'center', cursor:'pointer', minHeight:70, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                          <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{const a=[...editObsFotos];a[i]=ev.target.result;setEditObsFotos(a)}; r.readAsDataURL(f); const a=[...editObsFotoFiles];a[i]=f;setEditObsFotoFiles(a) }} />
                          {editObsFotos[i] ? <img src={editObsFotos[i]} alt="" style={{ width:'100%', height:60, objectFit:'cover', borderRadius:6 }} />
                            : editModal.obs_fotos_urls?.[i] ? <StoragePhoto supabase={supabase} path={editModal.obs_fotos_urls[i]} bucket="relatorios" small />
                            : <span style={{ fontSize:18 }}>📷</span>}
                        </label>
                        {(editObsFotos[i] || editModal.obs_fotos_urls?.[i]) && (
                          <button style={{ background:'#fdeaea', color:'#c0392b', border:'none', borderRadius:6, padding:'3px', fontSize:10, cursor:'pointer', width:'100%' }}
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
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'#f4f8f5', borderRadius:8, padding:'8px 12px', marginBottom:6, border:'1px solid #d0e4d8' }}>
                        <span>📄</span>
                        <span style={{ flex:1, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nome}</span>
                        {editModal.kml_paths?.[i] && (
                          <button style={{ background:'#185fa5', color:'#fff', border:'none', borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer' }}
                            onClick={async () => {
                              const { data } = await supabase.storage.from('relatorios').createSignedUrl(editModal.kml_paths[i], 60)
                              if (data?.signedUrl) {
                                const r = await fetch(data.signedUrl); const b = await r.blob()
                                const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; a.click(); URL.revokeObjectURL(a.href)
                              }
                            }}>⬇</button>
                        )}
                        <button style={{ background:'#fdeaea', color:'#c0392b', border:'none', borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer' }}
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
                <label style={{ display:'flex', alignItems:'center', gap:8, border:'1.5px dashed #d0e4d8', borderRadius:10, padding:'10px 14px', cursor:'pointer', fontSize:13, color:'#6b8070' }}>
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
            <div style={{ borderTop:'1px solid #f0f4f1', flexShrink:0 }}>
              {/* Linha de exportação */}
              <div style={{ display:'flex', gap:6, padding:'10px 20px 0', flexWrap:'wrap' }}>
                <div style={{ fontSize:11, color:'#6b8070', width:'100%', marginBottom:4, fontWeight:600 }}>EXPORTAR:</div>
                {[
                  ['📄 PDF Técnico', '#111a14', 'interno'],
                  ['🟢 PDF Cliente', '#2da05e', 'cliente'],
                  ['📝 Word / Docs', '#185fa5', 'word'],
                ].map(([label, bg, tipo]) => (
                  <button key={tipo} style={{ background:bg, color:'#fff', border:'none', borderRadius:8, padding:'7px 14px', fontSize:12, cursor:'pointer', fontWeight:600, opacity:saving?.6:1 }}
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
                <button style={{ ...sG.btn, background:'#f4f8f5', color:'#6b8070', flex:1 }} onClick={resetEdit}>Cancelar</button>
                <button style={{ ...sG.btn, flex:2, opacity:saving?.6:1 }} disabled={saving} onClick={salvarEdicao}>{saving?'Salvando...':'💾 Salvar'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:380, padding:24 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, marginBottom:10 }}>🗑️ Confirmar exclusão</div>
            <p style={{ fontSize:14, marginBottom:6 }}>Deletar relatório de <strong>{confirmDelete.cliente}</strong>?</p>
            <p style={{ fontSize:12, color:'#c0392b', marginBottom:18 }}>Esta ação não pode ser desfeita.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...sG.btn, background:'#f4f8f5', color:'#6b8070', flex:1 }} onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button style={{ ...sG.btn, background:'#c0392b', flex:1 }} onClick={() => deletarRelatorio(confirmDelete.id)}>Deletar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background: toast.type==='error'?'#c0392b':'#111a14', color:'#fff', padding:'12px 24px', borderRadius:100, fontSize:13, fontWeight:500, zIndex:400, whiteSpace:'nowrap', borderBottom:'3px solid #f0c040', boxShadow:'0 4px 20px rgba(0,0,0,.2)' }}>{toast.msg}</div>}
    </div>
  )
}

function SecTitle({ children }) {
  return <div style={{ fontSize:10, fontWeight:700, color:'#1a7a4a', letterSpacing:1, marginBottom:8, paddingBottom:4, borderBottom:'1px solid #e8f5ee', fontFamily:"'Syne',sans-serif" }}>{children}</div>
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
  if (loading) return <div style={{ fontSize:10, color:'#6b8070', padding:'8px 0' }}>⏳ carregando...</div>
  if (!url) return <div style={{ fontSize:10, color:'#c0392b', padding:'8px 0' }}>⚠️ Foto não encontrada</div>

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
          style={{ flex:1, background:'#e8f5ee', color:'#1a7a4a', borderRadius:5, padding:'3px', fontSize:10, textDecoration:'none', textAlign:'center', fontWeight:500 }}
          onClick={e => e.stopPropagation()}>🔍</a>
        <button style={{ flex:1, background:'#185fa5', color:'#fff', border:'none', borderRadius:5, padding:'3px', fontSize:10, cursor:'pointer', fontWeight:500 }} onClick={baixar}>⬇</button>
      </div>
    </div>
  )

  return (
    <div>
      <img src={url} alt="foto" style={{ width:'100%', maxHeight:130, objectFit:'cover', borderRadius:8, display:'block' }} />
      <div style={{ display:'flex', gap:6, marginTop:6 }}>
        <a href={url} target="_blank" rel="noreferrer"
          style={{ flex:1, background:'#e8f5ee', color:'#1a7a4a', borderRadius:6, padding:'6px', fontSize:11, textDecoration:'none', textAlign:'center', fontWeight:500 }}
          onClick={e => e.stopPropagation()}>
          🔍 Ver
        </a>
        <button style={{ flex:1, background:'#185fa5', color:'#fff', border:'none', borderRadius:6, padding:'6px', fontSize:11, cursor:'pointer', fontWeight:500 }} onClick={baixar}>
          ⬇ Baixar
        </button>
      </div>
      <div style={{ fontSize:10, color:'#6b8070', marginTop:4 }}>Clique na área acima para trocar</div>
    </div>
  )
}

// Mapa Leaflet com todos os pontos GPS dos voos
function MapaLeaflet({ relatorios, height = 400 }) {
  const [mapUrl, setMapUrl] = useState(null)
  const urlRef = useRef(null)

  useEffect(() => {
    const pontos = relatorios.filter(r => r.gps_lat && r.gps_lng)
    if (pontos.length === 0) return

    const markers = pontos.map(r => {
      const cor = r.status === 'sos' ? '#c0392b' : r.status === 'em_operacao' ? '#1a7a4a' : r.status === 'pausado' ? '#e8a020' : '#185fa5'
      const label = `${(r.cliente||'—').replace(/'/g,"\\'")} — ${(r.piloto_nome||'').replace(/'/g,"\\'")} — ${new Date(r.created_at).toLocaleDateString('pt-BR')}`
      return `L.circleMarker([${r.gps_lat},${r.gps_lng}],{color:'${cor}',fillColor:'${cor}',fillOpacity:0.85,radius:9,weight:2}).bindPopup('${label}').addTo(map)`
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
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(map);
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
    <div style={{ height, background:'#f4f8f5', borderRadius:12, border:'1px solid #d0e4d8', display:'flex', alignItems:'center', justifyContent:'center', color:'#6b8070', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:24 }}>🗺️</div>
      <div style={{ fontSize:13 }}>Carregando mapa...</div>
    </div>
  )

  return (
    <div style={{ background:'#fff', borderRadius:12, border:'1px solid #d0e4d8', overflow:'hidden', marginBottom:16 }}>
      <iframe
        src={mapUrl}
        style={{ width:'100%', height, border:'none', display:'block' }}
        title="Mapa de Voos Orofly"
        sandbox="allow-scripts"
      />
      <div style={{ padding:'8px 14px', background:'#f4f8f5', fontSize:11, color:'#6b8070', display:'flex', gap:16, flexWrap:'wrap' }}>
        <span><span style={{ color:'#185fa5' }}>●</span> Finalizado</span>
        <span><span style={{ color:'#1a7a4a' }}>●</span> Em voo</span>
        <span><span style={{ color:'#e8a020' }}>●</span> Pausado</span>
        <span><span style={{ color:'#c0392b' }}>●</span> SOS</span>
        <span style={{ marginLeft:'auto' }}>{relatorios.filter(r=>r.gps_lat).length} voos plotados</span>
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
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
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
      <div style={{ fontSize:10, fontWeight:700, color:'#1a7a4a', letterSpacing:1, marginBottom:8, fontFamily:"'Syne',sans-serif" }}>ARQUIVOS KML</div>
      {nomes.map((nome, i) => (
        <div key={i} style={{ background:'#fff', border:'1px solid #d0e4d8', borderRadius:10, overflow:'hidden', marginBottom:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', cursor:'pointer', background: expanded&&i===0?'#e8f5ee':'#fff' }}
            onClick={() => i === 0 && carregarKml()}>
            <span>📄</span>
            <span style={{ flex:1, fontSize:13, fontWeight:500, color:'#111a14' }}>{nome}</span>
            {loading && i===0 && <span style={{ fontSize:11, color:'#6b8070' }}>⏳ carregando...</span>}
            {i===0 && !loading && <span style={{ fontSize:11, color:'#1a7a4a' }}>{expanded ? '▲ Fechar' : '▼ Ver trajeto'}</span>}
          </div>

          {expanded && i === 0 && kmlData && (
            <div style={{ borderTop:'1px solid #e8f5ee' }}>
              {/* META */}
              {kmlData.meta && Object.values(kmlData.meta).some(Boolean) && (
                <div style={{ display:'flex', gap:14, flexWrap:'wrap', padding:'10px 14px', background:'#f9fbfa', borderBottom:'1px solid #f0f4f1' }}>
                  {[['✈️ Aeronave', kmlData.meta.aeronave], ['👤 Piloto', kmlData.meta.piloto], ['📐 Área', kmlData.meta.area ? parseFloat(kmlData.meta.area).toFixed(2)+' ha' : null], ['⚡', kmlData.meta.velocidade ? kmlData.meta.velocidade+' m/s' : null], ['↕️', kmlData.meta.altura ? kmlData.meta.altura+' m' : null], ['↔️', kmlData.meta.espacamento ? kmlData.meta.espacamento+' m' : null]].filter(([,v])=>v).map(([l,v])=>(
                    <span key={l} style={{ fontSize:12 }}><span style={{ color:'#6b8070' }}>{l} </span><strong>{v}</strong></span>
                  ))}
                  <span style={{ fontSize:12, color:'#6b8070' }}>📍 {kmlData.coords.length} pontos</span>
                </div>
              )}

              {/* MAPA LEAFLET */}
              {showMap && mapUrl ? (
                <div style={{ position:'relative' }}>
                  <iframe src={mapUrl} style={{ width:'100%', height:320, border:'none', display:'block' }} title="Trajeto KML" />
                  <button style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,.6)', color:'#fff', border:'none', borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer' }}
                    onClick={() => { setShowMap(false); URL.revokeObjectURL(mapUrl); setMapUrl(null) }}>✕ Fechar mapa</button>
                </div>
              ) : (
                <div style={{ padding:'10px 14px' }}>
                  {kmlData.coords.length > 0 && (
                    <button style={{ background:'#1a7a4a', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontSize:13, cursor:'pointer', fontWeight:600, marginRight:8 }}
                      onClick={abrirMapaLeaflet}>
                      🗺️ Ver trajeto no mapa
                    </button>
                  )}
                  {kmlData.path && (
                    <button style={{ background:'#185fa5', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontSize:13, cursor:'pointer', fontWeight:600 }}
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
      <div style={{ fontSize:10, fontWeight:700, color:'#1a7a4a', letterSpacing:1, marginBottom:5, fontFamily:"'Syne',sans-serif" }}>{title.toUpperCase()}</div>
      {valid.map(([l,v]) => (
        <div key={l} style={{ display:'flex', gap:4, marginBottom:3, fontSize:11 }}>
          <span style={{ color:'#6b8070', minWidth:65, flexShrink:0 }}>{l}:</span>
          <span style={{ color:'#111a14', wordBreak:'break-word' }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

const sG = {
  td: { padding:'11px 14px', fontSize:13, color:'#111a14', borderBottom:'1px solid #f0f4f1', verticalAlign:'middle' },
  iconBtn: { background:'none', border:'none', cursor:'pointer', fontSize:15, padding:'3px 4px', borderRadius:6 },
  label: { fontSize:11, fontWeight:600, color:'#6b8070', letterSpacing:.5, marginBottom:4, fontFamily:"'Syne',sans-serif" },
  input: { width:'100%', border:'1px solid #d0e4d8', borderRadius:8, padding:'9px 11px', fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:'none', color:'#111a14', background:'#f4f8f5', appearance:'none', WebkitAppearance:'none' },
  btn: { background:'#1a7a4a', color:'#fff', border:'none', borderRadius:10, padding:'11px', fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:600, cursor:'pointer', width:'100%' },
  fi: { border:'1px solid #d0e4d8', borderRadius:8, padding:'7px 10px', fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:'none', color:'#111a14', background:'#f4f8f5', minWidth:110, appearance:'none' },
  actBtn: (bg) => ({ color:'#fff', background:bg, border:'none', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }),
}

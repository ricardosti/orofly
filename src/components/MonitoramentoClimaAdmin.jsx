import React, { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../lib/theme'
import FichaClimaEditor from './FichaClimaEditor'
import { fichaParaExportar, gerarPdfFichas, planilhaFichasBlob, limparFicha, MONITORAMENTO_PADRAO, climaSerie, fontesDaFicha, FONTES_AREA, FONTES_VOLUME } from '../lib/monitoramentoClima'
import { lerRegistroDrone, bateriasDoVoo, gruposPorTalhao, bateriasParaFicha, completarClima, areaDasBaterias } from '../lib/registroDrone'
import { lerRegistroKestrel, climaDaKestrel, semKestrel } from '../lib/registroKestrel'
import { salvarOuCompartilharPdf, salvarOuCompartilharBlob } from '../lib/nativeShare'

// Gestão → Monitoramento Climático (Beta). Junta as fichas lançadas pelos pilotos nos voos
// (relatorios.monitoramento_clima) com as fichas manuais do painel (fichas_clima), que podem ou
// não estar ligadas a um voo registrado. Exporta no layout da ficha da Bracell (PDF e Excel).

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const dataIso = iso => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : ''
const dataBR = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '—'
const primeiroDoMes = () => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), 1).toLocaleDateString('en-CA') }
const horaBR = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const haBR = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function MonitoramentoClimaAdmin({ relatorios, setRelatorios, fazendas, clientes, supabase, showToast, isMobile, config, abrirRelId }) {
  const { theme } = useTheme()
  const [manuais, setManuais] = useState([])
  // Vindo do resumo do voo em Relatórios ("Abrir no Monitoramento"): já abre a ficha daquele
  // voo, com o período cobrindo a data dele.
  const relInicial = abrirRelId ? relatorios.find(r => r.id === abrirRelId) : null
  const [de, setDe] = useState(() => {
    const p = primeiroDoMes(), d = relInicial ? dataIso(relInicial.dt_inicio || relInicial.created_at) : ''
    return d && d < p ? d : p
  })
  const [ate, setAte] = useState(new Date().toLocaleDateString('en-CA'))
  const [cliente, setCliente] = useState('')
  const [marcadas, setMarcadas] = useState({})
  const [editor, setEditor] = useState(() => relInicial ? { tipo: 'voo', relId: relInicial.id, dados: relInicial.monitoramento_clima || { voos: [] } } : null) // { tipo:'voo'|'manual', id?, relId?, cab:{...}, dados:{...} }
  const [salvando, setSalvando] = useState(false)
  // Planilha do drone (registro de voo da DJI) lida e esperando o admin escolher os talhões.
  const [importacao, setImportacao] = useState(null) // { relId, arquivo, grupos: [{ talhao, baterias, area, iniMs, fimMs, marcado }] }
  // Kestrel lida nesta edição: se a planilha do drone entrar depois, vale também pras baterias.
  const [kestrelSessao, setKestrelSessao] = useState(null) // { relId, k, arquivo }
  // Na hora de emitir: agrupar as leituras a cada X min (vazio = como foram lançadas) e quantas
  // colunas cada operação tem. Começa no padrão de Configurações do Sistema.
  const [agruparMin, setAgruparMin] = useState('')
  const [colunas, setColunas] = useState(config?.colunas || MONITORAMENTO_PADRAO.colunas)
  useEffect(() => { if (config?.colunas) setColunas(config.colunas) }, [config?.colunas])
  // Linha de área (ha) na ficha exportada: desmarcada por padrão, lembrada no aparelho.
  const [comArea, setComArea] = useState(() => { try { return localStorage.getItem('orofly_monit_com_area') === '1' } catch { return false } })
  // De onde vêm a área aplicada e o volume do cabeçalho: escolhido na hora de emitir, lembrado no
  // aparelho. Padrão: o digitado na ficha (o Rodolfo, 29/10/2026, quer preencher à mão).
  const lembrado = (k, pad) => { try { return localStorage.getItem(k) || pad } catch { return pad } }
  const [fonteArea, setFonteArea] = useState(() => lembrado('orofly_monit_fonte_area', 'manual'))
  const [fonteVolume, setFonteVolume] = useState(() => lembrado('orofly_monit_fonte_volume', 'manual'))
  const escolher = (set, k) => e => { set(e.target.value); try { localStorage.setItem(k, e.target.value) } catch {} }

  async function carregarManuais() {
    const { data, error } = await supabase.from('fichas_clima').select('*').order('data', { ascending: false })
    if (error) { showToast('Erro ao carregar as fichas: ' + error.message, 'error'); return }
    setManuais(data || [])
  }
  useEffect(() => { carregarManuais() }, []) // carrega uma vez ao abrir a tela

  const codigoDaFazenda = rel => fazendas.find(f => norm(f.cliente) === norm(rel.cliente) && norm(f.nome) === norm(rel.fazenda))?.id_fazenda || ''

  const lista = useMemo(() => {
    // Ficha com baterias do drone conta as baterias (são as colunas dela); sem, as leituras.
    const doVoo = relatorios.filter(r => r.monitoramento_clima && ((r.monitoramento_clima.voos || []).length || (r.monitoramento_clima.baterias || []).length))
      .map(r => ({ chave: 'v' + r.id, tipo: 'voo', rel: r, data: dataIso(r.dt_inicio || r.created_at), cliente: r.cliente, fazenda: r.fazenda, talhao: r.localizacao, piloto: r.piloto_nome,
        nVoos: (r.monitoramento_clima.baterias || []).length || (r.monitoramento_clima.voos || []).length, drone: (r.monitoramento_clima.baterias || []).length > 0 }))
    const doPainel = manuais.map(m => ({ chave: 'm' + m.id, tipo: 'manual', manual: m, data: m.data, cliente: m.cliente, fazenda: m.fazenda, talhao: m.talhao, piloto: m.piloto, nVoos: (m.dados?.voos || []).length }))
    return [...doVoo, ...doPainel]
      .filter(x => (!de || (x.data || '') >= de) && (!ate || (x.data || '') <= ate) && (!cliente || norm(x.cliente) === norm(cliente)))
      .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  }, [relatorios, manuais, de, ate, cliente])

  const voosDoPeriodo = useMemo(() => relatorios
    .filter(r => ['finalizado', 'pausado_dia', 'em_operacao', 'pausado'].includes(r.status) && !r.teste)
    .filter(r => { const d = dataIso(r.dt_inicio || r.created_at); return (!de || d >= de) && (!ate || d <= ate) && (!cliente || norm(r.cliente) === norm(cliente)) })
    .sort((a, b) => new Date(b.dt_inicio || b.created_at) - new Date(a.dt_inicio || a.created_at)), [relatorios, de, ate, cliente])

  function abrirNova() {
    setEditor({ tipo: 'manual', vincular: '', cab: { cliente: cliente || '', fazenda: '', fazenda_codigo: '', talhao: '', data: new Date().toLocaleDateString('en-CA'), piloto: '' }, dados: { voos: [] } })
  }
  function abrir(item) {
    if (item.tipo === 'voo') setEditor({ tipo: 'voo', relId: item.rel.id, dados: item.rel.monitoramento_clima || { voos: [] } })
    else { const m = item.manual; setEditor({ tipo: 'manual', id: m.id, vincular: '', cab: { cliente: m.cliente || '', fazenda: m.fazenda || '', fazenda_codigo: m.fazenda_codigo || '', talhao: m.talhao || '', data: m.data || '', piloto: m.piloto || '' }, dados: m.dados || { voos: [] } }) }
  }

  // Registro de voo da DJI (uma linha por bateria): fica só o que é do horário deste voo,
  // separado pelo talhão do drone, pra o admin desmarcar o que for de outro talhão.
  async function lerPlanilhaDrone(e, rel) {
    const arq = e.target.files?.[0]
    e.target.value = ''
    if (!arq || !rel) return
    try {
      const todas = lerRegistroDrone(new Uint8Array(await arq.arrayBuffer()))
      if (!todas) { showToast('Essa planilha não é o registro de voo da DJI (faltam as colunas "Flight time" e "Sprayed area").', 'error'); return }
      const doVoo = bateriasDoVoo(todas, rel)
      if (!doVoo.length) { showToast(`Nenhuma das ${todas.length} baterias da planilha é do horário deste voo.`, 'error'); return }
      setImportacao({ relId: rel.id, arquivo: arq.name, grupos: gruposPorTalhao(doVoo).map(g => ({ ...g, marcado: true })) })
    } catch (err) { showToast('Não deu pra ler a planilha: ' + err.message, 'error') }
  }

  // Cada bateria vira um voo da ficha, com o clima da leitura mais perto; a que não tem leitura
  // perto pega o do mesmo serviço pelo GPS do voo (dá até 7 dias pra trás).
  async function usarBaterias(rel) {
    const sel = importacao.grupos.filter(g => g.marcado).flatMap(g => g.baterias).sort((a, b) => a.iniMs - b.iniMs)
    if (!sel.length) return
    let lista = bateriasParaFicha(sel, editor.dados?.voos || [])
    const horas = (Date.now() - sel[0].iniMs) / 3600000 + 1
    if (lista.some(v => !v.temperatura) && rel.gps_lat && rel.gps_lng && horas <= 168) {
      lista = completarClima(lista, await climaSerie(rel.gps_lat, rel.gps_lng, horas) || [])
    }
    let dados = { ...(editor.dados || {}), baterias: lista, baterias_arquivo: importacao.arquivo }
    let aviso = ''
    if (kestrelSessao?.relId === rel.id) dados = comKestrel(dados, kestrelSessao.k, kestrelSessao.arquivo, rel) || dados
    else if (dados.kestrel) {
      // Kestrel de uma edição anterior: valia pras leituras (ou pras baterias trocadas agora).
      const { kestrel, ...resto } = dados
      dados = { ...resto, voos: semKestrel(resto.voos || []) }
      aviso = ' Importe o CSV da Kestrel de novo pra ele valer bateria por bateria.'
    }
    setEditor(ed => ({ ...ed, dados }))
    setImportacao(null)
    showToast(`🛩️ ${lista.length} baterias na ficha — falta salvar.${aviso}`)
  }

  // CSV da Kestrel (app Kestrel LiNK): o clima medido no talhão vai pra cada coluna da ficha —
  // as baterias, se a planilha do drone já entrou; senão, as leituras.
  function comKestrel(dados, k, arquivo, rel) {
    const alvo = (dados?.baterias || []).length ? 'baterias' : 'voos'
    const { colunas, usadas } = climaDaKestrel(dados?.[alvo] || [], k.medicoes, dataIso(rel.dt_inicio || rel.created_at))
    if (!usadas) return null
    return { ...dados, [alvo]: colunas, kestrel: { arquivo, aparelho: [k.aparelho.modelo ? `Kestrel ${k.aparelho.modelo}` : 'Kestrel', k.aparelho.nome].filter(Boolean).join(' · '),
      medicoes: k.medicoes.length, inicio: horaBR(k.medicoes[0].ms), fim: horaBR(k.medicoes[k.medicoes.length - 1].ms), alvo, colunas: usadas, de: colunas.length } }
  }
  async function lerKestrel(e, rel) {
    const arq = e.target.files?.[0]
    e.target.value = ''
    if (!arq || !rel) return
    try {
      const k = lerRegistroKestrel(await arq.text())
      if (!k) { showToast('Esse arquivo não é o CSV da Kestrel (falta a coluna "FORMATTED DATE_TIME"). Exporte a sessão pelo app Kestrel LiNK.', 'error'); return }
      if (!k.medicoes.length) { showToast('O CSV da Kestrel veio sem medições: exporte a sessão gravada durante o voo.', 'error'); return }
      const novo = comKestrel(editor.dados || {}, k, arq.name, rel)
      if (!novo) { showToast(`A Kestrel gravou das ${horaBR(k.medicoes[0].ms)} às ${horaBR(k.medicoes[k.medicoes.length - 1].ms)} — nenhum horário desta ficha cai nesse período.`, 'error'); return }
      setEditor(ed => ({ ...ed, dados: novo }))
      setKestrelSessao({ relId: rel.id, k, arquivo: arq.name })
      showToast(`🌡️ Clima da Kestrel em ${novo.kestrel.colunas} de ${novo.kestrel.de} colunas — falta salvar.`)
    } catch (err) { showToast('Não deu pra ler o arquivo: ' + err.message, 'error') }
  }
  // Cada coluna volta ao clima de antes da Kestrel (leitura automática ou serviço de clima).
  function tirarKestrel() {
    setEditor(ed => {
      const { kestrel, ...resto } = ed.dados || {}
      return { ...ed, dados: { ...resto, voos: semKestrel(resto.voos || []), baterias: semKestrel(resto.baterias || []) } }
    })
    setKestrelSessao(null)
  }

  async function salvar() {
    setSalvando(true)
    try {
      const relId = editor.tipo === 'voo' ? editor.relId : editor.vincular
      // Ficha de voo salva aqui fica marcada como editada pelo admin (selo na lista de
      // Relatórios: automático × editado × sem ficha).
      const limpa = limparFicha(editor.dados)
      const dados = limpa && relId ? { ...limpa, editado_admin: new Date().toISOString() } : limpa
      // Ficha nova ligada a um voo registrado vai pro próprio relatório (igual o piloto faz).
      if (relId) {
        const { error } = await supabase.from('relatorios').update({ monitoramento_clima: dados }).eq('id', relId)
        if (error) throw error
        setRelatorios(rs => rs.map(r => r.id === relId ? { ...r, monitoramento_clima: dados } : r))
      } else {
        const linha = { ...editor.cab, data: editor.cab.data || null, dados: dados || {}, updated_at: new Date().toISOString() }
        const { error } = editor.id
          ? await supabase.from('fichas_clima').update(linha).eq('id', editor.id)
          : await supabase.from('fichas_clima').insert(linha)
        if (error) throw error
        await carregarManuais()
      }
      showToast('✅ Ficha salva!')
      setEditor(null)
    } catch (e) { showToast('Erro ao salvar: ' + e.message, 'error') }
    setSalvando(false)
  }

  async function excluir(item) {
    if (!window.confirm(item.tipo === 'voo' ? 'Apagar a ficha deste voo? (o voo continua, só a ficha sai)' : 'Excluir esta ficha manual?')) return
    const { error } = item.tipo === 'voo'
      ? await supabase.from('relatorios').update({ monitoramento_clima: null }).eq('id', item.rel.id)
      : await supabase.from('fichas_clima').delete().eq('id', item.manual.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    if (item.tipo === 'voo') setRelatorios(rs => rs.map(r => r.id === item.rel.id ? { ...r, monitoramento_clima: null } : r))
    else await carregarManuais()
    showToast('🗑️ Ficha removida')
  }

  async function exportar(tipo) {
    const escolhidas = lista.some(x => marcadas[x.chave]) ? lista.filter(x => marcadas[x.chave]) : lista
    if (!escolhidas.length) { showToast('Nenhuma ficha no período', 'error'); return }
    // Ordem cronológica na ficha impressa (a lista na tela é da mais nova pra mais antiga).
    const intervaloMin = parseInt(agruparMin, 10) || 0
    const fichas = [...escolhidas].reverse().map(x => x.tipo === 'voo'
      ? fichaParaExportar({ rel: x.rel, fazendaCodigo: codigoDaFazenda(x.rel), intervaloMin, fonteArea, fonteVolume })
      : fichaParaExportar({ manual: x.manual, intervaloMin, fonteArea, fonteVolume }))
    const nome = `monitoramento-climatico-${de || 'inicio'}-a-${ate || 'hoje'}`
    try {
      if (tipo === 'pdf') await salvarOuCompartilharPdf(gerarPdfFichas(fichas, { colunas, comArea }), `${nome}.pdf`)
      else await salvarOuCompartilharBlob(planilhaFichasBlob(fichas, { colunas, comArea }), `${nome}.xlsx`)
      showToast('✅ Exportado!')
    } catch (e) { showToast('Erro ao exportar: ' + e.message, 'error') }
  }

  const card = { background: theme.card, borderRadius: 14, border: `1px solid ${theme.cardBorder2}`, padding: 16, marginBottom: 14 }
  const campo = { border: `1px solid ${theme.cardBorder2}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: theme.inputBg || '#fff', color: theme.text, outline: 'none', boxSizing: 'border-box' }
  const rot = { fontSize: 10, fontWeight: 700, color: theme.textMuted, letterSpacing: .5, marginBottom: 4 }
  const btn = (bg, cor = '#fff') => ({ background: bg, color: cor, border: 'none', borderRadius: 16, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' })
  const nMarcadas = lista.filter(x => marcadas[x.chave]).length
  const relDoEditor = editor?.tipo === 'voo' ? relatorios.find(r => r.id === editor.relId) : (editor?.vincular ? relatorios.find(r => r.id === editor.vincular) : null)

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: isMobile ? 18 : 22, fontWeight: 700, color: theme.text }}>🌡️ Monitoramento Climático <span style={{ fontSize: 12, background: theme.warningBg, color: theme.warningText2 || theme.warningText, padding: '2px 8px', borderRadius: 10, verticalAlign: 'middle' }}>BETA</span></div>
        <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 4 }}>Ficha de aplicação voo a voo (início, fim, altura, área, temperatura, umidade e vento). As leituras chegam sozinhas: o app guarda o clima durante o voo, e na Bracell o piloto também captura na hora. Aqui você corrige, junta e exporta.</div>
      </div>

      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div><div style={rot}>DE</div><input type="date" style={campo} value={de} onChange={e => setDe(e.target.value)} /></div>
        <div><div style={rot}>ATÉ</div><input type="date" style={campo} value={ate} onChange={e => setAte(e.target.value)} /></div>
        <div><div style={rot}>CLIENTE</div>
          <select style={campo} value={cliente} onChange={e => setCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientes.filter(c => c.ativo !== false).map(c => <option key={c.id || c.nome} value={c.nome}>{c.nome}</option>)}
          </select>
        </div>
        <div><div style={rot}>AGRUPAR A CADA (min)</div><input type="number" min={5} max={240} style={{ ...campo, width: 120 }} placeholder="como lançado" value={agruparMin} onChange={e => setAgruparMin(e.target.value)} title={`Ex.: ${config?.intervaloMin || 30} — junta as leituras em períodos desse tamanho (área somada, clima da última). Vazio: uma coluna por leitura.`} /></div>
        <div><div style={rot}>COLUNAS / OPERAÇÃO</div><input type="number" min={4} max={15} style={{ ...campo, width: 90 }} value={colunas} onChange={e => setColunas(e.target.value)} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.text, cursor: 'pointer', paddingBottom: 9 }}>
          <input type="checkbox" checked={comArea} onChange={e => { setComArea(e.target.checked); try { localStorage.setItem('orofly_monit_com_area', e.target.checked ? '1' : '0') } catch {} }} />
          Linha de área (ha)
        </label>
        <div><div style={rot}>ÁREA APLICADA (CABEÇALHO)</div>
          <select style={campo} value={fonteArea} onChange={escolher(setFonteArea, 'orofly_monit_fonte_area')}>
            {FONTES_AREA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div><div style={rot}>VOLUME CONSUMIDO</div>
          <select style={campo} value={fonteVolume} onChange={escolher(setFonteVolume, 'orofly_monit_fonte_volume')}>
            {FONTES_VOLUME.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <button style={btn('#059669')} onClick={abrirNova}>+ Nova ficha</button>
        <button style={btn('#111111')} onClick={() => exportar('pdf')}>⬇️ PDF{nMarcadas ? ` (${nMarcadas})` : ''}</button>
        <button style={btn(theme.bg, theme.text)} onClick={() => exportar('xlsx')}>⬇️ Excel{nMarcadas ? ` (${nMarcadas})` : ''}</button>
      </div>

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        {lista.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>Nenhuma ficha no período. Os voos feitos no app trazem as leituras sozinhos; pra lançar à mão, use "+ Nova ficha".</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5, minWidth: 720 }}>
            <thead>
              <tr style={{ background: theme.bg }}>
                {['', 'Data', 'Cliente · Fazenda', 'Talhão', 'Piloto', 'Voos', 'Área (ha)', 'Volume (L)', 'Origem', ''].map((h, i) => (
                  <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: theme.textMuted, borderBottom: `1px solid ${theme.divider}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map(x => (
                <tr key={x.chave} style={{ borderBottom: `1px solid ${theme.divider}` }}>
                  <td style={{ padding: '8px 10px' }}><input type="checkbox" checked={!!marcadas[x.chave]} onChange={e => setMarcadas(m => ({ ...m, [x.chave]: e.target.checked }))} /></td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{dataBR(x.data)}</td>
                  <td style={{ padding: '8px 10px' }}>{x.cliente || '—'} · {x.fazenda || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{x.talhao || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{x.piloto || '—'}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{x.nVoos}</td>
                  {(() => {
                    // Cada fonte com o valor que tem; a escolhida na emissão em negrito.
                    const fo = fontesDaFicha(x.tipo === 'voo' ? { rel: x.rel } : { manual: x.manual })
                    const n = (v, c) => typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: c }) : v
                    const coluna = (fontes, escolhida, rotulos, c) => (
                      <td style={{ padding: '6px 10px', fontSize: 11, lineHeight: 1.45, whiteSpace: 'nowrap' }}>
                        {rotulos.map(([k, l]) => (
                          <div key={k} style={{ color: k === escolhida ? theme.text : theme.textFaint2, fontWeight: k === escolhida ? 700 : 400 }}>
                            {l}: {fontes[k] == null ? '—' : n(fontes[k], c)}
                          </div>
                        ))}
                      </td>
                    )
                    return <>
                      {coluna(fo.area, fonteArea, [['manual', 'ficha'], ['voo', 'voo'], ['drone', 'drone']], 2)}
                      {coluna(fo.volume, fonteVolume, [['manual', 'ficha'], ['drone', 'drone']], 1)}
                    </>
                  })()}
                  <td style={{ padding: '8px 10px', color: theme.textMuted }}>{x.tipo === 'voo' ? (x.drone ? '🛩️ baterias do drone' : '🚁 voo registrado') : '✍️ manual'}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    <button style={{ ...btn(theme.bg, '#059669'), padding: '5px 10px', fontSize: 12 }} onClick={() => abrir(x)}>✏️ Editar</button>
                    <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '5px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => excluir(x)}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ fontSize: 11, color: theme.textFaint2 }}>Sem nenhuma marcada, o PDF/Excel sai com todas as fichas do período. Área aplicada em branco sai a do relatório do voo; volume consumido só sai se for digitado na ficha.</div>

      {editor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: theme.card, borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', padding: 22 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, marginBottom: 14, color: theme.text }}>
              {editor.tipo === 'voo' || editor.id ? '✏️ Editar ficha' : '🌡️ Nova ficha'}
            </div>

            {editor.tipo === 'manual' && !editor.id && (
              <div style={{ marginBottom: 12 }}>
                <div style={rot}>VINCULAR A UM VOO REGISTRADO?</div>
                <select style={{ ...campo, width: '100%' }} value={editor.vincular} onChange={e => setEditor(ed => ({ ...ed, vincular: e.target.value }))}>
                  <option value="">Não — ficha manual (digitar fazenda, talhão, data e piloto)</option>
                  {voosDoPeriodo.map(r => <option key={r.id} value={r.id}>{dataBR(dataIso(r.dt_inicio || r.created_at))} · {r.cliente} · {r.fazenda} · {r.localizacao || '—'} · {r.piloto_nome || '—'}{r.monitoramento_clima?.voos?.length ? ' (já tem ficha)' : ''}</option>)}
                </select>
              </div>
            )}

            {relDoEditor ? (
              <div style={{ background: theme.bg, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: theme.text, marginBottom: 12 }}>
                🚁 {dataBR(dataIso(relDoEditor.dt_inicio || relDoEditor.created_at))} · {relDoEditor.cliente} · <b>{relDoEditor.fazenda}</b>{codigoDaFazenda(relDoEditor) ? ` (${codigoDaFazenda(relDoEditor)})` : ''} · talhão {relDoEditor.localizacao || '—'} · {relDoEditor.piloto_nome}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
                {[['cliente', 'CLIENTE'], ['fazenda', 'FAZENDA'], ['fazenda_codigo', 'ID DA FAZENDA'], ['talhao', 'TALHÃO'], ['data', 'DATA DA APLICAÇÃO'], ['piloto', 'PILOTO']].map(([k, l]) => (
                  <div key={k}>
                    <div style={rot}>{l}</div>
                    {k === 'cliente' ? (
                      <select style={{ ...campo, width: '100%' }} value={editor.cab[k]} onChange={e => setEditor(ed => ({ ...ed, cab: { ...ed.cab, cliente: e.target.value } }))}>
                        <option value="">Selecione...</option>
                        {clientes.filter(c => c.ativo !== false).map(c => <option key={c.id || c.nome} value={c.nome}>{c.nome}</option>)}
                      </select>
                    ) : (
                      <input type={k === 'data' ? 'date' : 'text'} style={{ ...campo, width: '100%' }} value={editor.cab[k] || ''}
                        list={k === 'fazenda' ? 'fazendas-monit' : undefined}
                        onChange={e => {
                          const v = e.target.value
                          setEditor(ed => {
                            const cab = { ...ed.cab, [k]: v }
                            // Fazenda do cadastro: já puxa o ID.
                            if (k === 'fazenda') { const fz = fazendas.find(f => norm(f.nome) === norm(v) && (!cab.cliente || norm(f.cliente) === norm(cab.cliente))); if (fz?.id_fazenda && !cab.fazenda_codigo) cab.fazenda_codigo = fz.id_fazenda }
                            return { ...ed, cab }
                          })
                        }} />
                    )}
                  </div>
                ))}
                <datalist id="fazendas-monit">
                  {fazendas.filter(f => !editor.cab.cliente || norm(f.cliente) === norm(editor.cab.cliente)).map(f => <option key={f.id} value={f.nome} />)}
                </datalist>
              </div>
            )}

            {relDoEditor && (() => {
              const bats = editor.dados?.baterias || []
              const kes = editor.dados?.kestrel || null
              const imp = importacao?.relId === relDoEditor.id ? importacao : null
              const nMarcadas = imp ? imp.grupos.filter(g => g.marcado).reduce((a, g) => a + g.baterias.length, 0) : 0
              return (
                <div style={{ border: `1px dashed ${theme.cardBorder2}`, borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
                  <div style={rot}>🛩️ PLANILHA DO DRONE (DJI)</div>
                  {bats.length ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: theme.text }}>
                      <span style={{ flex: 1, minWidth: 220 }}><b>{bats.length} bateria{bats.length === 1 ? '' : 's'}</b> · {haBR(areaDasBaterias(bats))} ha · {bats[0].inicio}–{bats[bats.length - 1].fim}{bats[0].aeronave ? ` · ${bats[0].aeronave}` : ''} — a ficha sai por bateria, {kes?.alvo === 'baterias' ? 'com o clima medido pela Kestrel' : 'com o clima da leitura mais perto'}.</span>
                      <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '5px 12px', fontSize: 12 }} onClick={() => setEditor(ed => { const { kestrel, ...resto } = ed.dados || {}; return { ...ed, dados: { ...(kestrel?.alvo === 'baterias' ? resto : ed.dados), baterias: [], baterias_arquivo: null } } })}>Tirar baterias</button>
                    </div>
                  ) : imp ? (
                    <div>
                      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>{imp.arquivo} — baterias no horário deste voo, separadas pelo talhão do drone. Desmarque o que for de outro talhão.</div>
                      {imp.grupos.map((g, i) => (
                        <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: theme.text, marginBottom: 4, cursor: 'pointer' }}>
                          <input type="checkbox" checked={g.marcado} onChange={e => setImportacao(im => ({ ...im, grupos: im.grupos.map((x, j) => j === i ? { ...x, marcado: e.target.checked } : x) }))} />
                          <span><b>{g.baterias.length} bateria{g.baterias.length === 1 ? '' : 's'}</b> · {haBR(g.area)} ha · {horaBR(g.iniMs)}–{horaBR(g.fimMs)}{g.talhao ? <span style={{ color: theme.textFaint2 }}> · talhão do drone {g.talhao.slice(0, 8)}</span> : null}</span>
                        </label>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button style={{ ...btn('#059669'), padding: '7px 14px', fontSize: 12.5, opacity: nMarcadas ? 1 : .5 }} disabled={!nMarcadas} onClick={() => usarBaterias(relDoEditor)}>Usar {nMarcadas} bateria{nMarcadas === 1 ? '' : 's'}</button>
                        <button style={{ ...btn(theme.bg, theme.textMuted), padding: '7px 14px', fontSize: 12.5 }} onClick={() => setImportacao(null)}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <label style={{ ...btn(theme.bg, '#059669'), padding: '7px 14px', fontSize: 12.5, display: 'inline-block' }}>
                        📥 Importar planilha
                        <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => lerPlanilhaDrone(e, relDoEditor)} />
                      </label>
                      <span style={{ fontSize: 11.5, color: theme.textMuted, flex: 1, minWidth: 200 }}>O registro de voo do SmartFarm (uma linha por bateria): cada bateria vira um voo da ficha, com o horário, a altura e a área do drone.</span>
                    </div>
                  )}
                  <div style={{ borderTop: `1px dashed ${theme.cardBorder2}`, marginTop: 10, paddingTop: 10 }}>
                    <div style={rot}>🌡️ KESTREL (CLIMA MEDIDO NO TALHÃO)</div>
                    {kes ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: theme.text }}>
                        <span style={{ flex: 1, minWidth: 220 }}><b>{kes.aparelho}</b> · {kes.medicoes} medições das {kes.inicio} às {kes.fim} — clima medido em {kes.colunas} de {kes.de} {kes.alvo === 'baterias' ? 'bateria' : 'leitura'}{kes.de === 1 ? '' : 's'}.</span>
                        <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '5px 12px', fontSize: 12 }} onClick={tirarKestrel}>Tirar Kestrel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <label style={{ ...btn(theme.bg, '#059669'), padding: '7px 14px', fontSize: 12.5, display: 'inline-block' }}>
                          🌡️ Importar Kestrel
                          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => lerKestrel(e, relDoEditor)} />
                        </label>
                        <span style={{ fontSize: 11.5, color: theme.textMuted, flex: 1, minWidth: 200 }}>O CSV da sessão exportado pelo app Kestrel LiNK: cada {bats.length ? 'bateria' : 'leitura'} fica com a média do que a Kestrel mediu no horário dela.</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {(() => {
              // Com baterias, o editor mostra e corrige as baterias; as leituras ficam guardadas
              // como estão (são a fonte do clima delas).
              const comBaterias = (editor.dados?.baterias || []).length > 0
              return (
                <FichaClimaEditor valor={comBaterias ? { ...editor.dados, voos: editor.dados.baterias } : editor.dados}
                  onChange={dados => setEditor(ed => ({ ...ed, dados: comBaterias ? { ...dados, voos: ed.dados.voos, baterias: dados.voos } : dados }))}
                  sugestao={{ altura: relDoEditor?.altura || '', temperatura: relDoEditor?.temperatura_i || '', umidade: relDoEditor?.umidade_i || '', vento: relDoEditor?.vento_i || '' }} />
              )
            })()}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button style={{ ...btn(theme.bg, theme.textMuted), flex: 1 }} onClick={() => setEditor(null)} disabled={salvando}>Cancelar</button>
              <button style={{ ...btn('#059669'), flex: 2, opacity: salvando ? .6 : 1 }} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : '💾 Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

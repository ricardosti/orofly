import React, { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts'
import jsPDF from 'jspdf'
import * as XLSX from 'xlsx'
import { useAdminTheme as useTheme } from '../lib/theme'
import {
  PLANO_CONTAS, GRUPOS_DRE, categoriasDoTipo, contaDe, hojeISO, somarDias, mesDe, inicioDoMes, fimDoMes, moeda, numBR,
  statusDe, ROTULO_STATUS, resumoDashboard, fluxoMensal, porCategoria, montarDRE, lancamentosDasNotas, lancamentosDosVoos,
  planejarSincronizacao, lerPlanilhaLancamentos, orcadoRealizado, lerPlanilhaOrcamento, SIMULADOR_PADRAO, simularPreco, rendimentoReal,
} from '../lib/financeiro'
import { salvarOuCompartilharPdf, salvarOuCompartilharBlob } from '../lib/nativeShare'

// Financeiro (Beta) — Administrativo & Financeiro → Financeiro (Beta), só admin. O que veio da
// plataforma do Isaque (13/10/2026): lançamentos a pagar e receber, dashboard, DRE, orçamento e
// simulador de preço. As contas ficam em lib/financeiro.js; aqui é só a tela.
// Tabelas: fin_lancamentos, fin_orcamento, fin_propostas (RLS: só admin). Configuração (saldo
// inicial, dia de vencimento) em app_settings, chave 'financeiro_config'.

const ABAS = [['dashboard', '📊 Dashboard'], ['lancamentos', '📒 Lançamentos'], ['dre', '📈 DRE'], ['orcamento', '🎯 Orçamento'], ['simulador', '🧮 Simulador de preço']]
const CFG_PADRAO = { saldoInicial: 0, dataSaldo: '', diaVencimento: 10 }
const LS_SIM = 'orofly_fin_simulador'
const rotuloMes = m => { const [a, mm] = m.split('-'); return new Date(Date.UTC(+a, +mm - 1, 15)).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '') }
const dataBR = iso => (iso ? iso.split('-').reverse().join('/') : '—')
const ultimosMeses = (n, ate = mesDe(hojeISO())) => { const out = []; let [a, m] = ate.split('-').map(Number); for (let i = 0; i < n; i++) { out.unshift(`${a}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; a-- } } return out }
const pct = v => (v == null || !isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)

export default function FinanceiroBeta({ relatorios, custos, clientes, drones, empresa, supabase, showToast, isMobile }) {
  const { theme } = useTheme()
  const [aba, setAba] = useState('dashboard')
  const [lancs, setLancs] = useState(null)
  const [orc, setOrc] = useState([])
  const [cfg, setCfg] = useState(CFG_PADRAO)
  const hoje = hojeISO()

  async function carregar() {
    const [{ data: l, error: e1 }, { data: o, error: e2 }, { data: c }] = await Promise.all([
      supabase.from('fin_lancamentos').select('*').order('vencimento', { ascending: false }).limit(20000),
      supabase.from('fin_orcamento').select('*'),
      supabase.from('app_settings').select('valor').eq('chave', 'financeiro_config').maybeSingle(),
    ])
    if (e1 || e2) { showToast('Não consegui carregar o financeiro: ' + (e1 || e2).message, 'error'); setLancs([]); return }
    setLancs(l || []); setOrc(o || [])
    try { if (c?.valor) setCfg({ ...CFG_PADRAO, ...JSON.parse(c.valor) }) } catch {}
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line

  async function salvarCfg(nova) {
    const { error } = await supabase.from('app_settings').upsert({ chave: 'financeiro_config', valor: JSON.stringify(nova), atualizado_em: new Date().toISOString() })
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    setCfg(nova); showToast('✅ Configuração salva')
  }

  const card = { background: theme.card, borderRadius: 14, border: `1px solid ${theme.cardBorder}`, padding: isMobile ? 14 : 18, marginBottom: 14 }
  const campo = { border: `1px solid ${theme.cardBorder2}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: theme.inputBg || '#fff', color: theme.text, outline: 'none', boxSizing: 'border-box' }
  const rot = { fontSize: 10, fontWeight: 700, color: theme.textMuted, letterSpacing: 0.5, marginBottom: 4 }
  const btn = (bg, cor = '#fff') => ({ background: bg, color: cor, border: 'none', borderRadius: 16, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' })
  const titulo = { fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 10 }
  const ui = { theme, card, campo, rot, btn, titulo, isMobile, hoje }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: isMobile ? 18 : 22, fontWeight: 700, color: theme.text }}>
          💹 Financeiro <span style={{ fontSize: 12, background: theme.warningBg, color: theme.warningText2 || theme.warningText, padding: '2px 8px', borderRadius: 10, verticalAlign: 'middle' }}>BETA</span>
        </div>
        <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 4 }}>Contas a pagar e receber, DRE, orçamento e simulador de preço por hectare. Os voos (hectares × preço do cliente) e as notas dos pilotos entram pelo botão "Trazer do Orofly", em Lançamentos.</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {ABAS.map(([id, l]) => (
          <button key={id} onClick={() => setAba(id)} style={{ ...btn(aba === id ? '#059669' : theme.card, aba === id ? '#fff' : theme.text), border: `1px solid ${aba === id ? '#059669' : theme.cardBorder2}` }}>{l}</button>
        ))}
      </div>
      {lancs === null ? <div style={{ ...card, textAlign: 'center', color: theme.textMuted }}>Carregando...</div> : <>
        {aba === 'dashboard' && <Dashboard ui={ui} lancs={lancs} cfg={cfg} salvarCfg={salvarCfg} irPara={setAba} />}
        {aba === 'lancamentos' && <Lancamentos ui={ui} lancs={lancs} recarregar={carregar} cfg={cfg} relatorios={relatorios} custos={custos} clientes={clientes} supabase={supabase} showToast={showToast} />}
        {aba === 'dre' && <DRE ui={ui} lancs={lancs} />}
        {aba === 'orcamento' && <Orcamento ui={ui} lancs={lancs} orc={orc} recarregar={carregar} supabase={supabase} showToast={showToast} />}
        {aba === 'simulador' && <Simulador ui={ui} relatorios={relatorios} drones={drones} clientes={clientes} empresa={empresa} supabase={supabase} showToast={showToast} recarregar={carregar} />}
      </>}
    </div>
  )
}

function Kpi({ ui, rotulo, valor, sub, cor }) {
  return (
    <div style={{ ...ui.card, marginBottom: 0, padding: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: ui.theme.textMuted, letterSpacing: 0.4 }}>{rotulo}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: cor || ui.theme.text, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: ui.theme.textFaint2, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────────────
function Dashboard({ ui, lancs, cfg, salvarCfg, irPara }) {
  const { theme, card, campo, rot, btn, titulo, isMobile, hoje } = ui
  const [editCfg, setEditCfg] = useState(false)
  const [rasc, setRasc] = useState(cfg)
  useEffect(() => setRasc(cfg), [cfg])
  const r = resumoDashboard(lancs, { saldoInicial: cfg.saldoInicial, dataSaldo: cfg.dataSaldo || '0000-01-01', hoje })
  const meses = ultimosMeses(6)
  const fluxo = fluxoMensal(lancs, meses).map(x => ({ ...x, nome: rotuloMes(x.mes) }))
  const mes = mesDe(hoje)
  const cats = porCategoria(lancs, 'pagar', { ini: inicioDoMes(mes), fim: fimDoMes(mes), regime: 'competencia' }).slice(0, 8)
  const proximos = lancs.filter(l => !l.pago_em).sort((a, b) => a.vencimento.localeCompare(b.vencimento)).slice(0, 10)
  if (!lancs.length) return (
    <div style={{ ...card, textAlign: 'center', padding: 30 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 6 }}>Nenhum lançamento ainda</div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 14 }}>Comece trazendo os voos e as notas do Orofly, ou importe a planilha do sistema antigo.</div>
      <button style={btn('#059669')} onClick={() => irPara('lancamentos')}>📒 Ir para Lançamentos</button>
    </div>
  )
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        <Kpi ui={ui} rotulo="SALDO EM CAIXA" valor={moeda(r.caixa)} cor={r.caixa < 0 ? theme.dangerText : '#059669'} sub={cfg.dataSaldo ? `desde ${dataBR(cfg.dataSaldo)}` : 'sem saldo inicial'} />
        <Kpi ui={ui} rotulo="RECEBIDO NO MÊS" valor={moeda(r.receitasMes)} sub={`a receber ${moeda(r.aReceberMes)}`} />
        <Kpi ui={ui} rotulo="PAGO NO MÊS" valor={moeda(r.despesasPagasMes)} sub={`a pagar ${moeda(r.aPagarMes)}`} />
        <Kpi ui={ui} rotulo="PRÓXIMOS 7 DIAS" valor={moeda(r.vence7)} sub={`${r.vence7Qtd} conta${r.vence7Qtd === 1 ? '' : 's'} (receber − pagar)`} />
        <Kpi ui={ui} rotulo="VENCIDOS" valor={r.vencidosQtd} cor={r.vencidosQtd ? theme.dangerText : theme.text} sub={`receber ${moeda(r.vencidosReceber)} · pagar ${moeda(r.vencidosPagar)}`} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 14 }}>
        <div style={card}>
          <div style={titulo}>Fluxo de caixa — realizado</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={fluxo} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.divider} />
              <XAxis dataKey="nome" tick={{ fontSize: 11, fill: theme.textMuted }} />
              <YAxis tick={{ fontSize: 10, fill: theme.textFaint2 }} tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} width={40} />
              <Tooltip formatter={v => moeda(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="entradas" name="Entradas" fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar dataKey="saidas" name="Saídas" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={card}>
          <div style={titulo}>Despesas do mês por categoria</div>
          {cats.length === 0 ? <div style={{ fontSize: 12.5, color: theme.textMuted }}>Nenhuma despesa neste mês.</div> : cats.map(c => (
            <div key={c.categoria} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: theme.text }}><span>{c.categoria}</span><b>{moeda(c.valor)}</b></div>
              <div style={{ height: 6, background: theme.divider, borderRadius: 6, marginTop: 3 }}><div style={{ height: '100%', width: `${(c.valor / cats[0].valor) * 100}%`, background: '#D97706', borderRadius: 6 }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div style={card}>
        <div style={titulo}>Próximos vencimentos</div>
        {proximos.length === 0 ? <div style={{ fontSize: 12.5, color: theme.textMuted }}>Nada em aberto.</div> : proximos.map(l => {
          const st = statusDe(l, hoje)
          return (
            <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${theme.divider}`, fontSize: 12.5 }}>
              <span style={{ width: 76, color: st === 'vencido' ? theme.dangerText : theme.textMuted, fontWeight: st === 'vencido' ? 700 : 400 }}>{dataBR(l.vencimento)}</span>
              <span style={{ flex: 1, color: theme.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.descricao}</span>
              <b style={{ color: l.tipo === 'receber' ? '#059669' : theme.dangerText, whiteSpace: 'nowrap' }}>{l.tipo === 'receber' ? '+' : '−'} {moeda(l.valor)}</b>
            </div>
          )
        })}
      </div>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ ...titulo, marginBottom: 0 }}>⚙️ Saldo inicial do caixa</div>
          {!editCfg && <button style={btn(theme.bg, theme.text)} onClick={() => setEditCfg(true)}>Editar</button>}
        </div>
        {!editCfg ? (
          <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 6 }}>
            {cfg.dataSaldo ? `${moeda(cfg.saldoInicial)} em ${dataBR(cfg.dataSaldo)}` : 'Não definido: o saldo em caixa soma tudo que foi recebido e pago desde o primeiro lançamento.'} Contas a receber dos voos vencem no dia {cfg.diaVencimento} do mês seguinte.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
            <div><div style={rot}>SALDO (R$)</div><input style={{ ...campo, width: 140 }} value={rasc.saldoInicial} onChange={e => setRasc(x => ({ ...x, saldoInicial: e.target.value }))} /></div>
            <div><div style={rot}>EM</div><input type="date" style={campo} value={rasc.dataSaldo} onChange={e => setRasc(x => ({ ...x, dataSaldo: e.target.value }))} /></div>
            <div><div style={rot}>VENCIMENTO DOS VOOS (DIA)</div><input type="number" min={1} max={28} style={{ ...campo, width: 90 }} value={rasc.diaVencimento} onChange={e => setRasc(x => ({ ...x, diaVencimento: e.target.value }))} /></div>
            <button style={btn('#059669')} onClick={() => { salvarCfg({ ...rasc, saldoInicial: numBR(rasc.saldoInicial) || 0, diaVencimento: parseInt(rasc.diaVencimento, 10) || 10 }); setEditCfg(false) }}>Salvar</button>
            <button style={btn(theme.bg, theme.textMuted)} onClick={() => { setRasc(cfg); setEditCfg(false) }}>Cancelar</button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Lançamentos ──────────────────────────────────────────────────────────────────────
const VAZIO = tipo => ({ tipo, descricao: '', categoria: categoriasDoTipo(tipo)[0], valor: '', competencia: hojeISO(), vencimento: hojeISO(), pago_em: '', cliente_fornecedor: '', forma_pagamento: '', observacao: '' })
function Lancamentos({ ui, lancs, recarregar, cfg, relatorios, custos, clientes, supabase, showToast }) {
  const { theme, card, campo, rot, btn, isMobile, hoje } = ui
  const [f, setF] = useState({ tipo: '', status: '', categoria: '', mes: '', busca: '' })
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [sync, setSync] = useState(null)
  const [importacao, setImportacao] = useState(null)
  const lista = useMemo(() => lancs.filter(l => (!f.tipo || l.tipo === f.tipo) && (!f.status || statusDe(l, hoje) === f.status) && (!f.categoria || l.categoria === f.categoria)
    && (!f.mes || mesDe(l.vencimento) === f.mes || mesDe(l.competencia) === f.mes)
    && (!f.busca || `${l.descricao} ${l.cliente_fornecedor || ''} ${l.observacao || ''}`.toLowerCase().includes(f.busca.toLowerCase())))
    .sort((a, b) => b.vencimento.localeCompare(a.vencimento)), [lancs, f, hoje])
  const tot = lista.reduce((a, l) => { a[l.tipo] += Number(l.valor) || 0; return a }, { receber: 0, pagar: 0 })

  async function salvar() {
    const valor = numBR(form.valor)
    if (!form.descricao.trim() || !(valor > 0) || !form.competencia || !form.vencimento) { showToast('Preencha descrição, valor, competência e vencimento', 'error'); return }
    setSalvando(true)
    const linha = { tipo: form.tipo, descricao: form.descricao.trim(), categoria: form.categoria, valor: +valor.toFixed(2), competencia: form.competencia, vencimento: form.vencimento,
      pago_em: form.pago_em || null, cliente_fornecedor: form.cliente_fornecedor || null, forma_pagamento: form.forma_pagamento || null, observacao: form.observacao || null, updated_at: new Date().toISOString() }
    const { error } = form.id ? await supabase.from('fin_lancamentos').update(linha).eq('id', form.id) : await supabase.from('fin_lancamentos').insert({ ...linha, origem: 'manual' })
    setSalvando(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('✅ Lançamento salvo'); setForm(null); recarregar()
  }
  async function baixar(l, data = hoje) {
    const { error } = await supabase.from('fin_lancamentos').update({ pago_em: data, updated_at: new Date().toISOString() }).eq('id', l.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(l.tipo === 'receber' ? '✅ Marcado como recebido' : '✅ Marcado como pago'); recarregar()
  }
  async function excluir(l) {
    if (!window.confirm(`Excluir "${l.descricao}" (${moeda(l.valor)})?${l.origem === 'voos' || l.origem === 'nota' ? ' Ele volta na próxima vez que trouxer do Orofly.' : ''}`)) return
    const { error } = await supabase.from('fin_lancamentos').delete().eq('id', l.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('🗑️ Excluído'); recarregar()
  }

  // Trazer do Orofly: mostra o que entra antes de gravar.
  function prepararSync(incluirNaoConferidas = false) {
    const { lancs: voos, semPreco } = lancamentosDosVoos(relatorios, clientes, { diaVencimento: cfg.diaVencimento })
    const notas = lancamentosDasNotas(custos, { soConferidas: !incluirNaoConferidas })
    const naoConferidas = (custos || []).filter(d => !d.conferido && Number(d.valor) > 0).length
    setSync({ incluirNaoConferidas, voos: planejarSincronizacao(voos, lancs), notas: planejarSincronizacao(notas, lancs), semPreco, naoConferidas })
  }
  async function aplicarSync() {
    setSalvando(true)
    try {
      const inserir = [...sync.voos.inserir, ...sync.notas.inserir]
      for (let i = 0; i < inserir.length; i += 200) {
        const { error } = await supabase.from('fin_lancamentos').insert(inserir.slice(i, i + 200))
        if (error) throw error
      }
      for (const u of [...sync.voos.atualizar, ...sync.notas.atualizar]) {
        const { error } = await supabase.from('fin_lancamentos').update({ valor: u.valor, descricao: u.descricao, updated_at: new Date().toISOString() }).eq('id', u.id)
        if (error) throw error
      }
      showToast(`✅ ${inserir.length} novos, ${sync.voos.atualizar.length + sync.notas.atualizar.length} atualizados`); setSync(null); recarregar()
    } catch (e) { showToast('Erro: ' + e.message, 'error') } finally { setSalvando(false) }
  }
  async function lerArquivo(arq) {
    try {
      const r = lerPlanilhaLancamentos(await arq.arrayBuffer())
      if (!r) { showToast('Não achei colunas de valor e descrição/categoria nessa planilha', 'error'); return }
      setImportacao({ arquivo: arq.name, ...r })
    } catch (e) { showToast('Erro ao ler a planilha: ' + e.message, 'error') }
  }
  async function aplicarImportacao() {
    setSalvando(true)
    try {
      const ls = importacao.lancamentos
      for (let i = 0; i < ls.length; i += 200) { const { error } = await supabase.from('fin_lancamentos').insert(ls.slice(i, i + 200)); if (error) throw error }
      showToast(`✅ ${ls.length} lançamentos importados`); setImportacao(null); recarregar()
    } catch (e) { showToast('Erro: ' + e.message, 'error') } finally { setSalvando(false) }
  }
  async function exportar() {
    const linhas = [['Tipo', 'Status', 'Descrição', 'Categoria', 'Grupo DRE', 'Valor', 'Competência', 'Vencimento', 'Pago em', 'Cliente/Fornecedor', 'Forma de pagamento', 'Origem', 'Observação'],
      ...lista.map(l => [l.tipo === 'receber' ? 'Receber' : 'Pagar', ROTULO_STATUS[statusDe(l, hoje)], l.descricao, l.categoria, GRUPOS_DRE[contaDe(l.categoria, l.tipo).grupo], Number(l.valor), dataBR(l.competencia), dataBR(l.vencimento), l.pago_em ? dataBR(l.pago_em) : '', l.cliente_fornecedor || '', l.forma_pagamento || '', l.origem, l.observacao || ''])]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'Lançamentos')
    const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await salvarOuCompartilharBlob(blob, `lancamentos-${hoje}.xlsx`)
  }
  const meses = [...new Set(lancs.map(l => mesDe(l.vencimento)))].sort().reverse()
  const corStatus = { realizado: ['#059669', theme.successBg], vencido: [theme.dangerText, theme.dangerBg], previsto: ['#B45309', '#FEF3C7'] }

  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn('#059669')} onClick={() => setForm(VAZIO('receber'))}>+ A receber</button>
        <button style={btn('#dc2626')} onClick={() => setForm(VAZIO('pagar'))}>+ A pagar</button>
        <button style={btn('#1E293B')} onClick={() => prepararSync(false)}>🔄 Trazer do Orofly</button>
        <label style={{ ...btn(theme.bg, theme.text), display: 'inline-block' }}>⬆️ Importar planilha
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const a = e.target.files?.[0]; e.target.value = ''; if (a) lerArquivo(a) }} />
        </label>
        <button style={btn(theme.bg, theme.text)} onClick={exportar}>⬇️ Excel</button>
      </div>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><div style={rot}>TIPO</div><select style={campo} value={f.tipo} onChange={e => setF(x => ({ ...x, tipo: e.target.value }))}><option value="">Todos</option><option value="receber">A receber</option><option value="pagar">A pagar</option></select></div>
        <div><div style={rot}>STATUS</div><select style={campo} value={f.status} onChange={e => setF(x => ({ ...x, status: e.target.value }))}><option value="">Todos</option>{Object.entries(ROTULO_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><div style={rot}>MÊS</div><select style={campo} value={f.mes} onChange={e => setF(x => ({ ...x, mes: e.target.value }))}><option value="">Todos</option>{meses.map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}</select></div>
        <div><div style={rot}>CATEGORIA</div><select style={campo} value={f.categoria} onChange={e => setF(x => ({ ...x, categoria: e.target.value }))}><option value="">Todas</option>{PLANO_CONTAS.map(c => <option key={c.nome}>{c.nome}</option>)}</select></div>
        <div style={{ flex: 1, minWidth: 160 }}><div style={rot}>BUSCA</div><input style={{ ...campo, width: '100%' }} placeholder="Descrição, cliente, fornecedor..." value={f.busca} onChange={e => setF(x => ({ ...x, busca: e.target.value }))} /></div>
      </div>
      <div style={{ fontSize: 12.5, color: theme.textMuted, margin: '0 2px 8px' }}>
        {lista.length} lançamento{lista.length === 1 ? '' : 's'} · <b style={{ color: '#059669' }}>receber {moeda(tot.receber)}</b> · <b style={{ color: theme.dangerText }}>pagar {moeda(tot.pagar)}</b> · saldo <b style={{ color: theme.text }}>{moeda(tot.receber - tot.pagar)}</b>
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        {lista.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>Nenhum lançamento. Use "Trazer do Orofly" pra começar pelos voos e notas.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 820 }}>
            <thead><tr style={{ background: theme.bg }}>{['Vencimento', 'Descrição', 'Categoria', 'Valor', 'Status', 'Origem', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: theme.textMuted }}>{h}</th>)}</tr></thead>
            <tbody>{lista.slice(0, 500).map(l => {
              const st = statusDe(l, hoje); const [c, bg] = corStatus[st]
              return (
                <tr key={l.id} style={{ borderTop: `1px solid ${theme.divider}` }}>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{dataBR(l.vencimento)}<div style={{ fontSize: 10, color: theme.textFaint2 }}>comp. {dataBR(l.competencia)}</div></td>
                  <td style={{ padding: '8px 10px', maxWidth: 320 }}><div style={{ color: theme.text }}>{l.descricao}</div>{l.cliente_fornecedor && <div style={{ fontSize: 10.5, color: theme.textFaint2 }}>{l.cliente_fornecedor}</div>}</td>
                  <td style={{ padding: '8px 10px', color: theme.textMuted }}>{l.categoria}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap', color: l.tipo === 'receber' ? '#059669' : theme.dangerText }}>{l.tipo === 'receber' ? '+' : '−'} {moeda(l.valor)}</td>
                  <td style={{ padding: '8px 10px' }}><span style={{ background: bg, color: c, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{ROTULO_STATUS[st]}{l.pago_em ? ` ${dataBR(l.pago_em)}` : ''}</span></td>
                  <td style={{ padding: '8px 10px', fontSize: 11, color: theme.textFaint2 }}>{{ manual: 'manual', nota: 'nota do piloto', voos: 'voos', planilha: 'planilha', simulador: 'proposta' }[l.origem] || l.origem}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {!l.pago_em && <button title={l.tipo === 'receber' ? 'Marcar como recebido hoje' : 'Marcar como pago hoje'} style={{ ...btn(theme.successBg, '#059669'), padding: '4px 9px' }} onClick={() => baixar(l)}>✓ {l.tipo === 'receber' ? 'Recebido' : 'Pago'}</button>}
                    <button style={{ ...btn(theme.bg, theme.text), padding: '4px 9px', marginLeft: 4 }} onClick={() => setForm({ ...l, valor: String(l.valor).replace('.', ','), pago_em: l.pago_em || '' })}>✏️</button>
                    <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '4px 9px', marginLeft: 4 }} onClick={() => excluir(l)}>🗑️</button>
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
        {lista.length > 500 && <div style={{ padding: 10, fontSize: 12, color: theme.textMuted }}>Mostrando 500 de {lista.length}. Use os filtros.</div>}
      </div>

      {form && (
        <Modal ui={ui} titulo={`${form.id ? 'Editar' : 'Novo'} lançamento a ${form.tipo === 'receber' ? 'receber' : 'pagar'}`} fechar={() => setForm(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            <div style={{ gridColumn: '1 / -1' }}><div style={rot}>DESCRIÇÃO</div><input style={{ ...campo, width: '100%' }} value={form.descricao} onChange={e => setForm(x => ({ ...x, descricao: e.target.value }))} /></div>
            <div><div style={rot}>TIPO</div><select style={{ ...campo, width: '100%' }} value={form.tipo} onChange={e => { const t = e.target.value; setForm(x => ({ ...x, tipo: t, categoria: categoriasDoTipo(t).includes(x.categoria) ? x.categoria : categoriasDoTipo(t)[0] })) }}><option value="receber">A receber</option><option value="pagar">A pagar</option></select></div>
            <div><div style={rot}>CATEGORIA</div><select style={{ ...campo, width: '100%' }} value={form.categoria} onChange={e => setForm(x => ({ ...x, categoria: e.target.value }))}>{categoriasDoTipo(form.tipo).map(c => <option key={c}>{c}</option>)}</select></div>
            <div><div style={rot}>VALOR (R$)</div><input style={{ ...campo, width: '100%' }} inputMode="decimal" value={form.valor} onChange={e => setForm(x => ({ ...x, valor: e.target.value }))} /></div>
            <div><div style={rot}>{form.tipo === 'receber' ? 'CLIENTE' : 'FORNECEDOR'}</div><input style={{ ...campo, width: '100%' }} list="fin-clientes" value={form.cliente_fornecedor || ''} onChange={e => setForm(x => ({ ...x, cliente_fornecedor: e.target.value }))} /></div>
            <div><div style={rot}>COMPETÊNCIA (MÊS DA DRE)</div><input type="date" style={{ ...campo, width: '100%' }} value={form.competencia} onChange={e => setForm(x => ({ ...x, competencia: e.target.value }))} /></div>
            <div><div style={rot}>VENCIMENTO</div><input type="date" style={{ ...campo, width: '100%' }} value={form.vencimento} onChange={e => setForm(x => ({ ...x, vencimento: e.target.value }))} /></div>
            <div><div style={rot}>{form.tipo === 'receber' ? 'RECEBIDO EM' : 'PAGO EM'} (EM BRANCO = EM ABERTO)</div><input type="date" style={{ ...campo, width: '100%' }} value={form.pago_em || ''} onChange={e => setForm(x => ({ ...x, pago_em: e.target.value }))} /></div>
            <div><div style={rot}>FORMA DE PAGAMENTO</div><input style={{ ...campo, width: '100%' }} placeholder="Pix, boleto, cartão..." value={form.forma_pagamento || ''} onChange={e => setForm(x => ({ ...x, forma_pagamento: e.target.value }))} /></div>
            <div style={{ gridColumn: '1 / -1' }}><div style={rot}>OBSERVAÇÃO</div><input style={{ ...campo, width: '100%' }} value={form.observacao || ''} onChange={e => setForm(x => ({ ...x, observacao: e.target.value }))} /></div>
          </div>
          <datalist id="fin-clientes">{(clientes || []).map(c => <option key={c.nome} value={c.nome} />)}</datalist>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button style={{ ...btn(theme.bg, theme.textMuted), flex: 1 }} onClick={() => setForm(null)}>Cancelar</button>
            <button style={{ ...btn('#059669'), flex: 2 }} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando...' : '💾 Salvar'}</button>
          </div>
        </Modal>
      )}

      {sync && (
        <Modal ui={ui} titulo="🔄 Trazer do Orofly" fechar={() => setSync(null)}>
          <div style={{ fontSize: 13, color: theme.text, lineHeight: 1.6 }}>
            <b>Contas a receber pelos voos</b> (hectares × preço do cliente, uma por cliente por mês, vencendo no dia {cfg.diaVencimento} do mês seguinte):<br />
            {sync.voos.inserir.length} novas · {sync.voos.atualizar.length} com valor atualizado · {sync.voos.iguais} iguais{sync.voos.travados ? ` · ${sync.voos.travados} já recebidas (não mudam)` : ''}
            {sync.semPreco.length > 0 && <div style={{ fontSize: 12, color: theme.warningText, marginTop: 4 }}>⚠️ Sem preço cadastrado (ficam de fora): {sync.semPreco.map(s => `${s.cliente} (${s.area.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha)`).join(', ')}. O preço fica no cadastro do cliente.</div>}
            <div style={{ marginTop: 12 }}><b>Notas dos pilotos</b> (viram despesa paga na data da nota):<br />
              {sync.notas.inserir.length} novas · {sync.notas.atualizar.length} atualizadas · {sync.notas.iguais} iguais</div>
            {sync.naoConferidas > 0 && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={sync.incluirNaoConferidas} onChange={e => prepararSync(e.target.checked)} />
                Incluir também as {sync.naoConferidas} notas ainda não conferidas pelo administrativo
              </label>
            )}
            <div style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 10 }}>Pode trazer de novo quando quiser: o que já veio não duplica, e conta já recebida não muda.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button style={{ ...btn(theme.bg, theme.textMuted), flex: 1 }} onClick={() => setSync(null)}>Cancelar</button>
            <button style={{ ...btn('#059669'), flex: 2 }} disabled={salvando || !(sync.voos.inserir.length + sync.voos.atualizar.length + sync.notas.inserir.length + sync.notas.atualizar.length)} onClick={aplicarSync}>{salvando ? 'Gravando...' : 'Trazer'}</button>
          </div>
        </Modal>
      )}

      {importacao && (
        <Modal ui={ui} titulo={`⬆️ ${importacao.arquivo}`} fechar={() => setImportacao(null)}>
          <div style={{ fontSize: 13, color: theme.text, marginBottom: 8 }}>
            Aba <b>{importacao.aba}</b>: {importacao.lancamentos.length} lançamentos lidos
            {importacao.erros.length > 0 && <span style={{ color: theme.warningText }}> · {importacao.erros.length} linha{importacao.erros.length === 1 ? '' : 's'} ignorada{importacao.erros.length === 1 ? '' : 's'} ({importacao.erros.slice(0, 5).map(e => `linha ${e.linha}: ${e.motivo}`).join('; ')}{importacao.erros.length > 5 ? '…' : ''})</span>}
          </div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>
            Receber {moeda(importacao.lancamentos.filter(l => l.tipo === 'receber').reduce((a, l) => a + l.valor, 0))} · Pagar {moeda(importacao.lancamentos.filter(l => l.tipo === 'pagar').reduce((a, l) => a + l.valor, 0))}.
            Categoria que não existe no plano de contas foi trocada pela mais parecida; a original fica na observação.
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto', border: `1px solid ${theme.divider}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}><tbody>
              {importacao.lancamentos.slice(0, 50).map((l, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${theme.divider}` }}>
                  <td style={{ padding: '5px 8px' }}>{dataBR(l.vencimento)}</td><td style={{ padding: '5px 8px' }}>{l.descricao}</td><td style={{ padding: '5px 8px', color: theme.textMuted }}>{l.categoria}</td>
                  <td style={{ padding: '5px 8px', color: l.tipo === 'receber' ? '#059669' : theme.dangerText, whiteSpace: 'nowrap' }}>{moeda(l.valor)}</td><td style={{ padding: '5px 8px' }}>{l.pago_em ? 'pago' : 'aberto'}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button style={{ ...btn(theme.bg, theme.textMuted), flex: 1 }} onClick={() => setImportacao(null)}>Cancelar</button>
            <button style={{ ...btn('#059669'), flex: 2 }} disabled={salvando || !importacao.lancamentos.length} onClick={aplicarImportacao}>{salvando ? 'Importando...' : `Importar ${importacao.lancamentos.length}`}</button>
          </div>
        </Modal>
      )}
    </>
  )
}

function Modal({ ui, titulo, fechar, children, largura = 620 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={fechar}>
      <div style={{ background: ui.theme.card, borderRadius: 16, width: '100%', maxWidth: largura, maxHeight: '90vh', overflow: 'auto', padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 17, fontWeight: 700, color: ui.theme.text, marginBottom: 12 }}>{titulo}</div>
        {children}
      </div>
    </div>
  )
}

// ── DRE ──────────────────────────────────────────────────────────────────────────────
function periodoDe(tipo, ref, ini, fim) {
  if (tipo === 'custom') return { ini, fim }
  const [a, m] = ref.split('-').map(Number)
  if (tipo === 'mes') return { ini: inicioDoMes(ref), fim: fimDoMes(ref) }
  if (tipo === 'trimestre') { const t0 = Math.floor((m - 1) / 3) * 3 + 1; return { ini: `${a}-${String(t0).padStart(2, '0')}-01`, fim: fimDoMes(`${a}-${String(t0 + 2).padStart(2, '0')}`) } }
  return { ini: `${a}-01-01`, fim: `${a}-12-31` }
}
function DRE({ ui, lancs }) {
  const { theme, card, campo, rot, btn, hoje } = ui
  const [tipo, setTipo] = useState('mes')
  const [ref, setRef] = useState(mesDe(hoje))
  const [ini, setIni] = useState(inicioDoMes(mesDe(hoje)))
  const [fim, setFim] = useState(hoje)
  const [regime, setRegime] = useState('competencia')
  const [aberta, setAberta] = useState(null)
  const per = periodoDe(tipo, ref, ini, fim)
  const linhas = montarDRE(lancs, { ...per, regime })
  const meses = ultimosMeses(18)
  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><div style={rot}>PERÍODO</div><select style={campo} value={tipo} onChange={e => setTipo(e.target.value)}><option value="mes">Mês</option><option value="trimestre">Trimestre</option><option value="ano">Ano</option><option value="custom">Personalizado</option></select></div>
        {tipo !== 'custom'
          ? <div><div style={rot}>REFERÊNCIA</div><select style={campo} value={ref} onChange={e => setRef(e.target.value)}>{meses.slice().reverse().map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}</select></div>
          : <><div><div style={rot}>DE</div><input type="date" style={campo} value={ini} onChange={e => setIni(e.target.value)} /></div><div><div style={rot}>ATÉ</div><input type="date" style={campo} value={fim} onChange={e => setFim(e.target.value)} /></div></>}
        <div><div style={rot}>REGIME</div>
          <div style={{ display: 'flex', gap: 4 }}>{[['competencia', 'Competência'], ['caixa', 'Caixa']].map(([k, l]) => <button key={k} style={{ ...btn(regime === k ? '#059669' : theme.bg, regime === k ? '#fff' : theme.text), padding: '8px 12px' }} onClick={() => setRegime(k)}>{l}</button>)}</div>
        </div>
        <div style={{ fontSize: 11.5, color: theme.textMuted, flex: 1, minWidth: 200 }}>{dataBR(per.ini)} a {dataBR(per.fim)} · {regime === 'competencia' ? 'pelo mês a que o lançamento se refere' : 'pelo dia em que o dinheiro entrou ou saiu (só o realizado)'}</div>
      </div>
      <div style={{ ...card, padding: 0 }}>
        {linhas.map(l => {
          const total = l.nivel === 0
          const podeAbrir = l.itens && l.itens.length > 0
          return (
            <React.Fragment key={l.id}>
              <div onClick={() => podeAbrir && setAberta(aberta === l.id ? null : l.id)}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderTop: `1px solid ${theme.divider}`, background: total ? theme.bg : 'transparent', cursor: podeAbrir ? 'pointer' : 'default' }}>
                <span style={{ flex: 1, fontSize: total ? 13.5 : 13, fontWeight: total ? 800 : 500, color: theme.text, paddingLeft: l.nivel === 2 ? 14 : 0 }}>{podeAbrir ? (aberta === l.id ? '▾ ' : '▸ ') : ''}{l.rotulo}</span>
                <span style={{ width: 150, textAlign: 'right', fontWeight: total ? 800 : 600, fontVariantNumeric: 'tabular-nums', color: l.valor < 0 ? theme.dangerText : total ? '#059669' : theme.text }}>{moeda(l.valor)}</span>
                <span style={{ width: 70, textAlign: 'right', fontSize: 11.5, color: theme.textMuted }}>{pct(l.pct)}</span>
              </div>
              {aberta === l.id && (() => {
                const porCat = {}
                l.itens.forEach(x => { (porCat[x.categoria] = porCat[x.categoria] || []).push(x) })
                return Object.entries(porCat).map(([cat, xs]) => (
                  <div key={cat} style={{ padding: '6px 16px 6px 44px', borderTop: `1px dashed ${theme.divider}`, fontSize: 12 }}>
                    <div style={{ display: 'flex', fontWeight: 700, color: theme.text }}><span style={{ flex: 1 }}>{cat}</span><span>{moeda(xs.reduce((a, x) => a + Number(x.valor), 0))}</span></div>
                    {xs.slice(0, 30).map(x => <div key={x.id} style={{ display: 'flex', color: theme.textMuted, padding: '2px 0' }}><span style={{ width: 80 }}>{dataBR(regime === 'caixa' ? x.pago_em : x.competencia)}</span><span style={{ flex: 1 }}>{x.descricao}</span><span>{moeda(x.valor)}</span></div>)}
                    {xs.length > 30 && <div style={{ color: theme.textFaint2 }}>…e mais {xs.length - 30}</div>}
                  </div>
                ))
              })()}
            </React.Fragment>
          )
        })}
      </div>
      <div style={{ fontSize: 11.5, color: theme.textMuted, padding: '0 4px' }}>Clique numa linha com ▸ pra ver os lançamentos. "Compra de equipamentos" é investimento e fica fora da DRE (a despesa do mês é a depreciação).</div>
    </>
  )
}

// ── Orçamento ────────────────────────────────────────────────────────────────────────
function Orcamento({ ui, lancs, orc, recarregar, supabase, showToast }) {
  const { theme, card, campo, rot, btn, isMobile, hoje } = ui
  const [mes, setMes] = useState(mesDe(hoje))
  const [rasc, setRasc] = useState({})
  const [salvando, setSalvando] = useState(false)
  const doMes = useMemo(() => Object.fromEntries(orc.filter(o => mesDe(o.mes) === mes).map(o => [o.categoria, String(o.valor).replace('.', ',')])), [orc, mes])
  useEffect(() => setRasc(doMes), [doMes])
  const comparativo = orcadoRealizado(orc, lancs, mes)
  const real = Object.fromEntries(comparativo.map(c => [c.categoria, c.realizado]))
  const alterado = PLANO_CONTAS.some(c => (rasc[c.nome] || '') !== (doMes[c.nome] || ''))
  // EBITDA orçado × realizado, pela mesma conta da DRE.
  const ebitda = fonte => {
    const g = { receita: 0, impostos: 0, custo: 0, operacional: 0 }
    PLANO_CONTAS.forEach(c => { if (g[c.grupo] != null) g[c.grupo] += fonte(c.nome) })
    return { ...g, ebitda: g.receita - g.impostos - g.custo - g.operacional }
  }
  const eOrc = ebitda(n => numBR(rasc[n]) || 0), eReal = ebitda(n => real[n] || 0)
  const cascata = [['Receita', 'receita'], ['Impostos', 'impostos'], ['Custos', 'custo'], ['Despesas', 'operacional'], ['EBITDA', 'ebitda']]
    .map(([nome, k]) => ({ nome, Orçado: k === 'receita' || k === 'ebitda' ? eOrc[k] : -eOrc[k], Realizado: k === 'receita' || k === 'ebitda' ? eReal[k] : -eReal[k] }))

  async function salvar() {
    setSalvando(true)
    const linhas = PLANO_CONTAS.filter(c => c.grupo !== 'investimento').map(c => ({ mes: inicioDoMes(mes), categoria: c.nome, valor: +(numBR(rasc[c.nome]) || 0).toFixed(2), updated_at: new Date().toISOString() }))
    const { error } = await supabase.from('fin_orcamento').upsert(linhas, { onConflict: 'mes,categoria' })
    setSalvando(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('✅ Orçamento salvo'); recarregar()
  }
  async function importar(arq) {
    const ano = mes.slice(0, 4)
    try {
      const linhas = lerPlanilhaOrcamento(await arq.arrayBuffer(), ano)
      if (!linhas?.length) { showToast('Não achei as colunas dos meses (jan…dez) nessa planilha', 'error'); return }
      if (!window.confirm(`Importar ${linhas.length} valores para ${ano}? Substitui o orçado das mesmas categorias e meses.`)) return
      const { error } = await supabase.from('fin_orcamento').upsert(linhas.map(l => ({ ...l, updated_at: new Date().toISOString() })), { onConflict: 'mes,categoria' })
      if (error) throw error
      showToast(`✅ ${linhas.length} valores importados`); recarregar()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }
  const meses = [...ultimosMeses(12), ...Array.from({ length: 6 }, (_, i) => { const [a, m] = mesDe(hoje).split('-').map(Number); const t = new Date(Date.UTC(a, m + i, 1)); return t.toISOString().slice(0, 7) })]
  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><div style={rot}>MÊS</div><select style={campo} value={mes} onChange={e => setMes(e.target.value)}>{[...new Set(meses)].map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}</select></div>
        <label style={{ ...btn(theme.bg, theme.text), display: 'inline-block' }}>⬆️ Importar planilha do ano
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const a = e.target.files?.[0]; e.target.value = ''; if (a) importar(a) }} />
        </label>
        <div style={{ fontSize: 11.5, color: theme.textMuted, flex: 1, minWidth: 200 }}>Planilha: uma linha por categoria e uma coluna por mês (jan…dez). O realizado é pela competência.</div>
        {alterado && <button style={btn('#059669')} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando...' : '💾 Salvar orçamento'}</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 14 }}>
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520 }}>
            <thead><tr style={{ background: theme.bg }}>{['Categoria', 'Orçado', 'Realizado', 'Diferença', '%'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Categoria' ? 'left' : 'right', fontSize: 10.5, color: theme.textMuted }}>{h}</th>)}</tr></thead>
            <tbody>{PLANO_CONTAS.filter(c => c.grupo !== 'investimento').map(c => {
              const o = numBR(rasc[c.nome]) || 0, r = real[c.nome] || 0, dif = r - o
              const ruim = c.tipo === 'receber' ? dif < -0.005 : dif > 0.005
              return (
                <tr key={c.nome} style={{ borderTop: `1px solid ${theme.divider}` }}>
                  <td style={{ padding: '6px 10px', color: theme.text }}>{c.nome}<div style={{ fontSize: 10, color: theme.textFaint2 }}>{GRUPOS_DRE[c.grupo]}</div></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><input style={{ ...campo, width: 110, textAlign: 'right', padding: '5px 8px' }} inputMode="decimal" placeholder="0" value={rasc[c.nome] || ''} onChange={e => setRasc(x => ({ ...x, [c.nome]: e.target.value }))} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r ? moeda(r) : '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: !o && !r ? theme.textFaint2 : ruim ? theme.dangerText : '#059669', fontVariantNumeric: 'tabular-nums' }}>{o || r ? moeda(dif) : '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: theme.textMuted }}>{o ? pct((r / o) * 100) : '—'}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
        <div style={card}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 6 }}>Cascata do EBITDA — {rotuloMes(mes)}</div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>EBITDA orçado <b>{moeda(eOrc.ebitda)}</b> · realizado <b style={{ color: eReal.ebitda < eOrc.ebitda ? theme.dangerText : '#059669' }}>{moeda(eReal.ebitda)}</b></div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={cascata} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.divider} />
              <XAxis dataKey="nome" tick={{ fontSize: 11, fill: theme.textMuted }} />
              <YAxis tick={{ fontSize: 10, fill: theme.textFaint2 }} tickFormatter={v => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)} width={44} />
              <Tooltip formatter={v => moeda(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Orçado" fill="#94A3B8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Realizado" fill="#059669" radius={[4, 4, 0, 0]}>{cascata.map((x, i) => <Cell key={i} fill={x.Realizado < 0 ? '#dc2626' : '#059669'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  )
}

// ── Simulador de preço ───────────────────────────────────────────────────────────────
function Simulador({ ui, relatorios, drones, clientes, empresa, supabase, showToast, recarregar }) {
  const { theme, card, campo, rot, btn, titulo, isMobile, hoje } = ui
  const [p, setP] = useState(() => { try { return { ...SIMULADOR_PADRAO, ...JSON.parse(localStorage.getItem(LS_SIM) || '{}') } } catch { return SIMULADOR_PADRAO } })
  useEffect(() => { try { localStorage.setItem(LS_SIM, JSON.stringify(p)) } catch {} }, [p])
  const r = simularPreco(p)
  const real = useMemo(() => rendimentoReal(relatorios, drones), [relatorios, drones])
  const [salvando, setSalvando] = useState(false)
  const set = (k, v) => setP(x => ({ ...x, [k]: v }))
  const setG = (g, k, v) => setP(x => ({ ...x, [g]: { ...x[g], [k]: v } }))
  const setD = (i, k, v) => setP(x => ({ ...x, drones: x.drones.map((d, j) => (j === i ? { ...d, [k]: v } : d)) }))
  const In = ({ l, v, on, w = 110, suf }) => (
    <div><div style={rot}>{l}</div><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input style={{ ...campo, width: w }} inputMode="decimal" value={v} onChange={e => on(e.target.value)} />{suf && <span style={{ fontSize: 11, color: theme.textMuted }}>{suf}</span>}</div></div>
  )
  function usarReal() {
    let usados = 0
    setP(x => ({ ...x, drones: x.drones.map(d => { const m = real.find(rr => rr.modelo.replace(/P$/, '') === String(d.modelo).toUpperCase().replace(/P$/, '')); if (m && m.voos >= 3) { usados++; return { ...d, haPorHora: +m.haPorHora.toFixed(1) } } return d }) }))
    setTimeout(() => showToast(usados ? '✅ ha/hora trocado pelo real dos voos' : 'Sem voos suficientes desses modelos nos últimos 90 dias'), 0)
  }
  function gerarPdf() {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = 210, M = 18
    const emp = empresa || {}
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(5, 150, 105)
    doc.text(String(emp.razao_social || emp.nome || 'Orofly').toUpperCase(), M, 26)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100)
    doc.text([emp.cnpj ? `CNPJ ${emp.cnpj}` : '', [emp.telefone, emp.email, emp.site].filter(Boolean).join(' · ')].filter(Boolean), M, 32)
    doc.setDrawColor(5, 150, 105); doc.setLineWidth(0.6); doc.line(M, 40, W - M, 40)
    doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
    doc.text('Proposta comercial — Pulverização com drone', M, 52)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
    const venc = somarDias(hoje, parseInt(p.proposta.validadeDias, 10) || 15)
    const linhas = [
      ['Cliente', p.proposta.cliente || '—'], ['Data', dataBR(hoje)], ['Área', `${(numBR(p.proposta.areaHa) || 0).toLocaleString('pt-BR')} ha`],
      ['Preço por hectare', moeda(r.precoHa)], ['Valor total', moeda(r.proposta.total)],
      ['Prazo estimado de execução', `${Math.max(1, Math.ceil(r.proposta.diasNecessarios))} dia(s) de operação`], ['Validade da proposta', dataBR(venc)],
    ]
    let y = 66
    linhas.forEach(([k, v], i) => {
      if (i % 2 === 0) { doc.setFillColor(243, 247, 245); doc.rect(M, y - 5.5, W - 2 * M, 9, 'F') }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(90); doc.text(k, M + 3, y)
      doc.setFont('helvetica', 'bold'); doc.setTextColor(20); doc.text(String(v), W - M - 3, y, { align: 'right' }); y += 9
    })
    y += 8
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(70)
    doc.text(doc.splitTextToSize('Inclui: equipe de pilotos, drones de pulverização, baterias, gerador, deslocamento e relatório de cada voo (área aplicada, mapa, produtos e condições climáticas). Não inclui os produtos aplicados. Valores sujeitos à confirmação da área no campo.', W - 2 * M), M, y)
    doc.setFontSize(8); doc.setTextColor(150); doc.text('Proposta gerada pelo Orofly', M, 285)
    salvarOuCompartilharPdf(doc, `proposta-${(p.proposta.cliente || 'cliente').replace(/\s+/g, '-').toLowerCase()}-${hoje}.pdf`)
  }
  async function virarContaAReceber() {
    if (!p.proposta.cliente || !(r.proposta.total > 0)) { showToast('Preencha o cliente e a área da proposta', 'error'); return }
    if (!window.confirm(`Criar conta a receber de ${moeda(r.proposta.total)} para ${p.proposta.cliente}?`)) return
    setSalvando(true)
    try {
      const venc = somarDias(hoje, 30)
      const { data: l, error } = await supabase.from('fin_lancamentos').insert({
        tipo: 'receber', categoria: 'Serviço de pulverização', descricao: `Proposta ${p.proposta.cliente} — ${(numBR(p.proposta.areaHa) || 0).toLocaleString('pt-BR')} ha a ${moeda(r.precoHa)}/ha`,
        valor: +r.proposta.total.toFixed(2), competencia: hoje, vencimento: venc, cliente_fornecedor: p.proposta.cliente, origem: 'simulador',
      }).select().single()
      if (error) throw error
      const { error: e2 } = await supabase.from('fin_propostas').insert({ cliente: p.proposta.cliente, area_ha: numBR(p.proposta.areaHa) || 0, preco_ha: +r.precoHa.toFixed(2), total: +r.proposta.total.toFixed(2), parametros: p, resultado: { custoHa: r.custoHa, areaMes: r.areaMes, totalMes: r.totalMes }, lancamento_id: l.id })
      if (e2) throw e2
      showToast('✅ Conta a receber criada (prevista para 30 dias)'); recarregar()
    } catch (e) { showToast('Erro: ' + e.message, 'error') } finally { setSalvando(false) }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 14, alignItems: 'start' }}>
      <div>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ ...titulo, marginBottom: 0 }}>🚁 Frota de drones</div>
            <button style={btn(theme.bg, '#059669')} onClick={usarReal}>Usar o rendimento real dos voos</button>
          </div>
          {real.length > 0 && <div style={{ fontSize: 11.5, color: theme.textMuted, margin: '6px 0 4px' }}>Real (90 dias): {real.slice(0, 5).map(x => `${x.modelo} ${x.haPorHora.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha/h (${x.voos} voos)`).join(' · ')}</div>}
          {p.drones.map((d, i) => (
            <div key={i} style={{ borderTop: `1px solid ${theme.divider}`, paddingTop: 10, marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div><div style={rot}>MODELO</div><input style={{ ...campo, width: 80 }} value={d.modelo} onChange={e => setD(i, 'modelo', e.target.value)} /></div>
                {In({ l: 'QTD', v: d.qtd, on: v => setD(i, 'qtd', v), w: 55 })}
                {In({ l: 'HA POR HORA', v: d.haPorHora, on: v => setD(i, 'haPorHora', v), w: 70 })}
                {In({ l: 'HORAS/DIA', v: d.horasDia, on: v => setD(i, 'horasDia', v), w: 60 })}
                {In({ l: 'VALOR DO DRONE', v: d.valor, on: v => setD(i, 'valor', v), suf: 'R$' })}
                {In({ l: 'VIDA ÚTIL', v: d.vidaAnos, on: v => setD(i, 'vidaAnos', v), w: 50, suf: 'anos' })}
                {In({ l: 'BATERIA', v: d.bateriaPreco, on: v => setD(i, 'bateriaPreco', v), w: 90, suf: 'R$' })}
                {In({ l: 'CICLOS', v: d.bateriaCiclos, on: v => setD(i, 'bateriaCiclos', v), w: 65 })}
                {In({ l: 'HA POR CARGA', v: d.haPorBateria, on: v => setD(i, 'haPorBateria', v), w: 60 })}
                {In({ l: 'GERADOR', v: d.geradorLh, on: v => setD(i, 'geradorLh', v), w: 50, suf: 'L/h' })}
                <button title="Tirar" style={{ ...btn(theme.dangerBg, theme.dangerText), alignSelf: 'flex-end', padding: '7px 10px' }} onClick={() => setP(x => ({ ...x, drones: x.drones.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            </div>
          ))}
          <button style={{ ...btn(theme.bg, theme.text), marginTop: 10 }} onClick={() => setP(x => ({ ...x, drones: [...x.drones, { ...SIMULADOR_PADRAO.drones[0], modelo: 'Novo', qtd: 1 }] }))}>+ Modelo</button>
        </div>
        <div style={card}>
          <div style={titulo}>📅 Mês de operação</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {In({ l: 'DIAS TRABALHÁVEIS', v: p.diasMes, on: v => set('diasMes', v), w: 70 })}
            {In({ l: 'APROVEITAMENTO', v: p.utilizacao, on: v => set('utilizacao', v), w: 60, suf: '%' })}
            {In({ l: 'COMBUSTÍVEL', v: p.combustivelPreco, on: v => set('combustivelPreco', v), w: 70, suf: 'R$/L' })}
            {In({ l: 'ADMINISTRATIVO / MÊS', v: p.administrativoMes, on: v => set('administrativoMes', v), suf: 'R$' })}
          </div>
          <div style={{ fontSize: 11, color: theme.textFaint2, marginTop: 6 }}>Aproveitamento: quanto das horas de voo de fato rende (chuva, vento, deslocamento entre fazendas).</div>
        </div>
        <div style={card}>
          <div style={titulo}>🛻 Caminhonetes e 👥 equipe</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {In({ l: 'CAMINHONETES', v: p.caminhonetes.qtd, on: v => setG('caminhonetes', 'qtd', v), w: 55 })}
            {In({ l: 'VALOR', v: p.caminhonetes.valor, on: v => setG('caminhonetes', 'valor', v), suf: 'R$' })}
            {In({ l: 'VIDA ÚTIL', v: p.caminhonetes.vidaAnos, on: v => setG('caminhonetes', 'vidaAnos', v), w: 50, suf: 'anos' })}
            {In({ l: 'KM / MÊS', v: p.caminhonetes.kmMes, on: v => setG('caminhonetes', 'kmMes', v), w: 70 })}
            {In({ l: 'KM / LITRO', v: p.caminhonetes.kmPorLitro, on: v => setG('caminhonetes', 'kmPorLitro', v), w: 55 })}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {In({ l: 'PILOTOS', v: p.equipe.pilotos, on: v => setG('equipe', 'pilotos', v), w: 55 })}
            {In({ l: 'SALÁRIO', v: p.equipe.salario, on: v => setG('equipe', 'salario', v), suf: 'R$' })}
            {In({ l: 'ENCARGOS', v: p.equipe.encargosPct, on: v => setG('equipe', 'encargosPct', v), w: 55, suf: '%' })}
            {In({ l: 'DIÁRIA/ALIMENTAÇÃO', v: p.equipe.diaria, on: v => setG('equipe', 'diaria', v), w: 70, suf: 'R$/dia' })}
            {In({ l: 'PEDÁGIO', v: p.equipe.pedagioDia, on: v => setG('equipe', 'pedagioDia', v), w: 60, suf: 'R$/dia' })}
          </div>
        </div>
        <div style={card}>
          <div style={titulo}>💰 Impostos, margem e risco</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {In({ l: 'IMPOSTOS', v: p.impostosPct, on: v => set('impostosPct', v), w: 55, suf: '%' })}
            {In({ l: 'MARGEM', v: p.margemPct, on: v => set('margemPct', v), w: 55, suf: '%' })}
            {In({ l: 'RISCO', v: p.riscoPct, on: v => set('riscoPct', v), w: 55, suf: '%' })}
          </div>
          <div style={{ fontSize: 11, color: theme.textFaint2, marginTop: 6 }}>Calculados "por dentro": o preço é o custo dividido por (1 − impostos − margem − risco).</div>
          <button style={{ ...btn(theme.bg, theme.textMuted), marginTop: 10 }} onClick={() => window.confirm('Voltar todos os números ao padrão?') && setP(SIMULADOR_PADRAO)}>Voltar ao padrão</button>
        </div>
      </div>
      <div style={{ position: isMobile ? 'static' : 'sticky', top: 12 }}>
        <div style={{ ...card, border: '2px solid #059669' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted }}>PREÇO SUGERIDO</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: '#059669' }}>{r.valido ? moeda(r.precoHa) : '—'}<span style={{ fontSize: 14, color: theme.textMuted }}> /ha</span></div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}>Custo {moeda(r.custoHa)}/ha · impostos {moeda(r.impostosHa)} · margem {moeda(r.margemHa)} · risco {moeda(r.riscoHa)}</div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}>Capacidade: <b>{Math.round(r.areaMes).toLocaleString('pt-BR')} ha/mês</b> · custo da operação {moeda(r.totalMes)}/mês</div>
          {!r.valido && <div style={{ fontSize: 12, color: theme.dangerText, marginTop: 6 }}>Impostos + margem + risco precisam somar menos de 100%, e a frota precisa ter capacidade.</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10 }}><tbody>
            {r.composicao.map(c => (
              <tr key={c.item} style={{ borderTop: `1px solid ${theme.divider}` }}>
                <td style={{ padding: '5px 0', color: theme.text }}>{c.item}<span style={{ fontSize: 10, color: theme.textFaint2 }}> · {c.tipo}</span></td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: theme.textMuted }}>{moeda(c.mes)}</td>
                <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', fontWeight: 700 }}>{moeda(c.porHa)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div style={card}>
          <div style={titulo}>📄 Proposta</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 150 }}><div style={rot}>CLIENTE</div><input style={{ ...campo, width: '100%' }} list="sim-clientes" value={p.proposta.cliente} onChange={e => setG('proposta', 'cliente', e.target.value)} /></div>
            {In({ l: 'ÁREA', v: p.proposta.areaHa, on: v => setG('proposta', 'areaHa', v), w: 80, suf: 'ha' })}
            {In({ l: 'VALIDADE', v: p.proposta.validadeDias, on: v => setG('proposta', 'validadeDias', v), w: 50, suf: 'dias' })}
          </div>
          <datalist id="sim-clientes">{(clientes || []).map(c => <option key={c.nome} value={c.nome} />)}</datalist>
          <div style={{ fontSize: 13, color: theme.text, margin: '10px 0' }}>Total <b style={{ fontSize: 16, color: '#059669' }}>{moeda(r.proposta.total)}</b> · cerca de {Math.max(1, Math.ceil(r.proposta.diasNecessarios))} dia(s) de operação</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btn('#1E293B')} disabled={!r.valido} onClick={gerarPdf}>📄 Proposta em PDF</button>
            <button style={btn('#059669')} disabled={!r.valido || salvando} onClick={virarContaAReceber}>➕ Virar conta a receber</button>
          </div>
        </div>
      </div>
    </div>
  )
}

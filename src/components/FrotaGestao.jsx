import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAdminTheme as useTheme } from '../lib/theme'
import {
  TIPOS_VEICULO, ROTULO_TIPO, STATUS_VEICULO, CATEGORIAS_MANUTENCAO, FINALIDADES_VIAGEM, PLANOS_SUGERIDOS,
  medidorDe, leituraDe, hojeISO, somarDias, consumoReal, custosDoVeiculo, situacaoDoPlano, ROTULO_SITUACAO, descreverFalta,
  situacaoBateria, alertasDaFrota, ROTULO_RESULTADO, precoMedioCombustivel,
} from '../lib/frota'
import { salvarOuCompartilharBlob } from '../lib/nativeShare'

// Gestão → Frota. Os ativos que levam o drone até a fazenda: caminhonetes, motos, geradores
// (horímetro) e baterias (ciclos). Contas em lib/frota.js. Tabelas: veiculos (cadastro ampliado),
// viagens, manutencoes_veiculo, frota_abastecimentos, frota_planos, frota_checklists,
// frota_baterias, frota_cnh. O piloto faz checklist e abastecimento pelo app; o resto é do gestor.

const ABAS = [['painel', '📊 Painel'], ['veiculos', '🛻 Veículos'], ['abastecimentos', '⛽ Abastecimentos'], ['manutencao', '🔧 Manutenção'],
  ['viagens', '🗺️ Viagens'], ['checklists', '✅ Checklists'], ['baterias', '🔋 Baterias'], ['motoristas', '🪪 Motoristas']]
const moeda = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const n1 = (v, c = 1) => (v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: c }))
const br = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const numBR = v => { if (typeof v === 'number') return v; const s = String(v ?? '').trim(); if (!s) return null; const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return isNaN(n) ? null : n }
const mesAtual = () => hojeISO().slice(0, 7)
const fimMes = m => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10) }
const nomeV = v => (v ? `${v.placa || '—'} · ${v.modelo || ROTULO_TIPO[v.tipo] || ''}` : '—')

export default function FrotaGestao({ supabase, showToast, isMobile, pilotos = [], clientes = [], fazendas = [] }) {
  const { theme } = useTheme()
  const [aba, setAba] = useState('painel')
  const [d, setD] = useState(null)
  const [modal, setModal] = useState(null) // { tipo, dados }

  async function carregar() {
    const q = (t, o) => { let x = supabase.from(t).select('*'); if (o) x = x.order(o, { ascending: false }); return x.limit(3000) }
    const rs = await Promise.all([q('veiculos'), q('viagens', 'data'), q('manutencoes_veiculo', 'data'), q('frota_abastecimentos', 'data'), q('frota_planos'), q('frota_checklists', 'feito_em'), q('frota_baterias'), q('frota_cnh')])
    const erro = rs.find(r => r.error)
    if (erro) { showToast('Não consegui carregar a frota: ' + erro.error.message, 'error'); setD({ veiculos: [], viagens: [], manut: [], abast: [], planos: [], checks: [], baterias: [], cnhs: [] }); return }
    const [v, vi, m, a, p, c, b, cn] = rs.map(r => r.data || [])
    setD({ veiculos: v.sort((x, y) => String(x.placa).localeCompare(String(y.placa))), viagens: vi, manut: m, abast: a, planos: p, checks: c, baterias: b, cnhs: cn })
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line

  async function gravar(tabela, linha, id, chave = 'id') {
    const { error } = id ? await supabase.from(tabela).update(linha).eq(chave, id) : await supabase.from(tabela).insert(linha)
    if (error) { showToast('Erro: ' + error.message, 'error'); return false }
    return true
  }
  async function apagar(tabela, id, pergunta) {
    if (!window.confirm(pergunta)) return
    const { error } = await supabase.from(tabela).delete().eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('🗑️ Excluído'); carregar()
  }

  const card = { background: theme.card, borderRadius: 14, border: `1px solid ${theme.cardBorder}`, padding: isMobile ? 14 : 18, marginBottom: 14 }
  const campo = { border: `1px solid ${theme.cardBorder2}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: theme.inputBg || '#fff', color: theme.text, outline: 'none', boxSizing: 'border-box', width: '100%' }
  const rot = { fontSize: 10, fontWeight: 700, color: theme.textMuted, letterSpacing: 0.5, marginBottom: 4 }
  const btn = (bg, cor = '#fff') => ({ background: bg, color: cor, border: 'none', borderRadius: 16, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' })
  const titulo = { fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 10 }
  const th = { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: theme.textMuted, whiteSpace: 'nowrap' }
  const td = { padding: '8px 10px', borderTop: `1px solid ${theme.divider}`, fontSize: 12.5, color: theme.text, verticalAlign: 'top' }
  const pill = (cor, bg, txt) => <span style={{ background: bg, color: cor, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{txt}</span>
  const ui = { theme, card, campo, rot, btn, titulo, th, td, pill, isMobile }

  if (!d) return <div style={{ ...card, textAlign: 'center', color: theme.textMuted }}>Carregando a frota...</div>
  const porId = Object.fromEntries(d.veiculos.map(v => [v.id, v]))
  const alertas = alertasDaFrota({ veiculos: d.veiculos, planos: d.planos, cnhs: d.cnhs, baterias: d.baterias, checklists: d.checks })
  const abrir = (tipo, dados = {}) => setModal({ tipo, dados })
  const fechar = () => setModal(null)
  const salvo = msg => { showToast(msg); fechar(); carregar() }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: isMobile ? 18 : 22, fontWeight: 700, color: theme.text }}>🛻 Frota</div>
        <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 4 }}>Os veículos, geradores e baterias que levam o drone até a fazenda: custos, consumo real, manutenção por km/horas/data, checklist de saída e documentos.</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {ABAS.map(([id, l]) => {
          const qtd = id === 'checklists' ? d.veiculos.filter(v => v.status === 'bloqueado').length : 0
          return <button key={id} onClick={() => setAba(id)} style={{ ...btn(aba === id ? '#059669' : theme.card, aba === id ? '#fff' : theme.text), border: `1px solid ${aba === id ? '#059669' : theme.cardBorder2}` }}>{l}{qtd ? ` (${qtd})` : ''}</button>
        })}
      </div>

      {aba === 'painel' && <Painel ui={ui} d={d} alertas={alertas} porId={porId} irPara={setAba} />}
      {aba === 'veiculos' && <Veiculos ui={ui} d={d} abrir={abrir} apagar={apagar} />}
      {aba === 'abastecimentos' && <Abastecimentos ui={ui} d={d} porId={porId} abrir={abrir} apagar={apagar} />}
      {aba === 'manutencao' && <Manutencao ui={ui} d={d} porId={porId} abrir={abrir} apagar={apagar} />}
      {aba === 'viagens' && <Viagens ui={ui} d={d} porId={porId} abrir={abrir} apagar={apagar} />}
      {aba === 'checklists' && <Checklists ui={ui} d={d} porId={porId} supabase={supabase} showToast={showToast} recarregar={carregar} />}
      {aba === 'baterias' && <Baterias ui={ui} d={d} abrir={abrir} apagar={apagar} />}
      {aba === 'motoristas' && <Motoristas ui={ui} d={d} pilotos={pilotos} abrir={abrir} />}

      {modal && <Formulario ui={ui} modal={modal} fechar={fechar} d={d} porId={porId} gravar={gravar} salvo={salvo} supabase={supabase} showToast={showToast} clientes={clientes} fazendas={fazendas} pilotos={pilotos} />}
    </div>
  )
}

function Kpi({ ui, rotulo, valor, sub, cor }) {
  return (
    <div style={{ ...ui.card, marginBottom: 0, padding: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: ui.theme.textMuted }}>{rotulo}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: cor || ui.theme.text, marginTop: 4 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: ui.theme.textFaint2, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Painel ───────────────────────────────────────────────────────────────────────────
function Painel({ ui, d, alertas, porId, irPara }) {
  const { theme, card, btn, titulo, th, td, pill, isMobile } = ui
  const [mes, setMes] = useState(mesAtual())
  const ini = `${mes}-01`, fim = fimMes(mes)
  const ativos = d.veiculos.filter(v => v.ativo !== false && v.status !== 'baixado')
  const linhas = ativos.map(v => {
    const c = custosDoVeiculo(v, { abastecimentos: d.abast, manutencoes: d.manut, viagens: d.viagens, ini, fim })
    const cons = consumoReal(d.abast.filter(a => a.veiculo_id === v.id), v)
    return { v, c, cons }
  })
  const tot = linhas.reduce((a, x) => ({ combustivel: a.combustivel + x.c.combustivel, manutencao: a.manutencao + x.c.manutencao, fixos: a.fixos + x.c.fixos + x.c.depreciacao, km: a.km + (x.c.unidade === 'km' ? x.c.rodado : 0) }), { combustivel: 0, manutencao: 0, fixos: 0, km: 0 })
  const totalMes = tot.combustivel + tot.manutencao + tot.fixos
  const ranking = linhas.filter(x => x.c.custoPorUnidade != null && x.c.unidade === 'km').sort((a, b) => a.c.custoPorUnidade - b.c.custoPorUnidade)
  const contagem = Object.fromEntries(Object.keys(STATUS_VEICULO).map(k => [k, d.veiculos.filter(v => v.ativo !== false && v.status === k).length]))
  const meses = Array.from({ length: 12 }, (_, i) => { const t = new Date(); t.setDate(1); t.setMonth(t.getMonth() - i); return t.toISOString().slice(0, 7) })
  async function exportar() {
    const wb = XLSX.utils.book_new()
    const aba = (nome, linhas) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome)
    aba('Custos do mês', [['Veículo', 'Tipo', 'Rodado', 'Unidade', 'Combustível', 'Litros', 'Manutenção', 'Fixos (IPVA/seguro/lic.)', 'Depreciação', 'Total', 'Custo por km/h', 'Consumo real', 'Consumo esperado'],
      ...linhas.map(x => [nomeV(x.v), ROTULO_TIPO[x.v.tipo], x.c.rodado, x.c.unidade, +x.c.combustivel.toFixed(2), +x.c.litros.toFixed(1), +x.c.manutencao.toFixed(2), +x.c.fixos.toFixed(2), +x.c.depreciacao.toFixed(2), +x.c.total.toFixed(2), x.c.custoPorUnidade != null ? +x.c.custoPorUnidade.toFixed(2) : '', x.cons.media != null ? +x.cons.media.toFixed(2) : '', x.v.consumo_esperado || ''])])
    const dentro = r => String(r.data).slice(0, 10) >= ini && String(r.data).slice(0, 10) <= fim
    aba('Viagens', [['Data', 'Veículo', 'Motorista', 'Cliente', 'Fazenda', 'Destino', 'Finalidade', 'OS', 'Km inicial', 'Km final', 'Km rodado'],
      ...d.viagens.filter(dentro).map(v => [br(v.data), nomeV(porId[v.veiculo_id]), v.motorista || '', v.cliente || '', v.fazenda || '', v.destino || '', v.finalidade || '', v.ordem_servico || '', v.km_inicial, v.km_final, (Number(v.km_final) - Number(v.km_inicial)) || ''])])
    aba('Abastecimentos', [['Data', 'Veículo', 'Km/horímetro', 'Litros', 'Valor', 'R$/L', 'Combustível', 'Posto', 'Tanque cheio', 'Motorista'],
      ...d.abast.filter(dentro).map(a => [br(a.data), nomeV(porId[a.veiculo_id]), a.km ?? a.horimetro ?? '', Number(a.litros), Number(a.valor), a.litros ? +(a.valor / a.litros).toFixed(3) : '', a.combustivel || '', a.posto || '', a.tanque_cheio ? 'sim' : 'não', a.motorista_nome || ''])])
    aba('Manutenções', [['Data', 'Veículo', 'Categoria', 'Serviço', 'Km/horas', 'Oficina', 'OS oficina', 'Peças', 'Mão de obra', 'Total', 'Status'],
      ...d.manut.filter(dentro).map(m => [br(m.data), nomeV(porId[m.veiculo_id]), m.categoria || '', m.tipo || '', m.km ?? m.horas ?? '', m.oficina || '', m.os_oficina || '', Number(m.valor_pecas) || '', Number(m.valor_mao_obra) || '', (Number(m.valor_pecas) + Number(m.valor_mao_obra)) || Number(m.custo) || '', m.status || ''])])
    const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await salvarOuCompartilharBlob(blob, `frota-${mes}.xlsx`)
  }
  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select style={{ ...ui.campo, width: 'auto' }} value={mes} onChange={e => setMes(e.target.value)}>{meses.map(m => <option key={m} value={m}>{m.split('-').reverse().join('/')}</option>)}</select>
        <div style={{ flex: 1, fontSize: 12, color: theme.textMuted }}>{Object.entries(STATUS_VEICULO).map(([k, s]) => `${contagem[k] || 0} ${s.rotulo.toLowerCase()}`).join(' · ')}</div>
        <button style={btn(theme.bg, theme.text)} onClick={exportar}>⬇️ Excel do mês</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        <Kpi ui={ui} rotulo="CUSTO DA FROTA NO MÊS" valor={moeda(totalMes)} sub="combustível + manutenção + fixos" />
        <Kpi ui={ui} rotulo="COMBUSTÍVEL" valor={moeda(tot.combustivel)} />
        <Kpi ui={ui} rotulo="MANUTENÇÃO" valor={moeda(tot.manutencao)} />
        <Kpi ui={ui} rotulo="FIXOS E DEPRECIAÇÃO" valor={moeda(tot.fixos)} sub="IPVA, seguro e licenciamento rateados" />
        <Kpi ui={ui} rotulo="KM RODADOS" valor={n1(tot.km, 0)} sub={tot.km ? `${moeda(totalMes / tot.km)} por km` : 'lance abastecimentos ou viagens'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <div style={card}>
          <div style={titulo}>🔔 Alertas ({alertas.length})</div>
          {alertas.length === 0 ? <div style={{ fontSize: 12.5, color: theme.textMuted }}>Nada pendente. 👍</div> : alertas.slice(0, 15).map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: i ? `1px solid ${theme.divider}` : 'none', fontSize: 12.5, color: theme.text, cursor: 'pointer' }}
              onClick={() => irPara({ checklist: 'checklists', documentos: 'veiculos', manutencao: 'manutencao', cnh: 'motoristas', baterias: 'baterias' }[a.area] || 'painel')}>
              <span>{a.nivel === 'critico' ? '🔴' : '🟡'}</span><span style={{ flex: 1 }}>{a.texto}</span>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={titulo}>🏁 Custo por km — do melhor pro pior</div>
          {ranking.length === 0 ? <div style={{ fontSize: 12.5, color: theme.textMuted }}>Precisa de pelo menos dois registros de km no mês (abastecimento ou viagem).</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Veículo</th><th style={th}>Km</th><th style={th}>R$/km</th><th style={th}>Consumo</th></tr></thead><tbody>
              {ranking.map(x => (
                <tr key={x.v.id}>
                  <td style={td}>{nomeV(x.v)}</td><td style={td}>{n1(x.c.rodado, 0)}</td><td style={{ ...td, fontWeight: 700 }}>{moeda(x.c.custoPorUnidade)}</td>
                  <td style={td}>{x.cons.media != null ? `${n1(x.cons.media)} ${x.cons.unidade}` : '—'}{x.cons.desvio != null && x.cons.desvio > 10 && <> {pill('#B45309', '#FEF3C7', `${n1(x.cons.desvio, 0)}% pior`)}</>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr style={{ background: theme.bg }}>{['Veículo', 'Status', 'Rodado no mês', 'Combustível', 'Manutenção', 'Fixos', 'Total', 'Consumo real'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{linhas.map(x => {
            const s = STATUS_VEICULO[x.v.status] || STATUS_VEICULO.operacional
            return (
              <tr key={x.v.id}>
                <td style={td}><b>{nomeV(x.v)}</b><div style={{ fontSize: 10.5, color: theme.textFaint2 }}>{ROTULO_TIPO[x.v.tipo]}{x.v.base ? ` · ${x.v.base}` : ''}</div></td>
                <td style={td}>{pill(s.cor, s.bg, s.rotulo)}</td>
                <td style={td}>{x.c.rodado ? `${n1(x.c.rodado, 0)} ${x.c.unidade}` : '—'}</td>
                <td style={td}>{moeda(x.c.combustivel)}</td><td style={td}>{moeda(x.c.manutencao)}</td><td style={td}>{moeda(x.c.fixos + x.c.depreciacao)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{moeda(x.c.total)}</td>
                <td style={td}>{x.cons.media != null ? `${n1(x.cons.media)} ${x.cons.unidade}` : '—'}{x.cons.esperado ? <span style={{ color: theme.textFaint2 }}> (esperado {n1(x.cons.esperado)})</span> : ''}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </>
  )
}

// ── Veículos ─────────────────────────────────────────────────────────────────────────
function Veiculos({ ui, d, abrir, apagar }) {
  const { theme, card, btn, pill, isMobile } = ui
  const [verBaixados, setVerBaixados] = useState(false)
  const lista = d.veiculos.filter(v => verBaixados || (v.ativo !== false && v.status !== 'baixado'))
  const hoje = hojeISO()
  const doc = (iso, rot) => {
    if (!iso) return <span style={{ color: theme.textFaint2 }}>{rot}: —</span>
    const dias = Math.round((Date.parse(iso) - Date.parse(hoje)) / 86400000)
    const cor = dias < 0 ? theme.dangerText : dias <= 30 ? '#B45309' : theme.textMuted
    return <span style={{ color: cor, fontWeight: dias <= 30 ? 700 : 400 }}>{rot}: {br(iso)}</span>
  }
  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn('#059669')} onClick={() => abrir('veiculo', { tipo: 'caminhonete', medidor: 'km', status: 'operacional', ativo: true })}>+ Veículo ou gerador</button>
        <label style={{ fontSize: 12.5, color: theme.text, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={verBaixados} onChange={e => setVerBaixados(e.target.checked)} /> Mostrar baixados</label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {lista.map(v => {
          const s = STATUS_VEICULO[v.status] || STATUS_VEICULO.operacional
          const cons = consumoReal(d.abast.filter(a => a.veiculo_id === v.id), v)
          const planos = d.planos.filter(p => p.veiculo_id === v.id && p.ativo !== false).map(p => ({ p, s: situacaoDoPlano(p, v) }))
          const proximo = planos.sort((a, b) => ['vencido', 'proximo', 'em_dia', 'sem_dados'].indexOf(a.s.situacao) - ['vencido', 'proximo', 'em_dia', 'sem_dados'].indexOf(b.s.situacao))[0]
          return (
            <div key={v.id} style={{ ...card, marginBottom: 0, borderLeft: `4px solid ${s.cor}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: theme.text }}>{v.placa || '—'}</div>
                  <div style={{ fontSize: 12, color: theme.textMuted }}>{ROTULO_TIPO[v.tipo]} · {[v.marca, v.modelo, v.ano].filter(Boolean).join(' ')}</div>
                </div>
                {pill(s.cor, s.bg, s.rotulo)}
              </div>
              <div style={{ fontSize: 12.5, color: theme.text, marginTop: 8 }}>
                {medidorDe(v) === 'horas' ? `⏱️ ${n1(v.horimetro, 0)} h` : `🛣️ ${n1(v.km_atual, 0)} km`}
                {cons.media != null && <> · ⛽ {n1(cons.media)} {cons.unidade}{cons.esperado ? <span style={{ color: theme.textFaint2 }}> (esp. {n1(cons.esperado)})</span> : ''}</>}
              </div>
              {(v.base || v.capacidade) && <div style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 4 }}>{[v.base && `📍 ${v.base}`, v.capacidade && `📦 ${v.capacidade}`].filter(Boolean).join(' · ')}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, marginTop: 6 }}>{doc(v.ipva_venc, 'IPVA')}{doc(v.licenciamento_venc, 'Licenc.')}{doc(v.seguro_venc, 'Seguro')}</div>
              {proximo && <div style={{ fontSize: 11.5, marginTop: 6, color: proximo.s.situacao === 'vencido' ? theme.dangerText : proximo.s.situacao === 'proximo' ? '#B45309' : theme.textMuted }}>🔧 {proximo.p.servico}: {descreverFalta(proximo.s.pior)}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <button style={{ ...btn(theme.bg, theme.text), padding: '5px 10px' }} onClick={() => abrir('veiculo', v)}>✏️ Editar</button>
                <button style={{ ...btn(theme.bg, theme.text), padding: '5px 10px' }} onClick={() => abrir('abastecimento', { veiculo_id: v.id })}>⛽</button>
                <button style={{ ...btn(theme.bg, theme.text), padding: '5px 10px' }} onClick={() => abrir('manutencao', { veiculo_id: v.id })}>🔧</button>
                <button style={{ ...btn(theme.bg, theme.text), padding: '5px 10px' }} onClick={() => abrir('plano', { veiculo_id: v.id })}>+ Plano</button>
                <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '5px 10px', marginLeft: 'auto' }} onClick={() => apagar('veiculos', v.id, `Excluir ${v.placa}? Some junto o histórico de abastecimentos, planos e checklists. Pra só tirar de uso, edite e mude o status para Baixado.`)}>🗑️</button>
              </div>
            </div>
          )
        })}
      </div>
      {lista.length === 0 && <div style={{ ...card, textAlign: 'center', color: theme.textMuted }}>Nenhum veículo cadastrado.</div>}
    </>
  )
}

// ── Abastecimentos ───────────────────────────────────────────────────────────────────
function Abastecimentos({ ui, d, porId, abrir, apagar }) {
  const { theme, card, btn, th, td, pill } = ui
  const [veic, setVeic] = useState('')
  const lista = d.abast.filter(a => !veic || a.veiculo_id === veic).sort((a, b) => String(b.data).localeCompare(String(a.data)) || (Number(b.km) || 0) - (Number(a.km) || 0))
  // Consumo do trecho que termina em cada abastecimento de tanque cheio.
  const consumoNo = useMemo(() => {
    const m = {}
    d.veiculos.forEach(v => consumoReal(d.abast.filter(a => a.veiculo_id === v.id), v).trechos.forEach(t => { m[t.ate.id] = { t, v } }))
    return m
  }, [d])
  const preco = precoMedioCombustivel(lista)
  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn('#059669')} onClick={() => abrir('abastecimento', { veiculo_id: veic || d.veiculos[0]?.id, tanque_cheio: true })}>+ Abastecimento</button>
        <select style={{ ...ui.campo, width: 'auto' }} value={veic} onChange={e => setVeic(e.target.value)}><option value="">Todos os veículos</option>{d.veiculos.map(v => <option key={v.id} value={v.id}>{nomeV(v)}</option>)}</select>
        <div style={{ fontSize: 12, color: theme.textMuted }}>{lista.length} abastecimentos{preco ? ` · preço médio ${moeda(preco)}/L` : ''}</div>
      </div>
      <div style={{ fontSize: 11.5, color: theme.textMuted, margin: '-6px 4px 10px' }}>O consumo real sai entre dois abastecimentos de <b>tanque cheio</b> (os parciais do meio entram na conta). Gerador: litros por hora, pelo horímetro.</div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr style={{ background: theme.bg }}>{['Data', 'Veículo', 'Km / h', 'Litros', 'Valor', 'R$/L', 'Consumo', 'Motorista', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{lista.slice(0, 400).map(a => {
            const v = porId[a.veiculo_id]; const c = consumoNo[a.id]
            const ruim = c && c.v.consumo_esperado && (medidorDe(c.v) === 'horas' ? c.t.consumo > c.v.consumo_esperado * 1.1 : c.t.consumo < c.v.consumo_esperado * 0.9)
            return (
              <tr key={a.id}>
                <td style={td}>{br(a.data)}</td><td style={td}>{nomeV(v)}</td>
                <td style={td}>{n1(a.km ?? a.horimetro, 0)}{!a.tanque_cheio && <div style={{ fontSize: 10, color: theme.textFaint2 }}>parcial</div>}</td>
                <td style={td}>{n1(a.litros)}</td><td style={td}>{moeda(a.valor)}</td><td style={td}>{a.litros ? moeda(a.valor / a.litros) : '—'}</td>
                <td style={td}>{c ? <>{n1(c.t.consumo, 2)} {medidorDe(c.v) === 'horas' ? 'L/h' : 'km/L'} {ruim && pill(theme.dangerText, theme.dangerBg, 'abaixo do esperado')}</> : '—'}</td>
                <td style={td}>{a.motorista_nome || '—'}{a.posto && <div style={{ fontSize: 10.5, color: theme.textFaint2 }}>{a.posto}</div>}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button style={{ ...btn(theme.bg, theme.text), padding: '4px 9px' }} onClick={() => abrir('abastecimento', a)}>✏️</button>
                  <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '4px 9px', marginLeft: 4 }} onClick={() => apagar('frota_abastecimentos', a.id, 'Excluir este abastecimento?')}>🗑️</button>
                </td>
              </tr>
            )
          })}</tbody>
        </table>
        {lista.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>Nenhum abastecimento. Os pilotos também lançam pelo app.</div>}
      </div>
    </>
  )
}

// ── Manutenção ───────────────────────────────────────────────────────────────────────
function Manutencao({ ui, d, porId, abrir, apagar }) {
  const { theme, card, btn, titulo, th, td, pill } = ui
  const ordem = ['vencido', 'proximo', 'em_dia', 'sem_dados']
  const planos = d.planos.filter(p => p.ativo !== false && porId[p.veiculo_id] && porId[p.veiculo_id].status !== 'baixado')
    .map(p => ({ p, v: porId[p.veiculo_id], s: situacaoDoPlano(p, porId[p.veiculo_id]) }))
    .sort((a, b) => ordem.indexOf(a.s.situacao) - ordem.indexOf(b.s.situacao))
  const cor = { vencido: [theme.dangerText, theme.dangerBg], proximo: ['#B45309', '#FEF3C7'], em_dia: ['#059669', '#DCFCE7'], sem_dados: [theme.textMuted, theme.bg] }
  const hist = [...d.manut].sort((a, b) => String(b.data).localeCompare(String(a.data)))
  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ ...titulo, marginBottom: 0 }}>📅 Planos de manutenção</div>
          <button style={btn('#059669')} onClick={() => abrir('plano', { veiculo_id: d.veiculos[0]?.id })}>+ Plano</button>
        </div>
        <div style={{ fontSize: 11.5, color: theme.textMuted, marginBottom: 8 }}>Cada plano vence pelo que chegar primeiro: km, horas ou meses. Ao registrar o serviço, o plano recomeça do km/data daquele dia.</div>
        {planos.length === 0 ? <div style={{ fontSize: 12.5, color: theme.textMuted }}>Nenhum plano. No cadastro de cada veículo dá pra criar os planos sugeridos de uma vez.</div> : (
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
            <thead><tr>{['Veículo', 'Serviço', 'Intervalo', 'Última vez', 'Situação', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{planos.map(({ p, v, s }) => (
              <tr key={p.id}>
                <td style={td}>{nomeV(v)}</td><td style={td}><b>{p.servico}</b></td>
                <td style={td}>{[p.intervalo_km && `${n1(p.intervalo_km, 0)} km`, p.intervalo_horas && `${n1(p.intervalo_horas, 0)} h`, p.intervalo_meses && `${p.intervalo_meses} meses`].filter(Boolean).join(' ou ')}</td>
                <td style={td}>{[p.ultimo_km != null && `${n1(p.ultimo_km, 0)} km`, p.ultimo_horas != null && `${n1(p.ultimo_horas, 0)} h`, p.ultima_data && br(p.ultima_data)].filter(Boolean).join(' · ') || '—'}</td>
                <td style={td}>{pill(cor[s.situacao][0], cor[s.situacao][1], ROTULO_SITUACAO[s.situacao])} <span style={{ fontSize: 11.5, color: theme.textMuted }}>{descreverFalta(s.pior)}</span></td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button style={{ ...btn('#059669'), padding: '4px 10px' }} onClick={() => abrir('manutencao', { veiculo_id: v.id, plano_id: p.id, tipo: p.servico, categoria: 'preventiva' })}>✓ Feito</button>
                  <button style={{ ...btn(theme.bg, theme.text), padding: '4px 9px', marginLeft: 4 }} onClick={() => abrir('plano', p)}>✏️</button>
                  <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '4px 9px', marginLeft: 4 }} onClick={() => apagar('frota_planos', p.id, `Excluir o plano "${p.servico}"?`)}>🗑️</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ ...titulo, marginBottom: 0 }}>🧾 Histórico</div>
          <button style={btn(theme.bg, theme.text)} onClick={() => abrir('manutencao', { veiculo_id: d.veiculos[0]?.id, categoria: 'corretiva' })}>+ Manutenção</button>
        </div>
        {hist.length === 0 ? <div style={{ fontSize: 12.5, color: theme.textMuted }}>Nenhuma manutenção registrada.</div> : (
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr>{['Data', 'Veículo', 'Serviço', 'Km / h', 'Oficina', 'Valor', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{hist.slice(0, 300).map(m => (
              <tr key={m.id}>
                <td style={td}>{br(m.data)}</td><td style={td}>{nomeV(porId[m.veiculo_id])}</td>
                <td style={td}><b>{m.tipo || '—'}</b><div style={{ fontSize: 10.5, color: theme.textFaint2 }}>{(CATEGORIAS_MANUTENCAO.find(c => c[0] === m.categoria) || [])[1] || ''}</div></td>
                <td style={td}>{n1(m.km ?? m.horas, 0)}</td><td style={td}>{m.oficina || '—'}{m.os_oficina && <div style={{ fontSize: 10.5, color: theme.textFaint2 }}>OS {m.os_oficina}</div>}</td>
                <td style={td}>{moeda((Number(m.valor_pecas) || 0) + (Number(m.valor_mao_obra) || 0) || Number(m.custo) || 0)}</td>
                <td style={td}>{m.status === 'concluida' ? pill('#059669', '#DCFCE7', 'Concluída') : m.status === 'em_andamento' ? pill('#B45309', '#FEF3C7', 'Na oficina') : pill(theme.textMuted, theme.bg, 'Agendada')}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button style={{ ...btn(theme.bg, theme.text), padding: '4px 9px' }} onClick={() => abrir('manutencao', m)}>✏️</button>
                  <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '4px 9px', marginLeft: 4 }} onClick={() => apagar('manutencoes_veiculo', m.id, 'Excluir esta manutenção?')}>🗑️</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  )
}

// ── Viagens ──────────────────────────────────────────────────────────────────────────
function Viagens({ ui, d, porId, abrir, apagar }) {
  const { theme, card, btn, th, td } = ui
  const [f, setF] = useState({ veiculo: '', cliente: '', mes: mesAtual() })
  const lista = d.viagens.filter(v => (!f.veiculo || v.veiculo_id === f.veiculo) && (!f.cliente || v.cliente === f.cliente) && (!f.mes || String(v.data).startsWith(f.mes)))
  // Custo da viagem: km × custo operacional por km do veículo (combustível + manutenção), pelos
  // últimos 90 dias; sem histórico, consumo esperado × preço médio do combustível.
  const custoKm = useMemo(() => {
    const m = {}, hoje = hojeISO(), ini = somarDias(hoje, -90), preco = precoMedioCombustivel(d.abast) || 6
    d.veiculos.forEach(v => {
      const c = custosDoVeiculo(v, { abastecimentos: d.abast, manutencoes: d.manut, viagens: d.viagens, ini, fim: hoje })
      m[v.id] = c.custoOperacionalPorUnidade || (Number(v.consumo_esperado) > 0 ? preco / Number(v.consumo_esperado) : null)
    })
    return m
  }, [d])
  const km = v => Math.max(0, (Number(v.km_final) || 0) - (Number(v.km_inicial) || 0))
  const totKm = lista.reduce((s, v) => s + km(v), 0), totCusto = lista.reduce((s, v) => s + km(v) * (custoKm[v.veiculo_id] || 0), 0)
  const clientes = [...new Set(d.viagens.map(v => v.cliente).filter(Boolean))].sort()
  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn('#059669')} onClick={() => abrir('viagem', { veiculo_id: d.veiculos[0]?.id, data: hojeISO(), finalidade: FINALIDADES_VIAGEM[0] })}>+ Viagem</button>
        <select style={{ ...ui.campo, width: 'auto' }} value={f.veiculo} onChange={e => setF(x => ({ ...x, veiculo: e.target.value }))}><option value="">Todos os veículos</option>{d.veiculos.map(v => <option key={v.id} value={v.id}>{nomeV(v)}</option>)}</select>
        <select style={{ ...ui.campo, width: 'auto' }} value={f.cliente} onChange={e => setF(x => ({ ...x, cliente: e.target.value }))}><option value="">Todos os clientes</option>{clientes.map(c => <option key={c}>{c}</option>)}</select>
        <input type="month" style={{ ...ui.campo, width: 'auto' }} value={f.mes} onChange={e => setF(x => ({ ...x, mes: e.target.value }))} />
        <div style={{ fontSize: 12, color: theme.textMuted }}>{lista.length} viagens · {n1(totKm, 0)} km · custo estimado <b>{moeda(totCusto)}</b></div>
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr style={{ background: theme.bg }}>{['Data', 'Veículo', 'Motorista', 'Cliente / fazenda', 'Finalidade', 'Km', 'Custo estimado', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{lista.map(v => (
            <tr key={v.id}>
              <td style={td}>{br(v.data)}</td><td style={td}>{nomeV(porId[v.veiculo_id])}</td><td style={td}>{v.motorista || '—'}</td>
              <td style={td}>{[v.cliente, v.fazenda].filter(Boolean).join(' · ') || v.destino || '—'}{v.ordem_servico && <div style={{ fontSize: 10.5, color: theme.textFaint2 }}>OS {v.ordem_servico}</div>}</td>
              <td style={td}>{v.finalidade || '—'}</td>
              <td style={td}>{n1(km(v), 0)}<div style={{ fontSize: 10.5, color: theme.textFaint2 }}>{n1(v.km_inicial, 0)} → {n1(v.km_final, 0)}</div></td>
              <td style={td}>{custoKm[v.veiculo_id] ? moeda(km(v) * custoKm[v.veiculo_id]) : '—'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button style={{ ...btn(theme.bg, theme.text), padding: '4px 9px' }} onClick={() => abrir('viagem', v)}>✏️</button>
                <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '4px 9px', marginLeft: 4 }} onClick={() => apagar('viagens', v.id, 'Excluir esta viagem?')}>🗑️</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {lista.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>Nenhuma viagem no filtro. Os pilotos também lançam pelo app, junto da nota.</div>}
      </div>
    </>
  )
}

// ── Checklists ───────────────────────────────────────────────────────────────────────
function Checklists({ ui, d, porId, supabase, showToast, recarregar }) {
  const { theme, card, btn, titulo, pill } = ui
  const [aberto, setAberto] = useState(null)
  const [obs, setObs] = useState('')
  const bloqueados = d.veiculos.filter(v => v.status === 'bloqueado')
  const lista = [...d.checks].sort((a, b) => String(b.feito_em).localeCompare(String(a.feito_em)))
  const corR = { aprovado: ['#059669', '#DCFCE7'], pendencia: ['#B45309', '#FEF3C7'], reprovado: [theme.dangerText, theme.dangerBg] }
  async function liberar(v, ck) {
    if (!obs.trim() && !window.confirm('Liberar sem anotar o que foi resolvido?')) return
    const { data: { user } } = await supabase.auth.getUser()
    const { error: e1 } = await supabase.from('veiculos').update({ status: 'operacional' }).eq('id', v.id)
    const { error: e2 } = ck ? await supabase.from('frota_checklists').update({ liberado_por: user?.id || null, liberado_em: new Date().toISOString(), liberacao_obs: obs || null }).eq('id', ck.id) : { error: null }
    if (e1 || e2) { showToast('Erro: ' + (e1 || e2).message, 'error'); return }
    showToast('✅ Veículo liberado'); setObs(''); recarregar()
  }
  return (
    <>
      {bloqueados.length > 0 && (
        <div style={{ ...card, border: `2px solid ${theme.dangerText}` }}>
          <div style={titulo}>⛔ Bloqueados aguardando liberação</div>
          {bloqueados.map(v => {
            const ck = lista.find(c => c.veiculo_id === v.id && c.resultado === 'reprovado')
            const falhas = (ck?.itens || []).filter(i => i.ok === false)
            return (
              <div key={v.id} style={{ borderTop: `1px solid ${theme.divider}`, padding: '10px 0' }}>
                <div style={{ fontWeight: 700, color: theme.text }}>{nomeV(v)}</div>
                {ck && <div style={{ fontSize: 12, color: theme.textMuted }}>{ck.motorista_nome || 'motorista'} em {new Date(ck.feito_em).toLocaleString('pt-BR')}</div>}
                {falhas.map(i => <div key={i.id} style={{ fontSize: 12.5, color: i.critico ? theme.dangerText : '#B45309', marginTop: 3 }}>{i.critico ? '⛔' : '⚠️'} {i.texto}{i.obs ? ` — ${i.obs}` : ''}</div>)}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input style={{ ...ui.campo, flex: 1, minWidth: 200 }} placeholder="O que foi resolvido (ex.: pneu trocado)" value={obs} onChange={e => setObs(e.target.value)} />
                  <button style={btn('#059669')} onClick={() => liberar(v, ck)}>Liberar veículo</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div style={card}>
        <div style={titulo}>Checklists de saída</div>
        <div style={{ fontSize: 11.5, color: theme.textMuted, marginBottom: 8 }}>O piloto faz pelo app antes de sair: o veículo e o kit da operação (drones, baterias, gerador, EPI, documentos). Item crítico reprovado bloqueia o veículo até um gestor liberar aqui.</div>
        {lista.length === 0 ? <div style={{ fontSize: 12.5, color: theme.textMuted }}>Nenhum checklist ainda.</div> : lista.slice(0, 200).map(c => {
          const v = porId[c.veiculo_id]; const [cor, bg] = corR[c.resultado] || corR.aprovado
          const falhas = (c.itens || []).filter(i => i.ok === false)
          return (
            <div key={c.id} style={{ borderTop: `1px solid ${theme.divider}`, padding: '8px 0', cursor: 'pointer' }} onClick={() => setAberto(aberto === c.id ? null : c.id)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: theme.text }}>
                <span style={{ width: 130, color: theme.textMuted }}>{new Date(c.feito_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <b>{nomeV(v)}</b><span style={{ color: theme.textMuted }}>{c.motorista_nome || ''}{c.destino ? ` → ${c.destino}` : ''}</span>
                <span style={{ marginLeft: 'auto' }}>{pill(cor, bg, ROTULO_RESULTADO[c.resultado])}</span>
                {c.liberado_em && pill('#059669', '#DCFCE7', `liberado ${new Date(c.liberado_em).toLocaleDateString('pt-BR')}`)}
              </div>
              {falhas.length > 0 && aberto !== c.id && <div style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 2 }}>{falhas.map(i => i.texto).join(' · ')}</div>}
              {aberto === c.id && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {(c.itens || []).map(i => <div key={i.id} style={{ color: i.ok === false ? (i.critico ? theme.dangerText : '#B45309') : theme.textMuted }}>{i.ok === false ? '✗' : i.ok ? '✓' : '·'} {i.texto}{i.obs ? ` — ${i.obs}` : ''}</div>)}
                  {c.observacao && <div style={{ marginTop: 4, color: theme.text }}>Obs.: {c.observacao}</div>}
                  {c.liberacao_obs && <div style={{ marginTop: 4, color: '#059669' }}>Liberação: {c.liberacao_obs}</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Baterias ─────────────────────────────────────────────────────────────────────────
function Baterias({ ui, d, abrir, apagar }) {
  const { theme, card, btn, th, td, pill } = ui
  const lista = [...d.baterias].sort((a, b) => (b.ciclos || 0) / (b.ciclos_limite || 1) - (a.ciclos || 0) / (a.ciclos_limite || 1))
  const ativas = lista.filter(b => b.status !== 'descartada')
  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn('#059669')} onClick={() => abrir('bateria', { modelo: 'DB1560', ciclos: 0, ciclos_limite: 1500, garantia_meses: 12, status: 'ativa' })}>+ Bateria</button>
        <div style={{ fontSize: 12, color: theme.textMuted, flex: 1 }}>{ativas.length} em uso. Garantia DJI das baterias T50/T25: 1.500 ciclos ou 12 meses, o que vier primeiro. Os ciclos aparecem no controle e no app DJI SmartFarm — atualize uma vez por mês.</div>
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr style={{ background: theme.bg }}>{['Código', 'Modelo', 'Ciclos', 'Uso', 'Garantia até', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{lista.map(b => {
            const s = situacaoBateria(b)
            const cor = s.nivel === 'fim' ? theme.dangerText : s.nivel === 'atencao' ? '#B45309' : '#059669'
            return (
              <tr key={b.id}>
                <td style={td}><b>{b.codigo}</b>{b.drone_modelo && <div style={{ fontSize: 10.5, color: theme.textFaint2 }}>{b.drone_modelo}</div>}</td>
                <td style={td}>{b.modelo || '—'}</td>
                <td style={td}>{b.ciclos} / {b.ciclos_limite}{s.desatualizada && <div style={{ fontSize: 10.5, color: '#B45309' }}>atualizar</div>}</td>
                <td style={{ ...td, minWidth: 120 }}><div style={{ height: 7, background: theme.divider, borderRadius: 6 }}><div style={{ height: '100%', width: `${Math.min(100, s.uso * 100)}%`, background: cor, borderRadius: 6 }} /></div><div style={{ fontSize: 10.5, color: cor }}>{Math.round(s.uso * 100)}%</div></td>
                <td style={{ ...td, color: s.garantiaVencida ? theme.dangerText : theme.text }}>{br(s.garantiaAte)}</td>
                <td style={td}>{pill(b.status === 'ativa' ? '#059669' : theme.textMuted, b.status === 'ativa' ? '#DCFCE7' : theme.bg, b.status)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button style={{ ...btn(theme.bg, theme.text), padding: '4px 9px' }} onClick={() => abrir('bateria', b)}>✏️</button>
                  <button style={{ ...btn(theme.dangerBg, theme.dangerText), padding: '4px 9px', marginLeft: 4 }} onClick={() => apagar('frota_baterias', b.id, `Excluir a bateria ${b.codigo}?`)}>🗑️</button>
                </td>
              </tr>
            )
          })}</tbody>
        </table>
        {lista.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>Nenhuma bateria cadastrada. Use o número de série ou uma etiqueta (ex.: B-01).</div>}
      </div>
    </>
  )
}

// ── Motoristas (CNH) ─────────────────────────────────────────────────────────────────
function Motoristas({ ui, d, pilotos, abrir }) {
  const { theme, card, btn, th, td, pill } = ui
  const hoje = hojeISO()
  const porPiloto = Object.fromEntries(d.cnhs.map(c => [c.piloto_id, c]))
  const lista = pilotos.filter(p => p.ativo !== false && ['piloto', 'supervisor', 'admin'].includes(p.role)).sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
  return (
    <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
      <div style={{ padding: '12px 14px', fontSize: 12, color: theme.textMuted }}>CNH de quem dirige os veículos. O alerta aparece 30 dias antes do vencimento.</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
        <thead><tr style={{ background: theme.bg }}>{['Nome', 'CNH', 'Categoria', 'Validade', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{lista.map(p => {
          const c = porPiloto[p.id]
          const dias = c?.validade ? Math.round((Date.parse(c.validade) - Date.parse(hoje)) / 86400000) : null
          return (
            <tr key={p.id}>
              <td style={td}>{p.nome || p.email}</td><td style={td}>{c?.numero || '—'}</td><td style={td}>{c?.categoria || '—'}</td>
              <td style={td}>{c?.validade ? <>{br(c.validade)} {dias < 0 ? pill(theme.dangerText, theme.dangerBg, 'vencida') : dias <= 30 ? pill('#B45309', '#FEF3C7', `${dias} dias`) : ''}</> : '—'}</td>
              <td style={td}><button style={{ ...btn(theme.bg, theme.text), padding: '4px 9px' }} onClick={() => abrir('cnh', { piloto_id: p.id, nome: p.nome || p.email, ...(c || {}) })}>✏️</button></td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

// ── Formulários ──────────────────────────────────────────────────────────────────────
function Formulario({ ui, modal, fechar, d, porId, gravar, salvo, supabase, showToast, clientes, fazendas, pilotos }) {
  const { theme, campo, rot, btn, isMobile } = ui
  const [f, setF] = useState(modal.dados)
  const [salvando, setSalvando] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const C = ({ k, l, tipo = 'text', ph, larg }) => (
    <div style={larg ? { gridColumn: '1 / -1' } : null}><div style={rot}>{l}</div><input type={tipo} style={campo} placeholder={ph} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} /></div>
  )
  const S = ({ k, l, opcoes }) => (
    <div><div style={rot}>{l}</div><select style={campo} value={f[k] ?? ''} onChange={e => set(k, e.target.value)}>{opcoes.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
  )
  const veicOpts = d.veiculos.map(v => [v.id, nomeV(v)])
  const v = porId[f.veiculo_id]
  const horas = v && medidorDe(v) === 'horas'
  const nums = (o, ks) => { const r = { ...o }; ks.forEach(k => { r[k] = numBR(o[k]) }); return r }
  const vazio = o => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, x === '' ? null : x]))

  async function salvar() {
    setSalvando(true)
    try {
      const t = modal.tipo
      if (t === 'veiculo') {
        if (!f.placa?.trim()) { showToast('Informe a placa (ou um código, no caso do gerador)', 'error'); return }
        const linha = vazio(nums({ placa: f.placa.trim().toUpperCase(), marca: f.marca, modelo: f.modelo, ano: f.ano, tipo: f.tipo, medidor: f.tipo === 'gerador' ? 'horas' : f.medidor || 'km', km_atual: f.km_atual, horimetro: f.horimetro,
          consumo_esperado: f.consumo_esperado, combustivel: f.combustivel, status: f.status || 'operacional', ativo: f.status !== 'baixado', base: f.base, capacidade: f.capacidade, renavam: f.renavam, chassi: f.chassi,
          valor_compra: f.valor_compra, data_compra: f.data_compra, ipva_venc: f.ipva_venc, ipva_valor: f.ipva_valor, licenciamento_venc: f.licenciamento_venc, licenciamento_valor: f.licenciamento_valor,
          seguro_venc: f.seguro_venc, seguro_valor: f.seguro_valor, seguro_apolice: f.seguro_apolice, observacao: f.observacao }, ['ano', 'km_atual', 'horimetro', 'consumo_esperado', 'valor_compra', 'ipva_valor', 'licenciamento_valor', 'seguro_valor']))
        if (f.id) { if (!await gravar('veiculos', linha, f.id)) return }
        else {
          const { data: novo, error } = await supabase.from('veiculos').insert(linha).select().single()
          if (error) { showToast('Erro: ' + error.message, 'error'); return }
          // Planos sugeridos pro tipo, já começando do km/horímetro/data de hoje.
          if (f.criarPlanos) {
            const sug = PLANOS_SUGERIDOS[linha.tipo === 'gerador' ? 'gerador' : linha.tipo === 'moto' ? 'moto' : 'caminhonete'] || []
            const hoje = hojeISO()
            const { error: e2 } = await supabase.from('frota_planos').insert(sug.map(([servico, km, h, meses]) => ({ veiculo_id: novo.id, servico, intervalo_km: km, intervalo_horas: h, intervalo_meses: meses, ultimo_km: km ? linha.km_atual : null, ultimo_horas: h ? linha.horimetro : null, ultima_data: hoje })))
            if (e2) showToast('Veículo salvo, mas os planos não: ' + e2.message, 'error')
          }
        }
        salvo('✅ Veículo salvo')
      } else if (t === 'abastecimento') {
        const linha = vazio(nums({ veiculo_id: f.veiculo_id, data: f.data || hojeISO(), km: horas ? null : f.km, horimetro: horas ? f.horimetro : null, litros: f.litros, valor: f.valor, combustivel: f.combustivel, posto: f.posto, tanque_cheio: f.tanque_cheio !== false, motorista_nome: f.motorista_nome, observacao: f.observacao }, ['km', 'horimetro', 'litros', 'valor']))
        if (!linha.veiculo_id || !(linha.litros > 0) || linha.valor == null) { showToast('Veículo, litros e valor são obrigatórios', 'error'); return }
        if (!await gravar('frota_abastecimentos', linha, f.id)) return
        // Leva o km/horímetro do veículo pra frente (nunca pra trás).
        const leitura = horas ? linha.horimetro : linha.km
        if (leitura != null && v && leitura > (leituraDe(v) || 0)) await supabase.from('veiculos').update(horas ? { horimetro: leitura } : { km_atual: leitura }).eq('id', v.id)
        salvo('✅ Abastecimento salvo')
      } else if (t === 'manutencao') {
        const linha = vazio(nums({ veiculo_id: f.veiculo_id, data: f.data || hojeISO(), tipo: f.tipo, categoria: f.categoria, km: horas ? null : f.km, horas: horas ? f.horas : null, oficina: f.oficina, os_oficina: f.os_oficina,
          valor_pecas: f.valor_pecas, valor_mao_obra: f.valor_mao_obra, status: f.status || 'concluida', data_saida: f.data_saida, observacao: f.observacao, plano_id: f.plano_id }, ['km', 'horas', 'valor_pecas', 'valor_mao_obra']))
        linha.custo = (linha.valor_pecas || 0) + (linha.valor_mao_obra || 0) || null
        if (!linha.veiculo_id || !linha.tipo) { showToast('Veículo e serviço são obrigatórios', 'error'); return }
        if (!await gravar('manutencoes_veiculo', linha, f.id)) return
        // Concluída de um plano: o plano recomeça daqui.
        if (linha.plano_id && linha.status === 'concluida') await supabase.from('frota_planos').update({ ultimo_km: linha.km ?? undefined, ultimo_horas: linha.horas ?? undefined, ultima_data: linha.data }).eq('id', linha.plano_id)
        // Status do veículo acompanha a oficina.
        if (v && linha.status === 'em_andamento' && v.status === 'operacional') await supabase.from('veiculos').update({ status: 'manutencao' }).eq('id', v.id)
        if (v && linha.status === 'concluida' && v.status === 'manutencao') await supabase.from('veiculos').update({ status: 'operacional' }).eq('id', v.id)
        const leitura = horas ? linha.horas : linha.km
        if (leitura != null && v && leitura > (leituraDe(v) || 0)) await supabase.from('veiculos').update(horas ? { horimetro: leitura } : { km_atual: leitura }).eq('id', v.id)
        salvo('✅ Manutenção salva')
      } else if (t === 'plano') {
        const linha = vazio(nums({ veiculo_id: f.veiculo_id, servico: f.servico, intervalo_km: f.intervalo_km, intervalo_horas: f.intervalo_horas, intervalo_meses: f.intervalo_meses, ultimo_km: f.ultimo_km, ultimo_horas: f.ultimo_horas, ultima_data: f.ultima_data, ativo: f.ativo !== false }, ['intervalo_km', 'intervalo_horas', 'intervalo_meses', 'ultimo_km', 'ultimo_horas']))
        if (!linha.veiculo_id || !linha.servico || !(linha.intervalo_km || linha.intervalo_horas || linha.intervalo_meses)) { showToast('Veículo, serviço e pelo menos um intervalo', 'error'); return }
        if (!await gravar('frota_planos', linha, f.id)) return
        salvo('✅ Plano salvo')
      } else if (t === 'viagem') {
        const linha = vazio(nums({ veiculo_id: f.veiculo_id, data: f.data || hojeISO(), motorista: f.motorista, cliente: f.cliente, fazenda: f.fazenda, destino: f.destino, finalidade: f.finalidade, ordem_servico: f.ordem_servico, km_inicial: f.km_inicial, km_final: f.km_final, observacao: f.observacao }, ['km_inicial', 'km_final']))
        if (!linha.veiculo_id || linha.km_inicial == null || linha.km_final == null || linha.km_final < linha.km_inicial) { showToast('Veículo e km inicial/final (final maior que o inicial)', 'error'); return }
        if (!await gravar('viagens', linha, f.id)) return
        if (v && linha.km_final > (Number(v.km_atual) || 0)) await supabase.from('veiculos').update({ km_atual: linha.km_final }).eq('id', v.id)
        salvo('✅ Viagem salva')
      } else if (t === 'bateria') {
        const linha = vazio(nums({ codigo: f.codigo, modelo: f.modelo, drone_modelo: f.drone_modelo, ciclos: f.ciclos, ciclos_limite: f.ciclos_limite, data_compra: f.data_compra, garantia_meses: f.garantia_meses, status: f.status || 'ativa', observacao: f.observacao }, ['ciclos', 'ciclos_limite', 'garantia_meses']))
        if (!linha.codigo) { showToast('Informe o código da bateria', 'error'); return }
        if (f.id && Number(modal.dados.ciclos) !== linha.ciclos) linha.ciclos_atualizado_em = hojeISO()
        if (!f.id) linha.ciclos_atualizado_em = hojeISO()
        if (!await gravar('frota_baterias', linha, f.id)) return
        salvo('✅ Bateria salva')
      } else if (t === 'cnh') {
        const { error } = await supabase.from('frota_cnh').upsert({ piloto_id: f.piloto_id, nome: f.nome, numero: f.numero || null, categoria: f.categoria || null, validade: f.validade || null, updated_at: new Date().toISOString() })
        if (error) { showToast('Erro: ' + error.message, 'error'); return }
        salvo('✅ CNH salva')
      }
    } finally { setSalvando(false) }
  }

  const titulos = { veiculo: f.id ? 'Editar veículo' : 'Novo veículo ou gerador', abastecimento: 'Abastecimento', manutencao: 'Manutenção', plano: 'Plano de manutenção', viagem: 'Viagem', bateria: 'Bateria', cnh: `CNH — ${f.nome || ''}` }
  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }
  const secao = t => <div style={{ gridColumn: '1 / -1', fontSize: 11.5, fontWeight: 800, color: '#059669', marginTop: 6 }}>{t}</div>
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={fechar}>
      <div style={{ background: theme.card, borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '90vh', overflow: 'auto', padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 17, fontWeight: 700, color: theme.text, marginBottom: 12 }}>{titulos[modal.tipo]}</div>
        <div style={grid}>
          {modal.tipo === 'veiculo' && <>
            {S({ k: 'tipo', l: 'TIPO', opcoes: TIPOS_VEICULO })}
            {C({ k: 'placa', l: f.tipo === 'gerador' ? 'CÓDIGO / Nº DE SÉRIE' : 'PLACA' })}
            {S({ k: 'status', l: 'STATUS', opcoes: Object.entries(STATUS_VEICULO).map(([k, s]) => [k, s.rotulo]) })}
            {C({ k: 'marca', l: 'MARCA' })}{C({ k: 'modelo', l: 'MODELO' })}{C({ k: 'ano', l: 'ANO', tipo: 'number' })}
            {f.tipo === 'gerador' ? C({ k: 'horimetro', l: 'HORÍMETRO ATUAL (h)' }) : C({ k: 'km_atual', l: 'KM ATUAL' })}
            {C({ k: 'consumo_esperado', l: f.tipo === 'gerador' ? 'CONSUMO ESPERADO (L/h)' : 'CONSUMO ESPERADO (km/L)' })}
            {S({ k: 'combustivel', l: 'COMBUSTÍVEL', opcoes: [['', '—'], ['Diesel S10', 'Diesel S10'], ['Gasolina', 'Gasolina'], ['Etanol', 'Etanol'], ['Flex', 'Flex']] })}
            {C({ k: 'base', l: 'BASE / CENTRO DE CUSTO', ph: 'ex.: Base Lençóis, frente Bracell' })}
            {C({ k: 'capacidade', l: 'LEVA', ph: 'ex.: 2 drones + gerador + 6 baterias', larg: !isMobile })}
            {secao('Documentos e custos fixos')}
            {C({ k: 'ipva_venc', l: 'IPVA VENCE EM', tipo: 'date' })}{C({ k: 'ipva_valor', l: 'IPVA (R$/ANO)' })}{C({ k: 'renavam', l: 'RENAVAM' })}
            {C({ k: 'licenciamento_venc', l: 'LICENCIAMENTO VENCE EM', tipo: 'date' })}{C({ k: 'licenciamento_valor', l: 'LICENCIAMENTO (R$)' })}{C({ k: 'chassi', l: 'CHASSI' })}
            {C({ k: 'seguro_venc', l: 'SEGURO VENCE EM', tipo: 'date' })}{C({ k: 'seguro_valor', l: 'SEGURO (R$/ANO)' })}{C({ k: 'seguro_apolice', l: 'APÓLICE' })}
            {C({ k: 'valor_compra', l: 'VALOR DE COMPRA (R$)' })}{C({ k: 'data_compra', l: 'DATA DA COMPRA', tipo: 'date' })}
            {C({ k: 'observacao', l: 'OBSERVAÇÃO', larg: true })}
            {!f.id && <label style={{ gridColumn: '1 / -1', fontSize: 12.5, color: theme.text, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.criarPlanos !== false} onChange={e => set('criarPlanos', e.target.checked)} /> Criar os planos de manutenção sugeridos pra esse tipo (troca de óleo, revisão...), começando de hoje</label>}
          </>}
          {modal.tipo === 'abastecimento' && <>
            {S({ k: 'veiculo_id', l: 'VEÍCULO', opcoes: veicOpts })}{C({ k: 'data', l: 'DATA', tipo: 'date' })}
            {horas ? C({ k: 'horimetro', l: 'HORÍMETRO (h)' }) : C({ k: 'km', l: 'KM NO ABASTECIMENTO' })}
            {C({ k: 'litros', l: 'LITROS' })}{C({ k: 'valor', l: 'VALOR TOTAL (R$)' })}
            {S({ k: 'combustivel', l: 'COMBUSTÍVEL', opcoes: [['', '—'], ['Diesel S10', 'Diesel S10'], ['Gasolina', 'Gasolina'], ['Etanol', 'Etanol'], ['Arla', 'Arla']] })}
            {C({ k: 'posto', l: 'POSTO' })}{C({ k: 'motorista_nome', l: 'MOTORISTA' })}
            <label style={{ fontSize: 12.5, color: theme.text, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.tanque_cheio !== false} onChange={e => set('tanque_cheio', e.target.checked)} /> Encheu o tanque</label>
          </>}
          {modal.tipo === 'manutencao' && <>
            {S({ k: 'veiculo_id', l: 'VEÍCULO', opcoes: veicOpts })}{C({ k: 'tipo', l: 'SERVIÇO', ph: 'ex.: troca de óleo e filtro' })}
            {S({ k: 'categoria', l: 'CATEGORIA', opcoes: [['', '—'], ...CATEGORIAS_MANUTENCAO] })}
            {C({ k: 'data', l: 'DATA DE ENTRADA', tipo: 'date' })}{horas ? C({ k: 'horas', l: 'HORÍMETRO (h)' }) : C({ k: 'km', l: 'KM' })}
            {S({ k: 'status', l: 'STATUS', opcoes: [['concluida', 'Concluída'], ['em_andamento', 'Na oficina (veículo parado)'], ['agendada', 'Agendada']] })}
            {C({ k: 'oficina', l: 'OFICINA' })}{C({ k: 'os_oficina', l: 'Nº DA OS DA OFICINA' })}{C({ k: 'data_saida', l: 'DATA DE SAÍDA', tipo: 'date' })}
            {C({ k: 'valor_pecas', l: 'PEÇAS (R$)' })}{C({ k: 'valor_mao_obra', l: 'MÃO DE OBRA (R$)' })}
            {S({ k: 'plano_id', l: 'FECHA O PLANO', opcoes: [['', '— nenhum —'], ...d.planos.filter(p => p.veiculo_id === f.veiculo_id).map(p => [p.id, p.servico])] })}
            {C({ k: 'observacao', l: 'OBSERVAÇÃO', larg: true })}
          </>}
          {modal.tipo === 'plano' && <>
            {S({ k: 'veiculo_id', l: 'VEÍCULO', opcoes: veicOpts })}{C({ k: 'servico', l: 'SERVIÇO', ph: 'ex.: troca de óleo' })}<div />
            {secao('A cada (o que vencer primeiro)')}
            {C({ k: 'intervalo_km', l: 'KM' })}{C({ k: 'intervalo_horas', l: 'HORAS' })}{C({ k: 'intervalo_meses', l: 'MESES' })}
            {secao('Última vez que foi feito')}
            {C({ k: 'ultimo_km', l: 'NO KM' })}{C({ k: 'ultimo_horas', l: 'NO HORÍMETRO' })}{C({ k: 'ultima_data', l: 'NA DATA', tipo: 'date' })}
          </>}
          {modal.tipo === 'viagem' && <>
            {S({ k: 'veiculo_id', l: 'VEÍCULO', opcoes: veicOpts })}{C({ k: 'data', l: 'DATA', tipo: 'date' })}
            <div><div style={rot}>MOTORISTA</div><input style={campo} list="frota-pilotos" value={f.motorista || ''} onChange={e => set('motorista', e.target.value)} /></div>
            <div><div style={rot}>CLIENTE</div><input style={campo} list="frota-clientes" value={f.cliente || ''} onChange={e => set('cliente', e.target.value)} /></div>
            <div><div style={rot}>FAZENDA</div><input style={campo} list="frota-fazendas" value={f.fazenda || ''} onChange={e => set('fazenda', e.target.value)} /></div>
            {C({ k: 'ordem_servico', l: 'OS (OPCIONAL)' })}
            {S({ k: 'finalidade', l: 'FINALIDADE', opcoes: FINALIDADES_VIAGEM.map(x => [x, x]) })}
            {C({ k: 'km_inicial', l: 'KM INICIAL' })}{C({ k: 'km_final', l: 'KM FINAL' })}
            {C({ k: 'destino', l: 'DESTINO / OBSERVAÇÃO', larg: true })}
            <datalist id="frota-pilotos">{pilotos.map(p => <option key={p.id} value={p.nome || p.email} />)}</datalist>
            <datalist id="frota-clientes">{clientes.map(c => <option key={c.nome} value={c.nome} />)}</datalist>
            <datalist id="frota-fazendas">{fazendas.filter(z => !f.cliente || z.cliente === f.cliente).map(z => <option key={z.id} value={z.nome} />)}</datalist>
          </>}
          {modal.tipo === 'bateria' && <>
            {C({ k: 'codigo', l: 'CÓDIGO / Nº DE SÉRIE' })}{C({ k: 'modelo', l: 'MODELO', ph: 'DB1560, DB800...' })}{C({ k: 'drone_modelo', l: 'DRONE', ph: 'T50, T25...' })}
            {C({ k: 'ciclos', l: 'CICLOS ATUAIS' })}{C({ k: 'ciclos_limite', l: 'LIMITE DE CICLOS' })}
            {S({ k: 'status', l: 'STATUS', opcoes: [['ativa', 'Ativa'], ['reserva', 'Reserva'], ['manutencao', 'Na assistência'], ['descartada', 'Descartada']] })}
            {C({ k: 'data_compra', l: 'DATA DA COMPRA', tipo: 'date' })}{C({ k: 'garantia_meses', l: 'GARANTIA (MESES)' })}
            {C({ k: 'observacao', l: 'OBSERVAÇÃO', larg: true })}
          </>}
          {modal.tipo === 'cnh' && <>
            {C({ k: 'numero', l: 'Nº DA CNH' })}{C({ k: 'categoria', l: 'CATEGORIA', ph: 'B, AB, D...' })}{C({ k: 'validade', l: 'VALIDADE', tipo: 'date' })}
          </>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button style={{ ...btn(theme.bg, theme.textMuted), flex: 1 }} onClick={fechar}>Cancelar</button>
          <button style={{ ...btn('#059669'), flex: 2 }} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando...' : '💾 Salvar'}</button>
        </div>
      </div>
    </div>
  )
}


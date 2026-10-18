import React, { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../lib/theme'
import FichaClimaEditor from './FichaClimaEditor'
import { fichaParaExportar, gerarPdfFichas, planilhaFichasBlob, limparFicha } from '../lib/monitoramentoClima'
import { salvarOuCompartilharPdf, salvarOuCompartilharBlob } from '../lib/nativeShare'

// Gestão → Monitoramento Climático (Beta). Junta as fichas lançadas pelos pilotos nos voos
// (relatorios.monitoramento_clima) com as fichas manuais do painel (fichas_clima), que podem ou
// não estar ligadas a um voo registrado. Exporta no layout da ficha da Bracell (PDF e Excel).

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const dataIso = iso => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : ''
const dataBR = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '—'
const primeiroDoMes = () => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), 1).toLocaleDateString('en-CA') }

export default function MonitoramentoClimaAdmin({ relatorios, setRelatorios, fazendas, clientes, supabase, showToast, isMobile }) {
  const { theme } = useTheme()
  const [manuais, setManuais] = useState([])
  const [de, setDe] = useState(primeiroDoMes())
  const [ate, setAte] = useState(new Date().toLocaleDateString('en-CA'))
  const [cliente, setCliente] = useState('')
  const [marcadas, setMarcadas] = useState({})
  const [editor, setEditor] = useState(null) // { tipo:'voo'|'manual', id?, relId?, cab:{...}, dados:{...} }
  const [salvando, setSalvando] = useState(false)

  async function carregarManuais() {
    const { data, error } = await supabase.from('fichas_clima').select('*').order('data', { ascending: false })
    if (error) { showToast('Erro ao carregar as fichas: ' + error.message, 'error'); return }
    setManuais(data || [])
  }
  useEffect(() => { carregarManuais() }, []) // carrega uma vez ao abrir a tela

  const codigoDaFazenda = rel => fazendas.find(f => norm(f.cliente) === norm(rel.cliente) && norm(f.nome) === norm(rel.fazenda))?.id_fazenda || ''

  const lista = useMemo(() => {
    const doVoo = relatorios.filter(r => r.monitoramento_clima && (r.monitoramento_clima.voos || []).length)
      .map(r => ({ chave: 'v' + r.id, tipo: 'voo', rel: r, data: dataIso(r.dt_inicio || r.created_at), cliente: r.cliente, fazenda: r.fazenda, talhao: r.localizacao, piloto: r.piloto_nome, nVoos: r.monitoramento_clima.voos.length }))
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

  async function salvar() {
    setSalvando(true)
    try {
      const dados = limparFicha(editor.dados)
      // Ficha nova ligada a um voo registrado vai pro próprio relatório (igual o piloto faz).
      const relId = editor.tipo === 'voo' ? editor.relId : editor.vincular
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
    const fichas = [...escolhidas].reverse().map(x => x.tipo === 'voo'
      ? fichaParaExportar({ rel: x.rel, fazendaCodigo: codigoDaFazenda(x.rel) })
      : fichaParaExportar({ manual: x.manual }))
    const nome = `monitoramento-climatico-${de || 'inicio'}-a-${ate || 'hoje'}`
    try {
      if (tipo === 'pdf') await salvarOuCompartilharPdf(gerarPdfFichas(fichas), `${nome}.pdf`)
      else await salvarOuCompartilharBlob(planilhaFichasBlob(fichas), `${nome}.xlsx`)
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
        <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 4 }}>Ficha de aplicação voo a voo (início, fim, altura, área, temperatura, umidade e vento). Por enquanto manual: o piloto lança no app ou você digita aqui.</div>
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
        <div style={{ flex: 1 }} />
        <button style={btn('#059669')} onClick={abrirNova}>+ Nova ficha</button>
        <button style={btn('#111111')} onClick={() => exportar('pdf')}>⬇️ PDF{nMarcadas ? ` (${nMarcadas})` : ''}</button>
        <button style={btn(theme.bg, theme.text)} onClick={() => exportar('xlsx')}>⬇️ Excel{nMarcadas ? ` (${nMarcadas})` : ''}</button>
      </div>

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        {lista.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>Nenhuma ficha no período. Use "+ Nova ficha" ou peça pro piloto lançar os voos no Passo 4 do app.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5, minWidth: 720 }}>
            <thead>
              <tr style={{ background: theme.bg }}>
                {['', 'Data', 'Cliente · Fazenda', 'Talhão', 'Piloto', 'Voos', 'Origem', ''].map((h, i) => (
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
                  <td style={{ padding: '8px 10px', color: theme.textMuted }}>{x.tipo === 'voo' ? '🚁 voo registrado' : '✍️ manual'}</td>
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
      <div style={{ fontSize: 11, color: theme.textFaint2 }}>Sem nenhuma marcada, o PDF/Excel sai com todas as fichas do período. Volume consumido e recomendação em branco saem da vazão do voo.</div>

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

            <FichaClimaEditor valor={editor.dados} onChange={dados => setEditor(ed => ({ ...ed, dados }))}
              sugestao={{ altura: relDoEditor?.altura || '', temperatura: relDoEditor?.temperatura_i || '', umidade: relDoEditor?.umidade_i || '', vento: relDoEditor?.vento_i || '' }} />

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

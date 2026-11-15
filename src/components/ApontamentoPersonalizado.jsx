// Apontamento personalizado (Beta) — Gestão → Fazendas & Clientes. Duplicata do Apontamento diário
// em que o usuário monta o relatório: arrasta os campos (do banco, ou um campo novo com valor fixo,
// tipo "OS-ANATEL") para o CABEÇALHO, a MATRIZ ou o RODAPÉ, renomeia, reordena e salva como
// modelo. O Apontamento diário continua igual (Ricardo, 15/11/2026). As contas ficam em
// lib/apontamentoPersonalizado.
//
// Arrastar: com o mouse, é só arrastar; no celular, segura um instante e arrasta. Tocar (ou clicar)
// num campo abre o "Adicionar em…", que faz o mesmo sem arrastar.
// Modelos: o admin salva em app_settings ('apontamento_modelos'), igual em qualquer aparelho; quem
// não é admin (ou se o servidor recusar) salva só no aparelho.
import { useState, useMemo, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useTheme } from '../lib/theme'
import { supabase } from '../lib/supabase'
import { noPeriodo } from '../lib/apontamentoDiario'
import {
  CAMPOS, CAMPO, GRUPOS_CAMPOS, AGRUPAMENTOS, ZONAS, fatosDoPeriodo, montarApontamento, textoPersonalizado,
  planilhaPersonalizada, modeloPadrao, normalizarModelo, itemDoCampo, itemFixo, novoUid,
} from '../lib/apontamentoPersonalizado'
import { compartilharNativo, salvarOuCompartilharBlob } from '../lib/nativeShare'

const CHAVE_BANCO = 'apontamento_modelos'
const CHAVE_LOCAL = 'orofly_apont_modelos'
const CHAVE_ULTIMO = 'orofly_apont_modelo_atual'
const hojeIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const lerLocal = (k, padrao) => { try { return localStorage.getItem(k) ?? padrao } catch { return padrao } }
const gravarLocal = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem storage: só não lembra */ } }
const lerJson = (txt, padrao) => { try { const v = JSON.parse(txt); return v ?? padrao } catch { return padrao } }
const limpo = m => { const { origem, ...resto } = m || {}; return resto }
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()

// Onde o dedo/mouse está: a zona (data-zona) e a posição entre os itens (data-item) dela.
function alvoEm(x, y) {
  const el = document.elementFromPoint(x, y)
  const zonaEl = el && el.closest ? el.closest('[data-zona]') : null
  if (!zonaEl) return null
  const itens = [...zonaEl.querySelectorAll('[data-item]')]
  let idx = itens.length
  for (let i = 0; i < itens.length; i++) {
    const r = itens[i].getBoundingClientRect()
    if (y < r.top + r.height / 2) { idx = i; break }
  }
  return { zona: zonaEl.getAttribute('data-zona'), idx }
}
// Solta o que foi arrastado (um campo da lista ou um item de uma zona) na posição do alvo.
function soltarEm(m, payload, alvo) {
  const z = { cabecalho: [...m.cabecalho], matriz: [...m.matriz], rodape: [...m.rodape] }
  if (!z[alvo.zona]) return m
  let item, idx = alvo.idx
  if (payload.tipo === 'item') {
    item = z[payload.zona]?.[payload.idx]
    if (!item) return m
    z[payload.zona].splice(payload.idx, 1)
    if (payload.zona === alvo.zona && idx > payload.idx) idx--
  } else {
    item = itemDoCampo(payload.campo)
  }
  z[alvo.zona].splice(Math.min(idx, z[alvo.zona].length), 0, item)
  return { ...m, ...z }
}

export default function ApontamentoPersonalizado({ relatorios, fazendas, talhoes, empresa, showToast, isMobile, isAdmin }) {
  const { theme } = useTheme()

  // ── Período e cliente (igual ao Apontamento diário, mais "Todos os clientes") ──
  const [data, setData] = useState(hojeIso())
  const [ate, setAte] = useState(hojeIso())
  const varios = ate > data
  function mudarDia(v) { if (!v) return; setAte(a => (a === data || a < v ? v : a)); setData(v) }
  function mudarAte(v) { if (!v) { setAte(data); return } if (v < data) { setAte(data); setData(v); return } setAte(v) }
  const clientesDoPeriodo = useMemo(() => {
    const cont = {}
    relatorios.filter(r => ['finalizado', 'pausado_dia'].includes(r.status) && !r.teste && noPeriodo(r, data, ate) && r.cliente)
      .forEach(r => { cont[r.cliente] = (cont[r.cliente] || 0) + 1 })
    return Object.entries(cont).sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [relatorios, data, ate])
  const [clienteEscolhido, setClienteEscolhido] = useState(() => lerLocal('orofly_apontp_cliente', ''))
  const cliente = clienteEscolhido === '*' ? '' : clientesDoPeriodo.includes(clienteEscolhido) ? clienteEscolhido : (clientesDoPeriodo[0] || '')

  // ── Modelos ──
  const [modelos, setModelos] = useState([])
  const [modelo, setModelo] = useState(() => modeloPadrao())
  const [salvoJson, setSalvoJson] = useState('')
  const [salvando, setSalvando] = useState(false)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data: resp, error } = await supabase.from('app_settings').select('valor').eq('chave', CHAVE_BANCO).maybeSingle()
      const doBanco = !error && resp?.valor ? lerJson(resp.valor, []) : []
      const locais = lerJson(lerLocal(CHAVE_LOCAL, '[]'), [])
      // Mesmo modelo no banco e no aparelho (o servidor recusou um salvamento): vale o do aparelho,
      // que é o mais novo.
      const porId = new Map()
      ;(Array.isArray(doBanco) ? doBanco : []).forEach(m => { const n = normalizarModelo(m); porId.set(n.id, { ...n, origem: 'banco' }) })
      ;(Array.isArray(locais) ? locais : []).forEach(m => { const n = normalizarModelo(m); porId.set(n.id, { ...n, origem: 'local' }) })
      const lista = [...porId.values()]
      if (!vivo) return
      setModelos(lista)
      const ultimo = lista.find(m => m.id === lerLocal(CHAVE_ULTIMO, ''))
      if (ultimo) { setModelo(ultimo); setSalvoJson(JSON.stringify(limpo(ultimo))) }
    })()
    return () => { vivo = false }
  }, [])
  const ehPadrao = modelo.id === 'padrao'
  const alterado = ehPadrao ? false : JSON.stringify(limpo(modelo)) !== salvoJson
  const origemAtual = modelos.find(m => m.id === modelo.id)?.origem

  function abrir(m, jaSalvo = true) {
    const n = { ...normalizarModelo(m), ...(m.origem ? { origem: m.origem } : {}) }
    setModelo(n)
    setSalvoJson(jaSalvo ? JSON.stringify(limpo(n)) : '')
    gravarLocal(CHAVE_ULTIMO, n.id)
  }
  function trocarModelo(id) {
    if (alterado && !window.confirm('O modelo tem alterações não salvas. Trocar mesmo assim?')) return
    if (id === 'padrao') { abrir(modeloPadrao()); return }
    const m = modelos.find(x => x.id === id)
    if (m) abrir(m)
  }
  async function salvar() {
    let m = { ...limpo(modelo), nome: modelo.nome.trim() || 'Meu modelo' }
    // O padrão não é editável: salvar a partir dele cria um modelo novo.
    if (ehPadrao || m.id === 'padrao') m = { ...m, id: novoUid(), nome: /^padrão/i.test(m.nome) ? 'Meu modelo' : m.nome }
    setSalvando(true)
    if (isAdmin) {
      // Relê antes de gravar pra não apagar o que outro admin salvou nesse meio-tempo.
      const { data: resp, error: erroLer } = await supabase.from('app_settings').select('valor').eq('chave', CHAVE_BANCO).maybeSingle()
      if (!erroLer) {
        const lista = lerJson(resp?.valor || '[]', [])
        const nova = [...(Array.isArray(lista) ? lista : []).filter(x => x.id !== m.id), m]
        const { error } = await supabase.from('app_settings').upsert({ chave: CHAVE_BANCO, valor: JSON.stringify(nova), atualizado_em: new Date().toISOString() })
        if (!error) {
          const locais = lerJson(lerLocal(CHAVE_LOCAL, '[]'), []).filter(x => x.id !== m.id)
          gravarLocal(CHAVE_LOCAL, JSON.stringify(locais))
          setModelos([...nova.map(x => ({ ...normalizarModelo(x), origem: 'banco' })), ...locais.map(x => ({ ...normalizarModelo(x), origem: 'local' }))])
          abrir({ ...m, origem: 'banco' })
          setSalvando(false)
          showToast('💾 Modelo salvo')
          return
        }
      }
    }
    const locais = lerJson(lerLocal(CHAVE_LOCAL, '[]'), [])
    const novaLocal = [...(Array.isArray(locais) ? locais : []).filter(x => x.id !== m.id), m]
    gravarLocal(CHAVE_LOCAL, JSON.stringify(novaLocal))
    setModelos(ms => [...ms.filter(x => x.id !== m.id), { ...normalizarModelo(m), origem: 'local' }])
    abrir({ ...m, origem: 'local' })
    setSalvando(false)
    showToast(isAdmin ? 'Não salvou no servidor — ficou guardado só neste aparelho' : '💾 Modelo salvo neste aparelho', isAdmin ? 'error' : undefined)
  }
  async function excluir() {
    if (ehPadrao) return
    if (!origemAtual) { // nunca foi salvo: só descarta
      if (!window.confirm('Descartar este modelo, que ainda não foi salvo?')) return
      abrir(modeloPadrao())
      return
    }
    if (!window.confirm(`Excluir o modelo "${modelo.nome}"? Não dá pra desfazer.`)) return
    if (origemAtual === 'banco') {
      if (!isAdmin) { showToast('Só o admin exclui um modelo salvo pra todos', 'error'); return }
      const { data: resp, error: erroLer } = await supabase.from('app_settings').select('valor').eq('chave', CHAVE_BANCO).maybeSingle()
      if (erroLer) { showToast('Não excluiu: ' + erroLer.message, 'error'); return }
      const lista = lerJson(resp?.valor || '[]', [])
      const nova = (Array.isArray(lista) ? lista : []).filter(x => x.id !== modelo.id)
      const { error } = await supabase.from('app_settings').upsert({ chave: CHAVE_BANCO, valor: JSON.stringify(nova), atualizado_em: new Date().toISOString() })
      if (error) { showToast('Não excluiu: ' + error.message, 'error'); return }
    } else {
      gravarLocal(CHAVE_LOCAL, JSON.stringify(lerJson(lerLocal(CHAVE_LOCAL, '[]'), []).filter(x => x.id !== modelo.id)))
    }
    setModelos(ms => ms.filter(x => x.id !== modelo.id))
    abrir(modeloPadrao())
    showToast('🗑️ Modelo excluído')
  }
  function duplicar() {
    abrir({ ...limpo(modelo), id: novoUid(), nome: ehPadrao ? 'Meu modelo' : `${modelo.nome} (cópia)` }, false)
  }
  function novoEmBranco() {
    if (alterado && !window.confirm('O modelo tem alterações não salvas. Começar outro mesmo assim?')) return
    abrir({ id: novoUid(), nome: 'Novo modelo', titulo: 'APONTAMENTO – {cliente}', agrupar: 'fazenda', cabecalho: [], matriz: [], rodape: [] }, false)
  }
  // Mexer no padrão vira um modelo novo (cópia), pra ele continuar igual ao Apontamento diário.
  function editarModelo(fn) {
    setModelo(m => {
      const base = m.id === 'padrao' ? { ...m, id: novoUid(), nome: 'Meu modelo' } : m
      return fn(base)
    })
  }
  const editarItem = (zona, i, patch) => editarModelo(m => ({ ...m, [zona]: m[zona].map((it, j) => (j === i ? { ...it, ...patch } : it)) }))
  const removerItem = (zona, i) => editarModelo(m => ({ ...m, [zona]: m[zona].filter((_, j) => j !== i) }))
  const moverItem = (zona, i, d) => editarModelo(m => {
    const l = [...m[zona]]; const j = i + d
    if (j < 0 || j >= l.length) return m
    ;[l[i], l[j]] = [l[j], l[i]]
    return { ...m, [zona]: l }
  })
  const adicionar = (zona, item) => editarModelo(m => ({ ...m, [zona]: [...m[zona], item] }))

  // ── Arrastar (Pointer Events: mouse e dedo) ──
  const arrastoRef = useRef(null)
  const [arrasto, setArrasto] = useState(null) // { rotulo, x, y, alvo, payload }
  const [menuCampo, setMenuCampo] = useState(null)
  useEffect(() => {
    function mover(e) {
      const st = arrastoRef.current
      if (!st) return
      const dist = Math.hypot(e.clientX - st.x0, e.clientY - st.y0)
      if (!st.ativo) {
        if (st.toque) { if (dist > 10) { clearTimeout(st.timer); arrastoRef.current = null } return } // mexeu antes do tempo: é rolagem
        if (dist < 5) return
        st.ativo = true
      }
      setArrasto({ rotulo: st.rotulo, payload: st.payload, x: e.clientX, y: e.clientY, alvo: alvoEm(e.clientX, e.clientY) })
    }
    function soltar(e) {
      const st = arrastoRef.current
      if (!st) return
      clearTimeout(st.timer)
      arrastoRef.current = null
      if (st.ativo) {
        const alvo = alvoEm(e.clientX, e.clientY)
        setArrasto(null)
        if (alvo) {
          setModelo(m => soltarEm(m.id === 'padrao' ? { ...m, id: novoUid(), nome: 'Meu modelo' } : m, st.payload, alvo))
        }
      } else if (st.payload.tipo === 'paleta') {
        setMenuCampo(st.payload.campo) // toque/clique sem arrastar: "Adicionar em…"
      }
    }
    function cancelar() {
      const st = arrastoRef.current
      if (st) clearTimeout(st.timer)
      arrastoRef.current = null
      setArrasto(null)
    }
    // Durante o arraste com o dedo, a tela não rola.
    function travarRolagem(e) { if (arrastoRef.current?.ativo) e.preventDefault() }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', cancelar)
    window.addEventListener('touchmove', travarRolagem, { passive: false })
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', cancelar)
      window.removeEventListener('touchmove', travarRolagem)
    }
  }, [])
  function iniciar(e, payload, rotulo) {
    if (e.button != null && e.button !== 0) return
    if (e.pointerType === 'mouse') e.preventDefault() // não seleciona texto pelo caminho
    // No dedo, os campos da lista só arrastam depois de segurar um instante (senão a lista não
    // rola); o puxador ⠿ dos itens não rola a tela, então arrasta na hora.
    const toque = (e.pointerType === 'touch' || e.pointerType === 'pen') && payload.tipo === 'paleta'
    const st = { payload, rotulo, x0: e.clientX, y0: e.clientY, ativo: false, toque }
    arrastoRef.current = st
    if (toque) {
      st.timer = setTimeout(() => {
        if (arrastoRef.current !== st) return
        st.ativo = true
        setArrasto({ rotulo, payload, x: st.x0, y: st.y0, alvo: alvoEm(st.x0, st.y0) })
        try { navigator.vibrate && navigator.vibrate(15) } catch { /* sem vibração */ }
      }, 260)
    }
  }

  // ── Campo novo ──
  const [novoCampo, setNovoCampo] = useState(null) // { rotulo, valor, zona }
  function inserirCampoNovo() {
    const rotulo = (novoCampo?.rotulo || '').trim()
    if (!rotulo) { showToast('Dê um nome ao campo (ex.: OS-ANATEL)', 'error'); return }
    adicionar(novoCampo.zona, itemFixo(rotulo, novoCampo.valor || ''))
    setNovoCampo(null)
    showToast(`➕ "${rotulo}" entrou no ${ZONAS.find(z => z.id === novoCampo.zona)?.rotulo}`)
  }

  // ── Resultado ──
  const { fatos } = useMemo(() => fatosDoPeriodo({ relatorios, fazendas, talhoes, data, ate, cliente }), [relatorios, fazendas, talhoes, data, ate, cliente])
  const ap = useMemo(() => montarApontamento(modelo, { fatos, data, ate, empresa, cliente }), [modelo, fatos, data, ate, empresa, cliente])
  const texto = useMemo(() => textoPersonalizado(ap), [ap])
  const temVoo = ap.voos > 0

  async function copiar() {
    try { await navigator.clipboard.writeText(texto); showToast('📋 Apontamento copiado') }
    catch { showToast('Não deu pra copiar — selecione o texto e copie', 'error') }
  }
  function whatsapp() {
    compartilharNativo({ text: texto, webFallbackUrl: 'https://wa.me/?text=' + encodeURIComponent(texto) })
  }
  async function excel() {
    const ws = XLSX.utils.aoa_to_sheet(planilhaPersonalizada(ap))
    ws['!cols'] = Array.from({ length: Math.max(2, ap.colunas.length) }, () => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Apontamento')
    const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const nomeArq = ehPadrao ? 'diario' : (slug(modelo.nome) || 'personalizado')
    await salvarOuCompartilharBlob(blob, `apontamento-${nomeArq}-${data}${varios ? `_a_${ate}` : ''}.xlsx`)
  }

  // ── Estilos ──
  const rot = { fontSize: 11, fontWeight: 700, color: theme.textMuted, marginBottom: 4 }
  const campo = { border: `1px solid ${theme.cardBorder2}`, borderRadius: 10, padding: '8px 10px', fontSize: 13, background: theme.card, color: theme.text, outline: 'none' }
  const campoP = { ...campo, padding: '5px 8px', fontSize: 12.5, borderRadius: 8, minWidth: 0 }
  const cartao = { background: theme.card, border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, padding: 12 }
  const btn = (cor, claro) => ({ background: claro ? 'transparent' : cor, color: claro ? cor : '#fff', border: claro ? `1px solid ${cor}` : 'none', borderRadius: 18, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' })
  const mini = { background: 'transparent', border: `1px solid ${theme.cardBorder2}`, borderRadius: 7, width: 26, height: 26, fontSize: 12, color: theme.textMuted, cursor: 'pointer', padding: 0, flexShrink: 0 }
  const chip = ativo => ({ display: 'inline-block', padding: '6px 11px', borderRadius: 16, border: `1px solid ${ativo ? '#059669' : theme.cardBorder2}`, background: ativo ? '#059669' : theme.card, color: ativo ? '#fff' : theme.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', margin: '0 6px 6px 0' })
  const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: theme.textMuted, padding: '8px 10px', borderBottom: `1px solid ${theme.divider}`, whiteSpace: 'nowrap' }
  const td = { fontSize: 12.5, color: theme.text, padding: '8px 10px', borderBottom: `1px solid ${theme.divider}` }
  const oPeriodo = varios ? 'nesse período' : 'nesse dia'

  const zonaCard = z => {
    const itens = modelo[z.id]
    const alvoAqui = arrasto?.alvo?.zona === z.id ? arrasto.alvo.idx : null
    const linhaAlvo = <div style={{ height: 3, background: '#059669', borderRadius: 2, margin: '2px 0 6px' }} />
    return (
      <div key={z.id} data-zona={z.id} style={{ ...cartao, padding: 10, marginBottom: 10, borderColor: alvoAqui != null ? '#059669' : theme.cardBorder2, background: alvoAqui != null ? 'rgba(5,150,105,0.05)' : theme.card }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: theme.text }}>{z.rotulo}</span>
          <span style={{ fontSize: 11, color: theme.textMuted }}>{z.dica}</span>
          {z.id === 'matriz' && (
            <select value={modelo.agrupar} onChange={e => { const v = e.target.value; editarModelo(m => ({ ...m, agrupar: v })) }} style={{ ...campoP, fontWeight: 700 }}>
              {AGRUPAMENTOS.map(a => <option key={a.id} value={a.id}>{a.rotulo}</option>)}
            </select>
          )}
        </div>
        {itens.map((it, i) => {
          const arrastandoEste = arrasto?.payload?.tipo === 'item' && arrasto.payload.zona === z.id && arrasto.payload.idx === i
          return (
            <div key={it.uid}>
              {alvoAqui === i && linhaAlvo}
              <div data-item style={{ display: 'flex', alignItems: 'center', gap: 6, background: theme.bg, border: `1px solid ${theme.cardBorder2}`, borderRadius: 10, padding: '6px 6px 6px 4px', marginBottom: 6, opacity: arrastandoEste ? 0.35 : 1 }}>
                <span title="Arraste pra mudar de lugar" onPointerDown={e => iniciar(e, { tipo: 'item', zona: z.id, idx: i }, it.rotulo)}
                  style={{ cursor: 'grab', touchAction: 'none', padding: '6px 4px', color: theme.textMuted, userSelect: 'none', WebkitUserSelect: 'none', fontSize: 16, lineHeight: 1 }}>⠿</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input value={it.rotulo} onChange={e => editarItem(z.id, i, { rotulo: e.target.value })} style={{ ...campoP, width: '100%', boxSizing: 'border-box', fontWeight: 700 }} />
                  <div style={{ fontSize: 10.5, color: theme.textFaint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.campo === 'fixo' ? 'campo novo · valor fixo' : `do banco · ${CAMPO[it.campo]?.rotulo}`}
                  </div>
                </div>
                {it.campo === 'fixo' && (
                  <input value={it.valor} placeholder="valor (ou em branco)" onChange={e => editarItem(z.id, i, { valor: e.target.value })}
                    style={{ ...campoP, width: isMobile ? 92 : 150, boxSizing: 'border-box' }} />
                )}
                <button style={mini} title="Subir" disabled={i === 0} onClick={() => moverItem(z.id, i, -1)}>↑</button>
                <button style={mini} title="Descer" disabled={i === itens.length - 1} onClick={() => moverItem(z.id, i, 1)}>↓</button>
                <button style={{ ...mini, color: theme.dangerText || '#DC2626' }} title="Tirar" onClick={() => removerItem(z.id, i)}>✕</button>
              </div>
            </div>
          )
        })}
        {alvoAqui === itens.length && linhaAlvo}
        {itens.length === 0 && alvoAqui == null && (
          <div style={{ border: `1px dashed ${theme.cardBorder2}`, borderRadius: 10, padding: '12px 10px', fontSize: 12, color: theme.textFaint, textAlign: 'center' }}>Arraste campos pra cá</div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        <span style={{ background: '#7C3AED', color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 10, padding: '2px 8px', marginRight: 6 }}>BETA</span>
        Monte o seu apontamento: arraste os campos para o <b>Cabeçalho</b> (sai uma vez, no topo), a <b>Matriz</b> (uma linha por fazenda, talhão, voo, dia ou piloto)
        ou o <b>Rodapé</b> (no fim). No cabeçalho e no rodapé, os campos valem pro período inteiro — a Área Aplicada vira o total.
        Toque num campo pra escolher onde ele entra sem arrastar. O Apontamento diário continua igual.
      </div>

      {/* Período e cliente */}
      <div style={{ ...cartao, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        <div><div style={rot}>{varios ? 'DE' : 'DIA DA APLICAÇÃO'}</div><input type="date" style={campo} value={data} onChange={e => mudarDia(e.target.value)} /></div>
        <div><div style={rot}>ATÉ</div><input type="date" style={campo} value={ate} min={data} onChange={e => mudarAte(e.target.value)} /></div>
        <div style={{ minWidth: 180 }}>
          <div style={rot}>CLIENTE</div>
          <select style={{ ...campo, width: '100%' }} value={clienteEscolhido === '*' ? '*' : cliente}
            onChange={e => { setClienteEscolhido(e.target.value); gravarLocal('orofly_apontp_cliente', e.target.value) }}>
            {clientesDoPeriodo.length === 0 && <option value="">Nenhum voo {oPeriodo}</option>}
            {clientesDoPeriodo.map(c => <option key={c} value={c}>{c}</option>)}
            {clientesDoPeriodo.length > 0 && <option value="*">Todos os clientes</option>}
          </select>
        </div>
      </div>

      {/* Modelo */}
      <div style={{ ...cartao, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <div style={rot}>MODELO</div>
            <select style={{ ...campo, width: '100%' }} value={modelos.some(m => m.id === modelo.id) || ehPadrao ? modelo.id : '__novo'} onChange={e => trocarModelo(e.target.value)}>
              <option value="padrao">{modeloPadrao().nome}</option>
              {modelos.map(m => <option key={m.id} value={m.id}>{m.nome}{m.origem === 'local' ? ' (só neste aparelho)' : ''}</option>)}
              {!ehPadrao && !modelos.some(m => m.id === modelo.id) && <option value="__novo">{modelo.nome} (não salvo)</option>}
            </select>
          </div>
          {!ehPadrao && (
            <div style={{ flex: '1 1 160px' }}>
              <div style={rot}>NOME DO MODELO</div>
              <input style={{ ...campo, width: '100%', boxSizing: 'border-box' }} value={modelo.nome} onChange={e => { const v = e.target.value; setModelo(m => ({ ...m, nome: v })) }} />
            </div>
          )}
          <div style={{ flex: '2 1 240px' }}>
            <div style={rot}>TÍTULO <span style={{ fontWeight: 400 }}>— {'{cliente}'} vira o nome do cliente</span></div>
            <input style={{ ...campo, width: '100%', boxSizing: 'border-box' }} value={modelo.titulo} onChange={e => { const v = e.target.value; editarModelo(m => ({ ...m, titulo: v })) }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          <button style={btn('#059669')} disabled={salvando || ehPadrao} onClick={salvar}>{salvando ? 'Salvando…' : '💾 Salvar modelo'}</button>
          <button style={btn('#059669', true)} onClick={duplicar}>⧉ Duplicar</button>
          <button style={btn('#059669', true)} onClick={novoEmBranco}>＋ Novo em branco</button>
          {!ehPadrao && <button style={btn(theme.dangerText || '#DC2626', true)} onClick={excluir}>🗑️ Excluir</button>}
          {ehPadrao && <span style={{ fontSize: 11.5, color: theme.textMuted }}>O padrão é igual ao Apontamento diário. Mexendo nele, vira uma cópia sua.</span>}
          {alterado && <span style={{ fontSize: 11.5, color: '#D97706', fontWeight: 700 }}>• alterações não salvas</span>}
          {!isAdmin && <span style={{ fontSize: 11.5, color: theme.textMuted }}>Seus modelos ficam salvos neste aparelho.</span>}
        </div>
      </div>

      {/* Montagem: campos à esquerda, zonas à direita */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,0.9fr) minmax(0,1.5fr)', gap: 12, alignItems: 'start', marginBottom: 14 }}>
        <div style={cartao}>
          <div style={{ fontSize: 13, fontWeight: 800, color: theme.text, marginBottom: 2 }}>Campos</div>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 8 }}>Arraste pra uma área, ou toque pra escolher onde.</div>
          {GRUPOS_CAMPOS.map(g => (
            <div key={g} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: theme.textFaint, letterSpacing: 0.4, margin: '4px 0 6px' }}>{g.toUpperCase()}</div>
              {CAMPOS.filter(c => c.grupo === g).map(c => (
                <span key={c.id} onPointerDown={e => iniciar(e, { tipo: 'paleta', campo: c.id }, c.rotulo)}
                  style={{ ...chip(menuCampo === c.id), cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation' }}>
                  {c.rotulo}
                </span>
              ))}
              {menuCampo && CAMPO[menuCampo]?.grupo === g && (
                <div style={{ background: theme.bg, border: `1px solid #059669`, borderRadius: 10, padding: 8, margin: '2px 0 8px', fontSize: 12, color: theme.text }}>
                  Adicionar <b>{CAMPO[menuCampo].rotulo}</b> em:
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {ZONAS.map(z => <button key={z.id} style={btn('#059669')} onClick={() => { adicionar(z.id, itemDoCampo(menuCampo)); setMenuCampo(null) }}>{z.rotulo}</button>)}
                    <button style={btn(theme.textMuted, true)} onClick={() => setMenuCampo(null)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${theme.divider}`, marginTop: 6, paddingTop: 10 }}>
            {novoCampo ? (
              <div>
                <div style={rot}>NOME DO CAMPO</div>
                <input autoFocus style={{ ...campo, width: '100%', boxSizing: 'border-box' }} placeholder="Ex.: OS-ANATEL" value={novoCampo.rotulo} onChange={e => setNovoCampo(n => ({ ...n, rotulo: e.target.value }))} />
                <div style={{ ...rot, marginTop: 8 }}>VALOR FIXO <span style={{ fontWeight: 400 }}>— em branco, a usina preenche</span></div>
                <input style={{ ...campo, width: '100%', boxSizing: 'border-box' }} value={novoCampo.valor} onChange={e => setNovoCampo(n => ({ ...n, valor: e.target.value }))} />
                <div style={{ ...rot, marginTop: 8 }}>ONDE ENTRA</div>
                <div>{ZONAS.map(z => <span key={z.id} style={chip(novoCampo.zona === z.id)} onClick={() => setNovoCampo(n => ({ ...n, zona: z.id }))}>{z.rotulo}</span>)}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button style={btn('#059669')} onClick={inserirCampoNovo}>Inserir</button>
                  <button style={btn(theme.textMuted, true)} onClick={() => setNovoCampo(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button style={{ ...btn('#7C3AED', true), width: '100%' }} onClick={() => setNovoCampo({ rotulo: '', valor: '', zona: 'cabecalho' })}>＋ Inserir campo novo</button>
            )}
          </div>
        </div>
        <div>{ZONAS.map(zonaCard)}</div>
      </div>

      {/* Prévia e saída */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: theme.text, marginRight: 'auto' }}>Prévia{temVoo ? ` · ${ap.voos} voo${ap.voos === 1 ? '' : 's'}` : ''}</div>
        <button style={btn('#059669')} onClick={copiar} disabled={!temVoo}>📋 Copiar</button>
        <button style={btn('#25D366')} onClick={whatsapp} disabled={!temVoo}>💬 WhatsApp</button>
        <button style={btn('#1D6F42')} onClick={excel} disabled={!temVoo}>📊 Excel</button>
      </div>
      {!temVoo ? (
        <div style={{ ...cartao, padding: 30, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>
          Nenhum voo finalizado {cliente ? `de ${cliente} ` : ''}{oPeriodo}.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.4fr) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
          <div style={{ ...cartao, padding: 0, overflow: 'hidden' }}>
            {(ap.titulo || ap.cabecalho.length > 0) && (
              <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.divider}` }}>
                {ap.titulo && <div style={{ fontSize: 13.5, fontWeight: 800, color: theme.text, marginBottom: ap.cabecalho.length ? 6 : 0 }}>{ap.titulo}</div>}
                {ap.cabecalho.map(c => (
                  <div key={c.item.uid} style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.6 }}><span style={{ color: theme.textMuted }}>{c.item.rotulo}:</span> {c.texto}</div>
                ))}
              </div>
            )}
            {ap.colunas.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{ap.colunas.map(c => <th key={c.item.uid} style={{ ...th, textAlign: c.tipo === 'ha' || c.tipo === 'num' ? 'right' : 'left' }}>{c.item.rotulo}</th>)}</tr></thead>
                  <tbody>
                    {ap.linhas.map((l, i) => (
                      <tr key={i}>{l.map((v, j) => {
                        const n = ap.colunas[j].tipo === 'ha' || ap.colunas[j].tipo === 'num'
                        return <td key={j} style={{ ...td, textAlign: n ? 'right' : 'left', whiteSpace: n ? 'nowrap' : 'normal' }}>{v.numero ?? v.texto}</td>
                      })}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 14, fontSize: 12, color: theme.textMuted }}>A matriz está vazia — arraste campos pra ela pra ter uma linha por {AGRUPAMENTOS.find(a => a.id === modelo.agrupar)?.rotulo.toLowerCase()}.</div>
            )}
            {ap.rodape.length > 0 && (
              <div style={{ padding: '10px 12px', borderTop: `1px solid ${theme.divider}` }}>
                {ap.rodape.map(c => (
                  <div key={c.item.uid} style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.6, fontWeight: 700 }}><span style={{ color: theme.textMuted, fontWeight: 600 }}>{c.item.rotulo}:</span> {c.texto}</div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={rot}>TEXTO PRA MANDAR</div>
            <textarea readOnly value={texto} onFocus={e => e.target.select()}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 320, border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, padding: 12, fontFamily: 'ui-monospace,monospace', fontSize: 12, color: theme.text, background: theme.card, resize: 'vertical' }} />
          </div>
        </div>
      )}

      {/* O que está sendo arrastado acompanha o dedo/mouse */}
      {arrasto && (
        <div style={{ position: 'fixed', left: arrasto.x + 10, top: arrasto.y + 10, zIndex: 9999, pointerEvents: 'none', background: '#059669', color: '#fff', fontSize: 12.5, fontWeight: 700, padding: '6px 12px', borderRadius: 14, boxShadow: '0 6px 18px rgba(0,0,0,0.25)' }}>
          {arrasto.rotulo}
        </div>
      )}
    </div>
  )
}

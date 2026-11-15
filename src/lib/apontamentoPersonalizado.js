// Apontamento personalizado (Beta) — o "monte o seu" do Apontamento diário (Ricardo, 15/11/2026:
// "algo como um SAS da vida, que você arrasta os campos e vai formando"). O Apontamento diário
// continua como está; aqui o usuário escolhe os campos e onde cada um vai:
//   CABEÇALHO — uma vez, no topo;
//   MATRIZ    — uma linha (no texto, um bloco) por fazenda, talhão, voo, dia ou piloto;
//   RODAPÉ    — uma vez, no fim.
// Campo do banco no cabeçalho ou no rodapé vale pro período inteiro (Área Aplicada = o total);
// na matriz, vale pra linha. Campo novo leva um valor fixo digitado (ex.: OS-ANATEL), igual em
// todas as linhas — ou em branco, pra usina preencher.
//
// As contas de área são as do Apontamento diário, com a mesma regra (agrupando por fazenda os
// números batem com ele): a aplicada é a do Formulário Nardini; o total é a aplicada mais a
// bordadura e os outros motivos, menos o "Outro"; a diferença é essa bordadura e esses motivos.
import { dadosFormularioNardini } from './formularioNardini'
import { naoAplicadaDoRel } from './reportTemplates'
import { calcularGastoProdutos } from './pdf'
import { formatarDose, formatarTotalProduto } from './calda'
import { compararNomes } from './ordenar'
import { noPeriodo, diaDoVoo, dataBR } from './apontamentoDiario'

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
export const fmtHa = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const r2 = v => +Number(v || 0).toFixed(2)
const unicos = arr => [...new Set(arr.filter(v => v != null && v !== ''))]
const diaCurto = iso => { const [, m, d] = String(iso || '').split('-'); return d ? `${d}/${m}` : '' }
const horaBR = iso => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

// ── Fatos: uma linha por (voo, talhão) ─────────────────────────────────────────────────────
// Tudo que os campos mostram sai daqui, somando ou listando os fatos de cada linha da matriz
// (ou todos, no cabeçalho e no rodapé).
export function fatosDoPeriodo({ relatorios = [], fazendas = [], talhoes = [], data, ate = '', cliente = '' }) {
  const voos = relatorios.filter(r => ['finalizado', 'pausado_dia'].includes(r.status) && !r.teste
    && noPeriodo(r, data, ate) && (!cliente || norm(r.cliente) === norm(cliente)))
  const fatos = []
  for (const rel of voos) {
    const fz = fazendas.find(f => norm(f.cliente) === norm(rel.cliente) && norm(f.nome) === norm(rel.fazenda))
    const catalogo = fz ? talhoes.filter(t => t.fazenda_id === fz.id).map(t => ({ nome: t.nome, area_ha: t.area_ha })) : []
    const d = dadosFormularioNardini(rel, { talhoesCatalogo: catalogo, idFazenda: fz?.id_fazenda || '' })
    const unico = d.talhoes.length === 1
    const bordDet = Array.isArray(rel.bordadura_detalhe) && rel.bordadura_detalhe.length ? rel.bordadura_detalhe : null
    const bordDoTalhao = nome => bordDet
      ? bordDet.filter(b => b.talhao === nome).reduce((a, b) => a + (parseFloat(b.bordadura) || 0), 0)
      : (unico ? parseFloat(rel.bordadura) || 0 : 0)
    const motivos = naoAplicadaDoRel(rel).filter(m => m.motivo && m.motivo !== 'Outro')
    const motivosDoTalhao = nome => motivos.filter(m => m.talhao === nome || (!m.talhao && unico))
    const base = {
      rel, cliente: rel.cliente || '', fazenda: rel.fazenda || '', codigo: fz?.id_fazenda ? String(fz.id_fazenda) : '',
      municipio: fz?.municipio ? `${fz.municipio}${fz.uf ? '/' + fz.uf : ''}` : '', dia: diaDoVoo(rel),
    }
    // Voo sem talhão ainda conta como voo da fazenda (o Apontamento diário também conta).
    if (!d.talhoes.length) fatos.push({ ...base, talhao: null, aplicada: 0, total: 0, bordadura: 0, motivos: [], areaTalhao: 0 })
    for (const t of d.talhoes) {
      const bord = bordDoTalhao(t.nome)
      const ms = motivosDoTalhao(t.nome)
      const aplicada = r2(t.aplicada || 0)
      fatos.push({
        ...base, talhao: t.nome, aplicada, total: r2(aplicada + bord + ms.reduce((a, m) => a + m.qtd, 0)), bordadura: r2(bord),
        motivos: [...(bord > 0.005 ? ['Bordadura'] : []), ...ms.map(m => m.motivo)], areaTalhao: r2(t.areaTalhao || 0),
      })
    }
  }
  return { fatos, voos }
}

// ── Os campos do banco ─────────────────────────────────────────────────────────────────────
// valor(F, ctx): F são os fatos da linha (ou todos, no cabeçalho/rodapé); ctx.geral diz se é
// cabeçalho/rodapé. tipo 'ha' sai com 2 casas ("22,42 ha" no texto, número no Excel).
const soma = (F, k) => r2(F.reduce((a, f) => a + (f[k] || 0), 0))
const voosDe = F => [...new Set(F.map(f => f.rel))]
const fazendasDe = F => unicos(F.map(f => `${norm(f.cliente)}|${norm(f.fazenda)}`))
const motivosDe = F => unicos(F.flatMap(f => f.motivos))
const talhoesUnicos = F => {
  const vistos = new Map()
  F.forEach(f => { if (f.talhao) vistos.set(`${norm(f.cliente)}|${norm(f.fazenda)}|${f.talhao}`, f) })
  return [...vistos.values()]
}
function listaTalhoes(F) {
  const ts = talhoesUnicos(F)
  const porFazenda = {}
  ts.forEach(f => { const k = f.codigo || f.fazenda; (porFazenda[k] = porFazenda[k] || []).push(f.talhao) })
  const chaves = Object.keys(porFazenda)
  const juntar = nomes => [...new Set(nomes)].sort(compararNomes).join(' - ')
  // Uma fazenda só: "001 - 002". Várias (no cabeçalho): "1900: 001 - 002 | 1204: 001".
  return chaves.length <= 1 ? juntar(ts.map(f => f.talhao)) : chaves.map(k => `${k}: ${juntar(porFazenda[k])}`).join(' | ')
}
function periodoDe(F, ctx) {
  if (ctx.geral) return `${dataBR(ctx.data)}${ctx.ate && ctx.ate > ctx.data ? ` a ${dataBR(ctx.ate)}` : ''}`
  const dias = unicos(F.map(f => f.dia)).sort()
  if (!dias.length) return ''
  return dias.length === 1 ? dataBR(dias[0]) : `${dataBR(dias[0])} a ${dataBR(dias[dias.length - 1])}`
}
function horario(F, campo, maisCedo) {
  const vals = voosDe(F).map(r => r[campo] || (campo === 'dt_fim' ? r.dt_inicio : null)).filter(Boolean)
    .map(v => new Date(v)).filter(d => !isNaN(d.getTime()))
  if (!vals.length) return ''
  const d = vals.reduce((a, b) => (maisCedo ? (b < a ? b : a) : (b > a ? b : a)))
  const variosDias = unicos(F.map(f => f.dia)).length > 1
  const iso = d.toISOString()
  return variosDias ? `${diaCurto(d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }))} ${horaBR(iso)}` : horaBR(iso)
}
function produtosDe(F, comQuantidade) {
  if (!comQuantidade) {
    const nomes = []
    voosDe(F).forEach(r => calcularGastoProdutos(r.produtos || [], 0).forEach(g => {
      if (g.nome) nomes.push(`${g.nome}${g.dose != null ? ` ${formatarDose(g.dose)} ${g.unidade}/ha` : ''}`)
    }))
    return unicos(nomes).join(' · ')
  }
  // Quantidade = dose × área aplicada de cada talhão, somada por produto (como o Formulário Nardini).
  const tot = new Map()
  F.forEach(f => calcularGastoProdutos(f.rel.produtos || [], f.aplicada).forEach(g => {
    if (!g.nome || g.total == null) return
    const k = `${g.nome}|${g.unidade}`
    tot.set(k, { nome: g.nome, unidade: g.unidade, total: (tot.get(k)?.total || 0) + g.total })
  }))
  return [...tot.values()].map(p => `${p.nome} ${formatarTotalProduto(p.total)} ${p.unidade}`).join(' · ')
}

export const CAMPOS = [
  // Área
  { id: 'area_aplicada', rotulo: 'Área Aplicada', grupo: 'Área', tipo: 'ha', valor: F => soma(F, 'aplicada') },
  { id: 'area_total', rotulo: 'Área Total', grupo: 'Área', tipo: 'ha', valor: F => soma(F, 'total') },
  { id: 'diferenca', rotulo: 'Diferença', grupo: 'Área', tipo: 'ha', valor: F => Math.max(0, r2(soma(F, 'total') - soma(F, 'aplicada'))) },
  { id: 'diferenca_motivo', rotulo: 'Diferença (com motivo)', grupo: 'Área', tipo: 'texto', valor: F => {
    const dif = Math.max(0, r2(soma(F, 'total') - soma(F, 'aplicada'))), ms = motivosDe(F)
    return `${dif > 0 ? `${fmtHa(dif)} ha` : '0'}${ms.length ? ` (${ms.join(', ')})` : ''}`
  } },
  { id: 'motivos', rotulo: 'Motivo da diferença', grupo: 'Área', tipo: 'texto', valor: F => motivosDe(F).join(', ') },
  { id: 'bordadura', rotulo: 'Bordadura', grupo: 'Área', tipo: 'ha', valor: F => soma(F, 'bordadura') },
  { id: 'area_cadastro', rotulo: 'Área do talhão (cadastro)', grupo: 'Área', tipo: 'ha', valor: F => r2(talhoesUnicos(F).reduce((a, f) => a + (f.areaTalhao || 0), 0)) },
  { id: 'rendimento_dia', rotulo: 'Rendimento por dia', grupo: 'Área', tipo: 'texto', valor: F => {
    const porDia = {}
    F.forEach(f => { porDia[f.dia] = (porDia[f.dia] || 0) + f.aplicada })
    return Object.keys(porDia).sort().map(d => `${diaCurto(d)}: ${fmtHa(porDia[d])} ha`).join(' · ')
  } },
  // Local
  { id: 'codigo_fazenda', rotulo: 'Código da Fazenda', grupo: 'Local', tipo: 'texto', valor: F => unicos(F.map(f => f.codigo || f.fazenda)).join(', ') },
  { id: 'fazenda', rotulo: 'Fazenda', grupo: 'Local', tipo: 'texto', valor: F => unicos(F.map(f => f.fazenda)).join(', ') },
  { id: 'talhoes', rotulo: 'Talhões', grupo: 'Local', tipo: 'texto', valor: F => listaTalhoes(F) },
  { id: 'qtd_talhoes', rotulo: 'Nº de talhões', grupo: 'Local', tipo: 'num', valor: F => talhoesUnicos(F).length },
  { id: 'qtd_fazendas', rotulo: 'Nº de fazendas', grupo: 'Local', tipo: 'num', valor: F => fazendasDe(F).length },
  { id: 'cliente', rotulo: 'Cliente', grupo: 'Local', tipo: 'texto', valor: F => unicos(F.map(f => f.cliente)).join(', ') },
  { id: 'municipio', rotulo: 'Município', grupo: 'Local', tipo: 'texto', valor: F => unicos(F.map(f => f.municipio)).join(', ') },
  // Operação
  { id: 'periodo', rotulo: 'Data de aplicação', grupo: 'Operação', tipo: 'texto', valor: periodoDe },
  { id: 'dias', rotulo: 'Dias', grupo: 'Operação', tipo: 'texto', valor: F => unicos(F.map(f => f.dia)).sort().map(diaCurto).join(', ') },
  { id: 'hora_inicio', rotulo: 'Início', grupo: 'Operação', tipo: 'texto', valor: F => horario(F, 'dt_inicio', true) },
  { id: 'hora_fim', rotulo: 'Fim', grupo: 'Operação', tipo: 'texto', valor: F => horario(F, 'dt_fim', false) },
  { id: 'qtd_voos', rotulo: 'Nº de voos', grupo: 'Operação', tipo: 'num', valor: F => voosDe(F).length },
  { id: 'pilotos', rotulo: 'Piloto(s)', grupo: 'Operação', tipo: 'texto', valor: F => unicos(voosDe(F).map(r => r.piloto_nome)).join(', ') },
  { id: 'drones', rotulo: 'Drone(s)', grupo: 'Operação', tipo: 'texto', valor: F => unicos(voosDe(F).map(r => r.drone)).join(', ') },
  { id: 'os_orofly', rotulo: 'OS (Orofly)', grupo: 'Operação', tipo: 'texto', valor: F => unicos(voosDe(F).map(r => r.ordem_servico && String(r.ordem_servico).toUpperCase())).join(', ') },
  { id: 'produtos', rotulo: 'Produtos (dose)', grupo: 'Operação', tipo: 'texto', valor: F => produtosDe(F, false) },
  { id: 'produtos_qtd', rotulo: 'Produtos (quantidade)', grupo: 'Operação', tipo: 'texto', valor: F => produtosDe(F, true) },
  { id: 'vazao', rotulo: 'Vazão', grupo: 'Operação', tipo: 'texto', valor: F => unicos(voosDe(F).map(r => { const v = parseFloat(r.vazao_i || r.vazao_f); return isNaN(v) ? '' : `${v.toLocaleString('pt-BR')} L/ha` })).join(', ') },
  // Geral
  { id: 'empresa', rotulo: 'Empresa', grupo: 'Geral', tipo: 'texto', valor: (F, ctx) => ctx.empresa || '' },
  { id: 'data_emissao', rotulo: 'Data de emissão', grupo: 'Geral', tipo: 'texto', valor: () => dataBR(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })) },
]
export const CAMPO = Object.fromEntries(CAMPOS.map(c => [c.id, c]))
export const GRUPOS_CAMPOS = ['Área', 'Local', 'Operação', 'Geral']

// ── Linhas da matriz ───────────────────────────────────────────────────────────────────────
export const AGRUPAMENTOS = [
  { id: 'fazenda', rotulo: 'Fazenda' },
  { id: 'talhao', rotulo: 'Talhão' },
  { id: 'voo', rotulo: 'Voo (relatório)' },
  { id: 'dia', rotulo: 'Dia' },
  { id: 'piloto', rotulo: 'Piloto' },
]
const ordemFazenda = (a, b) => (parseInt(a.codigo, 10) || Infinity) - (parseInt(b.codigo, 10) || Infinity) || compararNomes(a.fazenda, b.fazenda)
const CHAVE = {
  fazenda: f => `${norm(f.cliente)}|${norm(f.fazenda)}`,
  talhao: f => `${norm(f.cliente)}|${norm(f.fazenda)}|${f.talhao || ''}`,
  voo: f => String(f.rel.id ?? f.rel.dt_inicio),
  dia: f => f.dia,
  piloto: f => norm(f.rel.piloto_nome) || '—',
}
const ORDEM = {
  fazenda: (a, b) => ordemFazenda(a[0], b[0]),
  talhao: (a, b) => ordemFazenda(a[0], b[0]) || compararNomes(a[0].talhao || '', b[0].talhao || ''),
  voo: (a, b) => String(a[0].rel.dt_inicio || '').localeCompare(String(b[0].rel.dt_inicio || '')),
  dia: (a, b) => a[0].dia.localeCompare(b[0].dia),
  piloto: (a, b) => compararNomes(a[0].rel.piloto_nome || '', b[0].rel.piloto_nome || ''),
}
export function gruposDaMatriz(fatos, agrupar = 'fazenda') {
  const chave = CHAVE[agrupar] || CHAVE.fazenda
  const grupos = new Map()
  // Por talhão, o voo que não marcou talhão (sem área) viraria uma linha em branco: fica de fora.
  const lista = agrupar === 'talhao' ? fatos.filter(f => f.talhao) : fatos
  lista.forEach(f => { const k = chave(f); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(f) })
  return [...grupos.values()].sort(ORDEM[agrupar] || ORDEM.fazenda)
}

// ── Modelos ────────────────────────────────────────────────────────────────────────────────
let seq = 0
export const novoUid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`
export const itemDoCampo = id => ({ uid: novoUid(), campo: id, rotulo: CAMPO[id]?.rotulo || id })
export const itemFixo = (rotulo, valor = '') => ({ uid: novoUid(), campo: 'fixo', rotulo, valor })
export const ZONAS = [
  { id: 'cabecalho', rotulo: 'Cabeçalho', dica: 'uma vez, no topo' },
  { id: 'matriz', rotulo: 'Matriz', dica: 'uma linha por' },
  { id: 'rodape', rotulo: 'Rodapé', dica: 'uma vez, no fim' },
]

// O modelo de partida reproduz o texto do Apontamento diário.
export function modeloPadrao() {
  return {
    id: 'padrao', nome: 'Padrão (igual ao Apontamento diário)', titulo: 'APONTAMENTO DIÁRIO – {cliente}', agrupar: 'fazenda',
    cabecalho: [itemDoCampo('empresa'), itemFixo('Operação'), itemDoCampo('periodo')],
    matriz: [itemFixo('O.S.'), itemDoCampo('codigo_fazenda'), itemDoCampo('talhoes'), itemDoCampo('area_total'),
      itemDoCampo('area_aplicada'), { ...itemDoCampo('diferenca_motivo'), rotulo: 'Diferença' }],
    rodape: [{ ...itemDoCampo('area_aplicada'), rotulo: 'Rendimento total do dia' }],
  }
}

// Modelo vindo do banco ou do aparelho: completa o que faltar e descarta campo que não existe mais.
export function normalizarModelo(m) {
  const lista = arr => (Array.isArray(arr) ? arr : [])
    .filter(i => i && (i.campo === 'fixo' || CAMPO[i.campo]))
    .map(i => ({ uid: i.uid || novoUid(), campo: i.campo, rotulo: String(i.rotulo ?? CAMPO[i.campo]?.rotulo ?? ''), ...(i.campo === 'fixo' ? { valor: String(i.valor ?? '') } : {}) }))
  return {
    id: m?.id || novoUid(), nome: String(m?.nome || 'Modelo sem nome'), titulo: String(m?.titulo ?? ''),
    agrupar: CHAVE[m?.agrupar] ? m.agrupar : 'fazenda',
    cabecalho: lista(m?.cabecalho), matriz: lista(m?.matriz), rodape: lista(m?.rodape),
  }
}

// ── Montagem ───────────────────────────────────────────────────────────────────────────────
// Valor de um item: { bruto (número ou texto), texto (como sai no relatório) }.
function valorDoItem(item, F, ctx) {
  if (item.campo === 'fixo') return { bruto: item.valor || '', texto: item.valor || '' }
  const c = CAMPO[item.campo]
  if (!c) return { bruto: '', texto: '' }
  const v = c.valor(F, ctx)
  if (c.tipo === 'ha') return { bruto: r2(v), texto: `${fmtHa(v)} ha`, numero: fmtHa(v) }
  if (c.tipo === 'num') return { bruto: Number(v) || 0, texto: String(Number(v) || 0) }
  return { bruto: v ?? '', texto: String(v ?? '') }
}

export function montarApontamento(modelo, { fatos, data, ate = '', empresa = '', cliente = '' }) {
  const m = normalizarModelo(modelo)
  const geral = { geral: true, data, ate, empresa }
  const linha = { geral: false, data, ate, empresa }
  const grupos = gruposDaMatriz(fatos, m.agrupar)
  const titulo = m.titulo.replace(/\{cliente\}/gi, cliente || unicos(fatos.map(f => f.cliente)).join(', ')).replace(/\s*[–-]\s*$/, '').trim()
  return {
    titulo,
    cabecalho: m.cabecalho.map(i => ({ item: i, ...valorDoItem(i, fatos, geral) })),
    colunas: m.matriz.map(i => ({ item: i, tipo: i.campo === 'fixo' ? 'texto' : CAMPO[i.campo]?.tipo })),
    linhas: grupos.map(F => m.matriz.map(i => valorDoItem(i, F, linha))),
    rodape: m.rodape.map(i => ({ item: i, ...valorDoItem(i, fatos, geral) })),
    voos: unicos(fatos.map(f => f.rel)).length,
  }
}

const linhaTexto = (rotulo, texto) => `${rotulo}:${texto !== '' ? ` ${texto}` : ''}`

// Texto pra copiar ou mandar no WhatsApp: título, cabeçalho, um bloco por linha da matriz e o
// rodapé, separados por linha em branco (o mesmo desenho do Apontamento diário).
export function textoPersonalizado(ap) {
  const secoes = []
  if (ap.titulo) secoes.push([ap.titulo])
  if (ap.cabecalho.length) secoes.push(ap.cabecalho.map(c => linhaTexto(c.item.rotulo, c.texto)))
  if (ap.colunas.length) ap.linhas.forEach(l => secoes.push(l.map((v, i) => linhaTexto(ap.colunas[i].item.rotulo, v.texto))))
  if (ap.rodape.length) secoes.push(ap.rodape.map(c => linhaTexto(c.item.rotulo, c.texto)))
  return secoes.map(s => s.join('\n')).join('\n\n')
}

// Planilha (linhas e colunas) pro Excel: título, cabeçalho em pares, a matriz como tabela e o rodapé.
export function planilhaPersonalizada(ap) {
  const aoa = []
  if (ap.titulo) aoa.push([ap.titulo], [])
  ap.cabecalho.forEach(c => aoa.push([c.item.rotulo, c.bruto]))
  if (ap.cabecalho.length) aoa.push([])
  if (ap.colunas.length) {
    aoa.push(ap.colunas.map(c => c.item.rotulo))
    ap.linhas.forEach(l => aoa.push(l.map(v => v.bruto)))
    aoa.push([])
  }
  ap.rodape.forEach(c => aoa.push([c.item.rotulo, c.bruto]))
  return aoa
}

// Financeiro (Beta) — o que veio da plataforma do Isaque (análise de 13/10/2026): lançamentos
// a pagar e a receber, DRE, dashboard, orçamento e simulador de preço por hectare.
//
// Só contas aqui, sem tela e sem banco: a tela (components/FinanceiroBeta.jsx) chama estas
// funções, e elas dão pra testar no Node com dados de exemplo.
//
// Lançamento (tabela fin_lancamentos):
//   { id, tipo: 'receber'|'pagar', descricao, categoria, valor, competencia, vencimento,
//     pago_em, cliente_fornecedor, forma_pagamento, observacao, origem, origem_ref }
// Datas são 'AAAA-MM-DD' puras (coluna `date`): comparadas como texto, nunca por new Date —
// no fuso do Brasil o dia 1º viraria o último dia do mês anterior.
import * as XLSX from 'xlsx'
import { areaFaturavel, precoDoVoo, indexarClientes, mesDoVoo } from './faturamento'

// ── Plano de contas ──────────────────────────────────────────────────────────────────
// `grupo` decide a linha da DRE. Investimento (compra de drone, caminhonete) mexe no caixa
// mas não é despesa do mês: fica fora da DRE — a depreciação é que entra.
export const GRUPOS_DRE = {
  receita: 'Receita bruta',
  impostos: 'Impostos sobre a receita',
  custo: 'Custo do serviço',
  operacional: 'Despesas operacionais e administrativas',
  depreciacao: 'Depreciação',
  financeiro: 'Resultado financeiro',
  investimento: 'Investimentos (fora da DRE)',
}
export const PLANO_CONTAS = [
  // receitas
  { nome: 'Serviço de pulverização', tipo: 'receber', grupo: 'receita' },
  { nome: 'Outras receitas', tipo: 'receber', grupo: 'receita' },
  { nome: 'Receitas financeiras', tipo: 'receber', grupo: 'financeiro' },
  // despesas
  { nome: 'Impostos sobre faturamento', tipo: 'pagar', grupo: 'impostos' },
  { nome: 'Combustível', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Baterias e energia', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Manutenção de drones', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Peças e ferramentas', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Salários da operação', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Encargos e benefícios', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Viagens: alimentação e hotel', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Pedágio', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Insumos', tipo: 'pagar', grupo: 'custo' },
  { nome: 'Veículos', tipo: 'pagar', grupo: 'operacional' },
  { nome: 'Salários administrativos', tipo: 'pagar', grupo: 'operacional' },
  { nome: 'Aluguel e estrutura', tipo: 'pagar', grupo: 'operacional' },
  { nome: 'Seguros', tipo: 'pagar', grupo: 'operacional' },
  { nome: 'Contabilidade e jurídico', tipo: 'pagar', grupo: 'operacional' },
  { nome: 'Software e telefonia', tipo: 'pagar', grupo: 'operacional' },
  { nome: 'Marketing e comercial', tipo: 'pagar', grupo: 'operacional' },
  { nome: 'Outras despesas', tipo: 'pagar', grupo: 'operacional' },
  { nome: 'Depreciação', tipo: 'pagar', grupo: 'depreciacao' },
  { nome: 'Juros e tarifas bancárias', tipo: 'pagar', grupo: 'financeiro' },
  { nome: 'Compra de equipamentos', tipo: 'pagar', grupo: 'investimento' },
]
const PORNOME = Object.fromEntries(PLANO_CONTAS.map(c => [c.nome, c]))
// Categoria fora do plano (veio de planilha, por exemplo): cai em "Outras" do tipo dela.
export const contaDe = (categoria, tipo) => PORNOME[categoria] || (tipo === 'receber' ? PORNOME['Outras receitas'] : PORNOME['Outras despesas'])
export const categoriasDoTipo = tipo => PLANO_CONTAS.filter(c => c.tipo === tipo).map(c => c.nome)

// ── Datas e valores ──────────────────────────────────────────────────────────────────
export const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
export const somarDias = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(a, m - 1, d + n)); return t.toISOString().slice(0, 10) }
export const mesDe = iso => String(iso || '').slice(0, 7)
export const inicioDoMes = mes => `${mes}-01`
export const fimDoMes = mes => { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) }
export const moeda = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const numBR = v => { if (typeof v === 'number') return v; const s = String(v ?? '').replace(/[R$\s]/g, ''); const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return isNaN(n) ? NaN : n }

// ── Status ───────────────────────────────────────────────────────────────────────────
// Realizado = pago/recebido; vencido = passou do vencimento sem pagar; previsto = ainda vai vencer.
export function statusDe(l, hoje = hojeISO()) {
  if (l.pago_em) return 'realizado'
  return l.vencimento < hoje ? 'vencido' : 'previsto'
}
export const ROTULO_STATUS = { realizado: 'Realizado', vencido: 'Vencido', previsto: 'Previsto' }
const sinal = l => (l.tipo === 'receber' ? 1 : -1)

// ── Dashboard ────────────────────────────────────────────────────────────────────────
// Saldo em caixa = saldo inicial (Configurações do financeiro) + tudo que foi recebido − tudo
// que foi pago desde a data dele.
export function resumoDashboard(lancs, { saldoInicial = 0, dataSaldo = '0000-01-01', hoje = hojeISO(), mes = mesDe(hoje) } = {}) {
  let caixa = num0(saldoInicial)
  let receitasMes = 0, despesasPagasMes = 0, aReceberMes = 0, aPagarMes = 0
  let vence7 = 0, vence7Qtd = 0, vencidosPagar = 0, vencidosReceber = 0, vencidosQtd = 0
  const ate7 = somarDias(hoje, 7)
  for (const l of lancs) {
    const v = num0(l.valor)
    if (l.pago_em && l.pago_em >= dataSaldo && l.pago_em <= hoje) caixa += sinal(l) * v
    if (l.pago_em && mesDe(l.pago_em) === mes) { if (l.tipo === 'receber') receitasMes += v; else despesasPagasMes += v }
    if (!l.pago_em && mesDe(l.vencimento) === mes) { if (l.tipo === 'receber') aReceberMes += v; else aPagarMes += v }
    if (!l.pago_em && l.vencimento >= hoje && l.vencimento <= ate7) { vence7 += sinal(l) * v; vence7Qtd++ }
    if (!l.pago_em && l.vencimento < hoje) { vencidosQtd++; if (l.tipo === 'receber') vencidosReceber += v; else vencidosPagar += v }
  }
  return { caixa, receitasMes, despesasPagasMes, aReceberMes, aPagarMes, vence7, vence7Qtd, vencidosPagar, vencidosReceber, vencidosQtd }
}
const num0 = v => { const n = numBR(v); return isNaN(n) ? 0 : n }

// Entradas × saídas realizadas por mês (regime de caixa), dos últimos `n` meses.
export function fluxoMensal(lancs, meses) {
  const linhas = meses.map(m => ({ mes: m, entradas: 0, saidas: 0 }))
  const idx = Object.fromEntries(meses.map((m, i) => [m, i]))
  for (const l of lancs) {
    if (!l.pago_em) continue
    const i = idx[mesDe(l.pago_em)]
    if (i == null) continue
    if (l.tipo === 'receber') linhas[i].entradas += num0(l.valor); else linhas[i].saidas += num0(l.valor)
  }
  return linhas.map(x => ({ ...x, saldo: x.entradas - x.saidas }))
}
// Total por categoria no período (despesas ou receitas), do maior pro menor.
export function porCategoria(lancs, tipo, { ini, fim, regime = 'competencia' }) {
  const tot = {}
  for (const l of lancs) {
    if (l.tipo !== tipo) continue
    const d = dataDoRegime(l, regime)
    if (!d || d < ini || d > fim) continue
    tot[l.categoria] = (tot[l.categoria] || 0) + num0(l.valor)
  }
  return Object.entries(tot).map(([categoria, valor]) => ({ categoria, valor })).sort((a, b) => b.valor - a.valor)
}

// ── DRE ──────────────────────────────────────────────────────────────────────────────
// Competência: pelo mês a que o lançamento se refere. Caixa: pelo dia em que o dinheiro
// entrou ou saiu (só o realizado).
export const dataDoRegime = (l, regime) => (regime === 'caixa' ? l.pago_em || null : l.competencia)

export function montarDRE(lancs, { ini, fim, regime = 'competencia' }) {
  const g = { receita: 0, impostos: 0, custo: 0, operacional: 0, depreciacao: 0, financeiro: 0 }
  const itens = { receita: [], impostos: [], custo: [], operacional: [], depreciacao: [], financeiro: [] }
  for (const l of lancs) {
    const d = dataDoRegime(l, regime)
    if (!d || d < ini || d > fim) continue
    const conta = contaDe(l.categoria, l.tipo)
    if (conta.grupo === 'investimento') continue
    // Resultado financeiro: receita soma, despesa subtrai; nos demais grupos o valor entra positivo.
    const v = conta.grupo === 'financeiro' ? sinal(l) * num0(l.valor) : num0(l.valor)
    g[conta.grupo] += v
    itens[conta.grupo].push(l)
  }
  const receitaLiquida = g.receita - g.impostos
  const lucroBruto = receitaLiquida - g.custo
  const ebitda = lucroBruto - g.operacional
  const ebit = ebitda - g.depreciacao
  const resultado = ebit + g.financeiro
  const pct = v => (g.receita > 0 ? (v / g.receita) * 100 : null)
  const L = (id, rotulo, valor, { grupo = null, nivel = 1, sinal: s = '' } = {}) => ({ id, rotulo, valor, grupo, nivel, sinal: s, pct: pct(valor), itens: grupo ? itens[grupo] : null })
  return [
    L('receita', GRUPOS_DRE.receita, g.receita, { grupo: 'receita' }),
    L('impostos', `(−) ${GRUPOS_DRE.impostos}`, -g.impostos, { grupo: 'impostos', nivel: 2 }),
    L('receita_liquida', '= Receita líquida', receitaLiquida, { nivel: 0 }),
    L('custo', `(−) ${GRUPOS_DRE.custo}`, -g.custo, { grupo: 'custo', nivel: 2 }),
    L('lucro_bruto', '= Lucro bruto', lucroBruto, { nivel: 0 }),
    L('operacional', `(−) ${GRUPOS_DRE.operacional}`, -g.operacional, { grupo: 'operacional', nivel: 2 }),
    L('ebitda', '= EBITDA', ebitda, { nivel: 0 }),
    L('depreciacao', `(−) ${GRUPOS_DRE.depreciacao}`, -g.depreciacao, { grupo: 'depreciacao', nivel: 2 }),
    L('ebit', '= EBIT (resultado operacional)', ebit, { nivel: 0 }),
    L('financeiro', `(±) ${GRUPOS_DRE.financeiro}`, g.financeiro, { grupo: 'financeiro', nivel: 2 }),
    L('resultado', '= Resultado líquido', resultado, { nivel: 0 }),
  ]
}

// ── Do Orofly pro financeiro ─────────────────────────────────────────────────────────
// Nota do piloto conferida pelo administrativo vira despesa paga (o piloto paga na hora com
// o cartão da empresa). `origem_ref` = id da nota: trazer de novo não duplica.
const CATEGORIA_DA_NOTA = {
  'Combustível': 'Combustível', 'Gasolina': 'Combustível',
  'Alimentação': 'Viagens: alimentação e hotel', 'Almoço': 'Viagens: alimentação e hotel', 'Hotel': 'Viagens: alimentação e hotel',
  'Pedágio': 'Pedágio', 'Manutenção': 'Manutenção de drones', 'Peças': 'Peças e ferramentas', 'Ferramentas': 'Peças e ferramentas',
}
export function lancamentosDasNotas(despesas, { soConferidas = true } = {}) {
  return (despesas || [])
    .filter(d => num0(d.valor) > 0 && /^\d{4}-\d{2}-\d{2}/.test(String(d.data || '')) && (!soConferidas || d.conferido))
    .map(d => {
      const data = String(d.data).slice(0, 10)
      return {
        tipo: 'pagar', categoria: CATEGORIA_DA_NOTA[d.categoria] || 'Outras despesas',
        descricao: `Nota ${d.categoria || ''} — ${d.piloto_nome || 'piloto'}`.trim(),
        valor: +num0(d.valor).toFixed(2), competencia: data, vencimento: data, pago_em: data,
        cliente_fornecedor: d.piloto_nome || null,
        forma_pagamento: [d.forma_pagamento, d.cartao].filter(Boolean).join(' · ') || null,
        observacao: d.observacao || null, origem: 'nota', origem_ref: String(d.id),
      }
    })
}

// Hectares voados × preço do cliente viram uma conta a receber por cliente por mês (o
// faturamento da operação). Previsto até alguém marcar recebido; vencimento no dia
// `diaVencimento` do mês seguinte. `semPreco` lista o que ficou de fora — sem ele o total
// pareceria menor que a realidade.
export function lancamentosDosVoos(relatorios, clientes, { diaVencimento = 10, ateMes = mesDe(hojeISO()) } = {}) {
  const porNome = indexarClientes(clientes)
  const grupos = {}
  const semPreco = {}
  for (const v of relatorios || []) {
    if (!['finalizado', 'pausado_dia'].includes(v.status) || v.teste) continue
    const mes = mesDoVoo(v)
    if (!mes || mes > ateMes) continue
    const preco = precoDoVoo(v, porNome)
    const area = areaFaturavel(v)
    if (preco == null) { const k = v.cliente || '—'; semPreco[k] = (semPreco[k] || 0) + area; continue }
    const k = `${v.cliente}|${mes}`
    const gr = grupos[k] || (grupos[k] = { cliente: v.cliente, mes, area: 0, valor: 0, voos: 0 })
    gr.area += area; gr.valor += preco * area; gr.voos++
  }
  const lancs = Object.values(grupos).filter(gr => gr.valor > 0.005).sort((a, b) => a.mes.localeCompare(b.mes) || a.cliente.localeCompare(b.cliente)).map(gr => {
    const [a, m] = gr.mes.split('-').map(Number)
    const prox = `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`
    return {
      tipo: 'receber', categoria: 'Serviço de pulverização',
      descricao: `Pulverização ${gr.cliente} — ${gr.area.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha em ${gr.voos} voo${gr.voos === 1 ? '' : 's'}`,
      valor: +gr.valor.toFixed(2), competencia: fimDoMes(gr.mes), vencimento: `${prox}-${String(Math.min(28, Math.max(1, diaVencimento))).padStart(2, '0')}`,
      pago_em: null, cliente_fornecedor: gr.cliente, origem: 'voos', origem_ref: `${gr.cliente}|${gr.mes}`,
    }
  })
  return { lancs, semPreco: Object.entries(semPreco).map(([cliente, area]) => ({ cliente, area })) }
}

// Junta o que veio do Orofly com o que já está no banco, pela origem_ref. Lançamento já pago
// não muda (alguém conferiu e baixou); o previsto é atualizado se o valor mudou (voo editado).
export function planejarSincronizacao(novos, existentes) {
  const porRef = Object.fromEntries((existentes || []).filter(e => e.origem_ref).map(e => [`${e.origem}|${e.origem_ref}`, e]))
  const inserir = [], atualizar = []
  let iguais = 0, travados = 0
  for (const n of novos) {
    const e = porRef[`${n.origem}|${n.origem_ref}`]
    if (!e) { inserir.push(n); continue }
    if (e.pago_em && n.origem === 'voos') { travados++; continue }
    if (Math.abs(num0(e.valor) - n.valor) < 0.005 && e.descricao === n.descricao) { iguais++; continue }
    atualizar.push({ id: e.id, valor: n.valor, descricao: n.descricao })
  }
  return { inserir, atualizar, iguais, travados }
}

// ── Importação por planilha ──────────────────────────────────────────────────────────
// Aceita a exportação do sistema do Isaque ou uma planilha montada à mão: procura na primeira
// linha colunas com estes nomes (sem acento, sem caixa). Tipo vem da coluna Tipo ou do sinal
// do valor (negativo = pagar).
const chave = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const COLS = {
  tipo: ['tipo', 'natureza', 'pagarreceber', 'entradasaida', 'operacao'],
  descricao: ['descricao', 'historico', 'lancamento', 'nome', 'detalhe'],
  categoria: ['categoria', 'conta', 'planodecontas', 'classificacao', 'categoriadre'],
  valor: ['valor', 'valorr', 'valortotal', 'montante', 'total'],
  competencia: ['competencia', 'datacompetencia', 'mescompetencia', 'data', 'emissao', 'dataemissao'],
  vencimento: ['vencimento', 'datavencimento', 'venc'],
  pago_em: ['pagoem', 'datapagamento', 'pagamento', 'dataliquidacao', 'liquidacao', 'recebidoem', 'datarecebimento', 'baixa'],
  status: ['status', 'situacao'],
  cliente_fornecedor: ['clientefornecedor', 'fornecedor', 'cliente', 'favorecido', 'pessoa'],
  forma_pagamento: ['formadepagamento', 'formapagamento', 'forma', 'meio'],
  observacao: ['observacao', 'obs', 'observacoes'],
}
function dataISO(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null }
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{4})$/.exec(s) // mês/ano
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`
  return null
}
export function lerPlanilhaLancamentos(dados) {
  const wb = XLSX.read(dados, { type: 'array', cellDates: false })
  for (const aba of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: '' })
    const iCab = linhas.findIndex(l => l.some(c => COLS.valor.includes(chave(c))) && l.some(c => [...COLS.descricao, ...COLS.categoria].includes(chave(c))))
    if (iCab < 0) continue
    const cab = linhas[iCab].map(chave)
    const col = Object.fromEntries(Object.entries(COLS).map(([k, nomes]) => [k, cab.findIndex(c => nomes.includes(c))]))
    const pega = (l, k) => (col[k] >= 0 ? l[col[k]] : '')
    const ok = [], erros = []
    linhas.slice(iCab + 1).forEach((l, i) => {
      if (!l.some(c => String(c).trim())) return
      const bruto = numBR(pega(l, 'valor'))
      if (isNaN(bruto) || bruto === 0) { erros.push({ linha: iCab + i + 2, motivo: 'sem valor' }); return }
      const tipoTxt = chave(pega(l, 'tipo'))
      const tipo = /receb|receit|entrada|credito|cr$/.test(tipoTxt) ? 'receber' : /pag|despes|saida|debito|db$/.test(tipoTxt) ? 'pagar' : bruto < 0 ? 'pagar' : 'receber'
      const comp = dataISO(pega(l, 'competencia')) || dataISO(pega(l, 'vencimento'))
      if (!comp) { erros.push({ linha: iCab + i + 2, motivo: 'sem data' }); return }
      const venc = dataISO(pega(l, 'vencimento')) || comp
      let pago = dataISO(pega(l, 'pago_em'))
      // Sem data de pagamento mas status "pago/recebido/realizado/liquidado": pago no vencimento.
      if (!pago && /pago|recebido|realizado|liquidado|baixado|quitado/.test(chave(pega(l, 'status')))) pago = venc
      const catOriginal = String(pega(l, 'categoria') || '').trim()
      const conta = PORNOME[catOriginal] ? catOriginal : achaCategoria(catOriginal, tipo)
      const desc = String(pega(l, 'descricao') || '').trim()
      ok.push({
        tipo, categoria: conta, valor: +Math.abs(bruto).toFixed(2), competencia: comp, vencimento: venc, pago_em: pago,
        descricao: desc || catOriginal || '(sem descrição)',
        cliente_fornecedor: String(pega(l, 'cliente_fornecedor') || '').trim() || null,
        forma_pagamento: String(pega(l, 'forma_pagamento') || '').trim() || null,
        observacao: [String(pega(l, 'observacao') || '').trim(), catOriginal && catOriginal !== conta ? `Categoria na planilha: ${catOriginal}` : ''].filter(Boolean).join(' · ') || null,
        origem: 'planilha', origem_ref: null,
      })
    })
    return { aba, lancamentos: ok, erros }
  }
  return null
}
// Categoria da planilha que não é do plano: procura uma conta com palavra em comum.
const PISTAS = [
  [/combust|diesel|gasol|etanol|arla/, 'Combustível'], [/bateri|energia|gerador/, 'Baterias e energia'],
  [/manut|conserto|revis/, 'Manutenção de drones'], [/peca|ferrament/, 'Peças e ferramentas'],
  [/salario|folha|pro.?labore/, 'Salários da operação'], [/encargo|inss|fgts|beneficio|vale/, 'Encargos e benefícios'],
  [/aliment|refeic|hotel|hosped|diaria|viagem/, 'Viagens: alimentação e hotel'], [/pedagio/, 'Pedágio'],
  [/insumo|produto|defensivo/, 'Insumos'], [/veicul|caminhonete|ipva|licenciament/, 'Veículos'],
  [/aluguel|estrutura|condominio/, 'Aluguel e estrutura'], [/seguro/, 'Seguros'],
  [/contab|juridic|advoga/, 'Contabilidade e jurídico'], [/software|sistema|telefon|internet|celular/, 'Software e telefonia'],
  [/marketing|comercial|propaganda/, 'Marketing e comercial'], [/imposto|simples|iss|pis|cofins|das/, 'Impostos sobre faturamento'],
  [/deprecia/, 'Depreciação'], [/juros|tarifa|banc|iof/, 'Juros e tarifas bancárias'],
  [/compra.*(drone|equip|caminhonete)|investiment/, 'Compra de equipamentos'],
  [/pulveriz|servico|aplicac/, 'Serviço de pulverização'], [/rendiment|aplicacao financeira/, 'Receitas financeiras'],
]
function achaCategoria(txt, tipo) {
  const k = chave(txt)
  for (const [re, nome] of PISTAS) if (re.test(k) && PORNOME[nome].tipo === tipo) return nome
  return tipo === 'receber' ? 'Outras receitas' : 'Outras despesas'
}

// ── Orçamento ────────────────────────────────────────────────────────────────────────
// Orçado × realizado do mês por categoria (regime de competência).
export function orcadoRealizado(orcamento, lancs, mes) {
  const ini = inicioDoMes(mes), fim = fimDoMes(mes)
  const real = {}
  for (const l of lancs) { if (l.competencia >= ini && l.competencia <= fim) real[l.categoria] = (real[l.categoria] || 0) + num0(l.valor) }
  const orc = {}
  for (const o of orcamento || []) if (mesDe(o.mes) === mes) orc[o.categoria] = num0(o.valor)
  return PLANO_CONTAS.filter(c => c.grupo !== 'investimento' && (orc[c.nome] || real[c.nome]))
    .map(c => ({ categoria: c.nome, tipo: c.tipo, grupo: c.grupo, orcado: orc[c.nome] || 0, realizado: real[c.nome] || 0 }))
    .map(x => ({ ...x, diferenca: x.realizado - x.orcado, pct: x.orcado ? (x.realizado / x.orcado) * 100 : null }))
}
// Planilha do orçamento: uma linha por categoria e uma coluna por mês (jan…dez ou 01…12).
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export function lerPlanilhaOrcamento(dados, ano) {
  const wb = XLSX.read(dados, { type: 'array' })
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
  const iCab = linhas.findIndex(l => l.filter(c => MESES_ABREV.some(m => chave(c).startsWith(m)) || /^(0?[1-9]|1[0-2])$/.test(String(c).trim())).length >= 6)
  if (iCab < 0) return null
  const cab = linhas[iCab]
  const colMes = cab.map(c => { const k = chave(c); const i = MESES_ABREV.findIndex(m => k.startsWith(m)); if (i >= 0) return i; const n = parseInt(String(c).trim(), 10); return n >= 1 && n <= 12 && String(n) === String(c).trim().replace(/^0/, '') ? n - 1 : -1 })
  const out = []
  for (const l of linhas.slice(iCab + 1)) {
    const cat = String(l.find((c, i) => colMes[i] < 0 && String(c).trim()) || '').trim()
    if (!cat) continue
    const conta = PORNOME[cat] ? cat : achaCategoria(cat, /receit|fatur|venda/.test(chave(cat)) ? 'receber' : 'pagar')
    colMes.forEach((m, i) => { if (m < 0) return; const v = numBR(l[i]); if (!isNaN(v) && v) out.push({ mes: `${ano}-${String(m + 1).padStart(2, '0')}-01`, categoria: conta, valor: +Math.abs(v).toFixed(2) }) })
  }
  // A mesma conta pode vir de duas linhas da planilha: soma.
  const soma = {}
  out.forEach(o => { const k = `${o.mes}|${o.categoria}`; soma[k] = (soma[k] || 0) + o.valor })
  return Object.entries(soma).map(([k, valor]) => { const [mes, categoria] = k.split('|'); return { mes, categoria, valor: +valor.toFixed(2) } })
}

// ── Simulador de preço ───────────────────────────────────────────────────────────────
// Preço por hectare a partir do custo da operação de um mês. Os custos fixos (salários,
// depreciação, administrativo) se espalham pela área que a frota consegue fazer no mês; os
// variáveis (bateria, gerador, caminhonete, diárias) vão por hectare. O preço é o custo
// dividido pelo que sobra depois de impostos, margem e risco ("por dentro").
export const SIMULADOR_PADRAO = {
  drones: [
    // ha/hora: o real dos voos de set–nov/2026 (T25P 5,4; T70 8,7). Valores de compra e
    // bateria são ponto de partida — a tela troca pelo que a empresa pagou.
    { modelo: 'T25', qtd: 2, haPorHora: 5.4, valor: 120000, vidaAnos: 4, bateriaPreco: 9000, bateriaCiclos: 1000, haPorBateria: 1.4, geradorLh: 3, horasDia: 7 },
    { modelo: 'T70', qtd: 2, haPorHora: 8.7, valor: 220000, vidaAnos: 4, bateriaPreco: 14000, bateriaCiclos: 1000, haPorBateria: 2.5, geradorLh: 4, horasDia: 7 },
  ],
  diasMes: 22, utilizacao: 70,
  combustivelPreco: 6.2,
  caminhonetes: { qtd: 2, valor: 280000, vidaAnos: 5, kmMes: 3500, kmPorLitro: 9 },
  equipe: { pilotos: 4, salario: 4500, encargosPct: 80, diaria: 90, pedagioDia: 20 },
  administrativoMes: 15000,
  impostosPct: 11, margemPct: 20, riscoPct: 5,
  proposta: { cliente: '', areaHa: 500, validadeDias: 15 },
}
export function simularPreco(p) {
  const n = v => num0(v)
  const dias = Math.max(1, n(p.diasMes))
  const util = Math.min(100, Math.max(0, n(p.utilizacao))) / 100
  const drones = (p.drones || []).filter(d => n(d.qtd) > 0)
  // Capacidade: ha/hora × horas/dia × dias × qtd, vezes a utilização (chuva, deslocamento, vento).
  const porModelo = drones.map(d => {
    const area = n(d.qtd) * n(d.haPorHora) * n(d.horasDia) * dias * util
    const deprec = n(d.qtd) * (n(d.vidaAnos) > 0 ? n(d.valor) / (n(d.vidaAnos) * 12) : 0)
    const bateriaHa = n(d.bateriaCiclos) > 0 && n(d.haPorBateria) > 0 ? n(d.bateriaPreco) / (n(d.bateriaCiclos) * n(d.haPorBateria)) : 0
    const geradorHa = n(d.haPorHora) > 0 ? (n(d.geradorLh) * n(p.combustivelPreco)) / n(d.haPorHora) : 0
    return { modelo: d.modelo, area, deprec, bateria: bateriaHa * area, gerador: geradorHa * area }
  })
  const area = porModelo.reduce((a, x) => a + x.area, 0)
  const c = p.caminhonetes || {}
  const e = p.equipe || {}
  const fixos = {
    'Salários e encargos': n(e.pilotos) * n(e.salario) * (1 + n(e.encargosPct) / 100),
    'Depreciação dos drones': porModelo.reduce((a, x) => a + x.deprec, 0),
    'Depreciação das caminhonetes': n(c.qtd) * (n(c.vidaAnos) > 0 ? n(c.valor) / (n(c.vidaAnos) * 12) : 0),
    'Administrativo rateado': n(p.administrativoMes),
  }
  const variaveis = {
    'Baterias': porModelo.reduce((a, x) => a + x.bateria, 0),
    'Combustível do gerador': porModelo.reduce((a, x) => a + x.gerador, 0),
    'Combustível das caminhonetes': n(c.kmPorLitro) > 0 ? n(c.qtd) * (n(c.kmMes) / n(c.kmPorLitro)) * n(p.combustivelPreco) : 0,
    'Diárias, alimentação e pedágio': n(e.pilotos) * dias * (n(e.diaria) + n(e.pedagioDia)),
  }
  const totalMes = [...Object.values(fixos), ...Object.values(variaveis)].reduce((a, v) => a + v, 0)
  const custoHa = area > 0 ? totalMes / area : 0
  const descontos = (n(p.impostosPct) + n(p.margemPct) + n(p.riscoPct)) / 100
  const precoHa = descontos < 1 && custoHa > 0 ? custoHa / (1 - descontos) : 0
  const composicao = [...Object.entries(fixos).map(([k, v]) => ({ item: k, tipo: 'fixo', mes: v })), ...Object.entries(variaveis).map(([k, v]) => ({ item: k, tipo: 'variável', mes: v }))]
    .map(x => ({ ...x, porHa: area > 0 ? x.mes / area : 0 }))
  const areaProp = n(p.proposta?.areaHa)
  return {
    areaMes: area, porModelo, totalMes, custoHa, precoHa,
    impostosHa: precoHa * n(p.impostosPct) / 100, margemHa: precoHa * n(p.margemPct) / 100, riscoHa: precoHa * n(p.riscoPct) / 100,
    composicao, valido: descontos < 1 && area > 0,
    proposta: { areaHa: areaProp, total: precoHa * areaProp, diasNecessarios: area > 0 ? areaProp / (area / dias) : 0 },
  }
}

// Rendimento REAL de cada modelo de drone, pelos voos: hectares por hora de voo (do início ao
// fim, menos as pausas). Só voos com mais de 30 min — lançado depois não tem horário real.
export function rendimentoReal(relatorios, drones, { dias = 90, hoje = hojeISO() } = {}) {
  const modeloDe = {}
  ;(drones || []).forEach(d => { if (d.nome) modeloDe[d.nome] = (d.modelo || '').toUpperCase() })
  const desde = somarDias(hoje, -dias)
  const tot = {}
  for (const v of relatorios || []) {
    if (!['finalizado', 'pausado_dia'].includes(v.status) || v.teste || !v.dt_inicio || !v.dt_fim) continue
    if (String(v.dt_inicio).slice(0, 10) < desde) continue
    let ms = Date.parse(v.dt_fim) - Date.parse(v.dt_inicio)
    ;(v.pausas || []).forEach(p => { if (p?.inicio && p?.fim) ms -= Math.max(0, Date.parse(p.fim) - Date.parse(p.inicio)) })
    const h = ms / 3600000
    if (!(h >= 0.5 && h <= 16)) continue
    const nome = String(v.drone || '')
    const modelo = modeloDe[nome] || (/(T\d+P?)/i.exec(nome)?.[1] || '').toUpperCase()
    if (!modelo) continue
    const t = tot[modelo] || (tot[modelo] = { modelo, horas: 0, area: 0, voos: 0 })
    t.horas += h; t.area += areaFaturavel(v); t.voos++
  }
  return Object.values(tot).map(t => ({ ...t, haPorHora: t.horas > 0 ? t.area / t.horas : 0 })).sort((a, b) => b.area - a.area)
}

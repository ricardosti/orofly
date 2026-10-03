// Receita de um voo, pelo preço por hectare cadastrado no cliente.
//
// Existe pra que o gráfico "Recebido × Gasto" e o card de receita do painel usem a MESMA
// conta. Antes a receita era calculada solta no meio da tela; dois números diferentes pra
// mesma coisa na mesma página é o tipo de coisa que destrói a confiança no relatório.

// Só voo que de fato aplicou área entra na conta. O mesmo recorte do consolidado:
// 'pausado_dia' é parcial, mas o que foi voado nele foi voado de verdade.
const STATUS_FATURAVEL = ['finalizado', 'pausado_dia']

// Área que se cobra do cliente: o PERCORRIDO, não o escopo do voo.
//
// `area_ha` é o que o voo se propôs a fazer; num Finalizado Parcial ele não chegou lá, e
// faturar por ele cobraria serviço que não aconteceu. `area_feita` é o percorrido de
// verdade — e inclui a bordadura de propósito: ela é faixa do talhão que ficou resolvida,
// só não recebeu produto (é a mesma regra que o progresso do talhão usa).
export function areaFaturavel(voo) {
  const feita = parseFloat(voo?.area_feita)
  if (Number.isFinite(feita) && feita > 0) return feita
  return parseFloat(voo?.area_ha) || 0
}

// Preço por hectare do voo, segundo o tipo de serviço contratado pelo cliente.
// Devolve null quando o cliente não tem preço cadastrado — e isso é diferente de zero:
// zero seria "trabalhou de graça", null é "ainda não sabemos quanto vale".
export function precoDoVoo(voo, clientePorNome) {
  const cli = clientePorNome?.[voo?.cliente]
  if (!cli) return null
  const p = voo?.tipo_servico === 'catacao' ? cli.preco_catacao
    : voo?.tipo_servico === 'area_total' ? cli.preco_area_total
    : null
  const n = parseFloat(p)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function receitaDoVoo(voo, clientePorNome) {
  if (!STATUS_FATURAVEL.includes(voo?.status)) return null
  const preco = precoDoVoo(voo, clientePorNome)
  if (preco == null) return null
  return preco * areaFaturavel(voo)
}

// Índice nome do cliente -> cadastro, que é como o voo guarda o cliente (texto, não id).
export function indexarClientes(clientes) {
  const m = {}
  ;(clientes || []).forEach(c => { if (c?.nome) m[c.nome] = c })
  return m
}

// Soma a receita de uma lista de voos e conta o que ficou de fora por falta de preço.
// O `semPreco` não é detalhe: sem ele o gráfico mostraria a barra verde menor que a
// realidade e pareceria que a operação está no prejuízo.
export function totalizarReceita(voos, clientePorNome) {
  let total = 0, comPreco = 0, semPreco = 0, areaSemPreco = 0
  ;(voos || []).forEach(v => {
    if (!STATUS_FATURAVEL.includes(v?.status)) return
    const r = receitaDoVoo(v, clientePorNome)
    if (r == null) { semPreco++; areaSemPreco += areaFaturavel(v) }
    else { total += r; comPreco++ }
  })
  return { total, comPreco, semPreco, areaSemPreco }
}

// Chave de mês ("2026-10") de um voo. Usa a data em que o voo aconteceu, não a de
// cadastro: lançamento feito dias depois cairia no mês errado.
export function mesDoVoo(voo) {
  const d = voo?.dt_inicio || voo?.dt_fim || voo?.created_at
  if (!d) return null
  const dt = new Date(d)
  return isNaN(dt) ? null : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

// Chave de mês de uma despesa. A data da despesa é coluna `date` pura, sem fuso — por
// isso é fatiada como texto em vez de passar por `new Date`, que jogaria o dia 1º pro
// mês anterior no horário do Brasil.
export function mesDaDespesa(despesa) {
  const d = String(despesa?.data || '')
  return /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null
}

// Rótulo curto pro eixo do gráfico: "out/26".
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
export function rotuloMes(chave) {
  const [a, m] = String(chave || '').split('-').map(Number)
  return (m >= 1 && m <= 12) ? `${MESES[m - 1]}/${String(a).slice(2)}` : String(chave || '')
}

// Lista das últimas N chaves de mês até hoje, pro gráfico ter o eixo completo mesmo nos
// meses sem nada — buraco no meio da série esconde que o mês foi vazio.
export function ultimosMeses(n = 6, hoje = new Date()) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

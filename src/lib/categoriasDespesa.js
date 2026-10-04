// Categorias de despesa. Duas listas de propósito:
//
// CATEGORIA_DESPESA_OPTS é o que aparece pra ESCOLHER num lançamento novo.
// CATEGORIA_LEGADA é o que saiu da lista mas continua gravado em nota já lançada.
//
// O Pastor pediu as categorias novas "daqui pra frente", então os lançamentos antigos
// ficam como estão — renomear no banco faria o relatório somar "Almoço" e "Alimentação"
// como se fossem coisas diferentes, ou pior, perder o histórico. A lista legada existe
// só pra essas notas continuarem aparecendo com ícone e nome certos.
export const CATEGORIA_DESPESA_OPTS = [
  ['Combustível','⛽'],
  ['Alimentação','🍽️'],
  ['Hotel','🏨'],
  ['Pedágio','🛣️'],
  ['Manutenção','🔧'],
  ['Peças','⚙️'],
  ['Ferramentas','🛠️'],
  ['Outros','🧾'],
]

// Saíram da lista de escolha, mas existem em nota já lançada.
// "Pedágio" NÃO entrou aqui: não estava no modelo que o Pastor mandou, mas é despesa
// real e recorrente da operação — tirar da lista obrigaria a lançar como "Outros" e
// perderia a conta de quanto se gasta em pedágio. Fica, e vale confirmar com ele.
export const CATEGORIA_LEGADA = [
  ['Almoço','🍽️'],
  ['Gasolina','⛽'],
]

export const CATEGORIA_ICON = Object.fromEntries(
  [...CATEGORIA_DESPESA_OPTS, ...CATEGORIA_LEGADA].map(([nome,icone])=>[nome,icone])
)

// Ícone de qualquer categoria, atual ou antiga. Usar isto pra EXIBIR, em vez de procurar
// na lista de escolha: nota de agosto tem "Almoço", que não está mais lá, e sairia com o
// ícone genérico de papel.
export const iconeCategoria = (nome) => CATEGORIA_ICON[nome] || '🧾'

// Tipo do combustível, pedido pelo Pastor: o mesmo abastecimento leva diesel pra
// camionete e gasolina pro gerador ou pro drone, e sem separar não dá pra saber quanto
// cada um consome.
export const TIPOS_COMBUSTIVEL = ['Diesel', 'Gasolina', 'Etanol', 'Arla']

// Mais de um tipo na mesma nota — pedido do Pastor (04/10/2026): no mesmo cupom o piloto põe
// diesel na picape e gasolina no gerador. Fica tudo no mesmo campo, "Diesel + Gasolina",
// sempre na ordem da lista acima (assim "Gasolina + Diesel" não vira um tipo à parte).
export const tiposDoCombustivel = texto => String(texto || '').split('+').map(t => t.trim()).filter(Boolean)
export const juntarCombustiveis = tipos => TIPOS_COMBUSTIVEL.filter(t => tipos.includes(t)).join(' + ')

// ── Divisão entre combustíveis ─────────────────────────────────────────────────────
// Também pedido do Pastor (04/10/2026): com diesel e gasolina no mesmo cupom, ele precisa
// saber quanto foi de cada. O `valor` da nota continua sendo o total do cupom — é ele que
// bate com a fatura do cartão — e a divisão vai à parte, em `combustivel_valores`
// ({ "Diesel": 250, "Gasolina": 62.4 }), só quando a nota tem mais de um tipo.

const lerValor = v => parseFloat(String(v ?? '').replace(',', '.'))
const reais = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Confere a divisão digitada no formulário: todo tipo marcado com valor, e a soma igual ao
// valor da nota (sem valor da nota, a soma vira o valor). Devolve { valores, total } ou
// { erro } com a frase pro piloto.
export function conferirDivisao(tipos, digitados, valorNota) {
  const valores = {}
  for (const t of tipos) {
    const v = lerValor(digitados?.[t])
    if (!(v > 0)) return { erro: `Informe quanto foi de ${t}` }
    valores[t] = Math.round(v * 100) / 100
  }
  const soma = Math.round(Object.values(valores).reduce((a, v) => a + v, 0) * 100) / 100
  const total = lerValor(valorNota)
  if (!(total > 0)) return { valores, total: soma }
  if (Math.abs(soma - total) > 0.009) {
    return { erro: `A soma dos combustíveis (R$ ${reais(soma)}) não bate com o valor da nota (R$ ${reais(total)})` }
  }
  return { valores, total: Math.round(total * 100) / 100 }
}

// Quanto da nota foi de cada combustível, pra somar por tipo. Um tipo só: a nota inteira é
// dele. Mais de um: a divisão informada; o que ficar sem divisão (nota lançada antes de ela
// existir) aparece como "Diesel + Gasolina", sem inventar proporção. "Gasolina" também foi
// categoria antes de o tipo existir — conta como gasolina.
export function valoresPorCombustivel(d) {
  const valor = lerValor(d?.valor) || 0
  if (d?.categoria === 'Gasolina') return { Gasolina: valor }
  if (d?.categoria !== 'Combustível') return {}
  const tipos = tiposDoCombustivel(d.tipo_combustivel)
  if (tipos.length === 0) return { 'Não informado': valor }
  if (tipos.length === 1) return { [tipos[0]]: valor }
  const out = {}
  let soma = 0
  for (const t of tipos) {
    const v = lerValor(d.combustivel_valores?.[t])
    if (v > 0) { out[t] = v; soma += v }
  }
  const resto = Math.round((valor - soma) * 100) / 100
  if (resto > 0.009) out[juntarCombustiveis(tipos)] = resto
  return out
}

// Texto do combustível pra mostrar: "Diesel R$ 250,00 · Gasolina R$ 62,40" quando há
// divisão; senão o tipo como foi gravado ("Diesel", "Diesel + Gasolina").
export function descreverCombustivel(d) {
  const tipos = tiposDoCombustivel(d?.tipo_combustivel)
  const v = d?.combustivel_valores
  if (tipos.length > 1 && v && tipos.every(t => lerValor(v[t]) > 0)) {
    return tipos.map(t => `${t} R$ ${reais(lerValor(v[t]))}`).join(' · ')
  }
  return d?.tipo_combustivel || ''
}

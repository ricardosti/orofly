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

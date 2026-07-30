export const CATEGORIA_DESPESA_OPTS = [
  ['Almoço','🍽️'],
  ['Gasolina','⛽'],
  ['Pedágio','🛣️'],
  ['Hotel','🏨'],
  ['Outros','🧾'],
]

export const CATEGORIA_ICON = Object.fromEntries(CATEGORIA_DESPESA_OPTS.map(([nome,icone])=>[nome,icone]))

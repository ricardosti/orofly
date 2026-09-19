// Ordenação de nomes para as listas da tela.
//
// Texto puro não serve aqui. Os talhões são um mistura: a maioria vem zerada à
// esquerda ("001-01", "037-01"), mas tem "TALHAO 01".."TALHAO 06" e alguns
// livres ("talhao do gerson"). Ordenando como string, TALHAO 10 vem antes de
// TALHAO 2 — e um nome cadastrado com espaço na frente (" 017-01", que existe
// no banco) pula pro topo da lista.
//
// localeCompare com numeric resolve os três casos de uma vez:
//   numeric      -> compara 2 e 10 como número, não como texto
//   sensitivity  -> maiúscula/minúscula e acento não mudam a ordem
//   trim         -> espaço sobrando não muda o lugar do item

export function compararNomes(a, b) {
  return String(a ?? '').trim()
    .localeCompare(String(b ?? '').trim(), 'pt-BR', { numeric: true, sensitivity: 'base' })
}

// Ordena uma lista de objetos por um campo de texto (por padrão `nome`).
// Devolve array novo — não mexe no original.
export function ordenarPorNome(lista, campo = 'nome') {
  return [...(lista || [])].sort((a, b) => compararNomes(a?.[campo], b?.[campo]))
}

// Ordena uma lista de strings soltas (os nomes de talhão de um voo, por exemplo).
export function ordenarNomes(nomes) {
  return [...(nomes || [])].sort(compararNomes)
}

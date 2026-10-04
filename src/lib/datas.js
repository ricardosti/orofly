// Leitura de data PURA do banco — coluna `date` do Postgres, que chega como "2026-10-12",
// sem hora e sem fuso. É o caso de `despesas.data`, `viagens.data`, `manutencoes.data`.
//
// Por que não dá pra usar `new Date(s)` direto: a especificação manda tratar "2026-10-12"
// como meia-noite UTC. No Brasil (UTC-3) isso vira 21h do dia 11 — e a tela mostrava
// SEMPRE um dia a menos. Pior que o texto errado: o filtro "este mês" jogava a despesa do
// dia 1º para o mês anterior, e ela sumia da conta sem ninguém perceber.
//
// `new Date(ano, mes, dia)` monta a data no fuso local, que é onde a despesa aconteceu.
//
// Isto NÃO vale pra `created_at` e `dt_inicio`/`dt_fim`: aqueles são timestamp com hora e
// fuso, e `new Date()` já os lê certo.

export function dataLocal(valor) {
  if (!valor) return null
  if (valor instanceof Date) return valor
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor))
  if (!m) return new Date(valor)          // já veio com hora/fuso: deixa o parse normal
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// Formata pra dd/mm/aaaa sem o deslocamento de fuso.
export function fmtData(valor, opcoes) {
  const d = dataLocal(valor)
  return d && !isNaN(d) ? d.toLocaleDateString('pt-BR', opcoes) : '—'
}

// Data aaaa-mm-dd no fuso LOCAL — o inverso do dataLocal. `toISOString()` é UTC: das 21h
// à meia-noite (Brasília) ele já devolve o dia seguinte. Era assim que a despesa lançada à
// noite nascia com a data de amanhã, e o voo retomado depois das 21h aparecia no formulário
// com o dia errado e a hora certa.
export function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const hojeISO = () => isoLocal(new Date())

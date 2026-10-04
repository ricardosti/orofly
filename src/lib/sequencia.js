// Cálculo do relatório de Sequência (painel admin): quanto de cada fazenda já foi feito no
// período, quanto falta, quantos drones trabalharam e em que pé está a rodada.
//
// Fica fora da tela por dois motivos: dá pra testar sem navegador, e o PDF e o WhatsApp
// usam exatamente os números que a tela mostra — relatório que diverge do que o gestor
// está vendo destrói a confiança nele.

// Status de cada fazenda no relatório, na ordem em que aparecem na tabela.
export const ORDEM_STATUS = { concluida: 0, executando: 1, sequencia: 2, parada: 3 }
export const ROTULO_STATUS = {
  concluida: 'Finalizado', executando: 'Em execução', sequencia: 'Na sequência', parada: '—',
}

// Data no fuso LOCAL. `toISOString()` é UTC: depois das 21h (Brasília) o "hoje" virava
// amanhã, e o filtro "último dia" mostrava um dia sem voo nenhum.
export function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function periodoUltimosDias(n, hoje = new Date()) {
  const ate = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const de = new Date(ate)
  de.setDate(de.getDate() - (Math.max(1, n) - 1))
  return { de: isoLocal(de), ate: isoLocal(ate) }
}

// Dia do voo no fuso local. `dt_inicio` é timestamp com fuso: cortar o texto pegava o dia
// em UTC, e o voo das 21h30 caía no dia seguinte.
export function diaDoVoo(r) {
  const v = r?.dt_inicio || r?.created_at
  if (!v) return null
  const d = new Date(v)
  return isNaN(d) ? null : isoLocal(d)
}

// Drones que trabalharam: um por piloto. O cadastro de drones guarda MODELOS ("T25P",
// "DJI T70"), não cada aparelho — seis pilotos registram "T25P" com seis drones diferentes,
// e contar pelo nome daria 1. No campo cada piloto opera o próprio drone.
const quemVoou = r => r?.piloto_id || r?.piloto_nome || null

// Uma linha por fazenda.
//   fazendas, talhoes, relatorios: o que o painel já carrega
//   periodo: { de, ate } em 'aaaa-mm-dd'
//   selecionadas: ids das fazendas colocadas na sequência
//   areaLiquida(voo): área aplicada sem a bordadura (vem do pdf.js)
//   statusComArea: status de voo que contam área (finalizado, pausado_dia)
export function linhasDaSequencia({ fazendas = [], talhoes = [], relatorios = [], periodo = {},
                                     selecionadas = [], areaLiquida, statusComArea = [] }) {
  const voosPeriodo = relatorios.filter(r => {
    if (!statusComArea.includes(r.status) || r.teste) return false
    const d = diaDoVoo(r)
    if (!d) return false
    if (periodo.de && d < periodo.de) return false
    if (periodo.ate && d > periodo.ate) return false
    return true
  })

  return fazendas.map(fz => {
    const talhoesFz = talhoes.filter(t => t.fazenda_id === fz.id)
    const area = talhoesFz.reduce((a, t) => a + (parseFloat(t.area_ha) || 0), 0)
    const voosFz = voosPeriodo.filter(r => r.fazenda === fz.nome && r.cliente === fz.cliente)
    const realizado = voosFz.reduce((a, r) => a + areaLiquida(r), 0)
    const bordadura = voosFz.reduce((a, r) => a + (parseFloat(r.bordadura) || 0), 0)
    const coberto = realizado + bordadura
    // Talhões efetivamente tocados no período (um voo pode cobrir vários).
    const talhoesTocados = new Set()
    voosFz.forEach(r => (r.localizacao || '').split(',').map(x => x.trim()).filter(Boolean).forEach(n => talhoesTocados.add(n)))
    const emAberto = Math.max(0, +(area - coberto).toFixed(2))
    // Mesma tolerância de 0,05 ha da lista de fazendas: sobra de arredondamento não é
    // pendência de campo.
    const pct = area > 0 ? ((area - coberto) <= 0.05 ? 100 : Math.min(100, (coberto / area) * 100)) : null
    const selecionada = selecionadas.includes(fz.id)
    const status = pct === 100 ? 'concluida' : voosFz.length > 0 ? 'executando' : selecionada ? 'sequencia' : 'parada'
    const pilotos = [...new Set(voosFz.map(quemVoou).filter(Boolean))]
    return {
      fz, modalidade: fz.produto || 'Sem modalidade', area, realizado, bordadura, coberto, emAberto, pct,
      talhoes: talhoesFz.length, talhoesTocados: talhoesTocados.size, voos: voosFz.length,
      pilotos, drones: pilotos.length, selecionada, status,
    }
  })
}

// Ordem da tabela: finalizadas, em execução, na sequência e, por último, as paradas;
// dentro de cada grupo, pelo nome (a comparação vem de fora pra usar a mesma da tela).
export function ordenarLinhas(linhas, compararNomes) {
  return [...linhas].sort((a, b) =>
    (ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status]) || compararNomes(a.fz.nome, b.fz.nome))
}

// Totais do relatório. Recebe as linhas que ENTRAM no relatório (o painel tira as paradas).
export function totaisDaSequencia(linhas) {
  const t = { fazendas: linhas.length, area: 0, realizado: 0, coberto: 0, emAberto: 0, talhoes: 0,
              talhoesTocados: 0, voos: 0, areaExecucao: 0, areaFinalizada: 0, areaSequencia: 0 }
  const pilotos = new Set()
  for (const l of linhas) {
    t.area += l.area; t.realizado += l.realizado; t.coberto += l.coberto; t.emAberto += l.emAberto
    t.talhoes += l.talhoes; t.talhoesTocados += l.talhoesTocados; t.voos += l.voos
    if (l.status === 'executando') t.areaExecucao += l.area
    if (l.status === 'concluida') t.areaFinalizada += l.area
    if (l.status === 'sequencia') t.areaSequencia += l.area
    ;(l.pilotos || []).forEach(p => pilotos.add(p))
  }
  // Um piloto que passou por três fazendas é UM drone no total, não três.
  t.drones = pilotos.size
  t.pct = t.area > 0 ? Math.min(100, (t.coberto / t.area) * 100) : 0
  return t
}

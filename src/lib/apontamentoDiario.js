// Apontamento diário — o fechamento do dia pra mandar à usina (pedido de 20/10/2026, modelo
// da Nardini): por fazenda, o código, os talhões, a área total, a aplicada e a diferença, e no
// fim o rendimento total do dia.
//
// A ÁREA APLICADA de cada talhão é a do Formulário Nardini (dadosFormularioNardini: já desconta
// bordadura e os outros motivos). A ÁREA TOTAL é a da OS: o que a frente percorreu, sem o que
// foi marcado "Outro" (a parte fora da OS) — ou seja, aplicada + bordadura + vento, obstáculo
// etc. A DIFERENÇA é só essa bordadura e esses motivos. Conferido com o modelo da usina de
// 18/10/2026: Santo André II (27,98 ha cadastrados, 26,07 de Outro) sai "Área Total 1,91 /
// Aplicada 1,91"; talhão em que o piloto lançou só o aplicado (0,16 de 6,51) sai 0,16 / 0,16.
import { dadosFormularioNardini } from './formularioNardini'
import { naoAplicadaDoRel } from './reportTemplates'
import { compararNomes } from './ordenar'

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const num = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Dia do voo (AAAA-MM-DD) no horário de Brasília, pela data do VOO (dt_inicio), não a do lançamento.
export function diaDoVoo(r) {
  const d = new Date(r.dt_inicio || r.created_at)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

export function apontamentoDiario({ relatorios = [], fazendas = [], talhoes = [], data, cliente = '' }) {
  const voos = relatorios.filter(r => ['finalizado', 'pausado_dia'].includes(r.status) && !r.teste
    && diaDoVoo(r) === data && (!cliente || norm(r.cliente) === norm(cliente)))
  const grupos = {}
  for (const rel of voos) {
    const fz = fazendas.find(f => norm(f.cliente) === norm(rel.cliente) && norm(f.nome) === norm(rel.fazenda))
    const catalogo = fz ? talhoes.filter(t => t.fazenda_id === fz.id).map(t => ({ nome: t.nome, area_ha: t.area_ha })) : []
    const d = dadosFormularioNardini(rel, { talhoesCatalogo: catalogo, idFazenda: fz?.id_fazenda || '' })
    // Bordadura e motivos (menos o "Outro") de cada talhão: é a diferença.
    const unico = d.talhoes.length === 1
    const bordDet = Array.isArray(rel.bordadura_detalhe) && rel.bordadura_detalhe.length ? rel.bordadura_detalhe : null
    const bordDoTalhao = nome => bordDet
      ? bordDet.filter(b => b.talhao === nome).reduce((a, b) => a + (parseFloat(b.bordadura) || 0), 0)
      : (unico ? parseFloat(rel.bordadura) || 0 : 0)
    const motivos = naoAplicadaDoRel(rel).filter(m => m.motivo && m.motivo !== 'Outro')
    const motivosDoTalhao = nome => motivos.filter(m => m.talhao === nome || (!m.talhao && unico))
    const chave = `${norm(rel.cliente)}|${norm(rel.fazenda)}`
    const g = grupos[chave] || (grupos[chave] = { cliente: rel.cliente, fazenda: rel.fazenda,
      codigo: fz?.id_fazenda ? String(fz.id_fazenda) : '', talhoes: {}, motivos: [], voos: 0 })
    g.voos++
    for (const t of d.talhoes) {
      // O mesmo talhão em dois voos do dia (retomado, ou dois pilotos): cada voo soma o que ele
      // mesmo fez.
      const x = g.talhoes[t.nome] || (g.talhoes[t.nome] = { nome: t.nome, total: 0, aplicada: 0 })
      const bord = bordDoTalhao(t.nome)
      const ms = motivosDoTalhao(t.nome)
      const explicado = bord + ms.reduce((a, m) => a + m.qtd, 0)
      x.aplicada = +(x.aplicada + (t.aplicada || 0)).toFixed(2)
      x.total = +(x.total + (t.aplicada || 0) + explicado).toFixed(2)
      if (bord > 0.005 && !g.motivos.includes('Bordadura')) g.motivos.push('Bordadura')
      for (const m of ms) if (!g.motivos.includes(m.motivo)) g.motivos.push(m.motivo)
    }
  }
  const linhas = Object.values(grupos).map(g => {
    const ts = Object.values(g.talhoes).sort((a, b) => compararNomes(a.nome, b.nome))
    const areaTotal = +ts.reduce((a, t) => a + t.total, 0).toFixed(2)
    const areaAplicada = +ts.reduce((a, t) => a + t.aplicada, 0).toFixed(2)
    return { cliente: g.cliente, fazenda: g.fazenda, codigo: g.codigo, voos: g.voos, talhoes: ts.map(t => t.nome),
      areaTotal, areaAplicada, diferenca: Math.max(0, +(areaTotal - areaAplicada).toFixed(2)), motivos: g.motivos }
  }).sort((a, b) => (parseInt(a.codigo, 10) || Infinity) - (parseInt(b.codigo, 10) || Infinity) || compararNomes(a.fazenda, b.fazenda))
  const total = +linhas.reduce((a, l) => a + l.areaAplicada, 0).toFixed(2)
  return { linhas, total, voos: voos.length }
}

// O texto no formato do modelo da usina, pronto pra copiar ou mandar no WhatsApp. O "O.S." vai
// em branco: é a usina que preenche (como no Formulário Nardini).
export function textoApontamento({ linhas, total, data, operacao = '', empresa = 'OROFLY', cliente = '' }) {
  const [a, m, d] = String(data || '').split('-')
  const out = [`APONTAMENTO DIÁRIO – ${cliente || ''}`.trim(), '', `Empresa: ${empresa}`, `Operação: ${operacao}`, `Data de aplicação: ${d}/${m}/${a}`, '']
  for (const l of linhas) {
    out.push('O.S.:')
    out.push(`Código da Fazenda: ${l.codigo || l.fazenda}`)
    out.push(`Talhões: ${l.talhoes.join(' - ')}`)
    out.push(`Área Total: ${num(l.areaTotal)} ha`)
    out.push(`Área Aplicada: ${num(l.areaAplicada)} ha`)
    out.push(`Diferença: ${l.diferenca > 0 ? `${num(l.diferenca)} ha` : '0'}${l.motivos.length ? ` (${l.motivos.join(', ')})` : ''}`)
    out.push('')
  }
  out.push(`Rendimento total do dia: ${num(total)} ha`)
  return out.join('\n')
}

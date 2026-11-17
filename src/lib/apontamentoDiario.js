// Apontamento diário — o fechamento do dia pra mandar à usina (pedido de 20/10/2026, modelo
// da Nardini): por fazenda, o código, os talhões, a área total, a aplicada e a diferença, e no
// fim o rendimento total do dia.
//
// Também soma mais de um dia (pedido do Rodolfo, 15/11/2026): a frente começa num dia e parte
// dos relatórios sai com a data do seguinte — ele juntava os dois apontamentos e somava à mão.
// Cada relatório entra uma vez só, no dia do voo (dt_inicio), então não há soma em dobro.
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

// O voo entra no período [data, ate] (AAAA-MM-DD, os dois inclusive). Sem `ate`, ou com `ate`
// antes de `data`, é só o dia `data`. Data ISO compara certo como texto.
export function noPeriodo(r, data, ate = '') {
  const dia = diaDoVoo(r)
  return !!dia && dia >= data && dia <= (ate && ate > data ? ate : data)
}

export function apontamentoDiario({ relatorios = [], fazendas = [], talhoes = [], data, ate = '', cliente = '' }) {
  const voos = relatorios.filter(r => ['finalizado', 'pausado_dia'].includes(r.status) && !r.teste
    && noPeriodo(r, data, ate) && (!cliente || norm(r.cliente) === norm(cliente)))
  const grupos = {}
  const porDia = {} // dia → { dia, total, voos }: o rendimento de cada dia do período
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
      codigo: fz?.id_fazenda ? String(fz.id_fazenda) : '', talhoes: {}, motivos: [], voos: 0, dias: [], os: [] })
    g.voos++
    // OS da usina: a que o voo guardou da fazenda; em voo antigo, a que a fazenda tem hoje.
    const os = String(rel.os_cliente || fz?.os_cliente || '').trim()
    if (os && !g.os.includes(os)) g.os.push(os)
    const dia = diaDoVoo(rel)
    if (!g.dias.includes(dia)) g.dias.push(dia)
    const pd = porDia[dia] || (porDia[dia] = { dia, total: 0, voos: 0 })
    pd.voos++
    for (const t of d.talhoes) {
      // O mesmo talhão em dois voos do dia (retomado, ou dois pilotos): cada voo soma o que ele
      // mesmo fez.
      const x = g.talhoes[t.nome] || (g.talhoes[t.nome] = { nome: t.nome, total: 0, aplicada: 0 })
      const bord = bordDoTalhao(t.nome)
      const ms = motivosDoTalhao(t.nome)
      const explicado = bord + ms.reduce((a, m) => a + m.qtd, 0)
      x.aplicada = +(x.aplicada + (t.aplicada || 0)).toFixed(2)
      pd.total = +(pd.total + (t.aplicada || 0)).toFixed(2)
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
      areaTotal, areaAplicada, diferenca: Math.max(0, +(areaTotal - areaAplicada).toFixed(2)), motivos: g.motivos,
      dias: g.dias.sort(), os: g.os.join(' / ') }
  }).sort((a, b) => (parseInt(a.codigo, 10) || Infinity) - (parseInt(b.codigo, 10) || Infinity) || compararNomes(a.fazenda, b.fazenda))
  const total = +linhas.reduce((a, l) => a + l.areaAplicada, 0).toFixed(2)
  const dias = Object.values(porDia).sort((a, b) => a.dia.localeCompare(b.dia))
  return { linhas, total, voos: voos.length, dias }
}

// "2026-11-14" → "14/11/2026"
export const dataBR = iso => { const [a, m, d] = String(iso || '').split('-'); return d ? `${d}/${m}/${a}` : '' }

// O texto no formato do modelo da usina, pronto pra copiar ou mandar no WhatsApp. O "O.S." vai
// em branco: é a usina que preenche (como no Formulário Nardini).
// Com mais de um dia, a data vira "14/11/2026 a 15/11/2026" e o fim traz o rendimento de cada
// dia antes do total do período — pra bater com o apontamento que cada dia teria.
export function textoApontamento({ linhas, total, dias = [], data, ate = '', operacao = '', empresa = 'OROFLY', cliente = '' }) {
  const varios = !!ate && ate > data
  const out = [`APONTAMENTO DIÁRIO – ${cliente || ''}`.trim(), '', `Empresa: ${empresa}`, `Operação: ${operacao}`,
    `Data de aplicação: ${dataBR(data)}${varios ? ` a ${dataBR(ate)}` : ''}`, '']
  for (const l of linhas) {
    // Com a OS da fazenda cadastrada ela já sai preenchida; sem, fica em branco pra usina.
    out.push(`O.S.:${l.os ? ` ${l.os}` : ''}`)
    out.push(`Código da Fazenda: ${l.codigo || l.fazenda}`)
    out.push(`Talhões: ${l.talhoes.join(' - ')}`)
    out.push(`Área Total: ${num(l.areaTotal)} ha`)
    out.push(`Área Aplicada: ${num(l.areaAplicada)} ha`)
    out.push(`Diferença: ${l.diferenca > 0 ? `${num(l.diferenca)} ha` : '0'}${l.motivos.length ? ` (${l.motivos.join(', ')})` : ''}`)
    out.push('')
  }
  if (varios) {
    for (const x of dias) out.push(`Rendimento ${dataBR(x.dia)}: ${num(x.total)} ha`)
    out.push(`Rendimento total do período: ${num(total)} ha`)
  } else {
    out.push(`Rendimento total do dia: ${num(total)} ha`)
  }
  return out.join('\n')
}

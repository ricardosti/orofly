// Agregação do Relatório Consolidado de Fazenda por período.
//
// Função PURA de propósito: recebe os dados já carregados e devolve tudo que a página 1 do
// PDF precisa, sem tocar em jsPDF nem no Supabase. Isso é o que permite conferir os números
// no Node com dados reais antes de gerar documento — foi assim que a inflação de área do
// item 2 foi validada, e é o único jeito de auditar conta de hectare sem abrir PDF.
//
// A dependência aponta só numa direção: consolidado.js -> pdf.js (usa areaLiquida e
// parseDoseProduto). O pdf.js NÃO importa este arquivo; quem chama é o AdminPanel, que passa
// o resultado pronto pro gerador. Se as duas pontas se importassem, viraria ciclo.

import { areaLiquida, parseDoseProduto } from './pdf'

function minutosEntre(ini, fim) {
  if (!ini || !fim) return 0
  const t = Math.round((new Date(fim) - new Date(ini)) / 60000)
  return t > 0 ? t : 0
}

export function fmtMinutos(m) {
  const h = Math.floor(m / 60), mm = m % 60
  return h > 0 ? `${h}h ${String(mm).padStart(2, '0')}min` : `${mm}min`
}

export function agregarConsolidado({
  voos = [],
  talhoesCatalogo = [],
  talhoesSelecionados = null,
  areaTotalCadastrada = 0,
  produtosCatalogo = [],
}) {
  const voosOrd = [...voos].sort(
    (a, b) => new Date(a.dt_inicio || a.created_at) - new Date(b.dt_inicio || b.created_at)
  )

  // ── Período REAL: primeira e última operação, não o intervalo digitado no filtro ──
  const dias = voosOrd.map(r => (r.dt_inicio || r.created_at || '').slice(0, 10)).filter(Boolean).sort()
  const periodo = { ini: dias[0] || null, fim: dias[dias.length - 1] || null }

  // ── Rateio por talhão, com normalização ──
  //
  // Um voo com vários talhões divide sua área proporcional ao tamanho cadastrado de cada um.
  // Depois vem a normalização: registros salvos antes de `area_feita` existir fazem o
  // areaLiquida() cair pro talhão INTEIRO, então dois pilotos no mesmo talhão de 15,26 ha
  // somavam 30,52. Quando a soma passa do cadastrado, as parcelas caem proporcionalmente até
  // fechar. Nunca infla um talhão que ficou pela metade.
  //
  // O que isso NÃO faz: recuperar quem fez quanto. Sem area_feita, 15,26 entre dois pilotos
  // sai 7,63/7,63. Só preencher a área feita de cada voo resolve isso.
  const areaCadastral = {}
  talhoesCatalogo.forEach(t => { areaCadastral[t.nome] = parseFloat(t.area_ha) || 0 })
  const nomesListar = talhoesSelecionados || talhoesCatalogo.map(t => t.nome)

  const parcelas = {}
  nomesListar.forEach(n => { parcelas[n] = [] })

  voosOrd.forEach(r => {
    const nomesVoo = (r.localizacao || '').split(',').map(s => s.trim()).filter(Boolean)
    const somaCad = nomesVoo.reduce((a, n) => a + (areaCadastral[n] || 0), 0)
    const areaVoo = areaLiquida(r)
    nomesVoo.forEach(n => {
      if (!(n in parcelas)) return
      const fracao = somaCad > 0 ? (areaCadastral[n] || 0) / somaCad : 1 / nomesVoo.length
      parcelas[n].push({ rel: r, area: areaVoo * fracao, bordadura: (parseFloat(r.bordadura) || 0) * fracao })
    })
  })

  const aplicadaPorTalhao = {}
  const bordaduraPorTalhao = {}
  const porPiloto = {}
  let areaAplicada = 0
  let volumeTotal = 0

  nomesListar.forEach(nome => {
    const lista = parcelas[nome]
    const soma = lista.reduce((a, p) => a + p.area, 0)
    const cad = areaCadastral[nome] || 0
    const ajuste = (cad > 0 && soma > cad) ? cad / soma : 1
    aplicadaPorTalhao[nome] = soma * ajuste
    // A bordadura acompanha o mesmo ajuste da área: se a parcela foi reduzida, a bordadura
    // dela também foi, senão a soma das duas passa a não fechar com o talhão.
    bordaduraPorTalhao[nome] = lista.reduce((a, p) => a + p.bordadura, 0) * ajuste
    areaAplicada += soma * ajuste
    lista.forEach(p => {
      const areaAj = p.area * ajuste
      const nome_ = p.rel.piloto_nome || '—'
      const alvo = porPiloto[nome_] || (porPiloto[nome_] = { piloto: nome_, area: 0, minutos: 0, drones: new Set(), voos: new Set() })
      alvo.area += areaAj
      if (p.rel.drone) alvo.drones.add(p.rel.drone)
      alvo.voos.add(p.rel.id)
      volumeTotal += (parseFloat(p.rel.vazao_i || p.rel.vazao_f) || 0) * areaAj
    })
  })

  // Voos cujos talhões ficaram fora da seleção continuam contando no resumo — senão o total
  // do período muda só por causa do filtro de talhões.
  const listados = new Set(nomesListar)
  voosOrd.forEach(r => {
    const nomesVoo = (r.localizacao || '').split(',').map(s => s.trim()).filter(Boolean)
    if (nomesVoo.length > 0 && nomesVoo.some(n => listados.has(n))) return
    const a = areaLiquida(r)
    areaAplicada += a
    volumeTotal += (parseFloat(r.vazao_i || r.vazao_f) || 0) * a
    const nome_ = r.piloto_nome || '—'
    const alvo = porPiloto[nome_] || (porPiloto[nome_] = { piloto: nome_, area: 0, minutos: 0, drones: new Set(), voos: new Set() })
    alvo.area += a
    if (r.drone) alvo.drones.add(r.drone)
    alvo.voos.add(r.id)
  })

  // Tempo é por VOO, não por parcela — um voo de 2 talhões não gastou o dobro do tempo.
  voosOrd.forEach(r => {
    const nome_ = r.piloto_nome || '—'
    if (porPiloto[nome_]) porPiloto[nome_].minutos += minutosEntre(r.dt_inicio, r.dt_fim)
  })

  const tempoTotalMin = voosOrd.reduce((a, r) => a + minutosEntre(r.dt_inicio, r.dt_fim), 0)

  // ── Talhões: aplicados e pendentes ──
  // Status por COBERTURA, não pelo status do voo: um talhão pode ter sido fechado por dois
  // voos parciais (aí está FINALIZADO) ou ter um voo "finalizado" que cobriu só um pedaço
  // (aí está PARCIAL). É a área no chão que decide, não o rótulo do registro.
  const talhoes = nomesListar
    .map(nome => {
      const area = +(aplicadaPorTalhao[nome] || 0).toFixed(2)
      const cad = +(areaCadastral[nome] || 0).toFixed(2)
      let status = 'PENDENTE'
      if (area > 0.005) status = (cad > 0 && area < cad - 0.05) ? 'PARCIAL' : 'FINALIZADO'
      // Compartilhado é DERIVADO de quem realmente voou, não só da flag que o piloto marcou —
      // dois pilotos no mesmo talhão é fato, independente de alguém ter lembrado de marcar.
      // A flag entra como reforço pro caso de um piloto só que declarou divisão adiantado.
      const frentes = [...new Set((parcelas[nome] || []).map(p => p.rel.piloto_nome || '—'))]
      return {
        nome, area, cadastrado: cad,
        bordadura: +(bordaduraPorTalhao[nome] || 0).toFixed(2),
        status,
        pilotos: frentes,
        compartilhado: frentes.length > 1 || (parcelas[nome] || []).some(p => p.rel.compartilhado),
      }
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
  const aplicados = talhoes.filter(t => t.status !== 'PENDENTE')
  const pendentes = talhoes.filter(t => t.status === 'PENDENTE')

  // ── Pilotos ──
  const pilotos = Object.values(porPiloto)
    .map(p => ({
      piloto: p.piloto,
      drones: [...p.drones],
      area: +p.area.toFixed(2),
      minutos: p.minutos,
      voos: p.voos.size,
      participacao: areaAplicada > 0 ? +((p.area / areaAplicada) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.area - a.area)

  // ── Insumos: dose vem do texto de cada voo ("NOME - 0.08 L/ha"), o volume é dose × área
  // aplicada daquele voo. A faixa min–max existe porque a mesma calda muda de dose entre
  // voos, e o modelo pede "3,0 a 4,3 L/ha" quando isso acontece. ──
  const classePorNome = {}
  produtosCatalogo.forEach(p => {
    if (p?.nome) classePorNome[String(p.nome).trim().toUpperCase()] = p.classe || ''
  })

  const insumosMap = {}
  voosOrd.forEach(r => {
    const areaVoo = areaLiquida(r)
    ;(r.produtos || []).filter(Boolean).forEach(str => {
      const { nome, dose, unidade } = parseDoseProduto(str)
      if (!nome) return
      const chave = nome.trim().toUpperCase()
      const alvo = insumosMap[chave] || (insumosMap[chave] = {
        nome: nome.trim(),
        classe: classePorNome[chave] || '',
        unidade: unidade || 'L',
        doseMin: null, doseMax: null, volume: 0,
      })
      if (dose != null && !isNaN(dose)) {
        alvo.doseMin = alvo.doseMin == null ? dose : Math.min(alvo.doseMin, dose)
        alvo.doseMax = alvo.doseMax == null ? dose : Math.max(alvo.doseMax, dose)
        alvo.volume += dose * areaVoo
      }
    })
  })
  const insumos = Object.values(insumosMap)
    .map(i => ({ ...i, volume: +i.volume.toFixed(2) }))
    .sort((a, b) => b.volume - a.volume)

  // ── Vazão: média efetiva e a faixa realmente observada nos voos do período ──
  const vazoes = voosOrd
    .map(r => parseFloat(r.vazao_i || r.vazao_f))
    .filter(v => !isNaN(v) && v > 0)
  const vazaoMedia = areaAplicada > 0 ? volumeTotal / areaAplicada : null
  const vazaoMin = vazoes.length ? Math.min(...vazoes) : null
  const vazaoMax = vazoes.length ? Math.max(...vazoes) : null

  const contratado = parseFloat(areaTotalCadastrada) || 0
  const horas = tempoTotalMin / 60

  return {
    periodo,
    modalidade: voosOrd.find(r => r.tipo_servico)?.tipo_servico === 'catacao' ? 'Catação' : 'Área Total',
    kpis: {
      areaAplicada: +areaAplicada.toFixed(2),
      talhoesTrabalhados: aplicados.length,
      volumeTotal: +volumeTotal.toFixed(2),
      voos: voosOrd.length,
      vazaoMedia: vazaoMedia != null ? +vazaoMedia.toFixed(1) : null,
      vazaoMin, vazaoMax,
      tempoTotalMin,
      rendimento: horas > 0 ? +(areaAplicada / horas).toFixed(2) : null,
    },
    avanco: {
      contratado: +contratado.toFixed(2),
      executado: +areaAplicada.toFixed(2),
      saldo: +Math.max(0, contratado - areaAplicada).toFixed(2),
      pct: contratado > 0 ? +Math.min(100, (areaAplicada / contratado) * 100).toFixed(2) : null,
    },
    talhoes, aplicados, pendentes,
    totalTalhoesCatalogo: talhoesCatalogo.length,
    pilotos,
    insumos,
    // Frases do rodapé da seção 2 — determinísticas, não texto solto.
    destaques: (() => {
      const out = []
      const top = pilotos[0]
      if (top) out.push(`Maior cobertura por frente: ${top.piloto}${top.drones.length ? ` (${top.drones[0]})` : ''} com ${top.participacao}% da área.`)
      const noturno = voosOrd.some(r => {
        const h = r.dt_inicio ? new Date(r.dt_inicio).getHours() : null
        return h != null && (h >= 19 || h < 6)
      })
      if (noturno) out.push('Houve operação noturna/madrugada no período, com monitoramento de Delta T.')
      if (pendentes.length) out.push(`${pendentes.length} talhão(ões) do lote ainda sem aplicação no período.`)
      return out
    })(),
  }
}

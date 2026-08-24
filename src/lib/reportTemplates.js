// Templates de relatório personalizados (WhatsApp + PDF) por cliente.
// Tabela `report_templates` no Supabase: cada linha é um template, com cliente_nome
// null = template global/padrão. Ver AdminPanel.jsx > Configurações > Personalização
// de Relatórios pra CRUD/editor. Este arquivo só tem: (1) o resolvedor que decide qual
// template usar na hora de gerar um relatório, e (2) o construtor de texto de WhatsApp
// config-driven usado tanto no editor (preview) quanto no envio real.

// Resolve o template a usar pra um cliente: tenta o padrão específico do cliente, senão
// qualquer template cadastrado pra esse cliente, senão o padrão global, senão null (nesse
// caso o app deve manter o comportamento padrão de sempre — sem personalização nenhuma).
export async function resolverTemplate(supabase, clienteNome) {
  if (!supabase) return null
  try {
    if (clienteNome) {
      const { data: doCliente } = await supabase.from('report_templates').select('*').eq('cliente_nome', clienteNome).eq('is_default', true).maybeSingle()
      if (doCliente) return doCliente
      const { data: doClienteQualquer } = await supabase.from('report_templates').select('*').eq('cliente_nome', clienteNome).limit(1).maybeSingle()
      if (doClienteQualquer) return doClienteQualquer
    }
    const { data: padraoGlobal } = await supabase.from('report_templates').select('*').is('cliente_nome', null).eq('is_default', true).maybeSingle()
    return padraoGlobal || null
  } catch (e) {
    console.warn('Erro ao resolver template de relatório:', e)
    return null
  }
}

// Configs padrão — usadas tanto pro template novo quanto de fallback caso o registro no
// banco esteja incompleto (upsert parcial, migração antiga, etc).
export const DEFAULT_WHATSAPP_CONFIG = {
  statusOperacao: true,
  areaFazendaTalhao: true,
  dataHorario: true,
  piloto: true,
  area: true,
  tempoVoo: true,
  alturaVelocidade: true,
  climaBasico: true,
  deltaT: true,
  produtos: true,
  volumeTotal: true,
  observacoes: true,
  linkPdf: false,
  ordemServico: true,
  tipoServico: false,
  faixaAplicacao: true,
  vazaoDetalhada: true,
  tamanhoGota: true,
  observacoes2: false,
}

export const DEFAULT_PDF_CONFIG = {
  secoes: {
    cabecalho: true,
    dadosOperacionais: true,
    condicoesClimaticas: true,
    insumos: true,
    fotos: true,
    grafico: true,
    assinatura: true,
    rodape: true,
  },
  ordem: ['dadosOperacionais', 'condicoesClimaticas', 'insumos', 'fotos', 'grafico', 'assinatura'],
  corDestaque: '#00A86B',
}

// Dado de exemplo (fixo) usado no preview ao vivo do editor — nunca é salvo nem enviado
// pra ninguém, só serve pra visualização instantânea dos toggles.
export const MOCK_RELATORIO = {
  cliente: 'Fazenda Exemplo',
  fazenda: 'Fazenda Exemplo',
  localizacao: 'Talhão 4, Talhão 7',
  bordadura_detalhe: [{ talhao: 'Talhão 4', bordadura: 0.8 }, { talhao: 'Talhão 7', bordadura: 0.7 }],
  id_fazenda: 'FE-01',
  status: 'finalizado',
  piloto_nome: 'João Silva',
  drone: 'T40',
  dt_inicio: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  dt_fim: new Date().toISOString(),
  area_ha: '45.2',
  bordadura: '1.5',
  produtos: ['Herbicida XPTO - 0.8 L/ha', 'Adjuvante ABC - 0.2 L/ha'],
  vazao_i: '8', vazao_f: '8',
  tamanho_gota: 'Média',
  velocidade_drone: '25',
  altura: '3',
  faixa_i: '5', faixa_f: '5',
  vento_i: '6', vento_f: '9',
  umidade_i: '68', umidade_f: '61',
  temperatura_i: '24', temperatura_f: '27',
  delta_t_i: '4', delta_t_f: '6',
  obs1: 'Aplicação concluída sem intercorrências.',
  obs2: 'Sem restrições pro próximo voo.',
  gps_lat: '-21.1783', gps_lng: '-47.8103',
  ordem_servico: 'OS-1024',
  tipo_servico: 'area_total',
  qtd_voos: 3,
}

const linhaDiv = '┄┄┄┄┄┄┄┄┄┄┄┄┄┄'
const linhaDiv16 = '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄'

// Área líquida REALMENTE aplicada — mesma lógica de `areaLiquida` em lib/pdf.js (duplicada
// aqui de propósito pra manter esse builder de WhatsApp leve/sem depender do módulo de PDF).
// Um voo Finalizado Parcial (status pausado_dia) grava area_ha/bordadura do talhão INTEIRO,
// não do trecho pulverizado — quem sabe quanto foi aplicado de fato é `area_feita`.
function areaLiquidaLocal(rel) {
  if (rel.status === 'pausado_dia') {
    const feita = parseFloat(rel.area_feita)
    if (!isNaN(feita) && feita > 0) {
      const bordFeita = parseFloat(rel.bordadura) || 0
      return Math.max(0, +(feita - bordFeita).toFixed(2))
    }
  }
  const bruta = parseFloat(rel.area_ha) || 0
  const bord = parseFloat(rel.bordadura) || 0
  return Math.max(0, +(bruta - bord).toFixed(2))
}

function calcTempoLocal(ini, fim) {
  if (!ini || !fim) return null
  const total = Math.round((new Date(fim) - new Date(ini)) / 60000)
  if (total <= 0) return null
  const h = Math.floor(total / 60), m = total % 60
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min`
}

// Extrai nome/dose/unidade de uma linha "Nome - 0.24 L/ha" e calcula o total (dose x área
// aplicada) pro formato limpo (sem emoji). Se não casar o padrão, devolve a linha original.
function parseProdutoDose(str, areaAplicada) {
  const m = String(str).match(/^(.*?)\s*[-–]\s*([\d.,]+)\s*(.*)$/)
  if (!m) return str
  const nome = m[1].trim()
  const dose = parseFloat(m[2].replace(',', '.'))
  const unidade = m[3].trim()
  if (!dose || !areaAplicada) return `${nome}: ${m[2]}${unidade ? ' ' + unidade : ''}`
  const total = dose * areaAplicada
  const unidadeTotal = unidade.replace(/\/\s*ha$/i, '').trim() || 'L'
  return `${nome}: ${fmtNum(dose)}${unidade ? ' ' + unidade : ''} (Total: ${fmtNum(total)} ${unidadeTotal})`
}

// Extrai nome/dose/unidade de "Nome - 0.24 kg/ha" e calcula o total (dose x área) pro
// padrão em negrito — sem dois-pontos depois do nome, é "NOME dose unidade/ha (total unidade)".
function formatarProdutoLinha(str, area) {
  const m = String(str).match(/^(.*?)\s*[-–]\s*([\d.,]+)\s*(.*)$/)
  if (!m) return str
  const nome = m[1].trim()
  const dose = parseFloat(m[2].replace(',', '.'))
  const unidade = m[3].trim()
  // Área 0 é um valor válido (talhão ainda não aplicado) — só omite o total se a dose ou a
  // área vierem indefinidas/NaN de verdade, nunca por causa de "0" ser falsy em JS (era o
  // bug: um talhão com 0,00 ha aplicada fazia a linha sair sem o "(total)" e com ponto em
  // vez de vírgula, porque caía direto no `m[2]` cru sem passar pelo formatador).
  if (isNaN(dose)) return `${nome} ${m[2]}${unidade ? ' ' + unidade : ''}`
  // O total precisa multiplicar pela dose JÁ ARREDONDADA em 2 casas (a mesma que aparece
  // na linha) — senão o total impresso não bate com "dose exibida × área" na conta manual
  // (era o bug: multiplicava pela dose crua, ex. 0.075, mas mostrava "0,08 L/ha").
  const doseArred = Math.round(dose * 100) / 100
  const areaNum = parseFloat(area)
  const unidadeTotal = unidade.replace(/\/\s*ha$/i, '').trim() || 'L'
  const totalTxt = !isNaN(areaNum) ? ` (${fmtHa(doseArred * areaNum)} ${unidadeTotal})` : ''
  return `${nome} ${fmtNum(doseArred)}${unidade ? ' ' + unidade : ''}${totalTxt}`
}

function fmtNum(v) {
  const n = parseFloat(v)
  return isNaN(n) ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// Hectares sempre com 2 casas fixas (8 -> "8,00"), diferente de fmtNum (que varia).
function fmtHa(v) {
  const n = parseFloat(v)
  return isNaN(n) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Vento/Temp/Delta T sempre com 1 casa fixa (6 -> "6,0"), diferente de fmtNum (que varia).
function fmtDec1(v) {
  const n = parseFloat(v)
  return isNaN(n) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

// Nomes dos talhões desse relatório, na ordem em que foram selecionados (rel.localizacao
// guarda os nomes separados por vírgula quando o piloto seleciona mais de um).
function talhoesDoRelatorio(rel) {
  return String(rel.localizacao || '').split(',').map(s => s.trim()).filter(Boolean)
}

// Monta o texto de WhatsApp a partir de uma linha de relatório (mesmo shape de `rel` usado
// em buildTxtAdmin/gerarPDFCliente) e um whatsapp_config (booleans por bloco). Se `config`
// vier vazio/null, usa DEFAULT_WHATSAPP_CONFIG (equivalente ao texto padrão de sempre).
// Formato ÚNICO e obrigatório pra todos os relatórios (negrito nativo do WhatsApp,
// separadores tracejados, quebra por talhão) — não existe mais formato alternativo.
export function montarTextoWhatsapp(rel, config, opts = {}) {
  const cfg = { ...DEFAULT_WHATSAPP_CONFIG, ...(config || {}) }

  const fmtDataCurta = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'
  const fmtHora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

  const talhoes = talhoesDoRelatorio(rel)
  const bordaduraPorTalhao = {}
  ;(rel.bordadura_detalhe || []).forEach(d => { if (d?.talhao) bordaduraPorTalhao[d.talhao] = parseFloat(d.bordadura) || 0 })
  const catalogo = opts.talhoesCatalogo || []

  const parcial = rel.status === 'pausado_dia'

  // Dados de área/aplicada por talhão — usados tanto na seção Áreas quanto pra calcular o
  // total de produto de cada talhão (dose x área LÍQUIDA daquele talhão, não a área bruta).
  const dadosPorTalhao = talhoes.map(nome => {
    const doCatalogo = catalogo.find(t => t.nome === nome)
    const total = doCatalogo ? parseFloat(doCatalogo.area_ha) || 0 : null
    const bord = bordaduraPorTalhao[nome] ?? 0
    const aplicada = total != null ? Math.max(0, total - bord) : null
    return { nome, total, bord, aplicada }
  })
  // Se for Finalizado Parcial com mais de um talhão selecionado, usa o breakdown REAL digitado
  // pelo piloto no modal (rel.area_feita_detalhe — um valor por talhão) quando existir. Só cai
  // pra estimativa proporcional (dividir rel.area_feita pelo tamanho de cada talhão) em
  // registros antigos, salvos antes desse breakdown existir.
  if (parcial) {
    const feitaPorTalhao = {}
    ;(rel.area_feita_detalhe || []).forEach(d => { if (d?.talhao) feitaPorTalhao[d.talhao] = parseFloat(d.area_feita) || 0 })
    const temBreakdownReal = Object.keys(feitaPorTalhao).length > 0
    if (temBreakdownReal) {
      // A bordadura (quando informada) sai DE DENTRO do que já foi feito naquele talhão, não
      // do talhão inteiro — ex: fez 50ha e 1ha foi bordadura → aplicada líquida é 49ha.
      dadosPorTalhao.forEach(d => { d.aplicada = Math.max(0, +((feitaPorTalhao[d.nome] ?? 0) - d.bord).toFixed(2)) })
    } else {
      const areaFeitaRel = parseFloat(rel.area_feita)
      const somaTotais = dadosPorTalhao.reduce((a, d) => a + (d.total || 0), 0)
      if (!isNaN(areaFeitaRel) && areaFeitaRel > 0 && somaTotais > 0) {
        dadosPorTalhao.forEach(d => { if (d.total != null) d.aplicada = Math.max(0, +(areaFeitaRel * (d.total / somaTotais) - d.bord).toFixed(2)) })
      }
    }
  }
  const areaAplicadaGeral = areaLiquidaLocal(rel)

  const blocos = []

  const dados = []
  dados.push(`*Cliente:* ${rel.cliente || '—'}`)
  dados.push(`*Local:* ${rel.id_fazenda ? `[${rel.id_fazenda}] ` : ''}${rel.fazenda || '—'}`)
  if (talhoes.length) dados.push(`*Talhões:* ${talhoes.join(' | ')}`)
  dados.push(`*Período:* ${fmtDataCurta(rel.dt_inicio)} (${fmtHora(rel.dt_inicio)} às ${fmtHora(rel.dt_fim)})`)
  dados.push(`*Piloto:* ${rel.piloto_nome || '—'}`)
  if (rel.drone) dados.push(`*Drone:* ${rel.drone}`)
  if (cfg.statusOperacao) dados.push(`*Status:* ${parcial ? 'Parcial' : 'Finalizado'}`)
  blocos.push(dados.join('\n'))

  if (cfg.area) {
    const area = []
    if (talhoes.length > 1) {
      dadosPorTalhao.forEach(({ nome, total, bord, aplicada }, i) => {
        area.push(total != null
          ? `Tal. ${nome}: Tot ${fmtHa(total)} ha | Bord ${fmtHa(bord)} | Aplic ${fmtHa(aplicada)} ha`
          : `Tal. ${nome}: Bord ${fmtHa(bord)}`)
        if (i < dadosPorTalhao.length - 1) area.push('')
      })
    } else {
      area.push(`Tot ${fmtHa(rel.area_ha)} ha | Bord ${fmtHa(rel.bordadura)} | Aplic ${fmtHa(areaAplicadaGeral)} ha`)
    }
    blocos.push(`*Áreas*\n${area.join('\n')}`)
  }

  if (cfg.produtos && (rel.produtos || []).length) {
    const produtos = []
    if (talhoes.length > 1) {
      dadosPorTalhao.forEach(({ nome, aplicada }, i) => {
        produtos.push(`Tal. ${nome}:`)
        rel.produtos.forEach(p => produtos.push(formatarProdutoLinha(p, aplicada ?? 0)))
        if (i < dadosPorTalhao.length - 1) produtos.push('')
      })
    } else {
      rel.produtos.forEach(p => produtos.push(formatarProdutoLinha(p, areaAplicadaGeral)))
    }
    blocos.push(`*Produtos*\n${produtos.join('\n')}`)
  }

  const params = []
  if (cfg.vazaoDetalhada && (rel.vazao_i || rel.vazao_f)) {
    let l = `Vazão: ${fmtNum(rel.vazao_i || rel.vazao_f)} L/ha`
    if (cfg.tamanhoGota && rel.tamanho_gota) l += ` | Gota: ${rel.tamanho_gota}${/^\d+([.,]\d+)?$/.test(String(rel.tamanho_gota).trim()) ? ' µm' : ''}`
    params.push(l)
  }
  const linha2 = []
  if (cfg.alturaVelocidade && rel.velocidade_drone) linha2.push(`Vel: ${fmtNum(rel.velocidade_drone)} km/h`)
  if (cfg.alturaVelocidade && rel.altura) linha2.push(`Alt: ${fmtNum(rel.altura)}m`)
  if (cfg.faixaAplicacao && (rel.faixa_i || rel.faixa_f)) linha2.push(`Faixa: ${fmtNum(rel.faixa_i || rel.faixa_f)}m`)
  if (linha2.length) params.push(linha2.join(' | '))
  if (params.length) blocos.push(`*Parâmetros*\n${params.join('\n')}`)

  const clima = []
  if (cfg.climaBasico) {
    clima.push(`Vento: ${fmtDec1(rel.vento_i)} - ${fmtDec1(rel.vento_f)} km/h | UR: ${fmtNum(rel.umidade_i)}% - ${fmtNum(rel.umidade_f)}%`)
    clima.push(`Temp: ${fmtDec1(rel.temperatura_i)}°C - ${fmtDec1(rel.temperatura_f)}°C${cfg.deltaT ? ` | ΔT: ${fmtDec1(rel.delta_t_i)}°C - ${fmtDec1(rel.delta_t_f)}°C` : ''}`)
  } else if (cfg.deltaT) {
    clima.push(`ΔT: ${fmtDec1(rel.delta_t_i)}°C - ${fmtDec1(rel.delta_t_f)}°C`)
  }
  if (clima.length) blocos.push(`*Clima (Início - Fim)*\n${clima.join('\n')}`)

  if (cfg.observacoes) {
    const obsTxt = [rel.obs1, cfg.observacoes2 ? rel.obs2 : null].filter(Boolean).join(' | ')
    if (obsTxt) blocos.push(`*Obs:* ${obsTxt}`)
  }

  if (cfg.linkPdf && opts.linkPdf) blocos.push(`*Relatório completo:* ${opts.linkPdf}`)

  return `🚁 *RELATÓRIO OROFLY*\n${linhaDiv16}\n` + blocos.join(`\n${linhaDiv16}\n`)
}


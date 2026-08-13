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
  semEmoji: false,
  ordemServico: true,
  tipoServico: false,
  faixaAplicacao: false,
  vazaoDetalhada: false,
  tamanhoGota: false,
  gpsLink: false,
  observacoes2: false,
  negritoTitulos: false,
  negritoCampos: false,
  juntarPilotoDrone: true,
  juntarAplicadaBorda: true,
  juntarVazaoGota: true,
  juntarVelocidadeFaixa: true,
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
  localizacao: 'Talhão 4',
  id_fazenda: 'FE-01',
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

function areaLiquidaLocal(rel) {
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

function fmtNum(v) {
  const n = parseFloat(v)
  return isNaN(n) ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// Monta o texto de WhatsApp a partir de uma linha de relatório (mesmo shape de `rel` usado
// em buildTxtAdmin/gerarPDFCliente) e um whatsapp_config (booleans por bloco). Se `config`
// vier vazio/null, usa DEFAULT_WHATSAPP_CONFIG (equivalente ao texto padrão de sempre).
// Quando cfg.semEmoji está ligado, usa um layout limpo por seções (sem ícones nem negrito).
export function montarTextoWhatsapp(rel, config, opts = {}) {
  const cfg = { ...DEFAULT_WHATSAPP_CONFIG, ...(config || {}) }
  if (cfg.semEmoji) return montarTextoLimpo(rel, cfg, opts)

  const fmtData = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
  const fmtHora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const nomeCurto = n => { if (!n) return '—'; const p = String(n).trim().split(/\s+/).filter(Boolean); return p.length <= 1 ? (p[0] || '—') : `${p[0]} ${p[p.length - 1]}` }

  const areaAplicada = areaLiquidaLocal(rel)
  const tempo = calcTempoLocal(rel.dt_inicio, rel.dt_fim)
  const vazao = parseFloat(rel.vazao_i || rel.vazao_f) || 0
  const volTotal = vazao && areaAplicada ? (vazao * areaAplicada).toFixed(0) : null

  let t = `🚁 *RELATÓRIO OROFLY*\n`
  if (cfg.areaFazendaTalhao) {
    const localTxt = `${rel.fazenda || '—'}${rel.localizacao ? ` | Talhão: ${rel.localizacao}` : ''}`
    t += `👤 *Cliente:* ${rel.cliente || '—'}\n`
    t += `📍 *Local:* ${localTxt}\n`
  }
  if (cfg.dataHorario) t += `⏰ *Período:* ${fmtData(rel.dt_inicio)} (${fmtHora(rel.dt_inicio)} ➔ ${fmtHora(rel.dt_fim)})\n`
  if (cfg.piloto) t += `👨‍✈️ *Piloto:* ${nomeCurto(rel.piloto_nome)}${rel.drone ? ` | 🛸 *Drone:* ${rel.drone}` : ''}\n`
  if (cfg.ordemServico && rel.ordem_servico) t += `🔖 *OS:* ${rel.ordem_servico}\n`
  if (cfg.tipoServico && (rel.tipo_servico || rel.qtd_voos > 1)) {
    t += `🗂️ *Tipo de Serviço:* ${rel.tipo_servico === 'catacao' ? 'Catação' : rel.tipo_servico === 'area_total' ? 'Área Total' : '—'}${rel.qtd_voos > 1 ? ` (${rel.qtd_voos} voos)` : ''}\n`
  }
  t += `${linhaDiv}\n`

  if (cfg.area) t += `📏 *Área Aplicada:* ${areaAplicada.toFixed(2)} ha\n`
  if (cfg.tempoVoo && tempo) t += `⏱️ *Tempo de Voo:* ${tempo}\n`
  if (cfg.alturaVelocidade && (rel.altura || rel.velocidade_drone)) t += `📐 *Altura:* ${rel.altura || '—'} m | *Velocidade:* ${rel.velocidade_drone || '—'} km/h\n`
  if (cfg.faixaAplicacao && (rel.faixa_i || rel.faixa_f)) t += `↔️ *Faixa de Aplicação:* ${rel.faixa_i || '—'}➔${rel.faixa_f || '—'} m\n`
  if (cfg.vazaoDetalhada && (rel.vazao_i || rel.vazao_f)) t += `🚿 *Vazão:* ${rel.vazao_i || rel.vazao_f} L/ha\n`
  if (cfg.tamanhoGota && rel.tamanho_gota) t += `💦 *Tamanho de Gota:* ${rel.tamanho_gota}\n`

  if (cfg.climaBasico) {
    t += `🌤️ *Clima:* Temp ${rel.temperatura_i || '—'}➔${rel.temperatura_f || '—'}°C · Umid ${rel.umidade_i || '—'}➔${rel.umidade_f || '—'}% · Vento ${rel.vento_i || '—'}➔${rel.vento_f || '—'} km/h\n`
  }
  if (cfg.deltaT) t += `🌡️ *Delta T:* ${rel.delta_t_i || '—'}➔${rel.delta_t_f || '—'}°C\n`

  if (cfg.produtos && (rel.produtos || []).length) {
    t += `${linhaDiv}\n🧪 *Produtos e Dosagens:*\n`
    rel.produtos.forEach(p => { t += `* ${p}\n` })
  }
  if (cfg.volumeTotal && volTotal) t += `💧 *Volume Total Aplicado:* ${volTotal} L\n`

  if (cfg.observacoes && rel.obs1) t += `${linhaDiv}\n📝 *Obs:* ${rel.obs1}\n`
  if (cfg.observacoes2 && rel.obs2) t += `${cfg.observacoes && rel.obs1 ? '' : linhaDiv + '\n'}📝 *Obs 2:* ${rel.obs2}\n`
  if (cfg.gpsLink && rel.gps_lat && rel.gps_lng) t += `${linhaDiv}\n📍 *Coordenadas:* ${rel.gps_lat}, ${rel.gps_lng}\nhttps://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}\n`
  if (cfg.linkPdf && opts.linkPdf) t += `${linhaDiv}\n📄 Relatório completo: ${opts.linkPdf}\n`

  return t
}

// Layout limpo por seções (CLIENTE / ÁREA / PRODUTOS / PARÂMETROS / CLIMA / OBSERVAÇÕES /
// LOCALIZAÇÃO), sem emoji nem negrito com asterisco — usado quando cfg.semEmoji está ligado.
function montarTextoLimpo(rel, cfg, opts) {
  const fmtDataCurta = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'
  const fmtHora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const nomeCurto = n => { if (!n) return '—'; const p = String(n).trim().split(/\s+/).filter(Boolean); return p.length <= 1 ? (p[0] || '—') : `${p[0]} ${p[p.length - 1]}` }
  // Monta "Rótulo: valor", com o rótulo em negrito se cfg.negritoCampos estiver ligado.
  const campo = (label, valor) => cfg.negritoCampos ? `*${label}:* ${valor}` : `${label}: ${valor}`

  const areaAplicada = areaLiquidaLocal(rel)
  const areaTotal = parseFloat(rel.area_ha) || 0
  const bordadura = parseFloat(rel.bordadura) || 0
  const tempo = calcTempoLocal(rel.dt_inicio, rel.dt_fim)
  const gotaTxt = rel.tamanho_gota ? (/^\d+([.,]\d+)?$/.test(String(rel.tamanho_gota).trim()) ? `${rel.tamanho_gota} µm` : rel.tamanho_gota) : null

  const secoes = []

  const cliente = []
  if (cfg.areaFazendaTalhao) {
    cliente.push(campo('Cliente', rel.cliente || '—'))
    const localTxt = `${rel.id_fazenda ? `[${rel.id_fazenda}] ` : ''}${rel.fazenda || '—'}${rel.localizacao ? ` | Talhão: ${rel.localizacao}` : ''}`
    cliente.push(campo('Local', localTxt))
  }
  if (cfg.dataHorario) cliente.push(campo('Período', `${fmtDataCurta(rel.dt_inicio)} (${fmtHora(rel.dt_inicio)} às ${fmtHora(rel.dt_fim)})`))
  if (cfg.piloto) {
    if (cfg.juntarPilotoDrone) {
      cliente.push(campo('Piloto', nomeCurto(rel.piloto_nome)) + (rel.drone ? ` | ${campo('Drone', rel.drone)}` : ''))
    } else {
      cliente.push(campo('Piloto', nomeCurto(rel.piloto_nome)))
      if (rel.drone) cliente.push(campo('Drone', rel.drone))
    }
  }
  if (cfg.ordemServico && rel.ordem_servico) cliente.push(campo('OS', rel.ordem_servico))
  if (cfg.tipoServico && (rel.tipo_servico || rel.qtd_voos > 1)) {
    cliente.push(campo('Tipo de Serviço', `${rel.tipo_servico === 'catacao' ? 'Catação' : rel.tipo_servico === 'area_total' ? 'Área Total' : '—'}${rel.qtd_voos > 1 ? ` (${rel.qtd_voos} voos)` : ''}`))
  }
  if (cliente.length) secoes.push(['CLIENTE', cliente])

  const area = []
  if (cfg.area) {
    area.push(campo('Área Total', `${fmtNum(areaTotal)} ha`))
    if (cfg.juntarAplicadaBorda) {
      area.push(campo('Aplicada', `${fmtNum(areaAplicada)} ha`) + ` | ${campo('Borda', `${fmtNum(bordadura)} ha`)}`)
    } else {
      area.push(campo('Aplicada', `${fmtNum(areaAplicada)} ha`))
      area.push(campo('Borda', `${fmtNum(bordadura)} ha`))
    }
  }
  if (cfg.tempoVoo && tempo) area.push(campo('Tempo de Voo', tempo))
  if (area.length) secoes.push(['ÁREA', area])

  if (cfg.produtos && (rel.produtos || []).length) {
    secoes.push(['PRODUTOS', rel.produtos.map(p => parseProdutoDose(p, areaAplicada))])
  }

  const params = []
  if (cfg.vazaoDetalhada && (rel.vazao_i || rel.vazao_f)) {
    if (cfg.juntarVazaoGota && cfg.tamanhoGota && gotaTxt) {
      params.push(campo('Vazão', `${fmtNum(rel.vazao_i || rel.vazao_f)} L/ha`) + ` | ${campo('Gota', gotaTxt)}`)
    } else {
      params.push(campo('Vazão', `${fmtNum(rel.vazao_i || rel.vazao_f)} L/ha`))
      if (cfg.tamanhoGota && gotaTxt) params.push(campo('Gota', gotaTxt))
    }
  } else if (cfg.tamanhoGota && gotaTxt) {
    params.push(campo('Gota', gotaTxt))
  }
  const linha2 = []
  if (cfg.alturaVelocidade && rel.altura) linha2.push(campo('Altura', `${fmtNum(rel.altura)} m`))
  if (cfg.alturaVelocidade && rel.velocidade_drone) linha2.push(campo('Velocidade', `${fmtNum(rel.velocidade_drone)} km/h`))
  if (cfg.faixaAplicacao && (rel.faixa_i || rel.faixa_f)) linha2.push(campo('Faixa', `${fmtNum(rel.faixa_i || rel.faixa_f)} m`))
  if (linha2.length) {
    if (cfg.juntarVelocidadeFaixa) params.push(linha2.join(' | '))
    else linha2.forEach(l => params.push(l))
  }
  if (params.length) secoes.push(['PARÂMETROS', params])

  const clima = []
  if (cfg.climaBasico) {
    clima.push(campo('Vento', `${fmtNum(rel.vento_i)} ➔ ${fmtNum(rel.vento_f)} km/h`))
    clima.push(campo('Umidade', `${fmtNum(rel.umidade_i)}% ➔ ${fmtNum(rel.umidade_f)}%`))
    clima.push(campo('Temperatura', `${fmtNum(rel.temperatura_i)}°C ➔ ${fmtNum(rel.temperatura_f)}°C`))
  }
  if (cfg.deltaT) clima.push(campo('Delta T', `${fmtNum(rel.delta_t_i)}°C ➔ ${fmtNum(rel.delta_t_f)}°C`))
  if (clima.length) secoes.push(['CLIMA (Início ➔ Fim)', clima])

  const obs = []
  if (cfg.observacoes && rel.obs1) obs.push(rel.obs1)
  if (cfg.observacoes2 && rel.obs2) obs.push(rel.obs2)
  if (obs.length) secoes.push(['OBSERVAÇÕES', obs])

  if (cfg.gpsLink && rel.gps_lat && rel.gps_lng) {
    secoes.push(['LOCALIZAÇÃO', [`${rel.gps_lat}, ${rel.gps_lng}`, `https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`]])
  }

  if (cfg.linkPdf && opts.linkPdf) secoes.push(['RELATÓRIO', [opts.linkPdf]])

  const tituloTxt = t => cfg.negritoTitulos ? `*${t}*` : t
  let t = `${tituloTxt('RELATÓRIO OROFLY')}\n\n`
  t += secoes.map(([titulo, linhas]) => `${tituloTxt(titulo)}\n${linhas.join('\n')}`).join('\n\n')
  return removerEmoji(t.trim())
}

// Remove emojis do texto (mantém acentos/pontuação normais). Cobre os principais blocos
// Unicode de emoji + variation selectors + ZWJ, sem mexer em texto comum em pt-BR.
function removerEmoji(txt) {
  return txt
    // (2794 = ➔, usado como separador "de ➔ pra" nos campos — não é decorativo, mantém)
    .replace(/[\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2300}-\u{23FF}\u{2600}-\u{2793}\u{2795}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, '')
}

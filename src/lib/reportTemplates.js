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
  gps_lat: '-21.1783', gps_lng: '-47.8103',
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

// Monta o texto de WhatsApp a partir de uma linha de relatório (mesmo shape de `rel` usado
// em buildTxtAdmin/gerarPDFCliente) e um whatsapp_config (booleans por bloco). Se `config`
// vier vazio/null, usa DEFAULT_WHATSAPP_CONFIG (equivalente ao texto padrão de sempre).
export function montarTextoWhatsapp(rel, config, opts = {}) {
  const cfg = { ...DEFAULT_WHATSAPP_CONFIG, ...(config || {}) }
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
  t += `${linhaDiv}\n`

  if (cfg.area) t += `📏 *Área Aplicada:* ${areaAplicada.toFixed(2)} ha\n`
  if (cfg.tempoVoo && tempo) t += `⏱️ *Tempo de Voo:* ${tempo}\n`
  if (cfg.alturaVelocidade && (rel.altura || rel.velocidade_drone)) t += `📐 *Altura:* ${rel.altura || '—'} m | *Velocidade:* ${rel.velocidade_drone || '—'} km/h\n`

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
  if (cfg.linkPdf && opts.linkPdf) t += `${linhaDiv}\n📄 Relatório completo: ${opts.linkPdf}\n`

  return t
}

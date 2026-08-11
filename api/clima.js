// Proxy de clima com alternador de provedor (Meteoblue / Open-Meteo) — a preferência é
// definida pelo Admin (tabela app_settings.weather_provider) e cada chamada é registrada
// em weather_api_log pra dar visibilidade de quanto está sendo consumido de cada API
// (a Meteoblue tem limite mensal no plano gratuito/inicial). Se o provedor preferido
// falhar, tenta o outro automaticamente antes de desistir — resiliência de verdade, não
// só uma preferência estética.
//
// Ambos os provedores são normalizados pro MESMO formato de saída (hourly/daily com os
// nomes de campo que o Open-Meteo sempre usou), então o resto do app (buscarPrevisao,
// gráficos, Delta T) funciona igual não importa qual API respondeu.
const { createClient } = require('@supabase/supabase-js')

function clienteAdmin() {
  return createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function lerProvedorPreferido(sb) {
  try {
    const { data } = await sb.from('app_settings').select('valor').eq('chave', 'weather_provider').single()
    return data?.valor === 'open_meteo' ? 'open_meteo' : 'meteoblue'
  } catch {
    return 'meteoblue' // sem tabela/linha configurada ainda -> mantém o padrão atual
  }
}

async function registrarChamada(sb, provider, sucesso) {
  try { await sb.from('weather_api_log').insert({ provider, sucesso }) } catch { /* log é best-effort, não deve derrubar a resposta */ }
}

async function buscarMeteoblue(lat, lon) {
  const apiKey = process.env.METEOBLUE_API_KEY
  if (!apiKey) throw new Error('METEOBLUE_API_KEY não configurada no servidor')
  const url = `https://my.meteoblue.com/packages/basic-1h_wind-1h?lat=${lat}&lon=${lon}&apikey=${apiKey}&format=json`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Meteoblue respondeu ${r.status}`)
  const data = await r.json()
  const h = data.data_1h
  if (!h?.time?.length) throw new Error('resposta da Meteoblue sem dados horários (data_1h)')

  // Meteoblue usa "YYYY-MM-DD HH:mm" — troca o espaço por "T" pra ficar no formato
  // ISO-ish que o resto do app já espera (ex: comparações tipo .endsWith('T13:00')).
  const timeIso = h.time.map(t => t.replace(' ', 'T'))

  // O pacote horário não vem com resumo por dia pronto — agrupa as horas por dia
  // calendário pra montar os agregados diários (máx/mín de temperatura, soma de
  // chuva etc) que os cards e o carrossel de dias da tela precisam.
  const porDia = {}
  timeIso.forEach((t, i) => {
    const dia = t.slice(0, 10)
    ;(porDia[dia] = porDia[dia] || []).push(i)
  })
  const dias = Object.keys(porDia).sort()
  const valores = (arr, d) => porDia[d].map(i => arr?.[i]).filter(v => v != null)
  const maxDe = (arr, d) => { const vs = valores(arr, d); return vs.length ? Math.max(...vs) : null }
  const minDe = (arr, d) => { const vs = valores(arr, d); return vs.length ? Math.min(...vs) : null }
  const somaDe = (arr, d) => valores(arr, d).reduce((a, v) => a + v, 0)

  const daily = {
    time: dias,
    temperature_2m_max: dias.map(d => maxDe(h.temperature, d)),
    temperature_2m_min: dias.map(d => minDe(h.temperature, d)),
    precipitation_probability_max: dias.map(d => maxDe(h.precipitation_probability, d)),
    precipitation_sum: dias.map(d => somaDe(h.precipitation, d)),
    windspeed_10m_max: dias.map(d => maxDe(h.windspeed, d)),
    windgusts_10m_max: dias.map(d => maxDe(h.gust, d)),
  }
  const hourly = {
    time: timeIso,
    temperature_2m: h.temperature,
    relativehumidity_2m: h.relativehumidity,
    windspeed_10m: h.windspeed,
    windgusts_10m: h.gust,
    precipitation_probability: h.precipitation_probability,
  }
  return { hourly, daily, fonte: 'meteoblue' }
}

async function buscarOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max,windgusts_10m_max&hourly=temperature_2m,relativehumidity_2m,windspeed_10m,windgusts_10m,precipitation_probability&timezone=auto&forecast_days=8`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Open-Meteo respondeu ${r.status}`)
  const data = await r.json()
  if (!data.hourly?.time?.length || !data.daily?.time?.length) throw new Error('resposta da Open-Meteo incompleta')
  return { hourly: data.hourly, daily: data.daily, fonte: 'open_meteo' }
}

const BUSCAR_POR_PROVEDOR = { meteoblue: buscarMeteoblue, open_meteo: buscarOpenMeteo }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { lat, lon } = req.query
  if (!lat || !lon) return res.status(400).json({ error: 'lat e lon são obrigatórios' })

  const sb = clienteAdmin()
  const preferido = await lerProvedorPreferido(sb)
  const alternativo = preferido === 'meteoblue' ? 'open_meteo' : 'meteoblue'

  try {
    const resultado = await BUSCAR_POR_PROVEDOR[preferido](lat, lon)
    await registrarChamada(sb, preferido, true)
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200')
    return res.status(200).json(resultado)
  } catch (erroPrincipal) {
    await registrarChamada(sb, preferido, false)
    // Resiliência: se o provedor preferido falhar, tenta o outro automaticamente antes de
    // devolver erro — uma instabilidade pontual numa API não derruba a previsão do piloto.
    try {
      const resultado = await BUSCAR_POR_PROVEDOR[alternativo](lat, lon)
      await registrarChamada(sb, alternativo, true)
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200')
      return res.status(200).json({ ...resultado, aviso: `Provedor preferido (${preferido}) falhou, usando ${alternativo} como backup.` })
    } catch (erroBackup) {
      await registrarChamada(sb, alternativo, false)
      return res.status(502).json({ error: `Falha nos dois provedores. ${preferido}: ${erroPrincipal.message} · ${alternativo}: ${erroBackup.message}` })
    }
  }
}

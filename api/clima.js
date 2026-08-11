// Proxy de clima com alternador de provedor (Meteoblue / Open-Meteo) — a preferência é
// definida pelo Admin (tabela app_settings.weather_provider) e cada chamada é registrada
// em weather_api_log (com o erro capturado, se der errado) pra dar visibilidade de
// consumo e falhas direto no Admin, sem precisar abrir o painel da Vercel.
//
// Se o provedor preferido falhar (chave ausente/errada, HTTP 401/403/429/500, timeout),
// cai automaticamente pro outro provedor SEM propagar erro pro app do piloto — a tela de
// clima continua funcionando normal. `provider_active` no JSON de resposta diz qual
// provedor respondeu de fato, pra debug/Admin.
//
// Ambos os provedores são normalizados pro MESMO formato de saída (hourly/daily com os
// nomes de campo que o Open-Meteo sempre usou), então o resto do app (buscarPrevisao,
// gráficos, Delta T) funciona igual não importa qual API respondeu.
const { createClient } = require('@supabase/supabase-js')

const TIMEOUT_MS = 8000

function clienteAdmin() {
  return createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function fetchComTimeout(url, ms) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { signal: controller.signal })
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timeout (${ms}ms)`)
    throw e
  } finally {
    clearTimeout(t)
  }
}

async function lerProvedorPreferido(sb) {
  try {
    const { data } = await sb.from('app_settings').select('valor').eq('chave', 'weather_provider').single()
    return data?.valor === 'open_meteo' ? 'open_meteo' : 'meteoblue'
  } catch {
    return 'meteoblue' // sem tabela/linha configurada ainda -> mantém o padrão atual
  }
}

async function registrarChamada(sb, provider, sucesso, erro) {
  try { await sb.from('weather_api_log').insert({ provider, sucesso, erro: erro ? String(erro).slice(0, 500) : null }) }
  catch (e) { console.log('[Weather API] falha ao gravar log (não crítico):', e.message) }
}

async function buscarMeteoblue(lat, lon) {
  console.log('[Weather API] Fetching from Meteoblue...')
  const apiKey = (process.env.METEOBLUE_API_KEY || '').trim()
  if (!apiKey) {
    console.log('[Weather API] Meteoblue: METEOBLUE_API_KEY ausente')
    throw new Error('API Key ausente')
  }
  // Só o pacote básico (basic-1h) — já traz temperature/windspeed/winddirection/
  // precipitation/relativehumidity, que é tudo que os gráficos precisam. wind-1h (gust)
  // e outros pacotes extras (agro-1h, trend-1h) exigem plano pago e causavam HTTP 403
  // com a conta gratuita/padrão.
  const url = `https://my.meteoblue.com/packages/basic-1h?lat=${lat}&lon=${lon}&apikey=${apiKey}&format=json`
  const r = await fetchComTimeout(url, TIMEOUT_MS)
  if (!r.ok) {
    const corpo = await r.text().catch(() => '(não consegui ler o corpo da resposta)')
    console.error('[Meteoblue Error Details]:', corpo)
    console.log(`[Weather API] Meteoblue respondeu HTTP ${r.status}`)
    throw new Error(`HTTP ${r.status}`)
  }
  const data = await r.json()
  const h = data.data_1h
  if (!h?.time?.length) {
    console.log('[Weather API] Meteoblue: resposta sem data_1h')
    throw new Error('resposta sem dados horários (data_1h)')
  }

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
  console.log('[Weather API] Meteoblue OK')
  return { hourly, daily }
}

async function buscarOpenMeteo(lat, lon) {
  console.log('[Weather API] Fetching from Open-Meteo...')
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max,windgusts_10m_max&hourly=temperature_2m,relativehumidity_2m,windspeed_10m,windgusts_10m,precipitation_probability&timezone=auto&forecast_days=8`
  const r = await fetchComTimeout(url, TIMEOUT_MS)
  if (!r.ok) {
    console.log(`[Weather API] Open-Meteo respondeu HTTP ${r.status}`)
    throw new Error(`HTTP ${r.status}`)
  }
  const data = await r.json()
  if (!data.hourly?.time?.length || !data.daily?.time?.length) {
    console.log('[Weather API] Open-Meteo: resposta incompleta')
    throw new Error('resposta incompleta')
  }
  console.log('[Weather API] Open-Meteo OK')
  return { hourly: data.hourly, daily: data.daily }
}

const BUSCAR_POR_PROVEDOR = { meteoblue: buscarMeteoblue, open_meteo: buscarOpenMeteo }
const NOME_PROVEDOR = { meteoblue: 'Meteoblue', open_meteo: 'Open-Meteo' }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { lat, lon } = req.query
  if (!lat || !lon) return res.status(400).json({ error: 'lat e lon são obrigatórios' })

  const sb = clienteAdmin()
  const preferido = await lerProvedorPreferido(sb)
  const alternativo = preferido === 'meteoblue' ? 'open_meteo' : 'meteoblue'
  console.log(`[Weather API] Provedor preferido: ${preferido} (lat=${lat}, lon=${lon})`)

  try {
    const resultado = await BUSCAR_POR_PROVEDOR[preferido](lat, lon)
    await registrarChamada(sb, preferido, true, null)
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200')
    return res.status(200).json({ ...resultado, provider_active: preferido })
  } catch (erroPrincipal) {
    console.log(`[Weather API] ${NOME_PROVEDOR[preferido]} falhou: ${erroPrincipal.message} — caindo pro backup (${alternativo})`)
    await registrarChamada(sb, preferido, false, erroPrincipal.message)
    // Fallback automático: uma instabilidade pontual no provedor preferido não derruba a
    // previsão do piloto — tenta o outro provedor antes de desistir de vez.
    try {
      const resultado = await BUSCAR_POR_PROVEDOR[alternativo](lat, lon)
      await registrarChamada(sb, alternativo, true, null)
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200')
      return res.status(200).json({
        ...resultado,
        provider_active: alternativo,
        aviso: `Provedor preferido (${NOME_PROVEDOR[preferido]}) falhou, usando ${NOME_PROVEDOR[alternativo]} como backup.`,
        erro_provedor_preferido: erroPrincipal.message,
      })
    } catch (erroBackup) {
      console.log(`[Weather API] ${NOME_PROVEDOR[alternativo]} (backup) também falhou: ${erroBackup.message}`)
      await registrarChamada(sb, alternativo, false, erroBackup.message)
      return res.status(502).json({
        error: `Falha nos dois provedores. ${NOME_PROVEDOR[preferido]}: ${erroPrincipal.message} · ${NOME_PROVEDOR[alternativo]}: ${erroBackup.message}`,
      })
    }
  }
}

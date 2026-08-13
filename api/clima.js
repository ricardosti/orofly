// Proxy de clima com fallback em cascata configurável (Meteoblue / Tomorrow.io / Open-Meteo)
// — a ORDEM de prioridade é definida pelo Admin (tabela app_settings.weather_provider, agora
// guardando um array JSON, ex: ["meteoblue","tomorrow","open_meteo"]) e cada chamada é
// registrada em weather_api_log (com o erro capturado, se der errado) pra dar visibilidade
// de consumo e falhas direto no Admin, sem precisar abrir o painel da Vercel.
//
// Tenta os provedores na ordem configurada; se um falhar (chave ausente/errada, HTTP
// 401/403/429/500, timeout), cai pro próximo automaticamente SEM propagar erro pro app do
// piloto — a tela de clima continua funcionando normal enquanto pelo menos 1 provedor
// responder. `provider_active` no JSON de resposta diz qual provedor respondeu de fato.
//
// Os 3 provedores são normalizados pro MESMO formato de saída (hourly/daily com os nomes de
// campo que o Open-Meteo sempre usou), então o resto do app (buscarPrevisao, gráficos,
// Delta T) funciona igual não importa qual API respondeu.
const { createClient } = require('@supabase/supabase-js')

const TIMEOUT_MS = 8000
const TODOS_PROVEDORES = ['meteoblue', 'tomorrow', 'open_meteo']
const NOME_PROVEDOR = { meteoblue: 'Meteoblue', tomorrow: 'Tomorrow.io', open_meteo: 'Open-Meteo' }

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

// Lê a ordem de prioridade configurada pelo Admin. Formato novo: JSON array (`["tomorrow",
// "meteoblue","open_meteo"]`). Formato antigo (de antes da 3ª API): string simples
// ("meteoblue"/"open_meteo") — convertida automaticamente pra não quebrar quem configurou
// antes dessa mudança. Provedores que faltarem na lista salva são completados no final, na
// ordem padrão, então a lista sempre tem os 3.
async function lerOrdemProvedores(sb) {
  try {
    const { data } = await sb.from('app_settings').select('valor').eq('chave', 'weather_provider').maybeSingle()
    if (!data?.valor) return TODOS_PROVEDORES
    let ordem
    try { ordem = JSON.parse(data.valor) } catch { ordem = [data.valor] }
    if (!Array.isArray(ordem)) ordem = [ordem]
    ordem = ordem.filter(p => TODOS_PROVEDORES.includes(p))
    TODOS_PROVEDORES.forEach(p => { if (!ordem.includes(p)) ordem.push(p) })
    return ordem
  } catch {
    return TODOS_PROVEDORES
  }
}

async function registrarChamada(sb, provider, sucesso, erro) {
  try { await sb.from('weather_api_log').insert({ provider, sucesso, erro: erro ? String(erro).slice(0, 500) : null }) }
  catch (e) { console.log('[Weather API] falha ao gravar log (não crítico):', e.message) }
}

// Agrupa uma série horária (já em ISO "YYYY-MM-DDTHH:mm") por dia calendário e monta os
// agregados diários (máx/mín/soma) — mesma lógica pros 3 provedores, já que nenhum deles
// devolve o resumo diário pronto no formato que o app espera.
function agregarPorDia(timeIso, temperature, relativehumidity, windspeed, windgusts, precipitation, precipitation_probability) {
  const porDia = {}
  timeIso.forEach((t, i) => { const dia = t.slice(0, 10); (porDia[dia] = porDia[dia] || []).push(i) })
  const dias = Object.keys(porDia).sort()
  const valores = (arr, d) => porDia[d].map(i => arr?.[i]).filter(v => v != null)
  const maxDe = (arr, d) => { const vs = valores(arr, d); return vs.length ? Math.max(...vs) : null }
  const minDe = (arr, d) => { const vs = valores(arr, d); return vs.length ? Math.min(...vs) : null }
  const somaDe = (arr, d) => valores(arr, d).reduce((a, v) => a + v, 0)
  return {
    time: dias,
    temperature_2m_max: dias.map(d => maxDe(temperature, d)),
    temperature_2m_min: dias.map(d => minDe(temperature, d)),
    precipitation_probability_max: dias.map(d => maxDe(precipitation_probability, d)),
    precipitation_sum: dias.map(d => somaDe(precipitation, d)),
    windspeed_10m_max: dias.map(d => maxDe(windspeed, d)),
    windgusts_10m_max: dias.map(d => maxDe(windgusts, d)),
  }
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
  const daily = agregarPorDia(timeIso, h.temperature, h.relativehumidity, h.windspeed, h.gust, h.precipitation, h.precipitation_probability)
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

// Tomorrow.io v4/weather/forecast — `units=metric` já devolve temperatura em °C, vento em
// km/h e precipitação em mm/h, então não precisa de conversão manual. A timeline diária da
// própria API não é usada — os agregados são recalculados a partir da horária (agregarPorDia),
// pra garantir consistência com os outros 2 provedores.
async function buscarTomorrow(lat, lon) {
  console.log('[Weather API] Fetching from Tomorrow.io...')
  const apiKey = (process.env.TOMORROW_API_KEY || '').trim()
  if (!apiKey) {
    console.log('[Weather API] Tomorrow.io: TOMORROW_API_KEY ausente')
    throw new Error('API Key ausente')
  }
  const url = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&units=metric&apikey=${apiKey}`
  const r = await fetchComTimeout(url, TIMEOUT_MS)
  if (!r.ok) {
    const corpo = await r.text().catch(() => '(não consegui ler o corpo da resposta)')
    console.error('[Tomorrow.io Error Details]:', corpo)
    console.log(`[Weather API] Tomorrow.io respondeu HTTP ${r.status}`)
    throw new Error(`HTTP ${r.status}`)
  }
  const data = await r.json()
  const horas = data?.timelines?.hourly
  if (!Array.isArray(horas) || !horas.length) {
    console.log('[Weather API] Tomorrow.io: resposta sem timeline horária')
    throw new Error('resposta sem timeline horária')
  }

  // Tomorrow.io devolve os horários em UTC ("2026-08-13T14:00:00Z"). Meteoblue e Open-Meteo
  // (com &timezone=auto) já devolvem hora LOCAL de America/Sao_Paulo — só tirar o "Z" sem
  // deslocar o fuso deixava a Tomorrow.io 3h adiantada, o que descasava o card de "temperatura
  // agora" (cai no fallback de tempMax) e fazia o gráfico "por hora" mostrar o dia errado de
  // horas. Brasil não observa horário de verão desde 2019, então UTC-3 fixo é seguro aqui.
  const timeIso = horas.map(h => {
    const d = new Date(h.time) // "...Z" já é interpretado como UTC
    d.setUTCHours(d.getUTCHours() - 3)
    const p2 = n => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
  })
  const temperature = horas.map(h => h.values?.temperature ?? null)
  const relativehumidity = horas.map(h => h.values?.humidity ?? null)
  const windspeed = horas.map(h => h.values?.windSpeed ?? null)
  const windgusts = horas.map(h => h.values?.windGust ?? null)
  const precipitation_probability = horas.map(h => h.values?.precipitationProbability ?? null)
  // Testado direto contra a API real: o campo se chama `rainIntensity`, não
  // `precipitationIntensity` (que não existe na resposta) — evita ficar com chuva sempre 0.
  const precipitation = horas.map(h => h.values?.rainIntensity ?? null)

  const daily = agregarPorDia(timeIso, temperature, relativehumidity, windspeed, windgusts, precipitation, precipitation_probability)
  const hourly = { time: timeIso, temperature_2m: temperature, relativehumidity_2m: relativehumidity, windspeed_10m: windspeed, windgusts_10m: windgusts, precipitation_probability }
  console.log('[Weather API] Tomorrow.io OK')
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

const BUSCAR_POR_PROVEDOR = { meteoblue: buscarMeteoblue, tomorrow: buscarTomorrow, open_meteo: buscarOpenMeteo }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { lat, lon } = req.query
  if (!lat || !lon) return res.status(400).json({ error: 'lat e lon são obrigatórios' })

  const sb = clienteAdmin()

  // Modo diagnóstico (usado pelo Admin pra mostrar status individual de cada provedor) —
  // testa os 3 de forma independente, sem parar no primeiro que funcionar, e SEM gravar no
  // repositório de logs (é um teste manual do admin, não uma chamada real do app do piloto).
  if (req.query.diagnostico === '1') {
    const resultados = {}
    for (const p of TODOS_PROVEDORES) {
      try { await BUSCAR_POR_PROVEDOR[p](lat, lon); resultados[p] = { ok: true } }
      catch (e) { resultados[p] = { ok: false, erro: e.message } }
    }
    return res.status(200).json({ diagnostico: resultados })
  }

  const ordem = await lerOrdemProvedores(sb)
  console.log(`[Weather API] Ordem de provedores: ${ordem.join(' → ')} (lat=${lat}, lon=${lon})`)

  const erros = {}
  for (let i = 0; i < ordem.length; i++) {
    const provedor = ordem[i]
    try {
      const resultado = await BUSCAR_POR_PROVEDOR[provedor](lat, lon)
      await registrarChamada(sb, provedor, true, null)
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200')
      const payload = { ...resultado, provider_active: provedor }
      if (i > 0) {
        payload.aviso = `Provedor(es) anterior(es) falharam (${Object.keys(erros).map(p => NOME_PROVEDOR[p]).join(', ')}), usando ${NOME_PROVEDOR[provedor]} como backup.`
        payload.erros_anteriores = erros
      }
      return res.status(200).json(payload)
    } catch (e) {
      console.log(`[Weather API] ${NOME_PROVEDOR[provedor]} falhou: ${e.message}${i < ordem.length - 1 ? ' — caindo pro próximo' : ''}`)
      await registrarChamada(sb, provedor, false, e.message)
      erros[provedor] = e.message
    }
  }
  return res.status(502).json({
    error: `Falha em todos os provedores. ${Object.entries(erros).map(([p, m]) => `${NOME_PROVEDOR[p]}: ${m}`).join(' · ')}`,
  })
}

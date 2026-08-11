// Proxy da Meteoblue Weather API — a chave paga (METEOBLUE_API_KEY) fica só aqui no
// servidor, nunca no bundle do frontend. Busca o pacote horário (basic-1h + wind-1h:
// temperatura, precipitação, umidade, vento e rajada) e devolve os dados já no MESMO
// formato que o app usava com o Open-Meteo antes (hourly/daily com os mesmos nomes de
// campo) — assim o resto do código (buscarPrevisao, gráficos, Delta T) não precisa mudar,
// só a origem dos dados.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { lat, lon } = req.query
  if (!lat || !lon) return res.status(400).json({ error: 'lat e lon são obrigatórios' })

  const apiKey = process.env.METEOBLUE_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'METEOBLUE_API_KEY não configurada no servidor (Vercel > Settings > Environment Variables)' })

  try {
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

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200')
    return res.status(200).json({ hourly, daily, fonte: 'meteoblue' })
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }
}

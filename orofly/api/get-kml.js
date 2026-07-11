const { createClient } = require('@supabase/supabase-js')

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { path, bucket = 'relatorios' } = req.query
  if (!path) return res.status(400).json({ error: 'Path required' })

  const admin = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  try {
    const { data, error } = await admin.storage.from(bucket).download(path)
    if (error) throw error
    const text = await data.text()
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml')
    res.setHeader('Content-Disposition', `attachment; filename="${path.split('/').pop()}"`)
    return res.status(200).send(text)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}

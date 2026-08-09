// Reverse geocoding (lat/lng -> município/UF) via BigDataCloud — API pública, gratuita,
// sem chave e com CORS liberado pra chamada direto do navegador/WebView. Usada só pra
// mostrar um rótulo amigável (ex: "Petrópolis - RJ") ao lado do GPS na Home; se falhar
// (sem sinal, API fora do ar), quem chamar deve cair pro rótulo genérico "Sua localização".
export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=pt`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const cidade = data.city || data.locality || data.principalSubdivision
    const uf = (data.principalSubdivisionCode || '').replace(/^BR-/, '')
    if (!cidade) return null
    return { cidade, uf: uf || null }
  } catch {
    return null
  }
}

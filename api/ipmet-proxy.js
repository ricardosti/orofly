// Proxy reverso simples pro Radar GIS Local do IPMet (2mobileGis.php) — o servidor deles
// manda um header `Content-Security-Policy: frame-ancestors 'self' https://www.canaoeste.com.br/`
// que bloqueia qualquer site de fora embutir a página num <iframe>. Como a checagem de
// frame-ancestors é feita pelo navegador em cima da resposta do DOCUMENTO FRAMEADO, servir
// esse mesmo HTML através de um endpoint nosso (sem repassar aquele header) já resolve o
// bloqueio — o navegador passa a ver a página como "vinda do nosso domínio".
//
// Pra recursos com caminho relativo (css/js/img) e chamadas fetch/XHR relativas do próprio
// JS deles continuarem funcionando, injeta <base href="https://www.ipmetradar.com.br/">
// logo no <head> — o navegador resolve toda URL relativa contra essa base, então os
// arquivos e chamadas de API deles continuam indo pro domínio original (só o DOCUMENTO em
// si é que passa pela gente). Isso é best-effort: se algum recurso da página deles tiver
// sua própria política de CORS/CSP restritiva, ainda pode falhar — não tem workaround pra
// isso sem control sobre o servidor do IPMet.
const ALVO = 'https://www.ipmetradar.com.br/2mobileGis.php'

module.exports = async function handler(req, res) {
  try {
    const r = await fetch(ALVO, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OroflyProxy/1.0)' } })
    let html = await r.text()

    // Injeta <base> logo após a abertura do <head> (ou no início do documento, se não achar
    // <head>) pra resolver os caminhos relativos contra o domínio original do IPMet.
    const baseTag = `<base href="https://www.ipmetradar.com.br/">`
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, m => `${m}${baseTag}`)
    } else {
      html = baseTag + html
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    // Sem CSP/X-Frame-Options aqui — é exatamente o que permite o iframe funcionar.
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(html)
  } catch (e) {
    res.status(502).send(`<html><body style="font-family:sans-serif;padding:20px;color:#666">Não foi possível carregar o Radar IPMet agora (${e.message}).</body></html>`)
  }
}

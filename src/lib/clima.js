// Calcula Delta T real (uso agronômico): diferença entre temperatura seca (bulbo seco)
// e temperatura de bulbo úmido — não confundir com ponto de orvalho, que é outra grandeza.
// Bulbo úmido aproximado pela fórmula de Stull (2011), válida para RH entre 5% e 99% e T entre -20°C e 50°C.
export function calcDeltaT(tempC, umidadePercent) {
  const t = parseFloat(tempC)
  const rh = parseFloat(umidadePercent)
  if (isNaN(t) || isNaN(rh) || rh <= 0) return null
  const tw = t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
    + Math.atan(t + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
    - 4.686035
  return Math.max(0, t - tw)
}

// Classifica cada parâmetro climático
export function classificarClimaParam(key, valor) {
  const v = parseFloat(valor)
  if (isNaN(v)) return null
  if (key === 'vento') {
    if (v < 3) return { status: 'nao_conforme', label: 'Não Conforme', cor: '#e5484d', bg: '#fdeaea', icon: '⚠️', diag: 'Calmaria: risco de inversão térmica' }
    if (v <= 15) return { status: 'apta', label: 'Apta', cor: '#0e9f6e', bg: '#e3f7ec', icon: '✅', diag: 'Condição ideal para aplicação' }
    return { status: 'nao_conforme', label: 'Não Conforme', cor: '#e5484d', bg: '#fdeaea', icon: '⚠️', diag: 'Vento forte: deriva severa' }
  }
  if (key === 'umidade') {
    if (v < 50) return { status: 'nao_conforme', label: 'Não Conforme', cor: '#e5484d', bg: '#fdeaea', icon: '⚠️', diag: 'Ar muito seco: evaporação severa' }
    if (v <= 90) return { status: 'apta', label: 'Apta', cor: '#0e9f6e', bg: '#e3f7ec', icon: '✅', diag: 'Faixa segura para aplicação' }
    return { status: 'alerta', label: 'Atenção', cor: '#f2960f', bg: '#fdf3e0', icon: '⚡', diag: 'Saturação: risco de lavagem' }
  }
  if (key === 'temperatura') {
    if (v < 10) return { status: 'alerta', label: 'Atenção', cor: '#f2960f', bg: '#fdf3e0', icon: '⚡', diag: 'Frio: absorção reduzida pelas plantas' }
    if (v <= 30) return { status: 'apta', label: 'Apta', cor: '#0e9f6e', bg: '#e3f7ec', icon: '✅', diag: 'Temperatura ideal para aplicação' }
    return { status: 'nao_conforme', label: 'Não Conforme', cor: '#e5484d', bg: '#fdeaea', icon: '⚠️', diag: 'Estresse térmico: fechamento estomático' }
  }
  if (key === 'delta_t') {
    if (v < 2) return { status: 'nao_conforme', label: 'Não Recomendado', cor: '#e5484d', bg: '#fdeaea', icon: '🚫', diag: 'Cerração/neblina: escorrimento e inversão térmica. Não aplicar.' }
    if (v <= 7) return { status: 'apta', label: 'Ideal', cor: '#0e9f6e', bg: '#e3f7ec', icon: '✅', diag: 'Janela de ouro: deposição perfeita. Aplicação recomendada.' }
    if (v < 8) return { status: 'alerta', label: 'Atenção', cor: '#f2960f', bg: '#fdf3e0', icon: '⚡', diag: 'Limite: só gotas grossas, adjuvantes antideriva ou óleos.' }
    return { status: 'nao_conforme', label: 'Não Pode Voar', cor: '#e5484d', bg: '#fdeaea', icon: '🚫', diag: 'Delta T ≥ 8: evaporação excessiva. Interromper a aplicação.' }
  }
  return null
}

// Conversão de cor pro seletor em gradiente usado nas duas telas que desenham: o mapa
// (MapaFazendaViewer) e o editor de foto (ImageAnnotator). Antes cada um tinha 4 cores
// fixas; agora a barra arco-íris escolhe qualquer matiz, e os atalhos continuam pra quem
// só quer o vermelho de sempre.
//
// Saturação e luminosidade ficam travadas de propósito: a marcação é feita em cima de
// mapa claro e de foto de campo no sol, e cor escolhida livremente saía lavada (clara
// demais) ou preta (escura demais) e sumia. Travando, qualquer ponto do gradiente dá um
// traço legível. Branco e preto entram pelos atalhos, não pela barra.
const SAT = 0.85, LUZ = 0.55

// Matiz (0–359) → hex.
export function hslParaHex(h) {
  const c = (1 - Math.abs(2 * LUZ - 1)) * SAT
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = LUZ - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const bt = v => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${bt(r)}${bt(g)}${bt(b)}`
}

// Hex → matiz (0–359), pra barra abrir já na posição da cor atual.
export function matizDaCor(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '')
  if (!m) return 0
  const [r, g, b] = m.slice(1).map(v => parseInt(v, 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  // Cinza, branco e preto não têm matiz: a barra fica no começo em vez de saltar
  // pra um vermelho que o usuário não escolheu.
  if (!d) return 0
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? ((b - r) / d + 2) : ((r - g) / d + 4)
  return Math.round(h * 60)
}

// Atalhos comuns às duas telas. Branco e preto ficam aqui porque o gradiente não alcança.
export const CORES_ATALHO = ['#e5484d', '#f2c94c', '#00A86B', '#ffffff', '#111111']

// Estilo da barra arco-íris — o próprio gradiente é o controle.
export const GRADIENTE_MATIZ =
  'linear-gradient(to right,hsl(0,85%,55%),hsl(60,85%,55%),hsl(120,85%,55%),hsl(180,85%,55%),hsl(240,85%,55%),hsl(300,85%,55%),hsl(359,85%,55%))'

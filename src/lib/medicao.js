// Medição no mapa — distância de uma linha e área de um polígono.
//
// Lib separada do geopdf.js de propósito: aquele importa o pdf.js, que precisa de DOM e
// não roda no Node. Aqui é só geometria, então dá pra testar a conta sem abrir navegador.
//
// Projeta lat/lng em metros num plano local (equirretangular em torno do
// centroide) e aplica a fórmula do agrimensor. Para talhão ou fazenda — poucos
// quilômetros — o erro dessa projeção é muito menor que o do GPS do celular,
// então não compensa trazer uma projeção de verdade só pra isso.
const RAIO_TERRA_M = 6378137

function projetarMetros(pontos) {
  const lat0 = pontos.reduce((a, p) => a + p.lat, 0) / pontos.length
  const cos0 = Math.cos(lat0 * Math.PI / 180)
  return pontos.map(p => ({
    x: (p.lng * Math.PI / 180) * RAIO_TERRA_M * cos0,
    y: (p.lat * Math.PI / 180) * RAIO_TERRA_M,
  }))
}

/** Comprimento da linha que liga os pontos, em metros. */
export function comprimentoMetros(pontos) {
  if (!pontos || pontos.length < 2) return 0
  const m = projetarMetros(pontos)
  let total = 0
  for (let i = 1; i < m.length; i++) total += Math.hypot(m[i].x - m[i-1].x, m[i].y - m[i-1].y)
  return total
}

/** Área do polígono fechado pelos pontos, em hectares. Menos de 3 pontos = 0. */
export function areaHectares(pontos) {
  if (!pontos || pontos.length < 3) return 0
  const m = projetarMetros(pontos)
  let soma = 0
  for (let i = 0; i < m.length; i++) {
    const a = m[i], b = m[(i + 1) % m.length]
    soma += a.x * b.y - b.x * a.y
  }
  return Math.abs(soma / 2) / 10000
}

/** Perímetro do polígono (fecha do último ponto de volta ao primeiro), em metros. */
export function perimetroMetros(pontos) {
  if (!pontos || pontos.length < 3) return comprimentoMetros(pontos)
  return comprimentoMetros([...pontos, pontos[0]])
}

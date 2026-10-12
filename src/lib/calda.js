// Formatação da calculadora de calda (app do piloto).
//
// Antes tudo saía com toFixed(2) em L ou kg: 15 mL/ha em 1,3 ha (19,5 mL) aparecia "0.02 L",
// e 12 g/ha em 3,7 ha (44,4 g) aparecia "0.04 kg" — no preparo da calda, essa diferença é
// produto errado no tanque. Agora: abaixo de 1 L / 1 kg o total vai em mL / g (1 casa); acima
// disso, até 3 casas (a precisão do mL / g). Pedido do Ricardo em 12/10/2026.

const num = (v, casas) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })

// `valor` em L (familia 'vol') ou kg ('massa'), como a calculadora calcula.
export function formatarQtd(valor, familia = 'vol') {
  const v = Number(valor) || 0
  const massa = familia === 'massa'
  if (v === 0) return massa ? '0 kg' : '0 L'
  if (Math.abs(v) < 1) return `${num(v * 1000, 1)} ${massa ? 'g' : 'mL'}`
  return `${num(v, 3)} ${massa ? 'kg' : 'L'}`
}

// Área que a água disponível cobre: arredonda PARA BAIXO. Mostrar 16,90 ha quando a conta dá
// 16,89 faz a calda acabar antes do fim do talhão. (O epsilon evita 20 virar 19,99 por causa
// do ponto flutuante.)
export function areaPossivel(ha) {
  return Math.floor((Number(ha) || 0) * 100 + 1e-9) / 100
}

export function formatarHa(ha, casas = 2) {
  return `${num(Number(ha) || 0, casas)} ha`
}

// Preenchimento padrão do formulário de voo: vazão, altura, velocidade, faixa e gota.
//
// Pode vir de três cadastros, do mais específico pro mais geral: FAZENDA → CLIENTE → DRONE
// (Ricardo, 15/10/2026: "cada cliente/fazenda/drone vai ter um preenchimento padrão"). Campo vazio
// num nível cai pro seguinte; o que nenhum dos três define continua como o piloto deixou. Tudo
// segue editável no formulário — é ponto de partida, não trava.

export const CAMPOS_PARAMS = [
  ['vazao', 'VAZÃO (L/ha)', 'Ex: 10'],
  ['altura', 'ALTURA (m)', 'Ex: 4'],
  ['velocidade', 'VELOCIDADE (km/h)', 'Ex: 24'],
  ['faixa', 'FAIXA (m)', 'Ex: 8'],
  ['gota', 'GOTA (micras)', 'Ex: 200'],
]

const temValor = v => v != null && String(v).trim() !== ''

// Tira campos vazios antes de gravar; objeto sem nada vira null (coluna limpa).
export function limparParams(p) {
  const out = {}
  CAMPOS_PARAMS.forEach(([k]) => { if (temValor(p?.[k])) out[k] = String(p[k]).trim() })
  return Object.keys(out).length ? out : null
}

// O drone guarda os padrões em colunas próprias (velocidade_padrao…); aqui vira o mesmo formato.
function doDrone(d) {
  if (!d) return {}
  return { vazao: d.vazao_padrao, altura: d.altura_padrao, velocidade: d.velocidade_padrao, faixa: d.faixa_padrao, gota: d.gota_padrao }
}

// Valor de cada campo e de onde ele veio ('fazenda' | 'cliente' | 'drone').
export function paramsEfetivos({ drone, cliente, fazenda }) {
  const niveis = [['fazenda', fazenda?.params_padrao || {}], ['cliente', cliente?.params_padrao || {}], ['drone', doDrone(drone)]]
  const out = {}
  CAMPOS_PARAMS.forEach(([k]) => {
    const achou = niveis.find(([, p]) => temValor(p[k]))
    if (achou) out[k] = { valor: String(achou[1][k]).trim(), origem: achou[0] }
  })
  return out
}

// Campos do formulário do piloto que cada parâmetro preenche.
export function camposDoFormulario(efetivos) {
  const v = k => efetivos[k]?.valor
  const out = {}
  if (v('velocidade')) out.velocidade_drone = v('velocidade')
  if (v('altura')) out.altura = v('altura')
  if (v('faixa')) { out.faixa_i = v('faixa'); out.faixa_f = v('faixa') }
  if (v('vazao')) { out.vazao_i = v('vazao'); out.vazao_f = v('vazao') }
  if (v('gota')) out.tamanho_gota = v('gota')
  return out
}

// Gestão de frota (14/11/2026). O centro do negócio é levar o drone até a fazenda: a "frente de
// trabalho" é a caminhonete (ou a moto) com os drones, o gerador e as baterias. Por isso a frota
// cuida de veículo E de gerador (horímetro) e baterias (ciclos), e o checklist de saída confere o
// kit, não só o carro.
//
// Referências (pesquisa de 14/11/2026): sistemas de frota de mercado (Fleetio e afins) — lembrete
// de manutenção por km, horas ou tempo, inspeção pré-viagem com item crítico que gera bloqueio,
// consumo real por abastecimento e custo por km. Logística de drone agrícola — gerador ligado na
// área e ~3 baterias por drone em rodízio; bateria DJI DB1560 com garantia de 1.500 ciclos ou 12
// meses, o que vier primeiro.
//
// Só contas aqui (testáveis no Node); a tela é components/FrotaGestao.jsx.

export const TIPOS_VEICULO = [
  ['caminhonete', '🛻 Caminhonete'], ['moto', '🏍️ Moto'], ['carro', '🚗 Carro'], ['caminhao', '🚚 Caminhão de apoio'],
  ['reboque', '🚛 Reboque'], ['gerador', '⚡ Gerador'], ['outro', '🔧 Outro'],
]
export const ROTULO_TIPO = Object.fromEntries(TIPOS_VEICULO)
export const STATUS_VEICULO = {
  operacional: { rotulo: 'Operacional', cor: '#059669', bg: '#DCFCE7' },
  manutencao: { rotulo: 'Em manutenção', cor: '#B45309', bg: '#FEF3C7' },
  bloqueado: { rotulo: 'Bloqueado', cor: '#DC2626', bg: '#FEE2E2' },
  baixado: { rotulo: 'Baixado', cor: '#64748B', bg: '#F1F5F9' },
}
export const CATEGORIAS_MANUTENCAO = [
  ['preventiva', 'Preventiva'], ['corretiva', 'Corretiva'], ['pneus', 'Pneus'], ['funilaria', 'Funilaria'], ['eletrica', 'Elétrica'], ['revisao', 'Revisão'],
]
export const FINALIDADES_VIAGEM = ['Transporte de drone e equipe', 'Logística de insumos', 'Manutenção de campo', 'Visita técnica', 'Retorno à base', 'Outra']
export const medidorDe = v => (v?.medidor === 'horas' || v?.tipo === 'gerador' ? 'horas' : 'km')
export const leituraDe = v => (medidorDe(v) === 'horas' ? num(v?.horimetro) : num(v?.km_atual))

const num = v => { if (typeof v === 'number') return v; const s = String(v ?? '').replace(/\s/g, ''); const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return isNaN(n) ? NaN : n }
const num0 = v => { const n = num(v); return isNaN(n) ? 0 : n }
export const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
export const somarDias = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10) }
export const somarMeses = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(a, m - 1 + n, 1)); const ult = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d, ult)); return t.toISOString().slice(0, 10) }
export const diasEntre = (de, ate) => Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / 86400000)

// ── Checklist de saída ───────────────────────────────────────────────────────────────
// `critico`: reprovado bloqueia o veículo até um gestor liberar. Os demais viram pendência
// (sai, mas o gestor fica sabendo). O kit da operação vale pra qualquer veículo que leva drone.
const I = (id, texto, critico = false) => ({ id, texto, critico })
export const CHECKLIST_VEICULO = [
  I('pneus', 'Pneus e estepe (calibragem, cortes, desgaste)', true),
  I('freios', 'Freios e freio de mão', true),
  I('luzes', 'Faróis, lanternas, setas e luz de freio', true),
  I('direcao', 'Direção e suspensão sem folga ou barulho', true),
  I('cinto', 'Cintos de segurança', true),
  I('docs_veiculo', 'Documento do veículo (CRLV) em dia', true),
  I('extintor', 'Extintor, triângulo e macaco', true),
  I('amarracao', 'Carga amarrada e travada (drones, gerador, tanques)', true),
  I('oleo_agua', 'Óleo do motor e água do radiador'),
  I('vazamentos', 'Sem vazamentos embaixo do veículo'),
  I('parabrisa', 'Para-brisa, retrovisores e limpadores'),
  I('combustivel', 'Combustível suficiente para ir e voltar'),
]
export const CHECKLIST_MOTO = [
  I('pneus', 'Pneus (calibragem e desgaste)', true), I('freios', 'Freios dianteiro e traseiro', true), I('luzes', 'Farol, lanterna, setas e luz de freio', true),
  I('capacete', 'Capacete e equipamento do piloto', true), I('docs_veiculo', 'Documento da moto em dia', true),
  I('corrente', 'Corrente lubrificada e esticada'), I('oleo', 'Nível de óleo'), I('retrovisores', 'Retrovisores'),
]
export const CHECKLIST_GERADOR = [
  I('combustivel_gerador', 'Combustível do gerador (e reserva)', true), I('oleo_gerador', 'Óleo do gerador no nível', true),
  I('cabos_gerador', 'Cabos e tomadas sem dano', true), I('aterramento', 'Aterramento / estaca'), I('filtro_ar', 'Filtro de ar limpo'),
]
export const CHECKLIST_KIT = [
  I('drones', 'Drones conferidos (braços, hélices, bicos, tanque)', true),
  I('controles', 'Controles remotos carregados', true),
  I('baterias', 'Baterias dos drones (quantidade e carga)', true),
  I('gerador_kit', 'Gerador e carregador das baterias', true),
  I('epi', 'EPI da equipe (máscara, luvas, óculos, macacão)', true),
  I('docs_operacao', 'Documentos da operação (autorizações, receituário, OS)', true),
  I('misturador', 'Tanque de calda, misturador e mangueiras'),
  I('agua', 'Água limpa para lavagem e emergência'),
  I('primeiros_socorros', 'Kit de primeiros socorros'),
]
// Itens do checklist de um veículo. `levaKit`: a saída leva drone (o padrão da caminhonete).
export function itensDoChecklist(veiculo, { levaKit = veiculo?.tipo !== 'moto' && veiculo?.tipo !== 'gerador' } = {}) {
  const base = veiculo?.tipo === 'moto' ? CHECKLIST_MOTO : veiculo?.tipo === 'gerador' ? CHECKLIST_GERADOR : CHECKLIST_VEICULO
  return [...base.map(i => ({ ...i, grupo: 'veiculo' })), ...(levaKit ? CHECKLIST_KIT.map(i => ({ ...i, grupo: 'kit' })) : [])]
}
// Respostas: { [id]: { ok: true|false, obs } }. Item sem resposta conta como não conferido.
export function avaliarChecklist(itens, respostas) {
  const falhas = itens.filter(i => respostas?.[i.id]?.ok === false)
  const semResposta = itens.filter(i => respostas?.[i.id]?.ok == null)
  const criticas = falhas.filter(i => i.critico)
  const resultado = criticas.length ? 'reprovado' : falhas.length ? 'pendencia' : 'aprovado'
  return { resultado, falhas, criticas, semResposta, completo: semResposta.length === 0 }
}
export const ROTULO_RESULTADO = { aprovado: '✅ Aprovado', pendencia: '⚠️ Com pendência', reprovado: '⛔ Reprovado' }

// ── Consumo e custo ──────────────────────────────────────────────────────────────────
// Consumo real pelo método do tanque cheio: entre dois abastecimentos de tanque cheio, os
// litros colocados no segundo (e nos parciais do meio) rodaram a distância entre os dois.
// Gerador: litros por hora, pelo horímetro.
export function consumoReal(abastecimentos, veiculo) {
  const horas = medidorDe(veiculo) === 'horas'
  const leitura = a => num(horas ? a.horimetro : a.km)
  const ord = [...(abastecimentos || [])].filter(a => !isNaN(leitura(a))).sort((a, b) => leitura(a) - leitura(b) || String(a.data).localeCompare(String(b.data)))
  const trechos = []
  let ancora = null, litros = 0
  for (const a of ord) {
    if (!ancora) { if (a.tanque_cheio) ancora = a; continue }
    litros += num0(a.litros)
    if (!a.tanque_cheio) continue
    const dist = leitura(a) - leitura(ancora)
    if (dist > 0 && litros > 0) trechos.push({ de: ancora, ate: a, distancia: dist, litros, consumo: horas ? litros / dist : dist / litros })
    ancora = a; litros = 0
  }
  const dist = trechos.reduce((s, t) => s + t.distancia, 0), lt = trechos.reduce((s, t) => s + t.litros, 0)
  const media = trechos.length && dist > 0 && lt > 0 ? (horas ? lt / dist : dist / lt) : null
  const esperado = num(veiculo?.consumo_esperado)
  // Desvio: pra km/L, abaixo do esperado é pior; pra L/h, acima é pior. Em %.
  const desvio = media != null && esperado > 0 ? (horas ? (media - esperado) / esperado : (esperado - media) / esperado) * 100 : null
  return { trechos, media, unidade: horas ? 'L/h' : 'km/L', esperado: esperado > 0 ? esperado : null, desvio, ultimo: trechos[trechos.length - 1] || null }
}
export const precoMedioCombustivel = abast => { const l = (abast || []).reduce((s, a) => s + num0(a.litros), 0); return l > 0 ? (abast || []).reduce((s, a) => s + num0(a.valor), 0) / l : null }

// Custos de um veículo no período (datas 'AAAA-MM-DD'). Fixos anuais (IPVA, licenciamento,
// seguro) entram rateados por dia; depreciação, se tiver valor de compra, em 5 anos.
export function custosDoVeiculo(veiculo, { abastecimentos = [], manutencoes = [], viagens = [], ini, fim }) {
  const dentro = d => d && d >= ini && d <= fim
  const ab = abastecimentos.filter(a => a.veiculo_id === veiculo.id && dentro(String(a.data).slice(0, 10)))
  const mn = manutencoes.filter(m => m.veiculo_id === veiculo.id && m.status !== 'agendada' && dentro(String(m.data).slice(0, 10)))
  const combustivel = ab.reduce((s, a) => s + num0(a.valor), 0)
  const litros = ab.reduce((s, a) => s + num0(a.litros), 0)
  const manutencao = mn.reduce((s, m) => s + (num0(m.valor_pecas) + num0(m.valor_mao_obra) || num0(m.custo)), 0)
  const dias = Math.max(1, diasEntre(ini, fim) + 1)
  const anual = num0(veiculo.ipva_valor) + num0(veiculo.licenciamento_valor) + num0(veiculo.seguro_valor)
  const fixos = (anual / 365) * dias
  const depreciacao = num0(veiculo.valor_compra) > 0 ? (num0(veiculo.valor_compra) / (5 * 365)) * dias : 0
  // Distância: maior leitura menos a menor no período (abastecimentos e viagens), que é o que de
  // fato rodou — somar viagens deixaria de fora quem não lança viagem.
  const horas = medidorDe(veiculo) === 'horas'
  const leituras = horas ? ab.map(a => num(a.horimetro)) : [
    ...ab.map(a => num(a.km)),
    ...viagens.filter(v => v.veiculo_id === veiculo.id && dentro(String(v.data).slice(0, 10))).flatMap(v => [num(v.km_inicial), num(v.km_final)]),
  ]
  const ok = leituras.filter(x => !isNaN(x) && x > 0)
  const rodado = ok.length >= 2 ? Math.max(...ok) - Math.min(...ok) : 0
  const total = combustivel + manutencao + fixos + depreciacao
  return { combustivel, litros, manutencao, fixos, depreciacao, total, rodado, unidade: horas ? 'h' : 'km', custoPorUnidade: rodado > 0 ? total / rodado : null, custoOperacionalPorUnidade: rodado > 0 ? (combustivel + manutencao) / rodado : null }
}

// ── Planos de manutenção ─────────────────────────────────────────────────────────────
// Vence o que chegar primeiro: km, horas ou data. "Próximo" = faltando 10% do intervalo (ou
// 500 km / 25 h / 15 dias, o que for maior).
export function situacaoDoPlano(plano, veiculo, hoje = hojeISO()) {
  const atualKm = num(veiculo?.km_atual), atualH = num(veiculo?.horimetro)
  const partes = []
  if (num(plano.intervalo_km) > 0) {
    const prox = num0(plano.ultimo_km) + num(plano.intervalo_km)
    const falta = isNaN(atualKm) ? null : prox - atualKm
    partes.push({ tipo: 'km', proximo: prox, falta, limiar: Math.max(500, num(plano.intervalo_km) * 0.1) })
  }
  if (num(plano.intervalo_horas) > 0) {
    const prox = num0(plano.ultimo_horas) + num(plano.intervalo_horas)
    const falta = isNaN(atualH) ? null : prox - atualH
    partes.push({ tipo: 'horas', proximo: prox, falta, limiar: Math.max(25, num(plano.intervalo_horas) * 0.1) })
  }
  if (num(plano.intervalo_meses) > 0 && plano.ultima_data) {
    const prox = somarMeses(String(plano.ultima_data).slice(0, 10), num(plano.intervalo_meses))
    partes.push({ tipo: 'data', proximo: prox, falta: diasEntre(hoje, prox), limiar: Math.max(15, num(plano.intervalo_meses) * 3) })
  }
  const nivel = p => (p.falta == null ? 0 : p.falta < 0 ? 2 : p.falta <= p.limiar ? 1 : 0)
  const pior = partes.reduce((a, p) => (!a || nivel(p) > nivel(a) || (nivel(p) === nivel(a) && p.falta != null && a.falta != null && p.falta / p.limiar < a.falta / a.limiar) ? p : a), null)
  const situacao = !pior ? 'sem_dados' : nivel(pior) === 2 ? 'vencido' : nivel(pior) === 1 ? 'proximo' : 'em_dia'
  return { situacao, partes, pior }
}
export const ROTULO_SITUACAO = { vencido: 'Vencida', proximo: 'Próxima', em_dia: 'Em dia', sem_dados: 'Sem a última' }
export const descreverFalta = p => !p || p.falta == null ? '—'
  : p.tipo === 'data' ? (p.falta < 0 ? `venceu há ${-p.falta} dia${p.falta === -1 ? '' : 's'}` : `em ${p.falta} dia${p.falta === 1 ? '' : 's'}`)
  : p.falta < 0 ? `passou ${Math.round(-p.falta).toLocaleString('pt-BR')} ${p.tipo}` : `faltam ${Math.round(p.falta).toLocaleString('pt-BR')} ${p.tipo}`
// Planos típicos pra começar (o gestor ajusta): caminhonete diesel, moto e gerador.
export const PLANOS_SUGERIDOS = {
  caminhonete: [['Troca de óleo e filtro', 10000, null, 6], ['Revisão completa', 20000, null, 12], ['Rodízio e alinhamento', 10000, null, null], ['Pneus (avaliar troca)', 50000, null, null]],
  moto: [['Troca de óleo', 3000, null, 6], ['Corrente e relação', 15000, null, null], ['Revisão', 6000, null, 12]],
  gerador: [['Troca de óleo do gerador', null, 100, 6], ['Filtro de ar e vela', null, 200, 12], ['Revisão do gerador', null, 500, 12]],
}

// ── Baterias ─────────────────────────────────────────────────────────────────────────
export function situacaoBateria(b, hoje = hojeISO()) {
  const uso = num0(b.ciclos_limite) > 0 ? num0(b.ciclos) / num0(b.ciclos_limite) : 0
  const garantiaAte = b.data_compra ? somarMeses(String(b.data_compra).slice(0, 10), num0(b.garantia_meses) || 12) : null
  const garantiaVencida = garantiaAte ? garantiaAte < hoje : false
  const nivel = b.status === 'descartada' ? 'descartada' : uso >= 1 ? 'fim' : uso >= 0.85 ? 'atencao' : 'ok'
  return { uso, garantiaAte, garantiaVencida, nivel, desatualizada: b.ciclos_atualizado_em ? diasEntre(String(b.ciclos_atualizado_em).slice(0, 10), hoje) > 30 : true }
}

// ── Alertas (tela inicial da frota) ──────────────────────────────────────────────────
export function alertasDaFrota({ veiculos = [], planos = [], cnhs = [], baterias = [], checklists = [], hoje = hojeISO() }) {
  const out = []
  const add = (nivel, area, texto, ref = null) => out.push({ nivel, area, texto, ref })
  const ativos = veiculos.filter(v => v.ativo !== false && v.status !== 'baixado')
  const nome = v => `${v.placa || ''} ${v.modelo || ''}`.trim()
  for (const v of ativos) {
    if (v.status === 'bloqueado') add('critico', 'checklist', `${nome(v)} bloqueado: checklist com item crítico reprovado, aguardando liberação`, v.id)
    for (const [campo, rot] of [['ipva_venc', 'IPVA'], ['licenciamento_venc', 'Licenciamento'], ['seguro_venc', 'Seguro']]) {
      if (!v[campo]) continue
      const d = diasEntre(hoje, String(v[campo]).slice(0, 10))
      if (d < 0) add('critico', 'documentos', `${rot} de ${nome(v)} venceu em ${br(v[campo])}`, v.id)
      else if (d <= 30) add('atencao', 'documentos', `${rot} de ${nome(v)} vence em ${d} dia${d === 1 ? '' : 's'} (${br(v[campo])})`, v.id)
    }
  }
  const porId = Object.fromEntries(veiculos.map(v => [v.id, v]))
  for (const p of planos.filter(x => x.ativo !== false)) {
    const v = porId[p.veiculo_id]
    if (!v || v.status === 'baixado' || v.ativo === false) continue
    const s = situacaoDoPlano(p, v, hoje)
    if (s.situacao === 'vencido') add('critico', 'manutencao', `${p.servico} de ${nome(v)} vencida (${descreverFalta(s.pior)})`, v.id)
    else if (s.situacao === 'proximo') add('atencao', 'manutencao', `${p.servico} de ${nome(v)}: ${descreverFalta(s.pior)}`, v.id)
  }
  for (const c of cnhs) {
    if (!c.validade) continue
    const d = diasEntre(hoje, String(c.validade).slice(0, 10))
    if (d < 0) add('critico', 'cnh', `CNH de ${c.nome || 'motorista'} venceu em ${br(c.validade)}`)
    else if (d <= 30) add('atencao', 'cnh', `CNH de ${c.nome || 'motorista'} vence em ${d} dia${d === 1 ? '' : 's'}`)
  }
  for (const b of baterias.filter(x => x.status !== 'descartada')) {
    const s = situacaoBateria(b, hoje)
    if (s.nivel === 'fim') add('critico', 'baterias', `Bateria ${b.codigo} chegou a ${b.ciclos} ciclos (limite ${b.ciclos_limite})`)
    else if (s.nivel === 'atencao') add('atencao', 'baterias', `Bateria ${b.codigo} com ${Math.round(s.uso * 100)}% dos ciclos`)
  }
  // Checklist com pendência (não crítica) nos últimos 3 dias ainda não visto por gestor.
  for (const c of checklists) {
    if (c.resultado !== 'pendencia' || c.liberado_em) continue
    if (diasEntre(String(c.feito_em).slice(0, 10), hoje) > 3) continue
    const v = porId[c.veiculo_id]
    add('atencao', 'checklist', `Checklist de ${v ? nome(v) : 'veículo'} com pendência (${c.motorista_nome || 'motorista'})`, c.veiculo_id)
  }
  return out.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'critico' ? -1 : 1))
}
const br = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')

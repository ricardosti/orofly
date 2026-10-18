// Monitoramento Climático (Beta) — "Ficha de Aplicação — Drone" voo a voo, pedida pela Bracell
// (Pastor, 18/10/2026). Por enquanto preenchida à mão: o piloto lança cada voo no app (Passo 4)
// ou o Pastor digita no painel a partir do papel. A ideia é depois vir da telemetria do drone.
//
// Formato guardado (relatorios.monitoramento_clima e fichas_clima.dados):
//   { auxiliar, tecnico_regional, supervisor, volume_consumido, recomendacao, observacoes,
//     voos: [{ inicio, fim, altura, area, temperatura, umidade, vento, obs }] }
//
// A exportação copia a ficha do Pastor: A4 paisagem, 3 operações por página, 10 voos por bloco
// (operação com mais de 10 voos continua num bloco seguinte, "OPERAÇÃO 01 (cont.)").

import jsPDF from 'jspdf'
import * as XLSX from 'xlsx'

export const CAMPOS_VOO = [
  ['inicio', 'Início do voo'],
  ['fim', 'Final do voo'],
  ['altura', 'Altura de voo acima do dossel (m)'],
  ['area', 'Área aplicada (ha)'],
  ['temperatura', 'Temperatura (°C)'],
  ['umidade', 'Umidade (%)'],
  ['vento', 'Vento (km/h)'],
]
export const CABECALHO = ['Fazenda (ID)', 'Talhão', 'Data da aplicação', 'Piloto', 'Auxiliar', 'Técnico Regional',
  'Supervisor Operacional', 'Volume de produto consumido (L)', 'Recomendação Agronômica (L/ha)']
// Padrões — o admin troca em Configurações do Sistema (Monitoramento Climático): o intervalo
// entre leituras no voo e quantas colunas cada operação tem na ficha (o papel tem 10).
export const MONITORAMENTO_PADRAO = { intervaloMin: 30, colunas: 10 }

const temValor = v => v != null && String(v).trim() !== ''
const num = v => parseFloat(String(v ?? '').replace(',', '.'))
const fmt = (v, casas = 2) => isNaN(v) ? '' : v.toLocaleString('pt-BR', { maximumFractionDigits: casas })

// Voo em branco não vai pro banco nem pra ficha.
export function limparFicha(f) {
  if (!f) return null
  const voos = (f.voos || []).filter(v => v && Object.values(v).some(temValor))
  const out = { ...f, voos }
  const temCab = ['auxiliar', 'tecnico_regional', 'supervisor', 'volume_consumido', 'recomendacao', 'observacoes'].some(k => temValor(f[k]))
  return voos.length || temCab ? out : null
}

// Próximo voo já sugerido: começa onde o anterior terminou e repete altura e clima, que mudam
// pouco de um voo pro outro — o piloto só corrige o que mudou.
export function sugerirProximoVoo(voos = [], { altura = '', temperatura = '', umidade = '', vento = '' } = {}) {
  const ult = voos[voos.length - 1]
  const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  return {
    inicio: ult?.fim || agora, fim: '', altura: ult?.altura || altura, area: '',
    temperatura: ult?.temperatura || temperatura, umidade: ult?.umidade || umidade, vento: ult?.vento || vento, obs: '',
    // Quando foi lançado — é o que zera o relógio da próxima leitura de 30 min (não sai na ficha).
    registrado_em: new Date().toISOString(),
  }
}

// ── Leitura a cada X min durante o voo ─────────────────────────────────────────────
export const INTERVALO_LEITURA_MIN = MONITORAMENTO_PADRAO.intervaloMin
// Intervalo válido em minutos (5 a 240); fora disso, o padrão.
export function intervaloValido(v, padrao = INTERVALO_LEITURA_MIN) {
  const n = parseInt(v, 10)
  return n >= 5 && n <= 240 ? n : padrao
}

// Agrupa as leituras em períodos de pelo menos `intervaloMin` minutos, pra ficha sair com o
// intervalo pedido na hora de emitir (ex.: lançado voo a voo, ficha de 30 em 30 min). Cada
// período: início da primeira leitura, fim da última, área somada e altura/clima da última
// (a medição mais recente do período). Sem intervalo, devolve as leituras como foram lançadas.
// 2 min de folga: leituras de "30 min" costumam fechar com 29.
export function agruparLeituras(voos = [], intervaloMin) {
  const iv = parseInt(intervaloMin, 10)
  if (!iv || iv <= 0) return voos
  const minutos = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null }
  const out = []
  let atual = null
  const fechar = () => { if (atual) out.push(atual.voo); atual = null }
  for (const v of voos) {
    if (!atual) atual = { ini: minutos(v.inicio), area: num(v.area), temArea: temValor(v.area), obs: v.obs ? [v.obs] : [], voo: { ...v } }
    else {
      atual.voo = { ...atual.voo, fim: v.fim || atual.voo.fim,
        altura: v.altura || atual.voo.altura, temperatura: v.temperatura || atual.voo.temperatura,
        umidade: v.umidade || atual.voo.umidade, vento: v.vento || atual.voo.vento }
      if (temValor(v.area)) { atual.area = (isNaN(atual.area) ? 0 : atual.area) + num(v.area); atual.temArea = true }
      if (v.obs) atual.obs.push(v.obs)
    }
    atual.voo.area = atual.temArea ? fmt(atual.area) : ''
    atual.voo.obs = atual.obs.join('; ')
    const fim = minutos(atual.voo.fim)
    if (atual.ini != null && fim != null && fim - atual.ini >= iv - 2) fechar()
  }
  fechar()
  return out
}

// Hora (Date) da última leitura registrada no voo; sem nenhuma, o início do voo.
export function referenciaUltimaLeitura(ficha, inicioVoo) {
  const tempos = (ficha?.voos || []).map(v => v.registrado_em && new Date(v.registrado_em)).filter(d => d && !isNaN(d))
  const ult = tempos.length ? new Date(Math.max(...tempos)) : null
  return ult || (inicioVoo ? new Date(inicioVoo) : null)
}

// Clima de agora pelo GPS (mesma fonte do "Clima início/fim" do Passo 3): temperatura, umidade e
// vento em km/h. Volta null sem sinal — aí o piloto digita.
export async function climaAgora(lat, lng) {
  if (lat == null || lng == null) return null
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&wind_speed_unit=kmh&timezone=auto`
    const c = (await (await fetch(url)).json())?.current
    if (!c) return null
    const pt = (v, casas) => v == null ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas })
    return { temperatura: pt(c.temperature_2m, 1), umidade: pt(c.relative_humidity_2m, 0), vento: pt(c.wind_speed_10m, 1) }
  } catch { return null }
}

const dataBR = iso => iso ? new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''

// Ficha pronta pra exportar, a partir de um voo registrado (relatório) ou de uma ficha manual.
export function fichaParaExportar({ rel, manual, fazendaCodigo = '', intervaloMin = 0 }) {
  const d = (rel ? rel.monitoramento_clima : manual?.dados) || {}
  const voos = agruparLeituras((d.voos || []).filter(v => v && Object.values(v).some(temValor)), intervaloMin)
  const fazenda = rel ? rel.fazenda : manual?.fazenda
  const codigo = rel ? fazendaCodigo : manual?.fazenda_codigo
  const vazao = rel ? num(rel.vazao_i || rel.vazao_f) : NaN
  const areaVoos = voos.reduce((a, v) => a + (num(v.area) || 0), 0)
  // Volume e recomendação: o que foi digitado vale; em branco, sai da vazão do voo × área.
  const recomendacao = temValor(d.recomendacao) ? d.recomendacao : (!isNaN(vazao) ? fmt(vazao) : '')
  const volume = temValor(d.volume_consumido) ? d.volume_consumido
    : (!isNaN(vazao) && areaVoos > 0 ? fmt(vazao * areaVoos, 1) : '')
  return {
    cabecalho: [
      [fazenda, codigo ? `(${codigo})` : ''].filter(Boolean).join(' '),
      rel ? (rel.localizacao || '') : (manual?.talhao || ''),
      rel ? dataBR(rel.dt_inicio || rel.created_at) : dataBR(manual?.data),
      rel ? (rel.piloto_nome || '') : (manual?.piloto || ''),
      d.auxiliar || '', d.tecnico_regional || '', d.supervisor || '', volume, recomendacao,
    ],
    voos,
    observacoes: [d.observacoes, ...voos.map((v, i) => v.obs ? `Voo ${String(i + 1).padStart(2, '0')}: ${v.obs}` : '')].filter(Boolean).join(' · '),
  }
}

// Divide em blocos de até `colunas` voos (o papel tem 10).
const colunasValidas = c => { const n = parseInt(c, 10); return n >= 4 && n <= 15 ? n : MONITORAMENTO_PADRAO.colunas }
function blocos(fichas, colunas) {
  const out = []
  fichas.forEach((f, i) => {
    const n = Math.max(1, Math.ceil(f.voos.length / colunas))
    for (let b = 0; b < n; b++) {
      out.push({ ...f, numero: i + 1, continuacao: b > 0, voos: f.voos.slice(b * colunas, (b + 1) * colunas), offset: b * colunas })
    }
  })
  return out
}

// ── PDF no layout da ficha ─────────────────────────────────────────────────────────
const PRETO = [17, 17, 17]
const TINTA = [20, 45, 110]

function marcaOrofly(doc, x, y) {
  doc.setTextColor(...PRETO); doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(24)
  doc.text('OROFLY', x, y + 9)
  // Drone: quatro hélices ligadas por um X, como no cabeçalho da ficha.
  const cx = x + 51, cy = y + 5.5, r = 2.6, d = 4.2
  doc.setDrawColor(...PRETO); doc.setLineWidth(0.6)
  doc.line(cx - d, cy - d, cx + d, cy + d); doc.line(cx - d, cy + d, cx + d, cy - d)
  ;[[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => doc.circle(cx + sx * d, cy + sy * d, r, 'S'))
  doc.setFillColor(...PRETO); doc.circle(cx, cy, 1.1, 'F')
}

export function gerarPdfFichas(fichas, { colunas } = {}) {
  const N = colunasValidas(colunas)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const M = 8, W = 297 - 2 * M
  const larg = [38, 20, 24, 30, 24, 30, 34, 39, 42]
  const colDet = 46, colVoo = (W - colDet) / N
  const R = { titulo: 5, rot: 4.6, val: 5.6, grade: 4.6, linha: 4.4, obs: 5.2 }
  const altBloco = R.titulo + R.rot + R.val + R.grade + R.linha * CAMPOS_VOO.length + R.obs
  const lista = blocos(fichas, N)

  const cabecalhoPagina = () => {
    marcaOrofly(doc, M, 6)
    doc.setTextColor(...PRETO); doc.setFont('helvetica', 'bold')
    doc.setFontSize(16); doc.text('MONITORAMENTO CLIMÁTICO', 105, 12)
    doc.setFontSize(12); doc.text('FICHA DE APLICAÇÃO — DRONE', 105, 18)
    doc.setLineWidth(0.6); doc.setDrawColor(...PRETO); doc.line(M, 22, M + W, 22)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('OROFLY', M, 205)
  }
  const celula = (x, y, w, h, texto, { negrito = false, tam = 6.5, cor = PRETO, centro = true } = {}) => {
    doc.setDrawColor(...PRETO); doc.setLineWidth(0.2); doc.rect(x, y, w, h)
    if (!temValor(texto)) return
    doc.setTextColor(...cor); doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam)
    let t = String(texto)
    while (t.length > 1 && doc.getTextWidth(t) > w - 1.6) t = t.slice(0, -1)
    if (t !== String(texto)) t = t.slice(0, -1) + '…'
    doc.text(t, centro ? x + w / 2 : x + 1.2, y + h * 0.68, { align: centro ? 'center' : 'left' })
  }

  lista.forEach((b, i) => {
    if (i % 3 === 0) { if (i) doc.addPage(); cabecalhoPagina() }
    let y = 25 + (i % 3) * (altBloco + 3.4)
    // Título da operação
    doc.setDrawColor(...PRETO); doc.setLineWidth(0.3); doc.rect(M, y, W, R.titulo)
    doc.setTextColor(...PRETO); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
    doc.text(`OPERAÇÃO ${String(b.numero).padStart(2, '0')}${b.continuacao ? ' (cont.)' : ''}`, M + 1.5, y + 3.7)
    y += R.titulo
    // Cabeçalho da operação
    let x = M
    CABECALHO.forEach((c, k) => { celula(x, y, larg[k], R.rot, c, { negrito: true, tam: 5.4, centro: false }); x += larg[k] })
    y += R.rot; x = M
    b.cabecalho.forEach((v, k) => { celula(x, y, larg[k], R.val, v, { tam: 7.2, cor: TINTA, centro: false }); x += larg[k] })
    y += R.val
    // Grade dos voos
    celula(M, y, colDet, R.grade, 'Detalhamento Operacional', { negrito: true, tam: 6 })
    for (let k = 0; k < N; k++) celula(M + colDet + k * colVoo, y, colVoo, R.grade, `Voo ${String(b.offset + k + 1).padStart(2, '0')}`, { negrito: true, tam: 6.5 })
    y += R.grade
    CAMPOS_VOO.forEach(([chave, rotulo]) => {
      celula(M, y, colDet, R.linha, rotulo, { negrito: true, tam: 5.6, centro: false })
      for (let k = 0; k < N; k++) celula(M + colDet + k * colVoo, y, colVoo, R.linha, b.voos[k]?.[chave] ?? '', { tam: 7, cor: TINTA })
      y += R.linha
    })
    celula(M, y, colDet, R.obs, 'Observações', { negrito: true, tam: 6 })
    celula(M + colDet, y, W - colDet, R.obs, b.continuacao ? '' : b.observacoes, { tam: 6.5, cor: TINTA, centro: false })
  })
  if (!lista.length) cabecalhoPagina()
  return doc
}

// ── Excel com a mesma grade ────────────────────────────────────────────────────────
export function planilhaFichasBlob(fichas, { colunas } = {}) {
  const N = colunasValidas(colunas)
  const linhas = [['MONITORAMENTO CLIMÁTICO — FICHA DE APLICAÇÃO — DRONE'], ['OROFLY'], []]
  const merges = []
  blocos(fichas, N).forEach(b => {
    linhas.push([`OPERAÇÃO ${String(b.numero).padStart(2, '0')}${b.continuacao ? ' (cont.)' : ''}`])
    linhas.push(CABECALHO)
    linhas.push(b.cabecalho)
    linhas.push(['Detalhamento Operacional', ...Array.from({ length: N }, (_, k) => `Voo ${String(b.offset + k + 1).padStart(2, '0')}`)])
    CAMPOS_VOO.forEach(([chave, rotulo]) => linhas.push([rotulo, ...Array.from({ length: N }, (_, k) => b.voos[k]?.[chave] ?? '')]))
    linhas.push(['Observações', b.continuacao ? '' : b.observacoes])
    merges.push({ s: { r: linhas.length - 1, c: 1 }, e: { r: linhas.length - 1, c: N } })
    linhas.push([])
  })
  const ws = XLSX.utils.aoa_to_sheet(linhas)
  ws['!cols'] = [34, 16, 14, 16, 14, 16, 18, 20, 20, 12, 12].map(w => ({ wch: w }))
  ws['!merges'] = merges
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Fichas')
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

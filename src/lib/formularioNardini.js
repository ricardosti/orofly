// Formulário da Usina Nardini — "Formulário de Aplicação Aérea — Via de Campo".
//
// É o papel que o piloto preenchia à mão no campo (Pastor, 15/10/2026: "igualzinho, escrito
// nardini acima"). Aqui ele sai preenchido com os dados do voo, no mesmo layout: identificação,
// talhões aplicados, resumo de área, produtos, condições e assinatura.
//
// Duas partes de propósito: `dadosFormularioNardini` só faz conta (dá pra conferir no Node com
// um voo real, como foi feito com o de 11/10 — 12,92 programados, 12,52 aplicados, VANTACOR
// 0,438 L) e `gerarFormularioNardini` só desenha.

import jsPDF from 'jspdf'
import { rateioPorTalhao, calcularGastoProdutos, areaLiquida, LOGO_B64, empresaAtual, desenharAssinatura } from './pdf'
import { formatarDose, formatarTotalProduto } from './calda'

export function ehClienteNardini(cliente) {
  return /nardini/i.test(cliente || '')
}

const num = (v, casas) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
const ha = v => num(v, 2)

// "Área não aplicada em 001 (0,20 ha): Obstáculo / Fiação" é o texto que o Passo 5 grava na
// Observação quando o motivo não é bordadura (com vários talhões leva o "em <talhão>"; com um só,
// não). Versões antigas gravavam "0.2" com ponto.
const RE_NAO_APLICADA = /^Área não aplicada(?: em (.+?))? \(([\d.,]+) ha\): (.+)$/

function motivosDaObservacao(texto) {
  const motivos = []
  const resto = []
  String(texto || '').split('\n').forEach(linha => {
    const m = linha.trim().match(RE_NAO_APLICADA)
    if (m) motivos.push({ talhao: m[1] ? m[1].trim() : null, qtd: parseFloat(m[2].replace(',', '.')) || 0, motivo: m[3].trim() })
    else if (linha.trim()) resto.push(linha.trim())
  })
  return { motivos, resto }
}

function dataLocal(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

// `talhoesCatalogo`: [{ nome, area_ha }] dos talhões da fazenda. `idFazenda`: o código da fazenda
// no cadastro (o "Código da fazenda" do formulário).
export function dadosFormularioNardini(rel, { talhoesCatalogo = [], idFazenda = '' } = {}) {
  const cadastro = {}
  talhoesCatalogo.forEach(t => { cadastro[t.nome] = parseFloat(t.area_ha) || 0 })
  const nomes = (rel.localizacao || '').split(',').map(s => s.trim()).filter(Boolean)
  const rateio = rateioPorTalhao(rel, cadastro)
  const obs = motivosDaObservacao(rel.obs1)
  const parcial = rel.status === 'pausado_dia'
  // Voo salvo a partir da v10.9 traz a área não aplicada por motivo num campo próprio (sempre
  // array, mesmo vazio). Aí ele vale, e as linhas "Área não aplicada…" da Observação são só
  // texto. Voo antigo (nulo): o motivo continua vindo do texto, como antes.
  const detalhe = Array.isArray(rel.nao_aplicada_detalhe) ? rel.nao_aplicada_detalhe : null
  const fechados = {}
  ;(rel.area_feita_detalhe || []).forEach(d => { if (typeof d?.fechado === 'boolean') fechados[d.talhao] = d.fechado })

  const talhoes = nomes.map(nome => {
    const parte = rateio[nome] || { area: 0, bordadura: 0 }
    const bord = +(parte.bordadura || 0).toFixed(2)
    // "Outro" (pedido do Pastor, 19/10/2026): a área sai do aplicado e entra na diferença,
    // como a bordadura, mas a observação do talhão fica em branco. Vale também pras linhas
    // "…: Outro" de voos antigos.
    const outros = (detalhe
      ? detalhe.filter(d => d.talhao === nome || (!d.talhao && nomes.length === 1))
          .map(d => ({ motivo: d.motivo, qtd: parseFloat(d.area) || 0 }))
      : obs.motivos.filter(m => m.talhao === nome || (!m.talhao && nomes.length === 1)))
      .map(m => m.motivo === 'Outro' ? { ...m, motivo: '' } : m)
    // Motivo que não é bordadura (obstáculo, vento…) o app guarda só como texto, e a área
    // continua dentro do aplicado no relatório normal. No formulário ela SAI do aplicado: é
    // a "Diferença" que a Nardini quer ver explicada, como o piloto fazia no papel.
    const qtdOutros = outros.reduce((a, m) => a + m.qtd, 0)
    const aplicada = Math.max(0, +(parte.area - qtdOutros).toFixed(2))
    // "Área do talhão" é o tamanho cadastrado. Sem cadastro, o que este voo percorreu.
    const areaTalhao = cadastro[nome] > 0 ? cadastro[nome] : +(parte.area + bord).toFixed(2)
    const diferenca = Math.max(0, +(areaTalhao - aplicada).toFixed(2))
    const motivos = []
    if (bord > 0.005) motivos.push({ motivo: 'Bordadura', qtd: bord })
    outros.forEach(m => motivos.push({ motivo: m.motivo, qtd: m.qtd }))
    const explicado = motivos.reduce((a, m) => a + m.qtd, 0)
    const sobra = +(diferenca - explicado).toFixed(2)
    if (sobra > 0.05 && (parcial || fechados[nome] === false)) motivos.push({ motivo: 'Restante fica para outro voo', qtd: sobra })
    const comTexto = motivos.filter(m => m.motivo)
    const observacao = comTexto.map(m => comTexto.length > 1 || m.qtd > 0 ? `${m.motivo} (${ha(m.qtd)} ha)` : m.motivo).join(' · ')
    return { nome, areaTalhao, aplicada, diferenca, observacao, motivos: comTexto.map(m => m.motivo) }
  })

  const soma = k => +talhoes.reduce((a, t) => a + t[k], 0).toFixed(2)
  const areaAplicadaTotal = talhoes.length ? soma('aplicada') : areaLiquida(rel)
  const programada = talhoes.length ? soma('areaTalhao') : (parseFloat(rel.area_ha) || 0)
  const diferenca = Math.max(0, +(programada - areaAplicadaTotal).toFixed(2))
  const motivoResumo = [...new Set(talhoes.flatMap(t => t.motivos))].join(', ')

  const produtos = calcularGastoProdutos(rel.produtos || [], areaAplicadaTotal)
    .filter(g => g.nome)
    .map(g => ({
      nome: g.nome,
      dose: g.dose != null ? formatarDose(g.dose) : '',
      qtd: g.total != null ? formatarTotalProduto(g.total) : '',
      total: g.total,
      unidade: (g.unidade || 'L').toUpperCase(),
    }))
  const totaisPorUnidade = {}
  produtos.forEach(p => { if (p.total != null) totaisPorUnidade[p.unidade] = (totaisPorUnidade[p.unidade] || 0) + p.total })

  const temp = rel.temperatura_i || rel.temperatura_f
  const vento = rel.vento_i || rel.vento_f
  const observacoes = [...obs.resto, ...String(rel.obs2 || '').split('\n').map(s => s.trim()).filter(Boolean)].join('\n')

  return {
    data: dataLocal(rel.dt_inicio || rel.created_at),
    codigoFazenda: idFazenda || '',
    fazenda: rel.fazenda || '',
    // "Nº da O.S. e Operação" é campo da Usina: sai em branco pra eles preencherem (pedido de
    // 20/10/2026). A OS do Orofly continua no rodapé ("Preenchido pelo Orofly… (OS …)").
    os: '',
    piloto: rel.piloto_nome || '',
    talhoes,
    totalTalhoes: { areaTalhao: programada, aplicada: areaAplicadaTotal, diferenca },
    resumo: { programada, aplicada: areaAplicadaTotal, diferenca, motivo: diferenca > 0.005 ? motivoResumo : '' },
    produtos,
    totaisProdutos: Object.entries(totaisPorUnidade).map(([u, v]) => `${formatarTotalProduto(v)} ${u}`).join(' · '),
    temperatura: temp != null && temp !== '' && !isNaN(parseFloat(temp)) ? num(parseFloat(temp), 1) : '',
    vento: vento != null && vento !== '' && !isNaN(parseFloat(vento)) ? num(parseFloat(vento), 1) : '',
    observacoes,
  }
}

// ── Desenho (A4 retrato, no layout do papel) ───────────────────────────────────────
const PRETO = [17, 17, 17]
const CINZA_BARRA = [64, 64, 64]
const CINZA_CAB = [228, 228, 228]
const TINTA = [20, 45, 110] // o "preenchido", em azul-escuro, como caneta no papel

export function gerarFormularioNardini(rel, opts = {}) {
  const d = dadosFormularioNardini(rel, opts)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 12, W = 210 - 2 * M
  let y = 12

  // Cabeçalho preto: marca à esquerda, título à direita
  doc.setFillColor(...PRETO); doc.rect(M, y, W, 12, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('N', M + 4, y + 8.6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.text('nardini', M + 10.5, y + 8.2)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5)
  doc.text('FORMULÁRIO DE APLICAÇÃO AÉREA — VIA DE CAMPO', M + W / 2 + 14, y + 7.8, { align: 'center' })
  y += 15

  const barra = (titulo) => {
    doc.setFillColor(...CINZA_BARRA); doc.rect(M, y, W, 6, 'F')
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
    doc.text(titulo, M + W / 2, y + 4.2, { align: 'center' })
    y += 6
  }
  const rotulo = (txt, x, yy) => { doc.setTextColor(...PRETO); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(txt, x, yy) }
  const preenchido = (txt, x, yy, maxW, alinhar = 'left') => {
    doc.setTextColor(...TINTA); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    let t = String(txt || '')
    while (maxW && t.length > 1 && doc.getTextWidth(t) > maxW) t = t.slice(0, -1)
    if (t !== String(txt || '')) t = t.slice(0, -1) + '…'
    doc.text(t, x, yy, { align: alinhar })
  }
  const linhaBase = (x1, x2, yy) => { doc.setDrawColor(...PRETO); doc.setLineWidth(0.2); doc.line(x1, yy, x2, yy) }

  // ── IDENTIFICAÇÃO
  barra('IDENTIFICAÇÃO')
  y += 6
  rotulo('Data da aplicação:', M, y); linhaBase(M + 30, M + 110, y + 1); preenchido(d.data, M + 32, y, 76)
  rotulo('Código da fazenda:', M + 116, y); linhaBase(M + 146, M + W, y + 1); preenchido(d.codigoFazenda, M + 148, y, 40)
  y += 7
  rotulo('Fazenda / Sítio:', M, y); linhaBase(M + 30, M + W, y + 1); preenchido(d.fazenda, M + 32, y, W - 34)
  y += 7
  rotulo('Nº da O.S. e Operação:', M, y); linhaBase(M + 37, M + 110, y + 1); preenchido(d.os, M + 39, y, 69)
  rotulo('Piloto Responsável:', M + 116, y); linhaBase(M + 146, M + W, y + 1); preenchido(d.piloto, M + 148, y, 40)
  y += 5

  // Tabela genérica: colunas [{ titulo, w, alinhar }], linhas de strings
  const tabela = (cols, linhas, { minLinhas = 0, alturaLinha = 6, total = null } = {}) => {
    const xs = []; let x = M
    cols.forEach(c => { xs.push(x); x += c.w })
    doc.setDrawColor(...PRETO); doc.setLineWidth(0.25)
    // cabeçalho
    doc.setFillColor(...CINZA_CAB); doc.rect(M, y, W, 6, 'FD')
    doc.setTextColor(...PRETO); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    cols.forEach((c, i) => { doc.text(c.titulo, xs[i] + c.w / 2, y + 4.1, { align: 'center' }); if (i) doc.line(xs[i], y, xs[i], y + 6) })
    y += 6
    const n = Math.max(minLinhas, linhas.length)
    for (let r = 0; r < n; r++) {
      doc.rect(M, y, W, alturaLinha)
      cols.forEach((c, i) => {
        if (i) doc.line(xs[i], y, xs[i], y + alturaLinha)
        const v = linhas[r]?.[i]
        if (v != null && v !== '') {
          const xT = c.alinhar === 'center' ? xs[i] + c.w / 2 : xs[i] + 2
          preenchido(v, xT, y + alturaLinha * 0.7, c.w - 4, c.alinhar === 'center' ? 'center' : 'left')
        }
      })
      y += alturaLinha
    }
    if (total) {
      doc.rect(M, y, W, alturaLinha)
      cols.forEach((c, i) => {
        if (i) doc.line(xs[i], y, xs[i], y + alturaLinha)
        const v = total[i]
        if (i === 0) { doc.setTextColor(...PRETO); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('TOTAL', xs[0] + c.w / 2, y + alturaLinha * 0.7, { align: 'center' }) }
        else if (v) preenchido(v, c.alinhar === 'center' ? xs[i] + c.w / 2 : xs[i] + 2, y + alturaLinha * 0.7, c.w - 4, c.alinhar === 'center' ? 'center' : 'left')
      })
      y += alturaLinha
    }
  }

  // ── TALHÕES APLICADOS (8 linhas como no papel; mais talhões, linhas mais baixas)
  y += 3
  barra('TALHÕES APLICADOS')
  const nT = Math.max(8, d.talhoes.length)
  tabela([
    { titulo: 'Talhão', w: 30, alinhar: 'center' },
    { titulo: 'Área do talhão (ha)', w: 24, alinhar: 'center' },
    { titulo: 'Área aplicada (ha)', w: 24, alinhar: 'center' },
    { titulo: 'Diferença (ha)', w: 24, alinhar: 'center' },
    { titulo: 'Observação do talhão', w: W - 102 },
  ], d.talhoes.map(t => [t.nome, ha(t.areaTalhao), ha(t.aplicada), t.diferenca > 0.005 ? ha(t.diferenca) : '', t.observacao]), {
    minLinhas: 8, alturaLinha: nT > 8 ? Math.max(4.2, 48 / nT) : 6,
    total: ['TOTAL', ha(d.totalTalhoes.areaTalhao), ha(d.totalTalhoes.aplicada), d.totalTalhoes.diferenca > 0.005 ? ha(d.totalTalhoes.diferenca) : '', ''],
  })

  // ── RESUMO DE ÁREA
  y += 3
  barra('RESUMO DE ÁREA')
  const w4 = W / 4
  tabela([
    { titulo: 'Área total programada (ha)', w: w4, alinhar: 'center' },
    { titulo: 'Área total aplicada (ha)', w: w4, alinhar: 'center' },
    { titulo: 'Diferença de área (ha)', w: w4, alinhar: 'center' },
    { titulo: 'Motivo da diferença', w: w4, alinhar: 'center' },
  ], [[ha(d.resumo.programada), ha(d.resumo.aplicada), d.resumo.diferenca > 0.005 ? ha(d.resumo.diferenca) : '0,00', d.resumo.motivo]])

  // ── PRODUTOS UTILIZADOS
  y += 3
  barra('PRODUTOS UTILIZADOS')
  tabela([
    { titulo: 'Produto', w: 58 },
    { titulo: 'Dose / ha', w: 50, alinhar: 'center' },
    { titulo: 'Qtd. utilizada', w: 52, alinhar: 'center' },
    { titulo: 'Unidade', w: W - 160, alinhar: 'center' },
  ], d.produtos.map(p => [p.nome, p.dose, p.qtd, p.unidade]), {
    minLinhas: 6, total: ['TOTAL', '', d.totaisProdutos, ''],
  })

  // ── CONDIÇÕES OPERACIONAIS
  y += 3
  barra('CONDIÇÕES OPERACIONAIS')
  y += 6
  rotulo('Temperatura (°C):', M, y); linhaBase(M + 50, M + 100, y + 1); preenchido(d.temperatura, M + 75, y, 46, 'center')
  rotulo('Vento (km/h):', M + 116, y); linhaBase(M + 150, M + W, y + 1); preenchido(d.vento, M + 167, y, 30, 'center')
  y += 5

  // ── OBSERVAÇÕES
  y += 2
  barra('OBSERVAÇÕES')
  const altObs = 24
  doc.setDrawColor(...PRETO); doc.setLineWidth(0.25); doc.rect(M, y, W, altObs)
  // Empresa executora já impressa no canto do quadro: logo + nome (pedido do Rodolfo,
  // 20/10/2026). O texto das observações fica à esquerda, sem invadir.
  const larguraEmpresa = 52
  const emp = empresaAtual() || {}
  const xEmp = M + W - larguraEmpresa
  doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.2); doc.line(xEmp, y + 2, xEmp, y + altObs - 2)
  try { doc.addImage(LOGO_B64, 'PNG', xEmp + (larguraEmpresa - 24) / 2, y + 2, 24, 13.5) } catch (e) { /* sem logo: fica só o nome */ }
  doc.setTextColor(...PRETO); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
  doc.text(String(emp.razao_social || emp.nome || 'Orofly').toUpperCase(), xEmp + larguraEmpresa / 2, y + 18.5, { align: 'center', maxWidth: larguraEmpresa - 4 })
  const linhaCad = [emp.cnpj ? `CNPJ ${emp.cnpj}` : null, emp.telefone || null].filter(Boolean).join(' · ')
  if (linhaCad) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(90, 90, 90); doc.text(linhaCad, xEmp + larguraEmpresa / 2, y + 21.8, { align: 'center', maxWidth: larguraEmpresa - 4 }) }
  if (d.observacoes) {
    doc.setTextColor(...TINTA); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    const linhas = doc.splitTextToSize(d.observacoes, W - larguraEmpresa - 6).slice(0, 5)
    doc.text(linhas, M + 3, y + 5)
  }
  y += altObs

  // ── PILOTO
  barra('PILOTO')
  const altAss = 20
  doc.rect(M, y, W, altAss)
  rotulo('Assinatura:', M + 10, y + 12)
  // Assinatura do piloto (Meu Perfil), quando cadastrada — quem chama passa em opts.assinatura.
  desenharAssinatura(doc, opts.assinatura, M + 75, y + 12, 80, 10)
  linhaBase(M + 30, M + 120, y + 12.5)
  doc.setTextColor(...TINTA); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text(d.piloto, M + 75, y + 16.5, { align: 'center' })
  y += altAss

  // Rodapé discreto — de onde saiu o formulário
  doc.setTextColor(140, 140, 140); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
  doc.text(`Preenchido pelo Orofly a partir do relatório do voo${rel.ordem_servico ? ` (OS ${String(rel.ordem_servico).toUpperCase()})` : ''}.`, M, 290)

  return doc
}

export function nomeArquivoFormularioNardini(rel) {
  const fz = (rel.fazenda || 'fazenda').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase()
  const data = dataLocal(rel.dt_inicio || rel.created_at).replace(/\//g, '-')
  return `formulario-nardini-${fz}-${data}.pdf`
}

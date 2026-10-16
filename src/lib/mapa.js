// Relatório mensal de operações para o MAPA (menu Regulamentação do painel).
//
// Reproduz a planilha que o MAPA usa ("OPERAÇÕES NO MÊS"): uma aba por mês, com a razão social e
// o registro MAPA no topo e uma linha por operação. As listas abaixo (classes, culturas, tipos de
// serviço, unidades) foram copiadas da planilha oficial enviada pelo Ricardo em 15/10/2026, pra
// que o arquivo exportado use exatamente os mesmos termos dos menus dela.
//
// Uma linha por PRODUTO de cada voo — a planilha só tem uma coluna de dose. Num voo com calda de
// vários produtos, a ÁREA e as HORAS vão só na primeira linha dele: a planilha soma as duas colunas
// no topo, e repetir a área em cada produto multiplicaria o total declarado.

import * as XLSX from 'xlsx'
import { areaLiquida, parseDoseProduto } from './pdf'

export const TIPOS_PRODUTO_MAPA = [
  { v: 'agrotoxico', l: 'Agrotóxico', servico: 'APLICAÇÃO DE AGROTÓXICO' },
  { v: 'bioinsumo', l: 'Bioinsumo', servico: 'APLICAÇÃO DE BIOINSUMO' },
  { v: 'fertilizante', l: 'Fertilizante', servico: 'APLICAÇÃO DE FERTILIZANTE' },
  { v: 'adjuvante', l: 'Adjuvante', servico: 'APLICAÇÃO ADJUVANTE' },
  { v: 'outros', l: 'Outros', servico: 'OUTROS' },
]

const sublinhado = s => s.replace(/_/g, ' ')
export const CLASSES_AGROTOXICO = ['Acaricida', 'Acaricida_Bactericida_Fungicida', 'Acaricida_Formicida_Inseticida', 'Acaricida_Fungicida',
  'Acaricida_Fungicida_Inseticida', 'Acaricida_Inseticida', 'Acaricida_Inseticida_Nematicida', 'Ativador_de_planta', 'Bactericida_Fungicida',
  'Cupinicida_Formicida_Inseticida', 'Cupinicida_Inseticida', 'Feromônio', 'Feromônio_Inseticida', 'Formicida',
  'Formicida_Fungicida_Herbicida_Inseticida_Nematicida', 'Formicida_Fungicida_Herbicida_Nematicida', 'Formicida_Inseticida', 'Fungicida',
  'Fungicida_Herbicida_Nematicida', 'Fungicida_Inseticida', 'Fungicida_Inseticida_Nematicida', 'Fungicida_e_Nematicida', 'Herbicida',
  'Herbicida_e_Regulador_de_Crescimento', 'Inseticida', 'Inseticida_Fumigante', 'Inseticida_Nematicida', 'Inseticida_e_Regulador_de_Crescimento',
  'Moluscicida', 'Nematicida', 'Protetor_de_Sementes', 'Regulador_de_Crescimento'].map(sublinhado)
export const CLASSES_BIOINSUMO = ['Acaricida_Microbiológico', 'Acaricida_Microbiológico_e_Inseticida_Microbiológico', 'Agente_Biológico_de_Controle',
  'Ativador_de_planta_e_Nematicida_microbiológico', 'Bactericida_Microbiológico_e_Fungicida_Microbiológico', 'Feromônio',
  'Fungicida_Microbiológico', 'Fungicida_Microbiológico_e_Inseticida_Microbiológico', 'Fungicida_Microbiológico_e_Nematicida',
  'Fungicida_Microbiológico_e_Nematicida_Microbiológico', 'Fungicida_e_Nematicida_Microbiológico', 'Inseticida_Microbiológico',
  'Nematicida_Microbiológico', 'Bioinsumos_para_uso_próprio'].map(sublinhado)
export const CULTURAS_MAPA = ['ALGODÃO', 'AMENDOIM', 'ARROZ', 'ARRUDA', 'AVEIA', 'AZEVÉM', 'BANANA', 'BATATA', 'CACAU', 'CAFÉ', 'CANA-DE-AÇÚCAR',
  'CITRUS', 'COCO', 'EUCALIPTO', 'FEIJÃO', 'FORRAGEIRAS', 'GIRASSOL', 'LARANJA', 'MACADÂMIA', 'MANDIOCA', 'MILHETO', 'MILHO', 'NABO', 'OUTRAS',
  'PASTAGENS', 'PINUS', 'SERINGUEIRA', 'SOJA', 'SORGO GRANÍFERO', 'TRIGO']

export const COLUNAS_MAPA = ['UF', 'MUNICÍPIO', 'TIPO AERONAVE', 'PREFIXO AERONAVE', 'HORAS APLICAÇÃO', 'CULTURA', 'TIPO DE SERVIÇO',
  'CLASSE AGROTÓXICOS', 'CLASSE BIOINSUMO', 'ÁREA (ha)', 'AGROTÓXICO', 'BIOINSUMO', 'FERTILIZANTES/ADJUVANTES/OUTROS', 'SEMEADURA',
  'COMBATE A INCÊNDIO (HORAS)', 'VOLUME (l/ha)', 'DOSAGEM', 'Unidade']
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const ABAS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

const semAcento = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
// Nome da cultura no app → termo da lista do MAPA. O que não casar vira "OUTRAS".
const APELIDOS_CULTURA = { CITROS: 'CITRUS', PASTAGEM: 'PASTAGENS', SORGO: 'SORGO GRANÍFERO', 'CANA DE ACUCAR': 'CANA-DE-AÇÚCAR', CANA: 'CANA-DE-AÇÚCAR' }
export function culturaMapa(cultura) {
  const c = semAcento(cultura)
  if (!c) return ''
  const exata = CULTURAS_MAPA.find(x => semAcento(x) === c)
  if (exata) return exata
  const apelido = APELIDOS_CULTURA[c.replace(/-/g, ' ')]
  return apelido || 'OUTRAS'
}

export function unidadeMapa(unidade) {
  const u = (unidade || 'L').toLowerCase()
  if (u === 'l') return 'L/ha'
  if (u === 'kg') return 'kg/ha'
  if (u === 'g') return 'g/ha'
  if (u === 'ml') return 'ml/ha'
  return `${unidade}/ha`
}

// Minutos de aplicação do voo: início ao fim, sem as pausas.
export function minutosAplicacao(rel) {
  if (!rel.dt_inicio || !rel.dt_fim) return 0
  const t = Math.round((new Date(rel.dt_fim) - new Date(rel.dt_inicio)) / 60000)
  if (t <= 0) return 0
  let p = 0
  ;(rel.pausas || []).forEach(pa => { if (pa?.inicio && pa?.fim) p += Math.max(0, Math.round((new Date(pa.fim) - new Date(pa.inicio)) / 60000)) })
  return Math.max(0, t - p)
}
// A planilha guarda horas como número HHMM (1h45 = 145) e separa com INT(x/100) e RIGHT(x,2).
export const hhmm = min => Math.floor(min / 60) * 100 + (min % 60)
export const fmtHoras = min => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

// Monta as linhas do mês. `relatorios` já filtrados pelo período; `municipioDe(rel)` devolve
// { municipio, uf } (o painel resolve pelo cadastro da fazenda ou pelo GPS).
export function linhasMapa(relatorios, { produtos = [], drones = [], municipioDe = () => ({}) } = {}) {
  const prodPorNome = {}
  produtos.forEach(p => { prodPorNome[norm(p.nome)] = p })
  const dronePorNome = {}
  drones.forEach(d => { dronePorNome[norm(d.nome)] = d })
  const linhas = []
  const pendencias = { dronesSemPrefixo: new Set(), produtosSemTipo: new Set(), semMunicipio: new Set(), horasSuspeitas: new Set() }

  relatorios.forEach(rel => {
    const drone = dronePorNome[norm(rel.drone)]
    const tipoAeronave = drone ? [drone.fabricante, drone.modelo].filter(Boolean).join(' ') || drone.nome : (rel.drone || '')
    const prefixo = drone?.prefixo || ''
    if (!prefixo) pendencias.dronesSemPrefixo.add(rel.drone || '(sem drone)')
    const { municipio = '', uf = '' } = municipioDe(rel) || {}
    if (!municipio || !uf) pendencias.semMunicipio.add(`${rel.cliente || ''} — ${rel.fazenda || ''}`)
    const minutos = minutosAplicacao(rel)
    // As horas saem do início/fim que o piloto marcou no app. Voo "aberto" por mais de 12 h é
    // quase sempre esquecimento de finalizar (houve um de 10/10 21h a 12/10 17h) — aparece
    // como pendência pra corrigir o horário antes de mandar ao MAPA.
    if (minutos > 12 * 60) {
      const dia = rel.dt_inicio ? new Date(rel.dt_inicio).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''
      pendencias.horasSuspeitas.add(`${dia} ${rel.fazenda || ''} (${fmtHoras(minutos)})`)
    }
    const area = areaLiquida(rel)
    const volume = rel.vazao_i || rel.vazao_f || ''
    const base = {
      relId: rel.id, data: rel.dt_inicio, cliente: rel.cliente, fazenda: rel.fazenda, piloto: rel.piloto_nome,
      uf, municipio, tipoAeronave, prefixo, cultura: culturaMapa(rel.cultura), volume,
    }
    const itens = (rel.produtos || []).filter(Boolean).map(parseDoseProduto).filter(p => p.nome)
    if (!itens.length) itens.push({ nome: '', dose: null, unidade: '' })
    itens.forEach((it, i) => {
      const cad = prodPorNome[norm(it.nome)]
      const tipo = cad?.tipo_mapa || ''
      if (it.nome && !tipo) pendencias.produtosSemTipo.add(it.nome)
      const servico = TIPOS_PRODUTO_MAPA.find(t => t.v === tipo)?.servico || ''
      linhas.push({
        ...base,
        primeira: i === 0,
        minutos: i === 0 ? minutos : 0,
        horas: i === 0 && minutos ? hhmm(minutos) : '',
        area: i === 0 ? area : '',
        tipoServico: servico,
        classeAgro: tipo === 'agrotoxico' ? (cad?.classe_mapa || '') : '',
        classeBio: tipo === 'bioinsumo' ? (cad?.classe_mapa || '') : '',
        agrotoxico: tipo === 'agrotoxico' ? it.nome : '',
        bioinsumo: tipo === 'bioinsumo' ? it.nome : '',
        outros: ['fertilizante', 'adjuvante', 'outros', ''].includes(tipo) ? it.nome : '',
        dosagem: it.dose != null ? it.dose : '',
        unidade: it.nome ? unidadeMapa(it.unidade) : '',
      })
    })
  })
  const totais = {
    operacoes: relatorios.length,
    minutos: linhas.reduce((a, l) => a + l.minutos, 0),
    area: +linhas.reduce((a, l) => a + (Number(l.area) || 0), 0).toFixed(2),
  }
  return {
    linhas, totais,
    pendencias: {
      dronesSemPrefixo: [...pendencias.dronesSemPrefixo],
      produtosSemTipo: [...pendencias.produtosSemTipo],
      semMunicipio: [...pendencias.semMunicipio],
      horasSuspeitas: [...pendencias.horasSuspeitas],
    },
  }
}

// Uma aba no layout da planilha do MAPA.
function abaMapa(linhas, totais, { mes, empresa = {} }) {
  const cab = [
    ['Razão Social: ', '', empresa.razao_social || empresa.nome || '', '', '', '', '', 'E-mail: ', '', '', MESES[mes]],
    ['', '', '', '', '', '', '', empresa.email || ''],
    ['Registro MAPA:', '', empresa.registro_mapa || '', '', '', '', '', `Celular: ${empresa.telefone || ''}`, '', '', 'NOME COMERCIAL', '', '',
      'Total horas trabalhadas', fmtHoras(totais.minutos), 'Total área aplicada (ha)', totais.area, 'Total horas combate incêndio', 0],
    [linhas.length ? 'OPERAÇÕES NO MÊS ' : 'NENHUMA ATIVIDADE REALIZADA', '', '', '', '', '', '', '', '', '', empresa.nome || ''],
    COLUNAS_MAPA,
  ]
  const corpo = linhas.map(l => [l.uf, l.municipio, l.tipoAeronave, l.prefixo, l.horas, l.cultura, l.tipoServico, l.classeAgro, l.classeBio,
    l.area === '' ? '' : Number(l.area), l.agrotoxico, l.bioinsumo, l.outros, '', '', l.volume === '' ? '' : Number(String(l.volume).replace(',', '.')) || l.volume,
    l.dosagem, l.unidade])
  const ws = XLSX.utils.aoa_to_sheet([...cab, ...corpo])
  ws['!cols'] = [6, 22, 18, 16, 10, 18, 26, 22, 26, 10, 22, 22, 26, 11, 13, 11, 10, 9].map(w => ({ wch: w }))
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }, { s: { r: 0, c: 2 }, e: { r: 1, c: 6 } }, { s: { r: 3, c: 0 }, e: { r: 3, c: 9 } }]
  return ws
}

// `porMes`: { [mes 0-11]: { linhas, totais } }. Monta só os meses passados (um, ou o ano todo) e
// devolve o .xlsx como Blob — quem chama salva pelo salvarOuCompartilharBlob, que também funciona
// dentro do app Android.
export function planilhaMapaBlob(porMes, { empresa }) {
  const wb = XLSX.utils.book_new()
  Object.keys(porMes).map(Number).sort((a, b) => a - b).forEach(m => {
    const { linhas, totais } = porMes[m]
    XLSX.utils.book_append_sheet(wb, abaMapa(linhas, totais, { mes: m, empresa }), ABAS[m])
  })
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

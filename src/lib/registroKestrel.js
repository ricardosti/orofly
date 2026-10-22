// Kestrel (medidor de mão, ex.: 3550AG) exportada pelo app Kestrel LiNK em CSV: linhas do
// aparelho (Device Name, Device Model, Serial Number), o cabeçalho, uma linha de unidades e as
// medições (de 2 em 2 s numa sessão). Na ficha do Monitoramento Climático cada coluna (bateria
// do drone ou leitura) passa a ter a média do que a Kestrel mediu no talhão naquele horário, no
// lugar do clima do serviço pela internet (Ricardo, 22/10/2026).
//
// O horário do arquivo é o do relógio da Kestrel, lido como horário de Brasília (-03:00).

const chave = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const numero = v => parseFloat(String(v ?? '').trim().replace(',', '.'))
const pt = (v, casas) => isNaN(v) ? '' : v.toLocaleString('pt-BR', { maximumFractionDigits: casas })
const hhmm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : NaN }

// CSV com campo entre aspas (o "Record name" tem vírgula dentro). Separador ; quando o cabeçalho
// vier assim (Excel em português).
function linhasCsv(texto) {
  const primeira = texto.split(/\r?\n/).find(l => /formatted.?date.?time/i.test(l)) || ''
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';' : ','
  const out = []
  let linha = [], campo = '', aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++ } else aspas = false }
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === sep) { linha.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo); out.push(linha); linha = []; campo = ''
    } else campo += c
  }
  if (campo !== '' || linha.length) { linha.push(campo); out.push(linha) }
  return out
}

// Data no formato que a própria Kestrel declara na linha de unidades (ex.: "yyyy-MM-dd hh:mm:ss a").
function leitorDeData(formato) {
  const ordem = []
  const re = new RegExp('^' + String(formato || 'yyyy-MM-dd hh:mm:ss a').trim()
    .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    .replace(/yyyy|MM|dd|HH|hh|mm|ss|a/g, t => { ordem.push(t); return t === 'yyyy' ? '(\\d{4})' : t === 'a' ? '([AaPp][Mm])' : '(\\d{1,2})' }) + '$')
  return texto => {
    const m = re.exec(String(texto || '').trim())
    if (!m) return NaN
    const v = {}
    ordem.forEach((t, i) => { v[t] = m[i + 1] })
    let h = +(v.HH ?? v.hh ?? 0)
    if (v.a) { const pm = /p/i.test(v.a); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12 }
    const dois = n => String(n).padStart(2, '0')
    return Date.parse(`${v.yyyy}-${dois(v.MM)}-${dois(v.dd)}T${dois(h)}:${dois(v.mm ?? 0)}:${dois(v.ss ?? 0)}-03:00`)
  }
}

const VENTO_KMH = { kmh: 1, ms: 3.6, mph: 1.609344, kt: 1.852, kts: 1.852, knots: 1.852, fpm: 0.018288, ftmin: 0.018288 }

// { aparelho: { nome, modelo, serie }, medicoes: [{ ms, temperatura, umidade, vento, deltaT }] }
// em ordem de horário; null quando o arquivo não é exportação da Kestrel.
export function lerRegistroKestrel(texto) {
  const linhas = linhasCsv(String(texto || '').replace(/^﻿/, ''))
  const iCab = linhas.findIndex(l => chave(l[0]) === 'formatteddatetime')
  if (iCab < 0) return null
  const info = k => (linhas.slice(0, iCab).find(l => chave(l[0]) === k) || [])[1] || ''
  const cab = linhas[iCab].map(chave)
  const col = k => cab.indexOf(k)
  const c = { temperatura: col('temperature'), umidade: col('relativehumidity'), vento: col('windspeed'), deltaT: col('deltat') }
  // Linha de unidades logo abaixo do cabeçalho: formato da data e unidade de cada coluna.
  const unid = linhas[iCab + 1] && /y{2,4}/i.test(linhas[iCab + 1][0] || '') ? linhas[iCab + 1] : null
  const lerData = leitorDeData(unid ? unid[0] : null)
  const fahrenheit = unid && /f/i.test(unid[c.temperatura] || '')
  const fatorVento = unid ? (VENTO_KMH[chave(unid[c.vento])] ?? (chave(unid[c.vento]) ? NaN : 1)) : 1
  const medicoes = []
  for (const l of linhas.slice(iCab + (unid ? 2 : 1))) {
    const ms = lerData(l[0])
    if (isNaN(ms)) continue
    let t = c.temperatura >= 0 ? numero(l[c.temperatura]) : NaN
    if (fahrenheit) t = (t - 32) * 5 / 9
    medicoes.push({
      ms, temperatura: t,
      umidade: c.umidade >= 0 ? numero(l[c.umidade]) : NaN,
      vento: c.vento >= 0 ? numero(l[c.vento]) * fatorVento : NaN,
      deltaT: c.deltaT >= 0 ? numero(l[c.deltaT]) : NaN,
    })
  }
  return { aparelho: { nome: info('devicename'), modelo: info('devicemodel'), serie: info('serialnumber') }, medicoes: medicoes.sort((a, b) => a.ms - b.ms) }
}

// O horário de cada coluna da ficha: o fim é o registrado_em (bateria ou leitura); o início sai
// da diferença entre "início" e "fim" (HH:MM). Coluna digitada à mão usa a data do voo.
function janelaDaColuna(v, dataVoo) {
  let fim = Date.parse(v.registrado_em)
  if (isNaN(fim) && dataVoo && !isNaN(hhmm(v.fim))) fim = Date.parse(`${dataVoo}T${String(v.fim).padStart(5, '0')}:00-03:00`)
  if (isNaN(fim)) return null
  let dur = hhmm(v.fim) - hhmm(v.inicio)
  if (isNaN(dur)) dur = 0
  if (dur < 0) dur += 24 * 60
  return { ini: fim - dur * 60000, fim }
}

const media = (lista, k) => {
  const vs = lista.map(m => m[k]).filter(x => !isNaN(x))
  return vs.length ? vs.reduce((a, x) => a + x, 0) / vs.length : NaN
}

// Cada coluna com a média do que a Kestrel mediu no horário dela; sem medição dentro, a mais
// perto até 10 min. Fora do que a Kestrel gravou, a coluna fica como estava.
export function climaDaKestrel(colunas = [], medicoes = [], dataVoo = '') {
  let usadas = 0
  const lista = colunas.map(v => {
    const j = janelaDaColuna(v, dataVoo)
    if (!j) return v
    let dentro = medicoes.filter(m => m.ms >= j.ini && m.ms <= j.fim)
    if (!dentro.length) {
      const meio = (j.ini + j.fim) / 2
      let perto = null
      for (const m of medicoes) if (!perto || Math.abs(m.ms - meio) < Math.abs(perto.ms - meio)) perto = m
      if (perto && Math.abs(perto.ms - meio) <= 10 * 60000) dentro = [perto]
    }
    if (!dentro.length) return v
    usadas++
    const t = media(dentro, 'temperatura'), u = media(dentro, 'umidade'), w = media(dentro, 'vento'), d = media(dentro, 'deltaT')
    return { ...v, temperatura: pt(t, 1) || v.temperatura, umidade: pt(u, 0) || v.umidade, vento: pt(w, 1) || v.vento,
      delta_t: pt(d, 1), clima_origem: 'kestrel',
      // O que estava antes (leitura automática ou serviço de clima), pra "Tirar Kestrel" voltar.
      clima_original: v.clima_original || { temperatura: v.temperatura || '', umidade: v.umidade || '', vento: v.vento || '' } }
  })
  return { colunas: lista, usadas }
}

// Desfaz a Kestrel: cada coluna volta ao clima que tinha antes dela.
export function semKestrel(colunas = []) {
  return colunas.map(v => {
    if (v.clima_origem !== 'kestrel') return v
    const { clima_original: o = {}, clima_origem, delta_t, ...resto } = v
    return { ...resto, temperatura: o.temperatura || '', umidade: o.umidade || '', vento: o.vento || '' }
  })
}

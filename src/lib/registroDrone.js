// Registro de voo da DJI (aba "flight record", exportada do SmartFarm / app do controle): uma
// linha por bateria, com início e fim, área pulverizada (ha), litros, altura e o talhão do drone
// (Plot ID). Na ficha do Monitoramento Climático cada bateria vira um "Voo", com o clima da
// leitura automática mais perto do horário dela (Rodolfo, 22/10/2026: "esse campo é o que falta").
//
// O horário da planilha é o local (conferido com o voo 005-01 da Morada do Sol de 20/10/2026:
// baterias das 09:25 às 11:20 e das 14:57 às 19:45, voo aberto às 09:03 com pausa das 11:32 às
// 14:59). Lido como horário de Brasília (-03:00; sem horário de verão desde 2019).
import * as XLSX from 'xlsx'

const chave = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
// Cabeçalhos da exportação em inglês (a DJI escreve "Pliot Name").
const COLUNAS = {
  horario: ['flighttime'],
  area: ['sprayedarea'],
  litros: ['totalamountlkg', 'totalamount'],
  altura: ['height'],
  aeronave: ['aircraftname'],
  piloto: ['pliotname', 'pilotname'],
  talhao: ['plotid'],
}
const numero = v => parseFloat(String(v ?? '').replace(',', '.'))
const pt = (v, casas) => isNaN(v) ? '' : v.toLocaleString('pt-BR', { maximumFractionDigits: casas })
const horaBR = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

// Baterias da planilha, em ordem de horário; null quando o arquivo não é o registro de voo da DJI.
export function lerRegistroDrone(dados) {
  const wb = XLSX.read(dados, { type: 'array' })
  for (const aba of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: '' })
    const iCab = linhas.findIndex(l => l.some(c => chave(c) === 'flighttime') && l.some(c => chave(c) === 'sprayedarea'))
    if (iCab < 0) continue
    const cab = linhas[iCab].map(chave)
    const col = Object.fromEntries(Object.entries(COLUNAS).map(([k, nomes]) => [k, cab.findIndex(c => nomes.includes(c))]))
    const texto = (l, k) => col[k] >= 0 ? String(l[col[k]] ?? '').trim() : ''
    const baterias = []
    for (const l of linhas.slice(iCab + 1)) {
      // "2026-10-20 19:38:28-19:45:51"
      const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)/.exec(texto(l, 'horario'))
      if (!m) continue
      const ms = h => { const [hh, mm, ss = '00'] = h.split(':'); return Date.parse(`${m[1]}T${hh.padStart(2, '0')}:${mm}:${ss}-03:00`) }
      const iniMs = ms(m[2])
      let fimMs = ms(m[3])
      if (isNaN(iniMs) || isNaN(fimMs)) continue
      if (fimMs < iniMs) fimMs += 86400000 // passou da meia-noite
      baterias.push({
        iniMs, fimMs,
        area: col.area >= 0 ? numero(l[col.area]) : NaN,
        litros: col.litros >= 0 ? numero(l[col.litros]) : NaN,
        altura: col.altura >= 0 ? numero(l[col.altura]) : NaN,
        aeronave: texto(l, 'aeronave'), piloto: texto(l, 'piloto'), talhao: texto(l, 'talhao'),
      })
    }
    if (baterias.length) return baterias.sort((a, b) => a.iniMs - b.iniMs)
  }
  return null
}

// As baterias que cabem no voo: no horário dele, com folga — o piloto às vezes abre o voo no app
// depois de já ter decolado (no de 20/10 a primeira bateria foi 30 min antes).
export function bateriasDoVoo(baterias, rel, folgaMin = 120) {
  const ini = Date.parse(rel.dt_inicio || rel.created_at)
  const fim = rel.dt_fim ? Date.parse(rel.dt_fim) : Date.now()
  if (isNaN(ini)) return []
  const f = folgaMin * 60000
  return baterias.filter(b => b.iniMs >= ini - f && b.fimMs <= fim + f)
}

// Agrupadas pelo talhão do drone (Plot ID): no mesmo dia o arquivo pode trazer outro talhão.
export function gruposPorTalhao(baterias) {
  const grupos = {}
  for (const b of baterias) {
    const g = grupos[b.talhao] || (grupos[b.talhao] = { talhao: b.talhao, baterias: [], area: 0, iniMs: b.iniMs, fimMs: b.fimMs })
    g.baterias.push(b)
    g.area += isNaN(b.area) ? 0 : b.area
    g.iniMs = Math.min(g.iniMs, b.iniMs); g.fimMs = Math.max(g.fimMs, b.fimMs)
  }
  return Object.values(grupos).sort((a, b) => a.iniMs - b.iniMs)
}

// Cada bateria no formato de um voo da ficha, com o clima da leitura (automática ou capturada)
// mais perto do meio dela — até 30 min de distância; mais longe, fica em branco.
export function bateriasParaFicha(baterias, leituras = []) {
  const comHora = leituras.map(v => ({ v, ms: Date.parse(v?.registrado_em) })).filter(x => !isNaN(x.ms))
  return baterias.map(b => {
    const meio = (b.iniMs + b.fimMs) / 2
    let perto = null
    for (const x of comHora) if (!perto || Math.abs(x.ms - meio) < Math.abs(perto.ms - meio)) perto = x
    const clima = perto && Math.abs(perto.ms - meio) <= 30 * 60000 ? perto.v : {}
    return {
      inicio: horaBR(b.iniMs), fim: horaBR(b.fimMs), altura: pt(b.altura, 1), area: pt(b.area, 2),
      temperatura: clima.temperatura || '', umidade: clima.umidade || '', vento: clima.vento || '',
      litros: isNaN(b.litros) ? null : +b.litros.toFixed(2), aeronave: b.aeronave, registrado_em: new Date(b.fimMs).toISOString(), origem: 'drone',
    }
  })
}

// Clima que faltou (voo sem leitura perto da bateria) a partir da série de 15 em 15 min do
// mesmo serviço das leituras automáticas — `serie` vem de climaSerie().
export function completarClima(ficha, serie = []) {
  if (!serie.length) return ficha
  return ficha.map(v => {
    if (v.temperatura) return v
    const t = Date.parse(v.registrado_em)
    let p = null
    for (const x of serie) if (!p || Math.abs(x.ms - t) < Math.abs(p.ms - t)) p = x
    if (!p || Math.abs(p.ms - t) > 30 * 60000) return v
    return { ...v, temperatura: pt(p.temperatura, 1), umidade: pt(p.umidade, 0), vento: pt(p.vento, 1) }
  })
}

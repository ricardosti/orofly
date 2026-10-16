import React, { useMemo, useState, useEffect, useRef } from 'react'
import { useTheme } from '../lib/theme'
import { linhasMapa, planilhaMapaBlob, COLUNAS_MAPA, MESES, fmtHoras } from '../lib/mapa'
import { reverseGeocode } from '../lib/geocode'
import { salvarOuCompartilharBlob } from '../lib/nativeShare'

// Menu Regulamentação: a planilha mensal de operações do MAPA montada com os voos reais, do
// jeito que ela é enviada (mesmas colunas e termos), e o botão de exportar o .xlsx.
//
// Município/UF: vêm do cadastro da fazenda. Fazenda sem município é resolvida pelo GPS (dela ou
// do voo) e o resultado é gravado no cadastro, pra não consultar de novo no mês seguinte.

const STATUS_COM_AREA = ['finalizado', 'pausado_dia']
const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const chaveFz = (cliente, fazenda) => `${norm(cliente)}|${norm(fazenda)}`
// Mês do voo no fuso de Brasília (o voo das 22h do dia 31 é do mês 31, não do seguinte em UTC).
const anoMesDe = iso => {
  const p = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-')
  return { ano: +p[0], mes: +p[1] - 1 }
}

export default function RegulamentacaoMapa({ relatorios, drones, produtos, fazendas, empresa, supabase, showToast, isMobile, onIrPara }) {
  const { theme } = useTheme()
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth())
  const [geo, setGeo] = useState({}) // chave da fazenda → { municipio, uf }
  const [buscandoGeo, setBuscandoGeo] = useState(false)
  const [exportando, setExportando] = useState(false)
  const tentados = useRef(new Set())

  const validos = useMemo(() => relatorios.filter(r => STATUS_COM_AREA.includes(r.status) && !r.teste && r.dt_inicio), [relatorios])
  const doMes = (a, m) => validos.filter(r => { const x = anoMesDe(r.dt_inicio); return x.ano === a && x.mes === m })
    .sort((x, y) => new Date(x.dt_inicio) - new Date(y.dt_inicio))
  const voosMes = useMemo(() => doMes(ano, mes), [validos, ano, mes])

  const fzPorChave = useMemo(() => {
    const o = {}
    fazendas.forEach(f => { o[chaveFz(f.cliente, f.nome)] = f })
    return o
  }, [fazendas])

  const municipioDe = rel => {
    const k = chaveFz(rel.cliente, rel.fazenda)
    const fz = fzPorChave[k]
    if (fz?.municipio && fz?.uf) return { municipio: fz.municipio, uf: fz.uf }
    return geo[k] || {}
  }

  // Fazendas sem município: resolve pelo GPS e grava no cadastro.
  async function resolverMunicipios(voos) {
    const faltando = []
    voos.forEach(r => {
      const k = chaveFz(r.cliente, r.fazenda)
      const fz = fzPorChave[k]
      if ((fz?.municipio && fz?.uf) || geo[k] || tentados.current.has(k)) return
      const lat = fz?.lat ?? r.gps_lat, lng = fz?.lng ?? r.gps_lng
      if (lat == null || lng == null) return
      if (!faltando.some(f => f.k === k)) faltando.push({ k, fz, lat, lng })
    })
    if (!faltando.length) return {}
    // Marca todas antes da primeira consulta: duas chamadas ao mesmo tempo (o React roda o
    // efeito duas vezes em desenvolvimento) não podem buscar nem gravar a mesma fazenda.
    faltando.forEach(f => tentados.current.add(f.k))
    setBuscandoGeo(true)
    const novos = {}
    for (const f of faltando) {
      const r = await reverseGeocode(f.lat, f.lng)
      if (r?.cidade && r?.uf) {
        novos[f.k] = { municipio: r.cidade, uf: r.uf }
        if (f.fz?.id) {
          const { error } = await supabase.from('fazendas').update({ municipio: r.cidade, uf: r.uf }).eq('id', f.fz.id)
          if (error) console.warn('Não gravou o município da fazenda:', error.message)
        }
      }
    }
    setGeo(g => ({ ...g, ...novos }))
    setBuscandoGeo(false)
    return novos
  }

  useEffect(() => { resolverMunicipios(voosMes) }, [voosMes, fzPorChave])

  const mapa = useMemo(() => linhasMapa(voosMes, { produtos, drones, municipioDe }),
    [voosMes, produtos, drones, geo, fzPorChave])

  async function exportar(todosOsMeses) {
    setExportando(true)
    try {
      const meses = todosOsMeses ? [...Array(12).keys()] : [mes]
      const voosPorMes = Object.fromEntries(meses.map(m => [m, doMes(ano, m)]))
      const novos = todosOsMeses ? await resolverMunicipios(Object.values(voosPorMes).flat()) : {}
      const geoAtual = { ...geo, ...novos }
      const municipioExport = rel => {
        const k = chaveFz(rel.cliente, rel.fazenda)
        const fz = fzPorChave[k]
        if (fz?.municipio && fz?.uf) return { municipio: fz.municipio, uf: fz.uf }
        return geoAtual[k] || {}
      }
      const porMes = {}
      meses.forEach(m => { porMes[m] = linhasMapa(voosPorMes[m], { produtos, drones, municipioDe: municipioExport }) })
      const blob = planilhaMapaBlob(porMes, { empresa })
      const nome = todosOsMeses ? `MAPA_${ano}.xlsx` : `MAPA_${ano}_${String(mes + 1).padStart(2, '0')}.xlsx`
      await salvarOuCompartilharBlob(blob, nome)
      showToast('✅ Planilha do MAPA baixada!')
    } catch (e) { console.error(e); showToast('Erro ao gerar a planilha: ' + e.message, 'error') }
    setExportando(false)
  }

  const { linhas, totais, pendencias } = mapa
  const card = { background: theme.card, borderRadius: 14, border: `1px solid ${theme.cardBorder2}`, padding: 16, marginBottom: 14 }
  const sel = { border: `1px solid ${theme.cardBorder2}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: theme.inputBg || '#fff', color: theme.text, outline: 'none' }
  const btn = (bg, cor = '#fff') => ({ background: bg, color: cor, border: 'none', borderRadius: 16, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: exportando ? .6 : 1 })
  const faltaEmpresa = !(empresa?.razao_social) || !(empresa?.registro_mapa)
  const anos = [...new Set([hoje.getFullYear(), ...validos.map(r => anoMesDe(r.dt_inicio).ano)])].sort((a, b) => b - a)
  const fmtArea = v => v === '' || v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtNum = v => v === '' || v == null ? '' : (isNaN(Number(String(v).replace(',', '.'))) ? v : Number(String(v).replace(',', '.')).toLocaleString('pt-BR', { maximumFractionDigits: 4 }))
  const fmtHHMM = v => v === '' ? '' : `${String(Math.floor(v / 100)).padStart(2, '0')}:${String(v % 100).padStart(2, '0')}`

  const Aviso = ({ cor, titulo, itens, acao, onAcao }) => itens.length > 0 && (
    <div style={{ background: cor.bg, border: `1px solid ${cor.borda}`, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: cor.texto, lineHeight: 1.5 }}>
      <b>{titulo}</b> {itens.slice(0, 8).join(' · ')}{itens.length > 8 ? ` · e mais ${itens.length - 8}` : ''}
      {acao && <button onClick={onAcao} style={{ marginLeft: 8, background: 'none', border: 'none', color: cor.texto, textDecoration: 'underline', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{acao}</button>}
    </div>
  )
  const amarelo = { bg: theme.warningBg, borda: theme.warningText || '#c98a1c', texto: theme.warningText2 || theme.warningText }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: isMobile ? 18 : 22, fontWeight: 700, color: theme.text }}>📑 Regulamentação</div>
        <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 4 }}>Relatório mensal de operações para o MAPA, montado com os voos do mês.</div>
      </div>

      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <select style={sel} value={mes} onChange={e => setMes(+e.target.value)}>
          {MESES.map((m, i) => <option key={m} value={i}>{m[0].toUpperCase() + m.slice(1)}</option>)}
        </select>
        <select style={sel} value={ano} onChange={e => setAno(+e.target.value)}>
          {anos.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button style={btn('#059669')} disabled={exportando} onClick={() => exportar(false)}>⬇️ Exportar {MESES[mes]} (.xlsx)</button>
        <button style={btn(theme.bg, theme.text)} disabled={exportando} onClick={() => exportar(true)}>⬇️ Ano {ano} (12 abas)</button>
      </div>

      {/* Cabeçalho da planilha */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
        {[['RAZÃO SOCIAL', empresa?.razao_social || '—'], ['REGISTRO MAPA', empresa?.registro_mapa || '—'], ['E-MAIL', empresa?.email || '—'], ['CELULAR', empresa?.telefone || '—'],
          ['OPERAÇÕES NO MÊS', totais.operacoes], ['TOTAL HORAS TRABALHADAS', fmtHoras(totais.minutos)], ['TOTAL ÁREA APLICADA (ha)', fmtArea(totais.area)], ['COMBATE A INCÊNDIO', '0h00']]
          .map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, letterSpacing: .5 }}>{l}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginTop: 3, wordBreak: 'break-word' }}>{v}</div>
            </div>
          ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {faltaEmpresa && <Aviso cor={amarelo} titulo="Falta a razão social ou o registro MAPA da empresa." itens={['']} acao="Preencher em Configurações do Sistema" onAcao={() => onIrPara('configuracoes')} />}
        <Aviso cor={amarelo} titulo="Drones sem prefixo:" itens={pendencias.dronesSemPrefixo} acao="Cadastrar no Inventário" onAcao={() => onIrPara('inventario')} />
        <Aviso cor={amarelo} titulo="Horário suspeito (voo com mais de 12 h — provável esquecimento de finalizar; corrija em Relatórios):" itens={pendencias.horasSuspeitas} acao="Abrir Relatórios" onAcao={() => onIrPara('relatorios')} />
        <Aviso cor={amarelo} titulo="Produtos sem tipo (agrotóxico, bioinsumo…):" itens={pendencias.produtosSemTipo} acao="Classificar no Inventário" onAcao={() => onIrPara('inventario')} />
        <Aviso cor={amarelo} titulo={buscandoGeo ? 'Buscando o município pelo GPS…' : 'Fazendas sem município:'} itens={buscandoGeo ? [''] : pendencias.semMunicipio} acao={buscandoGeo ? '' : 'Completar em Fazendas & Clientes'} onAcao={() => onIrPara('fazendas')} />
      </div>

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        {linhas.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>Nenhuma operação em {MESES[mes]} de {ano}. A planilha sai com "NENHUMA ATIVIDADE REALIZADA".</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 1500, width: '100%' }}>
            <thead>
              <tr style={{ background: theme.bg }}>
                {['Data', 'Cliente · Fazenda', ...COLUNAS_MAPA.filter(c => !['SEMEADURA', 'COMBATE A INCÊNDIO (HORAS)'].includes(c))].map((c, i) => (
                  <th key={c} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: i < 2 ? theme.textFaint2 : theme.textMuted, whiteSpace: 'nowrap', borderBottom: `1px solid ${theme.divider}` }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => {
                const td = (v, extra = {}) => <td style={{ padding: '7px 10px', borderBottom: `1px solid ${theme.divider}`, color: theme.text, whiteSpace: 'nowrap', ...extra }}>{v}</td>
                const vazio = v => v || <span style={{ color: theme.dangerText, fontWeight: 700 }}>falta</span>
                return (
                  <tr key={i} style={{ background: l.primeira ? theme.card : theme.bg }}>
                    {td(l.primeira ? new Date(l.data).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '', { color: theme.textFaint2 })}
                    {td(l.primeira ? `${l.cliente || ''} · ${l.fazenda || ''}` : '', { color: theme.textFaint2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' })}
                    {td(vazio(l.uf))}{td(vazio(l.municipio))}{td(l.tipoAeronave)}{td(vazio(l.prefixo))}
                    {td(fmtHHMM(l.horas))}{td(l.cultura)}{td(vazio(l.tipoServico))}{td(l.classeAgro)}{td(l.classeBio)}
                    {td(fmtArea(l.area), { fontWeight: 600 })}{td(l.agrotoxico)}{td(l.bioinsumo)}{td(l.outros)}
                    {td(fmtNum(l.volume))}{td(fmtNum(l.dosagem))}{td(l.unidade)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ fontSize: 11, color: theme.textFaint2, lineHeight: 1.5 }}>
        Uma linha por produto. Num voo com vários produtos, a área e as horas aparecem só na primeira linha, para o total da planilha não contar a mesma área mais de uma vez.
        Horas = do início ao fim do voo, sem as pausas.
      </div>
    </div>
  )
}

// Importação em lote de fazendas/talhões a partir de uma planilha (xlsx/xls/csv) de
// monitoramento — o formato de referência tem colunas como Projeto, Talhão, Área (ha),
// Id projeto e Ocorrência, mas só usamos essas 5, o resto da planilha é ignorado.
//
// Fluxo: 1) escolhe o arquivo → parse 100% no navegador (SheetJS), nada é enviado a
// lugar nenhum nessa etapa. 2) resolve pendências: qual cliente cada fazenda nova
// pertence, e o de-para de cada "Ocorrência" (ex: "Psilídeo-de-concha") pra uma das
// categorias de produto (Inseticida/Herbicida/Fungicida) — pré-preenche com o que já
// foi mapeado antes (tabela ocorrencia_depara) e só pergunta o que for novo.
// 3) prévia listando o que vai ser criado/atualizado. 4) só grava no Supabase quando
// o usuário clica em "Confirmar Importação" — até lá é só leitura local (dry-run).
import { useState } from 'react'
import * as XLSX from 'xlsx'

const PRODUTO_OPTS = ['Inseticida', 'Herbicida', 'Fungicida']

function normHeader(h) {
  return String(h || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}
function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export default function ImportarFazendasModal({ supabase, invClientes, invFazendas, invTalhoes, theme, onClose, onImported }) {
  const [arquivo, setArquivo] = useState(null)
  const [parseErro, setParseErro] = useState('')
  const [parseando, setParseando] = useState(false)
  const [fazendasGrupo, setFazendasGrupo] = useState(null) // [{ nome, id_fazenda, talhoes:[{nome,area_ha}], ocorrencias:[...] }]
  const [clientePorFazenda, setClientePorFazenda] = useState({}) // { nomeFazenda: clienteNome }
  const [depara, setDepara] = useState({}) // { ocorrencia: produto }
  const [deparaCarregado, setDeparaCarregado] = useState(false)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState(null)

  async function processarArquivo(file) {
    setArquivo(file); setParseErro(''); setFazendasGrupo(null); setResultado(null); setParseando(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
      if (!linhas.length) throw new Error('Planilha vazia')
      const header = linhas[0].map(normHeader)
      const idx = {
        projeto: header.findIndex(h => h === 'projeto'),
        talhao: header.findIndex(h => h === 'talhao'),
        area: header.findIndex(h => h.startsWith('area')),
        idProjeto: header.findIndex(h => h === 'id projeto'),
        ocorrencia: header.findIndex(h => h === 'ocorrencia'),
      }
      if (idx.projeto === -1 || idx.talhao === -1) {
        throw new Error('Não encontrei as colunas "Projeto" e "Talhão" na planilha — confira se é o formato certo.')
      }
      const grupos = {} // norm(projeto) -> {...}
      for (let i = 1; i < linhas.length; i++) {
        const row = linhas[i]
        if (!row || row.every(c => c === '' || c == null)) continue
        const projetoNome = String(row[idx.projeto] ?? '').trim()
        const talhaoNome = String(row[idx.talhao] ?? '').trim()
        if (!projetoNome || !talhaoNome) continue
        const areaVal = idx.area >= 0 ? parseFloat(String(row[idx.area]).replace(',', '.')) : null
        const idProjetoVal = idx.idProjeto >= 0 ? String(row[idx.idProjeto] ?? '').trim() : ''
        const ocorrenciaVal = idx.ocorrencia >= 0 ? String(row[idx.ocorrencia] ?? '').trim() : ''
        const chave = norm(projetoNome)
        if (!grupos[chave]) grupos[chave] = { nome: projetoNome, id_fazenda: idProjetoVal || '', talhoes: [], ocorrencias: new Set() }
        if (!grupos[chave].id_fazenda && idProjetoVal) grupos[chave].id_fazenda = idProjetoVal
        const talhaoJaExiste = grupos[chave].talhoes.some(t => norm(t.nome) === norm(talhaoNome))
        if (!talhaoJaExiste) grupos[chave].talhoes.push({ nome: talhaoNome, area_ha: isNaN(areaVal) ? null : areaVal })
        if (ocorrenciaVal) grupos[chave].ocorrencias.add(ocorrenciaVal)
      }
      const lista = Object.values(grupos).map(g => ({ ...g, ocorrencias: Array.from(g.ocorrencias) }))
      if (!lista.length) throw new Error('Não achei nenhuma linha válida (com Projeto e Talhão preenchidos).')
      setFazendasGrupo(lista)

      // Pré-preenche cliente pra fazendas que já existem no cadastro (mesmo nome já tem
      // cliente definido) — só pergunta pra quem for realmente novo.
      const clientesIniciais = {}
      lista.forEach(g => {
        const existente = invFazendas.find(fz => norm(fz.nome) === norm(g.nome))
        if (existente) clientesIniciais[g.nome] = existente.cliente
      })
      setClientePorFazenda(clientesIniciais)

      // Carrega o de-para de ocorrência→produto já salvo (best-effort — se a tabela ainda
      // não existir no banco, ignora silenciosamente e todo mundo fica "não mapeado").
      const todasOcorrencias = Array.from(new Set(lista.flatMap(g => g.ocorrencias)))
      if (todasOcorrencias.length) {
        try {
          const { data, error } = await supabase.from('ocorrencia_depara').select('ocorrencia,produto').in('ocorrencia', todasOcorrencias)
          if (!error && data) {
            const mapa = {}
            data.forEach(d => { mapa[d.ocorrencia] = d.produto })
            setDepara(mapa)
          }
        } catch { /* tabela ainda não existe — sem problema, só não pré-preenche */ }
      }
      setDeparaCarregado(true)
    } catch (e) {
      setParseErro(e.message || String(e))
    } finally {
      setParseando(false)
    }
  }

  if (!fazendasGrupo) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,16,0.55)', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
        <div style={{ background: theme.card, borderRadius: 20, width: '100%', maxWidth: 480, padding: 24 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700 }}>📤 Importar Fazendas/Talhões</div>
            <button style={{ background: 'none', border: 'none', fontSize: 18, color: theme.textFaint2, cursor: 'pointer' }} onClick={onClose}>✕</button>
          </div>
          <p style={{ fontSize: 12.5, color: theme.textMuted, lineHeight: 1.5, marginBottom: 16 }}>
            Sobe uma planilha (.xlsx) de monitoramento e usa as colunas <strong>Projeto</strong> (nome da fazenda), <strong>Talhão</strong>, <strong>Área (ha)</strong>, <strong>Id projeto</strong> (opcional, vira ID da fazenda) e <strong>Ocorrência</strong> (opcional, vira Produto). O resto das colunas é ignorado. Nada é gravado até você conferir a prévia e confirmar.
          </p>
          <label style={{ display: 'block', border: `1.5px dashed ${theme.cardBorder2}`, borderRadius: 12, padding: 24, textAlign: 'center', cursor: 'pointer' }}>
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) processarArquivo(f) }} />
            {parseando ? '⏳ Lendo planilha...' : (arquivo ? `📄 ${arquivo.name}` : '📎 Clique pra escolher o arquivo (.xlsx)')}
          </label>
          {parseErro && <div style={{ marginTop: 12, background: theme.dangerBg, color: theme.dangerText, borderRadius: 10, padding: '10px 14px', fontSize: 12.5 }}>{parseErro}</div>}
        </div>
      </div>
    )
  }

  const ocorrenciasUnicas = Array.from(new Set(fazendasGrupo.flatMap(g => g.ocorrencias)))
  const totalTalhoes = fazendasGrupo.reduce((a, g) => a + g.talhoes.length, 0)
  const faltaCliente = fazendasGrupo.some(g => !clientePorFazenda[g.nome])
  const clientesAtivos = invClientes.filter(c => c.ativo)

  function statusFazenda(g) {
    return invFazendas.find(fz => norm(fz.nome) === norm(g.nome) && fz.cliente === clientePorFazenda[g.nome]) ? 'existente' : 'nova'
  }
  function statusTalhao(g, t, fazendaExistente) {
    if (!fazendaExistente) return 'novo'
    const jaExiste = invTalhoes.find(tl => tl.fazenda_id === fazendaExistente.id && norm(tl.nome) === norm(t.nome))
    if (!jaExiste) return 'novo'
    return (jaExiste.area_ha || null) === (t.area_ha || null) ? 'igual' : 'atualiza'
  }

  async function confirmarImportacao() {
    setImportando(true); setResultado(null)
    const resumo = { fazendasCriadas: 0, fazendasReaproveitadas: 0, talhoesCriados: 0, talhoesAtualizados: 0, erros: [] }
    try {
      for (const g of fazendasGrupo) {
        const clienteEscolhido = clientePorFazenda[g.nome]
        if (!clienteEscolhido) continue
        let fazendaExistente = invFazendas.find(fz => norm(fz.nome) === norm(g.nome) && fz.cliente === clienteEscolhido)
        let fazendaId = fazendaExistente?.id
        // Produto da fazenda = de-para da primeira ocorrência mapeada encontrada nesse grupo
        const ocorrenciaMapeada = g.ocorrencias.find(o => depara[o])
        const produtoFazenda = ocorrenciaMapeada ? depara[ocorrenciaMapeada] : null
        if (!fazendaExistente) {
          const { data, error } = await supabase.from('fazendas').insert({
            cliente: clienteEscolhido, nome: g.nome, produto: produtoFazenda || null,
            id_fazenda: g.id_fazenda || null, ativo: true,
          }).select().single()
          if (error) { resumo.erros.push(`Fazenda "${g.nome}": ${error.message}`); continue }
          fazendaId = data.id
          resumo.fazendasCriadas++
        } else {
          resumo.fazendasReaproveitadas++
        }
        for (const t of g.talhoes) {
          const talhaoExistente = invTalhoes.find(tl => tl.fazenda_id === fazendaId && norm(tl.nome) === norm(t.nome))
          if (!talhaoExistente) {
            const { error } = await supabase.from('talhoes').insert({ fazenda_id: fazendaId, nome: t.nome, area_ha: t.area_ha, ativo: true })
            if (error) { resumo.erros.push(`Talhão "${t.nome}" (${g.nome}): ${error.message}`); continue }
            resumo.talhoesCriados++
          } else if ((talhaoExistente.area_ha || null) !== (t.area_ha || null)) {
            const { error } = await supabase.from('talhoes').update({ area_ha: t.area_ha }).eq('id', talhaoExistente.id)
            if (!error) resumo.talhoesAtualizados++
          }
        }
      }
      // Salva o de-para novo (best-effort — some silenciosamente se a tabela não existir ainda)
      const paresNovos = Object.entries(depara).filter(([, v]) => v)
      if (paresNovos.length) {
        try {
          await supabase.from('ocorrencia_depara').upsert(paresNovos.map(([ocorrencia, produto]) => ({ ocorrencia, produto })), { onConflict: 'ocorrencia' })
        } catch { /* tabela ainda não existe */ }
      }
      setResultado(resumo)
      onImported?.()
    } catch (e) {
      resumo.erros.push(e.message || String(e))
      setResultado(resumo)
    } finally {
      setImportando(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,16,0.55)', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: theme.card, borderRadius: 20, width: '100%', maxWidth: 720, maxHeight: '88vh', overflowY: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700 }}>📤 Importar Fazendas/Talhões</div>
          <button style={{ background: 'none', border: 'none', fontSize: 18, color: theme.textFaint2, cursor: 'pointer' }} onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 16 }}>{arquivo?.name} — {fazendasGrupo.length} fazenda(s), {totalTalhoes} talhão(ões) encontrados</div>

        {resultado ? (
          <div>
            <div style={{ background: theme.successBg, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#00A86B', marginBottom: 6 }}>✅ Importação concluída</div>
              <div style={{ fontSize: 13, color: theme.text }}>
                {resultado.fazendasCriadas} fazenda(s) nova(s) · {resultado.fazendasReaproveitadas} já existiam · {resultado.talhoesCriados} talhão(ões) novo(s) · {resultado.talhoesAtualizados} atualizado(s)
              </div>
            </div>
            {resultado.erros.length > 0 && (
              <div style={{ background: theme.dangerBg, color: theme.dangerText, borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 12.5 }}>
                {resultado.erros.map((e, i) => <div key={i}>⚠️ {e}</div>)}
              </div>
            )}
            <button style={{ width: '100%', background: '#00A86B', color: '#fff', border: 'none', borderRadius: 100, padding: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={onClose}>Fechar</button>
          </div>
        ) : (
          <>
            {ocorrenciasUnicas.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: theme.textFaint2, marginBottom: 8 }}>DE-PARA: OCORRÊNCIA → PRODUTO (opcional)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ocorrenciasUnicas.map(oc => (
                    <div key={oc} style={{ display: 'flex', alignItems: 'center', gap: 10, background: theme.bg, borderRadius: 10, padding: '8px 12px' }}>
                      <span style={{ flex: 1, fontSize: 13, color: theme.text }}>{oc}</span>
                      {depara[oc] && <span style={{ fontSize: 10, fontWeight: 700, color: '#00A86B', background: theme.successBg, borderRadius: 20, padding: '2px 8px' }}>✓ já mapeado</span>}
                      <select value={depara[oc] || ''} onChange={e => setDepara(d => ({ ...d, [oc]: e.target.value }))}
                        style={{ border: `1px solid ${theme.cardBorder2}`, borderRadius: 8, padding: '6px 10px', fontSize: 12.5, background: theme.card, color: theme.text }}>
                        <option value="">Selecione...</option>
                        {PRODUTO_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: theme.textFaint2, marginBottom: 8 }}>FAZENDAS ENCONTRADAS — DEFINA O CLIENTE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {fazendasGrupo.map(g => {
                  const st = statusFazenda(g)
                  const areaTotal = g.talhoes.reduce((a, t) => a + (t.area_ha || 0), 0)
                  return (
                    <div key={g.nome} style={{ border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, padding: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, color: theme.text }}>
                            {g.nome} {g.id_fazenda && <span style={{ fontWeight: 400, color: theme.textFaint2, fontSize: 11 }}>(ID {g.id_fazenda})</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 2 }}>
                            {g.talhoes.length} talhão(ões) · {areaTotal.toFixed(1)} ha ·{' '}
                            <span style={{ fontWeight: 700, color: st === 'nova' ? '#00A86B' : theme.warningText2 }}>{st === 'nova' ? 'fazenda nova' : 'já cadastrada — só atualiza talhões'}</span>
                          </div>
                        </div>
                        <select value={clientePorFazenda[g.nome] || ''} onChange={e => setClientePorFazenda(c => ({ ...c, [g.nome]: e.target.value }))}
                          style={{ border: `1px solid ${!clientePorFazenda[g.nome] ? theme.dangerText : theme.cardBorder2}`, borderRadius: 8, padding: '7px 10px', fontSize: 12.5, background: theme.card, color: theme.text }}>
                          <option value="">Selecione o cliente...</option>
                          {clientesAtivos.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: theme.textFaint2, marginBottom: 8 }}>PRÉVIA (nada gravado ainda)</div>
              <div style={{ border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: theme.bg }}>{['Fazenda', 'Talhão', 'Área (ha)', 'Status'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: theme.textMuted, position: 'sticky', top: 0, background: theme.bg }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {fazendasGrupo.flatMap(g => {
                      const fazendaExistente = invFazendas.find(fz => norm(fz.nome) === norm(g.nome) && fz.cliente === clientePorFazenda[g.nome])
                      return g.talhoes.map(t => {
                        const st = statusTalhao(g, t, fazendaExistente)
                        const label = st === 'novo' ? '🆕 novo' : st === 'atualiza' ? '🔄 atualiza área' : '✓ sem mudança'
                        const cor = st === 'novo' ? '#00A86B' : st === 'atualiza' ? '#c98a1c' : theme.textFaint2
                        return (
                          <tr key={g.nome + '|' + t.nome} style={{ borderTop: `1px solid ${theme.divider}` }}>
                            <td style={{ padding: '7px 10px', color: theme.text }}>{g.nome}</td>
                            <td style={{ padding: '7px 10px', color: theme.text }}>{t.nome}</td>
                            <td style={{ padding: '7px 10px', color: theme.textMuted }}>{t.area_ha != null ? t.area_ha : '—'}</td>
                            <td style={{ padding: '7px 10px', fontWeight: 600, color: cor }}>{label}</td>
                          </tr>
                        )
                      })
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {faltaCliente && <div style={{ fontSize: 11.5, color: theme.dangerText, marginBottom: 10 }}>⚠️ Defina o cliente de todas as fazendas antes de confirmar.</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ flex: 1, background: theme.bg, color: theme.textMuted, border: 'none', borderRadius: 100, padding: 12, fontSize: 13, cursor: 'pointer' }} onClick={onClose}>Cancelar</button>
              <button disabled={faltaCliente || importando} onClick={confirmarImportacao}
                style={{ flex: 2, background: '#00A86B', color: '#fff', border: 'none', borderRadius: 100, padding: 12, fontSize: 13, fontWeight: 700, cursor: faltaCliente ? 'not-allowed' : 'pointer', opacity: (faltaCliente || importando) ? .6 : 1 }}>
                {importando ? 'Importando...' : '✅ Confirmar Importação'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

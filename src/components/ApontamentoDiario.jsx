// Apontamento diário — o fechamento do dia pra mandar à usina (Gestão → Fazendas & Clientes →
// Apontamento diário). Escolhe o dia e o cliente; sai a lista por fazenda e o texto no modelo da
// usina, pronto pra copiar ou mandar no WhatsApp. As contas ficam em lib/apontamentoDiario.
import { useState, useMemo } from 'react'
import { useTheme } from '../lib/theme'
import { apontamentoDiario, textoApontamento, diaDoVoo } from '../lib/apontamentoDiario'
import { compartilharNativo } from '../lib/nativeShare'

const hojeIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const lerLocal = (k, padrao) => { try { return localStorage.getItem(k) ?? padrao } catch { return padrao } }
const gravarLocal = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem storage: só não lembra */ } }
const ha = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ApontamentoDiario({ relatorios, fazendas, talhoes, empresa, showToast, isMobile }) {
  const { theme } = useTheme()
  const [data, setData] = useState(hojeIso())
  // Clientes que têm voo no dia escolhido — o mais comum vem marcado.
  const clientesDoDia = useMemo(() => {
    const cont = {}
    relatorios.filter(r => ['finalizado', 'pausado_dia'].includes(r.status) && !r.teste && diaDoVoo(r) === data && r.cliente)
      .forEach(r => { cont[r.cliente] = (cont[r.cliente] || 0) + 1 })
    return Object.entries(cont).sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [relatorios, data])
  const [clienteEscolhido, setClienteEscolhido] = useState(() => lerLocal('orofly_apont_cliente', ''))
  const cliente = clientesDoDia.includes(clienteEscolhido) ? clienteEscolhido : (clientesDoDia[0] || '')
  const [operacao, setOperacao] = useState(() => lerLocal('orofly_apont_operacao', ''))

  const res = useMemo(() => apontamentoDiario({ relatorios, fazendas, talhoes, data, cliente }), [relatorios, fazendas, talhoes, data, cliente])
  const texto = textoApontamento({ ...res, data, operacao, empresa, cliente })

  async function copiar() {
    try { await navigator.clipboard.writeText(texto); showToast('📋 Apontamento copiado') }
    catch { showToast('Não deu pra copiar — selecione o texto abaixo e copie', 'error') }
  }
  function whatsapp() {
    compartilharNativo({ text: texto, webFallbackUrl: 'https://wa.me/?text=' + encodeURIComponent(texto) })
  }

  const rot = { fontSize: 11, fontWeight: 700, color: theme.textMuted, marginBottom: 4 }
  const campo = { border: `1px solid ${theme.cardBorder2}`, borderRadius: 10, padding: '8px 10px', fontSize: 13, background: theme.card, color: theme.text, outline: 'none' }
  const btn = cor => ({ background: cor, color: '#fff', border: 'none', borderRadius: 18, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })
  const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: theme.textMuted, padding: '8px 10px', borderBottom: `1px solid ${theme.divider}` }
  const td = { fontSize: 12.5, color: theme.text, padding: '8px 10px', borderBottom: `1px solid ${theme.divider}` }

  return (
    <div>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        O fechamento do dia pra mandar à usina: por fazenda, os talhões, a área total, a aplicada e a diferença, e o rendimento do dia.
        A área total é a da OS — o que foi percorrido, sem o que ficou marcado como "Outro"; a diferença é a bordadura e os outros motivos.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14, background: theme.card, border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, padding: 12 }}>
        <div><div style={rot}>DIA DA APLICAÇÃO</div><input type="date" style={campo} value={data} onChange={e => setData(e.target.value)} /></div>
        <div style={{ minWidth: 180 }}>
          <div style={rot}>CLIENTE</div>
          <select style={{ ...campo, width: '100%' }} value={cliente} onChange={e => { setClienteEscolhido(e.target.value); gravarLocal('orofly_apont_cliente', e.target.value) }}>
            {clientesDoDia.length === 0 && <option value="">Nenhum voo nesse dia</option>}
            {clientesDoDia.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <div style={rot}>OPERAÇÃO</div>
          <input style={{ ...campo, width: '100%', boxSizing: 'border-box' }} placeholder="Ex.: Pré-Emergente" value={operacao}
            onChange={e => { setOperacao(e.target.value); gravarLocal('orofly_apont_operacao', e.target.value) }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn('#059669')} onClick={copiar} disabled={!res.linhas.length}>📋 Copiar</button>
          <button style={btn('#25D366')} onClick={whatsapp} disabled={!res.linhas.length}>💬 WhatsApp</button>
        </div>
      </div>

      {res.linhas.length === 0 ? (
        <div style={{ background: theme.card, border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, padding: 30, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>
          Nenhum voo finalizado {cliente ? `de ${cliente} ` : ''}nesse dia.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.4fr) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
          <div style={{ background: theme.card, border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Cód.</th><th style={th}>Fazenda</th><th style={th}>Talhões</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th><th style={{ ...th, textAlign: 'right' }}>Aplicada</th><th style={{ ...th, textAlign: 'right' }}>Diferença</th>
              </tr></thead>
              <tbody>
                {res.linhas.map(l => (
                  <tr key={l.cliente + l.fazenda}>
                    <td style={{ ...td, fontWeight: 700 }}>{l.codigo || '—'}</td>
                    <td style={td}>{l.fazenda}{l.voos > 1 ? <span style={{ color: theme.textFaint, fontSize: 11 }}> · {l.voos} voos</span> : null}</td>
                    <td style={td}>{l.talhoes.join(' - ')}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{ha(l.areaTotal)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{ha(l.areaAplicada)}</td>
                    <td style={{ ...td, textAlign: 'right', color: l.diferenca > 0 ? theme.text : theme.textFaint }}>
                      {l.diferenca > 0 ? ha(l.diferenca) : '0'}{l.motivos.length ? <div style={{ fontSize: 10.5, color: theme.textMuted }}>{l.motivos.join(', ')}</div> : null}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 800 }} colSpan={4}>Rendimento total do dia · {res.voos} voo{res.voos === 1 ? '' : 's'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#059669' }}>{ha(res.total)} ha</td>
                  <td style={td} />
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <div style={rot}>TEXTO PRA MANDAR</div>
            <textarea readOnly value={texto} onFocus={e => e.target.select()}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 360, border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, padding: 12, fontFamily: 'ui-monospace,monospace', fontSize: 12, color: theme.text, background: theme.card, resize: 'vertical' }} />
          </div>
        </div>
      )}
    </div>
  )
}

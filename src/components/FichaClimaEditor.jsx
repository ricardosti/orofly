import React from 'react'
import { useTheme } from '../lib/theme'
import { CAMPOS_VOO, sugerirProximoVoo } from '../lib/monitoramentoClima'

// Editor da "Ficha de Aplicação — Drone" (Monitoramento Climático Beta): o mesmo no app do
// piloto (Passo 4) e no painel. Cabeçalho da operação + um cartão por voo (bateria).
// Fora dos componentes de tela de propósito, pra não recriar a cada render e perder o foco.

const CAB = [
  ['auxiliar', 'AUXILIAR', 'Nome'],
  ['tecnico_regional', 'TÉCNICO REGIONAL', 'Nome'],
  ['supervisor', 'SUPERVISOR OPERACIONAL', 'Nome'],
  ['area_aplicada', 'ÁREA APLICADA (ha)', 'Em branco: a do voo'],
  ['volume_consumido', 'VOLUME CONSUMIDO (L)', 'Em branco: vazão × área'],
  ['recomendacao', 'RECOMENDAÇÃO (L/ha)', 'Em branco: vazão do voo'],
]
const CURTO = { inicio: 'INÍCIO', fim: 'FIM', altura: 'ALTURA (m)', area: 'ÁREA (ha)', temperatura: 'TEMP. (°C)', umidade: 'UMID. (%)', vento: 'VENTO (km/h)' }

export default function FichaClimaEditor({ valor, onChange, sugestao = {}, mostrarCabecalho = true }) {
  const { theme } = useTheme()
  const f = valor || {}
  const voos = f.voos || []
  const set = (k, v) => onChange({ ...f, [k]: v })
  const setVoo = (i, k, v) => onChange({ ...f, voos: voos.map((x, j) => j === i ? { ...x, [k]: v } : x) })
  const input = { width: '100%', border: `1px solid ${theme.cardBorder2}`, borderRadius: 8, padding: '7px 8px', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: theme.inputBg || '#fff', color: theme.text }
  const rot = { fontSize: 9, fontWeight: 700, color: theme.textMuted, letterSpacing: .4, marginBottom: 3 }
  const agora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

  return (
    <div>
      {mostrarCabecalho && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
          {CAB.map(([k, l, ph]) => (
            <div key={k}>
              <div style={rot}>{l}</div>
              <input style={input} placeholder={ph} value={f[k] || ''} onChange={e => set(k, e.target.value)} />
            </div>
          ))}
        </div>
      )}

      {voos.map((v, i) => (
        <div key={i} style={{ border: `1px solid ${theme.cardBorder2}`, borderRadius: 12, padding: 10, marginBottom: 8, background: theme.card }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: theme.text, flex: 1 }}>Voo {String(i + 1).padStart(2, '0')}</span>
            <button type="button" title="Remover este voo" onClick={() => onChange({ ...f, voos: voos.filter((_, j) => j !== i) })}
              style={{ background: 'none', border: 'none', color: theme.dangerText, fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(82px, 1fr))', gap: 6 }}>
            {CAMPOS_VOO.map(([k]) => (
              <div key={k}>
                <div style={rot}>{CURTO[k]}</div>
                {(k === 'inicio' || k === 'fim') ? (
                  <div style={{ display: 'flex', gap: 3 }}>
                    <input type="time" style={{ ...input, padding: '7px 4px' }} value={v[k] || ''} onChange={e => setVoo(i, k, e.target.value)} />
                    {!v[k] && <button type="button" onClick={() => setVoo(i, k, agora())} title="Agora"
                      style={{ background: theme.successBg, color: '#00A86B', border: 'none', borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: '0 5px' }}>agora</button>}
                  </div>
                ) : (
                  <input inputMode="decimal" style={input} value={v[k] || ''} onChange={e => setVoo(i, k, e.target.value)} />
                )}
              </div>
            ))}
          </div>
          <input style={{ ...input, marginTop: 6, fontSize: 12 }} placeholder="Observação deste voo (opcional)" value={v.obs || ''} onChange={e => setVoo(i, 'obs', e.target.value)} />
        </div>
      ))}

      <button type="button" onClick={() => onChange({ ...f, voos: [...voos, sugerirProximoVoo(voos, sugestao)] })}
        style={{ width: '100%', background: theme.successBg, color: '#00A86B', border: `1.5px dashed #00A86B`, borderRadius: 12, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        + Registrar voo {String(voos.length + 1).padStart(2, '0')}
      </button>

      {mostrarCabecalho && (
        <div style={{ marginTop: 10 }}>
          <div style={rot}>OBSERVAÇÕES DA OPERAÇÃO</div>
          <textarea style={{ ...input, resize: 'vertical', minHeight: 44 }} value={f.observacoes || ''} onChange={e => set('observacoes', e.target.value)} />
        </div>
      )}
    </div>
  )
}

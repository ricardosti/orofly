import React from 'react'
import { useTheme } from '../lib/theme'
import { CAMPOS_PARAMS } from '../lib/paramsPadrao'

// Bloco "Preenchimento padrão do formulário" — o mesmo no cadastro de cliente e de fazenda.
// Fora do AdminPanel de propósito: componente declarado dentro dele seria recriado a cada
// render e o campo perderia o foco a cada letra.
export default function ParamsPadraoCampos({ valor, onChange, dica }) {
  const { theme } = useTheme()
  const p = valor || {}
  return (
    <div style={{ borderTop: `1px solid ${theme.divider}`, paddingTop: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, letterSpacing: .5 }}>PREENCHIMENTO PADRÃO DO FORMULÁRIO (OPCIONAL)</div>
      <div style={{ fontSize: 10, color: '#aaa', marginTop: 3, marginBottom: 8 }}>{dica}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8 }}>
        {CAMPOS_PARAMS.map(([k, lbl, ph]) => (
          <div key={k}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: theme.textMuted, letterSpacing: .4, marginBottom: 3 }}>{lbl}</div>
            <input style={{ width: '100%', border: `1px solid ${theme.cardBorder2}`, borderRadius: 8, padding: '7px 9px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              placeholder={ph} value={p[k] || ''} onChange={e => onChange({ ...p, [k]: e.target.value })} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Árvore de seleção em lote — agrupa fazendas em N níveis e permite marcar/desmarcar um
// grupo inteiro de uma vez (ex: todas as fazendas de um cliente).
//
// É puramente controlado: não guarda "quais estão marcadas" — só chama onToggleFazenda/
// onToggleGrupo e deixa quem chama decidir a fonte de verdade (o array `marcadas` vem de
// fora). Isso é o que permite essa árvore e o checklist por cliente conviverem como duas
// abas do mesmo modal sem duplicar estado: as duas leem/escrevem a mesma tabela
// piloto_fazendas, só mudam a forma de navegar até a fazenda.
//
// NOTA IMPORTANTE: o cadastro de fazenda do Orofly hoje não tem campo de estado/cidade
// (só CEP e lat/lng opcionais, nenhum dos dois normalizado em texto). Por isso o nível de
// agrupamento usado por padrão é "cliente" — é o dado real que já existe e cobre o caso de
// uso mais comum (atribuir todas as fazendas de um contrato de uma vez). Se um dia o
// cadastro ganhar estado/cidade, basta passar niveis={[fz=>fz.estado, fz=>fz.cidade]} que a
// árvore ganha mais um nível automaticamente, sem mexer no resto do componente.
import { useState } from 'react'

export default function RegionTreeSelect({
  fazendas,           // [{ id, nome, cliente, pct, conflito, conflitoLabel }]
  marcadas,           // array de fazenda_id já marcados — mesma fonte que a outra aba
  onToggleFazenda,     // (fazendaId) => void
  onToggleGrupo,       // (fazendaIds[]) => void — marca todas se nem todas estão marcadas, senão desmarca todas
  niveis = [fz => fz.cliente || 'Sem cliente'],
  theme,
}) {
  const [abertos, setAbertos] = useState({})

  function Nivel({ lista, nivel, caminhoPai }) {
    if (nivel >= niveis.length) {
      return lista.map(fz => (
        <FazendaLinha key={fz.id} fz={fz} marcada={marcadas.includes(fz.id)} onToggle={() => onToggleFazenda(fz.id)} theme={theme} />
      ))
    }
    const grupos = {}
    lista.forEach(fz => {
      const chave = niveis[nivel](fz) || '—'
      ;(grupos[chave] = grupos[chave] || []).push(fz)
    })
    return Object.keys(grupos).sort().map(chave => {
      const itensGrupo = grupos[chave]
      const idsGrupo = itensGrupo.map(f => f.id)
      const marcadasNoGrupo = idsGrupo.filter(id => marcadas.includes(id)).length
      const caminho = `${caminhoPai}>${chave}`
      const aberto = abertos[caminho] ?? marcadasNoGrupo > 0
      return (
        <div key={caminho} style={{ borderBottom: '1px solid #f0f5f2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f9fbfa' }}>
            <div
              onClick={e => { e.stopPropagation(); onToggleGrupo(idsGrupo) }}
              title="Marcar/desmarcar todas deste grupo"
              style={{
                width: 14, height: 14, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                border: `2px solid ${marcadasNoGrupo === idsGrupo.length ? '#00A86B' : marcadasNoGrupo > 0 ? '#c98a1c' : '#c3d4c9'}`,
                background: marcadasNoGrupo === idsGrupo.length ? '#00A86B' : marcadasNoGrupo > 0 ? '#f3d9a6' : '#fff',
              }}
            />
            <span onClick={() => setAbertos(s => ({ ...s, [caminho]: !aberto }))} style={{ flex: 1, fontSize: 12, fontWeight: 700, color: theme.text, cursor: 'pointer' }}>
              {nivel === 0 ? '🏢' : '📍'} {chave}
            </span>
            <span onClick={() => setAbertos(s => ({ ...s, [caminho]: !aberto }))} style={{ fontSize: 11, color: marcadasNoGrupo > 0 ? '#00A86B' : '#aaa', fontWeight: 600, cursor: 'pointer' }}>
              {marcadasNoGrupo}/{idsGrupo.length} {aberto ? '▲' : '▼'}
            </span>
          </div>
          {aberto && (
            <div style={{ paddingLeft: nivel === 0 ? 0 : 14 }}>
              <Nivel lista={itensGrupo} nivel={nivel + 1} caminhoPai={caminho} />
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div style={{ border: `1px solid ${theme.divider}`, borderRadius: 12, overflow: 'hidden' }}>
      <Nivel lista={fazendas} nivel={0} caminhoPai="raiz" />
    </div>
  )
}

function FazendaLinha({ fz, marcada, onToggle, theme }) {
  return (
    <div onClick={onToggle} style={{ padding: '7px 14px 7px 26px', cursor: 'pointer', fontSize: 12, background: marcada ? theme.successBg : '#fff', borderTop: '1px solid #f7fbf8' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${marcada ? '#00A86B' : '#c3d4c9'}`, background: marcada ? '#00A86B' : '#fff', flexShrink: 0 }} />
        <span style={{ color: marcada ? theme.text : theme.textMuted, fontWeight: marcada ? 600 : 400, flex: 1 }}>{fz.nome}</span>
        {fz.pct != null && (
          <span style={{ fontSize: 10, fontWeight: 700, color: fz.pct >= 100 ? '#00A86B' : fz.pct >= 50 ? '#c98a1c' : theme.textFaint2, background: theme.bg, borderRadius: 20, padding: '2px 7px', flexShrink: 0 }}>
            {fz.pct.toFixed(0)}%
          </span>
        )}
      </div>
      {fz.conflito && (
        <div style={{ marginTop: 3, marginLeft: 22, fontSize: 10.5, color: theme.warningText2, background: theme.warningBg, borderRadius: 8, padding: '3px 7px', display: 'inline-block' }}>
          ⚠️ Já atribuída a: {fz.conflitoLabel}
        </div>
      )}
    </div>
  )
}

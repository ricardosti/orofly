import React, { useState } from 'react'
import { itensDoChecklist, avaliarChecklist, medidorDe, hojeISO, STATUS_VEICULO } from '../lib/frota'

// App do piloto → Veículo: checklist de saída (veículo + kit da operação) e abastecimento.
// Checklist com item crítico reprovado bloqueia o veículo no banco (trigger
// frota_checklist_bloqueia) até um gestor liberar em Gestão → Frota.
export default function VeiculoPiloto({ supabase, profile, veiculos, theme, showToast, onVoltar }) {
  const [modo, setModo] = useState('checklist')
  const [vid, setVid] = useState(veiculos[0]?.id || '')
  const v = veiculos.find(x => x.id === vid)
  const horas = v && medidorDe(v) === 'horas'
  const [levaKit, setLevaKit] = useState(true)
  const [resp, setResp] = useState({})
  const [extra, setExtra] = useState({ km: '', destino: '', observacao: '' })
  const [ab, setAb] = useState({ data: hojeISO(), leitura: '', litros: '', valor: '', posto: '', combustivel: '', tanque_cheio: true })
  const [salvando, setSalvando] = useState(false)
  const itens = v ? itensDoChecklist(v, { levaKit: levaKit && v.tipo !== 'gerador' }) : []
  const av = avaliarChecklist(itens, resp)
  const num = s => { const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return isNaN(n) ? null : n }
  const card = { background: theme.card, borderRadius: 16, border: `1px solid ${theme.cardBorder2}`, padding: 14, marginBottom: 12 }
  const campo = { width: '100%', boxSizing: 'border-box', border: `1px solid ${theme.cardBorder2}`, borderRadius: 10, padding: '10px 12px', fontSize: 15, background: theme.inputBg || '#fff', color: theme.text }
  const rot = { fontSize: 10.5, fontWeight: 700, color: theme.textMuted, marginBottom: 4, letterSpacing: 0.4 }
  const botao = (bg, cor = '#fff') => ({ background: bg, color: cor, border: 'none', borderRadius: 14, padding: '12px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', width: '100%' })

  async function enviarChecklist() {
    if (!av.completo) { showToast(`Faltam ${av.semResposta.length} itens pra conferir`, 'error'); return }
    if (av.resultado === 'reprovado' && !window.confirm('Tem item crítico reprovado. O veículo vai ficar BLOQUEADO até o gestor liberar. Enviar assim?')) return
    setSalvando(true)
    const { error } = await supabase.from('frota_checklists').insert({
      veiculo_id: v.id, motorista_id: profile.id, motorista_nome: profile.nome || profile.email, km: num(extra.km),
      itens: itens.map(i => ({ id: i.id, texto: i.texto, critico: i.critico, grupo: i.grupo, ok: resp[i.id]?.ok, obs: resp[i.id]?.obs || null })),
      resultado: av.resultado, destino: extra.destino || null, observacao: extra.observacao || null,
    })
    setSalvando(false)
    if (error) { showToast('Não enviou: ' + error.message, 'error'); return }
    showToast(av.resultado === 'aprovado' ? '✅ Checklist aprovado, boa viagem!' : av.resultado === 'pendencia' ? '⚠️ Enviado com pendência — o gestor foi avisado' : '⛔ Veículo bloqueado — fale com o gestor')
    setResp({}); setExtra({ km: '', destino: '', observacao: '' })
  }
  async function enviarAbastecimento() {
    const litros = num(ab.litros), valor = num(ab.valor), leitura = num(ab.leitura)
    if (!v || !(litros > 0) || valor == null || leitura == null) { showToast(`Preencha ${horas ? 'horímetro' : 'km'}, litros e valor`, 'error'); return }
    setSalvando(true)
    const { error } = await supabase.from('frota_abastecimentos').insert({
      veiculo_id: v.id, data: ab.data, km: horas ? null : leitura, horimetro: horas ? leitura : null, litros, valor,
      posto: ab.posto || null, combustivel: ab.combustivel || null, tanque_cheio: ab.tanque_cheio, motorista_id: profile.id, motorista_nome: profile.nome || profile.email,
    })
    if (!error) await supabase.from('veiculos').update(horas ? { horimetro: leitura } : { km_atual: leitura }).eq('id', v.id)
    setSalvando(false)
    if (error) { showToast('Não enviou: ' + error.message, 'error'); return }
    showToast('✅ Abastecimento registrado'); setAb(a => ({ ...a, leitura: '', litros: '', valor: '', posto: '' }))
  }

  const st = v && STATUS_VEICULO[v.status]
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, minHeight: '100vh', background: theme.bg, fontFamily: "'Poppins',sans-serif" }}>
      <button onClick={onVoltar} style={{ ...botao(theme.card, theme.text), width: 'auto', marginBottom: 12, border: `1px solid ${theme.cardBorder2}` }}>← Voltar</button>
      <div style={{ fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 10 }}>🛻 Veículo</div>
      {veiculos.length === 0 ? <div style={card}>Nenhum veículo cadastrado. Peça ao gestor pra cadastrar em Gestão → Frota.</div> : <>
        <div style={card}>
          <div style={rot}>VEÍCULO</div>
          <select style={campo} value={vid} onChange={e => { setVid(e.target.value); setResp({}) }}>{veiculos.map(x => <option key={x.id} value={x.id}>{x.placa} · {x.modelo || ''}</option>)}</select>
          {st && v.status !== 'operacional' && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: st.cor }}>{st.rotulo}{v.status === 'bloqueado' ? ' — aguardando liberação do gestor' : ''}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[['checklist', '✅ Checklist de saída'], ['abastecimento', '⛽ Abastecimento']].map(([k, l]) => (
            <button key={k} onClick={() => setModo(k)} style={{ ...botao(modo === k ? '#00A86B' : theme.card, modo === k ? '#fff' : theme.text), border: `1px solid ${theme.cardBorder2}` }}>{l}</button>
          ))}
        </div>
        {modo === 'checklist' && v && <>
          {v.tipo !== 'gerador' && v.tipo !== 'moto' && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: theme.text, marginBottom: 10 }}><input type="checkbox" checked={levaKit} onChange={e => setLevaKit(e.target.checked)} /> Vai levar drone (conferir o kit da operação)</label>}
          {['veiculo', 'kit'].map(g => itens.some(i => i.grupo === g) && (
            <div key={g} style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#00A86B', marginBottom: 8 }}>{g === 'veiculo' ? 'VEÍCULO' : 'KIT DA OPERAÇÃO'}</div>
              {itens.filter(i => i.grupo === g).map(i => {
                const r = resp[i.id] || {}
                return (
                  <div key={i.id} style={{ borderTop: `1px solid ${theme.divider || theme.cardBorder2}`, padding: '9px 0' }}>
                    <div style={{ fontSize: 13.5, color: theme.text }}>{i.texto}{i.critico && <span style={{ color: theme.dangerText, fontWeight: 700 }}> *</span>}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button onClick={() => setResp(x => ({ ...x, [i.id]: { ...r, ok: true } }))} style={{ ...botao(r.ok === true ? '#00A86B' : theme.bg, r.ok === true ? '#fff' : theme.text), padding: '8px' }}>✓ OK</button>
                      <button onClick={() => setResp(x => ({ ...x, [i.id]: { ...r, ok: false } }))} style={{ ...botao(r.ok === false ? theme.dangerText : theme.bg, r.ok === false ? '#fff' : theme.text), padding: '8px' }}>✗ Problema</button>
                    </div>
                    {r.ok === false && <input style={{ ...campo, marginTop: 6, fontSize: 13 }} placeholder="O que tem de errado?" value={r.obs || ''} onChange={e => setResp(x => ({ ...x, [i.id]: { ...r, obs: e.target.value } }))} />}
                  </div>
                )
              })}
            </div>
          ))}
          <div style={card}>
            <div style={rot}>{horas ? 'HORÍMETRO' : 'KM ATUAL'}</div><input style={campo} inputMode="decimal" value={extra.km} onChange={e => setExtra(x => ({ ...x, km: e.target.value }))} />
            <div style={{ ...rot, marginTop: 10 }}>DESTINO</div><input style={campo} placeholder="Fazenda / cliente" value={extra.destino} onChange={e => setExtra(x => ({ ...x, destino: e.target.value }))} />
            <div style={{ ...rot, marginTop: 10 }}>OBSERVAÇÃO</div><input style={campo} value={extra.observacao} onChange={e => setExtra(x => ({ ...x, observacao: e.target.value }))} />
            <div style={{ fontSize: 12, color: theme.textMuted, margin: '10px 0' }}>* item crítico: se estiver com problema, o veículo fica bloqueado até o gestor liberar.</div>
            <button disabled={salvando} onClick={enviarChecklist} style={botao(av.resultado === 'reprovado' ? theme.dangerText : '#00A86B')}>{salvando ? 'Enviando...' : `Enviar checklist${av.completo ? '' : ` (faltam ${av.semResposta.length})`}`}</button>
          </div>
        </>}
        {modo === 'abastecimento' && v && (
          <div style={card}>
            <div style={rot}>DATA</div><input type="date" style={campo} value={ab.data} onChange={e => setAb(x => ({ ...x, data: e.target.value }))} />
            <div style={{ ...rot, marginTop: 10 }}>{horas ? 'HORÍMETRO' : 'KM NO PAINEL'}</div><input style={campo} inputMode="decimal" value={ab.leitura} onChange={e => setAb(x => ({ ...x, leitura: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <div style={{ flex: 1 }}><div style={rot}>LITROS</div><input style={campo} inputMode="decimal" value={ab.litros} onChange={e => setAb(x => ({ ...x, litros: e.target.value }))} /></div>
              <div style={{ flex: 1 }}><div style={rot}>VALOR (R$)</div><input style={campo} inputMode="decimal" value={ab.valor} onChange={e => setAb(x => ({ ...x, valor: e.target.value }))} /></div>
            </div>
            <div style={{ ...rot, marginTop: 10 }}>COMBUSTÍVEL</div>
            <select style={campo} value={ab.combustivel} onChange={e => setAb(x => ({ ...x, combustivel: e.target.value }))}>{['', 'Diesel S10', 'Gasolina', 'Etanol', 'Arla'].map(c => <option key={c} value={c}>{c || '—'}</option>)}</select>
            <div style={{ ...rot, marginTop: 10 }}>POSTO</div><input style={campo} value={ab.posto} onChange={e => setAb(x => ({ ...x, posto: e.target.value }))} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: theme.text, margin: '12px 0' }}><input type="checkbox" checked={ab.tanque_cheio} onChange={e => setAb(x => ({ ...x, tanque_cheio: e.target.checked }))} /> Enchi o tanque (é o que calcula o consumo)</label>
            <button disabled={salvando} onClick={enviarAbastecimento} style={botao('#00A86B')}>{salvando ? 'Enviando...' : 'Registrar abastecimento'}</button>
            <div style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 8 }}>A nota fiscal continua sendo lançada em Notas, como sempre.</div>
          </div>
        )}
      </>}
    </div>
  )
}

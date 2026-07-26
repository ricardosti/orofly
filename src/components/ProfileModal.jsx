import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function ProfileModal({ profile, onClose, onSaved }) {
  const [nome, setNome] = useState(profile?.nome || '')
  const [telefone, setTelefone] = useState(profile?.telefone || '')
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [avatarFile, setAvatarFile] = useState(null)
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmaSenha, setConfirmaSenha] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!profile?.avatar_url) return
    supabase.storage.from('relatorios').createSignedUrl(profile.avatar_url, 3600).then(({ data }) => {
      if (data?.signedUrl) setAvatarPreview(data.signedUrl)
    })
  }, [profile?.avatar_url])

  function handleAvatarFile(f) {
    if (!f) return
    const r = new FileReader()
    r.onload = ev => setAvatarPreview(ev.target.result)
    r.readAsDataURL(f)
    setAvatarFile(f)
  }

  async function salvar() {
    setErro('')
    if (novaSenha && novaSenha.length < 6) { setErro('A nova senha precisa ter no mínimo 6 caracteres'); return }
    if (novaSenha && novaSenha !== confirmaSenha) { setErro('As senhas não coincidem'); return }
    setSaving(true)
    try {
      let avatar_url = profile.avatar_url || null
      if (avatarFile) {
        const path = `avatars/${profile.id}/${Date.now()}.jpg`
        const { error: upErr } = await supabase.storage.from('relatorios').upload(path, avatarFile, { upsert: true })
        if (!upErr) avatar_url = path
      }
      const { error: profErr } = await supabase.from('profiles').update({ nome, telefone: telefone || null, avatar_url }).eq('id', profile.id)
      if (profErr) throw profErr
      if (novaSenha) {
        const { error: passErr } = await supabase.auth.updateUser({ password: novaSenha })
        if (passErr) throw passErr
      }
      onSaved()
    } catch (e) { setErro(e.message) } finally { setSaving(false) }
  }

  const iniciais = (nome || 'P').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const inputStyle = { width: '100%', border: '1px solid #d7e6dc', borderRadius: 12, padding: '10px 12px', fontSize: 14, fontFamily: "'DM Sans',sans-serif", outline: 'none', color: '#0b1210', background: '#f1f8f4', boxSizing: 'border-box' }
  const labelStyle = { fontSize: 10, fontWeight: 700, color: '#7ba38f', letterSpacing: .5, marginBottom: 5, display: 'block', fontFamily: "'Syne',sans-serif" }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,16,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 24, width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, color: '#0b1210', marginBottom: 20 }}>👤 Meu Perfil</div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <label style={{ position: 'relative', cursor: 'pointer' }}>
            {avatarPreview ? (
              <img src={avatarPreview} alt="avatar" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', display: 'block', border: '3px solid #e3f7ec' }} />
            ) : (
              <div style={{ width: 84, height: 84, borderRadius: '50%', background: '#e3f7ec', color: '#0e9f6e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 28, border: '3px solid #e3f7ec' }}>{iniciais}</div>
            )}
            <span style={{ position: 'absolute', bottom: 0, right: 0, background: '#0e9f6e', color: '#fff', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, border: '2px solid #fff' }}>📷</span>
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleAvatarFile(e.target.files[0])} />
          </label>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>NOME</div>
          <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>TELEFONE</div>
          <input style={inputStyle} placeholder="(00) 00000-0000" value={telefone} onChange={e => setTelefone(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>E-MAIL</div>
          <input style={{ ...inputStyle, color: '#7ba38f', background: '#f6f9f7' }} value={profile?.email || ''} disabled />
        </div>

        <div style={{ borderTop: '1px solid #eef5f0', margin: '16px 0', paddingTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0b1210', marginBottom: 10, fontFamily: "'Syne',sans-serif" }}>Trocar senha (opcional)</div>
          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>NOVA SENHA</div>
            <input type="password" style={inputStyle} placeholder="Deixe em branco pra manter a atual" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} />
          </div>
          {novaSenha && (
            <div>
              <div style={labelStyle}>CONFIRMAR NOVA SENHA</div>
              <input type="password" style={inputStyle} value={confirmaSenha} onChange={e => setConfirmaSenha(e.target.value)} />
            </div>
          )}
        </div>

        {erro && <div style={{ background: '#fdeaea', color: '#e5484d', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={{ flex: 1, background: '#f1f8f4', color: '#5c7568', border: 'none', borderRadius: 100, padding: 13, fontSize: 14, fontWeight: 600, cursor: 'pointer' }} onClick={onClose}>Cancelar</button>
          <button style={{ flex: 2, background: '#0e9f6e', color: '#fff', border: 'none', borderRadius: 100, padding: 13, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? .7 : 1, boxShadow: '0 6px 18px rgba(14,159,110,0.3)' }} disabled={saving} onClick={salvar}>{saving ? 'Salvando...' : '💾 Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/theme'
import { useLanguage } from '../lib/i18n'

export default function ProfileModal({ profile, onClose, onSaved }) {
  const { theme, themeName, toggleTheme } = useTheme()
  const { lang, setLang, t } = useLanguage()
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
    supabase.storage.from('relatorios').createSignedUrl(profile.avatar_url, 3600).then(({ data, error }) => {
      if (error) console.error('Erro ao gerar URL do avatar:', error)
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
    if (novaSenha && novaSenha.length < 6) { setErro(t('A nova senha precisa ter no mínimo 6 caracteres')); return }
    if (novaSenha && novaSenha !== confirmaSenha) { setErro(t('As senhas não coincidem')); return }
    setSaving(true)
    try {
      let avatar_url = profile.avatar_url || null
      if (avatarFile) {
        const path = `${profile.id}/avatars/${Date.now()}.jpg`
        const { error: upErr } = await supabase.storage.from('relatorios').upload(path, avatarFile, { upsert: true })
        if (upErr) throw upErr
        avatar_url = path
      }
      // .select().single() é de propósito — se a política de segurança (RLS) bloquear a
      // atualização, o Supabase por padrão retorna "sucesso" com 0 linhas afetadas (sem erro
      // nenhum). Forçando o single(), 0 linhas vira um erro de verdade em vez de falhar em silêncio.
      const { error: profErr } = await supabase.from('profiles').update({ nome, telefone: telefone || null, avatar_url }).eq('id', profile.id).select().single()
      if (profErr) throw profErr
      if (novaSenha) {
        const { error: passErr } = await supabase.auth.updateUser({ password: novaSenha })
        if (passErr) throw passErr
      }
      onSaved()
    } catch (e) { setErro(e.message) } finally { setSaving(false) }
  }

  const iniciais = (nome || 'P').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const inputStyle = { width: '100%', border: `1px solid ${theme.inputBorder}`, borderRadius: 12, padding: '10px 12px', fontSize: 14, fontFamily: "'DM Sans',sans-serif", outline: 'none', color: theme.text, background: theme.bg, boxSizing: 'border-box' }
  const labelStyle = { fontSize: 10, fontWeight: 700, color: theme.textFaint2, letterSpacing: .5, marginBottom: 5, display: 'block', fontFamily: "'Syne',sans-serif" }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,16,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: theme.card, borderRadius: 24, width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 20 }}>{t('👤 Meu Perfil')}</div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <label style={{ position: 'relative', cursor: 'pointer' }}>
            {avatarPreview ? (
              <img src={avatarPreview} alt="avatar" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', display: 'block', border: `3px solid ${theme.successBg}` }} />
            ) : (
              <div style={{ width: 84, height: 84, borderRadius: '50%', background: theme.successBg, color: theme.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 28, border: `3px solid ${theme.successBg}` }}>{iniciais}</div>
            )}
            <span style={{ position: 'absolute', bottom: 0, right: 0, background: theme.primary, color: '#fff', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, border: `2px solid ${theme.card}` }}>📷</span>
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleAvatarFile(e.target.files[0])} />
          </label>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>{t('NOME')}</div>
          <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>{t('TELEFONE')}</div>
          <input style={inputStyle} placeholder="(00) 00000-0000" value={telefone} onChange={e => setTelefone(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>{t('E-MAIL')}</div>
          <input style={{ ...inputStyle, color: theme.textFaint2, background: theme.divider }} value={profile?.email || ''} disabled />
        </div>

        <div style={{ borderTop: `1px solid ${theme.divider}`, margin: '16px 0', paddingTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, marginBottom: 10, fontFamily: "'Syne',sans-serif" }}>Aparência</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: theme.bg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.text, fontFamily: "'DM Sans',sans-serif" }}>
              <span style={{ fontSize: 16 }}>{themeName === 'dark' ? '🌙' : '☀️'}</span>
              Modo {themeName === 'dark' ? 'escuro' : 'claro'}
            </div>
            <button
              onClick={toggleTheme}
              aria-label="Alternar modo escuro"
              style={{
                width: 44, height: 24, borderRadius: 100, border: 'none', cursor: 'pointer',
                background: themeName === 'dark' ? theme.primary : theme.cardBorder,
                position: 'relative', transition: 'background .2s', padding: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 2, left: themeName === 'dark' ? 22 : 2,
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${theme.divider}`, margin: '16px 0', paddingTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, marginBottom: 10, fontFamily: "'Syne',sans-serif" }}>Trocar senha (opcional)</div>
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

        {erro && <div style={{ background: theme.dangerBg, color: theme.dangerText, borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={{ flex: 1, background: theme.bg, color: theme.textMuted, border: 'none', borderRadius: 100, padding: 13, fontSize: 14, fontWeight: 600, cursor: 'pointer' }} onClick={onClose}>Cancelar</button>
          <button style={{ flex: 2, background: theme.primary, color: '#fff', border: 'none', borderRadius: 100, padding: 13, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? .7 : 1, boxShadow: '0 6px 18px rgba(14,159,110,0.3)' }} disabled={saving} onClick={salvar}>{saving ? 'Salvando...' : '💾 Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

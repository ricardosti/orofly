// Documentos da fazenda (fiscalização): a lista e o visualizador. O PDF é desenhado página por
// página com o pdf.js — o WebView do Android não abre PDF sozinho. No app do piloto
// (guardarSozinho) tudo já fica guardado no aparelho quando tem sinal. Ver lib/documentosFazenda.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { useTheme } from '../lib/theme'
import { categoriaDoc, CATEGORIAS_DOC, ehPdf, tamanhoLegivel, abrirDocumento, caminhosNoAparelho, guardarDocumentosDaFazenda } from '../lib/documentosFazenda'
import { salvarOuCompartilharBlob } from '../lib/nativeShare'

// Mesmo worker do mapa da fazenda (lib/geopdf): arquivo estático da pasta public/.
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.mjs`

const ORDEM = Object.fromEntries(CATEGORIAS_DOC.map(([id], i) => [id, i]))

export default function DocumentosFazenda({ supabase, fazenda, guardarSozinho = false }) {
  const { theme } = useTheme()
  const docs = useMemo(() => [...(fazenda?.documentos || [])].sort((a, b) => (ORDEM[a.categoria] ?? 9) - (ORDEM[b.categoria] ?? 9) || String(a.nome).localeCompare(String(b.nome))), [fazenda?.documentos])
  const [noAparelho, setNoAparelho] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [aberto, setAberto] = useState(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const ja = new Set(await caminhosNoAparelho())
      if (!vivo) return
      setNoAparelho(Object.fromEntries(docs.filter(d => ja.has(d.path)).map(d => [d.path, true])))
      if (!guardarSozinho || docs.every(d => ja.has(d.path))) return
      setGuardando(true)
      await guardarDocumentosDaFazenda(supabase, fazenda, p => { if (vivo) setNoAparelho(s => ({ ...s, [p]: true })) })
      if (vivo) setGuardando(false)
    })()
    return () => { vivo = false }
  }, [docs, guardarSozinho, supabase, fazenda])

  if (!docs.length) return null
  const faltam = docs.filter(d => !noAparelho[d.path]).length
  return (
    <div style={{ background: theme.card, border: `1px solid ${theme.cardBorder2}`, borderRadius: 16, padding: '12px 14px', marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, letterSpacing: .5, flex: 1 }}>📎 DOCUMENTOS DA FAZENDA</div>
        {guardarSozinho && (
          <span style={{ fontSize: 10.5, color: faltam ? theme.textMuted : '#047857', fontWeight: 600 }}>
            {guardando ? 'Guardando no aparelho…' : faltam ? `${faltam} sem guardar (precisa de sinal)` : '✓ todos no aparelho'}
          </span>
        )}
      </div>
      {docs.map(d => {
        const [, icone, rotulo] = categoriaDoc(d.categoria)
        return (
          <button key={d.path} type="button" onClick={() => setAberto(d)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: theme.bg, border: `1px solid ${theme.divider}`, borderRadius: 12, padding: '10px 12px', marginBottom: 6, cursor: 'pointer', color: theme.text }}>
            <span style={{ fontSize: 20 }}>{icone}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nome}</span>
              <span style={{ display: 'block', fontSize: 11, color: theme.textMuted }}>{rotulo} · {tamanhoLegivel(d.tamanho)}{noAparelho[d.path] ? ' · ✓ no aparelho' : ''}</span>
            </span>
            <span style={{ color: theme.textFaint2, fontSize: 16 }}>›</span>
          </button>
        )
      })}
      {aberto && <VisualizadorDocumento supabase={supabase} doc={aberto} onClose={() => setAberto(null)}
        onGuardado={p => setNoAparelho(s => ({ ...s, [p]: true }))} />}
    </div>
  )
}

function VisualizadorDocumento({ supabase, doc, onClose, onGuardado }) {
  const [estado, setEstado] = useState({ carregando: true, erro: '', imagem: null, blob: null })
  const paginasRef = useRef(null)
  // Por referência: a função vem nova a cada render de quem chama, e o efeito redesenharia o PDF.
  const avisarGuardado = useRef(onGuardado)
  avisarGuardado.current = onGuardado

  useEffect(() => {
    let vivo = true, url = null
    if (paginasRef.current) paginasRef.current.innerHTML = ''
    ;(async () => {
      try {
        const { blob } = await abrirDocumento(supabase, doc)
        avisarGuardado.current?.(doc.path)
        if (!vivo) return
        if (!ehPdf(doc)) {
          url = URL.createObjectURL(blob)
          setEstado({ carregando: false, erro: '', imagem: url, blob })
          return
        }
        const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise
        if (!vivo) return
        setEstado({ carregando: false, erro: '', imagem: null, blob })
        const caixa = paginasRef.current
        const largura = Math.min(1800, Math.max(800, (caixa?.clientWidth || 800) * (window.devicePixelRatio || 1)))
        for (let i = 1; i <= Math.min(pdf.numPages, 40) && vivo; i++) {
          const pagina = await pdf.getPage(i)
          const base = pagina.getViewport({ scale: 1 })
          // Canvas do Android acima de ~4096 px volta em branco: o lado maior fica em até 2400.
          const escala = Math.min(largura / base.width, 2400 / Math.max(base.width, base.height))
          const vp = pagina.getViewport({ scale: escala })
          const canvas = document.createElement('canvas')
          canvas.width = vp.width; canvas.height = vp.height
          canvas.style.cssText = 'display:block;width:100%;height:auto;background:#fff;margin:0 auto 10px;border-radius:4px;box-shadow:0 1px 6px rgba(0,0,0,.35)'
          // Entra na tela antes de terminar de desenhar: as páginas aparecem conforme ficam prontas.
          if (!vivo || !paginasRef.current) break
          paginasRef.current.appendChild(canvas)
          await pagina.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
        }
      } catch (e) {
        if (vivo) setEstado({ carregando: false, erro: navigator.onLine === false ? 'Sem sinal, e esse documento ainda não foi guardado no aparelho.' : `Não deu pra abrir: ${e.message}`, imagem: null, blob: null })
      }
    })()
    return () => { vivo = false; if (url) URL.revokeObjectURL(url) }
  }, [supabase, doc])

  const [, icone, rotulo] = categoriaDoc(doc.categoria)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#111', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', paddingTop: 'max(12px, env(safe-area-inset-top))', background: '#1b1b1b', color: '#fff' }}>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '0 6px 0 0' }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{icone} {doc.nome}</div>
          <div style={{ fontSize: 11, opacity: .7 }}>{rotulo}</div>
        </div>
        {estado.blob && (
          <button type="button" onClick={() => salvarOuCompartilharBlob(estado.blob, doc.nome)}
            style={{ background: '#059669', border: 'none', color: '#fff', borderRadius: 16, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Compartilhar</button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10, WebkitOverflowScrolling: 'touch' }}>
        {estado.carregando && <div style={{ color: '#ccc', textAlign: 'center', marginTop: 40, fontSize: 14 }}>Abrindo…</div>}
        {estado.erro && <div style={{ color: '#fca5a5', textAlign: 'center', marginTop: 40, fontSize: 14, padding: '0 20px' }}>{estado.erro}</div>}
        {estado.imagem && <img src={estado.imagem} alt={doc.nome} style={{ display: 'block', maxWidth: '100%', margin: '0 auto', background: '#fff' }} />}
        <div ref={paginasRef} />
      </div>
    </div>
  )
}

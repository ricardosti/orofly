// Gestão de PDFs "avulsos" — mapas que o piloto abre direto do celular/WhatsApp sem
// vincular a uma fazenda cadastrada (estilo "abrir arquivo" do Avenza Maps). Cada mapa
// salvo offline vira 2 arquivos na pasta Data do app: o PDF em si e um .json ao lado com
// a calibração (bounds/viewport) já descoberta, pra não precisar recalibrar toda vez que
// reabrir. Só existe no app nativo (Android/iOS); no navegador comum não salva nada.
import { Capacitor } from '@capacitor/core'
import { base64ParaArrayBuffer, blobParaBase64 } from './geopdf'

const DIR_AVULSOS = 'mapas-avulsos'

// Nome de arquivo seguro pro sistema de arquivos, mas ainda legível — troca só o que pode
// dar problema (barras, dois-pontos etc), mantendo espaços/acentos do nome original.
function nomeArquivoSeguro(nomeOriginal) {
  return nomeOriginal.replace(/[\\/:*?"<>|]/g, '_')
}

// Extensões reconhecidas como mapa (PDF ou foto/imagem) — o .json de calibração ao lado
// de cada arquivo NÃO entra aqui, senão apareceria como um "mapa" fantasma na lista.
const EXT_MAPA = /\.(pdf|jpe?g|png)$/i

export async function listarMapasAvulsos() {
  if (!Capacitor.isNativePlatform()) return []
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const res = await Filesystem.readdir({ path: DIR_AVULSOS, directory: Directory.Data })
    const arquivos = res.files.filter(f => EXT_MAPA.test(f.name))
    const itens = []
    for (const f of arquivos) {
      try {
        const stat = await Filesystem.stat({ path: `${DIR_AVULSOS}/${f.name}`, directory: Directory.Data })
        itens.push({ id: f.name, nome: f.name, tamanho: stat.size, modificado: stat.mtime || 0 })
      } catch { /* arquivo sumiu entre o readdir e o stat, ignora */ }
    }
    return itens.sort((a, b) => b.modificado - a.modificado)
  } catch { return [] }
}

// Mantém a extensão original do arquivo (.pdf, .jpg, .jpeg ou .png) — antes forçava
// ".pdf" em qualquer coisa, o que deixava imagens salvas com nome tipo "foto.jpg.pdf".
export async function salvarMapaAvulso(nomeOriginal, blob) {
  if (!Capacitor.isNativePlatform()) return null
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const id = nomeArquivoSeguro(nomeOriginal)
  const base64 = await blobParaBase64(blob)
  await Filesystem.mkdir({ path: DIR_AVULSOS, directory: Directory.Data, recursive: true }).catch(() => {})
  await Filesystem.writeFile({ path: `${DIR_AVULSOS}/${id}`, data: base64, directory: Directory.Data })
  return id
}

export async function lerMapaAvulso(id) {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const res = await Filesystem.readFile({ path: `${DIR_AVULSOS}/${id}`, directory: Directory.Data })
    return base64ParaArrayBuffer(res.data)
  } catch { return null }
}

export async function excluirMapaAvulso(id) {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    await Filesystem.deleteFile({ path: `${DIR_AVULSOS}/${id}`, directory: Directory.Data })
    await Filesystem.deleteFile({ path: `${DIR_AVULSOS}/${id}.json`, directory: Directory.Data }).catch(() => {})
  } catch { /* já não existia, tudo bem */ }
}

// Calibração (bounds + viewport) salva ao lado do PDF — pra não ter que recalibrar/re-
// detectar o GeoPDF toda vez que reabrir um mapa avulso já salvo offline.
export async function lerMetaMapaAvulso(id) {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const res = await Filesystem.readFile({ path: `${DIR_AVULSOS}/${id}.json`, directory: Directory.Data, encoding: 'utf8' })
    return JSON.parse(res.data)
  } catch { return null }
}

export async function salvarMetaMapaAvulso(id, meta) {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: `${DIR_AVULSOS}/${id}.json`, data: JSON.stringify(meta), directory: Directory.Data, encoding: 'utf8' })
  } catch (e) { console.error('Erro ao salvar calibração do mapa avulso:', e) }
}

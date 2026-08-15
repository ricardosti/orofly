import { Capacitor } from '@capacitor/core'

// No app Android/iOS o WebView carrega os assets do bundle local (webDir: 'build'), servido
// de um esquema tipo capacitor://localhost — não do domínio da Vercel. Um fetch relativo
// ('/api/clima') nesse contexto bate num endpoint que não existe localmente e falha, mesmo
// com internet OK (bug: previsão funciona na Web mas dá erro de conexão no APK). Na Web
// (fetch relativo já funciona, mesma origem) deixamos como está; só no nativo é que a gente
// precisa apontar pro domínio de produção onde as funções serverless (/api/*) realmente vivem.
const API_BASE = Capacitor.isNativePlatform() ? 'https://orofly.vercel.app' : ''

export function apiUrl(path) {
  return `${API_BASE}${path}`
}

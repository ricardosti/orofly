// Log de atividades — quem fez o quê e quando.
//
// Serve pra medir o que é usado de verdade no app. A regra é: registrar ação
// deliberada do usuário (iniciou voo, lançou despesa), nunca navegação nem
// digitação — senão o log vira ruído e ainda por cima gasta banda, que já foi
// problema aqui em agosto.
//
// Gravar log NUNCA pode atrapalhar o usuário: tudo aqui é "dispara e esquece".
// Se falhar (offline no meio da lavoura, por exemplo), a ação do piloto segue
// normal e o registro daquele evento se perde — de propósito. Fila offline
// custaria mais complexidade do que vale pra uma métrica de uso.

import { supabase } from './supabase'
import { ehFalhaDeRede } from './filaDespesas'

// Catálogo das ações. O slug é o que vai pro banco; o resto é só pra tela.
export const ACOES = {
  login:             { label: 'entrou no app',             icon: '🔑', area: 'Acesso' },
  logout:            { label: 'saiu do app',               icon: '🚪', area: 'Acesso' },

  voo_iniciado:      { label: 'iniciou um voo',            icon: '🚁', area: 'Voo' },
  voo_finalizado:    { label: 'finalizou um voo',          icon: '✅', area: 'Voo' },
  voo_parcial:       { label: 'encerrou o dia sem terminar', icon: '⏸️', area: 'Voo' },
  voo_retomado:      { label: 'retomou um voo em aberto',  icon: '▶️', area: 'Voo' },
  trecho_salvo:      { label: 'salvou um trecho',          icon: '📍', area: 'Voo' },
  rascunho_apagado:  { label: 'apagou um rascunho',        icon: '🗑️', area: 'Voo' },

  relatorio_gerado:  { label: 'gerou o relatório',         icon: '📄', area: 'Relatório' },
  whatsapp_enviado:  { label: 'compartilhou no WhatsApp',  icon: '💬', area: 'Relatório' },
  evidencia_anexada: { label: 'anexou uma evidência',      icon: '📎', area: 'Relatório' },
  foto_mapa_enviada: { label: 'enviou a foto do mapa',     icon: '🗺️', area: 'Relatório' },
  kml_anexado:       { label: 'anexou o trajeto (KML)',    icon: '🛰️', area: 'Relatório' },

  incidente_aberto:  { label: 'registrou um incidente',    icon: '⚠️', area: 'Campo' },
  sos_acionado:      { label: 'acionou o SOS',             icon: '🆘', area: 'Campo' },

  despesa_lancada:   { label: 'lançou uma despesa',        icon: '💰', area: 'Financeiro' },
  viagem_registrada: { label: 'registrou uma viagem',      icon: '🚗', area: 'Financeiro' },

  agenda_recusada:   { label: 'recusou um agendamento',    icon: '🙅', area: 'Agenda' },
  agenda_criada:     { label: 'criou um agendamento',      icon: '📅', area: 'Agenda' },

  // Painel (admin)
  pdf_baixado:       { label: 'baixou um PDF',             icon: '📥', area: 'Painel' },
  consolidado_aberto:{ label: 'abriu o consolidado da fazenda', icon: '📊', area: 'Painel' },
  fazenda_salva:     { label: 'cadastrou ou editou uma fazenda', icon: '🌾', area: 'Painel' },
  relatorio_editado: { label: 'corrigiu um relatório',     icon: '✏️', area: 'Painel' },
}

export function descreverAcao(slug) {
  return ACOES[slug] || { label: slug, icon: '•', area: 'Outros' }
}

// Contexto de quem está usando o app. Preenchido quando o perfil carrega, pra
// não precisar passar o usuário em cada chamada de registrar().
let ctx = null

export function definirUsuario(perfil) {
  ctx = perfil ? { id: perfil.id, nome: perfil.nome || perfil.email, papel: perfil.role } : null
}

/**
 * Grava uma ação no log. Não devolve nada útil e não lança — de propósito.
 *
 * @param acao    slug do catálogo ACOES
 * @param detalhe texto curto e legível ("ESTIVA · Talhão 12")
 * @param extras  { cliente, meta }
 */
export function registrar(acao, detalhe = null, extras = {}) {
  if (!ctx?.id) return // sem usuário identificado o RLS recusaria de qualquer jeito
  // id e hora saem do aparelho: sem sinal a linha fica guardada e sobe depois com a hora em
  // que a ação aconteceu (e o id impede que ela entre duas vezes).
  const linha = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    user_id: ctx.id,
    user_nome: ctx.nome,
    papel: ctx.papel,
    acao,
    detalhe: detalhe ? String(detalhe).slice(0, 300) : null,
    cliente: extras.cliente || null,
    meta: extras.meta || null,
  }
  try {
    supabase.from('atividades').insert(linha).then(({ error }) => {
      // O cliente do Supabase devolve o erro em vez de lançar (seção 8 do CLAUDE.md).
      if (!error) { enviarAtividadesGuardadas(); return }
      if (ehFalhaDeRede(error)) guardarAtividade(linha)
      else console.warn('[atividade] não registrou:', acao, error.message)
    })
  } catch (e) {
    console.warn('[atividade] não registrou:', acao, e?.message)
  }
}

// Ações feitas sem sinal (no campo é a maioria). Até 200, as mais recentes.
const FILA = 'orofly_fila_atividades'
function lerFila() { try { return JSON.parse(localStorage.getItem(FILA) || '[]') } catch { return [] } }
function guardarAtividade(linha) {
  try { localStorage.setItem(FILA, JSON.stringify([...lerFila(), linha].slice(-200))) } catch {}
}
let enviando = false
export async function enviarAtividadesGuardadas() {
  if (enviando || !ctx?.id) return
  const minhas = lerFila().filter(l => l.user_id === ctx.id)
  if (!minhas.length) return
  enviando = true
  try {
    const subiram = []
    for (const l of minhas) {
      const { error } = await supabase.from('atividades').insert(l)
      if (error && error.code !== '23505') { if (ehFalhaDeRede(error)) break; console.warn('[atividade] descartada:', l.acao, error.message) }
      subiram.push(l.id)
    }
    if (subiram.length) try { localStorage.setItem(FILA, JSON.stringify(lerFila().filter(l => !subiram.includes(l.id)))) } catch {}
  } finally { enviando = false }
}

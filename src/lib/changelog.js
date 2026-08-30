// Novidades por versão — o que alimenta a tela Desenvolvedor → Novidades.
//
// Como adicionar: crie um objeto novo no TOPO da lista (a tela mostra na ordem daqui,
// da mais recente pra mais antiga) e suba o APP_VERSION em src/lib/version.js junto.
// A tela marca como "atual" a versão que bate com o APP_VERSION, então as duas coisas
// precisam andar juntas — se divergirem, nenhuma entrada aparece como atual.
//
// `tipo` decide a cor da tag: 'novo' (verde), 'melhoria' (azul), 'correcao' (âmbar).

export const NOVIDADES = [
  {
    versao: '4.0',
    data: '2026-08-29',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Calendário na Agenda',
        texto: 'A Agenda ganhou uma visão de calendário, além da lista de sempre. O mês inteiro aparece de uma vez, cada agendamento vira uma etiqueta colorida por piloto, e clicar num dia já abre o planejamento daquela data com o formulário preenchido. Só no painel do admin.',
      },
      {
        tipo: 'novo',
        titulo: 'Esta tela de Novidades',
        texto: 'Um lugar pra acompanhar o que mudou em cada versão, sem precisar perguntar.',
      },
      {
        tipo: 'correcao',
        titulo: 'Versão do app estava errada no painel',
        texto: 'O rodapé do painel admin mostrava v3.8 enquanto a tela de login já dizia v4.0. Agora os dois leem do mesmo lugar e não têm como divergir de novo.',
      },
    ],
  },
]

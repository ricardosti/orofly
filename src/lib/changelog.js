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
    versao: '4.1',
    data: '2026-09-04',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Área somava em dobro no relatório consolidado',
        texto: 'Quando o mesmo talhão era trabalhado por mais de um piloto, cada voo carregava a área do talhão inteiro e o consolidado somava o dobro — um talhão de 15,26 ha aparecia com 30,52. Agora as parcelas de cada talhão nunca ultrapassam o tamanho cadastrado, e o resumo da fazenda passou a bater com a tabela de talhões.',
      },
      {
        tipo: 'novo',
        titulo: 'Área feita e bordadura editáveis no painel',
        texto: 'É a área FEITA que o relatório usa pra calcular dose, produto e o consolidado. Em voo antigo ela vem vazia, e aí o sistema assume o talhão inteiro. Agora dá pra preencher no painel — é o que faz a divisão por piloto sair correta num talhão dividido entre dois.',
      },
      {
        tipo: 'novo',
        titulo: 'Produtos aplicados podem ser corrigidos no painel',
        texto: 'Quando o piloto finaliza o voo sem preencher o produto, o PDF saía com a seção vazia e não havia como completar. Agora o admin edita a lista de produtos e a dose, e reemite o relatório.',
      },
      {
        tipo: 'novo',
        titulo: 'Enquadrar e aproximar a foto do mapa',
        texto: 'Botão "Enquadrar" na edição do relatório: corta e aproxima a imagem do mapa antes de salvar, pra o talhão ficar legível no PDF. É o mesmo editor que o app do piloto já usa.',
      },
      {
        tipo: 'correcao',
        titulo: 'Datas do relatório do período',
        texto: 'O cabeçalho e o nome do arquivo mostravam o intervalo escolhido no filtro, mesmo que fosse bem maior que o período real. Agora mostram a data do primeiro e do último voo que de fato aconteceram.',
      },
    ],
  },
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

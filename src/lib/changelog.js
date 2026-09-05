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
    versao: '4.2',
    data: '2026-09-04',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Erro ao salvar edição com vírgula decimal',
        texto: 'Digitar uma área como "12,06" no painel derrubava o salvamento com erro do banco. Nos campos que aceitavam era pior: salvava e o sistema lia 12, perdendo os centavos sem avisar. Agora vírgula e ponto valem os dois.',
      },
      {
        tipo: 'correcao',
        titulo: 'Voo parcial ficava de fora do relatório da fazenda',
        texto: 'O consolidado só considerava voo finalizado, então o hectare aplicado em Finalizado Parcial não entrava e o avanço da fazenda parecia menor do que era. Agora os dois contam.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Tabela de talhões mostra total, aplicada e bordadura',
        texto: 'A tabela do consolidado ganhou as colunas Área Total e Bordadura, e o status passou a distinguir FINALIZADO de PARCIAL pela área coberta — não pelo rótulo do voo. Ao gerar o relatório dá pra escolher se os talhões não iniciados entram na tabela, com o status NÃO INICIADO.',
      },
      {
        tipo: 'novo',
        titulo: 'Relatório consolidado abre com um resumo executivo',
        texto: 'A primeira página do relatório da fazenda deixou de ser uma folha de rosto e virou um painel: área aplicada, volume, vazão média e tempo total em destaque, barra de avanço da fazenda, balanço de talhões com os pendentes, rendimento por piloto e equipamento, e o balanço de insumos do período. As páginas seguintes seguem com o detalhe de cada voo, como antes.',
      },
      {
        tipo: 'novo',
        titulo: 'Função / classe do produto',
        texto: 'O cadastro de produtos ganhou o campo Função / Classe (Herbicida, Adjuvante, Fungicida...). Ele aparece na tabela de insumos do relatório consolidado. Produto sem classe preenchida sai com "—".',
      },
      {
        tipo: 'novo',
        titulo: 'Dados cadastrais da empresa no rodapé',
        texto: 'Configurações → Dados da Empresa agora guarda razão social, CNPJ, cidade/UF e os registros MAPA e ANAC, que passam a sair no rodapé do relatório consolidado. O que ficar em branco simplesmente não é impresso.',
      },
    ],
  },
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

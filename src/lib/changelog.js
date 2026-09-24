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
    versao: '5.7',
    data: '2026-09-23',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'As fotos do Relatorio do Periodo agora ficam guardadas',
        texto: 'Antes as fotos so existiam enquanto o modal estava aberto: fechou, perdeu, e pra reemitir o relatorio era preciso escolher tudo de novo. Agora cada foto e salva assim que voce escolhe, fica vinculada aquela fazenda e volta sozinha na proxima emissao. O X remove de vez. As fotos sao reduzidas antes de subir — uma foto de celular de 4 MB vira cerca de 260 KB, sem perda visivel no PDF, que era o cuidado que faltava pra nao repetir o estouro de banda de agosto.',
      },
    ],
  },
  {
    versao: '5.6',
    data: '2026-09-23',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Lista de fazendas errada no app do piloto',
        texto: 'Dois pilotos viram listas erradas: um enxergou TODAS as fazendas mesmo com 4 talhoes atribuidos, e outro nao viu NENHUMA. Eram dois lados do mesmo problema — o app decidia a permissao antes dos dados chegarem. Lista de atribuicao vazia significa "sem restricao, ve tudo", entao enquanto a consulta nao voltava (ou o piloto estava sem sinal) o app liberava tudo. E quem tinha fazenda cadastrada ha poucos dias nao a via, porque o aparelho ainda tinha a lista antiga guardada. Agora a permissao tem memoria propria no aparelho, e o app so libera a lista inteira quando confirma que o piloto realmente nao tem restricao. Quando a fazenda atribuida nao chega no aparelho, aparece um aviso com botao de atualizar, em vez de a tela ficar em branco sem explicacao.',
      },
      {
        tipo: 'novo',
        titulo: 'Filtro de situacao dos talhoes na atribuicao',
        texto: 'Na coluna de talhoes entrou o filtro Todos / Pendentes / Feitos, com a contagem em cada botao. Pendentes e a lista que interessa na hora de distribuir servico; Feitos serve pra conferir o que ja saiu.',
      },
    ],
  },
  {
    versao: '5.5',
    data: '2026-09-22',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'Atribuicao de pilotos com cara nova',
        texto: 'A tela ganhou os tres passos no topo (Piloto, Fazenda, Talhoes) mostrando onde voce esta, busca nas tres colunas, avatar com as iniciais de cada piloto, e cadeado nas etapas ainda bloqueadas. A coluna da fazenda mostra a area total e quantos outros pilotos respondem por ela; a dos talhoes tem o rodape com "X de Y selecionados" e a area somada. Embaixo, um resumo do que esta atribuido. O "Fazenda inteira" saiu da coluna do meio e virou a primeira linha da coluna de talhoes, que e onde a decisao acontece.',
      },
      {
        tipo: 'novo',
        titulo: 'Filtrar fazendas por situacao na atribuicao',
        texto: 'A coluna da fazenda ganhou tres filtros: Todas, Deste piloto (pra revisar o que alguem ja tem sem rolar 60 fazendas) e Sem piloto, que mostra no proprio botao quantas ficaram de fora — a pergunta que ninguem conseguia responder olhando a lista inteira.',
      },
      {
        tipo: 'novo',
        titulo: 'Marcar talhoes em lote e ver o que ja foi aplicado',
        texto: 'Cada talhao agora mostra se ja esta FEITO ou PARCIAL no ciclo atual, usando a mesma conta do relatorio do cliente (inclusive o rateio de voo que cobriu varios talhoes). E dao pra marcar em lote: Marcar todos, Limpar, e So pendentes — que marca de uma vez apenas os talhoes que ainda faltam aplicar, que e o caso normal de atribuicao. Com a busca ativa, os botoes agem so nos talhoes visiveis.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Tudo salva sozinho, sem botao de confirmar',
        texto: 'Cada caixinha marcada grava na hora, e o rodape mostra "Salvo automaticamente". Nao existe botao de confirmar de proposito: numa tela de marcar caixinha, o que se perde por esquecer de confirmar custa mais do que a confirmacao protege.',
      },
    ],
  },
  {
    versao: '5.4',
    data: '2026-09-21',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Fazenda pronta aparecia como Parcial com a barra em 100%',
        texto: 'FAZENDA ALAMBARI e MONTE ALTO mostravam o selo Parcial com a barra cheia em 100%. Duas causas. A primeira: faltavam 0,01 ha (100 m2) na ALAMBARI e o selo exigia 100% exato, entao sobra de arredondamento segurava a fazenda em Parcial pra sempre. Agora vale uma tolerancia de 0,05 ha. A segunda: a barra e o % ja somavam a bordadura, mas os hectares ao lado mostravam so a area aplicada — por isso "342,5 / 367,7" aparecia junto de "100%" sem fechar. Agora os dois usam a mesma base (aplicada + bordadura), e passando o mouse aparece a divisao entre as duas.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Tamanho da gota tambem vem do cadastro do drone',
        texto: 'O bloco PARAMETROS DE APLICACAO do drone ganhou TAMANHO DA GOTA (micras), junto de velocidade, altura, faixa e vazao. Ao escolher o drone, o piloto ja encontra os cinco preenchidos no Passo 3.',
      },
    ],
  },
  {
    versao: '5.3',
    data: '2026-09-21',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Campos do drone e do produto sumiam ao reabrir o cadastro',
        texto: 'Os parametros do drone (velocidade, altura, faixa, vazao) e a FUNCAO/CLASSE do produto salvavam no banco, mas voltavam em branco ao reabrir o cadastro — parecia que nao tinham sido salvos. O formulario montava uma lista fixa de campos e descartava esses. Agora eles aparecem preenchidos. Quem ja tinha cadastrado os parametros nao perdeu nada: o dado estava la o tempo todo.',
      },
    ],
  },
  {
    versao: '5.2',
    data: '2026-09-21',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Atribuicao de pilotos em 3 colunas, ate o talhao',
        texto: 'Fazendas & Clientes > Equipes virou uma tela de tres colunas: escolhe o piloto, depois a fazenda, e marca a fazenda inteira ou so os talhoes dele. A mesma fazenda pode ter varios pilotos, cada um com os seus talhoes — a coluna do meio mostra quantos outros pilotos respondem por ela, e a dos talhoes mostra quem mais divide o mesmo talhao. Marcar a fazenda inteira vale tambem pros talhoes cadastrados depois. O Kanban e a visao por Times sairam.',
      },
      {
        tipo: 'novo',
        titulo: 'Parametros padrao por drone',
        texto: 'No cadastro do drone (Inventario) entrou o bloco PARAMETROS DE APLICACAO: velocidade, altura, faixa e vazao. Ao escolher o drone, o piloto ja encontra os quatro preenchidos no Passo 3, e pode alterar. Em branco, continua valendo o padrao geral de Configuracoes do Sistema — o do drone e mais especifico e ganha dele.',
      },
      {
        tipo: 'novo',
        titulo: 'Excluir fazendas em lote',
        texto: 'Na Visao Geral de Fazendas apareceu uma caixinha por linha e o botao Excluir selecionadas. O "marcar todas" respeita o filtro e a busca ativos. Antes de apagar, a confirmacao mostra quantos talhoes vao junto (eles somem com a fazenda) e quantos voos ficam sem cadastro — os voos continuam em Relatorios, mas o consolidado daquela fazenda deixa de calcular progresso.',
      },
    ],
  },
  {
    versao: '5.1',
    data: '2026-09-21',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Produtos padrao por fazenda',
        texto: 'No cadastro da fazenda (Fazendas & Clientes) entrou o bloco PRODUTOS PADRAO: escolha os produtos que aquela fazenda usa e a dose de cada um. Ao selecionar a fazenda, o piloto ja encontra tudo preenchido no Passo 2 — e pode trocar, ajustar a dose ou remover normalmente, e so um ponto de partida. A dose vem sozinha do cadastro do produto quando voce escolhe, mas da pra ajustar ali: e a dose daquela fazenda, que nem sempre e a mesma do inventario. Fazenda sem produtos padrao continua como antes, com o campo em branco.',
      },
    ],
  },
  {
    versao: '5.0',
    data: '2026-09-20',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Varias fotos no Relatorio do Periodo',
        texto: 'O campo de foto da fazenda agora aceita quantas fotos voce quiser: da pra escolher varias de uma vez, e cada clique em "Adicionar mais fotos" acrescenta sem perder as que ja estavam. As miniaturas aparecem numeradas e cada uma tem o X pra remover. No PDF elas saem numa grade na pagina "Geral da Fazenda", sem legenda. Se escolher "Na pagina 1", a capa continua enxuta com uma foto so ao lado do mapa e as demais vao pra pagina de fotos. Passando de 10 fotos, o relatorio abre uma folha de continuacao.',
      },
    ],
  },
  {
    versao: '4.9',
    data: '2026-09-20',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Ordenar e filtrar a lista de Relatorios de Voo',
        texto: 'Clique no cabecalho de qualquer coluna (Cliente, Fazenda, Talhao, Piloto, Drone, Status, Data, Tempo ou Custo) pra ordenar; clique de novo pra inverter. Entrou tambem um filtro por Talhao ao lado dos outros — digitando "002" acha todos os 002-xx. Voo sem o dado da coluna (sem tempo calculado, sem despesa, sem talhao) fica sempre no fim da lista, nas duas direcoes: ordenando por menor tempo o que interessa e o voo mais curto, nao um bloco de linhas em branco na frente.',
      },
      {
        tipo: 'melhoria',
        titulo: 'A lista de voos passa a mostrar a data do voo',
        texto: 'A coluna DATA e o filtro De/Ate usavam a data em que o registro foi criado, nao a do voo. Eram a mesma coisa ate a data virar editavel — hoje 25 dos 179 voos ja tem as duas diferentes, ate 3 dias. Agora os dois usam a data de inicio do voo, a mesma que manda no consolidado da fazenda, no dashboard e no relatorio do periodo. Corrigir a data de um voo passa a mover ele na lista tambem.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Talhoes em ordem em todas as listas',
        texto: 'Os talhoes sao uma mistura: a maioria vem zerada a esquerda (001-01 a 037-01), mas tem TALHAO 01 a 06 e alguns com nome livre. Em ordem de texto, TALHAO 10 vinha antes de TALHAO 2, e o " 017-01" (cadastrado com um espaco na frente) pulava pro topo de toda lista. Agora a ordem e natural em todas as telas, e os talhoes de um voo saem em ordem em vez da ordem de clique.',
      },
    ],
  },
  {
    versao: '4.8',
    data: '2026-09-19',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'Data e hora do voo agora sao editaveis',
        texto: 'No Editar Relatorio apareceu a secao Data e Hora, com inicio e fim do voo. E a data de inicio que coloca o voo no periodo — ela manda no filtro de datas, no consolidado da fazenda e no dashboard — e a diferenca entre as duas e o tempo de voo. Se o fim ficar antes do inicio, a tela avisa antes de salvar.',
      },
    ],
  },
  {
    versao: '4.7',
    data: '2026-09-15',
    itens: [
      {
        tipo: 'novidade',
        titulo: 'Log de Atividades (Desenvolvedor)',
        texto: 'Nova tela em Desenvolvedor > Log de Atividades, so para admin: mostra quem entrou no app e o que cada um usou, com filtro de periodo, por pessoa e por funcionalidade. Serve para medir o que esta sendo usado de verdade antes de decidir onde investir. O registro comecou em 15/09/2026 — datas anteriores nao tem dados.',
      },
    ],
  },
  {
    versao: '4.6',
    data: '2026-09-13',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'Acesso aos dados operacionais agora respeita o perfil',
        texto: 'Sete tabelas — despesas, viagens, veículos, manutenções, agendamentos, estoque e registro de localização — estavam liberadas para qualquer um que tivesse o endereço do sistema, mesmo sem entrar. Agora cada uma respeita o perfil de quem pede: o piloto enxerga o que é dele, admin e supervisor enxergam tudo, e quem não está logado não enxerga nada. Nada muda no dia a dia de quem usa o app — cada tela continua mostrando exatamente o que mostrava.',
      },
    ],
  },
  {
    versao: '4.5',
    data: '2026-09-13',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'App parou de rebaixar a mesma foto várias vezes',
        texto: 'Cada tela que mostrava uma foto pedia um endereço novo pro Supabase, e endereço novo faz o navegador baixar tudo de novo. Rolar uma lista, reabrir um relatório ou gerar o consolidado duas vezes rebaixava as mesmas imagens: 16,67 GB de tráfego num mês com 590 MB de fotos guardadas — cada arquivo desceu 28 vezes. Foi isso que estourou a cota e derrubou o app em agosto. Agora o endereço é reaproveitado e a segunda visualização não custa tráfego nenhum.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Fotos mais leves, sem perder nada no relatório',
        texto: 'A foto agora é guardada com até 1280px e cerca de 400 KB, em vez de 1920px e 1 MB. No PDF ela sai com 7 a 13 cm de largura, o que a 200 dpi pede uns 1000px — o que foi cortado era detalhe que nunca chegava ao papel, mas pesava em toda visualização. O piloto não muda nada no que faz.',
      },
    ],
  },
  {
    versao: '4.4',
    data: '2026-09-11',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Ordenar a lista de fazendas',
        texto: 'Em Fazendas & Clientes → Visão Geral dá pra ordenar por fazenda, progresso, área ou data do ciclo, crescente ou decrescente. Clique no cabeçalho da coluna na tabela, ou use o seletor ao lado de Tabela/Cards — que também funciona no modo Cards e no celular, onde a tabela rola pro lado. Fazenda sem talhão cadastrado e fazenda sem ciclo iniciado ficam sempre no fim da lista, nas duas direções: ordenando por progresso crescente o que interessa é quem tem menos avanço, não um bloco de linhas sem dado na frente.',
      },
    ],
  },
  {
    versao: '4.3',
    data: '2026-09-08',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Bordadura volta a sair de dentro da área feita',
        texto: 'A bordadura é lançada como parte do que o piloto percorreu, não ao lado dela: percorreu 20 ha e 5 foram bordadura, então aplicou 15. Essa conta chegou a ser invertida por engano e o relatório passou a somar a bordadura por fora. Voltou ao certo. Junto, a linha de áreas passou a abrir o PERCORRIDO em vez do escopo do voo: onde saía Tot 23,47 · Bord 5,00 · Aplic 20,00 — e 23,47 era o saldo que o piloto pegou, não o que ele voou — agora sai Tot 20,00 · Bord 5,00 · Aplic 15,00, com os três números fechando entre si. Vale no PDF, no Word e no texto do WhatsApp. No Passo 5 o piloto passa a ver os três enquanto digita.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Relatório da fazenda inteiro na horizontal',
        texto: 'A primeira página era a única em pé: quem abria o PDF girava a tela nela e desgirava na seguinte. Agora o documento todo sai deitado. Deitada, a folha ganha largura e perde altura, então o resumo passou de duas para três colunas — talhões, pilotos e insumos lado a lado — e a barra de avanço virou o quinto cartão da linha de indicadores. Nada saiu do relatório, só mudou de lugar. Na página de fotos, a imagem da fazenda e o mapa também ficam lado a lado.',
      },
      {
        tipo: 'correcao',
        titulo: 'Nome comprido escrevia por cima da assinatura',
        texto: 'Na faixa de assinatura do relatório de voo, nome que passava de 55mm vazava por cima do texto ao lado — acontecia com PAULO HENRIQUE SERRA MUNIZ e com ISAEL MATEUS SERRA MUNIZ. Agora a letra diminui o quanto precisar para caber, em vez de cortar ou invadir.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Texto do WhatsApp mostra só o que aquele piloto fez',
        texto: 'Num talhão dividido entre duas frentes, a linha de áreas trazia o tamanho cadastrado ao lado ("Talhão 50,87 ha | Neste voo 39,17 ha") e o cliente lia o número maior como pendência daquele piloto. Agora sai só o voo: Tot 39,17 | Bord 1,37 | Aplic 37,80 — e os três fecham entre si. Quem soma o montante do talhão é o relatório consolidado da fazenda.',
      },
      {
        tipo: 'correcao',
        titulo: 'Talhão continuado por outro piloto vinha com a área cheia',
        texto: 'Quem pegava um talhão já iniciado herdava o escopo inteiro do primeiro piloto — um talhão de 50,87 ha com 11,7 já feitos abria de novo com 50,87. Agora o campo ÁREA já vem com o saldo (39,17 no exemplo), e a lista de talhões mostra em destaque quanto falta, não o tamanho total. O atalho "Continuar (nome do piloto)" saiu: cada frente lança o que fez, e o consolidado soma.',
      },
      {
        tipo: 'correcao',
        titulo: 'Avanço da fazenda não chegava a 100%',
        texto: 'A barra de avanço media só a área pulverizada, então uma fazenda com todos os talhões fechados parava em 94% por causa da bordadura. Agora o avanço mede a área coberta (aplicada + bordadura) e o resumo mostra as duas parcelas separadas.',
      },
      {
        tipo: 'correcao',
        titulo: 'Bordadura estava sendo descontada duas vezes',
        texto: 'A área aplicada de um voo já vem sem a bordadura — ela é lançada à parte. O sistema descontava de novo no PDF, no texto do WhatsApp e na baixa de estoque, então saía menos hectare e menos produto do que o piloto usou de fato, e o talhão aparecia como parcial mesmo estando fechado. Agora os números fecham: aplicada + bordadura = a área do voo. Basta gerar o relatório de novo.',
      },
      {
        tipo: 'novo',
        titulo: 'Coluna de talhão na lista de relatórios',
        texto: 'Em Administrativo & Financeiro → Relatórios, o talhão agora aparece em coluna própria, sem precisar abrir o detalhe de cada voo.',
      },
    ],
  },
  {
    versao: '4.2',
    data: '2026-09-05',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'Mapa do relatório com imagem de satélite',
        texto: 'O mapa da fazenda no relatório consolidado agora sai sobre imagem de satélite, com os trajetos por cima. Dá pra usar os KML dos próprios voos ou enviar arquivos na hora de gerar — um KML com a fazenda inteira ou vários, um por talhão, dá no mesmo. Sem internet, o mapa sai como desenho: o relatório nunca fica sem ele.',
      },
      {
        tipo: 'correcao',
        titulo: 'Talhão que só deixou bordadura estava saindo como parcial',
        texto: 'A área aplicada já desconta a bordadura, então um talhão percorrido por inteiro aparecia com área menor que a cadastrada e era marcado PARCIAL. Agora bordadura conta como coberto: se só ela ficou, o talhão está FINALIZADO.',
      },
      {
        tipo: 'novo',
        titulo: 'Voo compartilhado entre dois pilotos',
        texto: 'No Passo 1 o piloto escolhe se vai cobrir o talhão sozinho ou dividido com outra frente. Em compartilhado, o campo ÁREA passa a ser a parcela dele — não o talhão inteiro —, e é ela que o relatório usa pra dividir a área entre os pilotos. Quem termina em Finalizado Parcial vira compartilhado automaticamente, porque o saldo vai sobrar pra outra frente. No relatório, o talhão dividido aparece com "2 frentes" ao lado do nome.',
      },
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

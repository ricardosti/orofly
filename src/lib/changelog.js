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
    versao: '7.6',
    data: '2026-10-02',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Grafico Recebido x Gasto por mes',
        texto: 'No painel, em Custos, entrou o grafico dos ultimos 6 meses comparando o que entrou com o que saiu. Recebido e o faturamento da operacao (area voada x preco por hectare do cliente), nao dinheiro na mao do piloto. Gasto sao as despesas lancadas no mes. O grafico mostra o mes inteiro e NAO segue os filtros da tela de proposito — filtrar por um piloto deixaria a barra vermelha menor por recorte, e nao por resultado. Voo parcial e cobrado pelo que foi voado de verdade, nao pelo tamanho do talhao.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Aviso quando falta preco no cadastro do cliente',
        texto: 'Se algum voo do periodo for de cliente sem preco por hectare cadastrado, o grafico avisa quantos voos e quantos hectares ficaram de fora da conta. Sem esse aviso a barra verde apareceria menor que a realidade e daria a impressao de prejuizo.',
      },
    ],
  },
  {
    versao: '7.5',
    data: '2026-10-02',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Forma de pagamento e tipo de combustivel',
        texto: 'Ao lancar a despesa, agora voce informa como pagou: Pix, Cartao, Dinheiro ou Boleto. Escolhendo Cartao, aparece o campo pra dizer QUAL cartao — e ele sugere os que voce ja usou antes, sem precisar digitar tudo de novo. Quando a categoria e Combustivel, da pra separar Diesel, Gasolina, Etanol ou Arla: o mesmo abastecimento leva diesel pra camionete e gasolina pro gerador ou pro drone.',
      },
      {
        tipo: 'novo',
        titulo: 'Conferencia do financeiro',
        texto: 'No painel, em Custos, cada despesa ganhou o botao "Conferir". Ele serve pro financeiro marcar que o lancamento bate com a fatura do cartao — nao e status de pagamento, porque o piloto ja pagou na hora. Clicar de novo desfaz, e fica guardado quem conferiu e quando. Tem filtro pra ver so o que falta conferir. O piloto nao consegue marcar a propria despesa como conferida.',
      },
      {
        tipo: 'melhoria',
        titulo: 'A chave da nota agora trava duplicata de verdade',
        texto: 'A chave lida do QR Code passou a ter lugar proprio no cadastro. Antes o aviso de "essa nota ja foi lancada" so enxergava as notas que estavam carregadas na tela; agora vale pra equipe toda.',
      },
    ],
  },
  {
    versao: '7.4',
    data: '2026-10-02',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'As datas das despesas apareciam um dia antes',
        texto: 'Uma nota lancada no dia 12 aparecia como 11 — no app do piloto, no painel, nas viagens e nas manutencoes. Era erro de fuso horario: a data vinha do banco sem hora e era lida como horario de Londres, o que no Brasil cai no dia anterior. Pior que o texto errado: a despesa do dia 1o do mes caia no mes anterior e sumia do filtro "este mes", sem ninguem perceber. Corrigido em todos os lugares.',
      },
      {
        tipo: 'novo',
        titulo: 'Categorias novas de despesa',
        texto: 'Entraram Combustivel, Alimentacao, Manutencao, Pecas e Ferramentas, junto com Hotel, Pedagio e Outros. As notas ja lancadas continuam como estao (com Almoco e Gasolina) pra nao bagunçar os relatorios antigos — elas seguem aparecendo normalmente, com o icone certo.',
      },
      {
        tipo: 'novo',
        titulo: 'Total e filtros junto da lista de notas',
        texto: 'Na lista de notas do piloto agora tem o total em destaque, com os botoes Este mes / 30 dias / Tudo, e botoes de categoria pra ver quanto saiu so de combustivel, so de hotel e assim por diante. Antes esse total so existia numa tela separada.',
      },
      {
        tipo: 'novo',
        titulo: 'Comprovante em PDF',
        texto: 'Alem de camera e galeria, da pra anexar um PDF — que e como o posto costuma mandar a nota por e-mail. O arquivo e guardado com a extensao certa e aparece identificado na lista.',
      },
    ],
  },
  {
    versao: '7.3',
    data: '2026-10-01',
    itens: [
      {
        tipo: 'novo',
        titulo: 'O app le o valor e a data do texto da nota',
        texto: 'Depois de fotografar a nota, aparece o botao "Ler valor e data do texto da nota". Ele le o que esta impresso e preenche o valor total e a data — inclusive em nota SEM QR Code, como DANFE e comprovante de pedagio. Em DANFE ele tambem le a chave de acesso impressa e tira dela o CNPJ. Funciona offline e nao gasta internet. Leva uns segundos, por isso fica sob botao: voce decide quando vale. CONFIRA O VALOR antes de salvar — leitura automatica erra de vez em quando, principalmente em cupom apagado.',
      },
    ],
  },
  {
    versao: '7.2',
    data: '2026-10-01',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Tirar o piloto da fazenda sem abrir uma por uma',
        texto: 'Em Fazendas & Clientes > Equipes, ao escolher um piloto aparecem dois botoes no cartao dele. "Tirar o que ja terminou" remove so os talhoes ja concluidos, em todas as fazendas de uma vez, e mantem o que ainda falta — fazenda inteira so sai quando TODOS os talhoes dela fecharam. "Liberar de tudo" tira o piloto de tudo de uma vez, com confirmacao. Antes era preciso abrir fazenda por fazenda pra achar o botao de limpar. Desvincular nao apaga voo nem relatorio: so tira da lista, e da pra atribuir de novo.',
      },
      {
        tipo: 'novo',
        titulo: 'O app le o QR Code da nota fiscal',
        texto: 'Ao tirar a foto de uma nota no Cadastro de Notas, o app procura o QR Code sozinho. Achando, mostra o numero da nota, o CNPJ de quem emitiu e o mes da emissao, e avisa se essa nota JA foi lancada antes — o erro mais comum em prestacao de contas. O botao "Usar estes dados" preenche o que a nota informou e guarda a chave na observacao. Importante: o QR das notas de hoje (versao 2) traz a chave mas NAO traz o valor nem o dia exato, entao esses dois continuam sendo preenchidos a mao; em nota de emissor antigo (versao 1) o valor vem junto. Nada disso e obrigatorio: se nao ler, preenche como sempre e a foto e guardada igual.',
      },
    ],
  },
  {
    versao: '7.1',
    data: '2026-09-28',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Corte livre na foto, alem do retangular',
        texto: 'No editor de foto, "Cortar" agora tem dois jeitos. RETANGULO e o de sempre, arrastando os cantos verdes. LIVRE e novo: voce contorna com o dedo a parte que quer manter e o contorno fecha sozinho — bom pra recortar um talhao torto, que nunca cabe num retangulo. O que fica fora do contorno sai branco, e a foto e cortada no menor retangulo que envolve o seu desenho, sem sobrar moldura. Se nao gostou, "Desfazer" volta a foto inteira.',
      },
    ],
  },
  {
    versao: '7.0',
    data: '2026-09-28',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'Pincel bem mais grosso pra PINTAR',
        texto: 'No editor de foto o pincel ia ate 30 pixels, bom pra riscar e ruim pra pintar area — preencher uma gleba virava dezenas de passadas. O teto subiu pra 128 pixels (10% da largura da foto). No mapa tambem aumentou. A bolinha ao lado da barra continua mostrando o tamanho real antes de voce riscar.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Altitude junto da coordenada no mapa',
        texto: 'A altitude saiu da linha de baixo e passou a ficar colada na coordenada da mira, que e onde o piloto olha. Quando a tela e estreita ela desce uma linha em vez de espremer a coordenada — a longitude nunca fica cortada.',
      },
    ],
  },
  {
    versao: '6.9',
    data: '2026-09-28',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Voltar pra terminar um voo parcial agora mostra o que falta',
        texto: 'Quem parava um talhao de 100 ha com 70 feitos e voltava depois pra terminar via a barra dizendo "faltam 100" — como se nada tivesse sido feito. Agora os campos perguntam o de HOJE e a barra mede o que RESTA do voo: volta marcando 30, e ao marcar "Fiz o talhao todo" fecha em 100%. Embaixo da barra aparece o tamanho real do talhao e quanto ja foi feito antes.',
      },
      {
        tipo: 'correcao',
        titulo: 'Confirmar sem digitar nada nao apaga mais o que ja foi feito',
        texto: 'No mesmo caso acima, se o piloto abrisse o voo parcial e confirmasse sem preencher, o app gravava zero por cima do que ja estava salvo e o trabalho do dia anterior sumia do relatorio. Agora o que voce informa e SOMADO ao que o voo ja tinha, nunca substitui. Vale tambem pra bordadura.',
      },
    ],
  },
  {
    versao: '6.8',
    data: '2026-09-28',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Desenhar no mapa',
        texto: 'O mapa ganhou lapis. Abra o menu de tres pontinhos e escolha "Desenhar no mapa" pra riscar em cima da folha: contornar um obstaculo, marcar onde parou, circular a area que ficou pra tras. Um dedo risca e dois dedos continuam movendo e girando o mapa; no PC tem o botao "Mover" pra arrastar. Os riscos ficam colados no mapa, entao acompanham zoom, arraste e rotacao, e ficam guardados NO APARELHO junto com aquele mapa — nao vao pro servidor, nao gastam internet e continuam la quando voce abrir de novo. Tem Desfazer e Limpar.',
      },
      {
        tipo: 'novo',
        titulo: 'Pincel de qualquer grossura e qualquer cor',
        texto: 'No mapa e tambem no editor de foto, a grossura do traco virou uma barra que vai de fino a bem grosso, com uma bolinha mostrando o tamanho real antes de riscar. As 4 cores fixas viraram 5 atalhos (vermelho, amarelo, verde, branco e preto) mais uma barra em degrade pra escolher qualquer cor do arco-iris.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Zoom do mapa com bem mais detalhe',
        texto: 'O mapa passou a ser aberto em resolucao quase o dobro da anterior (de 2200 para 4000 pixels no lado maior), entao da pra aproximar muito mais e ainda ler o numero do talhao. Como o mapa fica guardado no aparelho e e usado offline, isso nao gasta internet nenhuma. Em aparelho que nao aguentar a resolucao maxima, o app reduz sozinho em vez de abrir o mapa em branco.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Altitude em destaque no mapa',
        texto: 'A altitude ja existia, mas ficava no fim de uma linha cinza e ninguem achava. Agora aparece como uma etiqueta propria na barra de baixo. O "~" lembra que o GPS do celular erra bem mais na altura do que na posicao — a diferenca pode passar de dezenas de metros.',
      },
    ],
  },
  {
    versao: '6.7',
    data: '2026-09-28',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Quem continua um talhao parcial agora ve 100%',
        texto: 'Num talhao de 100 ha com 30 ja feitos por outro voo, o piloto fechava os 70 que faltavam e a barra ainda dizia "Falta 30,00" — o talhao estava fechado e o desenho insistia que nao. A barra media contra o talhao inteiro; agora a referencia e o SALDO que voce pegou, entao fechar o que faltava da 100%. O tamanho real do talhao e o quanto ja foi feito antes aparecem como legenda embaixo da barra.',
      },
      {
        tipo: 'correcao',
        titulo: 'Os percentuais das faixas agora somam 100',
        texto: 'Num talhao de 100 ha com 96,5 pulverizados e 3,5 de bordadura, a barra mostrava 97% + 4% = 101% — os dois valores terminavam em ",5" e arredondavam pra cima juntos. Agora a sobra do arredondamento e distribuida pra fechar 100 certinho.',
      },
    ],
  },
  {
    versao: '6.6',
    data: '2026-09-27',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'No parcial, a bordadura SOMA ao que voce pulverizou',
        texto: 'O campo perguntava "quanto voce percorreu hoje" e descontava a bordadura de dentro desse numero. So que o piloto le o numero do controle da DJI, que e o PULVERIZADO: quem digitava 2 e 1 esperava 3 ha entregues e via 1. Agora a pergunta e "quanto voce pulverizou hoje" e a bordadura soma — pulverizado + bordadura e o pedaco do talhao resolvido hoje. Quem marca "Fiz o talhao todo" segue como antes, com a bordadura saindo de dentro da area do talhao.',
      },
      {
        tipo: 'melhoria',
        titulo: 'A barra do talhao mostra hectare e percentual',
        texto: 'Cada faixa passou a mostrar o percentual dentro da propria cor e, na legenda, o hectare junto com o percentual. No rodape entrou o total entregue — o numero que o piloto procurava e nao existia em lugar nenhum da tela. Faixa pequena demais pra arredondar mostra "<1%" em vez de "0%", que parecia erro de conta.',
      },
      {
        tipo: 'correcao',
        titulo: 'Exportar a Sequencia voltou a funcionar',
        texto: 'Os botoes de PDF e WhatsApp da tela Sequencia davam erro e nao geravam nada. Junto, nomes com travessao (como "CAMBUI II - ANGATUBA") saiam sem o traco no PDF, porque a fonte padrao nao tem esse caractere.',
      },
    ],
  },
  {
    versao: '6.5',
    data: '2026-09-27',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Exportar a Sequencia em PDF e WhatsApp',
        texto: 'A tela Sequencia ganhou os dois botoes. O PDF sai no formato da planilha que a operacao ja usava: uma faixa por modalidade, cada fazenda numa linha com talhoes, area, realizado, em aberto e percentual, fechamento de cada grupo e total geral no rodape. O WhatsApp manda o mesmo conteudo em texto, com uma barra de avanco e um icone por fazenda (concluida, executando ou na fila), e leva o PDF anexado junto. Os dois exportam exatamente o que esta na tela — se voce escolheu fazendas, vao so elas.',
      },
    ],
  },
  {
    versao: '6.4',
    data: '2026-09-27',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'Finalizar voo: um botao so, e agora com desenho',
        texto: 'Acabou a escolha entre "Finalizar" e "Finalizado Parcial" — o parcial ainda ficava escondido num menu de tres pontinhos. Agora e um botao so. Ao finalizar, a primeira coisa que aparece e a pergunta "Fiz o talhao todo", ja marcada. Marcada: voce so informa a bordadura e o talhao fecha. Desmarcada: informa quanto percorreu hoje, e o resto fica pra outro voo.',
      },
      {
        tipo: 'novo',
        titulo: 'Desenho do talhao na hora de finalizar',
        texto: 'Entrou uma barra com tres faixas que sempre somam o talhao inteiro: verde e o que foi PULVERIZADO, amarelo e a BORDADURA e listrado e o que FALTA. Ela responde a duvida que mais confundia: a bordadura conta como talhao entregue, so nao recebeu produto. Antes isso era texto; agora da pra ver. A barra muda enquanto voce digita, entao erro de preenchimento aparece na hora — se o desenho nao fechar o talhao, tem numero errado.',
      },
    ],
  },
  {
    versao: '6.3',
    data: '2026-09-27',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Menu Sequencia',
        texto: 'Nova tela em Voos & Operacoes > Sequencia, pra montar a rodada de trabalho. Escolha o periodo (ultimo dia, 7 dias, 15 dias ou personalizado), marque as fazendas que entram e acompanhe, por modalidade, quantos talhoes, quanta area, quanto ja saiu e quanto falta — com o percentual de cada fazenda, o total de cada modalidade e o geral. Cada fazenda mostra o status: Executando quando teve voo no periodo, Sequencia quando foi escolhida e ainda nao comecou, Concluida quando fechou. A contagem de talhoes mostra o total e, em verde, quantos foram trabalhados no periodo.',
      },
      {
        tipo: 'novo',
        titulo: 'Cadastro de culturas',
        texto: 'Entrou a aba Culturas no Inventario. Antes a lista era fixa no codigo e, pior, eram DUAS listas diferentes: o app do piloto tinha 14 culturas e a calculadora do painel tinha 8. Agora e um cadastro so, usado pelos dois. Da pra incluir, renomear, desativar e definir a ordem em que aparecem pro piloto. As 14 que ja existiam foram carregadas na mesma ordem de antes.',
      },
    ],
  },
  {
    versao: '6.2',
    data: '2026-09-27',
    itens: [
      {
        tipo: 'melhoria',
        titulo: 'Data em branco no Relatorio do Periodo = todo o historico',
        texto: 'Antes, gerar sem preencher as datas dava o aviso "Escolha o periodo" e nao saia nada. Agora campo em branco quer dizer sem limite: deixando os dois vazios entra todo o historico da fazenda, e a tela avisa isso em verde. Da pra preencher so um lado tambem — so o DE traz dali em diante, so o ATE traz tudo ate aquela data.',
      },
    ],
  },
  {
    versao: '6.1',
    data: '2026-09-27',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Atalho "Todo o periodo" no Relatorio do Periodo',
        texto: 'Entrou o botao "Todo o periodo" junto de Ultimos 7d, 30d e Mes atual. Ele comeca no primeiro voo daquela fazenda, entao pega tudo sem voce precisar saber a data e digitar na mao. Faz diferenca em fazenda que ficou parada um tempo: a ESTIVA, por exemplo, tem 12 voos e nenhum deles cai dentro dos ultimos 30 dias.',
      },
    ],
  },
  {
    versao: '6.0',
    data: '2026-09-27',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Fazenda mostrava porcentagem menor que a do relatorio',
        texto: 'A GLEBA B aparecia com 73% na lista de Fazendas e 99,99% no relatorio da mesma fazenda. O relatorio estava certo: a lista ignorava os voos em Finalizado Parcial, e havia um voo assim com 52,74 ha aplicados. Voo parcial aplicou area de verdade — o piloto voou, o produto saiu, so nao terminou o talhao naquele dia. Agora ele conta em todo lugar que mede area, progresso ou horas: lista de fazendas, dashboard, area do periodo e horas por drone. So nao conta na notificacao de "finalizou um voo", que e evento e nao medida. Alguns numeros do dashboard vao SUBIR por isso — estavam menores que a realidade.',
      },
    ],
  },
  {
    versao: '5.9',
    data: '2026-09-25',
    itens: [
      {
        tipo: 'novo',
        titulo: 'Medir area e distancia no mapa',
        texto: 'No menu do mapa entraram "Medir area (hectares)" e "Medir distancia". Funciona pela mira do centro: arraste o mapa ate o canto que quer marcar e toque em "Marcar ponto na mira" — no celular, mirar e mais preciso que acertar o dedo na tela. A area aparece em hectares com o perimetro, e a distancia em metros ou km, atualizando a cada ponto. Tem Desfazer, e o desenho acompanha zoom e rotacao. So aparece com o mapa calibrado, porque sem calibracao a conta seria inventada.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Altitude do GPS no mapa',
        texto: 'A altitude aparece junto da distancia ate a mira. Vem com "~" de proposito: a altitude do GPS de celular erra dezenas de metros, bem mais que a posicao no plano, entao serve de referencia e nao para decisao.',
      },
      {
        tipo: 'correcao',
        titulo: 'GPS deslocado ao reaproveitar um mapa ja usado',
        texto: 'Quando o mapa da fazenda era trocado por um novo, o celular continuava desenhando o mapa ANTIGO — e a bolinha do GPS saia fora do lugar. Subir o mapa na hora funcionava porque ali o arquivo novo estava em memoria. A causa: o arquivo no servidor tem caminho fixo e o mapa guardado no aparelho era identificado so pela fazenda, entao trocar o mapa nao invalidava nada. Agora cada envio gera uma versao e o aparelho busca o arquivo certo. Os mapas ja guardados vao ser baixados de novo na primeira abertura, o que ja corrige quem esta com mapa errado hoje.',
      },
      {
        tipo: 'novo',
        titulo: 'Apagar o mapa do aparelho',
        texto: 'No menu do mapa entrou "Apagar mapa do aparelho", pra liberar espaco no celular depois que o servico acaba. O mapa continua guardado no sistema e e baixado de novo na proxima vez que abrir. Trocar o mapa tambem passa a limpar sozinho as versoes antigas, que antes ficavam ocupando espaco pra sempre.',
      },
      {
        tipo: 'correcao',
        titulo: 'Coordenada da mira e centro do mapa errados no mapa da fazenda',
        texto: 'No mapa vindo do cadastro da fazenda, a leitura de coordenada da mira saia corrompida e o centro do mapa dava resultado invalido. Os limites do mapa vem do banco como texto, e em JavaScript somar texto com numero junta os dois em vez de somar — "-22,80481" + 0,007 virava "-22,804810,007". O mapa carregado direto do aparelho nunca teve isso, porque ali os numeros vem do proprio arquivo.',
      },
    ],
  },
  {
    versao: '5.8',
    data: '2026-09-25',
    itens: [
      {
        tipo: 'correcao',
        titulo: 'Finalizado Parcial: da pra ver o saldo e fechar o talhao',
        texto: 'Ao retomar um voo parcial, o campo se chamava AREA FEITA ATE AGORA e o piloto entendia que era o total do talhao. So que ele so aceita o saldo daquele voo — quem digitava 100 num talhao de 100 via o numero virar 65 sem nenhuma explicacao. Agora o campo se chama AREA FEITA NESTE VOO, aparece em cima quanto o talhao tem, quanto ja foi aplicado antes e qual o saldo, e embaixo a soma acumulada com um visto verde quando o talhao fecha. Se o numero digitado passar do saldo, a tela diz que cortou e por que. E entrou o botao "Fiz o talhao todo", que preenche o saldo inteiro de uma vez.',
      },
      {
        tipo: 'melhoria',
        titulo: 'Pincel da marcacao de foto mais grosso',
        texto: 'O traco fino saia com 0,3 mm no PDF impresso, quase invisivel. Agora sao tres espessuras (Fino, Medio e Grosso), o padrao e o Medio, e a espessura acompanha o tamanho da foto — antes o mesmo traco ficava fino numa foto grande e grosso numa pequena.',
      },
    ],
  },
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

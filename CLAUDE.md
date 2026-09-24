# Orofly — como tocar o projeto

Guia de operação do projeto. Escrito em **29/08/2026** na máquina antiga, antes da
migração para o Dell, e corrigido com o que a montagem do Dell revelou: o
`JAVA_HOME` da seção 5 e a tabela de versões da seção 6 mudaram.

Entre **30/08** e **23/09/2026** o projeto rodou em duas máquinas (o Dell e um
Asus com Ubuntu). O Asus saiu de cena, então as instruções de Ubuntu e o aviso
sobre conflito entre máquinas foram removidos — se um dia voltar a ser duas, o
histórico está no Git.

Fica no repositório de propósito — assim sobrevive à próxima troca de máquina, e
chega junto no `git clone`.

---

## 1. O essencial em três linhas

- **Deploy no Vercel = `git push`.** Não existe comando de deploy. A Vercel está
  ligada ao repositório do GitHub e publica sozinha a cada push na branch `main`.
- **Todo o código está no GitHub.** Nada de valor mora só na máquina, exceto os
  3 arquivos de segredo listados na seção 3.
- **O app roda em três lugares** a partir do mesmo código: web (Vercel), APK de
  teste (instalado à mão) e Play Store (via arquivo `.aab`).

---

## 2. Stack e onde as coisas ficam

| O quê | Onde |
|---|---|
| Código | GitHub — `ricardosti/orofly` |
| Pasta local | `C:\orofly` |
| Front-end | React 18 (Create React App), **estilos inline**, sem Tailwind |
| Banco / login / storage | Supabase |
| Hospedagem web | Vercel → orofly.vercel.app |
| App Android | Capacitor (empacota o mesmo site) |

Duas telas concentram quase tudo:

- `src/pages/PilotApp.jsx` — app do piloto (o wizard de 5 passos)
- `src/pages/AdminPanel.jsx` — painel administrativo

E dois arquivos geram os relatórios:

- `src/lib/pdf.js` — PDF e Word
- `src/lib/reportTemplates.js` — texto do WhatsApp

> **Regra de estilo:** o projeto usa apenas estilos inline. Não introduza
> Tailwind nem arquivos CSS — o padrão é copiar o estilo do componente vizinho.

---

## 3. Os 3 arquivos que não estão no GitHub

Estão no zip `orofly-SEGREDOS-backup-2026-08-26.zip`, já no Google Drive.

| Arquivo | Para quê |
|---|---|
| `android/app/orofly-release.keystore` | Assina o app para a Play Store |
| `android/keystore.properties` | Senhas dessa chave |
| `.env.local` | Chaves do Supabase, VAPID e Meteoblue |

Para restaurar: descompacte o zip **por cima da pasta `orofly`** já clonada. A
estrutura de pastas do zip já corresponde à do projeto, então cada arquivo cai
no lugar certo sozinho.

> Sobre o keystore: a conta usa **Play App Signing**, ou seja, o Google guarda a
> chave real e essa é apenas a chave de *upload*. Se ela sumir, dá para pedir
> reset ao Google — leva alguns dias, mas não se perde o app.

---

## 4. Montando a máquina nova

```bash
git clone https://github.com/ricardosti/orofly.git
cd orofly
npm install
```

Depois descompacte o zip dos segredos por cima da pasta. **Sem o `.env.local` o
app sobe mas não conecta no Supabase** — parece quebrado, e não é.

**Só para gerar APK/AAB:** o `android/local.properties` também não vem no clone (é
gitignored) e sem ele o Gradle para com *"SDK location not found"*. Ele tem uma linha
só, apontando para o SDK do Android:

```
sdk.dir=C:/Users/ricar/AppData/Local/Android/Sdk
```

Barras normais funcionam — não precisa escapar nada.

**O que instalar:** Node.js (aqui roda o v24), Git, Claude Code e — apenas se
for gerar APK — o Android Studio mais o **JDK 21** (ver seção 5: o JDK que vem
dentro do Android Studio não serve mais).

O Claude Code instala pelo npm:

```bash
npm install -g @anthropic-ai/claude-code
```

**Contas para logar:** GitHub, Supabase, Vercel e Play Console. Todas na nuvem;
nada fica preso na máquina antiga. O Claude Code usa a conta Anthropic — não é
licença por máquina.

> **A primeira vez que o `git push` rodar numa máquina nova, ele vai pedir
> autenticação do GitHub.** No Windows abre uma janela do Credential Manager.
> Depois disso fica guardado.

---

## 5. O fluxo de trabalho de sempre

Esta é a sequência usada em toda alteração, na ordem:

```bash
# 0. sincroniza (rápido, e evita surpresa se algo foi alterado pelo painel do GitHub)
git pull

# 1. compilar e conferir que não quebrou nada
CI=true npx react-scripts build

# 2. publicar na web (a Vercel faz o resto sozinha)
git add -A
git commit -m "descrição da mudança"
git push
```

Se a alteração também precisa ir para o Android:

```bash
# 3. copiar o site compilado para dentro do projeto Android
npx cap sync android

# 4. gerar o APK de teste
cd android
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" ./gradlew assembleDebug

# 5. gerar o arquivo da Play Store (só quando for publicar)
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" ./gradlew bundleRelease
```

Esse `JAVA_HOME` é o do Dell. Se o Temurin for atualizado, o número da pasta muda
e o comando quebra — confira o caminho real em `C:\Program Files\Eclipse Adoptium`.

> **Não use o `jbr` do Android Studio.** Funcionava na versão antiga, mas o Android
> Studio Quail 3 (2026.1.3) traz **JBR 25**, e o AGP 8.13 + Gradle 8.14.3 deste
> projeto não aceitam: quebra com `Unsupported class file major version 69`
> (69 = Java 25). Use o Temurin 21 — se esse erro aparecer, é JDK novo demais.

**Onde os arquivos aparecem:**

- APK de teste → `android/app/build/outputs/apk/debug/app-debug.apk`
- Arquivo da loja → `android/app/build/outputs/bundle/release/app-release.aab`

> **Nunca dê `git push` sem pedido explícito.** A regra combinada é: commit
> local sempre, push só quando o Ricardo disser "sobe".

---

## 6. Versões — onde mexer

Hoje o app está assim:

| Onde | Valor atual | Para que serve |
|---|---|---|
| `src/lib/version.js` (`APP_VERSION`) | `4.0` | Texto da tela de login **e** do rodapé do painel admin |
| `android/app/build.gradle` | `versionCode 10` | Número interno da Play Store |
| `android/app/build.gradle` | `versionName "4.0"` | Versão que o usuário vê |

Para virar a versão, mude **só o `src/lib/version.js`** e, se for publicar na loja,
suba também o `versionName` e o `versionCode`.

> O número já esteve escrito à mão em dois pontos do JSX e desandou: a tela de
> login foi pra `v3.9` e o rodapé do painel admin ficou em `v3.8`, com o
> `package.json` num terceiro valor. Daí a fonte única. O `package.json` não dá
> pra importar do front — o CRA bloqueia import de fora da pasta `src/`.

> **Regra crítica do `versionCode`:** ele precisa aumentar de 1 em 1 a cada envio
> para a Play Store, e o Google **queima** o número mesmo em envio abandonado ou
> que ficou como rascunho. Se der erro de "versão já usada", é só subir mais um.

---

## 7. Publicando na Play Store (teste fechado)

1. Play Console → app Orofly → **Testar e lançar** → **Teste** → **Fechado**
2. Abrir a faixa **Alpha** → **Criar nova versão**
3. Arrastar o `app-release.aab`
4. Preencher as notas da versão → **Salvar**
5. **Ir para a visão geral da publicação**
6. **Enviar mudança para revisão** ← *este é o passo que já foi esquecido antes*

> O passo 6 é obrigatório. Sem ele a versão fica salva como rascunho e **os
> testadores continuam recebendo a versão antiga** — foi exatamente o que
> aconteceu com o `versionCode 8`.

Quem instalou pela Play Store atualiza pela Play Store. Para trocar por um APK
avulso é preciso **desinstalar antes**, porque a assinatura é diferente.

---

## 8. Supabase — dois pontos de atenção

**Cota de banda.** Em 26/08/2026 o projeto estourou o limite do plano grátis
(16,67 GB de 5,5 GB) e o Supabase **derrubou todas as requisições** — o app
parou de logar e a mensagem na tela dizia "E-mail ou senha incorretos", que era
enganosa. Foi resolvido com upgrade pago de um mês.

A causa tinha duas metades, e as duas foram corrigidas:

1. **Fotos sem compressão** (3–8 MB direto da câmera). Resolvido quando o editor
   de imagem entrou no fluxo do piloto: hoje toda foto passa pelo
   `ImageAnnotator`, que limita a 1280 px no lado maior e ~400 KB. A média
   mensal caiu de 1918 KB (agosto) para 351 KB (setembro).
2. **A mesma foto sendo rebaixada sem parar** — a metade que ninguém tinha visto,
   e a maior. Cada componente chamava `createSignedUrl` no próprio `useEffect`, e
   o Supabase devolve um token novo a cada chamada: URL diferente, o navegador
   baixa de novo. Medido em 13/09/2026: 16,67 GB de banda para 590 MB guardados —
   cada arquivo desceu ~28 vezes. Resolvido em `src/lib/storageUrl.js`, que
   guarda a URL por caminho.

> **Ao trocar uma foto, chame `esquecerUrl(path)`** depois do upload. Os uploads
> usam `upsert: true` no mesmo caminho, e sem isso o cache serve a imagem antiga.

**RLS (segurança por linha).** A tabela `relatorios` tem políticas que limitam
cada piloto aos próprios voos. Foi preciso adicionar uma política extra de
leitura para todos os pilotos autenticados, senão o progresso de um talhão
trabalhado por outro piloto ficava invisível — sem erro nenhum na tela, só
sumia.

Em **13/09/2026** o linter do Supabase acusou **7 tabelas com RLS desligado**:
`despesas`, `gps_logins`, `movimentos_estoque`, `agendamentos`, `veiculos`,
`viagens` e `manutencoes_veiculo`. Como a chave `anon` vai dentro do site
publicado, qualquer um podia ler e alterar tudo nelas — inclusive os 3.315
registros de localização dos pilotos. Corrigido com políticas que reproduzem o
que o app já fazia.

Três coisas aprendidas ali, que valem pra próxima tabela:

- **`supervisor` também cai no AdminPanel** (abre na aba Agenda). Política escrita
  só pra `admin` esconde a agenda da equipe dele. O recorte certo é
  `role IN ('admin','supervisor')`.
- **Revogar de `anon` não adianta**: o `EXECUTE` de uma função vem de `PUBLIC`,
  que o anônimo herda. Tem que ser `REVOKE ... FROM PUBLIC` e depois
  `GRANT ... TO authenticated`.
- **Função `SECURITY DEFINER` é porta lateral em volta do RLS.** A
  `registrar_movimento_estoque` roda como `postgres` (é assim que o piloto dá
  baixa no estoque sem ter acesso à tabela), mas estava exposta em
  `/rest/v1/rpc/` para o anônimo. Ligar RLS sem olhar as funções não resolve.

> **Antes de ligar RLS numa tabela**, veja quem escreve nela de verdade. Vale
> testar no SQL Editor assumindo o papel, com `set_config('role','authenticated')`
> e `set_config('request.jwt.claims', ...)`, dentro de um bloco que termina em
> `RAISE EXCEPTION` — assim o teste roda de verdade e desfaz tudo no fim.

**Log de atividades.** Desde **15/09/2026** a tabela `atividades` registra o que
cada um faz no app (login, iniciou voo, lançou despesa...), e a tela fica em
**Desenvolvedor → Log de Atividades**, só para admin. Serve pra medir o que é
usado de verdade.

O registro sai de `src/lib/atividade.js`. **Para instrumentar uma ação nova:**

1. Acrescente o slug em `ACOES` naquele arquivo (rótulo, ícone e área) — é o que
   dá nome à linha na tela; sem isso ela aparece com o slug cru.
2. Chame `registrar('slug', 'detalhe legível', { cliente, meta })` no ponto em
   que a ação **acontece de verdade**, não onde a tela abre.

Duas regras que valem a pena respeitar:

- **Registre ação deliberada, nunca navegação.** Log de cada tela aberta vira
  ruído e ainda gasta banda, que já foi problema aqui em agosto.
- **Não registre dentro de `saveToSupabase`.** Ele é chamado pelo autosave e pela
  retentativa offline — o mesmo voo apareceria várias vezes. Os registros ficam
  nos pontos onde o piloto decide algo.

> O login é gravado dentro de `signIn`, e não no `onAuthStateChange`: esse último
> também dispara quando o token se renova sozinho (~1h), o que encheria o log de
> "entrou no app" que nunca aconteceu.

> **Lição que se repetiu duas vezes:** o cliente do Supabase **não lança
> exceção** em erro de query — ele devolve `{ data: null, error }`. Código que lê
> só o `data` transforma qualquer falha em tela parada e silenciosa. Sempre leia
> o `error`.

---

## 9. Como o app calcula as áreas

Vale entender antes de mexer em qualquer coisa de relatório.

- **Área aplicada** — o que o piloto voou de fato naquele voo.
- **Área não aplicada** — parte do que estava previsto e não foi feito. O piloto
  escolhe o motivo, e o motivo decide o destino: **Bordadura** vai para o campo
  de bordadura do relatório; qualquer outro motivo vira texto na Observação.
- **Área líquida** = área aplicada − bordadura. É ela que multiplica a dose para
  calcular o total de produto.
- **Finalizado Parcial** — o piloto encerra o dia sem terminar o talhão. O voo
  fica salvo e pode ser retomado depois, inclusive **por outro piloto**.
- Ao selecionar um talhão que já teve aplicação, o campo **ÁREA (HA)** recebe o
  **saldo** (o que falta), não o tamanho cheio do talhão.

---

## 10. Pendências em aberto

**Decisões que dependem do Wallace:**

1. **Formato do PDF.** No relatório do WhatsApp, um voo parcial mostra os dois
   números ("Talhão 100 ha | Neste voo 40 ha"). O PDF ainda mostra só o escopo do
   voo, porque o gerador de PDF não recebe o cadastro dos talhões. Falta decidir
   o formato e então ajustar.
2. **O nome do campo "ÁREA NÃO APLICADA".** Antes se chamava "Bordadura", mas
   como o motivo pode ser Obstáculo ou Vento, o nome antigo ficava errado nesses
   casos. Confirmar se o Wallace concorda.

**Técnicas:**

3. **Segurança do login** — hoje é só e-mail e senha, sem confirmação de e-mail
   nem 2FA. Dois passos baratos, os dois só configuração no painel do Supabase:
   o *rate limit* (Auth → Rate Limits) e a proteção contra senha vazada
   (Auth → Password, checa contra o HaveIBeenPwned), que o linter ainda acusa.
4. **Miniaturas nas listas** — onde só se precisa de preview, ainda se baixa a
   foto inteira. Depende de o plano ter transformação de imagem no Storage.
5. **Faxina no histórico** — 65 arquivos acima de 2 MB, de agosto, somam 281 MB:
   81% do peso do mês em 35% dos arquivos. Boa parte é FAZENDA TESTE.

---

## 11. Backups já feitos (não perder)

| O quê | Onde está |
|---|---|
| Segredos do Orofly | Google Drive — `orofly-SEGREDOS-backup-2026-08-26.zip` |
| Conversas e memória do Claude | `claude-migracao-2026-08-29.zip` |
| WhatsApp do S25 + fotos + Downloads | HD externo, pasta `D:\s25` (34,55 GB, 92.208 arquivos) |

O backup do WhatsApp inclui os arquivos `chave.txt` — **sem eles os `.crypt15`
não podem ser decifrados**, e não existe cópia no Google Drive.

---

## 12. Como o Ricardo gosta de trabalhar

- **Responder sempre em português.**
- **Commit sempre, push nunca sem pedir.** O push só acontece quando ele diz
  "sobe" naquela mesma mensagem.
- **Não avisar que o deploy terminou** — ele acompanha pelo painel da Vercel.
- **Comandos destrutivos de `adb`** (`pm clear`, `uninstall`) exigem confirmação
  explícita antes, mesmo no meio de uma depuração.
- **Testar antes de subir.** Quando não dá para logar no app, vale rodar a
  função isolada no Node com dados de exemplo e mostrar a saída — evita
  retrabalho e ele valida na hora.

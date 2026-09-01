# Orofly — como tocar o projeto

Guia de operação do projeto. Escrito em **29/08/2026** na máquina antiga, antes da
migração para o Dell, e corrigido com o que a montagem do Dell revelou: o
`JAVA_HOME` da seção 5 e a tabela de versões da seção 6 mudaram.

Em **30/08/2026** ganhou as instruções de Ubuntu, para o Asus virar a segunda
máquina de trabalho — e com elas a regra do `git pull` na seção 5, que passou a
ser obrigatória.

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

**O que instalar:** Node.js (aqui roda o v24), Git, Claude Code e — apenas se
for gerar APK — o Android Studio mais o **JDK 21** (ver seção 5: o JDK que vem
dentro do Android Studio não serve mais).

O Claude Code instala pelo npm, igual nos dois sistemas:

```bash
npm install -g @anthropic-ai/claude-code
```

**Contas para logar:** GitHub, Supabase, Vercel e Play Console. Todas na nuvem;
nada fica preso na máquina antiga. O Claude Code usa a conta Anthropic — não é
licença por máquina.

### No Ubuntu (o Asus)

Node pelo repositório da NodeSource, porque o `apt` padrão traz uma versão velha:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs git
```

JDK 21 pelo Temurin (só se for gerar APK/AAB):

```bash
sudo apt install -y wget apt-transport-https && wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public | sudo tee /etc/apt/trusted.gpg.d/adoptium.asc && echo "deb https://packages.adoptium.net/artifactory/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/adoptium.list && sudo apt update && sudo apt install -y temurin-21-jdk
```

O caminho do `JAVA_HOME` muda entre distros — em vez de decorar, descubra:

```bash
readlink -f $(which javac) | sed 's|/bin/javac||'
```

> **A primeira vez que o `git push` rodar numa máquina nova, ele vai pedir
> autenticação do GitHub.** No Windows abre uma janela do Credential Manager; no
> Linux o mais simples é instalar o `gh` (`sudo apt install gh`) e rodar
> `gh auth login`, que configura o Git junto. Depois disso fica guardado.

---

## 5. O fluxo de trabalho de sempre

Esta é a sequência usada em toda alteração, na ordem:

```bash
# 0. SEMPRE começar por aqui — ver o aviso das duas máquinas abaixo
git pull

# 1. compilar e conferir que não quebrou nada
CI=true npx react-scripts build

# 2. publicar na web (a Vercel faz o resto sozinha)
git add -A
git commit -m "descrição da mudança"
git push
```

> **Duas máquinas, um repositório.** Desde 30/08/2026 o projeto roda no Dell e no
> Asus (Ubuntu). O código mora no GitHub, então as duas veem tudo — mas se você
> editar o mesmo arquivo nos dois sem sincronizar, o segundo `git push` é
> recusado e vira conflito à toa. **O `git pull` do passo 0 não é opcional.**
>
> Se o push for recusado mesmo assim, é porque a outra máquina subiu algo no meio
> do caminho: `git pull --rebase` e depois `git push` resolve na maioria dos casos.

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

Esse `JAVA_HOME` é o do **Dell (Windows)**. No Ubuntu o caminho é outro — descubra
com o `readlink` da seção 4 e troque; o resto do comando é idêntico.

> **Não use o `jbr` do Android Studio.** Funcionava na versão antiga, mas o Android
> Studio Quail 3 (2026.1.3) traz **JBR 25**, e o AGP 8.13 + Gradle 8.14.3 deste
> projeto não aceitam: quebra com `Unsupported class file major version 69`
> (69 = Java 25). Use o Temurin 21 — se esse erro aparecer, é JDK novo demais.
> Vale nos dois sistemas.

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

A causa: **as fotos sobem sem nenhuma compressão**, direto da câmera (3–8 MB
cada), e são rebaixadas em resolução cheia toda vez que alguém abre um
relatório. **Comprimir a imagem antes do upload** (redimensionar para ~1600 px,
JPEG 80%) derruba isso umas 15x e faz caber no plano grátis com folga. *Essa
correção ainda não foi feita — é a pendência técnica mais importante.*

**RLS (segurança por linha).** A tabela `relatorios` tem políticas que limitam
cada piloto aos próprios voos. Foi preciso adicionar uma política extra de
leitura para todos os pilotos autenticados, senão o progresso de um talhão
trabalhado por outro piloto ficava invisível — sem erro nenhum na tela, só
sumia.

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

3. **Compressão de imagem no upload** — ver seção 8. É o que evita a cota
   estourar de novo.
4. **Segurança do login** — hoje é só e-mail e senha, sem confirmação de e-mail
   nem 2FA. O passo mais barato é ativar o *rate limit* no painel do Supabase
   (Auth → Rate Limits), que é configuração e não código.

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

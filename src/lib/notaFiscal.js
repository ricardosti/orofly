// Leitura do QR Code / chave de acesso de nota fiscal brasileira (NFC-e e NFe), pra
// pré-preencher o Cadastro de Notas em vez de o piloto digitar tudo na mão.
//
// Por que QR antes de IA: a chave de acesso é EXATA, não adivinhada. Ela já carrega, nas
// próprias posições, o CNPJ de quem emitiu e o ano/mês da emissão — sem chamar API, sem
// chave de serviço, sem internet e sem custo. Modelo de visão fica pro que não tem QR.
//
// O que o QR atual NÃO dá: o valor. Na versão 2 do QR Code da NFC-e (a obrigatória hoje)
// o parâmetro só traz chave, versão, ambiente e hash — o `vNF` existia só na versão 1,
// que ainda aparece em emissor antigo. Então o valor continua manual, e é isso que o
// passo seguinte (OCR do total) vem resolver.
import jsQR from 'jsqr'

// ── Chave de acesso (44 dígitos) ──────────────────────────────────────────────
// Layout oficial: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
const UF_POR_CODIGO = {
  11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',
  24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',
  41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF',
}

// Dígito verificador da chave: módulo 11 com pesos 2..9 ciclando da direita pra esquerda.
// É o que separa uma leitura boa de um OCR que trocou 8 por 3 — sem essa conferência o
// app preencheria o CNPJ errado com cara de certeza.
export function dvDaChave(chave43) {
  let soma = 0, peso = 2
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return (resto === 0 || resto === 1) ? 0 : 11 - resto
}

export function chaveValida(chave) {
  if (!/^\d{44}$/.test(chave || '')) return false
  return dvDaChave(chave.slice(0, 43)) === Number(chave[43])
}

// Quebra a chave nos dados que ela carrega. Não inventa nada: só lê posição.
export function dadosDaChave(chave) {
  if (!chaveValida(chave)) return null
  const cnpj = chave.slice(6, 20)
  const ano = 2000 + Number(chave.slice(2, 4))
  const mes = Number(chave.slice(4, 6))
  const modelo = chave.slice(20, 22)
  return {
    chave,
    uf: UF_POR_CODIGO[Number(chave.slice(0, 2))] || null,
    cnpj,
    cnpjFormatado: cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
    ano, mes,
    // Só o mês da emissão está na chave, não o dia. Vira o 1º dia do mês como PISTA, e a
    // tela avisa — chutar um dia exato seria inventar dado que a nota não deu.
    mesEmissao: `${ano}-${String(mes).padStart(2, '0')}`,
    modelo,                       // 55 = NFe (DANFE), 65 = NFC-e (cupom)
    numero: Number(chave.slice(25, 34)),
  }
}

// ── Conteúdo do QR ────────────────────────────────────────────────────────────
// Formatos que aparecem na prática, e por isso a busca é tolerante:
//   v2 (atual):  ...?p=CHAVE|versao|tpAmb|cIdToken|cHash
//   v1 (antigo): ...?p=CHAVE|versao|tpAmb|cDest|dhEmi|vNF|vICMS|digVal|cIdToken|cHash
//   alguns estados montam a URL de um jeito próprio, e o DANFE às vezes traz só a chave.
// Por isso o caminho principal é "procura 44 dígitos e confere o DV", e os campos extras
// do `p=` são bônus quando existirem.
export function parseConteudoQr(texto) {
  const bruto = String(texto || '')
  const avisos = []

  // Qualquer sequência de 44 dígitos no conteúdo, com ou sem separador.
  const candidatos = (bruto.replace(/[\s.-]/g, '').match(/\d{44}/g) || [])
  const chave = candidatos.find(chaveValida)
  if (!chave) {
    return { ok: false, motivo: candidatos.length
      ? 'achei uma sequência de 44 dígitos, mas o dígito verificador não bate — leitura provavelmente errada'
      : 'não é um QR de nota fiscal (não tem chave de acesso)', avisos, textoBruto: bruto }
  }

  const dados = dadosDaChave(chave)
  let valor = null, dataEmissao = null

  // Campos do `p=` — só a versão 1 traz data e valor.
  const p = /[?&]p=([^&\s]+)/.exec(bruto)?.[1]
  if (p) {
    const campos = decodeURIComponent(p).split('|')
    const versao = campos[1]
    if (versao === '1' && campos.length >= 7) {
      const dh = campos[4], vNF = parseFloat(campos[5])
      if (dh && /^\d{4}-\d{2}-\d{2}/.test(dh)) dataEmissao = dh.slice(0, 10)
      if (Number.isFinite(vNF) && vNF > 0) valor = vNF
    } else {
      avisos.push('QR versão 2: traz a chave, mas não o valor nem o dia da emissão')
    }
  } else {
    avisos.push('QR sem os parâmetros da SEFAZ — aproveitei só a chave')
  }

  return { ok: true, origem: 'qrcode', chave, ...dados, valor, dataEmissao, avisos, textoBruto: bruto }
}

// ── Leitura da imagem ─────────────────────────────────────────────────────────
// Dois caminhos: o BarcodeDetector nativo (rápido, é o do próprio Android) e o jsQR como
// reserva. A reserva não é luxo — o detector nativo não existe em todo navegador de
// desktop, e é no desktop que a conferência das notas acontece.
async function lerComDetectorNativo(bitmap) {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null
  try {
    const formatos = await window.BarcodeDetector.getSupportedFormats?.() || []
    if (formatos.length && !formatos.includes('qr_code')) return null
    const det = new window.BarcodeDetector({ formats: ['qr_code'] })
    const achados = await det.detect(bitmap)
    return achados?.[0]?.rawValue || null
  } catch { return null }
}

function lerComJsQr(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  // `attemptBoth` cobre o cupom fotografado contra a luz, que sai com as cores trocadas.
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null
}

// Desenha a imagem num canvas de no máximo `maxLado`. Foto de celular vem com 3000+ px e
// o jsQR varre pixel a pixel: sem reduzir, trava a tela por segundos no aparelho do piloto.
async function paraCanvas(origem, maxLado = 1400, minLado = 0) {
  const bitmap = origem instanceof Blob ? await createImageBitmap(origem) : origem
  const maior = Math.max(bitmap.width, bitmap.height)
  let escala = Math.min(1, maxLado / maior) || 1
  // Piso de resolução, usado pelo OCR. Ampliar não inventa detalhe nenhum, mas dá ao
  // Tesseract mais pixel por caractere — e só isso já corrigiu leitura errada nos testes:
  // com texto de 20 px ele devolvia "60,80" no lugar de "60,00". Teto de 3x porque acima
  // disso é só borrão caro de processar.
  if (minLado && maior * escala < minLado) escala = Math.min(4, minLado / maior)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  // willReadFrequently: este canvas é lido várias vezes (uma por tentativa do leitor de
  // QR). Sem a dica, o navegador o mantém na GPU e cada leitura obriga uma cópia de
  // volta — ele mesmo avisa no console. Com a dica, o canvas já nasce na memória.
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { canvas, bitmap }
}

// Lê o QR de uma foto de nota. Devolve sempre um objeto — nunca lança, porque isso roda
// durante o lançamento da despesa e falha de leitura não pode travar o piloto.
// Recorta uma faixa do canvas (fração 0–1) num canvas novo. Serve pra dar ao leitor um
// pedaço com o QR grande, em vez da folha inteira onde ele é um detalhe.
function recorte(canvas, x0, y0, x1, y1) {
  const w = Math.round((x1 - x0) * canvas.width), h = Math.round((y1 - y0) * canvas.height)
  if (w < 40 || h < 40) return null
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d', { willReadFrequently: true })
    .drawImage(canvas, Math.round(x0 * canvas.width), Math.round(y0 * canvas.height), w, h, 0, 0, w, h)
  return c
}

export async function lerNotaFiscal(arquivo) {
  try {
    const { canvas, bitmap } = await paraCanvas(arquivo, 1600)
    // 1) Detector nativo na imagem original, que é o caminho mais rápido quando existe.
    let texto = await lerComDetectorNativo(bitmap)
    if (texto) return parseConteudoQr(texto)

    // 2) jsQR em várias tentativas. Nota de campo chega amassada, com dobra atravessando
    // o código e fotografada de longe — numa única passada o leitor desiste fácil.
    // A ordem vai do mais barato ao mais caro, e para na primeira que ler.
    const grande = (await paraCanvas(arquivo, 2600)).canvas
    const tentativas = [
      ['imagem toda', canvas],
      ['imagem ampliada', grande],
      // O QR da NFC-e fica no rodapé do cupom; recortar a metade de baixo faz ele
      // ocupar o dobro da área e muda bastante a chance de leitura.
      ['metade de baixo', recorte(grande, 0, 0.45, 1, 1)],
      ['metade de cima', recorte(grande, 0, 0, 1, 0.55)],
      ['miolo', recorte(grande, 0.1, 0.25, 0.9, 0.85)],
    ]
    for (const [, alvo] of tentativas) {
      if (!alvo) continue
      texto = lerComJsQr(alvo)
      if (texto) return parseConteudoQr(texto)
    }

    // 3) Última cartada: preto e branco. Cupom térmico desbotado e foto contra a luz
    // ficam com contraste fraco, e binarizar às vezes resolve o que o resto não leu.
    try {
      const { binarizar } = await import('./ocrCoordenadas')
      for (const alvo of [recorte(grande, 0, 0.45, 1, 1), grande]) {
        if (!alvo) continue
        const bn = recorte(alvo, 0, 0, 1, 1)   // cópia, pra não estragar o original
        if (!bn) continue
        binarizar(bn)
        texto = lerComJsQr(bn)
        if (texto) return parseConteudoQr(texto)
      }
    } catch { /* binarização indisponível: segue sem ela */ }

    return { ok: false, motivo: 'não achei QR Code nessa foto' }
  } catch (e) {
    return { ok: false, motivo: `não consegui ler a imagem (${e?.message || e})` }
  }
}

// Palpite de categoria pelo ramo do estabelecimento. Fica restrito às 5 categorias que
// existem no app — devolver "Combustível" não encaixaria no select e viraria erro só em
// produção. Sem palpite devolve null, e o piloto escolhe.
const PISTAS_CATEGORIA = [
  [/posto|combust|petrobr|ipiranga|shell|ale\b|texaco|auto\s?posto/i, 'Gasolina'],
  [/pedagio|pedágio|autoban|ecovias|arteris|ccr\b|triunfo|rodovia/i, 'Pedágio'],
  [/hotel|pousada|motel|hospedagem|flat\b/i, 'Hotel'],
  [/restaurante|lanchon|padaria|churrasc|pizzar|bar\b|refei|self\s?service|marmit/i, 'Almoço'],
]
export function palpiteCategoria(nomeEstabelecimento) {
  const n = String(nomeEstabelecimento || '')
  for (const [re, cat] of PISTAS_CATEGORIA) if (re.test(n)) return cat
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// DEGRAU 2 — OCR do texto impresso, pras notas que não têm QR (DANFE, pedágio,
// nota de serviço) e pro VALOR, que o QR versão 2 não traz em nota nenhuma.
//
// Usa o Tesseract que já está no projeto (o mesmo que lê coordenada de mapa), em
// 'eng' e não 'por': o modelo de inglês já foi baixado por aquele uso, e o que
// interessa aqui — dígitos e a palavra TOTAL — é igual nos dois idiomas. Trocar
// custaria mais uns megabytes de download pro piloto sem ganho nenhum.

// Rótulos que antecedem o valor da nota, do mais específico pro mais genérico.
// Quanto mais específico, mais confiança — "VALOR A PAGAR" é inequívoco, "TOTAL"
// sozinho pode ser muita coisa.
const ROTULOS_VALOR = [
  [/VALOR\s*A\s*PAGAR/, 10],
  [/TOTAL\s*A\s*PAGAR/, 10],
  [/VALOR\s*TOTAL/,      8],
  [/TOTAL\s*(R\$|:)/,    7],
  [/\bTOTAL\b/,          5],
]
// Linhas que TÊM a palavra total/valor mas não são o valor da nota. Sem isso, o
// "VALOR APROX DOS TRIBUTOS" que vem no rodapé de todo cupom seria lido como o
// total — é a armadilha mais comum.
const NAO_E_O_TOTAL = /SUBTOTAL|TRIBUTO|ITENS|QTDE|QUANTIDADE|TROCO|DESCONTO|ACRESCIMO|DINHEIRO|CARTAO|PIX|RECEBIDO/

const semAcento = t => String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')

// Converte o que está no papel em número. O formato brasileiro é "1.234,56" — ponto de
// milhar, vírgula decimal — mas o OCR raramente devolve isso limpo: ele troca a vírgula
// por ponto, por espaço, ou come o separador. Um cupom real chegou com "TOTAL" legível e
// o valor ao lado recusado por isso.
//
// O que NÃO se aceita: número sem nenhum separador decimal. "3590" tanto pode ser 35,90
// quanto 3.590,00, e errar por cem no lançamento é pior do que deixar em branco.
function numeroBr(txt) {
  const limpo = String(txt||'').replace(/\s+/g,' ').trim()
  let m
  // 1.234,56 — milhar com ponto, decimal com vírgula (o jeito certo)
  if ((m = /^\d{1,3}(?:\.\d{3})+,\d{2}$/.exec(limpo))) return parseFloat(limpo.replace(/\./g,'').replace(',','.'))
  // 1,234.56 — milhar com vírgula, decimal com ponto (o OCR às vezes inverte)
  if ((m = /^\d{1,3}(?:,\d{3})+\.\d{2}$/.exec(limpo))) return parseFloat(limpo.replace(/,/g,''))
  // 35,90 · 35.90 · 35 90 — dois dígitos depois de um separador qualquer
  if ((m = /^(\d+)[.,\s](\d{2})$/.exec(limpo))) return parseFloat(`${m[1]}.${m[2]}`)
  return null
}

// Teto de sanidade. O OCR confunde vírgula com ponto e transforma 128,90 em 12890;
// acima disso é quase certo erro de leitura, e preencher errado é pior que não
// preencher. O piloto digita, como já fazia.
const TETO_DESPESA = 50000

// Função PURA: recebe o texto que o OCR devolveu e tira dele o que der. Separada
// do Tesseract de propósito — é aqui que mora a chance de errar, e assim dá pra
// testar com cupom de verdade sem depender de imagem nem de navegador.
export function extrairDaNota(texto) {
  const linhas = semAcento(texto).toUpperCase().split(/\r?\n/)
  const achados = { chave: null, valor: null, data: null, avisos: [] }

  // ── Chave de acesso impressa (a nota traz os 44 dígitos em grupos de 4).
  //
  // Antes isto juntava TODOS os dígitos do papel e deslizava uma janela de 44. Não
  // funciona: o dígito verificador passa por acaso em 1 de cada 11 tentativas, e com
  // dezenas de janelas achar lixo "válido" é quase certo. Num cupom real o app leu
  // `0001010000495140055399…` — pedaços do código do produto, do valor e da hora
  // colados — e exibiu um CNPJ que não existia na nota, com cara de certeza.
  //
  // Agora só considera bloco que apareça JUNTO no papel, e dá preferência ao que vem
  // logo depois do rótulo "Chave de Acesso". Os separadores aceitos são espaço, hífen
  // e ponto (como a chave é impressa); barra e dois-pontos NÃO entram, e é isso que
  // impede a data e a hora de se fundirem ao número ao lado.
  const blocosDe44 = (t) => {
    const out = []
    for (const m of String(t).matchAll(/(?<!\d)(?:\d[\s.-]*){44}(?!\d)/g)) out.push(m[0].replace(/\D/g, ''))
    return out
  }
  const semAc = semAcento(texto)
  const linhasAc = semAc.split(/\r?\n/)
  const candidatos = []
  linhasAc.forEach((l, i) => {
    if (/CHAVE\s*DE\s*ACESSO/i.test(l)) candidatos.push(...blocosDe44(linhasAc.slice(i, i + 3).join(' ')))
  })
  candidatos.push(...blocosDe44(semAc))
  achados.chave = candidatos.find(chaveValida) || null
  if (!achados.chave && candidatos.length) {
    achados.avisos.push('achei uma sequência de 44 dígitos, mas o dígito verificador não bate — o OCR trocou algum número')
  }

  // ── Valor total, em três tentativas, da mais confiável pra menos.
  // Aceita vírgula, ponto ou espaço antes dos centavos — o OCR produz os três.
  const numerosDaLinha = (l) => (l.match(/\d{1,3}(?:[.,]\d{3})+[.,]\d{2}|\d+[.,\s]\d{2}/g) || [])
    .map(numeroBr).filter(v => v !== null && v > 0 && v <= TETO_DESPESA)

  // 1) rótulo e número na MESMA linha — o caso bem comportado.
  let melhor = null
  for (const linha of linhas) {
    if (NAO_E_O_TOTAL.test(linha)) continue
    const peso = ROTULOS_VALOR.find(([re]) => re.test(linha))?.[1]
    if (!peso) continue
    const numeros = numerosDaLinha(linha)
    if (!numeros.length) continue
    const v = Math.max(...numeros)
    if (!melhor || peso > melhor.peso || (peso === melhor.peso && v > melhor.valor)) melhor = { valor: v, peso }
  }

  // 2) rótulo numa linha e número na SEGUINTE. Cupom estreito quebra a linha entre o
  // texto e o número, e aí a tentativa 1 não acha nada.
  if (!melhor) {
    for (let i = 0; i < linhas.length; i++) {
      if (NAO_E_O_TOTAL.test(linhas[i])) continue
      const peso = ROTULOS_VALOR.find(([re]) => re.test(linhas[i]))?.[1]
      if (!peso || numerosDaLinha(linhas[i]).length) continue
      for (let k = i + 1; k <= i + 2 && k < linhas.length; k++) {
        if (NAO_E_O_TOTAL.test(linhas[k])) continue
        const n = numerosDaLinha(linhas[k])
        if (n.length) { melhor = { valor: Math.max(...n), peso }; break }
      }
      if (melhor) break
    }
  }

  // 3) Último recurso: o MAIOR valor do papel. O cupom fotografado às vezes sai com
  // todos os rótulos numa coluna e todos os números noutra, sem como parear — foi o
  // caso real de um cupom de lanchonete. Numa nota o total é sempre >= cada item, e
  // as linhas de troco, dinheiro e tributo já ficam de fora pelo NAO_E_O_TOTAL. Só
  // entra se a palavra TOTAL aparecer em algum lugar, pra não chutar em foto que não
  // é nota nenhuma.
  if (!melhor && /\bTOTAL\b/.test(semAcento(texto).toUpperCase())) {
    const todos = linhas
      .filter(l => !NAO_E_O_TOTAL.test(l) && !/\bUN\b\s*X|\bX\s*\d+,\d{2}/.test(l))  // tira linha de item
      .flatMap(numerosDaLinha)
    if (todos.length) {
      melhor = { valor: Math.max(...todos), peso: 1 }
      achados.avisos.push('o valor foi deduzido como o maior do cupom — confira com atenção')
    }
  }

  if (melhor) achados.valor = melhor.valor
  else if (/TOTAL/.test(semAcento(texto).toUpperCase())) {
    achados.avisos.push('achei a palavra TOTAL mas não um valor legível')
    // Deixa no console o que o OCR enxergou perto do TOTAL. Sem isso, "não leu" vira
    // adivinhação — e o formato que o OCR inventa muda de cupom pra cupom.
    try {
      const perto = linhas.filter(l => /TOTAL|VALOR|PAGO/.test(l)).slice(0, 6)
      console.warn('[nota] TOTAL encontrado mas sem valor legível. Linhas lidas:', perto)
    } catch { /* console indisponível */ }
  }

  // ── Data da emissão: prefere a que estiver ao lado de um rótulo de emissão;
  // não achando, a primeira data plausível do papel.
  const hoje = new Date()
  const dataValida = (d, m, a) => {
    if (a < 100) a += 2000
    if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2015) return null
    const dt = new Date(a, m - 1, d)
    if (dt > hoje) return null                       // nota do futuro é leitura errada
    if (dt.getDate() !== d || dt.getMonth() !== m - 1) return null
    return `${a}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  // Em cupom térmico o OCR troca dígito com frequência — num teste real, "28/09/2026"
  // saiu "28/89/2026" (0 lido como 8) e a data era descartada. Quando a leitura não
  // forma data válida, tenta as confusões típicas de dígito. Só aceita se UMA única
  // variante der certo: havendo duas, não dá pra saber qual era, e chutar a data de uma
  // despesa é pior do que deixar em branco.
  const CONFUSOES = { '0':'8', '8':'0', '1':'7', '7':'1', '6':'5', '5':'6', '9':'0' }
  const corrigirData = (dd, mm, aa) => {
    const variantes = new Set()
    for (const [i, parte] of [[0, dd], [1, mm]]) {
      for (let k = 0; k < parte.length; k++) {
        const troca = CONFUSOES[parte[k]]
        if (!troca) continue
        const novo = parte.slice(0, k) + troca + parte.slice(k + 1)
        const iso = i === 0 ? dataValida(+novo, +mm, +aa) : dataValida(+dd, +novo, +aa)
        if (iso) variantes.add(iso)
      }
    }
    return variantes.size === 1 ? [...variantes][0] : null
  }
  const comRotulo = [], soltas = []
  for (const linha of linhas) {
    for (const m of linha.matchAll(/(\d{2})\/(\d{2})\/(\d{2,4})/g)) {
      const iso = dataValida(+m[1], +m[2], +m[3]) || corrigirData(m[1], m[2], m[3])
      if (!iso) continue
      ;(/EMISS|DATA|DT\b/.test(linha) ? comRotulo : soltas).push(iso)
    }
  }
  achados.data = comRotulo[0] || soltas[0] || null
  return achados
}

// Roda o Tesseract na foto e passa o texto pro extrator. Ajusta a resolução antes: foto
// de celular vem com 3000+ px (lento demais no aparelho do piloto) e foto tirada de longe
// vem com o texto pequeno demais pro OCR acertar o dígito.
export async function lerNotaPorOcr(arquivo, aoProgredir) {
  let worker = null
  try {
    // Teto 3000 e piso 2000. O teto subiu porque foto de celular chega com 3000+ px e
    // reduzir pra 2400 jogava fora justamente o detalhe dos dígitos da chave, que são
    // pequenos. O piso existe pro contrário: abaixo de ~30 px por caractere o OCR troca
    // 0 por 8 no valor, e valor errado é pior que valor em branco.
    const { canvas } = await paraCanvas(arquivo, 4200, 3200)
    const { createWorker } = await import('tesseract.js')
    worker = await createWorker('eng', 1, aoProgredir ? { logger: aoProgredir } : undefined)

    // Duas passadas, e NÃO uma só binarizada.
    //
    // A binarização (preto no branco, por um limiar fixo) salva o cupom térmico
    // desbotado, mas DESTRÓI a foto bem iluminada: o traço fino do valor some junto com
    // o reflexo do papel. Numa nota nítida de restaurante o OCR devolvia "LR EI CL : ld"
    // no lugar de "TOTAL R$ 35,90".
    // Então tenta como a foto veio e, só se não sair nada aproveitável, tenta binarizada.
    const tentar = async (alvo) => {
      const { data } = await worker.recognize(alvo)
      const achados = extrairDaNota(data?.text || '')
      return { achados, texto: data?.text || '', util: !!(achados.chave || achados.valor) }
    }
    let r = await tentar(canvas)
    if (!r.util) {
      const { binarizar } = await import('./ocrCoordenadas')
      // Copia pra não estragar o canvas original, que pode ser reaproveitado.
      const copia = document.createElement('canvas')
      copia.width = canvas.width; copia.height = canvas.height
      copia.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0)
      binarizar(copia)
      const r2 = await tentar(copia)
      if (r2.util) r = r2
    }
    const achados = r.achados
    return { ok: !!(achados.chave || achados.valor || achados.data), origem: 'ocr', ...achados,
             ...(achados.chave ? dadosDaChave(achados.chave) : {}), textoBruto: r.texto }
  } catch (e) {
    return { ok: false, motivo: `não consegui ler o texto da nota (${e?.message || e})` }
  } finally {
    try { await worker?.terminate() } catch { /* worker já caiu: nada a fazer */ }
  }
}

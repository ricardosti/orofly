// v3.6 — build 2024-06-02
import jsPDF from 'jspdf'

async function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function fetchImageBase64(supabase, bucket, path) {
  if (!path || !supabase) return null
  try {
    const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120)
    if (error || !signed?.signedUrl) return null
    const res = await fetch(signed.signedUrl)
    if (!res.ok) return null
    return await toBase64(await res.blob())
  } catch { return null }
}

function addUnit(key, val) {
  if (!val || val === '—') return val || '—'
  const units = { faixa:'m', vazao:'L/ha', vento:'km/h', umidade:'%', temperatura:'°C', delta_t:'' }
  const unit = units[key] || ''
  if (!unit || /[a-zA-Z°%\/]/.test(val)) return val
  return val + ' ' + unit
}

// Extrai nome/dose/unidade de uma string "Nome - 0.6 L/ha"
export function parseDoseProduto(str) {
  if (!str) return { nome:'', dose:null, unidade:'' }
  const idx = str.indexOf(' - ')
  const nome = idx>=0 ? str.slice(0,idx).trim() : str.trim()
  const resto = idx>=0 ? str.slice(idx+3) : ''
  const m = resto.match(/([\d.,]+)\s*([a-zA-Zµ%]*)/)
  const dose = m ? parseFloat(m[1].replace(',','.')) : null
  const unidade = (m?.[2]||'').replace(/\/ha$/i,'')
  return { nome, dose, unidade }
}

// Área líquida aplicada = soma dos talhões (area_ha) − bordadura (ha)
export function areaLiquida(rel) {
  const bruta = parseFloat(rel.area_ha)||0
  const bord = parseFloat(rel.bordadura)||0
  return Math.max(0, +(bruta-bord).toFixed(2))
}

// Total esperado de cada produto = dose (por ha) x área líquida aplicada
export function calcularGastoProdutos(produtos, areaHa) {
  return (produtos||[]).filter(Boolean).map(p => {
    const { nome, dose, unidade } = parseDoseProduto(p)
    const total = (dose!=null && areaHa>0) ? +(dose*areaHa).toFixed(2) : null
    return { produto:p, nome, dose, unidade: unidade||'L', total }
  })
}

export async function gerarPDFRelatorio(rel, { supabase, localObsFotos, localFotoMapa } = {}) {
  const doc = new jsPDF({ orientation:'p', unit:'mm', format:'a4' })
  const pw = 210, margin = 14
  let y = 0

  doc.setFillColor(17,26,20); doc.rect(0,0,pw,28,'F')
  doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold')
  doc.text('OROFLY', margin, 13)
  doc.setFontSize(8); doc.setFont('helvetica','normal')
  doc.setTextColor(138,173,148); doc.text('Relatório de Operação de Drone', margin, 19)
  doc.setTextColor(200,238,216)
  doc.text(new Date(rel.created_at||Date.now()).toLocaleString('pt-BR'), pw-margin, 19, {align:'right'})
  doc.setFillColor(240,192,64); doc.rect(0,27,pw,1.5,'F')
  y = 35

  function pdfSec(t) {
    if (y>260){doc.addPage();y=20}
    doc.setFillColor(232,245,238); doc.rect(margin,y,pw-margin*2,7,'F')
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(26,122,74)
    doc.text(t.toUpperCase(), margin+3, y+5); y+=9
  }
  function pdfRow(l,v,stripe) {
    if (y>265){doc.addPage();y=20}
    if (stripe){doc.setFillColor(250,252,250);doc.rect(margin,y-1,pw-margin*2,7,'F')}
    doc.setFontSize(8.5); doc.setFont('helvetica','bold'); doc.setTextColor(107,128,112)
    doc.text(l+':', margin+2, y+4)
    doc.setFont('helvetica','normal'); doc.setTextColor(17,26,20)
    const lines = doc.splitTextToSize(String(v||'—'), 108)
    doc.text(lines, margin+44, y+4)
    y += lines.length>1 ? lines.length*5+2 : 8
  }

  const areaBruta = parseFloat(rel.area_ha)||0
  const bordaduraHa = parseFloat(rel.bordadura)||0
  const areaNeta = areaLiquida(rel)
  const gastos = calcularGastoProdutos(rel.produtos, areaNeta)

  pdfSec('Identificação')
  pdfRow('Cliente', rel.cliente, true)
  pdfRow('Fazenda', rel.fazenda, false)
  if (areaBruta) pdfRow('Área Total (talhões)', areaBruta+' ha', true)
  if (bordaduraHa) {
    const detalheTxt = rel.bordadura_detalhe?.length ? ' ('+rel.bordadura_detalhe.map(d=>`${d.talhao}: ${d.bordadura}ha`).join(', ')+')' : ''
    pdfRow('Bordadura', bordaduraHa+' ha'+detalheTxt, false)
  }
  if (areaBruta) pdfRow('Área Aplicada', areaNeta+' ha', true)
  pdfRow('Piloto', rel.piloto_nome, false)
  pdfRow('Drone', rel.drone, true)
  gastos.forEach((g,i) => {
    const doseTxt = g.dose!=null ? `${g.nome} — ${g.dose} ${g.unidade}/ha` : g.produto
    const totalTxt = g.total!=null ? ` → total ${g.total} ${g.unidade}` : ''
    pdfRow('Produto '+(i+1), doseTxt+totalTxt, i%2===0)
  })
  if (rel.tamanho_gota) pdfRow('Tamanho Gota', rel.tamanho_gota, false)
  if (rel.velocidade_drone) pdfRow('Vel. Drone', rel.velocidade_drone, true)
  y+=4

  // Descrição dos produtos (fabricante / registro MAPA / observação do inventário)
  if (supabase && gastos.length) {
    try {
      const nomes = [...new Set(gastos.map(g=>g.nome).filter(Boolean))]
      const { data: produtosInfo } = await supabase.from('produtos').select('nome,fabricante,registro_mapa,obs').in('nome', nomes)
      const descricoes = (produtosInfo||[]).filter(p => p.fabricante||p.registro_mapa||p.obs)
      if (descricoes.length) {
        pdfSec('Descrição dos Produtos')
        descricoes.forEach((p,i) => {
          const partes = [p.fabricante&&`Fabricante: ${p.fabricante}`, p.registro_mapa&&`Registro MAPA: ${p.registro_mapa}`, p.obs].filter(Boolean)
          pdfRow(p.nome, partes.join(' · '), i%2===0)
        })
        y+=4
      }
    } catch(e) { /* descrição é informativa; segue sem ela se a consulta falhar */ }
  }

  pdfSec('Localização')
  pdfRow('Localização', rel.localizacao, true)
  pdfRow('GPS', rel.gps_lat?`${rel.gps_lat}, ${rel.gps_lng}`:'—', false)
  if (rel.gps_lat) pdfRow('Maps', `https://maps.google.com/?q=${rel.gps_lat},${rel.gps_lng}`, true)
  y+=4

  pdfSec('Condições de Aplicação')
  const midX = margin+(pw-margin*2)/2
  const condKeys=[['Faixa','faixa'],['Vazão','vazao'],['Vento','vento'],['Umidade','umidade'],['Temperatura','temperatura'],['Delta T','delta_t']]
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(26,122,74)
  doc.text('INÍCIO', margin+3, y+4); doc.text('FIM', midX+3, y+4); y+=7
  condKeys.forEach(([lbl,key],i) => {
    if (y>265){doc.addPage();y=20}
    if (i%2===0){doc.setFillColor(250,252,250);doc.rect(margin,y-1,pw-margin*2,7,'F')}
    doc.setFontSize(8.5); doc.setFont('helvetica','bold'); doc.setTextColor(107,128,112)
    doc.text(lbl+':', margin+2, y+4); doc.text(lbl+':', midX+2, y+4)
    doc.setFont('helvetica','normal'); doc.setTextColor(17,26,20)
    doc.text(addUnit(key,rel[key+'_i']), margin+28, y+4)
    doc.text(addUnit(key,rel[key+'_f']), midX+28, y+4)
    y+=8
  }); y+=4

  // Tempo de voo
  function calcTempo(ini,fim,pausas) {
    if (!ini||!fim) return null
    const total = Math.round((new Date(fim)-new Date(ini))/60000)
    if (total<=0) return null
    let p = 0
    ;(pausas||[]).forEach(pa => { if(pa.inicio&&pa.fim) p+=Math.max(0,Math.round((new Date(pa.fim)-new Date(pa.inicio))/60000)) })
    const f = m => { const h=Math.floor(m/60),min=m%60; return h>0?`${h}h${String(min).padStart(2,'0')}min`:`${min}min` }
    return { total:f(total), efetivo:f(total-p), temPausa:p>0 }
  }
  const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
  const fmt = v => v?new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'

  pdfSec('Horários')
  pdfRow('Início', fmt(rel.dt_inicio), true)
  pdfRow('Fim', fmt(rel.dt_fim), false)
  if (tempo) { pdfRow('Tempo total', tempo.total, true); if(tempo.temPausa) pdfRow('Tempo efetivo', tempo.efetivo, false) }
  ;(rel.pausas||[]).forEach((p,i) => { pdfRow(`Pausa ${i+1}`, `${p.motivo||'—'} | ${fmt(p.inicio)}${p.fim?' → '+fmt(p.fim):''}`, i%2===0) })
  y+=4

  pdfSec('Observações')
  pdfRow('Observação', rel.obs1 || (rel.obs2 ? rel.obs2 : null), true)
  y+=4

  if (rel.kml_arquivos?.length) {
    pdfSec('Arquivos KML')
    rel.kml_arquivos.forEach((f,i) => pdfRow('Arquivo', f, i%2===0))
    y+=4
  }

  // Fotos
  const obsImgs = []
  if (localObsFotos?.some(Boolean)) {
    localObsFotos.forEach(f => obsImgs.push(f))
  } else if (supabase && rel.obs_fotos_urls?.some(Boolean)) {
    for (const path of rel.obs_fotos_urls) {
      obsImgs.push(path ? await fetchImageBase64(supabase,'relatorios',path) : null)
    }
  }
  const obsValidas = obsImgs.filter(Boolean)
  if (obsValidas.length) {
    if (y>200){doc.addPage();y=20}
    pdfSec('Fotos de Observação')
    const slotW = (pw-margin*2)/3-3
    obsValidas.forEach((img,i) => {
      try {
        const p=doc.getImageProperties(img)
        const r=Math.min(slotW/p.width,55/p.height)
        doc.addImage(img,'JPEG',margin+i*(slotW+3),y,p.width*r,p.height*r)
      } catch(e){}
    }); y+=60
  }

  let mapaImg = localFotoMapa||null
  if (!mapaImg && supabase && rel.foto_mapa_url) mapaImg = await fetchImageBase64(supabase,'relatorios',rel.foto_mapa_url)
  if (mapaImg) {
    if (y>200){doc.addPage();y=20}
    pdfSec('Mapa de Pós Aplicação')
    try {
      const p=doc.getImageProperties(mapaImg)
      const maxW=pw-margin*2,maxH=80,r=Math.min(maxW/p.width,maxH/p.height)
      const iw=p.width*r,ih=p.height*r
      doc.addImage(mapaImg,'JPEG',margin+(maxW-iw)/2,y,iw,ih); y+=ih+6
    } catch(e){}
  }

  doc.setFillColor(17,26,20); doc.rect(0,287,pw,10,'F')
  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(138,173,148)
  doc.text('Orofly — Sistema de Gestão de Operações de Drone', pw/2, 293, {align:'center'})

  return doc
}

// ── KML Parser: extrai coordenadas do KML ──
function parseKMLCoords(kmlText) {
  try {
    const coordMatches = kmlText.match(/<coordinates>([\s\S]*?)<\/coordinates>/gi) || []
    const allPoints = []
    coordMatches.forEach(block => {
      const inner = block.replace(/<\/?coordinates>/gi,'').trim()
      inner.split(/\s+/).forEach(pt => {
        const parts = pt.split(',')
        if (parts.length >= 2) {
          const lng = parseFloat(parts[0]), lat = parseFloat(parts[1])
          if (!isNaN(lat) && !isNaN(lng)) allPoints.push({lat, lng})
        }
      })
    })
    return allPoints
  } catch(e) { return [] }
}

// ── Gera imagem de mapa estático com trajeto KML usando Geoapify ──
async function gerarMapaKML(supabase, rel) {
  // Busca KML do Storage
  const kmlPaths = rel.kml_paths || []
  if (!kmlPaths.length) return null

  try {
    // Pega o primeiro KML
    const { data: signedUrl } = await supabase.storage.from('relatorios').createSignedUrl(kmlPaths[0], 300)
    if (!signedUrl?.signedUrl) return null

    const kmlRes = await fetch(signedUrl.signedUrl)
    const kmlText = await kmlRes.text()
    const points = parseKMLCoords(kmlText)
    if (points.length < 2) return null

    // Calcula bounding box
    const lats = points.map(p => p.lat), lngs = points.map(p => p.lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const centerLat = (minLat + maxLat) / 2
    const centerLng = (minLng + maxLng) / 2

    // Calcula zoom baseado na extensão
    const latDiff = maxLat - minLat, lngDiff = maxLng - minLng
    const maxDiff = Math.max(latDiff, lngDiff)
    const zoom = maxDiff > 0.05 ? 13 : maxDiff > 0.01 ? 15 : maxDiff > 0.005 ? 16 : 17

    // Monta polyline para Geoapify (gratuito, sem chave necessária para OSM tiles)
    // Usa OpenStreetMap Static Map via overpass + leaflet-image-server alternativo
    // Alternativa: OSM tile + canvas drawing via URL
    const polylineCoords = points.map(p => `${p.lng},${p.lat}`).join(';')

    // Geoapify Static Maps API (gratuito até 3000/dia)
    // Cria polyline GeoJSON
    const geojson = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: points.map(p => [p.lng, p.lat])
      }
    }
    const geojsonStr = encodeURIComponent(JSON.stringify(geojson))

    // URL da API Geoapify Static Maps
    const apiKey = 'a30b45f023014b63bc0db4a88e6a15fd' // Free tier key pública
    const width = 600, height = 400
    const url = `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=${width}&height=${height}&center=lonlat:${centerLng},${centerLat}&zoom=${zoom}&geometry=polyline:${geojsonStr};linecolor:%23e74c3c;linewidth:3;lineopacity:0.9&apiKey=${apiKey}`

    const imgRes = await fetch(url)
    if (!imgRes.ok) return null
    const blob = await imgRes.blob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch(e) {
    console.warn('Erro ao gerar mapa KML:', e)
    return null
  }
}

// ============================================================
// PDF CLIENTE v7 — layout fiel icones corrigidos
// ============================================================
const LOGO_B64 = 'data:image/png;base64,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'
const IC_AREA   = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAYAAACohjseAAAABmJLR0QA/wD/AP+gvaeTAAAAw0lEQVRoge3YMQ6CQBBG4d2NXEK8CEdQajiKhdRaeBSt1SNwEfESJCyNpUxMpvrJ+9olM3mh2WwIAAAsitbh9nTIruExtsP5cbe+Kbu6yTnfPHs+l+diR/IMVkCgOgLVEaiOQHUEqiNQHYHqNtZhjLF1TR+n/p9vYpF8ewAAwE/mw2/Z1Y1r+jj1w/X1Nncc97tQpMqzxnpcNm8y3hfn7w3FfNkORaq8e4Lxo1Z/FyVQHYHqCFRHoDoC1RGojkAAAFZsBsErJhZevprIAAAAAElFTkSuQmCC'
const IC_VOLUME = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAYAAACohjseAAAABmJLR0QA/wD/AP+gvaeTAAAEdklEQVRoge2aS2xUVRjHf9+ZB1CKgUVBZgpptCqEBK01KApaFhqdgmlIujIYYtSwwYQYpQ81o9IWlyTqxigiYeFGjJRKfKUBggiJENyArYowLUh8IS2Wy8z9XOAKbTzn3nNHE/lt53v8//OdO3fuuQeucY1r/G+oK7bU1hVbaqvZ01Sxl2SCmjczQc12isWq9U1Vq1G+q9ALrAMW1FZK6bF9w59Vo29VDOa7W9sVtgACIMjy2nsbh8f2DX+VdG9JusHcjtZmMboXqLnqowkRXTHS8+HBJPsnanDesw/nKunyISA/SfezUF4y2vPR6aQ0JHax129on1bJlPuZzByAcj2kdzYUW6YmpSMxg2HN+GsoTf8YqDQHl2teTUpHIj8yua7C48ALDim3z1jeePrCvuEjvrV4vwbrux5cHGIOAtMcUycgdc9o764vferxukQbim0zQ8x7uJsDmArhuw3Ftpk+Nfk0KEEQvA3cGL2ENgbBpbd8CQKP12C+u7AOeDp+JVlYu6xxdGz/sJel6uUanNPRekPK6FFgho96wLgxpqm0qX8obqH4S7TYkk4Z3YE/cwDTw7Cyjfb22CsstsFcUNMN3BW3zl+RpfmbLnbErhInOb9x5a2aCg8DmbhCJiEwKe4ovTwQ+U95nAkKqXALyZkDyIYVeZ0Yg4hsMNdZWKtwX9R8e3RZvuuhNVGzI30z8ztaZ5VFjyPMjtrYCeVcWmXBqc27f3FNjTTBsvBS1cwBCLPLJnwxWqojue4H5qHpIWBKlIYxCFS4+UzPwPcuSc4TVE13U31zAFlRnnFNcppgbuOq+aQqQ0DWtZEnnKfoNEEx5Q38e+YAsqKy3iXB2uCiYntWRR5x1+QZ1TXNTzZb33utDf586eJKoC6SKJ8Is8/UzSnYhlsbFNHIN1vfiPKobaydwStb7S0R9XhHYYXt9r9VUD44tBjwupUQk1n1lUOLbALtJqi6NJacBKiUudsmzs6gMfWx1CSBwUqTlUH9L/x6Xo3aabKbYKhVfWlpgyjX2cRZLlEuxlKTBEbGrMKsiqn+GEtMAoilJtsb/dcxtCSDygmbMCuDgnh9X+ADkYrVixorgyPZJcdAf4onySPKuVLvHqudNtu/aiHIzliiPKLCTkBtYu2fB0W2RhXkG6Nmm3WsbeBoz+4DIPujSfLKgZG+/s9tg52e6I2R57FcGgmhKnS6JDgZLG3qHxTY4abJHwrbz/QM7HXJcd5Vy2Sz64HvXPM88M20SvCUa5KzwZPF938VWA385pobg/OGcPW3r3xy3jUx0s72SO/AUUHagPEo+W7ImDGmrdS751ik7Dit6zsLd4bwQYLb+D+EYbjq7OY9h6MWiPUCtNQ38EWqkm5S1cE4df4e+TRDpSmOOfB3TkZynYW1GHqvHM+Kg46Kmq6Rvt3v4OGW5PUgUEOxZWpwefpjqD4B3Oao5IiE+kZmyu9bTxYHJ3xpSuy04dznWheK6v2oLkXkFlTng/x5UEEvIHIK1RNgDqDm49G+XceT0PEHWNdGCoubIJcAAAAASUVORK5CYII='
const IC_VAZAO  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAYAAACohjseAAAABmJLR0QA/wD/AP+gvaeTAAAEo0lEQVRoge1ZXWtcRRh+3tmPNmlWRBp2uym2tN0arRVLEKw1oiA07Kp3CrXeVDAIeiFIIdkUusR0V8Rf0Au9aYMfF8U1u9TWiy2LHwgFRWtrE2gKyYnblvRiTcT9mNeL1pA95yybzMyJN+eBhc07Z555njM78847AXz48PF/gjZikIHhgVAlGu1vNHk7AAQDNDcXWL6KTKnh9dieGoyPvtzP1Bwl4BUAD9qa74I4D+KcNXH+D680BDzipXg6NQ6SkwQcALDZ5ZkugJ4E09uR5/YEq+WZS54IMc6YyYj4Pz+dAeHIOntOWtniGwDYpBzjM7jtUPc4Ae8odN0fGUygWp4umdRjdAbjJ4YegRS/AQjampZBdBaSfwAACDoI5qMAum3P1Ynx+HyueN2UJrsQLbAUabJzMl1hwamFU4Wbq6KfxkaGsoICUyDetyoeYsIogGOmNBmbwYHhgdDC1ugttO6Wy0x4bOFU8aZbn9jI0E4hxO8AulaFF63wctRUChEmSACgsrX3UdhSAYHPtDMHAH9+eH4WhElb+KFobUu/KV3GDDaliNtjzPRjx47M39tDAugzJMucQVcQd14CLDw9bBgzGBDScgRJPN1ZAR+0hyQwb0aVQYPRO7evArjbEmQ+GhsZ2tm2z0hqFxiv28KLlfDSNVO6jBm8fPpyHcR5W7hbUGDKzWR0JLUrIPhrtO6gAOErk4dwo7//vtHkXiZcgTO//g3CJCS+AzGB6Jn7M9dle64uhNg3NzE1bUqT8QUeTyczAE4qdWY6aeUK4yb1GD+LVsvTlyKDiQSA/evqyHTWyhXeM63Hk3KpWp4+FxlMAMChNYxRB9P4fXNGKwmsYXBlVMvTpQeeTXwOQgTAw3Cut0UQPhNCHJnPFs55pWNDriyQeT4YrW3pF/LelYUUNFcJL13biCsLHz58+PChA+00ET+RehGSh02IcUDQaWui8K0OhfalEzFeYOBVXR43sJTXAWgZ1C6XmDmhy9EOBNqry2GiHvTMIAh7dCm0DRKxtoi2YGjPoNYm03s8GQuFsODSNFtrBJ+481G+am+Ip5P2iuGLZq3xZiAc+hlwvqwGgrFb2XxFVaPWDAYD/K5LmAEMu5lrh8rHF5aEoLfgUi4FRVPl/xwrUDa4I314GxE5C1TGN1a2eHG9fHMTUyWALzgaJL+/fewl5XtSZYN1Dj7FxJucjI0PVDnBzr4MDkvJA6qUygatXCEPJkeOqtU3/9qh65erPwSs3H7XN9V/geNnShetXMF+W7dmaCV6IsRW/mAAhIVOa8/KFl9r13Y7U/orPpasQCL23/bXMoYCdNPE7pVv9wTNaPIBTDMteztTAhq7vdYmAyDSGiX9+0xiGwf39B5PRlXplA3WOOjIWQzWnkGWTo5QWCofJpQNEknHEU2w/e2vH0IIJ4cUysdBdYMg51sl0p/BpnRwkHAZa41Q3kUZzoMwMw70jaW0Dt8sucfJq16x6KQJ56CET5g1L6fd9kuNqkInTezu/IghaKQKJYPuKcJLcM+O9GGlhK9ksEYB74rcdmO6pKW1QGkNEho3iEJtj1yegOqzGzqeDx8+jOBfkIVuqvOniwkAAAAASUVORK5CYII='
const IC_TEMPO  = 'data:image/png;base64,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'
const IC_DRONE  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAYAAACohjseAAAABmJLR0QA/wD/AP+gvaeTAAAFcklEQVRoge2ZW2wUVRjHf9/MbpFCvSBIu6WaSMBg5KliIhgvAdG2XAQTFAjEaCDxiQQD0lbCAoIFQzAhJoq8SIyKmICUglxUEC8RhcS7QiUKdFsCCZHFQtud+XzobNnbLLPbaR/I/pJNzpnznfP//nN2zpw9CwUKFChQoIAr4iWocmFlsG1Y6VNq6wyESqDcaTqLclwM2VF6vm3nsc3HuvxIyk+96xosq62ZKaLrgZHXGaoZtZdEXtu704OHftNzNxgOG6HOow3AkpwyFNZHgg/UEg7bOfXrIz3TrV/Z+OINAi/lJNbNhBIrMjh65OT+XDr1lV7GGSyrr5orKu9laLIQflGkpbuzlqPcR8YbJbMja5s+9JJhX+qlGQyFpxbTGTsJEkq43AqsocjcFgk3XkiJH0pX7FmQepTShKYWiszRkXBjezZzfa2XdidKHhy1COHphEvbu4raJ51bfeDr6KETaclGD51ojx5pPnrTxPK3DatotMC9TtPNYtkXo0eav81msK/1AmmKos/EiwpbW9fuea67mJ3z4UOXgVnl9dXvqjIPwEZmARuyduxjPSOxUr60agRQ6VR/HxTVhV7EEtCBl3QB8AeAwLiKpdNCbsH9oZdk0AowFue5FJEVzZv2duQgBkDzpr0dAiucqsQC1li32P7QM1IqZU7xSjD4X2OuYnHkyqBG4CqAqLrOYH/oJRlE5Q6nFPk7fOhqvoJnN26/ArQ41eGugf2gl2xQiDrKt+Jxn+qCALd1K8ilLFF9rpdkUFVanfjby+qrK8mT0mVP3g8MAcC2I25x/aGX9JowbPlLze5FzFBqIen95BkxJdyzForsCNVVu0ReWzAFwsCUfPQMQ2p7yqKnktoSKy3rdv8EnHGkZ4Zqa17IVay0bsp8UXFz5I5SU/bylAW5diurrZ4HMsOptpxd++nPie1GSrwCu3pqom+G6qtnexarr5prYm/JNcmeZEw7Zz0R3um5oLKDlPdo2oNd8UrVSMuW34CieDdEt4K1PLJm/5lMQqH6yRWqgVcF5ntNLgv56nVatow519CU9BVNMzh06bSSooD1BujzKU0xlC9BDovoaQBVuRP0EYSHSXmeFY0ZyC4FK5sbAdNWpouk7Ytz1GNLVyyw+ML6XdGsBkO1VRMQ+UqgQ2FAtuSyIrIisqZplZfQEXXVK+zuRSZPLdpRBiLyUGRN0zeJTanPIBjdy22vzAGGrfu8xqp4j808AMWAiK1D0vJIvSC2kRbkWUa0Z7sVC1iXvXa0DPva10p0N7ltuK8hHgxmCroOinJO1d6Iyqa8EksaTF4HeyXoGc3RqC2k5Z7+e9AyPlfTfkugCrjLw7iCMFwwFgOLc0ko42DK4fh9z2Hv9o/CXiNmfpHakGawZd3uH4EXAYYvq7nbMJkk6FSUx+nlc+kjMeA7kEa1Odja0HQcl9lOn8EEnHfKZmBzKDy1mJg9HkunIkzH2+z6h9AmcACkcUCsY/+pdQf/9dItq8FEnMOcg85nUT/MrudZyoZng6kkzu6w8KODg13FE1HmALPyHdPhI4T3u4LtnznnLr0ib4OJOIl8Urr8iWbDMntl0DatVW2r9/3qR16Q6TVxg+GrwYAGO+Nl0zKDnpPoMuIb+6Qx/MBXg1c7jbZ4WYUx3rOQntiOwOVWP3PqzTlIRkJ11ZeAEuBPkLBI9l8TigZQVgKjgEuRtXtu8TMfXxaZFH4AHgPuAf1AczrG5ajfyfi+yIjwUb59Fc27rxu+GzQt2QbqepKWhZagGh/7nY/vBk83NF00DHMuzkmzR66oMOd0Q9NFv/PxfZGJE6qfXKF2cJxhuP+LDGDbWGJ0fe92/lKgQIECBQoUKFDghuV/73qBcyiqKz4AAAAASUVORK5CYII='
const IC_FAIXA  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAYAAACohjseAAAABmJLR0QA/wD/AP+gvaeTAAAAuUlEQVRoge3XMQrCMBSH8X+Dg0NPUDyMrurqARz1CMVRPIKOXkJnPYx4AgenxEUXkQQrRF74ftClb3kfJIVKAAAAANBFJUmD1XTovT99GO+um+My91LfaNrJVgqL9/fOudFlfTi7fyyVE4HWEWgdgdYRaF3xgb34OMybdjzLs0pXoY5NE4HqPx+zij+iBFqXuoN3Sbcci/ygVuQ7kQis9lZ/eF+KP6IEWkegdQRaR6B1xQcCAAAAQDcPG94Z9tvoDqkAAAAASUVORK5CYII='
const IC_GOTA   = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAYAAACohjseAAAABmJLR0QA/wD/AP+gvaeTAAAEdklEQVRoge2aS2xUVRjHf9+ZB1CKgUVBZgpptCqEBK01KApaFhqdgmlIujIYYtSwwYQYpQ81o9IWlyTqxigiYeFGjJRKfKUBggiJENyArYowLUh8IS2Wy8z9XOAKbTzn3nNHE/lt53v8//OdO3fuuQeucY1r/G+oK7bU1hVbaqvZ01Sxl2SCmjczQc12isWq9U1Vq1G+q9ALrAMW1FZK6bF9w59Vo29VDOa7W9sVtgACIMjy2nsbh8f2DX+VdG9JusHcjtZmMboXqLnqowkRXTHS8+HBJPsnanDesw/nKunyISA/SfezUF4y2vPR6aQ0JHax129on1bJlPuZzByAcj2kdzYUW6YmpSMxg2HN+GsoTf8YqDQHl2teTUpHIj8yua7C48ALDim3z1jeePrCvuEjvrV4vwbrux5cHGIOAtMcUycgdc9o764vferxukQbim0zQ8x7uJsDmArhuw3Ftpk+Nfk0KEEQvA3cGL2ENgbBpbd8CQKP12C+u7AOeDp+JVlYu6xxdGz/sJel6uUanNPRekPK6FFgho96wLgxpqm0qX8obqH4S7TYkk4Z3YE/cwDTw7Cyjfb22CsstsFcUNMN3BW3zl+RpfmbLnbErhInOb9x5a2aCg8DmbhCJiEwKe4ovTwQ+U95nAkKqXALyZkDyIYVeZ0Yg4hsMNdZWKtwX9R8e3RZvuuhNVGzI30z8ztaZ5VFjyPMjtrYCeVcWmXBqc27f3FNjTTBsvBS1cwBCLPLJnwxWqojue4H5qHpIWBKlIYxCFS4+UzPwPcuSc4TVE13U31zAFlRnnFNcppgbuOq+aQqQ0DWtZEnnKfoNEEx5Q38e+YAsqKy3iXB2uCiYntWRR5x1+QZ1TXNTzZb33utDf586eJKoC6SKJ8Is8/UzSnYhlsbFNHIN1vfiPKobaydwStb7S0R9XhHYYXt9r9VUD44tBjwupUQk1n1lUOLbALtJqi6NJacBKiUudsmzs6gMfWx1CSBwUqTlUH9L/x6Xo3aabKbYKhVfWlpgyjX2cRZLlEuxlKTBEbGrMKsiqn+GEtMAoilJtsb/dcxtCSDygmbMCuDgnh9X+ADkYrVixorgyPZJcdAf4onySPKuVLvHqudNtu/aiHIzliiPKLCTkBtYu2fB0W2RhXkG6Nmm3WsbeBoz+4DIPujSfLKgZG+/s9tg52e6I2R57FcGgmhKnS6JDgZLG3qHxTY4abJHwrbz/QM7HXJcd5Vy2Sz64HvXPM88M20SvCUa5KzwZPF938VWA385pobg/OGcPW3r3xy3jUx0s72SO/AUUHagPEo+W7ImDGmrdS751ik7Dit6zsLd4bwQYLb+D+EYbjq7OY9h6MWiPUCtNQ38EWqkm5S1cE4df4e+TRDpSmOOfB3TkZynYW1GHqvHM+Kg46Kmq6Rvt3v4OGW5PUgUEOxZWpwefpjqD4B3Oao5IiE+kZmyu9bTxYHJ3xpSuy04dznWheK6v2oLkXkFlTng/x5UEEvIHIK1RNgDqDm49G+XceT0PEHWNdGCoubIJcAAAAASUVORK5CYII='
const IC_VELOC  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAYAAACohjseAAAABmJLR0QA/wD/AP+gvaeTAAAFFklEQVRoge2ZXWwUVRTH/+fOslVaJEiBdrtgQhBMCIkGC0l9MoHa3aKAoSGEYnkTxD4QP+huqY7B3dbUqIkCxhc1foQEgkg/tkUpvoixVUmM+qBgAra7LQSI2hZsO/f4UKvbmdnuzuyMfZnf25577jn/k7tz75m5gIeHh4eHh4eHh4eHh4cJNNsCAo3VFZC8/Q459sKvr3z+u9PxZ7fAmholsHKkD4wHAL7OoEMp/7o3oarSqRTCqUB2CNw7smeyOACghQS8ERjrPeVkjlkrcIlauRjAIZOhbifzzFqByrivBcCCaUbCheQvhW87mWdWCixpqCoHo05nZpJiH44f15zM9f8XqKpCEeKwMTe9O9Dc/pXT6XxOBzQj2LhpnWTtcTCtxdjXSxm0SudyU/OPR9zI7WqBK+pDBaNFeFmy3A+QMnkopZ1M/O/PpiH1zFU3NLha4Og8EQP4mYwOBID5avJikaMbSzquPYPBSHg9wPuzOhIVB1feWuuWDtcKlMRbc4wvmOUWt3S4t4sy5bwqDDzolgzDMxhoDG8GY1q7xMS1qVjiI7dE2KE0Wl1L4A+mGZk2J5s7TqebDCtIxH/qbQI0z7IC4m9zdgW+sRpesDRoIoKJdj2SbhhMQJllAaScBJBLV6JpUn5iNT6IlhpM0K4bdOgNY/7Ri5g8of6D6T6r+ftj7b1gfj0H19cGW7r6rMYHoG8WeHxMXtI7GQq8pn4xDKA/3UaQFTYEYO4wDgJohflKagBaF/gLD9oITUzQa/pt6NUzIwZHs9mBSPgYCNvTbZJ59WBz4icbYhBs3LSOWW6Z2i2JqE/TtFM2Vw7BpvAaqeF7nfnjZLxzp97XtJNhQT3EPK1AErQDQJMdQf2x9l4AvXbmmsEadpiYz5n5mp6Dfp5og+5vRYzdq9Uaf/7y8mNFfaiAgSd05okJ+NrM/E0LvBzvToHwmc4cvPnX6C4nRObDyF2iDsZdvftq/PSQmf8MnQwfMZiIXyp+/jHrZ6JDLD+wYT4xq3q7YGnUOjWWaSAZS7QDhge5zK9ocdsK8+SW4m8BUDrdyt/1N3clMs2ZqRdlwdL4Ekq8r7Rx01abGm1TFgltI2CPYUAiAv25nUbW76KBaOgkQPqCRkG0MRnrOG9ZqQ1KGqrKhVB6AC5KtzPoRCreUTPT3KxvE3Mg9wHQP8BzwfxpSUNVuXW51ghGwuuFoIS+OBAGJ8a5Ptv8rAVejnenAOyCsRspFkLpcfPvWhYJbZOEswAt1A1pRLzzWmvnYLYYOX+6L2sM72HGUZMhBnDktp+jN9TEH7nGm4nlBzbMv60UNAO812yciZ5MxTreySWWpbuJ0mg4QkCGXZSTzFDvLih6/0f1+JiVuFOsqA8VjBTRbiK8CMNuOZUGkWRzZ0uuMS1fvvyzkm8BUDK4DDD4PQlxbCje8UMuMYNN4TWsYQeD6wAKZHDTmOipXFduClu3S4FoeCMYH4KwOItrioDzAH4G4YrE5Mu0AM0DYxmAVUyoAKMki8pBYlk7EO86a1Wr7euze6KPlI5DHDY5QhyFQSc0KE9nasWykff9YEk0FBKgOID78401DcIFaNyQbEmcyS+MQ3LKIuFqKWgvMVfC/gflCQDdBDo6EO/oxAwdSs7C8g2gZ9Fz4RKfjx8l0MMgPARg2QzuDOAKgC8BnJuAr83uXzETrl9hL3m2snDOnb7lzLyINVEEAKTIYSK6JhXlUlJtG3Vbg4eHx+zxN6nXp93+251yAAAAAElFTkSuQmCC'

// Helper: trunca texto para caber em largura máxima (jsPDF)
function truncFit(doc, txt, maxW) {
  let s = String(txt)
  while (doc.getStringUnitWidth(s) * doc.getFontSize() / doc.internal.scaleFactor > maxW && s.length > 2) {
    s = s.slice(0,-1)
  }
  return s === String(txt) ? s : s.slice(0,-2)+'..'
}

export async function gerarPDFCliente(rel, { supabase, localObsFotos, localFotoMapa, trechos=[] } = {}) {
  const doc = new jsPDF({ orientation:'l', unit:'mm', format:'a4' })
  const PW=297, PH=210, C1=8, CW=136, C2=157, M=8
  const G=[26,122,74], DK=[17,26,20], GR=[120,140,130], W=[255,255,255]

  const fmt  = v => v ? new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'
  const fmtD = v => v ? new Date(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'
  const fmtH = v => v ? new Date(v).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'

  function calcTempo(ini,fim,pausas){
    if(!ini||!fim) return null
    const t=Math.round((new Date(fim)-new Date(ini))/60000); if(t<=0) return null
    let p=0;(pausas||[]).forEach(pa=>{if(pa.inicio&&pa.fim)p+=Math.max(0,Math.round((new Date(pa.fim)-new Date(pa.inicio))/60000))})
    const f=m=>{const h=Math.floor(m/60),mn=m%60;return h>0?`${h}h${String(mn).padStart(2,'0')}min`:`${mn}min`}
    return {total:f(t), efetivo:f(t-p)}
  }
  const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
  const areaBrutaC = parseFloat(rel.area_ha)||0
  const bordaduraHaC = parseFloat(rel.bordadura)||0
  const area  = areaLiquida(rel) // já desconta a bordadura
  const vazao = parseFloat(rel.vazao_i||rel.vazao_f)||0
  const volTotal = vazao&&area ? (vazao*area).toFixed(0) : null
  const gastosProdutos = calcularGastoProdutos(rel.produtos, area)

  doc.setFillColor(...W); doc.rect(0,0,PW,PH,'F')

  // ═══ COL 1 ═══
  let y=M

  // Cabeçalho
  try{doc.addImage(LOGO_B64,'PNG',C1+1,y+1,48,27)}catch(e){
    doc.setFontSize(16);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('OROFLY',C1+4,y+18)
  }
  doc.setFontSize(12);doc.setFont('helvetica','bold');doc.setTextColor(...DK)
  doc.text('RELATÓRIO DE',C1+77,y+10,{align:'center'})
  doc.text('OPERAÇÃO DE DRONE',C1+77,y+16.5,{align:'center'})
  doc.setDrawColor(...G);doc.setLineWidth(0.3)
  doc.line(C1+54,y+18.5,C1+100,y+18.5)
  doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.setTextColor(...GR)
  doc.text('PULVERIZAÇÃO AGRÍCOLA',C1+77,y+23.5,{align:'center'})
  doc.setDrawColor(...G);doc.setLineWidth(0.5)
  doc.roundedRect(C1+108,y+2,28,24,2,2,'S')
  doc.setFontSize(6.5);doc.setFont('helvetica','bold');doc.setTextColor(...G)
  doc.text('DATA DA OPERAÇÃO',C1+122,y+6,{align:'center'})
  doc.setDrawColor(180,220,200);doc.line(C1+110,y+7.5,C1+134,y+7.5)
  doc.setFontSize(11);doc.setFont('helvetica','bold');doc.setTextColor(...DK)
  doc.text(fmtD(rel.dt_inicio),C1+122,y+15,{align:'center'})
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(...GR)
  doc.text(fmtH(rel.dt_inicio),C1+122,y+21,{align:'center'})
  y+=29

  doc.setDrawColor(210,235,220);doc.setLineWidth(0.3);doc.line(C1,y,C1+CW,y);y+=2

  // Cliente/Fazenda/Piloto
  doc.setFillColor(245,251,247);doc.roundedRect(C1,y,CW,12,1.5,1.5,'F')
  doc.setDrawColor(200,235,215);doc.roundedRect(C1,y,CW,12,1.5,1.5,'S')
  const tw3=CW/3
  ;[['CLIENTE',rel.cliente||'—'],['FAZENDA',rel.fazenda||'—'],['PILOTO',rel.piloto_nome||'—']].forEach(([lbl,val],i)=>{
    const x=C1+i*tw3+2
    doc.setFontSize(6.5);doc.setFont('helvetica','bold');doc.setTextColor(...GR);doc.text(lbl,x,y+5)
    doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(...DK)
    doc.text(truncFit(doc,val,tw3-5),x,y+10)
  })
  y+=14

  function sec(num,title){
    doc.setFillColor(240,248,243);doc.roundedRect(C1,y,CW,7,1.5,1.5,'F')
    doc.setFillColor(...G);doc.circle(C1+4.5,y+3.5,3.5,'F')
    doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text(String(num),C1+4.5,y+4.8,{align:'center'})
    doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text(title,C1+11,y+5.5)
    y+=8.5
  }

  // 1 RESUMO
  sec(1,'RESUMO DA OPERAÇÃO')
  const resumo=[['ÁREA APLICADA',area?area.toFixed(2):'—','ha',IC_AREA],['VOLUME APLICADO',volTotal||'—','L',IC_VOLUME],['VAZÃO',rel.vazao_i||rel.vazao_f||'—','L/ha',IC_VAZAO],['TEMPO OPERAÇÃO',tempo?.efetivo||tempo?.total||'—','',IC_TEMPO]]
  const rW=CW/4-1.5
  resumo.forEach(([lbl,val,unit,ic],i)=>{
    const rx=C1+i*(rW+2)
    doc.setFillColor(...W);doc.setDrawColor(200,235,215);doc.setLineWidth(0.3)
    doc.roundedRect(rx,y,rW,26,2,2,'FD')
    try{doc.addImage(ic,'PNG',rx+(rW-8)/2,y+2,8,8)}catch(e){}
    doc.setFontSize(6);doc.setFont('helvetica','bold');doc.setTextColor(...GR)
    doc.text(lbl,rx+rW/2,y+13,{align:'center'})
    doc.setFontSize(unit?13:9);doc.setFont('helvetica','bold');doc.setTextColor(...G)
    doc.text(String(val),rx+rW/2,y+19,{align:'center'})
    if(unit){doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(...GR);doc.text(unit,rx+rW/2,y+24,{align:'center'})}
  })
  y+=28

  // 2 HORÁRIO
  sec(2,'HORÁRIO DA OPERAÇÃO')
  doc.setFillColor(240,248,243);doc.rect(C1,y,CW,6.5,'F')
  ;[['INÍCIO',CW/6],['TÉRMINO',CW/2],['TEMPO TOTAL',CW*5/6]].forEach(([h,x])=>{
    doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...G)
    doc.text(h,C1+x,y+4.5,{align:'center'})
  })
  y+=7
  doc.setFillColor(...W);doc.setDrawColor(200,235,215);doc.roundedRect(C1,y,CW,8,1,1,'FD')
  ;[fmt(rel.dt_inicio),fmt(rel.dt_fim),tempo?.total||'—'].forEach((v,i)=>{
    doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...DK)
    doc.text(v,C1+(i+0.5)*CW/3,y+5.5,{align:'center'})
  })
  y+=10

  // 3+4
  const hW=(CW-3)/2, yBase=y
  doc.setFillColor(240,248,243);doc.roundedRect(C1,y,hW,7,1.5,1.5,'F')
  doc.setFillColor(...G);doc.circle(C1+4.5,y+3.5,3.5,'F')
  doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text('3',C1+4.5,y+4.8,{align:'center'})
  doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('PRODUTOS APLICADOS',C1+11,y+5.5)
  y+=9
  doc.setFillColor(240,248,243);doc.rect(C1,y,hW,6,'F')
  doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...G)
  doc.text('PRODUTO',C1+3,y+4.5);doc.text('DOSE',C1+hW*0.66,y+4.5,{align:'right'});doc.text('TOTAL',C1+hW-3,y+4.5,{align:'right'})
  y+=7
  if(gastosProdutos.length===0){
    doc.setFillColor(255,255,255);doc.rect(C1,y,hW,7,'F')
    doc.setFontSize(8);doc.setFont('helvetica','italic');doc.setTextColor(...GR)
    doc.text('Nenhum produto registrado',C1+3,y+5)
    y+=7
  }
  gastosProdutos.forEach((g,i)=>{
    doc.setFillColor(i%2===0?255:248,255,i%2===0?255:248);doc.rect(C1,y,hW,7,'F')
    const doseTxt = g.dose!=null ? `${g.dose} ${g.unidade}/ha` : '—'
    const totalTxt = g.total!=null ? `${g.total} ${g.unidade}` : '—'
    doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...DK)
    doc.text(truncFit(doc,g.nome||g.produto,hW*0.38-2),C1+3,y+5)
    doc.text(truncFit(doc,doseTxt,hW*0.26-4),C1+hW*0.66,y+5,{align:'right'})
    doc.text(truncFit(doc,totalTxt,hW*0.3-4),C1+hW-3,y+5,{align:'right'})
    y+=7
  })
  const yP=y

  let yc=yBase; const cx=C1+hW+3
  doc.setFillColor(240,248,243);doc.roundedRect(cx,yc,hW,7,1.5,1.5,'F')
  doc.setFillColor(...G);doc.circle(cx+4.5,yc+3.5,3.5,'F')
  doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text('4',cx+4.5,yc+4.8,{align:'center'})
  doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('CONDIÇÕES CLIMÁTICAS',cx+11,yc+5.5)
  yc+=9
  doc.setFillColor(240,248,243);doc.rect(cx,yc,hW,6,'F')
  doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...G)
  doc.text('PARÂMETRO',cx+3,yc+4.5);doc.text('INÍCIO',cx+hW*0.55,yc+4.5);doc.text('FINAL',cx+hW*0.80,yc+4.5)
  yc+=7
  ;[['Temperatura','temperatura','°C'],['Umid. Relativa','umidade','%'],['Vento','vento','km/h'],['Delta T','delta_t','°C']].forEach(([lbl,key,unit],i)=>{
    doc.setFillColor(i%2===0?255:248,255,i%2===0?255:248);doc.rect(cx,yc,hW,7,'F')
    doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.setTextColor(...DK)
    doc.text(truncFit(doc,lbl,hW*0.5-4),cx+3,yc+5)
    doc.text(truncFit(doc,rel[key+'_i']?rel[key+'_i']+' '+unit:'—',hW*0.24),cx+hW*0.55,yc+5)
    doc.text(truncFit(doc,rel[key+'_f']?rel[key+'_f']+' '+unit:'—',hW*0.20),cx+hW*0.80,yc+5)
    yc+=7
  })
  y=Math.max(yP,yc)+3

  // 5 DRONE — ícone em cima, label, valor. Garante que não invade o rodapé.
  const footerY = PH-M-8
  const alturaSec5 = 8.5+18 // header + box
  if (y + alturaSec5 > footerY - 2) y = footerY - alturaSec5 - 2
  sec(5,'CONFIGURAÇÃO DO DRONE')
  const dW=CW/4
  doc.setFillColor(250,253,250);doc.roundedRect(C1,y,CW,18,1.5,1.5,'F')
  doc.setDrawColor(200,235,215);doc.roundedRect(C1,y,CW,18,1.5,1.5,'S')
  ;[
    [rel.drone||'—','DRONE',IC_DRONE],
    [rel.faixa_i?rel.faixa_i+' m':'—','FAIXA APLIC.',IC_FAIXA],
    [rel.tamanho_gota?rel.tamanho_gota+' µm':'—','TAM. GOTA',IC_GOTA],
    [rel.velocidade_drone?rel.velocidade_drone+' km/h':'—','VELOCIDADE',IC_VELOC]
  ].forEach(([val,lbl,ic],i)=>{
    const dx=C1+i*dW
    if(i>0){doc.setDrawColor(200,235,215);doc.setLineWidth(0.3);doc.line(dx,y+2,dx,y+16)}
    // Ícone centrado no topo
    try{doc.addImage(ic,'PNG',dx+(dW-6)/2,y+1.5,6,6)}catch(e){}
    // Label pequeno
    doc.setFontSize(5.5);doc.setFont('helvetica','bold');doc.setTextColor(...GR)
    doc.text(lbl,dx+dW/2,y+10,{align:'center'})
    // Valor — trunca dentro da casinha
    doc.setFontSize(8.5);doc.setFont('helvetica','bold');doc.setTextColor(...DK)
    doc.text(truncFit(doc,val,dW-4),dx+dW/2,y+15.5,{align:'center'})
  })
  y+=21

  // Rodapé col1
  doc.setFillColor(...G);doc.rect(C1,PH-M-8,CW,9,'F')
  doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.setTextColor(...W)
  doc.text('www.orofly.com.br',C1+4,PH-M-3)
  doc.text('contato@orofly.com.br',C1+46,PH-M-3)
  doc.text('(16) 98262-3711',C1+96,PH-M-3)

  // Separador
  doc.setDrawColor(200,230,215);doc.setLineWidth(0.5);doc.line(C2-2,M,C2-2,PH-M)

  // ═══ COL 2 ═══
  let y2=M
  try{doc.addImage(LOGO_B64,'PNG',C2,y2,42,24)}catch(e){
    doc.setFontSize(14);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('OROFLY',C2+4,y2+18)
  }
  doc.setFillColor(...G);doc.roundedRect(C2+CW-28,y2+1,27,10,2,2,'F')
  doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...W)
  doc.text('PÁGINA 2 DE 2',C2+CW-14.5,y2+7.5,{align:'center'})
  y2+=28
  doc.setDrawColor(210,235,220);doc.setLineWidth(0.3);doc.line(C2,y2,C2+CW,y2);y2+=3

  // 1 MAPA
  doc.setFillColor(240,248,243);doc.roundedRect(C2,y2,CW,7,1.5,1.5,'F')
  doc.setFillColor(...G);doc.circle(C2+4.5,y2+3.5,3.5,'F')
  doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text('1',C2+4.5,y2+4.8,{align:'center'})
  doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('MAPA DA ÁREA APLICADA',C2+11,y2+5.5)
  y2+=9

  let mapaImg=localFotoMapa||null
  if(!mapaImg&&supabase&&rel.foto_mapa_url) mapaImg=await fetchImageBase64(supabase,'relatorios',rel.foto_mapa_url)
  // Se não tem foto do mapa mas tem KML, gera imagem do trajeto
  if(!mapaImg&&supabase&&rel.kml_paths?.length) mapaImg=await gerarMapaKML(supabase,rel)
  if(mapaImg){
    try{
      const p=doc.getImageProperties(mapaImg)
      const maxH=65,maxW=CW,r=Math.min(maxW/p.width,maxH/p.height)
      const iw=p.width*r,ih=p.height*r
      doc.addImage(mapaImg,'JPEG',C2+(maxW-iw)/2,y2,iw,ih)
      y2+=ih+4
    }catch(e){y2+=4}
  } else {
    doc.setFillColor(245,250,247);doc.roundedRect(C2,y2,CW,60,2,2,'F')
    doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(...GR)
    doc.text('Sem foto de mapa',C2+CW/2,y2+32,{align:'center'})
    y2+=63
  }

  // Bordadura — logo após o mapa, só se preenchida: mostra total, bordadura e líquido
  if(bordaduraHaC){
    doc.setFillColor(240,248,243);doc.roundedRect(C2,y2,CW,8,1.5,1.5,'F')
    const trio = [['TOTAL:',areaBrutaC+' ha'],['BORDADURA:',bordaduraHaC+' ha'],['LÍQUIDA:',area+' ha']]
    const trioW = CW/3
    trio.forEach(([lbl,val],i)=>{
      const tx = C2+3+i*trioW
      doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text(lbl,tx,y2+5.5)
      doc.setFont('helvetica','normal');doc.setTextColor(...DK);doc.text(val,tx+18,y2+5.5)
    })
    y2+=10
    if(rel.bordadura_detalhe?.length){
      const detTxt = rel.bordadura_detalhe.map(d=>`${d.talhao}: ${d.bordadura}ha`).join(' · ')
      doc.setFontSize(6.5);doc.setFont('helvetica','italic');doc.setTextColor(...GR)
      doc.text(truncFit(doc,detTxt,CW),C2+3,y2+3)
      y2+=6
    }
  }

  // Grid talhão
  ;[['TALHÃO',rel.localizacao||rel.fazenda||'—'],['INÍCIO DA OPERAÇÃO',fmt(rel.dt_inicio)],['ÁREA APLICADA',area?area.toFixed(2)+' ha':'—'],['TÉRMINO DA OPERAÇÃO',fmt(rel.dt_fim)]].forEach(([lbl,val],i)=>{
    const gx=C2+(i%2===0?0:(CW-4)/2+4)
    const gy=y2+Math.floor(i/2)*14
    doc.setFontSize(6.5);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text(lbl,gx,gy+5)
    doc.setFontSize(8.5);doc.setFont('helvetica','bold');doc.setTextColor(...DK)
    doc.text(truncFit(doc,String(val),CW/2-6),gx,gy+11)
  })
  y2+=30

  // 2 OBSERVAÇÕES
  doc.setFillColor(240,248,243);doc.roundedRect(C2,y2,CW,7,1.5,1.5,'F')
  doc.setFillColor(...G);doc.circle(C2+4.5,y2+3.5,3.5,'F')
  doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text('2',C2+4.5,y2+4.8,{align:'center'})
  doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('OBSERVAÇÕES',C2+11,y2+5.5)
  y2+=9
  {
    const obsVal = rel.obs1 || rel.obs2 || '—'
    doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...GR);doc.text('Obs:',C2+2,y2+4)
    doc.setFont('helvetica','normal');doc.setTextColor(...DK)
    const obsLines = doc.splitTextToSize(obsVal,CW-16).slice(0,2)
    obsLines.forEach((ln,i)=>doc.text(ln,C2+14,y2+4+i*4.5))
    y2+=7+(obsLines.length-1)*4.5
  }
  y2+=3

  // Metadata das evidências climáticas — no final, apenas as marcadas "incluir no relatório"
  {
    const em = rel.evidencia_meta||{}
    const evIni = em.inicio&&em.inicio.incluir!==false ? em.inicio : null
    const evFim = em.fim&&em.fim.incluir!==false ? em.fim : null
    if(evIni||evFim){
      doc.setFontSize(6.5);doc.setFont('helvetica','italic');doc.setTextColor(...GR)
      let evTxt = 'Evidência climática: '
      if(evIni) evTxt += `Início — ${evIni.arquivo||''} (${evIni.data_foto||''})`
      if(evIni&&evFim) evTxt += ' · '
      if(evFim) evTxt += `Fim — ${evFim.arquivo||''} (${evFim.data_foto||''})`
      doc.splitTextToSize(evTxt,CW-4).slice(0,2).forEach((ln,i)=>doc.text(ln,C2+2,y2+3+i*3.5))
      y2+=8
    }
  }

  // Assinatura
  const sigX=C2+CW-55
  doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(...GR);doc.text('PILOTO RESPONSÁVEL',sigX,y2+4)
  doc.setFontSize(10);doc.setFont('helvetica','bolditalic');doc.setTextColor(...DK);doc.text(rel.piloto_nome||'',sigX,y2+12)
  doc.setDrawColor(...GR);doc.setLineWidth(0.3);doc.line(sigX,y2+13.5,C2+CW,y2+13.5)
  doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(...DK);doc.text(rel.piloto_nome||'',sigX,y2+19)

  // Rodapé col2
  doc.setFillColor(...G);doc.rect(C2,PH-M-8,CW,9,'F')
  doc.setFillColor(45,155,75);doc.circle(C2+5,PH-M-3.5,3,'F')
  doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.setTextColor(...W)
  doc.text('Orofly — Tecnologia que protege, resultados que voam.',C2+11,PH-M-3)

  // ═══ PÁGINAS DE TRECHOS (voo compartilhado) ═══
  if (trechos && trechos.length > 0) {
    for (let ti=0; ti<trechos.length; ti++) {
      const t = trechos[ti]
      doc.addPage([297,210],'l')
      doc.setFillColor(...W); doc.rect(0,0,PW,PH,'F')
      let yT=M

      // Header
      try{doc.addImage(LOGO_B64,'PNG',C1+1,yT+1,40,22)}catch(e){}
      doc.setFontSize(12);doc.setFont('helvetica','bold');doc.setTextColor(...DK)
      doc.text('RELATÓRIO DE OPERAÇÃO DE DRONE',C1+80,yT+10,{align:'center'})
      doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...GR)
      doc.text('PULVERIZAÇÃO AGRÍCOLA — TRECHO '+(ti+2),C1+80,yT+16,{align:'center'})
      doc.setFillColor(...G);doc.roundedRect(PW-M-35,yT+1,34,12,2,2,'F')
      doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...W)
      doc.text(`PÁGINA ${ti+2} DE ${trechos.length+1}`,PW-M-18,yT+8.5,{align:'center'})
      yT+=27
      doc.setDrawColor(210,235,220);doc.setLineWidth(0.3);doc.line(C1,yT,PW-M,yT);yT+=3

      // Info piloto/talhão
      const fullW=PW-M-C1
      doc.setFillColor(245,251,247);doc.roundedRect(C1,yT,fullW,12,1.5,1.5,'F')
      doc.setDrawColor(200,235,215);doc.roundedRect(C1,yT,fullW,12,1.5,1.5,'S')
      ;[['PILOTO',t.piloto_nome||'—'],['TALHÃO',t.talhao||'—'],['CLIENTE',rel.cliente||'—'],['FAZENDA',rel.fazenda||'—']].forEach(([lbl,val],i)=>{
        const x=C1+i*(fullW/4)+2
        doc.setFontSize(6.5);doc.setFont('helvetica','bold');doc.setTextColor(...GR);doc.text(lbl,x,yT+5)
        doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(...DK)
        doc.text(truncFit(doc,val,fullW/4-4),x,yT+10)
      })
      yT+=15

      // Col1: Horário + Condições
      let yL=yT
      // 1 Horário
      doc.setFillColor(240,248,243);doc.roundedRect(C1,yL,CW,7,1.5,1.5,'F')
      doc.setFillColor(...G);doc.circle(C1+4.5,yL+3.5,3.5,'F')
      doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text('1',C1+4.5,yL+4.8,{align:'center'})
      doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('HORÁRIO DA OPERAÇÃO',C1+11,yL+5.5)
      yL+=9
      doc.setFillColor(240,248,243);doc.rect(C1,yL,CW,6.5,'F')
      ;[['INÍCIO',CW/6],['TÉRMINO',CW/2],['TEMPO TOTAL',CW*5/6]].forEach(([h,x])=>{
        doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...G)
        doc.text(h,C1+x,yL+4.5,{align:'center'})
      })
      yL+=7
      doc.setFillColor(...W);doc.setDrawColor(200,235,215);doc.roundedRect(C1,yL,CW,8,1,1,'FD')
      const tTempo=calcTempo(t.dt_inicio,t.dt_fim,t.pausas)
      ;[fmt(t.dt_inicio),fmt(t.dt_fim),tTempo?.total||'—'].forEach((v,i2)=>{
        doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...DK)
        doc.text(v,C1+(i2+0.5)*CW/3,yL+5.5,{align:'center'})
      })
      yL+=11

      // 2 Condições
      doc.setFillColor(240,248,243);doc.roundedRect(C1,yL,CW,7,1.5,1.5,'F')
      doc.setFillColor(...G);doc.circle(C1+4.5,yL+3.5,3.5,'F')
      doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text('2',C1+4.5,yL+4.8,{align:'center'})
      doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('CONDIÇÕES CLIMÁTICAS',C1+11,yL+5.5)
      yL+=9
      doc.setFillColor(240,248,243);doc.rect(C1,yL,CW,6,'F')
      doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...G)
      doc.text('PARÂMETRO',C1+3,yL+4.5);doc.text('INÍCIO',C1+CW*0.57,yL+4.5);doc.text('FINAL',C1+CW*0.81,yL+4.5)
      yL+=7
      ;[['Temperatura','temperatura','°C'],['Umidade Relativa','umidade','%'],['Vento','vento','km/h'],['Delta T','delta_t','°C']].forEach(([lbl,key,unit],i2)=>{
        doc.setFillColor(i2%2===0?255:248,255,i2%2===0?255:248);doc.rect(C1,yL,CW,7,'F')
        doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...DK)
        doc.text(lbl,C1+3,yL+5)
        doc.text(t[key+'_i']?t[key+'_i']+' '+unit:'—',C1+CW*0.57,yL+5)
        doc.text(t[key+'_f']?t[key+'_f']+' '+unit:'—',C1+CW*0.81,yL+5)
        yL+=7
      })

      if(t.obs){
        yL+=4
        doc.setFillColor(240,248,243);doc.roundedRect(C1,yL,CW,7,1.5,1.5,'F')
        doc.setFillColor(...G);doc.circle(C1+4.5,yL+3.5,3.5,'F')
        doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text('3',C1+4.5,yL+4.8,{align:'center'})
        doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G);doc.text('OBSERVAÇÕES',C1+11,yL+5.5)
        yL+=9
        doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...DK)
        doc.text(doc.splitTextToSize(t.obs,CW)[0],C1+2,yL+4)
      }

      // Separador
      doc.setDrawColor(200,230,215);doc.setLineWidth(0.5);doc.line(C2-2,M,C2-2,PH-M)

      // Col2: Mapa
      let yR=yT
      doc.setFillColor(240,248,243);doc.roundedRect(C2,yR,CW,7,1.5,1.5,'F')
      doc.setFillColor(...G);doc.circle(C2+4.5,yR+3.5,3.5,'F')
      doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(...W);doc.text('1',C2+4.5,yR+4.8,{align:'center'})
      doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...G)
      doc.text('MAPA — '+(t.talhao||'TALHÃO'),C2+11,yR+5.5)
      yR+=9

      let tMapaImg=null
      if(supabase&&t.foto_mapa_url) tMapaImg=await fetchImageBase64(supabase,'relatorios',t.foto_mapa_url)
      if(tMapaImg){
        try{
          const p=doc.getImageProperties(tMapaImg)
          const maxH=95,maxW=CW,r=Math.min(maxW/p.width,maxH/p.height)
          const iw=p.width*r,ih=p.height*r
          doc.addImage(tMapaImg,'JPEG',C2+(maxW-iw)/2,yR,iw,ih)
          yR+=ih+4
        }catch(e){yR+=4}
      } else {
        doc.setFillColor(245,250,247);doc.roundedRect(C2,yR,CW,80,2,2,'F')
        doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(...GR)
        doc.text('Sem foto de mapa',C2+CW/2,yR+42,{align:'center'})
        yR+=83
      }

      // Assinatura
      const tSigX=C2+CW-55
      doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(...GR);doc.text('PILOTO RESPONSÁVEL',tSigX,yR+4)
      doc.setFontSize(10);doc.setFont('helvetica','bolditalic');doc.setTextColor(...DK);doc.text(t.piloto_nome||'',tSigX,yR+12)
      doc.setDrawColor(...GR);doc.setLineWidth(0.3);doc.line(tSigX,yR+13.5,C2+CW,yR+13.5)
      doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(...DK);doc.text(t.piloto_nome||'',tSigX,yR+19)

      // Rodapé
      doc.setFillColor(...G);doc.rect(C1,PH-M-8,PW-M-C1,9,'F')
      doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.setTextColor(...W)
      doc.text('www.orofly.com.br',C1+4,PH-M-3)
      doc.text('Orofly — Tecnologia que protege, resultados que voam.',PW/2,PH-M-3,{align:'center'})
      doc.text(`Página ${ti+2} de ${trechos.length+1}`,PW-M-4,PH-M-3,{align:'right'})
    }
  }

  return doc
}

// ============================================================
// WORD CLIENTE — HTML exportável como .doc / Google Docs
// ============================================================
export async function gerarWordCliente(rel, { supabase, localObsFotos, localFotoMapa } = {}) {
  const fmt = v => v ? new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'
  const fmtData = v => v ? new Date(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}) : '—'

  function calcTempo(ini,fim,pausas) {
    if (!ini||!fim) return null
    const total = Math.round((new Date(fim)-new Date(ini))/60000)
    if (total<=0) return null
    let p=0; (pausas||[]).forEach(pa=>{if(pa.inicio&&pa.fim)p+=Math.max(0,Math.round((new Date(pa.fim)-new Date(pa.inicio))/60000))})
    const fmtM = m => { const h=Math.floor(m/60),min=m%60; return h>0?`${h}h${String(min).padStart(2,'0')}min`:`${min}min` }
    return {total:fmtM(total),efetivo:fmtM(total-p),temPausa:p>0}
  }
  const tempo = calcTempo(rel.dt_inicio, rel.dt_fim, rel.pausas)
  const areaBrutaW = parseFloat(rel.area_ha)||0
  const areaNetaW = areaLiquida(rel)
  const gastosProdutosW = calcularGastoProdutos(rel.produtos, areaNetaW)

  const condKeys = [['Faixa','faixa'],['Vazão','vazao'],['Vento','vento'],['Umidade','umidade'],['Temperatura','temperatura'],['Delta T','delta_t']]

  function addUnit(key,val) {
    if (!val) return '—'
    const units = {faixa:'m',vazao:'L/ha',vento:'km/h',umidade:'%',temperatura:'°C',delta_t:''}
    const unit = units[key]||''
    if (!unit||/[a-zA-Z°%\/]/.test(val)) return val
    return val+' '+unit
  }

  // Foto mapa em base64 para embutir no HTML
  let mapaImg = localFotoMapa||null
  if (!mapaImg && supabase && rel.foto_mapa_url) mapaImg = await fetchImageBase64(supabase,'relatorios',rel.foto_mapa_url)

  const obsImgs = []
  if (localObsFotos?.some(Boolean)) {
    localObsFotos.forEach(f=>obsImgs.push(f))
  } else if (supabase && rel.obs_fotos_urls?.some(Boolean)) {
    for (const path of rel.obs_fotos_urls) {
      obsImgs.push(path ? await fetchImageBase64(supabase,'relatorios',path) : null)
    }
  }
  const obsValidas = obsImgs.filter(Boolean)

  const html = `
<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' 
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'/>
<title>Relatório Orofly — ${rel.cliente||''}</title>
<style>
  @page { margin: 2cm 2.5cm; size: A4; }
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #222; line-height: 1.5; }
  .header { background: #2da05e; padding: 20px 24px; margin: -20px -24px 24px; display:flex; align-items:center; justify-content:space-between; }
  .header-title { color: white; }
  .header-title h1 { font-size: 16pt; margin:0 0 4px; }
  .header-title p { font-size: 10pt; margin:0; opacity:.85; }
  .logo-text { font-size:22pt; font-weight:bold; color:white; letter-spacing:-1px; }
  .gold-line { height:3px; background:#f0c040; margin-bottom:24px; }
  h2 { font-size: 11pt; color: #2da05e; border-left: 4px solid #2da05e; padding-left: 8px; margin: 20px 0 10px; text-transform:uppercase; letter-spacing:.5px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  td { padding: 6px 10px; font-size: 10.5pt; border-bottom: 1px solid #e8f5ee; }
  td:first-child { font-weight: bold; color: #666; width: 38%; }
  tr:nth-child(even) td { background: #f9fcfa; }
  .cond-table td { width: 50%; }
  .cond-header td { background: #e8f5ee; font-weight:bold; color:#2da05e; text-align:center; border:none; }
  .foto-section img { max-width: 100%; border-radius: 6px; margin: 6px 0; }
  .obs-fotos { display:flex; gap:8px; flex-wrap:wrap; }
  .obs-fotos img { width:30%; border-radius:6px; }
  .footer { margin-top: 32px; border-top: 2px solid #2da05e; padding-top: 10px; font-size:9pt; color:#888; display:flex; justify-content:space-between; }
  .badge { display:inline-block; background:#e8f5ee; color:#2da05e; padding:2px 10px; border-radius:20px; font-size:9pt; font-weight:bold; }
</style>
</head>
<body>

<div class="header">
  <div class="logo-text">OROFLY.</div>
  <div class="header-title">
    <h1>Relatório de Aplicação Aérea</h1>
    <p>${fmtData(rel.created_at)} &nbsp;|&nbsp; <span style="opacity:.9">${rel.cliente||''}</span></p>
  </div>
</div>
<div class="gold-line"></div>

<h2>Dados da Operação</h2>
<table>
  <tr><td>Cliente</td><td>${rel.cliente||'—'}</td></tr>
  <tr><td>Fazenda</td><td>${rel.fazenda||'—'}</td></tr>
  ${areaBrutaW?`<tr><td>Área Total (talhões)</td><td>${areaBrutaW} ha</td></tr>`:''}
  ${rel.bordadura?`<tr><td>Bordadura</td><td>${rel.bordadura} ha${rel.bordadura_detalhe?.length?' ('+rel.bordadura_detalhe.map(d=>`${d.talhao}: ${d.bordadura}ha`).join(', ')+')':''}</td></tr>`:''}
  ${areaBrutaW?`<tr><td>Área Aplicada</td><td>${areaNetaW} ha</td></tr>`:''}
  <tr><td>Localização</td><td>${rel.localizacao||'—'}</td></tr>
  ${rel.gps_lat?`<tr><td>Coordenadas GPS</td><td>${rel.gps_lat}, ${rel.gps_lng}</td></tr>`:''}
</table>

${gastosProdutosW.length > 0 ? `
<h2>Produto(s) Aplicado(s)</h2>
<table>
  ${gastosProdutosW.map((g,i)=>`<tr><td>Produto ${i+1}</td><td>${g.nome||g.produto}${g.dose!=null?` — ${g.dose} ${g.unidade}/ha`:''}${g.total!=null?` → total ${g.total} ${g.unidade}`:''}</td></tr>`).join('')}
  ${rel.tamanho_gota?`<tr><td>Tamanho da Gota</td><td>${rel.tamanho_gota}</td></tr>`:''}
  ${rel.velocidade_drone?`<tr><td>Velocidade do Drone</td><td>${rel.velocidade_drone}</td></tr>`:''}
</table>`:''}

<h2>Condições de Aplicação</h2>
<table class="cond-table">
  <tr class="cond-header"><td>INÍCIO</td><td>FIM</td></tr>
  ${condKeys.map(([lbl,key],i)=>`
  <tr>
    <td><b>${lbl}:</b> ${addUnit(key,rel[key+'_i'])}</td>
    <td><b>${lbl}:</b> ${addUnit(key,rel[key+'_f'])}</td>
  </tr>`).join('')}
</table>

<h2>Horários da Operação</h2>
<table>
  <tr><td>Início</td><td>${fmt(rel.dt_inicio)}</td></tr>
  <tr><td>Término</td><td>${fmt(rel.dt_fim)}</td></tr>
  ${tempo?`<tr><td>Tempo Total</td><td>${tempo.total}</td></tr>`:''}
  ${tempo?.temPausa?`<tr><td>Tempo Efetivo</td><td>${tempo.efetivo}</td></tr>`:''}
  ${(rel.pausas||[]).map((p,i)=>`<tr><td>Pausa ${i+1}</td><td>${p.motivo||'—'} — ${fmt(p.inicio)}${p.fim?' até '+fmt(p.fim):''}</td></tr>`).join('')}
</table>

${mapaImg?`
<h2>Mapa de Pós Aplicação</h2>
<div class="foto-section">
  <img src="${mapaImg}" alt="Mapa de aplicação" style="max-height:280px;width:auto"/>
</div>`:''}

${obsValidas.length?`
<h2>Registros Fotográficos</h2>
<div class="obs-fotos">
  ${obsValidas.map(img=>`<img src="${img}" alt="Foto de observação"/>`).join('')}
</div>`:''}

<div class="footer">
  <span>Orofly Aplicações Aéreas &nbsp;|&nbsp; orofly.com.br</span>
  <span>Gerado em ${new Date().toLocaleString('pt-BR')}</span>
</div>

</body>
</html>`

  const blob = new Blob([html], { type: 'application/msword' })
  return blob
}

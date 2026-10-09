// Prepara los modelos 3D reales de la carta (escaneos fotogramétricos CC-BY de Objaverse/Sketchfab).
//   node scripts/platos-3d.mjs <carpeta-con-los-glb-originales> [carpeta-de-salida]
// Necesita: npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//
// Para cada plato: centra el modelo, apoya su base en y=0, lo escala a su tamaño real en metros
// (para que la realidad aumentada lo muestre a escala 1:1), simplifica la malla, pasa las texturas
// a WebP y comprime la geometría con meshopt. Los platos que vienen «sin plato» se sirven sobre un
// plato de cerámica generado aquí, y además se guarda la versión sin plato para ponerla encima de
// un plato real con la cámara.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { dedup, flatten, getBounds, join, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join as ruta } from 'node:path'

const ORIGEN = process.argv[2]
const DESTINO = process.argv[3] || new URL('../web/public/platos/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
mkdirSync(DESTINO, { recursive: true })

// id: [archivo original, diámetro real del conjunto en metros, plato añadido (diámetro) o 0, giro en grados]
const PLATOS = {
  'tabla-ibericos': ['tabla', 0.4, 0, 0],
  ostras: ['ostras', 0.3, 0, 0],
  tortilla: ['tortilla', 0.27, 0, 0],
  'tosta-salmon': ['tosta-salmon', 0.26, 0, 0],
  ensalada: ['ensalada', 0.26, 0, 0],
  'melon-jamon': ['antipasti', 0.29, 0, 0],
  pulpo: ['pulpo2', 0.29, 0, 0],
  'arroz-negro': ['paella2', 0.42, 0, 0],
  chuleton: ['chuleton', 0.32, 0, 0],
  lubina: ['lubina', 0.34, 0, 0],
  salmon: ['salmon', 0.28, 0, 0],
  cordero: ['cordero', 0.36, 0, 0],
  tartar: ['tartar', 0.3, 0, 0],
  'tarta-queso': ['tarta-queso', 0.24, 0.33, 0],
  'tarta-chocolate': ['coulant', 0.25, 0, 0],
  'tarta-higos': ['tarta-higos', 0.2, 0.29, 0],
  'tarta-frambuesa': ['tarta-fresas', 0.27, 0, 0],
  'tartaleta-limon': ['tarta-limon', 0.085, 0.19, 0],
  'cafe-vienes': ['cafe', 0.15, 0, 0],
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
await MeshoptEncoder.ready
await MeshoptDecoder.ready
await MeshoptSimplifier.ready

/** Plato de cerámica por revolución de un perfil (radio, altura) en metros, para un diámetro dado. */
function crearPlato(doc, diametro) {
  const R = diametro / 2
  const k = R / 0.135
  // Perfil desde el centro de la cara superior, por el ala, y de vuelta por debajo hasta el pie.
  const perfil = [
    [0, 0.009], [0.06, 0.009], [0.094, 0.0093], [0.101, 0.0105], [0.106, 0.0135], [0.11, 0.0175], [0.114, 0.0203], [0.12, 0.0217], [0.128, 0.0223], [0.1335, 0.0218], [0.135, 0.0203],
    [0.1342, 0.0186], [0.128, 0.0176], [0.112, 0.0158], [0.1, 0.0105], [0.085, 0.006], [0.07, 0.003], [0.066, 0], [0.06, 0], [0.058, 0.003], [0, 0.004],
  ].map(([r, y]) => [r * k, y * Math.min(k, 1.2)])
  const seg = 128
  const pos = []
  const nor = []
  const idx = []
  const n = perfil.length
  // Normales del perfil (perpendiculares a la tangente, hacia fuera de la superficie).
  const n2 = perfil.map((_, i) => {
    const a = perfil[Math.max(0, i - 1)]
    const b = perfil[Math.min(n - 1, i + 1)]
    const tr = b[0] - a[0]
    const ty = b[1] - a[1]
    const l = Math.hypot(tr, ty) || 1
    return [ty / l, -tr / l] // gira la tangente -90°: arriba en la cara superior, abajo en la inferior
  })
  for (let s = 0; s <= seg; s++) {
    const t = (s / seg) * Math.PI * 2
    const c = Math.cos(t)
    const si = Math.sin(t)
    for (let i = 0; i < n; i++) {
      const [r, y] = perfil[i]
      const [nr, ny] = n2[i]
      pos.push(r * c, y, r * si)
      nor.push(-nr * c, -ny, -nr * si)
    }
  }
  for (let s = 0; s < seg; s++) {
    for (let i = 0; i < n - 1; i++) {
      const a = s * n + i
      const b = (s + 1) * n + i
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const buf = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf))
    .setMaterial(doc.createMaterial('Cerámica').setBaseColorFactor([0.96, 0.95, 0.92, 1]).setRoughnessFactor(0.38).setMetallicFactor(0).setDoubleSided(true))
  const nodo = doc.createNode('Plato').setMesh(doc.createMesh('Plato').addPrimitive(prim))
  return { nodo, altura: 0.009 * Math.min(k, 1.2) }
}

/** Mete todas las raíces de la escena bajo un nodo que centra, apoya y escala el modelo. */
function normalizar(doc, diametro, giro) {
  const escena = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const b = getBounds(escena)
  const ancho = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2])
  const s = diametro / ancho
  const cx = (b.max[0] + b.min[0]) / 2
  const cz = (b.max[2] + b.min[2]) / 2
  const raiz = doc.createNode('Plato real').setScale([s, s, s]).setTranslation([-cx * s, -b.min[1] * s, -cz * s])
  for (const hijo of escena.listChildren()) {
    escena.removeChild(hijo)
    raiz.addChild(hijo)
  }
  const envoltura = doc.createNode('Raíz').addChild(raiz)
  if (giro) envoltura.setRotation([0, Math.sin((giro * Math.PI) / 360), 0, Math.cos((giro * Math.PI) / 360)])
  escena.addChild(envoltura)
  return { escena, envoltura, alto: (b.max[1] - b.min[1]) * s }
}

/**
 * Los escaneos fotogramétricos ya llevan la luz real en la textura: se muestran sin iluminación
 * artificial (KHR_materials_unlit), como en Sketchfab, para que el color sea el de la foto y no
 * parezcan de plástico.
 */
function sinLuz(doc) {
  const unlit = doc.createExtension(KHRMaterialsUnlit)
  for (const m of doc.getRoot().listMaterials()) {
    m.setExtension('KHR_materials_unlit', unlit.createUnlit())
    m.setMetallicFactor(0).setRoughnessFactor(1)
  }
}

async function optimizar(doc, maxTri = 150000) {
  sinLuz(doc)
  await doc.transform(dedup(), flatten(), join(), weld())
  let tri = 0
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tri += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3
  if (tri > maxTri) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: maxTri / tri, error: 0.002, lockBorder: false }))
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 95 }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  return Math.round(tri)
}

const resumen = []
for (const [id, [archivo, diam, plato, giro]] of Object.entries(PLATOS)) {
  const doc = await io.read(ruta(ORIGEN, archivo + '.glb'))
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  const { alto } = normalizar(doc, diam, giro)
  const tri = await optimizar(doc)
  let bytesSolo = 0
  if (plato) {
    // Versión sin plato, para colocarla sobre un plato real con la cámara.
    const solo = await io.writeBinary(doc)
    writeFileSync(ruta(DESTINO, id + '-solo.glb'), solo)
    bytesSolo = solo.byteLength
    // Versión servida: la comida sobre un plato de cerámica.
    const doc2 = await io.readBinary(solo)
    const esc2 = doc2.getRoot().listScenes()[0]
    const { nodo, altura } = crearPlato(doc2, plato)
    for (const h of esc2.listChildren()) {
      const [x, y, z] = h.getTranslation()
      h.setTranslation([x, y + altura, z])
    }
    esc2.addChild(nodo)
    await doc2.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
    const servido = await io.writeBinary(doc2)
    writeFileSync(ruta(DESTINO, id + '.glb'), servido)
    resumen.push({ id, tri, alto: +alto.toFixed(3), kb: Math.round(servido.byteLength / 1024), soloKb: Math.round(bytesSolo / 1024) })
  } else {
    const out = await io.writeBinary(doc)
    writeFileSync(ruta(DESTINO, id + '.glb'), out)
    resumen.push({ id, tri, alto: +alto.toFixed(3), kb: Math.round(out.byteLength / 1024) })
  }
}
console.table(resumen)
writeFileSync(ruta(DESTINO, 'platos.json'), JSON.stringify(Object.fromEntries(Object.entries(PLATOS).map(([id, [, diam, plato]]) => [id, { diametro: plato || diam, solo: !!plato }])), null, 1))

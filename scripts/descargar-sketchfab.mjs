// Descarga los escaneos originales (máxima calidad) de Sketchfab para los platos de la carta.
//   SKETCHFAB_TOKEN=xxxx node scripts/descargar-sketchfab.mjs <carpeta-destino>
// El token está en sketchfab.com → Settings → Password & API. Solo se usa para pedir la descarga.
// Después:
//   node scripts/platos-3d.mjs <carpeta-destino> web/public/platos
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const TOKEN = process.env.SKETCHFAB_TOKEN
const DESTINO = process.argv[2]
if (!TOKEN || !DESTINO) {
  console.error('Uso: SKETCHFAB_TOKEN=xxxx node scripts/descargar-sketchfab.mjs <carpeta-destino>')
  process.exit(1)
}
mkdirSync(DESTINO, { recursive: true })

// Nombre del archivo que espera platos-3d.mjs → uid del modelo en Sketchfab (de creditos-3d.json).
const creditos = JSON.parse(readFileSync(new URL('../web/src/creditos-3d.json', import.meta.url), 'utf8'))
const ARCHIVO = {
  'tabla-ibericos': 'tabla', ostras: 'ostras', tortilla: 'tortilla', 'tosta-salmon': 'tosta-salmon', ensalada: 'ensalada',
  'melon-jamon': 'antipasti', pulpo: 'pulpo2', 'arroz-negro': 'paella2', chuleton: 'chuleton', lubina: 'lubina', salmon: 'salmon',
  cordero: 'cordero', tartar: 'tartar', 'tarta-queso': 'tarta-queso', 'tarta-chocolate': 'coulant', 'tarta-higos': 'tarta-higos',
  'tarta-frambuesa': 'tarta-fresas', 'tartaleta-limon': 'tarta-limon', 'cafe-vienes': 'cafe',
}

const resumen = []
for (const [id, archivo] of Object.entries(ARCHIVO)) {
  const uid = creditos[id]?.url.split('/').pop()
  const salida = join(DESTINO, archivo + '.glb')
  if (existsSync(salida)) {
    resumen.push({ id, estado: 'ya estaba' })
    continue
  }
  const r = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${TOKEN}` } })
  if (r.status === 401) throw new Error('Token no válido.')
  if (!r.ok) {
    resumen.push({ id, estado: 'error ' + r.status })
    continue
  }
  const d = await r.json()
  // Prioridad: GLB directo; si no, el glTF comprimido (zip) y se convierte a GLB.
  if (d.glb?.url) {
    writeFileSync(salida, Buffer.from(await (await fetch(d.glb.url)).arrayBuffer()))
    resumen.push({ id, estado: 'glb', mb: +(d.glb.size / 1e6).toFixed(1) })
  } else if (d.gltf?.url) {
    const zip = join(DESTINO, archivo + '.zip')
    const dir = join(DESTINO, archivo + '_gltf')
    writeFileSync(zip, Buffer.from(await (await fetch(d.gltf.url)).arrayBuffer()))
    mkdirSync(dir, { recursive: true })
    execFileSync('tar', ['-xf', zip, '-C', dir])
    execFileSync('npx', ['--yes', '@gltf-transform/cli', 'copy', join(dir, 'scene.gltf'), salida], { stdio: 'ignore', shell: true })
    resumen.push({ id, estado: 'gltf → glb', mb: +(d.gltf.size / 1e6).toFixed(1) })
  } else resumen.push({ id, estado: 'sin descarga' })
}
console.table(resumen)

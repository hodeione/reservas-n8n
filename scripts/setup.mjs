// Instalador: deja n8n listo con un solo comando (se puede repetir sin duplicar nada).
//   node scripts/setup.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { loadEnv, N8n } from './n8n-api.mjs'

const env = loadEnv()
const n = new N8n(`http://localhost:${env.PUERTO_LOCAL || 5680}`)

console.log('· Esperando a n8n…')
await n.waitHealthy()
await n.ensureOwnerAndLogin(env.N8N_ADMIN_EMAIL, env.N8N_ADMIN_PASSWORD)
await n.createApiKey()
console.log('✓ Administrador:', env.N8N_ADMIN_EMAIL)

const reservas = await n.ensureDataTable('reservas', [
  { name: 'codigo', type: 'string' },
  { name: 'token', type: 'string' },
  { name: 'nombre', type: 'string' },
  { name: 'email', type: 'string' },
  { name: 'telefono', type: 'string' },
  { name: 'fecha', type: 'string' },
  { name: 'hora', type: 'string' },
  { name: 'turno', type: 'string' },
  { name: 'personas', type: 'number' },
  { name: 'notas', type: 'string' },
  { name: 'origen', type: 'string' },
  { name: 'estado', type: 'string' },
  { name: 'asistencia', type: 'string' },
  { name: 'recordatorio', type: 'boolean' },
  { name: 'resena', type: 'boolean' },
  { name: 'ref', type: 'string' },
  { name: 'mesa', type: 'string' },
])
const espera = await n.ensureDataTable('lista_espera', [
  { name: 'token', type: 'string' },
  { name: 'nombre', type: 'string' },
  { name: 'email', type: 'string' },
  { name: 'telefono', type: 'string' },
  { name: 'fecha', type: 'string' },
  { name: 'hora', type: 'string' },
  { name: 'turno', type: 'string' },
  { name: 'personas', type: 'number' },
  { name: 'notas', type: 'string' },
  { name: 'estado', type: 'string' },
  { name: 'ref', type: 'string' },
])
const contenido = await n.ensureDataTable('contenido', [
  { name: 'clave', type: 'string' },
  { name: 'valor', type: 'string' },
])
const clientes = await n.ensureDataTable('clientes', [
  { name: 'telefono', type: 'string' },
  { name: 'ultimo_aviso', type: 'string' },
])
console.log('✓ Tablas: reservas, lista_espera, contenido y clientes')

// Datos de muestra (configuración, plano y carta) solo si aún no existen:
// lo que el restaurante edite desde la administración nunca se sobrescribe.
const demo = JSON.parse(readFileSync(new URL('../src/demo.json', import.meta.url), 'utf8'))
const reset = process.argv.includes('--reiniciar-demo')
// El email del dueño y el enlace de reseñas salen del .env la primera vez; luego se cambian en Ajustes.
demo.config.emailDueno ||= env.REST_EMAIL_DUENO || ''
demo.config.resena ||= env.REST_URL_RESENA || ''
const existentes = new Map((await n.rows(contenido)).map((r) => [r.clave, r]))
for (const clave of ['config', 'mesas', 'carta']) {
  const valor = JSON.stringify(demo[clave])
  if (existentes.has(clave) && !reset) continue
  if (existentes.has(clave)) {
    await n.rest('PATCH', `/projects/${n.project.id}/data-tables/${contenido}/rows`, { filter: { type: 'and', filters: [{ columnName: 'clave', condition: 'eq', value: clave }] }, data: { valor } })
  } else {
    await n.rest('POST', `/projects/${n.project.id}/data-tables/${contenido}/insert`, { data: [{ clave, valor }], returnType: 'count' })
  }
  console.log('✓ Datos de muestra:', clave)
}

// Credencial SMTP (se recrea para aplicar cambios del .env).
const CRED = 'SMTP restaurante'
for (const c of await n.rest('GET', '/credentials')) {
  if (c.name === CRED) await n.rest('DELETE', `/credentials/${c.id}`)
}
const smtp = await n.rest('POST', '/credentials', {
  name: CRED,
  type: 'smtp',
  projectId: n.project.id,
  data: {
    user: env.SMTP_USER || '',
    password: env.SMTP_PASSWORD || '',
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    disableStartTls: env.SMTP_HOST === 'mailpit',
    hostName: '',
  },
})
console.log('✓ Correo:', `${env.SMTP_HOST}:${env.SMTP_PORT}`)

const dir = new URL('../workflows/', import.meta.url)
const ficheros = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
// Retira flujos de versiones anteriores que ya no existen (p. ej. el panel antiguo).
const actuales = new Set(ficheros.map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')).name))
for (const w of (await n.api('GET', '/workflows?limit=250')).data) {
  if (/^\d{2} · /.test(w.name) && !actuales.has(w.name)) {
    if (w.active) await n.api('POST', `/workflows/${w.id}/deactivate`)
    await n.api('DELETE', `/workflows/${w.id}`)
    console.log('✓ Retirado:', w.name)
  }
}
for (const file of ficheros) {
  const raw = readFileSync(new URL(file, dir), 'utf8')
    .replaceAll('__DT_RESERVAS__', reservas)
    .replaceAll('__DT_ESPERA__', espera)
    .replaceAll('__DT_CONTENIDO__', contenido)
    .replaceAll('__DT_CLIENTES__', clientes)
    .replaceAll('__SMTP__', smtp.id)
  const wf = JSON.parse(raw)
  await n.upsertWorkflow(wf)
  console.log('✓ Activo:', wf.name)
}

const base = env.URL_PUBLICA.replace(/\/$/, '')
console.log(`
Listo.
  Web del restaurante:   ${base}/
  Administración:        ${base}/admin   (clave: REST_CLAVE_PANEL del .env)
  Editor de n8n:         ${env.URL_EDITOR || `http://localhost:${env.PUERTO_LOCAL || 5680}`}   (${env.N8N_ADMIN_EMAIL})`)

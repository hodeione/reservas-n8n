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
console.log('✓ Tablas: reservas y lista_espera')

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
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const raw = readFileSync(new URL(file, dir), 'utf8')
    .replaceAll('__DT_RESERVAS__', reservas)
    .replaceAll('__DT_ESPERA__', espera)
    .replaceAll('__SMTP__', smtp.id)
  const wf = JSON.parse(raw)
  await n.upsertWorkflow(wf)
  console.log('✓ Activo:', wf.name)
}

const base = env.URL_PUBLICA.replace(/\/$/, '')
console.log(`
Listo.
  Reservas (clientes):   ${base}/webhook/reservar
  Panel (restaurante):   ${base}/webhook/panel?clave=${env.REST_CLAVE_PANEL}
  Editor de n8n:         ${base}   (${env.N8N_ADMIN_EMAIL})`)

// Prueba de principio a fin contra la instalación local (n8n + Mailpit).
//   node scripts/e2e.mjs
// Borra las reservas y la lista de espera antes de empezar: úsalo solo en desarrollo.
import { loadEnv, N8n } from './n8n-api.mjs'

const env = loadEnv()
const BASE = `http://localhost:${env.PUERTO_LOCAL || 5680}/webhook`
const MAIL = 'http://localhost:8025/api/v1'
const n = new N8n(`http://localhost:${env.PUERTO_LOCAL || 5680}`)
await n.waitHealthy()
await n.ensureOwnerAndLogin(env.N8N_ADMIN_EMAIL, env.N8N_ADMIN_PASSWORD)
const T = { reservas: await n.ensureDataTable('reservas', []), espera: await n.ensureDataTable('lista_espera', []) }

let fallos = 0
let pasos = 0
const ok = (cond, texto, extra) => {
  pasos++
  if (cond) console.log('  ✓', texto)
  else {
    fallos++
    console.log('  ✗', texto, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '')
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function http(method, path, body, headers = {}) {
  const isForm = body instanceof URLSearchParams
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  const text = await r.text()
  let json
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, json, text }
}
const mails = async () => (await (await fetch(`${MAIL}/messages?limit=200`)).json()).messages ?? []
async function esperarMail(pred, ms = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const m = (await mails()).find(pred)
    if (m) return m
    await sleep(500)
  }
  return null
}
const filas = async (t) => n.rows(T[t])

// Fechas: mañana (abierto) y el próximo lunes (cerrado con REST_DIAS_CERRADO=1).
const d = new Date()
const iso = (x) => x.toISOString().slice(0, 10)
const manana = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12)
if (manana.getDay() === 1) manana.setDate(manana.getDate() + 1)
const FECHA = iso(manana)
const lunes = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((8 - d.getDay()) % 7 || 7), 12)
const AGENTE = { 'x-api-key': env.REST_CLAVE_AGENTE }
console.log(`Probando con fecha ${FECHA} (y lunes ${iso(lunes)} cerrado)\n`)

await n.clearRows(T.reservas)
await n.clearRows(T.espera)
await fetch(`${MAIL}/messages`, { method: 'DELETE' })

console.log('1 · Página pública y disponibilidad')
let r = await http('GET', '/reservar')
ok(r.status === 200 && r.text.includes(env.REST_NOMBRE) && r.text.includes('Confirmar reserva'), 'La página de reservas carga con el nombre del restaurante')
r = await http('GET', `/api/disponibilidad?fecha=${FECHA}&personas=2`)
ok(r.status === 200 && r.json.horas.length === 10 && r.json.horas.every((h) => h.disponible), 'Mañana hay 10 franjas libres', r.json)
ok(typeof r.json.resumen === 'string' && r.json.resumen.includes('hay sitio'), 'Incluye un resumen para el recepcionista de IA', r.json.resumen)
r = await http('GET', `/api/disponibilidad?fecha=${iso(lunes)}`)
ok(r.json.cerrado === true, 'El lunes aparece como cerrado', r.json)
r = await http('GET', '/api/disponibilidad?fecha=2020-01-01')
ok(r.status === 400, 'Una fecha pasada se rechaza', r.json)

console.log('2 · Reservar desde la web')
const ana = { nombre: 'Ana López', telefono: '600 11 22 33', email: 'ana@ejemplo.com', fecha: FECHA, hora: '21:00', personas: 10, notas: 'Celíaca' }
r = await http('POST', '/api/reservas', ana)
ok(r.status === 201 && r.json.ok && /^[A-Z2-9]{6}$/.test(r.json.codigo), 'Reserva creada con código de 6 caracteres', r.json)
const codigoAna = r.json.codigo
ok(!!(await esperarMail((m) => m.To[0].Address === 'ana@ejemplo.com' && m.Subject.startsWith('Reserva confirmada'))), 'Ana recibe el email de confirmación')
r = await http('POST', '/api/reservas', { ...ana, hora: '13:00', personas: 2 })
ok(r.status === 409 && r.json.errores[0].includes(codigoAna), 'No deja reservar dos veces el mismo día con el mismo teléfono', r.json)
r = await http('POST', '/api/reservas', { nombre: 'X', telefono: '123', fecha: FECHA, hora: '04:00', personas: 0 })
ok(r.status === 400 && r.json.errores.length >= 3, 'Valida los datos y explica cada error', r.json)
r = await http('POST', '/api/reservas', { ...ana, telefono: '611000000', personas: 12 })
ok(r.status === 400 && r.json.errores.some((e) => e.includes('grupos')), 'Los grupos grandes se derivan al teléfono', r.json)
r = await http('POST', '/api/reservas', { ...ana, telefono: '622000000', web: 'spam' })
ok(r.status === 400, 'El campo trampa bloquea a los bots')

console.log('3 · Aforo por franja y lista de espera')
r = await http('POST', '/api/reservas', { nombre: 'Bruno Díaz', telefono: '600222333', email: 'bruno@ejemplo.com', fecha: FECHA, hora: '21:00', personas: 6 })
ok(r.status === 201, 'Bruno reserva 6 a las 21:00 (franja completa: 16 de 16)', r.json)
r = await http('POST', '/api/reservas', { nombre: 'Carla Ruiz', telefono: '600333444', email: 'carla@ejemplo.com', fecha: FECHA, hora: '21:00', personas: 2 })
ok(r.status === 409 && r.json.alternativas?.length > 0 && r.json.lista_espera === true, 'Carla no cabe a las 21:00: se le ofrecen otras horas y la lista de espera', r.json)
r = await http('GET', `/api/disponibilidad?fecha=${FECHA}&personas=2`)
ok(r.json.horas.find((h) => h.hora === '21:00').disponible === false, 'Las 21:00 aparecen como no disponibles')
r = await http('POST', '/api/espera', { nombre: 'Carla Ruiz', telefono: '600333444', email: 'carla@ejemplo.com', fecha: FECHA, hora: '21:00', personas: 2 })
ok(r.status === 201 && r.json.ok, 'Carla se apunta a la lista de espera', r.json)
ok(!!(await esperarMail((m) => m.To[0].Address === 'carla@ejemplo.com' && m.Subject.includes('lista de espera'))), 'Carla recibe el aviso de que está en la lista')

console.log('4 · El cliente cancela desde su enlace y la lista de espera se mueve sola')
const bruno = (await filas('reservas')).find((x) => x.nombre === 'Bruno Díaz')
r = await http('GET', `/reserva?t=${bruno.token}`)
ok(r.status === 200 && r.text.includes('Cancelar reserva') && r.text.includes('Bruno'), 'La página de la reserva muestra los datos y el botón de cancelar')
r = await http('GET', `/reserva?t=no-existe`)
ok(r.status === 404, 'Un enlace falso da 404')
r = await http('POST', '/reserva', new URLSearchParams({ t: bruno.token, accion: 'cancelar' }))
ok(r.status === 200 && r.text.includes('Reserva cancelada'), 'Bruno cancela con un clic')
ok((await filas('reservas')).find((x) => x.token === bruno.token).estado === 'cancelada', 'La reserva de Bruno queda cancelada en la base de datos')
const mesaCarla = await esperarMail((m) => m.To[0].Address === 'carla@ejemplo.com' && m.Subject.startsWith('¡Tienes mesa!'), 20000)
ok(!!mesaCarla, 'Carla recibe automáticamente «¡Tienes mesa!»')
const carla = (await filas('reservas')).find((x) => x.nombre === 'Carla Ruiz')
ok(carla && carla.hora === '21:00' && carla.origen === 'espera' && carla.estado === 'confirmada', 'Carla tiene su reserva a las 21:00 creada desde la lista de espera', carla)
ok((await filas('espera')).find((x) => x.nombre === 'Carla Ruiz')?.estado === 'convertida', 'Carla sale de la lista de espera')

console.log('5 · Recepcionista de IA por teléfono')
r = await http('POST', '/api/reservas', { nombre: 'David Gil', telefono: '+34 655 44 33 22', fecha: FECHA, hora: '14:00', personas: 4, origen: 'ia' }, AGENTE)
ok(r.status === 201 && r.json.ok, 'El agente crea una reserva sin email', r.json)
const codigoDavid = r.json.codigo
ok((await filas('reservas')).find((x) => x.codigo === codigoDavid)?.origen === 'ia', 'Queda marcada como reserva hecha por la IA')
r = await http('POST', '/api/reservas', { nombre: 'Eva', telefono: '600999888', fecha: FECHA, hora: '14:00', personas: 2 }, { 'x-api-key': 'falsa' })
ok(r.status === 400 && r.json.errores.includes('Clave no válida.'), 'Una clave falsa no permite reservar como agente', r.json)
r = await http('POST', '/api/cancelar', { codigo: codigoDavid, telefono: '600000000' }, AGENTE)
ok(r.status === 404, 'No cancela si el teléfono no coincide', r.json)
r = await http('POST', '/api/cancelar', { codigo: codigoDavid, telefono: '655443322' })
ok(r.status === 401, 'Cancelar por API exige la clave', r.json)
r = await http('POST', '/api/cancelar', { codigo: codigoDavid.toLowerCase(), telefono: '655 44 33 22' }, AGENTE)
ok(r.status === 200 && r.json.ok, 'El agente cancela con código y teléfono', r.json)

console.log('6 · Panel del restaurante')
r = await http('GET', `/panel?clave=mala`)
ok(r.status === 401 && r.text.includes('Clave'), 'Sin clave correcta pide la clave')
r = await http('GET', `/panel?clave=${env.REST_CLAVE_PANEL}&fecha=${FECHA}`)
ok(r.status === 200 && r.text.includes('Ana López') && r.text.includes('Celíaca'), 'El panel muestra las reservas del día con las alergias')
const anaRow = (await filas('reservas')).find((x) => x.codigo === codigoAna)
r = await http('POST', '/api/panel', { clave: env.REST_CLAVE_PANEL, token: anaRow.token, estado: 'llegada' })
ok(r.status === 200 && (await filas('reservas')).find((x) => x.codigo === codigoAna).estado === 'llegada', 'El personal marca a Ana como llegada')
r = await http('POST', '/api/panel', { clave: env.REST_CLAVE_PANEL, token: anaRow.token, estado: 'confirmada' })
ok(r.status === 200, 'Y puede deshacerlo')
r = await http('POST', '/api/panel', { clave: 'mala', token: anaRow.token, estado: 'no_show' })
ok(r.status === 401, 'Sin clave no se puede cambiar nada')
r = await http('POST', '/api/reservas', { nombre: 'Mesa en barra', telefono: '944000000', fecha: FECHA, hora: '13:30', personas: 2, clave: env.REST_CLAVE_PANEL, origen: 'local' })
ok(r.status === 201, 'El personal apunta una reserva telefónica desde el panel', r.json)

console.log('7 · Recordatorio del día antes con confirmación de asistencia')
await fetch(`${MAIL}/messages`, { method: 'DELETE' })
await http('POST', '/tareas/recordatorios', { clave: env.REST_CLAVE_PANEL })
const rec = await esperarMail((m) => m.To[0].Address === 'ana@ejemplo.com' && m.Subject.startsWith('Mañana te esperamos'))
ok(!!rec, 'Ana recibe el recordatorio')
await sleep(2500)
ok((await filas('reservas')).filter((x) => x.recordatorio).length >= 2, 'Las reservas quedan marcadas como recordadas')
await fetch(`${MAIL}/messages`, { method: 'DELETE' })
await http('POST', '/tareas/recordatorios', { clave: env.REST_CLAVE_PANEL })
await sleep(4000)
ok((await mails()).length === 0, 'Repetir la tarea no envía recordatorios duplicados')
r = await http('POST', '/reserva', new URLSearchParams({ t: anaRow.token, accion: 'confirmar' }))
ok(r.text.includes('Gracias por confirmar') && (await filas('reservas')).find((x) => x.codigo === codigoAna).asistencia === 'confirmada', 'Ana confirma asistencia con un clic')

console.log('8 · Informe diario y petición de reseña')
await http('POST', '/tareas/informe', { clave: env.REST_CLAVE_PANEL })
ok(!!(await esperarMail((m) => m.To[0].Address === env.REST_EMAIL_DUENO && m.Subject.startsWith('Hoy:'))), 'El dueño recibe el informe diario')
await http('POST', '/tareas/informe', { clave: 'mala' })
// Simula una cena de ayer para la petición de reseña.
const ayer = iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12))
await n.rest('POST', `/projects/${n.project.id}/data-tables/${T.reservas}/insert`, {
  data: [{ codigo: 'AYER01', token: 'tok-ayer', nombre: 'Fran Sanz', email: 'fran@ejemplo.com', telefono: '+34600555666', fecha: ayer, hora: '21:30', turno: 'cena', personas: 2, notas: '', origen: 'web', estado: 'llegada', asistencia: '', recordatorio: true, resena: false, ref: '' }],
  returnType: 'count',
})
await http('POST', '/tareas/resenas', { clave: env.REST_CLAVE_PANEL })
const res = await esperarMail((m) => m.To[0].Address === 'fran@ejemplo.com' && m.Subject.includes('¿Qué tal ayer'))
ok(!!res, 'Fran recibe la petición de reseña al día siguiente')
await sleep(2000)
ok((await filas('reservas')).find((x) => x.codigo === 'AYER01').resena === true, 'Queda marcada para no volver a pedirla')

const html = res ? await (await fetch(`${MAIL}/message/${res.ID}`)).json() : null
ok(html && html.HTML.includes(env.REST_URL_RESENA), 'El email lleva el enlace de reseñas de Google')

console.log(`\n${pasos - fallos}/${pasos} comprobaciones correctas${fallos ? ` · ${fallos} fallos` : ''}`)
process.exit(fallos ? 1 : 0)

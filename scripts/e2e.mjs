// Prueba de principio a fin contra la instalación local (n8n + Mailpit + web).
//   node scripts/e2e.mjs
// Borra las reservas y la lista de espera antes de empezar: úsalo solo en desarrollo.
// La configuración, el plano y la carta se guardan al empezar y se restauran al acabar.
import { loadEnv, N8n } from './n8n-api.mjs'

const env = loadEnv()
const N8N = `http://localhost:${env.PUERTO_LOCAL || 5680}`
const WEB = `http://localhost:${env.PUERTO_WEB || 8088}`
const BASE = `${N8N}/webhook`
const MAIL = 'http://localhost:8025/api/v1'
const n = new N8n(N8N)
await n.waitHealthy()
await n.ensureOwnerAndLogin(env.N8N_ADMIN_EMAIL, env.N8N_ADMIN_PASSWORD)
const T = { reservas: await n.ensureDataTable('reservas', []), espera: await n.ensureDataTable('lista_espera', []), clientes: await n.ensureDataTable('clientes', []) }

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
async function http(method, path, body, headers = {}, base = BASE) {
  const isForm = body instanceof URLSearchParams
  const r = await fetch(base + path, {
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
const fila = async (pred) => (await filas('reservas')).find(pred)

const ADMIN = { 'x-api-key': env.REST_CLAVE_PANEL }
const AGENTE = { 'x-api-key': env.REST_CLAVE_AGENTE }

// Fechas: mañana (si es lunes, pasado), y el próximo lunes, que en la demo está cerrado.
const d = new Date()
const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const manana = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12)
if (manana.getDay() === 1) manana.setDate(manana.getDate() + 1)
const FECHA = iso(manana)
const lunes = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((8 - d.getDay()) % 7 || 7), 12)

// Copia del contenido para restaurarlo al final.
const original = (await http('GET', '/api/admin/datos', undefined, ADMIN)).json
if (!original?.ok) throw new Error('No se puede leer la administración. ¿Está REST_CLAVE_PANEL en el .env y desplegado setup.mjs?')
async function restaurar() {
  for (const tipo of ['config', 'mesas', 'carta']) await http('POST', '/api/admin/guardar', { tipo, valor: original[tipo] }, ADMIN)
}

console.log(`Probando con fecha ${FECHA} (y lunes ${iso(lunes)} cerrado)\n`)
await n.clearRows(T.reservas)
await n.clearRows(T.espera)
await n.clearRows(T.clientes)
await fetch(`${MAIL}/messages`, { method: 'DELETE' })

try {
  console.log('1 · Web del restaurante')
  let r = await http('GET', '/', undefined, {}, WEB)
  ok(r.status === 200 && r.text.includes('<div id="root">'), 'La web se sirve en ' + WEB)
  r = await http('GET', '/admin/plano', undefined, {}, WEB)
  ok(r.status === 200 && r.text.includes('<div id="root">'), 'Las rutas internas (/admin/plano) cargan la aplicación')
  r = await fetch(`${WEB}/modelos/pizza.glb`)
  ok(r.status === 200 && (await r.arrayBuffer()).byteLength > 1000, 'Los modelos 3D se sirven')
  r = await http('GET', '/webhook/api/web', undefined, {}, WEB)
  ok(r.status === 200 && r.json.restaurante.nombre === original.config.nombre, 'La API se sirve a través de la web (mismo dominio)', r.json)
  ok(r.json.mesas.length === original.mesas.filter((m) => m.activa !== false).length && r.json.mesas[0].x !== undefined, 'Incluye el plano de mesas con posiciones')
  ok(r.json.carta.platos.length > 0 && r.json.carta.platos.every((p) => p.disponible), 'La carta pública solo trae platos disponibles')
  ok(!('emailDueno' in r.json.restaurante) && !('resena' in r.json.restaurante), 'No expone datos internos (email del dueño)')

  console.log('2 · Disponibilidad y plano')
  r = await http('GET', `/api/disponibilidad?fecha=${FECHA}&personas=2`)
  ok(r.status === 200 && r.json.horas.length === 10 && r.json.horas.every((h) => h.disponible), 'Mañana hay 10 horas libres', r.json)
  ok(typeof r.json.resumen === 'string' && r.json.resumen.includes('hay sitio'), 'Incluye un resumen para el recepcionista de IA', r.json.resumen)
  r = await http('GET', `/api/disponibilidad?fecha=${iso(lunes)}`)
  ok(r.json.cerrado === true, 'El lunes aparece como cerrado', r.json)
  r = await http('GET', '/api/disponibilidad?fecha=2020-01-01')
  ok(r.status === 400, 'Una fecha pasada se rechaza', r.json)
  r = await http('GET', `/api/mapa?fecha=${FECHA}&hora=21:00&personas=2`)
  const est = Object.fromEntries((r.json?.mesas ?? []).map((m) => [m.id, m.estado]))
  ok(est.s1 === 'libre' && est.s8 === 'no_cabe', 'El plano marca qué mesas sirven para 2 (la de 10 no)', r.json)
  ok(['s1', 's2', 's9', 't1', 't2'].includes(r.json.recomendada), 'Recomienda una mesa de 2 para una pareja', r.json.recomendada)

  console.log('3 · Reservar desde la web con mesa')
  const ana = { nombre: 'Ana López', telefono: '600 11 22 33', email: 'ana@ejemplo.com', fecha: FECHA, hora: '21:00', personas: 8, notas: 'Celíaca' }
  r = await http('POST', '/api/reservas', ana)
  ok(r.status === 201 && r.json.ok && /^[A-Z2-9]{6}$/.test(r.json.codigo), 'Reserva creada con código de 6 caracteres', r.json)
  const codigoAna = r.json.codigo
  ok((await fila((x) => x.codigo === codigoAna))?.mesa === 's8', 'A 8 personas se les asigna la única mesa de 10 (s8)')
  ok(!!(await esperarMail((m) => m.To[0].Address === 'ana@ejemplo.com' && m.Subject.startsWith('Reserva confirmada'))), 'Ana recibe el email de confirmación')
  r = await http('POST', '/api/reservas', { ...ana, hora: '13:00', personas: 2 })
  ok(r.status === 409 && r.json.errores[0].includes(codigoAna), 'No deja reservar dos veces el mismo día con el mismo teléfono', r.json)
  r = await http('POST', '/api/reservas', { nombre: 'X', telefono: '123', fecha: FECHA, hora: '04:00', personas: 0 })
  ok(r.status === 400 && r.json.errores.length >= 3, 'Valida los datos y explica cada error', r.json)
  r = await http('POST', '/api/reservas', { ...ana, telefono: '611000000', personas: 12 })
  ok(r.status === 400 && r.json.errores.some((e) => e.includes('grupos')), 'Los grupos grandes se derivan al teléfono', r.json)
  r = await http('POST', '/api/reservas', { ...ana, telefono: '622000000', web: 'spam' })
  ok(r.status === 400, 'El campo trampa bloquea a los bots')

  const bruno = { nombre: 'Bruno Díaz', telefono: '600222333', email: 'bruno@ejemplo.com', fecha: FECHA, hora: '21:00', personas: 2, mesa: 't1' }
  r = await http('POST', '/api/reservas', bruno)
  ok(r.status === 201 && r.json.zona === 'Terraza', 'Bruno elige la mesa T1 de la terraza en el plano', r.json)
  r = await http('POST', '/api/reservas', { ...bruno, nombre: 'Eva Mar', telefono: '600444555', email: '' })
  ok(r.status === 409 && r.json.errores[0].includes('ya está reservada'), 'Nadie más puede coger T1 a esa hora', r.json)
  r = await http('POST', '/api/reservas', { ...bruno, nombre: 'Eva Mar', telefono: '600444555', email: '', hora: '22:00' })
  ok(r.status === 409, 'Ni una hora después: la mesa está ocupada mientras dura la cena', r.json)
  r = await http('POST', '/api/reservas', { ...bruno, nombre: 'Eva Mar', telefono: '600444555', email: '', mesa: 's8', hora: '13:00' })
  ok(r.status === 409 && r.json.errores[0].includes('es para'), 'Una pareja no puede ocupar la mesa de 10', r.json)
  r = await http('GET', `/api/mapa?fecha=${FECHA}&hora=21:30&personas=2`)
  const est2 = Object.fromEntries(r.json.mesas.map((m) => [m.id, m.estado]))
  ok(est2.t1 === 'ocupada' && est2.s8 === 'ocupada', 'El plano de las 21:30 muestra T1 y S8 ocupadas', r.json)

  console.log('4 · Sin mesa: lista de espera automática')
  // Mesas para 6: s5 y t5 (s8 ya es de Ana).
  r = await http('POST', '/api/reservas', { nombre: 'Gonzalo Ruiz', telefono: '600555001', fecha: FECHA, hora: '21:30', personas: 6 })
  ok(r.status === 201, 'Gonzalo reserva 6 a las 21:30', r.json)
  r = await http('POST', '/api/reservas', { nombre: 'Hugo Sanz', telefono: '600555002', email: 'hugo@ejemplo.com', fecha: FECHA, hora: '21:30', personas: 6 })
  ok(r.status === 201, 'Hugo reserva otra mesa de 6 a las 21:30', r.json)
  const carla = { nombre: 'Carla Ruiz', telefono: '600333444', email: 'carla@ejemplo.com', fecha: FECHA, hora: '21:30', personas: 6 }
  r = await http('POST', '/api/reservas', carla)
  ok(r.status === 409 && r.json.lista_espera === true, 'Carla ya no tiene mesa de 6: se le ofrece la lista de espera', r.json)
  r = await http('GET', `/api/disponibilidad?fecha=${FECHA}&personas=6`)
  ok(r.json.horas.find((h) => h.hora === '21:30').disponible === false, 'Las 21:30 salen sin sitio para 6')
  r = await http('POST', '/api/espera', carla)
  ok(r.status === 201 && r.json.ok, 'Carla se apunta a la lista de espera', r.json)
  ok(!!(await esperarMail((m) => m.To[0].Address === 'carla@ejemplo.com' && m.Subject.includes('lista de espera'))), 'Carla recibe el aviso de que está en la lista')

  console.log('5 · El cliente cancela desde su enlace y la lista de espera se mueve sola')
  const hugo = await fila((x) => x.nombre === 'Hugo Sanz')
  r = await http('GET', `/reserva?t=${hugo.token}`)
  ok(r.status === 200 && r.text.includes('Cancelar reserva') && r.text.includes('Hugo'), 'La página de la reserva muestra los datos y el botón de cancelar')
  r = await http('GET', `/reserva?t=no-existe`)
  ok(r.status === 404, 'Un enlace falso da 404')
  r = await http('POST', '/reserva', new URLSearchParams({ t: hugo.token, accion: 'cancelar' }))
  ok(r.status === 200 && r.text.includes('Reserva cancelada'), 'Hugo cancela con un clic')
  ok((await fila((x) => x.token === hugo.token)).estado === 'cancelada', 'La reserva de Hugo queda cancelada')
  ok(!!(await esperarMail((m) => m.To[0].Address === 'carla@ejemplo.com' && m.Subject.startsWith('¡Tienes mesa!'), 20000)), 'Carla recibe automáticamente «¡Tienes mesa!»')
  const carlaRow = await fila((x) => x.nombre === 'Carla Ruiz')
  ok(carlaRow && carlaRow.hora === '21:30' && carlaRow.origen === 'espera' && carlaRow.mesa === hugo.mesa, 'Carla hereda la mesa que dejó Hugo', carlaRow)
  ok((await filas('espera')).find((x) => x.nombre === 'Carla Ruiz')?.estado === 'convertida', 'Carla sale de la lista de espera')

  console.log('6 · Recepcionista de IA por teléfono')
  r = await http('POST', '/api/reservas', { nombre: 'David Gil', telefono: '+34 655 44 33 22', fecha: FECHA, hora: '14:00', personas: 4, origen: 'ia' }, AGENTE)
  ok(r.status === 201 && r.json.ok && r.json.mesa, 'El agente crea una reserva sin email y recibe la mesa', r.json)
  const codigoDavid = r.json.codigo
  ok((await fila((x) => x.codigo === codigoDavid))?.origen === 'ia', 'Queda marcada como reserva hecha por la IA')
  r = await http('POST', '/api/reservas', { nombre: 'Eva', telefono: '600999888', fecha: FECHA, hora: '14:00', personas: 2 }, { 'x-api-key': 'falsa' })
  ok(r.status === 400 && r.json.errores.includes('Clave no válida.'), 'Una clave falsa no permite reservar como agente', r.json)
  r = await http('POST', '/api/cancelar', { codigo: codigoDavid, telefono: '600000000' }, AGENTE)
  ok(r.status === 404, 'No cancela si el teléfono no coincide', r.json)
  r = await http('POST', '/api/cancelar', { codigo: codigoDavid, telefono: '655443322' })
  ok(r.status === 401, 'Cancelar por API exige la clave', r.json)
  r = await http('POST', '/api/cancelar', { codigo: codigoDavid.toLowerCase(), telefono: '655 44 33 22' }, AGENTE)
  ok(r.status === 200 && r.json.ok, 'El agente cancela con código y teléfono', r.json)

  console.log('7 · Administración: reservas del día')
  r = await http('GET', '/api/admin/datos', undefined, { 'x-api-key': 'mala' })
  ok(r.status === 401, 'Sin clave correcta no da datos')
  r = await http('GET', `/api/admin/datos?fecha=${FECHA}`, undefined, ADMIN)
  const anaAdm = r.json?.reservas?.find((x) => x.codigo === codigoAna)
  ok(r.status === 200 && anaAdm?.notas === 'Celíaca' && anaAdm.mesa === 's8', 'Muestra las reservas del día con mesa y alergias', r.json?.reservas)
  ok(r.json.opciones.modelos.length >= 30 && r.json.opciones.alergenos.length === 14, 'Trae los modelos 3D y los 14 alérgenos para los editores')
  r = await http('POST', '/api/panel', { token: anaAdm.token, estado: 'llegada' }, ADMIN)
  ok(r.status === 200 && (await fila((x) => x.codigo === codigoAna)).estado === 'llegada', 'El personal marca a Ana como llegada')
  r = await http('POST', '/api/panel', { token: anaAdm.token, estado: 'confirmada' }, ADMIN)
  ok(r.status === 200, 'Y puede deshacerlo')
  r = await http('POST', '/api/panel', { token: anaAdm.token, estado: 'no_show' }, { 'x-api-key': 'mala' })
  ok(r.status === 401, 'Sin clave no se puede cambiar nada')
  const brunoRow = await fila((x) => x.nombre === 'Bruno Díaz')
  r = await http('POST', '/api/panel', { token: brunoRow.token, mesa: 's8' }, ADMIN)
  ok(r.status === 409, 'No deja mover a Bruno a una mesa ocupada', r.json)
  r = await http('POST', '/api/panel', { token: brunoRow.token, mesa: 't2' }, ADMIN)
  ok(r.status === 200 && (await fila((x) => x.token === brunoRow.token)).mesa === 't2', 'Mueve a Bruno de T1 a T2')
  r = await http('POST', '/api/reservas', { nombre: 'Mesa de la barra', telefono: '944000000', fecha: FECHA, hora: '13:30', personas: 2, origen: 'local' }, ADMIN)
  ok(r.status === 201 && (await fila((x) => x.codigo === r.json.codigo))?.origen === 'local', 'El personal apunta una reserva del local desde el panel', r.json)

  console.log('8 · Administración sin código: plano, carta y ajustes')
  r = await http('POST', '/api/admin/guardar', { tipo: 'mesas', valor: [...original.mesas, { id: 'e2e', nombre: 'Barra', zona: 'Barra', plazas: 2, x: 900, y: 600, w: 80, h: 60 }] }, ADMIN)
  ok(r.status === 200 && r.json.valor.length === original.mesas.length + 1, 'Se añade una mesa al plano', r.json)
  ok((await http('GET', '/api/web')).json.mesas.some((m) => m.id === 'e2e'), 'La web pública ve la mesa nueva al momento')
  r = await http('POST', '/api/admin/guardar', { tipo: 'mesas', valor: [{ id: 'a', x: 0, y: 0 }, { id: 'a', x: 1, y: 1 }] }, ADMIN)
  ok(r.status === 400 && r.json.error.includes('mismo identificador'), 'Rechaza un plano con mesas repetidas', r.json)
  const carta = structuredClone(original.carta)
  const primero = carta.platos.find((p) => p.disponible)
  primero.disponible = false
  primero.precio = '12,5'
  primero.alergenos = ['gluten', 'veneno']
  r = await http('POST', '/api/admin/guardar', { tipo: 'carta', valor: carta }, ADMIN)
  const guardado = r.json?.valor?.platos?.find((p) => p.id === primero.id)
  ok(r.status === 200 && guardado.precio === 12.5 && guardado.alergenos.join() === 'gluten', 'Guarda la carta normalizando precio y alérgenos', guardado)
  ok(!(await http('GET', '/api/web')).json.carta.platos.some((p) => p.id === primero.id), 'Un plato agotado desaparece de la carta pública')
  r = await http('POST', '/api/admin/guardar', { tipo: 'config', valor: { ...original.config, horas: { comida: [], cena: [] } } }, ADMIN)
  ok(r.status === 400, 'No deja guardar una configuración sin horas', r.json)
  r = await http('POST', '/api/admin/guardar', { tipo: 'config', valor: { ...original.config, cerrado: [1, 2] } }, ADMIN)
  ok(r.status === 200 && r.json.valor.cerrado.join() === '1,2', 'Cerrar los martes desde Ajustes', r.json)
  const martes = new Date(lunes)
  martes.setDate(martes.getDate() + 1)
  ok((await http('GET', `/api/disponibilidad?fecha=${iso(martes)}`)).json.cerrado === true, 'Y el martes deja de admitir reservas')
  r = await http('POST', '/api/admin/guardar', { tipo: 'nada', valor: {} }, ADMIN)
  ok(r.status === 400, 'Rechaza un tipo de contenido desconocido')
  r = await http('POST', '/api/admin/guardar', { tipo: 'config', valor: original.config }, { 'x-api-key': 'mala' })
  ok(r.status === 401, 'Sin clave no se puede guardar')
  await restaurar()

  console.log('9 · Sala, cocina y clientes')
  const insertar = (filas) => n.rest('POST', `/projects/${n.project.id}/data-tables/${T.reservas}/insert`, { data: filas, returnType: 'count' })
  const base = { telefono: '', email: '', hora: '21:00', turno: 'cena', personas: 2, notas: '', mesa: 's1', origen: 'web', estado: 'llegada', asistencia: '', recordatorio: true, resena: true, ref: '' }
  const haceDias = (k) => iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - k, 12))
  await insertar([
    { ...base, codigo: 'HIST01', token: 'h1', nombre: 'Ana López', telefono: '+34600112233', email: 'ana@ejemplo.com', fecha: haceDias(30) },
    { ...base, codigo: 'HIST02', token: 'h2', nombre: 'Iñaki Etxeberria', telefono: '+34611223344', email: 'inaki@ejemplo.com', fecha: haceDias(120) },
    { ...base, codigo: 'HIST03', token: 'h3', nombre: 'Iñaki Etxeberria', telefono: '+34611223344', email: 'inaki@ejemplo.com', fecha: haceDias(90) },
    { ...base, codigo: 'HIST04', token: 'h4', nombre: 'Maite Ruiz', telefono: '+34622334455', email: 'maite@ejemplo.com', fecha: haceDias(100) },
  ])
  r = await http('GET', `/api/admin/datos?fecha=${FECHA}`, undefined, ADMIN)
  ok(r.json?.clientes?.['+34600112233']?.visitas === 1, 'La administración sabe que Ana ya vino antes (cliente habitual)', r.json?.clientes)

  // Terraza: Bruno está en la T2. Con poca lluvia no se mueve; con mucha, pasa al salón.
  const esManana = FECHA === iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12))
  if (esManana) {
    await fetch(`${MAIL}/messages`, { method: 'DELETE' })
    await http('POST', '/tareas/terraza', { clave: env.REST_CLAVE_PANEL, lluvia: 10 })
    await sleep(3000)
    ok((await fila((x) => x.nombre === 'Bruno Díaz')).mesa === 't2', 'Con un 10 % de lluvia la terraza sigue abierta')
    await http('POST', '/tareas/terraza', { clave: env.REST_CLAVE_PANEL, lluvia: 90 })
    const avisoBruno = await esperarMail((m) => m.To[0].Address === 'bruno@ejemplo.com' && m.Subject.includes('lluvia'))
    const mesaBruno = (await fila((x) => x.nombre === 'Bruno Díaz')).mesa
    ok(!!avisoBruno && mesaBruno.startsWith('s'), 'Con un 90 % de lluvia Bruno pasa a una mesa del salón y se le avisa', mesaBruno)
    ok(!!(await esperarMail((m) => m.Subject.startsWith('Terraza cerrada por lluvia'))), 'El dueño recibe el resumen de la terraza')
    await http('POST', '/tareas/terraza', { clave: 'mala', lluvia: 90 })
  } else console.log('  · (prueba de terraza omitida: la fecha de prueba no es mañana)')

  // Hoja de cocina: dos mesas hoy para la cena, una con alergia y otra con cumpleaños.
  if (d.getHours() < 21) {
    await fetch(`${MAIL}/messages`, { method: 'DELETE' })
    const hoyIso = iso(d)
    await http('POST', '/api/reservas', { nombre: 'Leire Alonso', telefono: '633000111', fecha: hoyIso, hora: '22:00', personas: 4, notas: 'Celíaca', origen: 'local' }, ADMIN)
    await http('POST', '/api/reservas', { nombre: 'Jon Bilbao', telefono: '633000222', fecha: hoyIso, hora: '22:00', personas: 2, notas: 'Cumpleaños de Ane, sacar vela', origen: 'local' }, ADMIN)
    await http('POST', '/tareas/cocina', { clave: env.REST_CLAVE_PANEL, turno: 'cena' })
    const hoja = await esperarMail((m) => m.Subject.startsWith('Cocina cena'))
    ok(!!hoja && hoja.Subject.includes('1 con alergias') && hoja.Subject.includes('1 celebraciones'), 'La cocina recibe la hoja de la cena con alergias y celebraciones', hoja?.Subject)
  } else console.log('  · (hoja de cocina omitida: ya es tarde para reservar hoy)')

  // Recuperar clientes: Iñaki vino dos veces y hace 90 días que no vuelve; Maite solo una vez.
  await fetch(`${MAIL}/messages`, { method: 'DELETE' })
  await http('POST', '/tareas/recuperar', { clave: env.REST_CLAVE_PANEL })
  ok(!!(await esperarMail((m) => m.To[0].Address === 'inaki@ejemplo.com' && m.Subject.includes('echamos de menos'))), 'Iñaki, cliente habitual que no vuelve, recibe una invitación')
  await sleep(1500)
  ok(!(await mails()).some((m) => m.To[0].Address === 'maite@ejemplo.com'), 'Maite, que vino una sola vez, no recibe nada')
  await fetch(`${MAIL}/messages`, { method: 'DELETE' })
  await http('POST', '/tareas/recuperar', { clave: env.REST_CLAVE_PANEL })
  await sleep(4000)
  ok(!(await mails()).some((m) => m.To[0].Address === 'inaki@ejemplo.com'), 'No se le vuelve a escribir la semana siguiente')

  console.log('10 · Recordatorio del día antes con confirmación de asistencia')
  await fetch(`${MAIL}/messages`, { method: 'DELETE' })
  await http('POST', '/tareas/recordatorios', { clave: env.REST_CLAVE_PANEL })
  ok(!!(await esperarMail((m) => m.To[0].Address === 'ana@ejemplo.com' && m.Subject.startsWith('Mañana te esperamos'))), 'Ana recibe el recordatorio')
  await sleep(2500)
  ok((await filas('reservas')).filter((x) => x.recordatorio).length >= 2, 'Las reservas quedan marcadas como recordadas')
  await fetch(`${MAIL}/messages`, { method: 'DELETE' })
  await http('POST', '/tareas/recordatorios', { clave: env.REST_CLAVE_PANEL })
  await sleep(4000)
  ok((await mails()).length === 0, 'Repetir la tarea no envía recordatorios duplicados')
  r = await http('POST', '/reserva', new URLSearchParams({ t: anaAdm.token, accion: 'confirmar' }))
  ok(r.text.includes('Gracias por confirmar') && (await fila((x) => x.codigo === codigoAna)).asistencia === 'confirmada', 'Ana confirma asistencia con un clic')

  console.log('11 · Informe diario y petición de reseña')
  await http('POST', '/tareas/informe', { clave: env.REST_CLAVE_PANEL })
  const dueno = original.config.emailDueno || env.REST_EMAIL_DUENO
  ok(!!(await esperarMail((m) => m.To[0].Address === dueno && m.Subject.startsWith('Hoy:'))), 'El dueño recibe el informe diario')
  const ayer = iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12))
  await n.rest('POST', `/projects/${n.project.id}/data-tables/${T.reservas}/insert`, {
    data: [{ codigo: 'AYER01', token: 'tok-ayer', nombre: 'Fran Sanz', email: 'fran@ejemplo.com', telefono: '+34600555666', fecha: ayer, hora: '21:30', turno: 'cena', personas: 2, notas: '', mesa: 's1', origen: 'web', estado: 'llegada', asistencia: '', recordatorio: true, resena: false, ref: '' }],
    returnType: 'count',
  })
  await http('POST', '/tareas/resenas', { clave: env.REST_CLAVE_PANEL })
  const res = await esperarMail((m) => m.To[0].Address === 'fran@ejemplo.com' && m.Subject.includes('¿Qué tal ayer'))
  ok(!!res, 'Fran recibe la petición de reseña al día siguiente')
  await sleep(2000)
  ok((await fila((x) => x.codigo === 'AYER01')).resena === true, 'Queda marcada para no volver a pedirla')
  const html = res ? await (await fetch(`${MAIL}/message/${res.ID}`)).json() : null
  const resena = original.config.resena || env.REST_URL_RESENA
  ok(html && html.HTML.includes(resena), 'El email lleva el enlace de reseñas de Google')
} catch (e) {
  fallos++
  console.log('  ✗ Error inesperado:', e.message)
} finally {
  await restaurar()
}

console.log(`\n${pasos - fallos}/${pasos} comprobaciones correctas${fallos ? ` · ${fallos} fallos` : ''}`)
process.exit(fallos ? 1 : 0)

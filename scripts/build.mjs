// Genera los flujos de n8n en workflows/*.json a partir de src/lib.js.
// Las tablas y la credencial quedan como marcadores (__DT_RESERVAS__,
// __DT_ESPERA__, __DT_CONTENIDO__, __SMTP__) que sustituye el instalador.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { Flow, code, contenido, dtGet, dtInsert, dtSet, dtUpdate, dtUpsert, email, httpPost, ifExpr, respondExpr, respondHtml, respondJson, schedule, webhook } from './nodes.mjs'

const AVISO_ESPERA = 'http://localhost:5678/webhook/interno/espera'
const avisoBody = '={{ JSON.stringify({ clave: $env.REST_CLAVE_PANEL }) }}'
const HOY = '={{ $now.toFormat("yyyy-MM-dd") }}'
const once = { executeOnce: true }
const flows = []

/* ===================================================== 01 · Reservas */
{
  const f = new Flow('01 · Reservas: web y API')

  // Datos públicos para la web: restaurante, carta y plano (sin reservas).
  f.add(webhook('GET /api/web', 'GET', 'api/web'), [0, 0])
  f.add(contenido('Contenido (web)'), [240, 0])
  f.add(code('Datos de la web', `
cargar('Contenido (web)')
const { emailDueno, resena, ...publico } = CFG
return respuesta(200, {
  restaurante: publico,
  hoy: hoy(),
  carta: { categorias: CARTA.categorias, platos: CARTA.platos.filter((p) => p.disponible) },
  mesas: mesasActivas().map(({ id, nombre, zona, plazas, min, x, y, w, h, forma }) => ({ id, nombre, zona, plazas, min, x, y, w, h, forma })),
})
`), [480, 0])
  f.add(respondJson('Responder web'), [720, 0])
  f.chain('GET /api/web', 'Contenido (web)', 'Datos de la web', 'Responder web')

  // Horas libres de un día.
  f.add(webhook('GET /api/disponibilidad', 'GET', 'api/disponibilidad'), [0, 200])
  f.add(contenido('Contenido (disponibilidad)'), [240, 200])
  f.add(dtGet('Reservas del día', 'RESERVAS', [['fecha', 'eq', '={{ $("GET /api/disponibilidad").first().json.query.fecha }}']], once), [480, 200])
  f.add(code('Calcular disponibilidad', `
cargar('Contenido (disponibilidad)')
const q = $('GET /api/disponibilidad').first().json.query || {}
const personas = Math.max(1, Math.floor(Number(q.personas) || 2))
const d = disponibilidad(String(q.fecha || ''), filas($input.all()), personas)
if (!d.ok) return respuesta(400, { error: d.motivo })
if (d.cerrado) return respuesta(200, { fecha: q.fecha, cerrado: true, motivo: d.motivo, horas: [], resumen: d.motivo })
const libres = d.horas.filter((h) => h.disponible).map((h) => h.hora)
return respuesta(200, {
  fecha: d.fecha, fechaTexto: d.fechaTexto, personas, cerrado: false,
  horas: d.horas.map((h) => ({ hora: h.hora, turno: h.turno, disponible: h.disponible, pasada: h.pasada })),
  resumen: libres.length ? 'El ' + d.fechaTexto + ' hay sitio para ' + personas + ' a las ' + libres.join(', ') + '.' : 'El ' + d.fechaTexto + ' no queda sitio para ' + personas + '.',
})
`), [720, 200])
  f.add(respondJson('Responder disponibilidad'), [960, 200])
  f.chain('GET /api/disponibilidad', 'Contenido (disponibilidad)', 'Reservas del día', 'Calcular disponibilidad', 'Responder disponibilidad')

  // Estado de cada mesa en el plano para una hora.
  f.add(webhook('GET /api/mapa', 'GET', 'api/mapa'), [0, 400])
  f.add(contenido('Contenido (mapa)'), [240, 400])
  f.add(dtGet('Reservas del día (mapa)', 'RESERVAS', [['fecha', 'eq', '={{ $("GET /api/mapa").first().json.query.fecha }}']], once), [480, 400])
  f.add(code('Estado de las mesas', `
cargar('Contenido (mapa)')
const q = $('GET /api/mapa').first().json.query || {}
const personas = Math.max(1, Math.floor(Number(q.personas) || 2))
const fecha = String(q.fecha || '')
const hora = String(q.hora || '')
if (!esFecha(fecha) || !turnoDe(hora)) return respuesta(400, { error: 'Fecha u hora no válidas.' })
const disp = disponibilidad(fecha, filas($input.all()), personas)
const franja = disp.ok && (disp.horas || []).find((h) => h.hora === hora)
const estados = estadoMesas(fecha, hora, personas, filas($input.all()))
// Si la hora no se puede reservar (pasada, cocina llena o día cerrado), todas salen ocupadas.
const bloqueada = !franja || !franja.disponible
return respuesta(200, {
  fecha, hora, personas,
  mesas: estados.map((m) => ({ id: m.id, estado: bloqueada && m.estado === 'libre' ? 'ocupada' : m.estado })),
  recomendada: bloqueada ? null : (mejorMesa(estados) || {}).id || null,
})
`), [720, 400])
  f.add(respondJson('Responder mapa'), [960, 400])
  f.chain('GET /api/mapa', 'Contenido (mapa)', 'Reservas del día (mapa)', 'Estado de las mesas', 'Responder mapa')

  // Crear reserva (web, panel o recepcionista de IA).
  f.add(webhook('POST /api/reservas', 'POST', 'api/reservas'), [0, 640])
  f.add(contenido('Contenido (reserva)'), [240, 640])
  f.add(code('Validar', `
cargar('Contenido (reserva)')
const req = $('POST /api/reservas').first().json
const b = req.body || {}
const interno = esAgente(req)
const v = validarReserva(b)
if (b.web) v.ok = false, v.errores.push('Solicitud no válida.') // campo trampa para bots
if (clave(req) && !interno) v.ok = false, v.errores.push('Clave no válida.')
const origen = interno ? (['telefono', 'local', 'ia'].includes(b.origen) ? b.origen : 'telefono') : 'web'
return [{ json: { ...v, fecha: v.datos.fecha || '0000-00-00', interno, origen } }]
`), [480, 640])
  f.add(dtGet('Reservas de esa fecha', 'RESERVAS', [['fecha', 'eq', '={{ $json.fecha }}']], once), [720, 640])
  f.add(code('Asignar mesa', `
cargar('Contenido (reserva)')
const r = asignarReserva($('Validar').first().json, filas($input.all()))
return [{ json: r.error || r.fila }]
`), [960, 640])
  f.add(ifExpr('¿Hay mesa?', '!!$json.codigo'), [1200, 640])
  f.add(dtInsert('Guardar reserva', 'RESERVAS'), [1440, 580])
  f.add(code('Preparar confirmación', `
cargar('Contenido (reserva)')
return [{ json: confirmacionReserva($('Guardar reserva').first().json) }]
`), [1680, 580])
  f.add(ifExpr('¿Tiene email?', '!!$json.para'), [1920, 580])
  f.add(email('Email de confirmación'), [2160, 520])
  f.add(respondExpr('Responder reserva creada', '$("Preparar confirmación").first().json.body', '201'), [2400, 580])
  f.add(respondJson('Responder sin mesa'), [1440, 760])
  f.chain('POST /api/reservas', 'Contenido (reserva)', 'Validar', 'Reservas de esa fecha', 'Asignar mesa', '¿Hay mesa?')
  f.connect('¿Hay mesa?', 'Guardar reserva', 0)
  f.connect('¿Hay mesa?', 'Responder sin mesa', 1)
  f.chain('Guardar reserva', 'Preparar confirmación', '¿Tiene email?')
  f.connect('¿Tiene email?', 'Email de confirmación', 0)
  f.connect('¿Tiene email?', 'Responder reserva creada', 1)
  f.connect('Email de confirmación', 'Responder reserva creada')

  // Lista de espera.
  f.add(webhook('POST /api/espera', 'POST', 'api/espera'), [0, 940])
  f.add(contenido('Contenido (espera)'), [240, 940])
  f.add(code('Validar espera', `
cargar('Contenido (espera)')
const b = $('POST /api/espera').first().json.body || {}
const v = validarReserva(b)
if (b.web) v.ok = false
if (!v.ok) return [{ json: { status: 400, body: { ok: false, errores: v.errores } } }]
const d = v.datos
return [{ json: { token: nuevoToken(), nombre: d.nombre, email: d.email, telefono: d.telefono, fecha: d.fecha, hora: d.hora, turno: turnoDe(d.hora), personas: d.personas, notas: d.notas, estado: 'esperando', ref: '' } }]
`), [480, 940])
  f.add(ifExpr('¿Datos válidos?', '!!$json.token'), [720, 940])
  f.add(dtInsert('Guardar en espera', 'ESPERA'), [960, 880])
  f.add(code('Preparar aviso de espera', `
cargar('Contenido (espera)')
return [{ json: avisoListaEspera($('Guardar en espera').first().json) }]
`), [1200, 880])
  f.add(ifExpr('¿Email de espera?', '!!$json.para'), [1440, 880])
  f.add(email('Email de lista de espera'), [1680, 820])
  f.add(respondExpr('Responder espera', '$("Preparar aviso de espera").first().json.body', '201'), [1920, 880])
  f.add(respondJson('Responder espera no válida'), [960, 1040])
  f.chain('POST /api/espera', 'Contenido (espera)', 'Validar espera', '¿Datos válidos?')
  f.connect('¿Datos válidos?', 'Guardar en espera', 0)
  f.connect('¿Datos válidos?', 'Responder espera no válida', 1)
  f.chain('Guardar en espera', 'Preparar aviso de espera', '¿Email de espera?')
  f.connect('¿Email de espera?', 'Email de lista de espera', 0)
  f.connect('¿Email de espera?', 'Responder espera', 1)
  f.connect('Email de lista de espera', 'Responder espera')
  flows.push(f)
}

/* ===================================================== 02 · Gestión del cliente */
{
  const f = new Flow('02 · Reservas: gestión del cliente')
  const paginaReserva = `
function paginaReserva(r, aviso) {
  if (!r) return pagina('Reserva no encontrada', '<div class="card"><h1>Reserva no encontrada</h1><p class="muted">El enlace no es válido o ha caducado. Llámanos' + (CFG.telefono ? ' al ' + esc(CFG.telefono) : '') + '.</p></div>')
  const futura = r.fecha >= hoy()
  const activa = r.estado === 'confirmada' && futura
  const estado = { confirmada: futura ? '<span class="ok">Confirmada</span>' : 'Finalizada', cancelada: '<span class="bad">Cancelada</span>', llegada: 'Disfrutada', no_show: 'No presentada' }[r.estado] || r.estado
  const form = (accion, txt, clase) => '<form method="post" action="' + SECRETOS.url + '/webhook/reserva" style="display:inline"><input type="hidden" name="t" value="' + esc(r.token) + '"><input type="hidden" name="accion" value="' + accion + '"><button class="btn ' + clase + '">' + txt + '</button></form>'
  const acciones = activa ? (r.asistencia === 'confirmada' ? '<p class="ok">✓ Has confirmado que vienes.</p>' : form('confirmar', 'Confirmo que voy', 'btn-primary')) + form('cancelar', 'Cancelar reserva', 'btn-danger') : ''
  return pagina('Tu reserva', '<div class="card">' + (aviso ? '<p class="ok"><b>' + aviso + '</b></p>' : '') + '<h1>Tu reserva</h1><p class="muted">Estado: ' + estado + '</p><dl>' +
    datosReserva(r).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' + acciones +
    '<p class="muted" style="margin-top:18px;font-size:14px">' + esc([CFG.direccion, CFG.telefono].filter(Boolean).join(' · ')) + '</p></div>')
}`

  f.add(webhook('GET /reserva', 'GET', 'reserva'), [0, 0])
  f.add(contenido('Contenido (ver)'), [240, 0])
  f.add(dtGet('Buscar por enlace', 'RESERVAS', [['token', 'eq', '={{ $("GET /reserva").first().json.query.t || "-" }}']], once), [480, 0])
  f.add(code('Página de la reserva', `${paginaReserva}
cargar('Contenido (ver)')
const r = filas($input.all())[0]
return [{ json: { html: paginaReserva(r), status: r ? 200 : 404 } }]
`), [720, 0])
  f.add(respondHtml('Responder reserva'), [960, 0])
  f.chain('GET /reserva', 'Contenido (ver)', 'Buscar por enlace', 'Página de la reserva', 'Responder reserva')

  // Las acciones van por POST: los antivirus de correo que abren enlaces no cancelan nada.
  f.add(webhook('POST /reserva', 'POST', 'reserva'), [0, 220])
  f.add(contenido('Contenido (acción)'), [240, 220])
  f.add(dtGet('Buscar reserva', 'RESERVAS', [['token', 'eq', '={{ $("POST /reserva").first().json.body.t || "-" }}']], once), [480, 220])
  f.add(code('Aplicar acción', `${paginaReserva}
cargar('Contenido (acción)')
const accion = ($('POST /reserva').first().json.body || {}).accion
const r = filas($input.all())[0]
if (!r) return [{ json: { html: paginaReserva(null), status: 404 } }]
const activa = r.estado === 'confirmada' && r.fecha >= hoy()
if (activa && accion === 'cancelar') return [{ json: { estado: 'cancelada' } }]
if (activa && accion === 'confirmar') return [{ json: { asistencia: 'confirmada' } }]
return [{ json: { html: paginaReserva(r) } }]
`), [720, 220])
  f.add(ifExpr('¿Hay cambio?', '$json.html === undefined'), [960, 220])
  f.add(dtUpdate('Guardar cambio', 'RESERVAS', [['token', 'eq', '={{ $("POST /reserva").first().json.body.t }}']]), [1200, 160])
  f.add(httpPost('Avisar a la lista de espera', AVISO_ESPERA, avisoBody), [1440, 160])
  f.add(code('Página tras el cambio', `${paginaReserva}
cargar('Contenido (acción)')
const r = $('Guardar cambio').first().json
return [{ json: { html: paginaReserva(r, r.estado === 'cancelada' ? 'Reserva cancelada. ¡Gracias por avisar!' : '¡Gracias por confirmar! Te esperamos.') } }]
`), [1680, 160])
  f.add(respondHtml('Responder cambio'), [1920, 220])
  f.chain('POST /reserva', 'Contenido (acción)', 'Buscar reserva', 'Aplicar acción', '¿Hay cambio?')
  f.connect('¿Hay cambio?', 'Guardar cambio', 0)
  f.connect('¿Hay cambio?', 'Responder cambio', 1)
  f.chain('Guardar cambio', 'Avisar a la lista de espera', 'Página tras el cambio', 'Responder cambio')

  // Cancelación por teléfono (recepcionista de IA o personal): código + teléfono.
  f.add(webhook('POST /api/cancelar', 'POST', 'api/cancelar'), [0, 460])
  f.add(dtGet('Buscar por código', 'RESERVAS', [['codigo', 'eq', '={{ String($json.body.codigo || "-").toUpperCase().replace(/\\s/g, "") }}']]), [240, 460])
  f.add(code('Comprobar cancelación', `
const req = $('POST /api/cancelar').first().json
const b = req.body || {}
const no = (status, error) => [{ json: { status, body: { ok: false, error } } }]
if (!esAgente(req)) return no(401, 'Clave no válida.')
const r = filas($input.all())[0]
const ult9 = (t) => String(t || '').replace(/\\D/g, '').slice(-9)
if (!r || ult9(r.telefono) !== ult9(b.telefono)) return no(404, 'No hay ninguna reserva con ese código y ese teléfono.')
if (r.estado !== 'confirmada' || r.fecha < hoy()) return no(409, 'Esa reserva ya no se puede cancelar (estado: ' + r.estado + ').')
return [{ json: { estado: 'cancelada' } }]
`), [480, 460])
  f.add(ifExpr('¿Se puede cancelar?', '$json.body === undefined'), [720, 460])
  f.add(dtUpdate('Cancelar reserva', 'RESERVAS', [['codigo', 'eq', '={{ $("Buscar por código").first().json.codigo }}']]), [960, 400])
  f.add(httpPost('Avisar a la espera (teléfono)', AVISO_ESPERA, avisoBody), [1200, 400])
  f.add(respondExpr('Responder cancelada', '({ ok: true, codigo: $("Buscar por código").first().json.codigo, mensaje: "Reserva cancelada." })'), [1440, 400])
  f.add(respondJson('Responder no cancelada'), [960, 560])
  f.chain('POST /api/cancelar', 'Buscar por código', 'Comprobar cancelación', '¿Se puede cancelar?')
  f.connect('¿Se puede cancelar?', 'Cancelar reserva', 0)
  f.connect('¿Se puede cancelar?', 'Responder no cancelada', 1)
  f.chain('Cancelar reserva', 'Avisar a la espera (teléfono)', 'Responder cancelada')
  flows.push(f)
}

/* ===================================================== 03 · Recordatorios */
{
  const f = new Flow('03 · Recordatorio el día antes')
  f.add(schedule('Cada hora', { field: 'hours', hoursInterval: 1 }), [0, 0])
  f.add(webhook('Ejecutar ahora', 'POST', 'tareas/recordatorios', 'onReceived'), [0, 200])
  f.add(contenido('Contenido'), [260, 100])
  f.add(dtGet('Reservas de mañana', 'RESERVAS', [['fecha', 'eq', '={{ $now.plus({ days: 1 }).toFormat("yyyy-MM-dd") }}']], once), [520, 100])
  f.add(code('Preparar recordatorios', `
cargar('Contenido')
const manual = $('Ejecutar ahora').isExecuted
if (manual && ($('Ejecutar ahora').first().json.body || {}).clave !== SECRETOS.clavePanel) return []
// Sin emails de madrugada, y no a quien ha reservado hace menos de 3 horas.
if (!manual && ($now.hour < 10 || $now.hour > 21)) return []
const recientes = $now.minus({ hours: 3 })
return filas($input.all())
  .filter((r) => r.estado === 'confirmada' && !r.recordatorio && r.email && (manual || DateTime.fromISO(String(r.createdAt)) < recientes))
  .map((r) => ({ json: recordatorio(r) }))
`), [780, 100])
  f.add(email('Enviar recordatorio'), [1040, 100])
  f.add(dtSet('Marcar enviado', 'RESERVAS', [['token', 'eq', '={{ $("Preparar recordatorios").item.json.token }}']], { recordatorio: true }), [1300, 100])
  f.connect('Cada hora', 'Contenido')
  f.connect('Ejecutar ahora', 'Contenido')
  f.chain('Contenido', 'Reservas de mañana', 'Preparar recordatorios', 'Enviar recordatorio', 'Marcar enviado')
  flows.push(f)
}

/* ===================================================== 04 · Reseñas */
{
  const f = new Flow('04 · Petición de reseña tras la visita')
  f.add(schedule('Cada día a las 12', { field: 'days', triggerAtHour: 12 }), [0, 0])
  f.add(webhook('Ejecutar ahora', 'POST', 'tareas/resenas', 'onReceived'), [0, 200])
  f.add(contenido('Contenido'), [260, 100])
  f.add(dtGet('Reservas de ayer', 'RESERVAS', [['fecha', 'eq', '={{ $now.minus({ days: 1 }).toFormat("yyyy-MM-dd") }}']], once), [520, 100])
  f.add(code('Preparar reseñas', `
cargar('Contenido')
if ($('Ejecutar ahora').isExecuted && ($('Ejecutar ahora').first().json.body || {}).clave !== SECRETOS.clavePanel) return []
if (!CFG.resena) return []
return filas($input.all())
  .filter((r) => ['llegada', 'confirmada'].includes(r.estado) && r.email && !r.resena)
  .map((r) => ({ json: peticionResena(r) }))
`), [780, 100])
  f.add(email('Enviar petición de reseña'), [1040, 100])
  f.add(dtSet('Marcar reseña pedida', 'RESERVAS', [['token', 'eq', '={{ $("Preparar reseñas").item.json.token }}']], { resena: true }), [1300, 100])
  f.connect('Cada día a las 12', 'Contenido')
  f.connect('Ejecutar ahora', 'Contenido')
  f.chain('Contenido', 'Reservas de ayer', 'Preparar reseñas', 'Enviar petición de reseña', 'Marcar reseña pedida')
  flows.push(f)
}

/* ===================================================== 05 · Lista de espera */
{
  const f = new Flow('05 · Lista de espera automática')
  f.add(schedule('Cada 30 minutos', { field: 'minutes', minutesInterval: 30 }), [0, 0])
  f.add(webhook('Sitio liberado', 'POST', 'interno/espera', 'onReceived'), [0, 200])
  f.add(contenido('Contenido'), [260, 100])
  f.add(dtGet('Personas esperando', 'ESPERA', [['estado', 'eq', 'esperando'], ['fecha', 'gte', HOY]], once), [520, 100])
  f.add(dtGet('Reservas próximas', 'RESERVAS', [['fecha', 'gte', HOY]], once), [780, 100])
  f.add(code('Asignar mesas', `
cargar('Contenido')
if ($('Sitio liberado').isExecuted && ($('Sitio liberado').first().json.body || {}).clave !== SECRETOS.clavePanel) return []
return asignarListaEspera(filas($('Personas esperando').all()), filas($input.all())).map((json) => ({ json }))
`), [1040, 100])
  f.add(dtInsert('Crear reserva', 'RESERVAS'), [1300, 100])
  f.add(dtSet('Sacar de la lista', 'ESPERA', [['id', 'eq', '={{ Number($json.ref) }}']], { estado: 'convertida' }), [1560, 100])
  f.add(code('Preparar aviso de mesa', `
cargar('Contenido')
return $('Crear reserva').all().filter((i) => i.json.email).map(({ json: r }) => ({ json: avisoMesaLiberada(r) }))
`), [1820, 100])
  f.add(email('Avisar al cliente'), [2080, 100])
  f.connect('Cada 30 minutos', 'Contenido')
  f.connect('Sitio liberado', 'Contenido')
  f.chain('Contenido', 'Personas esperando', 'Reservas próximas', 'Asignar mesas', 'Crear reserva', 'Sacar de la lista', 'Preparar aviso de mesa', 'Avisar al cliente')
  flows.push(f)
}

/* ===================================================== 06 · Administración */
{
  const f = new Flow('06 · Administración del restaurante')

  // Todo lo que necesita la administración para un día.
  f.add(webhook('GET /api/admin/datos', 'GET', 'api/admin/datos'), [0, 0])
  f.add(contenido('Contenido (admin)'), [240, 0])
  f.add(dtGet('Reservas del día (admin)', 'RESERVAS', [['fecha', 'eq', '={{ /^\\d{4}-\\d{2}-\\d{2}$/.test($("GET /api/admin/datos").first().json.query.fecha || "") ? $("GET /api/admin/datos").first().json.query.fecha : $now.toFormat("yyyy-MM-dd") }}']], once), [480, 0])
  f.add(dtGet('Lista de espera (admin)', 'ESPERA', [['estado', 'eq', 'esperando'], ['fecha', 'gte', HOY]], once), [720, 0])
  f.add(dtGet('Historial (admin)', 'RESERVAS', [['fecha', 'gte', '={{ $now.minus({ days: 730 }).toFormat("yyyy-MM-dd") }}']], once), [840, -160])
  f.add(code('Datos de administración', `
cargar('Contenido (admin)')
const req = $('GET /api/admin/datos').first().json
if (!esAdmin(req)) return respuesta(401, { ok: false, error: 'Clave incorrecta.' })
const q = req.query || {}
const fecha = esFecha(q.fecha || '') ? q.fecha : hoy()
const d = DateTime.fromISO(fecha, { zone: $now.zoneName })
const reservas = filas($('Reservas del día (admin)').all()).map((r) => ({
  token: r.token, codigo: r.codigo, nombre: r.nombre, telefono: r.telefono, email: r.email, hora: r.hora, turno: r.turno,
  personas: Number(r.personas), notas: r.notas, mesa: r.mesa, estado: r.estado, asistencia: r.asistencia, origen: r.origen,
}))
return respuesta(200, {
  ok: true, fecha, hoy: hoy(), fechaTexto: fechaLarga(fecha), cerrado: diaCerrado(d),
  config: CFG, mesas: MESAS, carta: CARTA, reservas,
  espera: filas($('Lista de espera (admin)').all()).map((e) => ({ nombre: e.nombre, telefono: e.telefono, fecha: e.fecha, hora: e.hora, personas: Number(e.personas) })),
  opciones: { modelos: MODELOS_3D, alergenos: ALERGENOS, etiquetas: ETIQUETAS },
  clientes: (() => {
    const h = historialClientes(filas($('Historial (admin)').all()).filter((r) => r.fecha < fecha))
    const out = {}
    for (const r of reservas) if (h[r.telefono]) out[r.telefono] = { visitas: h[r.telefono].visitas, noShows: h[r.telefono].noShows, ultima: h[r.telefono].ultima }
    return out
  })(),
})
`), [960, 0])
  f.add(respondJson('Responder datos'), [1200, 0])
  f.chain('GET /api/admin/datos', 'Contenido (admin)', 'Reservas del día (admin)', 'Lista de espera (admin)', 'Historial (admin)', 'Datos de administración', 'Responder datos')

  // Guardar configuración, plano de mesas o carta (validados).
  f.add(webhook('POST /api/admin/guardar', 'POST', 'api/admin/guardar'), [0, 240])
  f.add(code('Validar contenido', `
const req = $('POST /api/admin/guardar').first().json
const b = req.body || {}
if (!esAdmin(req)) return respuesta(401, { ok: false, error: 'Clave incorrecta.' })
const validadores = { config: validarConfig, mesas: validarMesas, carta: validarCarta }
if (!validadores[b.tipo]) return respuesta(400, { ok: false, error: 'Tipo no válido.' })
try {
  const valor = validadores[b.tipo](b.valor)
  return [{ json: { clave: b.tipo, valor: JSON.stringify(valor) } }]
} catch (e) {
  return respuesta(400, { ok: false, error: e.message })
}
`), [240, 240])
  f.add(ifExpr('¿Válido?', '$json.body === undefined'), [480, 240])
  f.add(dtUpsert('Guardar contenido', 'CONTENIDO', [['clave', 'eq', '={{ $json.clave }}']]), [720, 180])
  f.add(respondExpr('Responder guardado', '({ ok: true, tipo: $("Validar contenido").first().json.clave, valor: JSON.parse($("Validar contenido").first().json.valor) })'), [960, 180])
  f.add(respondJson('Responder no guardado'), [720, 320])
  f.chain('POST /api/admin/guardar', 'Validar contenido', '¿Válido?')
  f.connect('¿Válido?', 'Guardar contenido', 0)
  f.connect('¿Válido?', 'Responder no guardado', 1)
  f.connect('Guardar contenido', 'Responder guardado')

  // Cambiar el estado de una reserva o moverla de mesa.
  f.add(webhook('POST /api/panel', 'POST', 'api/panel'), [0, 480])
  f.add(contenido('Contenido (panel)'), [240, 480])
  f.add(dtGet('Reserva a cambiar', 'RESERVAS', [['token', 'eq', '={{ $("POST /api/panel").first().json.body.token || "-" }}']], once), [480, 480])
  f.add(dtGet('Reservas de ese día (panel)', 'RESERVAS', [['fecha', 'eq', '={{ ($json.fecha) || "-" }}']], once), [720, 480])
  f.add(code('Validar cambio', `
cargar('Contenido (panel)')
const req = $('POST /api/panel').first().json
const b = req.body || {}
const no = (status, error) => respuesta(status, { ok: false, error })
if (!esAdmin(req)) return no(401, 'Clave incorrecta.')
const r = filas($('Reserva a cambiar').all())[0]
if (!r) return no(404, 'Reserva no encontrada.')
if (b.mesa !== undefined) {
  const estados = estadoMesas(r.fecha, r.hora, Number(r.personas), filas($input.all()), { ignorar: r.token })
  const m = estados.find((x) => x.id === b.mesa)
  if (!m) return no(400, 'Esa mesa no existe.')
  if (m.estado === 'ocupada') return no(409, 'La mesa ' + m.nombre + ' está ocupada a esa hora.')
  return [{ json: { mesa: m.id } }]
}
if (!['confirmada', 'llegada', 'no_show', 'cancelada'].includes(b.estado)) return no(400, 'Estado no válido.')
return [{ json: { estado: b.estado } }]
`), [960, 480])
  f.add(ifExpr('¿Cambio válido?', '$json.body === undefined'), [1200, 480])
  f.add(dtUpdate('Cambiar reserva', 'RESERVAS', [['token', 'eq', '={{ $("POST /api/panel").first().json.body.token }}']]), [1440, 420])
  f.add(httpPost('Avisar a la espera (panel)', AVISO_ESPERA, avisoBody), [1680, 420])
  f.add(respondExpr('Responder cambio', '({ ok: true })'), [1920, 420])
  f.add(respondJson('Responder cambio no válido'), [1440, 580])
  f.chain('POST /api/panel', 'Contenido (panel)', 'Reserva a cambiar', 'Reservas de ese día (panel)', 'Validar cambio', '¿Cambio válido?')
  f.connect('¿Cambio válido?', 'Cambiar reserva', 0)
  f.connect('¿Cambio válido?', 'Responder cambio no válido', 1)
  f.chain('Cambiar reserva', 'Avisar a la espera (panel)', 'Responder cambio')
  flows.push(f)
}

/* ===================================================== 07 · Informe diario */
{
  const f = new Flow('07 · Informe diario para el dueño')
  f.add(schedule('Cada día a las 9', { field: 'days', triggerAtHour: 9 }), [0, 0])
  f.add(webhook('Ejecutar ahora', 'POST', 'tareas/informe', 'onReceived'), [0, 200])
  f.add(contenido('Contenido'), [260, 100])
  f.add(dtGet('Reservas de hoy', 'RESERVAS', [['fecha', 'eq', HOY]], once), [520, 100])
  f.add(dtGet('Reservas de ayer (informe)', 'RESERVAS', [['fecha', 'eq', '={{ $now.minus({ days: 1 }).toFormat("yyyy-MM-dd") }}']], once), [780, 100])
  f.add(code('Preparar informe', `
cargar('Contenido')
if ($('Ejecutar ahora').isExecuted && ($('Ejecutar ahora').first().json.body || {}).clave !== SECRETOS.clavePanel) return []
const para = CFG.emailDueno || $env.REST_EMAIL_DUENO
if (!para) return []
return [{ json: { para, ...informeDiario(filas($('Reservas de hoy').all()), filas($input.all())) } }]
`), [1040, 100])
  f.add(email('Enviar informe'), [1300, 100])
  f.connect('Cada día a las 9', 'Contenido')
  f.connect('Ejecutar ahora', 'Contenido')
  f.chain('Contenido', 'Reservas de hoy', 'Reservas de ayer (informe)', 'Preparar informe', 'Enviar informe')
  flows.push(f)
}


/* ===================================================== 08 · Terraza según el tiempo */
{
  const f = new Flow('08 · Terraza según la previsión de lluvia')
  f.add(schedule('A las 10 y a las 17', { field: 'cronExpression', expression: '0 10,17 * * *' }), [0, 0])
  f.add(webhook('Ejecutar ahora', 'POST', 'tareas/terraza', 'onReceived'), [0, 200])
  f.add(contenido('Contenido'), [260, 100])
  f.add(dtGet('Reservas próximas', 'RESERVAS', [['fecha', 'gte', HOY]], once), [520, 100])
  f.add(code('Consultar el tiempo y decidir', `
cargar('Contenido')
const manual = $('Ejecutar ahora').isExecuted
const b = manual ? $('Ejecutar ahora').first().json.body || {} : {}
if (manual && b.clave !== SECRETOS.clavePanel) return []
if (!CFG.lluviaUmbral) return []
// Previsión horaria de Open-Meteo (gratis y sin clave). En pruebas se puede forzar con «lluvia».
let prob
if (b.lluvia !== undefined) {
  prob = {}
  for (const f of [hoy(), hoy(1)]) for (const t of ['comida', 'cena']) prob[f + ' ' + t] = Number(b.lluvia)
} else {
  // Si el servicio del tiempo falla, no se toca nada: mejor no mover a nadie que moverlo sin motivo.
  try {
    const meteo = await this.helpers.httpRequest({ url: 'https://api.open-meteo.com/v1/forecast', qs: { latitude: CFG.lat, longitude: CFG.lng, hourly: 'precipitation_probability', timezone: 'Europe/Madrid', forecast_days: 2 }, json: true, timeout: 15000 })
    prob = lluviaPorTurno(meteo)
  } catch (e) {
    return []
  }
}
const reservas = filas($input.all())
const salida = []
const sinSitio = []
for (const fecha of [hoy(), hoy(1)]) {
  for (const turno of ['comida', 'cena']) {
    const p = prob[fecha + ' ' + turno] || 0
    if (p < CFG.lluviaUmbral) continue
    for (const c of moverTerraza(fecha, turno, reservas)) {
      if (!c.mesa) { sinSitio.push(c); continue }
      const r = reservas.find((x) => x.token === c.token)
      r.mesa = c.mesa
      salida.push({ json: { token: c.token, mesa: c.mesa, prob: p, turno, fecha } })
    }
  }
}
if (!salida.length && !sinSitio.length) return []
if (!salida.length) salida.push({ json: { token: '-', mesa: '', prob: 0, sinSitio } })
salida[0].json.sinSitio = sinSitio
return salida
`), [780, 100])
  f.add(dtSet('Cambiar de mesa', 'RESERVAS', [['token', 'eq', '={{ $json.token }}']], { mesa: '={{ $json.mesa }}' }), [1040, 100])
  f.add(code('Preparar avisos', `
cargar('Contenido')
const cambios = $('Consultar el tiempo y decidir').all().map((i) => i.json).filter((c) => c.token !== '-')
const sinSitio = ($('Consultar el tiempo y decidir').first().json.sinSitio) || []
const reservas = filas($('Reservas próximas').all())
const avisos = []
for (const c of cambios) {
  const r = reservas.find((x) => x.token === c.token)
  if (r && r.email) avisos.push({ json: { para: r.email, asunto: 'Por la lluvia, te pasamos al salón · ' + CFG.nombre, html: emailCambioTerraza({ ...r, mesa: c.mesa }, c.prob) } })
}
const dueno = CFG.emailDueno || $env.REST_EMAIL_DUENO
if (dueno) {
  const linea = (c) => esc(fechaLarga(c.fecha)) + ' ' + esc(c.hora) + ' · ' + esc(c.nombre) + ' (' + c.personas + ' pax)'
  avisos.push({ json: { para: dueno, asunto: 'Terraza cerrada por lluvia: ' + cambios.length + ' reservas movidas' + (sinSitio.length ? ', ' + sinSitio.length + ' sin sitio' : ''), html: emailHtml({
    titulo: 'Previsión de lluvia: terraza recogida',
    intro: cambios.length + ' reservas de terraza han pasado al salón y ya están avisadas.' + (sinSitio.length ? '<br><br><b style="color:#b4532a">Sin sitio dentro (llámalas):</b><br>' + sinSitio.map(linea).join('<br>') : ''),
    botones: [{ texto: 'Ver la sala', url: SECRETOS.url + '/admin' }],
  }) } })
}
return avisos
`, once), [1300, 100])
  f.add(email('Enviar avisos'), [1560, 100])
  f.connect('A las 10 y a las 17', 'Contenido')
  f.connect('Ejecutar ahora', 'Contenido')
  f.chain('Contenido', 'Reservas próximas', 'Consultar el tiempo y decidir', 'Cambiar de mesa', 'Preparar avisos', 'Enviar avisos')
  flows.push(f)
}

/* ===================================================== 09 · Hoja de cocina */
{
  const f = new Flow('09 · Hoja de cocina antes de cada servicio')
  f.add(schedule('A las 12 y a las 19', { field: 'cronExpression', expression: '0 12,19 * * *' }), [0, 0])
  f.add(webhook('Ejecutar ahora', 'POST', 'tareas/cocina', 'onReceived'), [0, 200])
  f.add(contenido('Contenido'), [260, 100])
  f.add(dtGet('Reservas de hoy', 'RESERVAS', [['fecha', 'eq', HOY]], once), [520, 100])
  f.add(code('Preparar hoja de cocina', `
cargar('Contenido')
const manual = $('Ejecutar ahora').isExecuted
const b = manual ? $('Ejecutar ahora').first().json.body || {} : {}
if (manual && b.clave !== SECRETOS.clavePanel) return []
const turno = ['comida', 'cena'].includes(b.turno) ? b.turno : $now.hour < 17 ? 'comida' : 'cena'
const para = CFG.emailCocina || CFG.emailDueno || $env.REST_EMAIL_DUENO
const h = hojaCocina(hoy(), turno, filas($input.all()))
if (!para || !h.mesas) return []
return [{ json: { para, asunto: 'Cocina ' + turno + ': ' + h.comensales + ' comensales' + (h.alergias ? ' · ' + h.alergias + ' con alergias' : '') + (h.celebraciones ? ' · ' + h.celebraciones + ' celebraciones' : ''), html: h.html } }]
`), [780, 100])
  f.add(email('Enviar a cocina'), [1040, 100])
  f.connect('A las 12 y a las 19', 'Contenido')
  f.connect('Ejecutar ahora', 'Contenido')
  f.chain('Contenido', 'Reservas de hoy', 'Preparar hoja de cocina', 'Enviar a cocina')
  flows.push(f)
}

/* ===================================================== 10 · Recuperar clientes */
{
  const f = new Flow('10 · Recuperar clientes que no vuelven')
  f.add(schedule('Los lunes a las 11', { field: 'cronExpression', expression: '0 11 * * 1' }), [0, 0])
  f.add(webhook('Ejecutar ahora', 'POST', 'tareas/recuperar', 'onReceived'), [0, 200])
  f.add(contenido('Contenido'), [260, 100])
  f.add(dtGet('Historial de reservas', 'RESERVAS', [['fecha', 'gte', '={{ $now.minus({ days: 730 }).toFormat("yyyy-MM-dd") }}']], once), [520, 100])
  f.add(dtGet('Clientes avisados', 'CLIENTES', [], once), [780, 100])
  f.add(code('Elegir clientes', `
cargar('Contenido')
if ($('Ejecutar ahora').isExecuted && ($('Ejecutar ahora').first().json.body || {}).clave !== SECRETOS.clavePanel) return []
const avisados = {}
for (const c of filas($input.all())) avisados[c.telefono] = c.ultimo_aviso
return clientesARecuperar(filas($('Historial de reservas').all()), avisados, CFG.recuperarDias)
  .slice(0, 100)
  .map((c) => ({ json: { telefono: c.telefono, para: c.email, asunto: 'Te echamos de menos en ' + CFG.nombre, html: emailRecuperar(c) } }))
`), [1040, 100])
  f.add(email('Enviar invitación'), [1300, 100])
  f.add(code('Marcar avisados', `
return $('Elegir clientes').all().map((i) => ({ json: { telefono: i.json.telefono, ultimo_aviso: $now.toFormat('yyyy-MM-dd') } }))
`, once), [1560, 100])
  f.add(dtUpsert('Guardar aviso', 'CLIENTES', [['telefono', 'eq', '={{ $json.telefono }}']]), [1820, 100])
  f.connect('Los lunes a las 11', 'Contenido')
  f.connect('Ejecutar ahora', 'Contenido')
  f.chain('Contenido', 'Historial de reservas', 'Clientes avisados', 'Elegir clientes', 'Enviar invitación', 'Marcar avisados', 'Guardar aviso')
  flows.push(f)
}

const out = new URL('../workflows/', import.meta.url)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const f of flows) {
  const [num, resto] = f.name.split(' · ')
  const file = num + '-' + resto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  writeFileSync(new URL(`${file}.json`, out), JSON.stringify(f.toJSON(), null, 2))
  console.log('✓', f.name, `(${f.nodes.length} nodos)`)
}
void readdirSync

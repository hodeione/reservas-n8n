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
const val = $('Validar').first().json
const no = (status, errores, extra = {}) => [{ json: { status, body: { ok: false, errores, ...extra } } }]
if (!val.ok) return no(400, val.errores)
const d = val.datos
const rs = filas($input.all())
const disp = disponibilidad(d.fecha, rs, d.personas, { ignorarAntelacion: val.interno })
if (!disp.ok) return no(400, [disp.motivo])
if (disp.cerrado) return no(409, [disp.motivo])
const repetida = rs.find((r) => r.telefono === d.telefono && OCUPAN.includes(r.estado))
if (repetida) return no(409, ['Ya tienes una reserva ese día a las ' + repetida.hora + ' (código ' + repetida.codigo + ').'])
const hueco = disp.horas.find((h) => h.hora === d.hora)
const sinSitio = (msg) => no(409, [msg], { alternativas: alternativas(disp, d.hora), lista_espera: !!(hueco && !hueco.pasada) })
if (!hueco || !hueco.disponible) return sinSitio(hueco && hueco.pasada ? 'Esa hora ya no admite reservas online.' : 'No queda sitio a las ' + d.hora + ' para ' + d.personas + '.')
const estados = estadoMesas(d.fecha, d.hora, d.personas, rs)
const mesa = mejorMesa(estados, d.mesa || '')
if (!mesa) {
  const m = estados.find((x) => x.id === d.mesa)
  return sinSitio(m ? (m.estado === 'no_cabe' ? 'La mesa ' + m.nombre + ' es para ' + (MESAS.find((x) => x.id === m.id) || {}).min + ' a ' + m.plazas + ' personas.' : 'La mesa ' + m.nombre + ' ya está reservada a esa hora.') : 'Esa mesa no existe.')
}
return [{ json: {
  codigo: nuevoCodigo(), token: nuevoToken(), nombre: d.nombre, email: d.email, telefono: d.telefono,
  fecha: d.fecha, hora: d.hora, turno: turnoDe(d.hora), personas: d.personas, notas: d.notas, mesa: mesa.id,
  origen: val.origen, estado: 'confirmada', asistencia: '', recordatorio: false, resena: false, ref: '',
} }]
`), [960, 640])
  f.add(ifExpr('¿Hay mesa?', '!!$json.codigo'), [1200, 640])
  f.add(dtInsert('Guardar reserva', 'RESERVAS'), [1440, 580])
  f.add(code('Preparar confirmación', `
cargar('Contenido (reserva)')
const r = $('Guardar reserva').first().json
const body = { ok: true, codigo: r.codigo, fecha: r.fecha, fechaTexto: fechaLarga(r.fecha), hora: r.hora, personas: r.personas, nombre: r.nombre, email: r.email, mesa: nombreMesa(r.mesa), zona: (MESAS.find((m) => m.id === r.mesa) || {}).zona || '', gestionar: enlace(r.token) }
const mapa = CFG.direccion ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(CFG.nombre + ' ' + CFG.direccion) : ''
return [{ json: {
  body,
  para: r.email,
  asunto: 'Reserva confirmada · ' + fechaLarga(r.fecha) + ' a las ' + r.hora,
  html: emailHtml({
    titulo: '¡Reserva confirmada!',
    intro: 'Hola ' + esc(r.nombre.split(' ')[0]) + ', te esperamos. Si no puedes venir, cancélala con el botón para que otra persona aproveche la mesa.',
    filas: datosReserva(r),
    botones: [{ texto: 'Ver o cancelar', url: enlace(r.token) }].concat(mapa ? [{ texto: 'Cómo llegar', url: mapa, secundario: true }] : []),
  }),
} }]
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
const e = $('Guardar en espera').first().json
return [{ json: {
  body: { ok: true, fechaTexto: fechaLarga(e.fecha), email: e.email },
  para: e.email,
  asunto: 'Estás en la lista de espera · ' + fechaLarga(e.fecha),
  html: emailHtml({
    titulo: 'Estás en la lista de espera',
    intro: 'Si se libera una mesa para ' + e.personas + ' el ' + esc(fechaLarga(e.fecha)) + ' en el turno de ' + e.turno + ', <b>te la reservaremos automáticamente</b> y te avisaremos por aquí. No tienes que hacer nada más.',
  }),
} }]
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
  .map((r) => ({ json: {
    token: r.token,
    para: r.email,
    asunto: 'Mañana te esperamos a las ' + r.hora + ' · ' + CFG.nombre,
    html: emailHtml({
      titulo: 'Te esperamos mañana',
      intro: 'Hola ' + esc(r.nombre.split(' ')[0]) + ', te recordamos tu reserva. ¿Nos confirmas que venís? Si no podéis, cancélala y daremos la mesa a quien está en lista de espera.',
      filas: datosReserva(r),
      botones: [{ texto: 'Sí, allí estaremos', url: enlace(r.token) + '&accion=confirmar' }, { texto: 'No podemos ir', url: enlace(r.token) + '&accion=cancelar', secundario: true }],
    }),
  } }))
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
  .map((r) => ({ json: {
    token: r.token,
    para: r.email,
    asunto: '¿Qué tal ayer en ' + CFG.nombre + '?',
    html: emailHtml({
      titulo: 'Gracias por venir',
      intro: 'Hola ' + esc(r.nombre.split(' ')[0]) + ', esperamos que disfrutarais. Tu opinión nos ayuda muchísimo a que más gente nos conozca. ¿Nos dejas una reseña? Es un minuto.',
      botones: [{ texto: '★★★★★ Dejar reseña en Google', url: CFG.resena }],
      pie: 'Si algo no estuvo a la altura, responde a este email: lo leemos personalmente.',
    }),
  } }))
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
const espera = filas($('Personas esperando').all()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
const reservas = filas($input.all())
const salida = []
for (const e of espera) {
  if (reservas.some((r) => r.fecha === e.fecha && r.telefono === e.telefono && OCUPAN.includes(r.estado))) continue
  const disp = disponibilidad(e.fecha, reservas, e.personas)
  if (!disp.ok || disp.cerrado) continue
  // Su hora preferida o, si no, la más cercana del mismo turno.
  const opciones = disp.horas.filter((h) => h.disponible && h.turno === e.turno)
    .sort((a, b) => Math.abs(minutos(a.hora) - minutos(e.hora)) - Math.abs(minutos(b.hora) - minutos(e.hora)))
  let elegida = null
  for (const h of opciones) {
    const mesa = mejorMesa(estadoMesas(e.fecha, h.hora, e.personas, reservas))
    if (mesa) { elegida = { hora: h.hora, mesa: mesa.id }; break }
  }
  if (!elegida) continue
  const nueva = {
    codigo: nuevoCodigo(), token: nuevoToken(), nombre: e.nombre, email: e.email, telefono: e.telefono,
    fecha: e.fecha, hora: elegida.hora, turno: turnoDe(elegida.hora), personas: e.personas, notas: e.notas, mesa: elegida.mesa,
    origen: 'espera', estado: 'confirmada', asistencia: '', recordatorio: false, resena: false, ref: String(e.id),
  }
  reservas.push(nueva) // el siguiente de la lista ya ve la mesa ocupada
  salida.push({ json: nueva })
}
return salida
`), [1040, 100])
  f.add(dtInsert('Crear reserva', 'RESERVAS'), [1300, 100])
  f.add(dtSet('Sacar de la lista', 'ESPERA', [['id', 'eq', '={{ Number($json.ref) }}']], { estado: 'convertida' }), [1560, 100])
  f.add(code('Preparar aviso de mesa', `
cargar('Contenido')
return $('Crear reserva').all().filter((i) => i.json.email).map(({ json: r }) => ({ json: {
  para: r.email,
  asunto: '¡Tienes mesa! ' + fechaLarga(r.fecha) + ' a las ' + r.hora,
  html: emailHtml({
    titulo: '¡Se ha liberado una mesa para ti!',
    intro: 'Hola ' + esc(r.nombre.split(' ')[0]) + ', estabas en nuestra lista de espera y <b>ya tienes la reserva hecha</b>. Si al final no te viene bien, cancélala con el botón.',
    filas: datosReserva(r),
    botones: [{ texto: 'Ver o cancelar', url: enlace(r.token) }],
  }),
} }))
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
  espera: filas($input.all()).map((e) => ({ nombre: e.nombre, telefono: e.telefono, fecha: e.fecha, hora: e.hora, personas: Number(e.personas) })),
  opciones: { modelos: MODELOS_3D, alergenos: ALERGENOS, etiquetas: ETIQUETAS },
})
`), [960, 0])
  f.add(respondJson('Responder datos'), [1200, 0])
  f.chain('GET /api/admin/datos', 'Contenido (admin)', 'Reservas del día (admin)', 'Lista de espera (admin)', 'Datos de administración', 'Responder datos')

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
const hoyR = filas($('Reservas de hoy').all())
const ayer = filas($input.all())
const act = hoyR.filter((r) => OCUPAN.includes(r.estado)).sort((a, b) => a.hora.localeCompare(b.hora))
const plazas = mesasActivas().reduce((s, m) => s + Number(m.plazas), 0)
const pax = (t) => act.filter((r) => r.turno === t).reduce((s, r) => s + Number(r.personas), 0)
const cuenta = (e) => ayer.filter((r) => r.estado === e).length
const tabla = act.length
  ? '<table width="100%" style="border-collapse:collapse;font-size:14px">' + act.map((r) => '<tr><td style="padding:6px 0;border-bottom:1px solid #eee;width:56px"><b>' + r.hora + '</b></td><td style="padding:6px 0;border-bottom:1px solid #eee">' + esc(r.nombre) + ' · mesa ' + esc(nombreMesa(r.mesa)) + (r.asistencia === 'confirmada' ? ' ✓' : '') + (r.notas ? '<br><span style="color:#b45309">⚠ ' + esc(r.notas) + '</span>' : '') + '</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right"><b>' + r.personas + '</b> pax</td></tr>').join('') + '</table>'
  : '<p>Hoy no hay reservas.</p>'
const conNotas = act.filter((r) => r.notas).length
return [{ json: {
  para,
  asunto: 'Hoy: ' + act.length + ' reservas · ' + (pax('comida') + pax('cena')) + ' comensales · ' + CFG.nombre,
  html: emailHtml({
    titulo: 'Resumen de ' + fechaLarga(hoy()),
    intro: '<b>Comida:</b> ' + pax('comida') + ' comensales · <b>Cena:</b> ' + pax('cena') + ' comensales (' + plazas + ' plazas por turno)<br>' +
      act.filter((r) => r.asistencia === 'confirmada').length + ' han confirmado asistencia' + (conNotas ? ' · <b style="color:#b45309">' + conNotas + ' con alergias o notas</b>' : '') +
      '<br><br>' + tabla +
      '<br><b>Ayer:</b> ' + cuenta('llegada') + ' llegadas · ' + cuenta('no_show') + ' no se presentaron · ' + cuenta('cancelada') + ' cancelaciones',
    botones: [{ texto: 'Abrir la administración', url: SECRETOS.url + '/admin' }],
  }),
} }]
`), [1040, 100])
  f.add(email('Enviar informe'), [1300, 100])
  f.connect('Cada día a las 9', 'Contenido')
  f.connect('Ejecutar ahora', 'Contenido')
  f.chain('Contenido', 'Reservas de hoy', 'Reservas de ayer (informe)', 'Preparar informe', 'Enviar informe')
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

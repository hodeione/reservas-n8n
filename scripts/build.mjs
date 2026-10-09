// Genera los flujos de n8n en workflows/*.json a partir de src/.
// Los identificadores de tablas y credenciales quedan como marcadores
// (__DT_RESERVAS__, __DT_ESPERA__, __SMTP__) que sustituye el instalador.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Flow, code, dtGet, dtInsert, dtSet, dtUpdate, email, httpPost, ifExpr, respondExpr, respondHtml, respondJson, schedule, webhook } from './nodes.mjs'

const RESERVAR_HTML = readFileSync(new URL('../src/reservar.html', import.meta.url), 'utf8')
const PANEL_HTML = readFileSync(new URL('../src/panel.html', import.meta.url), 'utf8')
const js = (s) => JSON.stringify(s)
/** Aviso a la lista de espera tras liberar sitio (llamada interna del propio n8n). */
const AVISO_ESPERA = 'http://localhost:5678/webhook/interno/espera'
const avisoBody = '={{ JSON.stringify({ clave: $env.REST_CLAVE_PANEL }) }}'
const HOY = '={{ $now.toFormat("yyyy-MM-dd") }}'
const flows = []

/* ===================================================== 01 · Reservas */
{
  const f = new Flow('01 · Reservas: web y API')

  // Página pública
  f.add(webhook('GET /reservar', 'GET', 'reservar'), [0, 0])
  f.add(code('Página de reservas', `
const html = ${js(RESERVAR_HTML)}
  .replace(/__NOMBRE__/g, esc(CFG.nombre))
  .replace('__DIRECCION__', esc([CFG.direccion, CFG.telefono].filter(Boolean).join(' · ')))
  .replace('__CONFIG__', JSON.stringify({ nombre: CFG.nombre, telefono: CFG.telefono, direccion: CFG.direccion, cerrado: CFG.cerrado, maxPersonas: CFG.maxPersonas, diasMax: CFG.diasMax }).replace(/</g, '\\\\u003c'))
return [{ json: { html } }]
`), [240, 0])
  f.add(respondHtml('Responder página'), [480, 0])
  f.chain('GET /reservar', 'Página de reservas', 'Responder página')

  // Disponibilidad (web y recepcionista de IA)
  f.add(webhook('GET /api/disponibilidad', 'GET', 'api/disponibilidad'), [0, 200])
  f.add(dtGet('Reservas del día', 'RESERVAS', [['fecha', 'eq', '={{ $json.query.fecha }}']]), [240, 200])
  f.add(code('Calcular disponibilidad', `
const q = $('GET /api/disponibilidad').first().json.query || {}
const personas = Math.max(1, Math.floor(Number(q.personas) || 2))
const d = disponibilidad(String(q.fecha || ''), filas($input.all()), personas)
if (!d.ok) return respuesta(400, { error: d.motivo })
if (d.cerrado) return respuesta(200, { fecha: q.fecha, cerrado: true, motivo: d.motivo, horas: [], resumen: d.motivo })
const libres = d.horas.filter((h) => h.disponible).map((h) => h.hora)
return respuesta(200, {
  fecha: d.fecha,
  fechaTexto: d.fechaTexto,
  personas,
  cerrado: false,
  horas: d.horas.map((h) => ({ hora: h.hora, turno: h.turno, disponible: h.disponible, pasada: h.pasada })),
  // Frase lista para que la diga el recepcionista de IA.
  resumen: libres.length ? 'El ' + d.fechaTexto + ' hay sitio para ' + personas + ' a las ' + libres.join(', ') + '.' : 'El ' + d.fechaTexto + ' no queda sitio para ' + personas + '.',
})
`), [480, 200])
  f.add(respondJson('Responder disponibilidad'), [720, 200])
  f.chain('GET /api/disponibilidad', 'Reservas del día', 'Calcular disponibilidad', 'Responder disponibilidad')

  // Crear reserva
  f.add(webhook('POST /api/reservas', 'POST', 'api/reservas'), [0, 420])
  f.add(code('Validar', `
const req = $input.first().json
const b = req.body || {}
const clave = (req.headers || {})['x-api-key'] || b.clave || ''
const interno = !!clave && (clave === CFG.claveAgente || clave === CFG.clavePanel)
const v = validarReserva(b)
if (b.web) v.ok = false, v.errores.push('Solicitud no válida.') // campo trampa para bots
if (clave && !interno) v.ok = false, v.errores.push('Clave no válida.')
const origen = interno ? (['telefono', 'local', 'ia'].includes(b.origen) ? b.origen : 'telefono') : 'web'
return [{ json: { ...v, fecha: v.datos.fecha || '0000-00-00', interno, origen } }]
`), [240, 420])
  f.add(dtGet('Reservas de esa fecha', 'RESERVAS', [['fecha', 'eq', '={{ $json.fecha }}']]), [480, 420])
  f.add(code('Comprobar sitio', `
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
if (!hueco || !hueco.disponible) {
  return no(409, [hueco && hueco.pasada ? 'Esa hora ya no admite reservas online.' : 'No queda sitio a las ' + d.hora + ' para ' + d.personas + '.'], {
    alternativas: alternativas(disp, d.hora, d.personas),
    lista_espera: !!(hueco && !hueco.pasada),
  })
}
// Solo columnas de la tabla: el nodo siguiente las guarda tal cual.
return [{ json: {
  codigo: nuevoCodigo(), token: nuevoToken(), nombre: d.nombre, email: d.email, telefono: d.telefono,
  fecha: d.fecha, hora: d.hora, turno: turnoDe(d.hora), personas: d.personas, notas: d.notas,
  origen: val.origen, estado: 'confirmada', asistencia: '', recordatorio: false, resena: false, ref: '',
} }]
`), [720, 420])
  f.add(ifExpr('¿Hay sitio?', '!!$json.codigo'), [960, 420])
  f.add(dtInsert('Guardar reserva', 'RESERVAS'), [1200, 360])
  f.add(code('Preparar confirmación', `
const r = $('Guardar reserva').first().json
const body = { ok: true, codigo: r.codigo, fecha: r.fecha, fechaTexto: fechaLarga(r.fecha), hora: r.hora, personas: r.personas, nombre: r.nombre, email: r.email, gestionar: enlace(r.token) }
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
`), [1440, 360])
  f.add(ifExpr('¿Tiene email?', '!!$json.para'), [1680, 360])
  f.add(email('Email de confirmación'), [1920, 300])
  f.add(respondExpr('Responder reserva creada', '$("Preparar confirmación").first().json.body', '201'), [2160, 360])
  f.add(respondJson('Responder sin sitio'), [1200, 520])
  f.chain('POST /api/reservas', 'Validar', 'Reservas de esa fecha', 'Comprobar sitio', '¿Hay sitio?')
  f.connect('¿Hay sitio?', 'Guardar reserva', 0)
  f.connect('¿Hay sitio?', 'Responder sin sitio', 1)
  f.chain('Guardar reserva', 'Preparar confirmación', '¿Tiene email?')
  f.connect('¿Tiene email?', 'Email de confirmación', 0)
  f.connect('¿Tiene email?', 'Responder reserva creada', 1)
  f.connect('Email de confirmación', 'Responder reserva creada')

  // Lista de espera
  f.add(webhook('POST /api/espera', 'POST', 'api/espera'), [0, 720])
  f.add(code('Validar espera', `
const b = $input.first().json.body || {}
const v = validarReserva(b)
if (b.web) v.ok = false
if (!v.ok) return [{ json: { status: 400, body: { ok: false, errores: v.errores } } }]
const d = v.datos
return [{ json: { token: nuevoToken(), nombre: d.nombre, email: d.email, telefono: d.telefono, fecha: d.fecha, hora: d.hora, turno: turnoDe(d.hora), personas: d.personas, notas: d.notas, estado: 'esperando', ref: '' } }]
`), [240, 720])
  f.add(ifExpr('¿Datos válidos?', '!!$json.token'), [480, 720])
  f.add(dtInsert('Guardar en espera', 'ESPERA'), [720, 660])
  f.add(code('Preparar aviso de espera', `
const e = $('Guardar en espera').first().json
return [{ json: {
  body: { ok: true, fechaTexto: fechaLarga(e.fecha), email: e.email },
  para: e.email,
  asunto: 'Estás en la lista de espera · ' + fechaLarga(e.fecha),
  html: emailHtml({
    titulo: 'Estás en la lista de espera',
    intro: 'Si se libera sitio para ' + e.personas + ' el ' + esc(fechaLarga(e.fecha)) + ' en el turno de ' + e.turno + ', <b>te reservaremos la mesa automáticamente</b> y te avisaremos por aquí. No tienes que hacer nada más.',
  }),
} }]
`), [960, 660])
  f.add(ifExpr('¿Email de espera?', '!!$json.para'), [1200, 660])
  f.add(email('Email de lista de espera'), [1440, 600])
  f.add(respondExpr('Responder espera', '$("Preparar aviso de espera").first().json.body', '201'), [1680, 660])
  f.add(respondJson('Responder espera no válida'), [720, 820])
  f.chain('POST /api/espera', 'Validar espera', '¿Datos válidos?')
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
  const form = (accion, texto, clase) => '<form method="post" action="' + CFG.url + '/webhook/reserva" style="display:inline"><input type="hidden" name="t" value="' + esc(r.token) + '"><input type="hidden" name="accion" value="' + accion + '"><button class="btn ' + clase + '">' + texto + '</button></form> '
  const acciones = activa
    ? (r.asistencia === 'confirmada' ? '<p class="ok">✓ Has confirmado que vienes.</p>' : form('confirmar', 'Confirmo que voy', 'btn-primary')) + form('cancelar', 'Cancelar reserva', 'btn-danger')
    : ''
  return pagina('Tu reserva', '<div class="card">' + (aviso ? '<p class="ok"><b>' + aviso + '</b></p>' : '') + '<h1>Tu reserva</h1><p class="muted">Estado: ' + estado + '</p><dl>' +
    datosReserva(r).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' + acciones +
    '<p class="muted" style="margin-top:18px;font-size:14px">' + esc([CFG.direccion, CFG.telefono].filter(Boolean).join(' · ')) + '</p></div>')
}`

  // Ver la reserva (enlace de los emails). Las acciones van por POST para que
  // los antivirus de correo que abren enlaces no cancelen nada por error.
  f.add(webhook('GET /reserva', 'GET', 'reserva'), [0, 0])
  f.add(dtGet('Buscar por enlace', 'RESERVAS', [['token', 'eq', '={{ $json.query.t || "-" }}']]), [240, 0])
  f.add(code('Página de la reserva', `${paginaReserva}
const r = filas($input.all())[0]
return [{ json: { html: paginaReserva(r), status: r ? 200 : 404 } }]
`), [480, 0])
  f.add(respondHtml('Responder reserva'), [720, 0])
  f.chain('GET /reserva', 'Buscar por enlace', 'Página de la reserva', 'Responder reserva')

  f.add(webhook('POST /reserva', 'POST', 'reserva'), [0, 220])
  f.add(dtGet('Buscar reserva', 'RESERVAS', [['token', 'eq', '={{ $json.body.t || "-" }}']]), [240, 220])
  f.add(code('Aplicar acción', `${paginaReserva}
const accion = ($('POST /reserva').first().json.body || {}).accion
const r = filas($input.all())[0]
if (!r) return [{ json: { html: paginaReserva(null), status: 404 } }]
const activa = r.estado === 'confirmada' && r.fecha >= hoy()
if (activa && accion === 'cancelar') return [{ json: { estado: 'cancelada' } }]
if (activa && accion === 'confirmar') return [{ json: { asistencia: 'confirmada' } }]
return [{ json: { html: paginaReserva(r) } }]
`), [480, 220])
  f.add(ifExpr('¿Hay cambio?', '$json.html === undefined'), [720, 220])
  f.add(dtUpdate('Guardar cambio', 'RESERVAS', [['token', 'eq', '={{ $("POST /reserva").first().json.body.t }}']]), [960, 160])
  f.add(httpPost('Avisar a la lista de espera', AVISO_ESPERA, avisoBody), [1200, 160])
  f.add(code('Página tras el cambio', `${paginaReserva}
const r = $('Guardar cambio').first().json
const aviso = r.estado === 'cancelada' ? 'Reserva cancelada. ¡Gracias por avisar!' : '¡Gracias por confirmar! Te esperamos.'
return [{ json: { html: paginaReserva(r, aviso) } }]
`), [1440, 160])
  f.add(respondHtml('Responder cambio'), [1680, 220])
  f.chain('POST /reserva', 'Buscar reserva', 'Aplicar acción', '¿Hay cambio?')
  f.connect('¿Hay cambio?', 'Guardar cambio', 0)
  f.connect('¿Hay cambio?', 'Responder cambio', 1)
  f.chain('Guardar cambio', 'Avisar a la lista de espera', 'Página tras el cambio', 'Responder cambio')

  // Cancelación por teléfono (recepcionista de IA o personal): código + teléfono
  f.add(webhook('POST /api/cancelar', 'POST', 'api/cancelar'), [0, 460])
  f.add(dtGet('Buscar por código', 'RESERVAS', [['codigo', 'eq', '={{ String($json.body.codigo || "-").toUpperCase().replace(/\\s/g, "") }}']]), [240, 460])
  f.add(code('Comprobar cancelación', `
const req = $('POST /api/cancelar').first().json
const b = req.body || {}
const clave = (req.headers || {})['x-api-key'] || b.clave || ''
const no = (status, error) => [{ json: { status, body: { ok: false, error } } }]
if (!clave || (clave !== CFG.claveAgente && clave !== CFG.clavePanel)) return no(401, 'Clave no válida.')
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
  f.add(dtGet('Reservas de mañana', 'RESERVAS', [['fecha', 'eq', '={{ $now.plus({ days: 1 }).toFormat("yyyy-MM-dd") }}']]), [260, 100])
  f.add(code('Preparar recordatorios', `
const manual = $('Ejecutar ahora').isExecuted
if (manual && ($('Ejecutar ahora').first().json.body || {}).clave !== CFG.clavePanel) return []
// Sin emails de madrugada, y no a quien acaba de reservar hace menos de 3 horas.
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
`), [520, 100])
  f.add(email('Enviar recordatorio'), [780, 100])
  f.add(dtSet('Marcar enviado', 'RESERVAS', [['token', 'eq', '={{ $("Preparar recordatorios").item.json.token }}']], { recordatorio: true }), [1040, 100])
  f.connect('Cada hora', 'Reservas de mañana')
  f.connect('Ejecutar ahora', 'Reservas de mañana')
  f.chain('Reservas de mañana', 'Preparar recordatorios', 'Enviar recordatorio', 'Marcar enviado')
  flows.push(f)
}

/* ===================================================== 04 · Reseñas */
{
  const f = new Flow('04 · Petición de reseña tras la visita')
  f.add(schedule('Cada día a las 12', { field: 'days', triggerAtHour: 12 }), [0, 0])
  f.add(webhook('Ejecutar ahora', 'POST', 'tareas/resenas', 'onReceived'), [0, 200])
  f.add(dtGet('Reservas de ayer', 'RESERVAS', [['fecha', 'eq', '={{ $now.minus({ days: 1 }).toFormat("yyyy-MM-dd") }}']]), [260, 100])
  f.add(code('Preparar reseñas', `
if ($('Ejecutar ahora').isExecuted && ($('Ejecutar ahora').first().json.body || {}).clave !== CFG.clavePanel) return []
if (!CFG.resena) return []
// Solo a quien vino (o a quien no se marcó como ausente) y una sola vez.
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
`), [520, 100])
  f.add(email('Enviar petición de reseña'), [780, 100])
  f.add(dtSet('Marcar reseña pedida', 'RESERVAS', [['token', 'eq', '={{ $("Preparar reseñas").item.json.token }}']], { resena: true }), [1040, 100])
  f.connect('Cada día a las 12', 'Reservas de ayer')
  f.connect('Ejecutar ahora', 'Reservas de ayer')
  f.chain('Reservas de ayer', 'Preparar reseñas', 'Enviar petición de reseña', 'Marcar reseña pedida')
  flows.push(f)
}

/* ===================================================== 05 · Lista de espera */
{
  const f = new Flow('05 · Lista de espera automática')
  f.add(schedule('Cada 30 minutos', { field: 'minutes', minutesInterval: 30 }), [0, 0])
  f.add(webhook('Sitio liberado', 'POST', 'interno/espera', 'onReceived'), [0, 200])
  f.add(dtGet('Personas esperando', 'ESPERA', [['estado', 'eq', 'esperando'], ['fecha', 'gte', HOY]]), [260, 100])
  f.add(dtGet('Reservas próximas', 'RESERVAS', [['fecha', 'gte', HOY]], { executeOnce: true }), [520, 100])
  f.add(code('Asignar mesas', `
if ($('Sitio liberado').isExecuted && ($('Sitio liberado').first().json.body || {}).clave !== CFG.clavePanel) return []
const espera = filas($('Personas esperando').all()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
const reservas = filas($input.all())
const salida = []
for (const e of espera) {
  const disp = disponibilidad(e.fecha, reservas, e.personas)
  if (!disp.ok || disp.cerrado) continue
  // Su hora preferida o, si no, la más cercana del mismo turno.
  const opciones = disp.horas.filter((h) => h.disponible && h.turno === e.turno)
  if (!opciones.length) continue
  const minutos = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3))
  opciones.sort((a, b) => Math.abs(minutos(a.hora) - minutos(e.hora)) - Math.abs(minutos(b.hora) - minutos(e.hora)))
  if (reservas.some((r) => r.fecha === e.fecha && r.telefono === e.telefono && OCUPAN.includes(r.estado))) continue
  const nueva = {
    codigo: nuevoCodigo(), token: nuevoToken(), nombre: e.nombre, email: e.email, telefono: e.telefono,
    fecha: e.fecha, hora: opciones[0].hora, turno: e.turno, personas: e.personas, notas: e.notas,
    origen: 'espera', estado: 'confirmada', asistencia: '', recordatorio: false, resena: false, ref: String(e.id),
  }
  reservas.push(nueva) // para que el siguiente de la lista vea el sitio ya ocupado
  salida.push({ json: nueva })
}
return salida
`), [780, 100])
  f.add(dtInsert('Crear reserva', 'RESERVAS'), [1040, 100])
  f.add(dtSet('Sacar de la lista', 'ESPERA', [['id', 'eq', '={{ Number($json.ref) }}']], { estado: 'convertida' }), [1300, 100])
  f.add(code('Preparar aviso de mesa', `
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
`), [1560, 100])
  f.add(email('Avisar al cliente'), [1820, 100])
  f.connect('Cada 30 minutos', 'Personas esperando')
  f.connect('Sitio liberado', 'Personas esperando')
  f.chain('Personas esperando', 'Reservas próximas', 'Asignar mesas', 'Crear reserva', 'Sacar de la lista', 'Preparar aviso de mesa', 'Avisar al cliente')
  flows.push(f)
}

/* ===================================================== 06 · Panel */
{
  const f = new Flow('06 · Panel del restaurante')
  f.add(webhook('GET /panel', 'GET', 'panel'), [0, 0])
  f.add(dtGet('Reservas del día (panel)', 'RESERVAS', [['fecha', 'eq', '={{ /^\\d{4}-\\d{2}-\\d{2}$/.test($json.query.fecha || "") ? $json.query.fecha : $now.toFormat("yyyy-MM-dd") }}']]), [240, 0])
  f.add(code('Pintar panel', `
const q = $('GET /panel').first().json.query || {}
if (!CFG.clavePanel || q.clave !== CFG.clavePanel) {
  return [{ json: { status: 401, html: pagina('Panel', '<div class="card"><h1>Panel del restaurante</h1><form method="get"><label>Clave</label><input name="clave" type="password" autofocus style="width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;margin:8px 0"><button class="btn btn-primary">Entrar</button></form></div>') } }]
}
const fecha = /^\\d{4}-\\d{2}-\\d{2}$/.test(q.fecha || '') ? q.fecha : hoy()
const d = DateTime.fromISO(fecha, { zone: $now.zoneName })
const datos = {
  clave: q.clave, fecha, hoy: hoy(), fechaTexto: fechaLarga(fecha), cerrado: CFG.cerrado.includes(d.weekday), aforo: CFG.aforo,
  reservas: filas($input.all()).map((r) => ({ token: r.token, codigo: r.codigo, nombre: r.nombre, telefono: r.telefono, hora: r.hora, turno: r.turno, personas: Number(r.personas), notas: r.notas, estado: r.estado, asistencia: r.asistencia, origen: r.origen })),
}
const html = ${js(PANEL_HTML)}.replace(/__NOMBRE__/g, esc(CFG.nombre)).replace('__DATA__', JSON.stringify(datos).replace(/</g, '\\\\u003c'))
return [{ json: { html } }]
`), [480, 0])
  f.add(respondHtml('Responder panel'), [720, 0])
  f.chain('GET /panel', 'Reservas del día (panel)', 'Pintar panel', 'Responder panel')

  f.add(webhook('POST /api/panel', 'POST', 'api/panel'), [0, 220])
  f.add(code('Validar cambio de estado', `
const b = $input.first().json.body || {}
if (!CFG.clavePanel || b.clave !== CFG.clavePanel) return [{ json: { status: 401, body: { ok: false, error: 'Clave no válida.' } } }]
if (!['confirmada', 'llegada', 'no_show', 'cancelada'].includes(b.estado) || !b.token) return [{ json: { status: 400, body: { ok: false, error: 'Datos no válidos.' } } }]
return [{ json: { estado: b.estado } }]
`), [240, 220])
  f.add(ifExpr('¿Cambio válido?', '$json.body === undefined'), [480, 220])
  f.add(dtUpdate('Cambiar estado', 'RESERVAS', [['token', 'eq', '={{ $("POST /api/panel").first().json.body.token }}']]), [720, 160])
  f.add(httpPost('Avisar a la espera (panel)', AVISO_ESPERA, avisoBody), [960, 160])
  f.add(respondExpr('Responder estado', '({ ok: true })'), [1200, 160])
  f.add(respondJson('Responder estado no válido'), [720, 320])
  f.chain('POST /api/panel', 'Validar cambio de estado', '¿Cambio válido?')
  f.connect('¿Cambio válido?', 'Cambiar estado', 0)
  f.connect('¿Cambio válido?', 'Responder estado no válido', 1)
  f.chain('Cambiar estado', 'Avisar a la espera (panel)', 'Responder estado')
  flows.push(f)
}

/* ===================================================== 07 · Informe diario */
{
  const f = new Flow('07 · Informe diario para el dueño')
  f.add(schedule('Cada día a las 9', { field: 'days', triggerAtHour: 9 }), [0, 0])
  f.add(webhook('Ejecutar ahora', 'POST', 'tareas/informe', 'onReceived'), [0, 200])
  f.add(dtGet('Reservas de hoy', 'RESERVAS', [['fecha', 'eq', HOY]]), [260, 100])
  f.add(dtGet('Reservas de ayer (informe)', 'RESERVAS', [['fecha', 'eq', '={{ $now.minus({ days: 1 }).toFormat("yyyy-MM-dd") }}']], { executeOnce: true }), [520, 100])
  f.add(code('Preparar informe', `
if ($('Ejecutar ahora').isExecuted && ($('Ejecutar ahora').first().json.body || {}).clave !== CFG.clavePanel) return []
if (!CFG.dueno) return []
const hoyR = filas($('Reservas de hoy').all())
const ayer = filas($input.all())
const act = hoyR.filter((r) => OCUPAN.includes(r.estado)).sort((a, b) => a.hora.localeCompare(b.hora))
const pax = (t) => act.filter((r) => r.turno === t).reduce((s, r) => s + Number(r.personas), 0)
const pct = (t) => CFG.aforo[t] ? Math.round((pax(t) / CFG.aforo[t]) * 100) : 0
const cuenta = (e) => ayer.filter((r) => r.estado === e).length
const tabla = act.length
  ? '<table width="100%" style="border-collapse:collapse;font-size:14px">' + act.map((r) => '<tr><td style="padding:6px 0;border-bottom:1px solid #eee;width:56px"><b>' + r.hora + '</b></td><td style="padding:6px 0;border-bottom:1px solid #eee">' + esc(r.nombre) + (r.asistencia === 'confirmada' ? ' ✓' : '') + (r.notas ? '<br><span style="color:#b45309">⚠ ' + esc(r.notas) + '</span>' : '') + '</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right"><b>' + r.personas + '</b> pax</td></tr>').join('') + '</table>'
  : '<p>Hoy no hay reservas.</p>'
const conNotas = act.filter((r) => r.notas).length
return [{ json: {
  para: CFG.dueno,
  asunto: 'Hoy: ' + act.length + ' reservas · ' + (pax('comida') + pax('cena')) + ' comensales · ' + CFG.nombre,
  html: emailHtml({
    titulo: 'Resumen de ' + fechaLarga(hoy()),
    intro: '<b>Comida:</b> ' + pax('comida') + ' de ' + CFG.aforo.comida + ' (' + pct('comida') + ' %) · <b>Cena:</b> ' + pax('cena') + ' de ' + CFG.aforo.cena + ' (' + pct('cena') + ' %)<br>' +
      act.filter((r) => r.asistencia === 'confirmada').length + ' han confirmado asistencia' + (conNotas ? ' · <b style="color:#b45309">' + conNotas + ' con alergias o notas</b>' : '') +
      '<br><br>' + tabla +
      '<br><b>Ayer:</b> ' + cuenta('llegada') + ' llegadas · ' + cuenta('no_show') + ' no se presentaron · ' + cuenta('cancelada') + ' cancelaciones',
    botones: [{ texto: 'Abrir el panel', url: CFG.url + '/webhook/panel?clave=' + encodeURIComponent(CFG.clavePanel) }],
  }),
} }]
`), [780, 100])
  f.add(email('Enviar informe'), [1040, 100])
  f.connect('Cada día a las 9', 'Reservas de hoy')
  f.connect('Ejecutar ahora', 'Reservas de hoy')
  f.chain('Reservas de hoy', 'Reservas de ayer (informe)', 'Preparar informe', 'Enviar informe')
  flows.push(f)
}

mkdirSync(new URL('../workflows/', import.meta.url), { recursive: true })
for (const f of flows) {
  const [num, resto] = f.name.split(' · ')
  const file = num + '-' + resto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  writeFileSync(new URL(`../workflows/${file}.json`, import.meta.url), JSON.stringify(f.toJSON(), null, 2))
  console.log('✓', f.name, `(${f.nodes.length} nodos)`)
}

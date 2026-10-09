/* =====================================================================
 * Librería común de los flujos. El generador (scripts/build.mjs) la
 * antepone al código de cada nodo Code: aquí se puede usar $env, $now
 * (luxon, Europe/Madrid), DateTime y $('Nodo').
 *
 * La configuración, el plano de mesas y la carta se editan desde la
 * administración y viven en la tabla «contenido». Cada nodo Code llama a
 * cargar('Nombre del nodo que leyó contenido') antes de usar CFG, MESAS o CARTA.
 * ===================================================================== */

const POR_DEFECTO = {
  nombre: $env.REST_NOMBRE || 'Restaurante',
  eslogan: '',
  descripcion: '',
  direccion: $env.REST_DIRECCION || '',
  telefono: $env.REST_TELEFONO || '',
  email: '',
  instagram: '',
  lat: 43.2569,
  lng: -2.9234,
  horas: { comida: ['13:00', '13:30', '14:00', '14:30', '15:00'], cena: ['20:00', '20:30', '21:00', '21:30', '22:00'] },
  duracion: { comida: 90, cena: 120 },
  cerrado: [1],
  vacaciones: [],
  franja: 16,
  antelacionMin: 60,
  diasMax: 60,
  maxPersonas: 10,
  resena: $env.REST_URL_RESENA || '',
  emailDueno: $env.REST_EMAIL_DUENO || '',
}

let CFG = { ...POR_DEFECTO }
let MESAS = []
let CARTA = { categorias: [], platos: [] }
const SECRETOS = {
  remitente: $env.REST_EMAIL_REMITENTE || 'reservas@example.com',
  clavePanel: $env.REST_CLAVE_PANEL || '',
  claveAgente: $env.REST_CLAVE_AGENTE || '',
  url: String($env.WEBHOOK_URL || '').replace(/\/$/, ''),
}

/** Carga configuración, mesas y carta desde el nodo que leyó la tabla «contenido». */
function cargar(nodo) {
  let docs = {}
  try {
    for (const i of $(nodo).all()) {
      if (i.json && i.json.clave) {
        try { docs[i.json.clave] = JSON.parse(i.json.valor) } catch {}
      }
    }
  } catch {}
  CFG = { ...POR_DEFECTO, ...(docs.config || {}) }
  CFG.horas = { ...POR_DEFECTO.horas, ...(CFG.horas || {}) }
  CFG.duracion = { ...POR_DEFECTO.duracion, ...(CFG.duracion || {}) }
  MESAS = Array.isArray(docs.mesas) ? docs.mesas : []
  CARTA = docs.carta && Array.isArray(docs.carta.platos) ? docs.carta : { categorias: [], platos: [] }
  return docs
}

const OCUPAN = ['confirmada', 'llegada']
const hoy = (dias = 0) => $now.plus({ days: dias }).toFormat('yyyy-MM-dd')
const minutos = (h) => Number(String(h).slice(0, 2)) * 60 + Number(String(h).slice(3, 5))

function turnoDe(hora) {
  if ((CFG.horas.comida || []).includes(hora)) return 'comida'
  if ((CFG.horas.cena || []).includes(hora)) return 'cena'
  return null
}

function fechaLarga(fecha) {
  const d = DateTime.fromISO(fecha, { zone: $now.zoneName })
  return d.isValid ? d.setLocale('es').toFormat("cccc d 'de' LLLL") : fecha
}

function filas(items) {
  return items.map((i) => i.json).filter((r) => r && r.id !== undefined)
}

const mesasActivas = () => MESAS.filter((m) => m.activa !== false)
const nombreMesa = (id) => (MESAS.find((m) => m.id === id) || {}).nombre || ''
const capacidadMax = () => Math.max(0, ...mesasActivas().map((m) => Number(m.plazas) || 0))

/**
 * Estado de cada mesa para una fecha, hora y número de personas.
 * Una reserva ocupa su mesa desde su hora durante la duración del turno.
 */
function estadoMesas(fecha, hora, personas, reservas, { ignorar = '' } = {}) {
  const turno = turnoDe(hora)
  const ini = minutos(hora)
  const fin = ini + (CFG.duracion[turno] || 90)
  const activas = reservas.filter((r) => r.fecha === fecha && OCUPAN.includes(r.estado) && r.mesa && r.token !== ignorar)
  return mesasActivas().map((m) => {
    const choque = activas.find((r) => {
      if (r.mesa !== m.id) return false
      const a = minutos(r.hora)
      const b = a + (CFG.duracion[r.turno] || 90)
      return a < fin && ini < b
    })
    const cabe = personas >= (Number(m.min) || 1) && personas <= (Number(m.plazas) || 0)
    return { id: m.id, nombre: m.nombre, zona: m.zona, plazas: Number(m.plazas), estado: choque ? 'ocupada' : cabe ? 'libre' : 'no_cabe', hasta: choque ? choque.hora : undefined }
  })
}

/** La mesa libre que mejor encaja: la más pequeña en la que caben (menos sillas vacías). */
function mejorMesa(estados, preferida) {
  const libres = estados.filter((m) => m.estado === 'libre')
  if (preferida) return libres.find((m) => m.id === preferida) || null
  return libres.sort((a, b) => a.plazas - b.plazas || String(a.id).localeCompare(String(b.id)))[0] || null
}

function diaCerrado(d) {
  if (CFG.cerrado.includes(d.weekday)) return CFG.nombre + ' cierra ese día.'
  if ((CFG.vacaciones || []).includes(d.toFormat('yyyy-MM-dd'))) return CFG.nombre + ' está cerrado ese día.'
  return ''
}

/**
 * Disponibilidad de un día: una hora está libre si no ha pasado (más la
 * antelación), si no se supera el ritmo de entradas de la cocina y si
 * queda alguna mesa libre en la que quepa el grupo.
 */
function disponibilidad(fecha, reservas, personas = 2, { ignorarAntelacion = false } = {}) {
  const d = DateTime.fromISO(fecha, { zone: $now.zoneName })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !d.isValid) return { ok: false, motivo: 'Fecha no válida.' }
  if (d.startOf('day') < $now.startOf('day')) return { ok: false, motivo: 'Esa fecha ya ha pasado.' }
  if (d.startOf('day') > $now.plus({ days: CFG.diasMax }).startOf('day')) {
    return { ok: false, motivo: 'Solo se puede reservar con hasta ' + CFG.diasMax + ' días de antelación.' }
  }
  const cierre = diaCerrado(d)
  if (cierre) return { ok: true, cerrado: true, motivo: cierre, horas: [] }

  const activas = reservas.filter((r) => r.fecha === fecha && OCUPAN.includes(r.estado))
  const llegan = {}
  for (const r of activas) llegan[r.hora] = (llegan[r.hora] || 0) + (Number(r.personas) || 0)
  const limite = $now.plus({ minutes: ignorarAntelacion ? 0 : CFG.antelacionMin })
  const horas = []
  for (const turno of ['comida', 'cena']) {
    for (const hora of CFG.horas[turno] || []) {
      const momento = d.set({ hour: Number(hora.slice(0, 2)), minute: Number(hora.slice(3)), second: 0, millisecond: 0 })
      const pasada = momento < limite
      const ritmo = !CFG.franja || (llegan[hora] || 0) + personas <= CFG.franja
      const libres = estadoMesas(fecha, hora, personas, activas).filter((m) => m.estado === 'libre').length
      horas.push({ hora, turno, mesasLibres: libres, disponible: !pasada && ritmo && libres > 0, pasada })
    }
  }
  return { ok: true, cerrado: false, fecha, fechaTexto: fechaLarga(fecha), horas }
}

function alternativas(disp, hora) {
  if (!disp.ok || disp.cerrado) return []
  return disp.horas
    .filter((x) => x.disponible)
    .sort((a, b) => Math.abs(minutos(a.hora) - minutos(hora || '00:00')) - Math.abs(minutos(b.hora) - minutos(hora || '00:00')))
    .slice(0, 3)
    .map((x) => x.hora)
}

function limpiarTexto(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizarTelefono(t) {
  const d = String(t ?? '').replace(/[^\d+]/g, '')
  if (/^[6789]\d{8}$/.test(d)) return '+34' + d
  if (/^0034\d{9}$/.test(d)) return '+' + d.slice(2)
  if (/^\+\d{8,15}$/.test(d)) return d
  return ''
}

function validarReserva(b) {
  const errores = []
  const datos = {
    nombre: limpiarTexto(b.nombre, 80),
    email: String(b.email ?? '').trim().toLowerCase().slice(0, 120),
    telefono: normalizarTelefono(b.telefono),
    fecha: String(b.fecha ?? '').trim(),
    hora: String(b.hora ?? '').trim(),
    personas: Math.floor(Number(b.personas)),
    notas: limpiarTexto(b.notas, 300),
    mesa: limpiarTexto(b.mesa, 40),
  }
  if (datos.nombre.length < 2) errores.push('Indica tu nombre.')
  if (!datos.telefono) errores.push('Indica un teléfono válido.')
  if (datos.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.email)) errores.push('El email no es válido.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) errores.push('Elige una fecha.')
  if (!turnoDe(datos.hora)) errores.push('Elige una hora.')
  const max = Math.min(CFG.maxPersonas, capacidadMax() || CFG.maxPersonas)
  if (!(datos.personas >= 1)) errores.push('Indica el número de personas.')
  else if (datos.personas > max) errores.push('Para grupos de más de ' + max + ' personas llámanos' + (CFG.telefono ? ' al ' + CFG.telefono : '') + '.')
  return { ok: errores.length === 0, errores, datos }
}

const crypto = require('crypto')
const nuevoToken = () => crypto.randomBytes(18).toString('base64url')
function nuevoCodigo() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (const b of crypto.randomBytes(6)) s += abc[b % abc.length]
  return s
}

const enlace = (token) => SECRETOS.url + '/webhook/reserva?t=' + encodeURIComponent(token)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clave = (req) => String((req.headers || {})['x-api-key'] || (req.body || {}).clave || (req.query || {}).clave || '')
const esAdmin = (req) => !!SECRETOS.clavePanel && clave(req) === SECRETOS.clavePanel
const esAgente = (req) => { const c = clave(req); return !!c && (c === SECRETOS.claveAgente || c === SECRETOS.clavePanel) }

/* ----------------------------------------------------------- plantillas */

function emailHtml({ titulo, intro, filas: datos = [], botones = [], pie = '' }) {
  const rows = datos
    .map(([k, v]) => '<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;width:120px">' + esc(k) + '</td><td style="padding:6px 0;font-size:15px;color:#111827;font-weight:600">' + esc(v) + '</td></tr>')
    .join('')
  const btns = botones
    .map((b) => '<a href="' + esc(b.url) + '" style="display:inline-block;margin:6px 8px 0 0;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;' + (b.secundario ? 'background:#f3f4f6;color:#111827' : 'background:#111827;color:#ffffff') + '">' + esc(b.texto) + '</a>')
    .join('')
  return '<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:28px">' +
    '<tr><td style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af">' + esc(CFG.nombre) + '</td></tr>' +
    '<tr><td style="padding-top:8px;font-size:24px;font-weight:700;color:#111827">' + esc(titulo) + '</td></tr>' +
    '<tr><td style="padding-top:10px;font-size:15px;line-height:1.55;color:#374151">' + intro + '</td></tr>' +
    (rows ? '<tr><td style="padding-top:16px"><table role="presentation" width="100%" style="border-top:1px solid #eee;border-bottom:1px solid #eee;padding:8px 0">' + rows + '</table></td></tr>' : '') +
    (btns ? '<tr><td style="padding-top:18px">' + btns + '</td></tr>' : '') +
    '<tr><td style="padding-top:22px;font-size:13px;line-height:1.5;color:#9ca3af">' + (pie || [CFG.direccion, CFG.telefono].filter(Boolean).map(esc).join(' · ')) + '</td></tr>' +
    '</table></td></tr></table></body></html>'
}

function datosReserva(r) {
  return [
    ['Fecha', fechaLarga(r.fecha)],
    ['Hora', r.hora],
    ['Personas', String(r.personas)],
  ]
    .concat(r.mesa ? [['Mesa', nombreMesa(r.mesa) || r.mesa]] : [])
    .concat([['Nombre', r.nombre], ['Código', r.codigo]])
    .concat(r.notas ? [['Notas', r.notas]] : [])
}

const CSS = '*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f5f3ef;color:#1c1917}' +
  '.wrap{max-width:560px;margin:0 auto;padding:28px 16px 48px}.card{background:#fff;border-radius:20px;padding:24px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 30px rgba(0,0,0,.05)}' +
  'h1{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}.muted{color:#78716c}.brand{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a8a29e;margin-bottom:6px}' +
  '.btn{display:inline-block;border:0;border-radius:12px;padding:13px 20px;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center;margin:4px 6px 4px 0}' +
  '.btn-primary{background:#1c1917;color:#fff}.btn-ghost{background:#f5f5f4;color:#1c1917}.btn-danger{background:#fee2e2;color:#991b1b}' +
  'dl{display:grid;grid-template-columns:110px 1fr;gap:8px 12px;margin:18px 0;padding:16px 0;border-top:1px solid #eee;border-bottom:1px solid #eee}dt{color:#78716c}dd{margin:0;font-weight:600}.ok{color:#15803d}.bad{color:#b91c1c}'

function pagina(titulo, cuerpo) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>' + esc(titulo) + ' · ' + esc(CFG.nombre) + '</title><style>' + CSS + '</style></head><body><div class="wrap"><div class="brand">' + esc(CFG.nombre) + '</div>' + cuerpo +
    '<p style="text-align:center;margin-top:18px"><a class="muted" href="' + SECRETOS.url + '/">Volver a la web</a></p></div></body></html>'
}

function respuesta(status, body) {
  return [{ json: { status, body } }]
}

/* ----------------------------------------------------- validación de la administración */

const MODELOS_3D = ['salad', 'skewer-vegetables', 'bowl-soup', 'fries', 'burger-cheese', 'pizza', 'meat-ribs', 'fish', 'meat-cooked', 'maki-salmon', 'sushi-salmon', 'cake', 'pancakes', 'ice-cream-cup', 'waffle', 'wine-red', 'glass-wine', 'cocktail', 'cup-coffee', 'croissant', 'taco', 'sandwich', 'pie', 'dim-sum', 'cupcake', 'chinese', 'pudding', 'sundae', 'soda-glass', 'mussel-open', 'egg-cooked']
/** Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011). */
const ALERGENOS = ['gluten', 'crustaceos', 'huevo', 'pescado', 'cacahuetes', 'soja', 'lacteos', 'frutos_cascara', 'apio', 'mostaza', 'sesamo', 'sulfitos', 'altramuces', 'moluscos']
const ETIQUETAS = ['vegetariano', 'vegano', 'sin gluten', 'picante', 'nuevo']

const entero = (v, min, max, d) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}
const texto = (v, max) => limpiarTexto(v, max)
const esHora = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f)
const esUrl = (u) => /^https:\/\/[^\s<>"]+$/.test(u)

function validarConfig(v) {
  if (!v || typeof v !== 'object') throw new Error('Configuración no válida.')
  const horas = (l) => [...new Set((Array.isArray(l) ? l : []).filter(esHora))].sort().slice(0, 24)
  const c = {
    nombre: texto(v.nombre, 60) || 'Restaurante',
    eslogan: texto(v.eslogan, 120),
    descripcion: texto(v.descripcion, 600),
    direccion: texto(v.direccion, 120),
    telefono: texto(v.telefono, 30),
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v.email || '')) ? String(v.email).trim().slice(0, 120) : '',
    instagram: texto(v.instagram, 40).replace(/^@/, ''),
    lat: Math.max(-90, Math.min(90, Number(v.lat) || POR_DEFECTO.lat)),
    lng: Math.max(-180, Math.min(180, Number(v.lng) || POR_DEFECTO.lng)),
    horas: { comida: horas(v.horas && v.horas.comida), cena: horas(v.horas && v.horas.cena) },
    duracion: { comida: entero(v.duracion && v.duracion.comida, 30, 300, 90), cena: entero(v.duracion && v.duracion.cena, 30, 300, 120) },
    cerrado: [...new Set((Array.isArray(v.cerrado) ? v.cerrado : []).map(Number).filter((d) => d >= 1 && d <= 7))].sort(),
    vacaciones: [...new Set((Array.isArray(v.vacaciones) ? v.vacaciones : []).filter(esFecha))].sort().slice(0, 120),
    franja: entero(v.franja, 0, 500, 16),
    antelacionMin: entero(v.antelacionMin, 0, 2880, 60),
    diasMax: entero(v.diasMax, 1, 365, 60),
    maxPersonas: entero(v.maxPersonas, 1, 60, 10),
    resena: esUrl(String(v.resena || '')) ? String(v.resena) : '',
    emailDueno: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v.emailDueno || '')) ? String(v.emailDueno).trim() : '',
  }
  if (!c.horas.comida.length && !c.horas.cena.length) throw new Error('Añade al menos una hora de reserva.')
  return c
}

function validarMesas(v) {
  if (!Array.isArray(v)) throw new Error('El plano no es válido.')
  if (v.length > 200) throw new Error('Máximo 200 mesas.')
  const ids = new Set()
  return v.map((m, i) => {
    const id = String(m.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'm' + (i + 1)
    if (ids.has(id)) throw new Error('Hay dos mesas con el mismo identificador (' + id + ').')
    ids.add(id)
    const plazas = entero(m.plazas, 1, 30, 4)
    return {
      id,
      nombre: texto(m.nombre, 20) || String(i + 1),
      zona: texto(m.zona, 30) || 'Salón',
      plazas,
      min: entero(m.min, 1, plazas, 1),
      x: entero(m.x, 0, 1000, 0),
      y: entero(m.y, 0, 700, 0),
      w: entero(m.w, 40, 400, 80),
      h: entero(m.h, 40, 400, 80),
      forma: m.forma === 'redonda' ? 'redonda' : 'cuadrada',
      activa: m.activa !== false,
    }
  })
}

function validarCarta(v) {
  if (!v || !Array.isArray(v.categorias) || !Array.isArray(v.platos)) throw new Error('La carta no es válida.')
  const slug = (s, d) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || d
  const categorias = v.categorias.slice(0, 20).map((c, i) => ({ id: slug(c.id || c.nombre, 'cat' + i), nombre: texto(c.nombre, 40) || 'Sección' }))
  const cats = new Set(categorias.map((c) => c.id))
  const ids = new Set()
  const platos = v.platos.slice(0, 300).map((p, i) => {
    let id = slug(p.id, 'p' + i)
    while (ids.has(id)) id += 'x'
    ids.add(id)
    const precio = Math.round(Math.max(0, Math.min(9999, Number(String(p.precio).replace(',', '.')) || 0)) * 100) / 100
    return {
      id,
      categoria: cats.has(p.categoria) ? p.categoria : (categorias[0] || {}).id || '',
      nombre: texto(p.nombre, 80) || 'Plato',
      descripcion: texto(p.descripcion, 300),
      precio,
      alergenos: (Array.isArray(p.alergenos) ? p.alergenos : []).filter((a) => ALERGENOS.includes(a)),
      etiquetas: (Array.isArray(p.etiquetas) ? p.etiquetas : []).filter((a) => ETIQUETAS.includes(a)),
      modelo: MODELOS_3D.includes(p.modelo) ? p.modelo : '',
      imagen: esUrl(String(p.imagen || '')) ? String(p.imagen) : '',
      disponible: p.disponible !== false,
      destacado: p.destacado === true,
    }
  })
  return { categorias, platos }
}

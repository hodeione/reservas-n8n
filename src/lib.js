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
  emailCocina: '',
  lluviaUmbral: 60,
  recuperarDias: 60,
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

const MODELOS_3D = ['tabla-ibericos', 'ostras', 'tortilla', 'tosta-salmon', 'ensalada', 'melon-jamon', 'pulpo', 'arroz-negro', 'chuleton', 'lubina', 'salmon', 'cordero', 'tartar', 'tarta-queso', 'tarta-chocolate', 'tarta-higos', 'tarta-frambuesa', 'tartaleta-limon', 'cafe-vienes', 'salad', 'skewer-vegetables', 'bowl-soup', 'fries', 'burger-cheese', 'pizza', 'meat-ribs', 'fish', 'meat-cooked', 'maki-salmon', 'sushi-salmon', 'cake', 'pancakes', 'ice-cream-cup', 'waffle', 'wine-red', 'glass-wine', 'cocktail', 'cup-coffee', 'croissant', 'taco', 'sandwich', 'pie', 'dim-sum', 'cupcake', 'chinese', 'pudding', 'sundae', 'soda-glass', 'mussel-open', 'egg-cooked']
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
    emailCocina: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v.emailCocina || '')) ? String(v.emailCocina).trim() : '',
    lluviaUmbral: entero(v.lluviaUmbral, 0, 100, 60),
    recuperarDias: entero(v.recuperarDias, 0, 365, 60),
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

/* ----------------------------------------------------- automatizaciones de sala, cocina y clientes */

const esTerraza = (m) => /terraza|exterior|fuera/i.test(String((m || {}).zona || ''))

/**
 * Probabilidad máxima de lluvia por fecha y turno a partir de la respuesta horaria de Open-Meteo
 * (hourly.time y hourly.precipitation_probability), mirando las horas que dura cada turno.
 */
function lluviaPorTurno(meteo) {
  const h = (meteo && meteo.hourly) || {}
  const t = h.time || []
  const p = h.precipitation_probability || []
  const res = {}
  for (const turno of ['comida', 'cena']) {
    const horas = CFG.horas[turno] || []
    if (!horas.length) continue
    const ini = minutos(horas[0])
    const fin = minutos(horas[horas.length - 1]) + (CFG.duracion[turno] || 90)
    for (let i = 0; i < t.length; i++) {
      const fecha = String(t[i]).slice(0, 10)
      const m = minutos(String(t[i]).slice(11, 16))
      if (m + 60 <= ini || m >= fin) continue
      const k = fecha + ' ' + turno
      res[k] = Math.max(res[k] || 0, Number(p[i]) || 0)
    }
  }
  return res
}

/**
 * Pasa al interior las reservas de terraza de un turno. Devuelve, para cada reserva,
 * la mesa nueva o null si no queda sitio dentro (entonces se avisa al restaurante).
 */
function moverTerraza(fecha, turno, reservas) {
  const terraza = new Set(MESAS.filter(esTerraza).map((m) => m.id))
  const afectadas = reservas
    .filter((r) => r.fecha === fecha && r.turno === turno && OCUPAN.includes(r.estado) && terraza.has(r.mesa))
    .sort((a, b) => b.personas - a.personas)
  const trabajo = reservas.map((r) => ({ ...r }))
  const cambios = []
  for (const r of afectadas) {
    const yo = trabajo.find((x) => x.token === r.token)
    const estados = estadoMesas(fecha, r.hora, Number(r.personas), trabajo, { ignorar: r.token }).filter((m) => !terraza.has(m.id))
    const mesa = mejorMesa(estados)
    if (mesa) yo.mesa = mesa.id
    cambios.push({ token: r.token, nombre: r.nombre, email: r.email, hora: r.hora, personas: Number(r.personas), codigo: r.codigo, fecha, antes: r.mesa, mesa: mesa ? mesa.id : null })
  }
  return cambios
}

function emailCambioTerraza(c, prob) {
  return emailHtml({
    titulo: 'Te pasamos dentro',
    intro: 'Hola ' + esc(String(c.nombre).split(' ')[0]) + ', la previsión da un ' + prob + ' % de lluvia para tu reserva, así que te hemos guardado una mesa en el salón. No tienes que hacer nada.',
    filas: [['Fecha', fechaLarga(c.fecha)], ['Hora', c.hora], ['Personas', String(c.personas)], ['Mesa nueva', nombreMesa(c.mesa) + ' · ' + ((MESAS.find((m) => m.id === c.mesa) || {}).zona || '')]],
  })
}

/** Cliente: visitas, ausencias y última visita, a partir del historial de reservas. */
function historialClientes(reservas) {
  const h = {}
  for (const r of reservas) {
    if (!r.telefono) continue
    const c = (h[r.telefono] = h[r.telefono] || { telefono: r.telefono, nombre: r.nombre, email: r.email, visitas: 0, noShows: 0, ultima: '', reciente: '' })
    if (r.estado === 'llegada') {
      c.visitas++
      if (r.fecha > c.ultima) c.ultima = r.fecha
    }
    if (r.estado === 'no_show') c.noShows++
    if (r.email) c.email = r.email
    if (r.fecha >= c.reciente) {
      c.nombre = r.nombre
      c.reciente = r.fecha
    }
  }
  return h
}

const CELEBRACION = /cumple|aniversari|celebra|pedida|despedida|sorpresa|vela/i

/** Hoja de cocina de un turno: comensales por hora, alergias por mesa y celebraciones. */
function hojaCocina(fecha, turno, reservas) {
  const rs = reservas
    .filter((r) => r.fecha === fecha && r.turno === turno && OCUPAN.includes(r.estado))
    .sort((a, b) => a.hora.localeCompare(b.hora))
  const porHora = {}
  for (const r of rs) porHora[r.hora] = (porHora[r.hora] || 0) + Number(r.personas)
  const notas = rs.filter((r) => r.notas)
  const alergias = notas.filter((r) => !CELEBRACION.test(r.notas))
  const fiestas = notas.filter((r) => CELEBRACION.test(r.notas))
  const fila = (r) =>
    '<tr><td style="padding:6px 8px;font-weight:700">' + esc(r.hora) + '</td><td style="padding:6px 8px">Mesa ' + esc(nombreMesa(r.mesa) || '—') + '</td><td style="padding:6px 8px">' +
    esc(r.nombre) + ' · ' + r.personas + ' pax</td><td style="padding:6px 8px;color:#b4532a;font-weight:600">' + esc(r.notas) + '</td></tr>'
  const tabla = (lista) => '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;margin-top:6px">' + lista.map(fila).join('') + '</table>'
  const ritmo = Object.entries(porHora).map(([h, n]) => esc(h) + ': <b>' + n + '</b>').join(' · ')
  const comensales = rs.reduce((s, r) => s + Number(r.personas), 0)
  return {
    comensales,
    mesas: rs.length,
    alergias: alergias.length,
    celebraciones: fiestas.length,
    html: emailHtml({
      titulo: 'Hoja de cocina · ' + (turno === 'cena' ? 'cena' : 'comida'),
      intro: '<b>' + comensales + ' comensales</b> en ' + rs.length + ' mesas el ' + esc(fechaLarga(fecha)) + '.<br>Llegadas: ' + (ritmo || 'ninguna') +
        (alergias.length ? '<br><br><b>⚠ Alergias e indicaciones</b>' + tabla(alergias) : '<br><br>Sin alergias anotadas.') +
        (fiestas.length ? '<br><br><b>🎂 Celebraciones</b>' + tabla(fiestas) : ''),
    }),
  }
}

/** Clientes que vinieron al menos dos veces y llevan más de N días sin volver ni tener reserva. */
function clientesARecuperar(reservas, avisados, dias) {
  if (!dias) return []
  const limite = hoy(-dias)
  const futuras = new Set(reservas.filter((r) => r.fecha >= hoy() && OCUPAN.includes(r.estado)).map((r) => r.telefono))
  return Object.values(historialClientes(reservas)).filter(
    (c) => c.email && c.visitas >= 2 && c.ultima && c.ultima < limite && !futuras.has(c.telefono) && !((avisados || {})[c.telefono] >= limite),
  )
}

function emailRecuperar(c) {
  return emailHtml({
    titulo: 'Te echamos de menos',
    intro: 'Hola ' + esc(String(c.nombre).split(' ')[0]) + ', hace tiempo que no te vemos por ' + esc(CFG.nombre) + '. Hay platos nuevos de temporada en la carta y nos encantaría volver a verte. ¿Te guardamos mesa?',
    botones: [{ texto: 'Reservar mesa', url: SECRETOS.url + '/reservar' }, { texto: 'Ver la carta', url: SECRETOS.url + '/carta', secundario: true }],
    pie: 'Si no quieres recibir más avisos como este, responde a este email.',
  })
}

/* ----------------------------------------------------- piezas de los flujos (también las usa la demo del navegador) */

const urlMapa = () => (CFG.direccion ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(CFG.nombre + ' ' + CFG.direccion) : '')

/** Respuesta y email de una reserva recién creada. */
function confirmacionReserva(r) {
  const mapa = urlMapa()
  return {
    body: { ok: true, codigo: r.codigo, fecha: r.fecha, fechaTexto: fechaLarga(r.fecha), hora: r.hora, personas: r.personas, nombre: r.nombre, email: r.email, mesa: nombreMesa(r.mesa), zona: (MESAS.find((m) => m.id === r.mesa) || {}).zona || '', gestionar: enlace(r.token) },
    para: r.email,
    asunto: 'Reserva confirmada · ' + fechaLarga(r.fecha) + ' a las ' + r.hora,
    html: emailHtml({
      titulo: '¡Reserva confirmada!',
      intro: 'Hola ' + esc(r.nombre.split(' ')[0]) + ', te esperamos. Si no puedes venir, cancélala con el botón para que otra persona aproveche la mesa.',
      filas: datosReserva(r),
      botones: [{ texto: 'Ver o cancelar', url: enlace(r.token) }].concat(mapa ? [{ texto: 'Cómo llegar', url: mapa, secundario: true }] : []),
    }),
  }
}

function avisoListaEspera(e) {
  return {
    body: { ok: true, fechaTexto: fechaLarga(e.fecha), email: e.email },
    para: e.email,
    asunto: 'Estás en la lista de espera · ' + fechaLarga(e.fecha),
    html: emailHtml({
      titulo: 'Estás en la lista de espera',
      intro: 'Si se libera una mesa para ' + e.personas + ' el ' + esc(fechaLarga(e.fecha)) + ' en el turno de ' + e.turno + ', <b>te la reservaremos automáticamente</b> y te avisaremos por aquí. No tienes que hacer nada más.',
    }),
  }
}

/**
 * Lista de espera: por orden de llegada, busca su hora preferida o la más cercana del mismo turno
 * con mesa libre. Devuelve las reservas nuevas (ref = id de la fila de espera).
 */
function asignarListaEspera(espera, reservas) {
  const lista = espera.filter((e) => e.estado === 'esperando' && e.fecha >= hoy()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  const nuevas = []
  for (const e of lista) {
    if (reservas.some((r) => r.fecha === e.fecha && r.telefono === e.telefono && OCUPAN.includes(r.estado))) continue
    const disp = disponibilidad(e.fecha, reservas, e.personas)
    if (!disp.ok || disp.cerrado) continue
    const opciones = disp.horas
      .filter((h) => h.disponible && h.turno === e.turno)
      .sort((a, b) => Math.abs(minutos(a.hora) - minutos(e.hora)) - Math.abs(minutos(b.hora) - minutos(e.hora)))
    let elegida = null
    for (const h of opciones) {
      const mesa = mejorMesa(estadoMesas(e.fecha, h.hora, e.personas, reservas))
      if (mesa) {
        elegida = { hora: h.hora, mesa: mesa.id }
        break
      }
    }
    if (!elegida) continue
    const nueva = {
      codigo: nuevoCodigo(), token: nuevoToken(), nombre: e.nombre, email: e.email, telefono: e.telefono,
      fecha: e.fecha, hora: elegida.hora, turno: turnoDe(elegida.hora), personas: e.personas, notas: e.notas, mesa: elegida.mesa,
      origen: 'espera', estado: 'confirmada', asistencia: '', recordatorio: false, resena: false, ref: String(e.id),
    }
    reservas.push(nueva) // el siguiente de la lista ya ve la mesa ocupada
    nuevas.push(nueva)
  }
  return nuevas
}

function avisoMesaLiberada(r) {
  return {
    para: r.email,
    asunto: '¡Tienes mesa! ' + fechaLarga(r.fecha) + ' a las ' + r.hora,
    html: emailHtml({
      titulo: '¡Se ha liberado una mesa para ti!',
      intro: 'Hola ' + esc(r.nombre.split(' ')[0]) + ', estabas en nuestra lista de espera y <b>ya tienes la reserva hecha</b>. Si al final no te viene bien, cancélala con el botón.',
      filas: datosReserva(r),
      botones: [{ texto: 'Ver o cancelar', url: enlace(r.token) }],
    }),
  }
}

function recordatorio(r) {
  return {
    token: r.token,
    para: r.email,
    asunto: 'Mañana te esperamos a las ' + r.hora + ' · ' + CFG.nombre,
    html: emailHtml({
      titulo: 'Te esperamos mañana',
      intro: 'Hola ' + esc(r.nombre.split(' ')[0]) + ', te recordamos tu reserva. ¿Nos confirmas que venís? Si no podéis, cancélala y daremos la mesa a quien está en lista de espera.',
      filas: datosReserva(r),
      botones: [{ texto: 'Sí, allí estaremos', url: enlace(r.token) + '&accion=confirmar' }, { texto: 'No podemos ir', url: enlace(r.token) + '&accion=cancelar', secundario: true }],
    }),
  }
}

function peticionResena(r) {
  return {
    token: r.token,
    para: r.email,
    asunto: '¿Qué tal ayer en ' + CFG.nombre + '?',
    html: emailHtml({
      titulo: 'Gracias por venir',
      intro: 'Hola ' + esc(r.nombre.split(' ')[0]) + ', esperamos que disfrutarais. Tu opinión nos ayuda muchísimo a que más gente nos conozca. ¿Nos dejas una reseña? Es un minuto.',
      botones: [{ texto: '★★★★★ Dejar reseña en Google', url: CFG.resena }],
      pie: 'Si algo no estuvo a la altura, responde a este email: lo leemos personalmente.',
    }),
  }
}

/** Informe de la mañana para el dueño: reservas de hoy y balance de ayer. */
function informeDiario(hoyR, ayer) {
  const act = hoyR.filter((r) => OCUPAN.includes(r.estado)).sort((a, b) => a.hora.localeCompare(b.hora))
  const plazas = mesasActivas().reduce((s, m) => s + Number(m.plazas), 0)
  const pax = (t) => act.filter((r) => r.turno === t).reduce((s, r) => s + Number(r.personas), 0)
  const cuenta = (e) => ayer.filter((r) => r.estado === e).length
  const tabla = act.length
    ? '<table width="100%" style="border-collapse:collapse;font-size:14px">' + act.map((r) => '<tr><td style="padding:6px 0;border-bottom:1px solid #eee;width:56px"><b>' + r.hora + '</b></td><td style="padding:6px 0;border-bottom:1px solid #eee">' + esc(r.nombre) + ' · mesa ' + esc(nombreMesa(r.mesa)) + (r.asistencia === 'confirmada' ? ' ✓' : '') + (r.notas ? '<br><span style="color:#b45309">⚠ ' + esc(r.notas) + '</span>' : '') + '</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right"><b>' + r.personas + '</b> pax</td></tr>').join('') + '</table>'
    : '<p>Hoy no hay reservas.</p>'
  const conNotas = act.filter((r) => r.notas).length
  return {
    asunto: 'Hoy: ' + act.length + ' reservas · ' + (pax('comida') + pax('cena')) + ' comensales · ' + CFG.nombre,
    html: emailHtml({
      titulo: 'Resumen de ' + fechaLarga(hoy()),
      intro: '<b>Comida:</b> ' + pax('comida') + ' comensales · <b>Cena:</b> ' + pax('cena') + ' comensales (' + plazas + ' plazas por turno)<br>' +
        act.filter((r) => r.asistencia === 'confirmada').length + ' han confirmado asistencia' + (conNotas ? ' · <b style="color:#b45309">' + conNotas + ' con alergias o notas</b>' : '') +
        '<br><br>' + tabla +
        '<br><b>Ayer:</b> ' + cuenta('llegada') + ' llegadas · ' + cuenta('no_show') + ' no se presentaron · ' + cuenta('cancelada') + ' cancelaciones',
      botones: [{ texto: 'Abrir la administración', url: SECRETOS.url + '/admin' }],
    }),
  }
}

/**
 * Valida y asigna mesa a una reserva nueva. «val» es la salida de validarReserva más interno y origen.
 * Devuelve { error: { status, body } } o { fila } lista para guardar.
 */
function asignarReserva(val, rs) {
  const no = (status, errores, extra = {}) => ({ error: { status, body: { ok: false, errores, ...extra } } })
  if (!val.ok) return no(400, val.errores)
  const d = val.datos
  const disp = disponibilidad(d.fecha, rs, d.personas, { ignorarAntelacion: val.interno })
  if (!disp.ok) return no(400, [disp.motivo])
  if (disp.cerrado) return no(409, [disp.motivo])
  const repetida = rs.find((r) => r.fecha === d.fecha && r.telefono === d.telefono && OCUPAN.includes(r.estado))
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
  return {
    fila: {
      codigo: nuevoCodigo(), token: nuevoToken(), nombre: d.nombre, email: d.email, telefono: d.telefono,
      fecha: d.fecha, hora: d.hora, turno: turnoDe(d.hora), personas: d.personas, notas: d.notas, mesa: mesa.id,
      origen: val.origen, estado: 'confirmada', asistencia: '', recordatorio: false, resena: false, ref: '',
    },
  }
}

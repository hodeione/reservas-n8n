/* =====================================================================
 * Librería común de los flujos. El generador (scripts/build.mjs) la
 * antepone al código de cada nodo Code, así que aquí se puede usar lo
 * que ofrece n8n: $env, $now (luxon en Europe/Madrid) y DateTime.
 * ===================================================================== */

const CFG = (() => {
  const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)
  const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d)
  return {
    nombre: $env.REST_NOMBRE || 'Restaurante',
    telefono: $env.REST_TELEFONO || '',
    direccion: $env.REST_DIRECCION || '',
    remitente: $env.REST_EMAIL_REMITENTE || 'reservas@example.com',
    dueno: $env.REST_EMAIL_DUENO || '',
    aforo: { comida: num($env.REST_AFORO_COMIDA, 40), cena: num($env.REST_AFORO_CENA, 40) },
    franja: num($env.REST_ENTRADAS_FRANJA, 16),
    horas: { comida: list($env.REST_HORAS_COMIDA), cena: list($env.REST_HORAS_CENA) },
    cerrado: list($env.REST_DIAS_CERRADO).map(Number),
    maxPersonas: num($env.REST_MAX_PERSONAS, 10),
    antelacionMin: num($env.REST_ANTELACION_MIN, 60),
    diasMax: num($env.REST_DIAS_MAX, 60),
    resena: $env.REST_URL_RESENA || '',
    clavePanel: $env.REST_CLAVE_PANEL || '',
    claveAgente: $env.REST_CLAVE_AGENTE || '',
    url: String($env.WEBHOOK_URL || '').replace(/\/$/, ''),
  }
})()

/** Estados que ocupan sitio. */
const OCUPAN = ['confirmada', 'llegada']

const hoy = (dias = 0) => $now.plus({ days: dias }).toFormat('yyyy-MM-dd')

function turnoDe(hora) {
  if (CFG.horas.comida.includes(hora)) return 'comida'
  if (CFG.horas.cena.includes(hora)) return 'cena'
  return null
}

function fechaLarga(fecha) {
  const d = DateTime.fromISO(fecha, { zone: $now.zoneName })
  return d.isValid ? d.setLocale('es').toFormat("cccc d 'de' LLLL") : fecha
}

/** Filas reales de una Data Table (la consulta vacía devuelve un único item sin id). */
function filas(items) {
  return items.map((i) => i.json).filter((r) => r && r.id !== undefined)
}

/**
 * Disponibilidad de un día. Dos límites a la vez:
 *  - aforo del turno (comensales totales en comida o cena),
 *  - ritmo de entradas: comensales que pueden llegar en la misma franja de 30 min.
 * Las horas que ya han pasado (más la antelación mínima) no se ofrecen.
 */
function disponibilidad(fecha, reservas, personas = 2, { ignorarAntelacion = false } = {}) {
  const d = DateTime.fromISO(fecha, { zone: $now.zoneName })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !d.isValid) return { ok: false, motivo: 'Fecha no válida.' }
  if (d.startOf('day') < $now.startOf('day')) return { ok: false, motivo: 'Esa fecha ya ha pasado.' }
  if (d.startOf('day') > $now.plus({ days: CFG.diasMax }).startOf('day')) {
    return { ok: false, motivo: `Solo se puede reservar con hasta ${CFG.diasMax} días de antelación.` }
  }
  if (CFG.cerrado.includes(d.weekday)) return { ok: true, cerrado: true, motivo: `${CFG.nombre} cierra ese día.`, horas: [] }

  const activas = reservas.filter((r) => r.fecha === fecha && OCUPAN.includes(r.estado))
  const porTurno = { comida: 0, cena: 0 }
  const porHora = {}
  for (const r of activas) {
    const p = Number(r.personas) || 0
    if (porTurno[r.turno] !== undefined) porTurno[r.turno] += p
    porHora[r.hora] = (porHora[r.hora] || 0) + p
  }
  const limite = $now.plus({ minutes: ignorarAntelacion ? 0 : CFG.antelacionMin })
  const horas = []
  for (const turno of ['comida', 'cena']) {
    for (const hora of CFG.horas[turno]) {
      const [h, m] = hora.split(':').map(Number)
      const momento = d.set({ hour: h, minute: m, second: 0, millisecond: 0 })
      const libre = Math.max(0, Math.min(CFG.aforo[turno] - porTurno[turno], CFG.franja - (porHora[hora] || 0)))
      const pasada = momento < limite
      horas.push({ hora, turno, libre, disponible: !pasada && libre >= personas, pasada })
    }
  }
  return {
    ok: true,
    cerrado: false,
    fecha,
    fechaTexto: fechaLarga(fecha),
    horas,
    ocupacion: {
      comida: { comensales: porTurno.comida, aforo: CFG.aforo.comida },
      cena: { comensales: porTurno.cena, aforo: CFG.aforo.cena },
    },
  }
}

/** Horas alternativas cercanas (mismo día y días siguientes) para quien no encuentra sitio. */
function alternativas(disp, hora, personas) {
  if (!disp.ok || disp.cerrado) return []
  const [h, m] = (hora || '00:00').split(':').map(Number)
  const minutos = (x) => {
    const [a, b] = x.split(':').map(Number)
    return a * 60 + b
  }
  return disp.horas
    .filter((x) => x.disponible && x.libre >= personas)
    .sort((a, b) => Math.abs(minutos(a.hora) - (h * 60 + m)) - Math.abs(minutos(b.hora) - (h * 60 + m)))
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

/** Valida y normaliza los datos de una reserva. */
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
  }
  if (datos.nombre.length < 2) errores.push('Indica tu nombre.')
  if (!datos.telefono) errores.push('Indica un teléfono válido.')
  if (datos.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.email)) errores.push('El email no es válido.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) errores.push('Elige una fecha.')
  if (!turnoDe(datos.hora)) errores.push('Elige una hora.')
  if (!(datos.personas >= 1)) errores.push('Indica el número de personas.')
  else if (datos.personas > CFG.maxPersonas) {
    errores.push(`Para grupos de más de ${CFG.maxPersonas} personas llámanos${CFG.telefono ? ' al ' + CFG.telefono : ''}.`)
  }
  return { ok: errores.length === 0, errores, datos }
}

const crypto = require('crypto')
const nuevoToken = () => crypto.randomBytes(18).toString('base64url')
/** Código corto para decirlo por teléfono: sin 0/O ni 1/I. */
function nuevoCodigo() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (const b of crypto.randomBytes(6)) s += abc[b % abc.length]
  return s
}

const enlace = (token) => `${CFG.url}/webhook/reserva?t=${encodeURIComponent(token)}`
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/* ----------------------------------------------------------- plantillas */

function emailHtml({ titulo, intro, filas: datos = [], botones = [], pie = '' }) {
  const rows = datos
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;width:120px">${esc(k)}</td><td style="padding:6px 0;font-size:15px;color:#111827;font-weight:600">${esc(v)}</td></tr>`)
    .join('')
  const btns = botones
    .map(
      (b) =>
        `<a href="${esc(b.url)}" style="display:inline-block;margin:6px 8px 0 0;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;${
          b.secundario ? 'background:#f3f4f6;color:#111827' : 'background:#111827;color:#ffffff'
        }">${esc(b.texto)}</a>`,
    )
    .join('')
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af">${esc(CFG.nombre)}</td></tr>
<tr><td style="padding-top:8px;font-size:24px;font-weight:700;color:#111827">${esc(titulo)}</td></tr>
<tr><td style="padding-top:10px;font-size:15px;line-height:1.55;color:#374151">${intro}</td></tr>
${rows ? `<tr><td style="padding-top:16px"><table role="presentation" width="100%" style="border-top:1px solid #eee;border-bottom:1px solid #eee;padding:8px 0">${rows}</table></td></tr>` : ''}
${btns ? `<tr><td style="padding-top:18px">${btns}</td></tr>` : ''}
<tr><td style="padding-top:22px;font-size:13px;line-height:1.5;color:#9ca3af">${pie || [CFG.direccion, CFG.telefono].filter(Boolean).map(esc).join(' · ')}</td></tr>
</table></td></tr></table></body></html>`
}

function datosReserva(r) {
  return [
    ['Fecha', fechaLarga(r.fecha)],
    ['Hora', r.hora],
    ['Personas', String(r.personas)],
    ['Nombre', r.nombre],
    ['Código', r.codigo],
  ].concat(r.notas ? [['Notas', r.notas]] : [])
}

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f5f3ef;color:#1c1917}
.wrap{max-width:560px;margin:0 auto;padding:28px 16px 48px}.card{background:#fff;border-radius:20px;padding:24px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 30px rgba(0,0,0,.05)}
h1{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}.muted{color:#78716c}.brand{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a8a29e;margin-bottom:6px}
.btn{display:inline-block;border:0;border-radius:12px;padding:13px 20px;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center}
.btn-primary{background:#1c1917;color:#fff}.btn-ghost{background:#f5f5f4;color:#1c1917}.btn-danger{background:#fee2e2;color:#991b1b}
dl{display:grid;grid-template-columns:110px 1fr;gap:8px 12px;margin:18px 0;padding:16px 0;border-top:1px solid #eee;border-bottom:1px solid #eee}dt{color:#78716c}dd{margin:0;font-weight:600}
.ok{color:#15803d}.bad{color:#b91c1c}`

function pagina(titulo, cuerpo) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(titulo)} · ${esc(CFG.nombre)}</title><style>${CSS}</style></head><body><div class="wrap"><div class="brand">${esc(CFG.nombre)}</div>${cuerpo}</div></body></html>`
}

function respuesta(status, body) {
  return [{ json: { status, body } }]
}

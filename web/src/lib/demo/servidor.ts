/**
 * Servidor de la demo pública: los mismos flujos que n8n, ejecutados en el navegador.
 *
 * Usa la librería real del backend (src/lib.js) tal cual, con el reloj de Madrid, y guarda
 * reservas, lista de espera, emails y el registro de automatizaciones en el navegador del visitante.
 * Así cualquiera puede probar la web del cliente, el panel del restaurante y las automatizaciones
 * sin servidor, y lo que ve es exactamente la lógica que corre en producción.
 */
import { DateTime } from 'luxon'
import codigoLib from '../../../../src/lib.js?raw'
import demo from '../../../../src/demo.json'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fila = Record<string, any>

const CLAVE_PANEL = 'demo'
const CLAVE_AGENTE = 'demo-agente'
const ALMACEN = 'taberna-luna-demo-v1'

/* ----------------------------------------------------------- la librería del backend, en el navegador */

const EXPORTA = [
  'cargar', 'hoy', 'minutos', 'turnoDe', 'fechaLarga', 'mesasActivas', 'nombreMesa', 'estadoMesas', 'mejorMesa', 'diaCerrado', 'disponibilidad', 'alternativas',
  'validarReserva', 'nuevoToken', 'nuevoCodigo', 'enlace', 'emailHtml', 'datosReserva', 'validarConfig', 'validarMesas', 'validarCarta', 'esFecha',
  'lluviaPorTurno', 'moverTerraza', 'emailCambioTerraza', 'historialClientes', 'hojaCocina', 'clientesARecuperar', 'emailRecuperar', 'confirmacionReserva',
  'avisoListaEspera', 'asignarListaEspera', 'avisoMesaLiberada', 'recordatorio', 'peticionResena', 'informeDiario', 'asignarReserva', 'OCUPAN', 'MODELOS_3D', 'ALERGENOS', 'ETIQUETAS',
]

function crearLib() {
  const fuente = codigoLib
    .replace(/\$now/g, '__now()')
    .replace(/\$env/g, '__env')
    .replace(/\$\(/g, '__nodo(')
    .replace("require('crypto')", '__crypto')
  const env = {
    REST_NOMBRE: demo.config.nombre,
    REST_EMAIL_REMITENTE: 'reservas@tabernaluna.es',
    REST_CLAVE_PANEL: CLAVE_PANEL,
    REST_CLAVE_AGENTE: CLAVE_AGENTE,
    WEBHOOK_URL: location.origin,
  }
  const crypto = {
    randomBytes(n: number) {
      const b = globalThis.crypto.getRandomValues(new Uint8Array(n))
      return Object.assign(b, {
        toString: () => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      })
    },
  }
  let filasContenido: Fila[] = []
  const nodo = () => ({ all: () => filasContenido.map((json) => ({ json })) })
  const fabrica = new Function('__now', '__env', '__nodo', '__crypto', 'DateTime', `${fuente}\nreturn { ${EXPORTA.join(', ')}, get CFG() { return CFG }, get MESAS() { return MESAS }, get CARTA() { return CARTA } }`)
  const L = fabrica(() => DateTime.now().setZone('Europe/Madrid'), env, nodo, crypto, DateTime)
  return {
    L,
    /** Carga config, mesas y carta en la librería, como hace cada nodo de n8n con cargar(). */
    usar(contenido: Record<string, unknown>) {
      filasContenido = Object.entries(contenido).map(([clave, valor]) => ({ clave, valor: JSON.stringify(valor) }))
      L.cargar('Contenido')
    },
  }
}
const { L, usar } = crearLib()
const ahora = () => DateTime.now().setZone('Europe/Madrid')

/* ----------------------------------------------------------- estado */

export interface Email {
  id: string
  para: string
  asunto: string
  html: string
  fecha: string
  flujo: string
}
export interface Registro {
  id: string
  flujo: string
  cuando: string
  resumen: string
  emails: number
  manual: boolean
}
interface Estado {
  v: 1
  dia: string
  contenido: { config: Fila; mesas: Fila[]; carta: Fila }
  reservas: Fila[]
  espera: Fila[]
  emails: Email[]
  registro: Registro[]
  avisados: Record<string, string>
  sec: number
}

let cache: Estado | null = null
function leer(): Estado {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(ALMACEN)
    if (raw) {
      const e = JSON.parse(raw) as Estado
      // La demo se renueva cada día para que siempre haya reservas «de hoy».
      if (e.v === 1 && e.dia === ahora().toISODate()) return (cache = e)
    }
  } catch {
    /* sin almacenamiento: demo en memoria */
  }
  return (cache = sembrar())
}
function guardar(e: Estado) {
  cache = e
  try {
    localStorage.setItem(ALMACEN, JSON.stringify(e))
  } catch {
    /* sin almacenamiento */
  }
}
const sello = () => ahora().toISO()!

function enviar(e: Estado, flujo: string, correos: { para?: string; asunto: string; html: string }[]) {
  let n = 0
  for (const c of correos) {
    if (!c.para) continue
    e.emails.unshift({ id: 'm' + ++e.sec, para: c.para, asunto: c.asunto, html: c.html, fecha: sello(), flujo })
    n++
  }
  e.emails = e.emails.slice(0, 150)
  return n
}
function anotar(e: Estado, flujo: string, resumen: string, emails: number, manual = false) {
  e.registro.unshift({ id: 'r' + ++e.sec, flujo, cuando: sello(), resumen, emails, manual })
  e.registro = e.registro.slice(0, 200)
}

/* ----------------------------------------------------------- datos de ejemplo */

function azar(semilla: number) {
  return () => {
    semilla |= 0
    semilla = (semilla + 0x6d2b79f5) | 0
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOMBRES = [
  'Ane Etxeberria', 'Jon Aguirre', 'Maite Ruiz', 'Iker Goikoetxea', 'Leire Alonso', 'Unai Zubizarreta', 'Nerea Lasa', 'Mikel Arrieta', 'Amaia Ortiz', 'Gorka Bilbao',
  'Lucía Fernández', 'Pablo Martín', 'Elena Sanz', 'Javier Romero', 'Carmen Díaz', 'Álvaro Gil', 'Sara Moreno', 'Daniel Navarro', 'Irati Urkiza', 'Asier Mendizabal',
  'Paula Iglesias', 'Diego Torres', 'Laura Castro', 'Hugo Prieto', 'Marta Vidal', 'Óscar Herrero', 'Irene Molina', 'Adrián Peña', 'Claudia Ramos', 'Sergio León',
]
const NOTAS = ['', '', '', '', '', '', '', '', '', 'Celíaco', 'Alergia al marisco', 'Alergia a los frutos secos', 'Cumpleaños, traemos tarta', 'Trona para un bebé', 'Aniversario de boda', 'Intolerancia a la lactosa', 'Vegetariana', 'Mesa tranquila si puede ser', 'Celebramos una jubilación']

function sembrar(): Estado {
  const hoyIso = ahora().toISODate()!
  const r = azar(Number(hoyIso.replace(/-/g, '')))
  const elegir = <T,>(l: T[]) => l[Math.floor(r() * l.length)]
  const contenido = structuredClone({
    config: { ...demo.config, emailDueno: 'dueno@tabernaluna.es', emailCocina: 'cocina@tabernaluna.es', resena: 'https://g.page/r/taberna-luna/review', lluviaUmbral: 60, recuperarDias: 60 },
    mesas: demo.mesas,
    carta: demo.carta,
  }) as Estado['contenido']
  usar(contenido)
  const e: Estado = { v: 1, dia: hoyIso, contenido, reservas: [], espera: [], emails: [], registro: [], avisados: {}, sec: 0 }
  const telefono = (i: number) => '+346' + String(10000000 + i * 7919).slice(0, 8)
  const correo = (nombre: string) => nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.') + '@ejemplo.com'
  const fila = (o: Fila): Fila => ({ codigo: L.nuevoCodigo(), token: L.nuevoToken(), email: '', notas: '', origen: 'web', estado: 'confirmada', asistencia: '', recordatorio: false, resena: false, ref: '', createdAt: sello(), ...o })

  // Historial: clientes habituales, uno que no vuelve desde hace meses y otro con dos ausencias.
  const habituales = [0, 1, 2, 3, 4, 5]
  for (const i of habituales) {
    const visitas = 2 + (i % 3)
    const ultima = i === 2 ? 95 : i === 4 ? 70 : 5 + i * 6
    for (let v = 0; v < visitas; v++) {
      const fecha = ahora().minus({ days: ultima + v * 21 }).toISODate()!
      e.reservas.push(fila({ nombre: NOMBRES[i], telefono: telefono(i), email: correo(NOMBRES[i]), fecha, hora: '21:00', turno: 'cena', personas: 2 + (v % 3), mesa: 's3', estado: 'llegada', recordatorio: true, resena: true }))
    }
  }
  for (const dias of [40, 18]) e.reservas.push(fila({ nombre: NOMBRES[9], telefono: telefono(9), fecha: ahora().minus({ days: dias }).toISODate(), hora: '14:00', turno: 'comida', personas: 4, mesa: 's6', estado: 'no_show', recordatorio: true, resena: true }))

  // Ayer y los próximos seis días, con más gente el fin de semana.
  let n = 10
  for (let k = -1; k <= 6; k++) {
    const d = ahora().plus({ days: k })
    const fecha = d.toISODate()!
    if (L.diaCerrado(d)) continue
    const finde = d.weekday >= 5
    for (const turno of ['comida', 'cena']) {
      for (const hora of L.CFG.horas[turno]) {
        const intentos = Math.round((finde ? 1.9 : 1.1) * (turno === 'cena' ? 1.15 : 1) * (0.5 + r() * 0.8))
        for (let j = 0; j < intentos; j++) {
          const habitual = k >= 0 && r() < 0.18
          const i = habitual ? elegir([0, 1, 3, 5, 9]) : n++
          const nombre = NOMBRES[i % NOMBRES.length]
          const personas = elegir([2, 2, 2, 2, 3, 4, 4, 5, 6])
          const ocupadas = e.reservas.filter((x) => x.fecha === fecha)
          if (ocupadas.some((x) => x.telefono === telefono(i))) continue
          // Mañana, algunas parejas eligen la terraza (para ver el aviso de lluvia).
          const preferida = k === 1 && personas <= 4 && r() < 0.5 ? elegir(['t1', 't2', 't3', 't4']) : ''
          let mesa = L.mejorMesa(L.estadoMesas(fecha, hora, personas, ocupadas), preferida)
          if (!mesa && preferida) mesa = L.mejorMesa(L.estadoMesas(fecha, hora, personas, ocupadas))
          if (!mesa) continue
          const pasada = d.set({ hour: Number(hora.slice(0, 2)), minute: Number(hora.slice(3)) }) < ahora()
          e.reservas.push(
            fila({
              nombre, telefono: telefono(i), email: r() < 0.85 ? correo(nombre) : '', fecha, hora, turno, personas, mesa: mesa.id,
              notas: elegir(NOTAS), origen: elegir(['web', 'web', 'web', 'web', 'telefono', 'ia', 'local']),
              estado: pasada ? (r() < 0.92 ? 'llegada' : 'no_show') : 'confirmada',
              asistencia: !pasada && k <= 1 && r() < 0.4 ? 'confirmada' : '',
              recordatorio: k <= 0, resena: k < 0,
            }),
          )
        }
      }
    }
  }
  // Alguien esperando mesa para mañana.
  const manana = ahora().plus({ days: 1 })
  if (!L.diaCerrado(manana)) {
    e.espera.push({ id: 1, token: L.nuevoToken(), nombre: 'Irati Urkiza', email: 'irati.urkiza@ejemplo.com', telefono: '+34655443322', fecha: manana.toISODate(), hora: '21:00', turno: 'cena', personas: 4, notas: '', estado: 'esperando', ref: '', createdAt: sello() })
  }
  // Lo que ya pasó esta mañana: el informe de las 9.
  const inf = L.informeDiario(e.reservas.filter((x) => x.fecha === hoyIso), e.reservas.filter((x) => x.fecha === ahora().minus({ days: 1 }).toISODate()))
  const ne = enviar(e, '07', [{ para: L.CFG.emailDueno, ...inf }])
  e.registro.unshift({ id: 'r' + ++e.sec, flujo: '07', cuando: ahora().set({ hour: 9, minute: 0, second: 4 }).toISO()!, resumen: inf.asunto, emails: ne, manual: false })
  return e
}

/* ----------------------------------------------------------- automatizaciones */

function listaEspera(e: Estado, manual = false) {
  const nuevas = L.asignarListaEspera(e.espera, e.reservas) as Fila[] // las añade a e.reservas
  for (const r of nuevas) {
    r.createdAt = sello()
    const fe = e.espera.find((x) => String(x.id) === r.ref)
    if (fe) fe.estado = 'convertida'
  }
  const n = enviar(e, '05', nuevas.filter((r) => r.email).map((r) => L.avisoMesaLiberada(r)))
  if (nuevas.length || manual) anotar(e, '05', nuevas.length ? `${nuevas.length} ${nuevas.length === 1 ? 'mesa asignada' : 'mesas asignadas'} a la lista de espera: ${nuevas.map((r) => r.nombre).join(', ')}` : 'Nadie en espera puede entrar todavía', n, manual)
  return nuevas.length
}

async function ejecutar(e: Estado, flujo: string, b: Fila) {
  const hoyIso = L.hoy()
  const ayer = L.hoy(-1)
  if (flujo === '03') {
    const lista = e.reservas.filter((r) => r.fecha === L.hoy(1) && r.estado === 'confirmada' && !r.recordatorio && r.email)
    const n = enviar(e, '03', lista.map((r) => L.recordatorio(r)))
    lista.forEach((r) => (r.recordatorio = true))
    anotar(e, '03', lista.length ? `${lista.length} recordatorios enviados para mañana` : 'No quedan recordatorios pendientes para mañana', n, true)
  } else if (flujo === '04') {
    const lista = e.reservas.filter((r) => r.fecha === ayer && ['llegada', 'confirmada'].includes(r.estado) && r.email && !r.resena)
    const n = enviar(e, '04', lista.map((r) => L.peticionResena(r)))
    lista.forEach((r) => (r.resena = true))
    anotar(e, '04', lista.length ? `${lista.length} peticiones de reseña a quienes vinieron ayer` : 'Ya se pidió reseña a todos los de ayer', n, true)
  } else if (flujo === '05') {
    listaEspera(e, true)
  } else if (flujo === '07') {
    const inf = L.informeDiario(e.reservas.filter((r) => r.fecha === hoyIso), e.reservas.filter((r) => r.fecha === ayer))
    anotar(e, '07', inf.asunto, enviar(e, '07', [{ para: L.CFG.emailDueno, ...inf }]), true)
  } else if (flujo === '08') {
    let prob: Record<string, number> = {}
    let origen = 'previsión real de Open-Meteo'
    if (b.lluvia !== undefined) {
      origen = 'lluvia simulada'
      for (const f of [hoyIso, L.hoy(1)]) for (const t of ['comida', 'cena']) prob[f + ' ' + t] = Number(b.lluvia)
    } else {
      try {
        const c = L.CFG
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&hourly=precipitation_probability&timezone=Europe%2FMadrid&forecast_days=2`)
        prob = L.lluviaPorTurno(await res.json())
      } catch {
        anotar(e, '08', 'No se pudo consultar el tiempo: no se ha movido ninguna reserva', 0, true)
        return
      }
    }
    const movidas: Fila[] = []
    const sinSitio: Fila[] = []
    let maxProb = 0
    for (const fecha of [hoyIso, L.hoy(1)]) {
      for (const turno of ['comida', 'cena']) {
        const p = prob[fecha + ' ' + turno] || 0
        maxProb = Math.max(maxProb, p)
        if (!L.CFG.lluviaUmbral || p < L.CFG.lluviaUmbral) continue
        for (const c of L.moverTerraza(fecha, turno, e.reservas)) {
          if (!c.mesa) {
            sinSitio.push(c)
            continue
          }
          const r = e.reservas.find((x) => x.token === c.token)!
          r.mesa = c.mesa
          movidas.push({ ...r, prob: p })
        }
      }
    }
    let n = enviar(e, '08', movidas.filter((r) => r.email).map((r) => ({ para: r.email, asunto: 'Por la lluvia, te pasamos al salón · ' + L.CFG.nombre, html: L.emailCambioTerraza(r, r.prob) })))
    if (movidas.length || sinSitio.length) {
      n += enviar(e, '08', [{
        para: L.CFG.emailDueno,
        asunto: `Terraza cerrada por lluvia: ${movidas.length} reservas movidas${sinSitio.length ? `, ${sinSitio.length} sin sitio` : ''}`,
        html: L.emailHtml({ titulo: 'Previsión de lluvia: terraza recogida', intro: `${movidas.length} reservas de terraza han pasado al salón y ya están avisadas.${sinSitio.length ? '<br><br><b style="color:#b4532a">Sin sitio dentro (llámalas):</b><br>' + sinSitio.map((c) => `${c.hora} · ${c.nombre} (${c.personas} pax)`).join('<br>') : ''}`, botones: [{ texto: 'Ver la sala', url: location.origin + '/admin' }] }),
      }])
    }
    anotar(e, '08', movidas.length || sinSitio.length ? `Lluvia del ${maxProb} % (${origen}): ${movidas.length} reservas de terraza pasadas al salón${sinSitio.length ? `, ${sinSitio.length} sin sitio` : ''}` : `Probabilidad máxima de lluvia ${maxProb} % (${origen}): la terraza sigue abierta`, n, true)
  } else if (flujo === '09') {
    const turno = ['comida', 'cena'].includes(b.turno) ? b.turno : ahora().hour < 17 ? 'comida' : 'cena'
    const h = L.hojaCocina(hoyIso, turno, e.reservas)
    const n = h.mesas ? enviar(e, '09', [{ para: L.CFG.emailCocina || L.CFG.emailDueno, asunto: `Cocina ${turno}: ${h.comensales} comensales${h.alergias ? ` · ${h.alergias} con alergias` : ''}${h.celebraciones ? ` · ${h.celebraciones} celebraciones` : ''}`, html: h.html }]) : 0
    anotar(e, '09', h.mesas ? `Hoja de ${turno}: ${h.comensales} comensales, ${h.alergias} con alergias, ${h.celebraciones} celebraciones` : `Hoy no hay reservas para la ${turno}`, n, true)
  } else if (flujo === '10') {
    const lista = L.clientesARecuperar(e.reservas, e.avisados, L.CFG.recuperarDias) as Fila[]
    const n = enviar(e, '10', lista.map((c) => ({ para: c.email, asunto: 'Te echamos de menos en ' + L.CFG.nombre, html: L.emailRecuperar(c) })))
    lista.forEach((c) => (e.avisados[c.telefono] = hoyIso))
    anotar(e, '10', lista.length ? `${lista.length} clientes habituales invitados a volver: ${lista.map((c) => c.nombre).join(', ')}` : 'Ningún cliente habitual pendiente de invitar', n, true)
  } else throw new ErrorDemo(400, { ok: false, error: 'Flujo desconocido.' })
}

/* ----------------------------------------------------------- rutas */

export class ErrorDemo extends Error {
  status: number
  data: Fila
  constructor(status: number, data: Fila) {
    super(String(data.error || (data.errores as string[] | undefined)?.join(' ') || 'Error'))
    this.status = status
    this.data = data
  }
}

const datosAdmin = (e: Estado, fecha: string) => {
  const reservas = e.reservas
    .filter((r) => r.fecha === fecha)
    .map(({ token, codigo, nombre, telefono, email, hora, turno, personas, notas, mesa, estado, asistencia, origen }) => ({ token, codigo, nombre, telefono, email, hora, turno, personas, notas, mesa, estado, asistencia, origen }))
  const h = L.historialClientes(e.reservas.filter((r) => r.fecha < fecha))
  const clientes: Fila = {}
  for (const r of reservas) if (h[r.telefono]) clientes[r.telefono] = { visitas: h[r.telefono].visitas, noShows: h[r.telefono].noShows, ultima: h[r.telefono].ultima }
  return {
    ok: true, fecha, hoy: L.hoy(), fechaTexto: L.fechaLarga(fecha), cerrado: L.diaCerrado(DateTime.fromISO(fecha, { zone: 'Europe/Madrid' })),
    config: L.CFG, mesas: L.MESAS, carta: L.CARTA, reservas,
    espera: e.espera.filter((x) => x.estado === 'esperando' && x.fecha >= L.hoy()).map(({ nombre, telefono, fecha: f, hora, personas }) => ({ nombre, telefono, fecha: f, hora, personas })),
    opciones: { modelos: L.MODELOS_3D, alergenos: L.ALERGENOS, etiquetas: L.ETIQUETAS },
    clientes,
  }
}

export async function atender(ruta: string, init?: RequestInit & { clave?: string }): Promise<unknown> {
  const url = new URL(ruta, location.origin)
  const p = url.pathname
  const q = Object.fromEntries(url.searchParams)
  const metodo = init?.method ?? 'GET'
  const b: Fila = init?.body ? JSON.parse(String(init.body)) : {}
  const clave = init?.clave ?? b.clave ?? ''
  const admin = clave === CLAVE_PANEL
  const e = leer()
  usar(e.contenido)
  await new Promise((ok) => setTimeout(ok, 120 + Math.random() * 160)) // latencia realista

  const no = (status: number, data: Fila) => {
    throw new ErrorDemo(status, data)
  }
  const exigirAdmin = () => !admin && no(401, { ok: false, error: 'Clave incorrecta.' })

  if (p === '/api/web' && metodo === 'GET') {
    const { emailDueno: _a, emailCocina: _b, resena: _c, ...publico } = L.CFG
    void _a, void _b, void _c
    return {
      restaurante: publico, hoy: L.hoy(),
      carta: { categorias: L.CARTA.categorias, platos: L.CARTA.platos.filter((x: Fila) => x.disponible) },
      mesas: L.mesasActivas().map(({ id, nombre, zona, plazas, min, x, y, w, h, forma }: Fila) => ({ id, nombre, zona, plazas, min, x, y, w, h, forma })),
    }
  }
  if (p === '/api/disponibilidad') {
    const personas = Math.max(1, Math.floor(Number(q.personas) || 2))
    const d = L.disponibilidad(String(q.fecha || ''), e.reservas, personas)
    if (!d.ok) no(400, { error: d.motivo })
    if (d.cerrado) return { fecha: q.fecha, cerrado: true, motivo: d.motivo, horas: [] }
    return { fecha: d.fecha, fechaTexto: d.fechaTexto, personas, cerrado: false, horas: d.horas.map(({ hora, turno, disponible, pasada }: Fila) => ({ hora, turno, disponible, pasada })) }
  }
  if (p === '/api/mapa') {
    const personas = Math.max(1, Math.floor(Number(q.personas) || 2))
    const fecha = String(q.fecha || '')
    const hora = String(q.hora || '')
    if (!L.esFecha(fecha) || !L.turnoDe(hora)) no(400, { error: 'Fecha u hora no válidas.' })
    const disp = L.disponibilidad(fecha, e.reservas, personas)
    const franja = disp.ok && (disp.horas || []).find((h: Fila) => h.hora === hora)
    const estados = L.estadoMesas(fecha, hora, personas, e.reservas)
    const bloqueada = !franja || !franja.disponible
    return { fecha, hora, personas, mesas: estados.map((m: Fila) => ({ id: m.id, estado: bloqueada && m.estado === 'libre' ? 'ocupada' : m.estado })), recomendada: bloqueada ? null : (L.mejorMesa(estados) || {}).id || null }
  }
  if (p === '/api/reservas' && metodo === 'POST') {
    const interno = clave === CLAVE_PANEL || clave === CLAVE_AGENTE
    const v = L.validarReserva(b)
    if (b.web) (v.ok = false), v.errores.push('Solicitud no válida.')
    if (clave && !interno) (v.ok = false), v.errores.push('Clave no válida.')
    const origen = interno ? (['telefono', 'local', 'ia'].includes(b.origen) ? b.origen : 'telefono') : 'web'
    const r = L.asignarReserva({ ...v, interno, origen }, e.reservas)
    if (r.error) no(r.error.status, r.error.body)
    const fila = { ...r.fila, createdAt: sello() }
    e.reservas.push(fila)
    const c = L.confirmacionReserva(fila)
    const n = enviar(e, '01', [c])
    anotar(e, '01', `Reserva de ${fila.nombre} (${fila.personas} pax, ${fila.hora}) en la mesa ${L.nombreMesa(fila.mesa)}${n ? ' · confirmación enviada' : ''}`, n)
    guardar(e)
    return c.body
  }
  if (p === '/api/espera' && metodo === 'POST') {
    const v = L.validarReserva(b)
    if (b.web || !v.ok) no(400, { ok: false, errores: v.errores })
    const d = v.datos
    const fila = { id: e.espera.length + 1 + e.sec, token: L.nuevoToken(), nombre: d.nombre, email: d.email, telefono: d.telefono, fecha: d.fecha, hora: d.hora, turno: L.turnoDe(d.hora), personas: d.personas, notas: d.notas, estado: 'esperando', ref: '', createdAt: sello() }
    e.espera.push(fila)
    const c = L.avisoListaEspera(fila)
    anotar(e, '01', `${fila.nombre} entra en la lista de espera (${fila.personas} pax, ${fila.hora})`, enviar(e, '01', [c]))
    guardar(e)
    return c.body
  }
  if (p === '/api/admin/datos') {
    exigirAdmin()
    return datosAdmin(e, L.esFecha(q.fecha || '') ? q.fecha : L.hoy())
  }
  if (p === '/api/admin/guardar' && metodo === 'POST') {
    exigirAdmin()
    const val: Record<string, (v: unknown) => unknown> = { config: L.validarConfig, mesas: L.validarMesas, carta: L.validarCarta }
    if (!val[b.tipo]) no(400, { ok: false, error: 'Tipo no válido.' })
    let valor: unknown
    try {
      valor = val[b.tipo](b.valor)
    } catch (err) {
      no(400, { ok: false, error: (err as Error).message })
    }
    ;(e.contenido as Fila)[b.tipo] = valor
    guardar(e)
    return { ok: true, tipo: b.tipo, valor }
  }
  if (p === '/api/panel' && metodo === 'POST') {
    exigirAdmin()
    const r = e.reservas.find((x) => x.token === b.token)
    if (!r) no(404, { ok: false, error: 'Reserva no encontrada.' })
    if (b.mesa !== undefined) {
      const m = L.estadoMesas(r!.fecha, r!.hora, Number(r!.personas), e.reservas, { ignorar: r!.token }).find((x: Fila) => x.id === b.mesa)
      if (!m) no(400, { ok: false, error: 'Esa mesa no existe.' })
      if (m.estado === 'ocupada') no(409, { ok: false, error: 'La mesa ' + m.nombre + ' está ocupada a esa hora.' })
      r!.mesa = m.id
    } else {
      if (!['confirmada', 'llegada', 'no_show', 'cancelada'].includes(b.estado)) no(400, { ok: false, error: 'Estado no válido.' })
      r!.estado = b.estado
    }
    if (b.estado === 'cancelada' || b.estado === 'no_show') listaEspera(e)
    guardar(e)
    return { ok: true }
  }
  if (p === '/api/demo/bandeja') {
    return { emails: e.emails, registro: e.registro }
  }
  if (p === '/api/demo/ejecutar' && metodo === 'POST') {
    await ejecutar(e, String(b.flujo), b)
    guardar(e)
    return { ok: true, registro: e.registro[0] }
  }
  if (p === '/api/demo/reiniciar' && metodo === 'POST') {
    localStorage.removeItem(ALMACEN)
    cache = null
    guardar(sembrar())
    return { ok: true }
  }
  if (p === '/api/demo/reserva') {
    const r = e.reservas.find((x) => x.token === (q.t || b.t))
    if (!r) no(404, { ok: false, error: 'El enlace no es válido o ha caducado.' })
    let aviso = ''
    if (metodo === 'POST') {
      const activa = r!.estado === 'confirmada' && r!.fecha >= L.hoy()
      if (activa && b.accion === 'cancelar') {
        r!.estado = 'cancelada'
        aviso = 'Reserva cancelada. ¡Gracias por avisar!'
        anotar(e, '02', `${r!.nombre} cancela desde su enlace la reserva de las ${r!.hora}`, 0)
        listaEspera(e)
      } else if (activa && b.accion === 'confirmar') {
        r!.asistencia = 'confirmada'
        aviso = '¡Gracias por confirmar! Te esperamos.'
        anotar(e, '02', `${r!.nombre} confirma asistencia para las ${r!.hora}`, 0)
      }
      guardar(e)
    }
    return { ok: true, aviso, reserva: { ...r, fechaTexto: L.fechaLarga(r!.fecha), mesaNombre: L.nombreMesa(r!.mesa), zona: (L.MESAS.find((m: Fila) => m.id === r!.mesa) || {}).zona || '', activa: r!.estado === 'confirmada' && r!.fecha >= L.hoy() } }
  }
  return no(404, { ok: false, error: 'Ruta no encontrada en la demo.' })
}

// Cliente de la API (los flujos de n8n detrás de /webhook).

export interface Restaurante {
  nombre: string
  eslogan: string
  descripcion: string
  direccion: string
  telefono: string
  email: string
  instagram: string
  lat: number
  lng: number
  horas: { comida: string[]; cena: string[] }
  duracion: { comida: number; cena: number }
  cerrado: number[]
  vacaciones: string[]
  franja: number
  antelacionMin: number
  diasMax: number
  maxPersonas: number
  resena?: string
  emailDueno?: string
  emailCocina?: string
  /** % de probabilidad de lluvia a partir del cual se recoge la terraza (0 = nunca). */
  lluviaUmbral?: number
  /** Días sin venir para invitar a volver a un cliente habitual (0 = nunca). */
  recuperarDias?: number
}

export interface Mesa {
  id: string
  nombre: string
  zona: string
  plazas: number
  min: number
  x: number
  y: number
  w: number
  h: number
  forma: 'redonda' | 'cuadrada'
  activa?: boolean
}

export interface Plato {
  id: string
  categoria: string
  nombre: string
  descripcion: string
  precio: number
  alergenos: string[]
  etiquetas: string[]
  modelo: string
  imagen?: string
  disponible: boolean
  destacado: boolean
}

export interface Carta {
  categorias: { id: string; nombre: string }[]
  platos: Plato[]
}

export interface DatosWeb {
  restaurante: Restaurante
  hoy: string
  carta: Carta
  mesas: Mesa[]
}

export interface Hora {
  hora: string
  turno: 'comida' | 'cena'
  disponible: boolean
  pasada: boolean
}

export type EstadoMesa = 'libre' | 'ocupada' | 'no_cabe'

export interface Reserva {
  token: string
  codigo: string
  nombre: string
  telefono: string
  email: string
  hora: string
  turno: 'comida' | 'cena'
  personas: number
  notas: string
  mesa: string
  estado: 'confirmada' | 'llegada' | 'no_show' | 'cancelada'
  asistencia: string
  origen: string
}

export interface DatosAdmin {
  ok: true
  fecha: string
  hoy: string
  fechaTexto: string
  cerrado: string
  config: Restaurante
  mesas: Mesa[]
  carta: Carta
  reservas: Reserva[]
  espera: { nombre: string; telefono: string; fecha: string; hora: string; personas: number }[]
  opciones: { modelos: string[]; alergenos: string[]; etiquetas: string[] }
  /** Historial de los clientes con reserva ese día, por teléfono. */
  clientes?: Record<string, { visitas: number; noShows: number; ultima: string }>
}

export interface EmailDemo {
  id: string
  para: string
  asunto: string
  html: string
  fecha: string
  flujo: string
}
export interface RegistroDemo {
  id: string
  flujo: string
  cuando: string
  resumen: string
  emails: number
  manual: boolean
}

/** Demo pública: la API se sirve desde el propio navegador (ver lib/demo/servidor.ts). */
export const DEMO = import.meta.env.VITE_DEMO === '1'
export const CLAVE_DEMO = 'demo'

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(status: number, data: Record<string, unknown>) {
    const msg = (data.errores as string[] | undefined)?.join(' ') || (data.error as string) || 'Algo ha fallado. Inténtalo de nuevo.'
    super(msg)
    this.status = status
    this.data = data
  }
}

async function pedir<T>(path: string, init?: RequestInit & { clave?: string }): Promise<T> {
  if (DEMO) {
    const { atender, ErrorDemo } = await import('./demo/servidor')
    try {
      return (await atender(path, init)) as T
    } catch (e) {
      if (e instanceof ErrorDemo) throw new ApiError(e.status, e.data)
      throw e
    }
  }
  let res: Response
  try {
    res = await fetch('/webhook' + path, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.clave ? { 'x-api-key': init.clave } : {}),
      },
    })
  } catch {
    throw new ApiError(0, { error: 'Sin conexión. Revisa tu internet.' })
  }
  let data: Record<string, unknown> = {}
  try {
    data = await res.json()
  } catch {
    /* respuesta vacía */
  }
  if (!res.ok || data.ok === false) throw new ApiError(res.status, data)
  return data as T
}

const TAREAS: Record<string, string> = { '03': 'tareas/recordatorios', '04': 'tareas/resenas', '05': 'interno/espera', '07': 'tareas/informe', '08': 'tareas/terraza', '09': 'tareas/cocina', '10': 'tareas/recuperar' }

export const api = {
  web: () => pedir<DatosWeb>('/api/web'),
  disponibilidad: (fecha: string, personas: number) =>
    pedir<{ cerrado: boolean; motivo?: string; fechaTexto?: string; horas: Hora[] }>(`/api/disponibilidad?fecha=${fecha}&personas=${personas}`),
  mapa: (fecha: string, hora: string, personas: number) =>
    pedir<{ mesas: { id: string; estado: EstadoMesa }[]; recomendada: string | null }>(`/api/mapa?fecha=${fecha}&hora=${encodeURIComponent(hora)}&personas=${personas}`),
  reservar: (datos: Record<string, unknown>, clave?: string) =>
    pedir<{ ok: true; codigo: string; fechaTexto: string; hora: string; personas: number; nombre: string; email: string; mesa: string; zona: string; gestionar: string }>(
      '/api/reservas',
      { method: 'POST', body: JSON.stringify(datos), ...(clave ? { clave } : {}) },
    ),
  espera: (datos: Record<string, unknown>) => pedir<{ ok: true; fechaTexto: string; email: string }>('/api/espera', { method: 'POST', body: JSON.stringify(datos) }),
  admin: {
    datos: (clave: string, fecha?: string) => pedir<DatosAdmin>(`/api/admin/datos${fecha ? `?fecha=${fecha}` : ''}`, { clave }),
    guardar: <T>(clave: string, tipo: 'config' | 'mesas' | 'carta', valor: unknown) =>
      pedir<{ ok: true; valor: T }>('/api/admin/guardar', { method: 'POST', body: JSON.stringify({ tipo, valor }), clave }),
    estado: (clave: string, token: string, estado: Reserva['estado']) => pedir<{ ok: true }>('/api/panel', { method: 'POST', body: JSON.stringify({ token, estado }), clave }),
    mover: (clave: string, token: string, mesa: string) => pedir<{ ok: true }>('/api/panel', { method: 'POST', body: JSON.stringify({ token, mesa }), clave }),
    /** Lanza una automatización en el momento (en producción, los webhooks /tareas/* de n8n). */
    ejecutar: (clave: string, flujo: string, extra: Record<string, unknown> = {}) =>
      DEMO
        ? pedir<{ ok: true; registro: RegistroDemo }>('/api/demo/ejecutar', { method: 'POST', body: JSON.stringify({ flujo, ...extra }), clave })
        : pedir<{ message?: string }>('/' + TAREAS[flujo], { method: 'POST', body: JSON.stringify({ clave, ...extra }) }),
  },
  demo: {
    bandeja: () => pedir<{ emails: EmailDemo[]; registro: RegistroDemo[] }>('/api/demo/bandeja'),
    reiniciar: () => pedir<{ ok: true }>('/api/demo/reiniciar', { method: 'POST', body: '{}' }),
    reserva: (t: string, accion?: 'cancelar' | 'confirmar') =>
      pedir<{ ok: true; aviso: string; reserva: Reserva & { fecha: string; fechaTexto: string; mesaNombre: string; zona: string; activa: boolean } }>(
        '/api/demo/reserva?t=' + encodeURIComponent(t),
        accion ? { method: 'POST', body: JSON.stringify({ t, accion }) } : undefined,
      ),
  },
}

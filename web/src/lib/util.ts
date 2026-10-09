import { useEffect, useState, useSyncExternalStore } from 'react'

/* ----------------------------------------------------------- enrutado mínimo */

const suscribir = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}
export function useRuta() {
  return useSyncExternalStore(suscribir, () => window.location.pathname)
}
export function navegar(path: string) {
  if (path === window.location.pathname) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo({ top: 0 })
}
/** Enlace interno sin recargar la página. */
export function alClicar(path: string) {
  return (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.button !== 0) return
    e.preventDefault()
    navegar(path)
  }
}

/* ----------------------------------------------------------- fechas y formatos */

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const desdeIso = (s: string) => new Date(s + 'T12:00:00')
export const sumarDias = (s: string, n: number) => {
  const d = desdeIso(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
/** 1 = lunes … 7 = domingo (como luxon). */
export const diaSemana = (s: string) => ((desdeIso(s).getDay() + 6) % 7) + 1
export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
export const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
export const fechaLarga = (s: string) => desdeIso(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
export const euros = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: n % 1 ? 2 : 0 })
export const telefono = (t: string) => {
  const m = /^\+34(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(t || '')
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : t
}

/* ----------------------------------------------------------- alérgenos */

export const ALERGENOS: Record<string, { nombre: string; icono: string }> = {
  gluten: { nombre: 'Gluten', icono: '🌾' },
  crustaceos: { nombre: 'Crustáceos', icono: '🦐' },
  huevo: { nombre: 'Huevo', icono: '🥚' },
  pescado: { nombre: 'Pescado', icono: '🐟' },
  cacahuetes: { nombre: 'Cacahuetes', icono: '🥜' },
  soja: { nombre: 'Soja', icono: '🫘' },
  lacteos: { nombre: 'Lácteos', icono: '🥛' },
  frutos_cascara: { nombre: 'Frutos de cáscara', icono: '🌰' },
  apio: { nombre: 'Apio', icono: '🥬' },
  mostaza: { nombre: 'Mostaza', icono: '🟡' },
  sesamo: { nombre: 'Sésamo', icono: '⚪' },
  sulfitos: { nombre: 'Sulfitos', icono: '🍷' },
  altramuces: { nombre: 'Altramuces', icono: '🌼' },
  moluscos: { nombre: 'Moluscos', icono: '🐚' },
}

/* ----------------------------------------------------------- almacenamiento */

export function useGuardado<T>(clave: string, inicial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(clave)
      return raw ? (JSON.parse(raw) as T) : inicial
    } catch {
      return inicial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(clave, JSON.stringify(v))
    } catch {
      /* sin almacenamiento */
    }
  }, [clave, v])
  return [v, setV]
}

export function useTitulo(t: string) {
  useEffect(() => {
    document.title = t
  }, [t])
}

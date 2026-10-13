/** Zonas, líneas de paso y escenas de ejemplo. Coordenadas normalizadas (0–1). */

export type Punto = [number, number]

export interface Zona {
  id: string
  nombre: string
  /** aforo: se cuenta; cola: además se mide la espera; excluir: no se cuenta (personal, calle…). */
  tipo: 'aforo' | 'cola' | 'excluir'
  puntos: Punto[]
}

export interface Linea {
  id: string
  nombre: string
  a: Punto
  b: Punto
  /** Nombre de cada sentido de paso: [izquierda→derecha (o arriba→abajo), al revés]. */
  sentidos: [string, string]
}

export interface Escena {
  id: string
  nombre: string
  descripcion: string
  video?: string
  poster?: string
  capacidad: number
  zonas: Zona[]
  lineas: Linea[]
  credito?: string
}

const todo: Punto[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

export const ESCENAS: Escena[] = [
  {
    id: 'cafe',
    nombre: 'Barra y cola',
    descripcion: 'Cafetería: aforo del local y cola delante de la barra. Los camareros, tras la barra, no cuentan.',
    video: '/aforo/cafe.mp4',
    poster: '/aforo/cafe.jpg',
    capacidad: 14,
    zonas: [
      { id: 'local', nombre: 'Local', tipo: 'aforo', puntos: [[0.12, 0.6], [0.9, 0.52], [0.9, 1], [0.12, 1]] },
      { id: 'cola', nombre: 'Cola de la barra', tipo: 'cola', puntos: [[0.14, 0.64], [0.52, 0.6], [0.52, 1], [0.14, 1]] },
      { id: 'personal', nombre: 'Tras la barra', tipo: 'excluir', puntos: [[0, 0.2], [0.42, 0.2], [0.42, 0.58], [0, 0.62]] },
    ],
    lineas: [],
    credito: 'Vídeo: Pexels (licencia Pexels)',
  },
  {
    id: 'terraza',
    nombre: 'Terraza',
    descripcion: 'Terraza a pie de calle: ocupación de las mesas y personas que pasan por la acera.',
    video: '/aforo/terraza.mp4',
    poster: '/aforo/terraza.jpg',
    capacidad: 30,
    zonas: [{ id: 'terraza', nombre: 'Terraza', tipo: 'aforo', puntos: [[0, 0.55], [0.97, 0.55], [0.97, 1], [0, 1]] }],
    lineas: [{ id: 'acera', nombre: 'Acera', a: [0.62, 0.6], b: [0.62, 0.98], sentidos: ['Hacia la derecha', 'Hacia la izquierda'] }],
    credito: 'Vídeo: Pexels (licencia Pexels)',
  },
  {
    id: 'plaza',
    nombre: 'Entrada y flujo',
    descripcion: 'Vista cenital: cuánta gente entra y sale y por dónde pasa más (mapa de calor).',
    video: '/aforo/plaza.mp4',
    poster: '/aforo/plaza.jpg',
    capacidad: 80,
    zonas: [{ id: 'sala', nombre: 'Sala', tipo: 'aforo', puntos: todo }],
    lineas: [{ id: 'puerta', nombre: 'Puerta', a: [0, 0.5], b: [1, 0.5], sentidos: ['Salen', 'Entran'] }],
    credito: 'Vídeo: Pexels (licencia Pexels)',
  },
]

export const escenaLibre = (id: 'webcam' | 'archivo', nombre: string): Escena => ({
  id,
  nombre,
  descripcion: 'Dibuja tus zonas encima de la imagen: aforo, cola, zonas que no cuentan y líneas de paso.',
  capacidad: 30,
  zonas: [{ id: 'todo', nombre: 'Local', tipo: 'aforo', puntos: todo }],
  lineas: [],
})

/* ----------------------------------------------------------- geometría */

export function dentro([x, y]: Punto, poligono: Punto[]) {
  let c = false
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i]
    const [xj, yj] = poligono[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) c = !c
  }
  return c
}

/** +1 o −1 si el paso de «a» a «b» cruza la línea, 0 si no. */
export function cruce(a: Punto, b: Punto, l: Linea) {
  const lado = (p: Punto) => Math.sign((l.b[0] - l.a[0]) * (p[1] - l.a[1]) - (l.b[1] - l.a[1]) * (p[0] - l.a[0]))
  const s1 = lado(a)
  const s2 = lado(b)
  if (s1 === 0 || s2 === 0 || s1 === s2) return 0
  // El cruce debe caer dentro del segmento de la línea.
  const d = (b[0] - a[0]) * (l.b[1] - l.a[1]) - (b[1] - a[1]) * (l.b[0] - l.a[0])
  if (!d) return 0
  const u = ((l.a[0] - a[0]) * (b[1] - a[1]) - (l.a[1] - a[1]) * (b[0] - a[0])) / d
  return u >= 0 && u <= 1 ? (s1 < s2 ? 1 : -1) : 0
}

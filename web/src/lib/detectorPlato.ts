/**
 * Detector de platos para la realidad aumentada en cualquier móvil (sin ARCore ni ARKit).
 *
 * Un plato visto en perspectiva es una elipse: su borde separa la loza clara de la mesa.
 * Desde un punto semilla (el centro de la pantalla o donde toca el cliente) se lanzan rayos,
 * se buscan los bordes fuertes a lo largo de cada uno y se ajusta una elipse con RANSAC,
 * prefiriendo la elipse exterior (el ala del plato) a los bordes interiores, los cubiertos o la comida.
 * Con la elipse se estima la posición y la inclinación del plato respecto a la cámara.
 *
 * Todo trabaja sobre una imagen en escala de grises reducida (unos 320 px de ancho), así que
 * cabe en un fotograma incluso en móviles modestos.
 */

export interface Elipse {
  cx: number
  cy: number
  /** Semieje mayor y menor, en píxeles. */
  a: number
  b: number
  /** Ángulo del eje mayor, en radianes (x a la derecha, y hacia abajo). */
  angulo: number
  /** De 0 a 1: proporción de rayos que apoyan la elipse. */
  confianza: number
}

export interface Gradiente {
  w: number
  h: number
  gx: Float32Array
  gy: Float32Array
  mag: Float32Array
  max: number
}

/** Escala de grises a partir de RGBA (luminancia). */
export function grises(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]
  return g
}

/** Suavizado gaussiano 5×5 separable y gradiente de Sobel. */
export function gradiente(gris: Float32Array, w: number, h: number): Gradiente {
  const k = [1, 4, 6, 4, 1]
  const tmp = new Float32Array(w * h)
  const s = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -2; i <= 2; i++) acc += k[i + 2] * gris[y * w + Math.min(w - 1, Math.max(0, x + i))]
      tmp[y * w + x] = acc / 16
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -2; i <= 2; i++) acc += k[i + 2] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]
      s[y * w + x] = acc / 16
    }
  }
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  const mag = new Float32Array(w * h)
  let max = 1
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const a = s[i - w - 1], b = s[i - w], c = s[i - w + 1], d = s[i - 1], f = s[i + 1], g = s[i + w - 1], hh = s[i + w], ii = s[i + w + 1]
      const X = c + 2 * f + ii - a - 2 * d - g
      const Y = g + 2 * hh + ii - a - 2 * b - c
      gx[i] = X
      gy[i] = Y
      const m = Math.hypot(X, Y)
      mag[i] = m
      if (m > max) max = m
    }
  }
  return { w, h, gx, gy, mag, max }
}

interface Candidato {
  r: number
  fuerza: number
}

const RAYOS = 72

/** Bordes fuertes a lo largo de cada rayo que sale de la semilla. */
function candidatos(G: Gradiente, sx: number, sy: number, rMin: number, rMax: number) {
  const rayos: { c: number; s: number; cand: Candidato[] }[] = []
  const umbral = G.max * 0.08
  for (let k = 0; k < RAYOS; k++) {
    const t = (k / RAYOS) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const perfil: number[] = []
    for (let r = rMin; r <= rMax; r += 1) {
      const x = Math.round(sx + c * r)
      const y = Math.round(sy + s * r)
      if (x < 1 || y < 1 || x >= G.w - 1 || y >= G.h - 1) break
      const i = y * G.w + x
      // Componente radial del gradiente: el borde de un plato claro sobre una mesa más oscura
      // da un gradiente que apunta hacia dentro (negativo). Se aceptan ambos signos,
      // pero se favorece el del plato claro.
      const radial = G.gx[i] * c + G.gy[i] * s
      perfil.push(radial < 0 ? -radial : radial * 0.6)
    }
    const cand: Candidato[] = []
    for (let j = 2; j < perfil.length - 2; j++) {
      const v = perfil[j]
      if (v > umbral && v >= perfil[j - 1] && v >= perfil[j + 1] && v >= perfil[j - 2] && v >= perfil[j + 2]) cand.push({ r: rMin + j, fuerza: v / G.max })
    }
    cand.sort((a, b) => b.fuerza - a.fuerza)
    rayos.push({ c, s, cand: cand.slice(0, 5) })
  }
  return rayos
}

/** Resuelve un sistema lineal n×n por eliminación de Gauss con pivote parcial. */
function resolver(M: number[][], v: number[]): number[] | null {
  const n = v.length
  const A = M.map((fila, i) => [...fila, v[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let f = c + 1; f < n; f++) if (Math.abs(A[f][c]) > Math.abs(A[p][c])) p = f
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let f = 0; f < n; f++) {
      if (f === c) continue
      const k = A[f][c] / A[c][c]
      for (let j = c; j <= n; j++) A[f][j] -= k * A[c][j]
    }
  }
  return A.map((fila, i) => fila[n] / fila[i])
}

type Conica = [number, number, number, number, number] // A x² + B xy + C y² + D x + E y = 1 (relativo a la semilla)

/** Cónica por mínimos cuadrados (exacta con 5 puntos). */
function ajustar(puntos: [number, number][]): Conica | null {
  if (puntos.length < 5) return null
  const M = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0])
  const v = [0, 0, 0, 0, 0]
  for (const [x, y] of puntos) {
    const f = [x * x, x * y, y * y, x, y]
    for (let i = 0; i < 5; i++) {
      v[i] += f[i]
      for (let j = 0; j < 5; j++) M[i][j] += f[i] * f[j]
    }
  }
  return resolver(M, v) as Conica | null
}

/** Centro, semiejes y ángulo de una cónica; null si no es una elipse. */
function parametros([A, B, C, D, E]: Conica) {
  const det = 4 * A * C - B * B
  if (det <= 0 || A <= 0 || C <= 0) return null
  const x0 = (B * E - 2 * C * D) / det
  const y0 = (B * D - 2 * A * E) / det
  // Valor de la forma en el centro: A x0² + B x0 y0 + C y0² + D x0 + E y0 - 1
  const F = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 - 1
  if (F >= 0) return null
  const t = 0.5 * Math.atan2(B, A - C)
  const ct = Math.cos(t)
  const st = Math.sin(t)
  const l1 = A * ct * ct + B * ct * st + C * st * st
  const l2 = A * st * st - B * ct * st + C * ct * ct
  if (l1 <= 0 || l2 <= 0) return null
  const r1 = Math.sqrt(-F / l1)
  const r2 = Math.sqrt(-F / l2)
  return r1 >= r2 ? { x0, y0, a: r1, b: r2, angulo: t } : { x0, y0, a: r2, b: r1, angulo: t + Math.PI / 2 }
}

/** Radio de la elipse a lo largo de un rayo desde la semilla. */
function radioEnRayo([A, B, C, D, E]: Conica, c: number, s: number) {
  const qa = A * c * c + B * c * s + C * s * s
  const qb = D * c + E * s
  const disc = qb * qb + 4 * qa
  if (qa <= 0 || disc < 0) return -1
  return (-qb + Math.sqrt(disc)) / (2 * qa)
}

export interface Opciones {
  /** Semilla: punto que debe quedar dentro del plato. */
  sx: number
  sy: number
  /** Para el seguimiento: tamaño esperado (semieje mayor) del plato. */
  previo?: Elipse | null
  iteraciones?: number
}

/** Busca el plato que contiene la semilla. */
export function detectarPlato(G: Gradiente, op: Opciones): Elipse | null {
  const minDim = Math.min(G.w, G.h)
  const maxDim = Math.max(G.w, G.h)
  const rMin = op.previo ? Math.max(4, op.previo.b * 0.55) : minDim * 0.06
  const rMax = op.previo ? op.previo.a * 1.5 : maxDim * 0.6
  const rayos = candidatos(G, op.sx, op.sy, rMin, rMax)
  const utiles = rayos.map((r, i) => (r.cand.length ? i : -1)).filter((i) => i >= 0)
  if (utiles.length < 12) return null

  const hipotesis: { con: Conica; puntuacion: number; x0: number; y0: number; a: number; r: number }[] = []
  const iter = op.iteraciones ?? 500
  // Generador determinista para que el resultado sea reproducible.
  let semilla = 12345
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

  const puntuar = (con: Conica) => {
    const p = parametros(con)
    if (!p) return -1
    if (p.b / p.a < 0.22 || p.a > maxDim * 0.7 || p.b < minDim * 0.05) return -1
    if (Math.hypot(p.x0, p.y0) > p.b * 0.85) return -1 // la semilla debe quedar bien dentro
    if (op.previo && (p.a < op.previo.a * 0.75 || p.a > op.previo.a * 1.3)) return -1
    let s = 0
    let apoyos = 0
    for (const ray of rayos) {
      const r = radioEnRayo(con, ray.c, ray.s)
      if (r <= 0) continue
      const tol = Math.max(1.6, r * 0.035)
      let f = 0
      for (const c of ray.cand) if (Math.abs(c.r - r) <= tol && c.fuerza > f) f = c.fuerza
      if (f > 0) {
        s += Math.min(f, 0.6)
        apoyos++
      }
    }
    if (apoyos < RAYOS * 0.3) return -1
    // A igualdad de apoyo, gana la elipse exterior (el ala del plato y no el fondo).
    return s * (apoyos / RAYOS)
  }

  for (let it = 0; it < iter; it++) {
    const elegidos = new Set<number>()
    while (elegidos.size < 5) elegidos.add(utiles[Math.floor(azar() * utiles.length)])
    const pts: [number, number][] = []
    for (const i of elegidos) {
      const ray = rayos[i]
      // Elige un candidato del rayo, con más probabilidad los fuertes.
      const total = ray.cand.reduce((a, c) => a + c.fuerza, 0)
      let x = azar() * total
      let c = ray.cand[0]
      for (const cc of ray.cand) {
        x -= cc.fuerza
        if (x <= 0) {
          c = cc
          break
        }
      }
      pts.push([ray.c * c.r, ray.s * c.r])
    }
    const con = ajustar(pts)
    if (!con) continue
    const p = puntuar(con)
    if (p > 0) {
      const q = parametros(con)!
      hipotesis.push({ con, puntuacion: p, x0: q.x0, y0: q.y0, a: q.a, r: q.b / q.a })
    }
  }
  if (!hipotesis.length) return null
  // El plato tiene dos elipses concéntricas: el fondo y el ala. Si la exterior tiene un apoyo
  // razonable frente a la mejor, se elige la exterior (es el contorno real del plato).
  hipotesis.sort((x, y) => y.puntuacion - x.puntuacion)
  const top = hipotesis[0]
  let mejor = top
  for (const h of hipotesis) {
    if (h.puntuacion < top.puntuacion * 0.5) break
    if (h.a > mejor.a * 1.08 && Math.hypot(h.x0 - top.x0, h.y0 - top.y0) < top.a * 0.1 && Math.abs(h.r - top.r) < 0.08) mejor = h
  }

  // Refinado: mínimos cuadrados con los puntos que apoyan la mejor elipse.
  let con = mejor.con
  let apoyos = 0
  for (let pasada = 0; pasada < 3; pasada++) {
    const pts: [number, number][] = []
    for (const ray of rayos) {
      const r = radioEnRayo(con, ray.c, ray.s)
      if (r <= 0) continue
      const tol = Math.max(2, r * 0.05)
      let m: Candidato | null = null
      for (const c of ray.cand) if (Math.abs(c.r - r) <= tol && (!m || c.fuerza > m.fuerza)) m = c
      if (m) pts.push([ray.c * m.r, ray.s * m.r])
    }
    apoyos = pts.length
    const nueva = ajustar(pts)
    if (!nueva || !parametros(nueva)) break
    con = nueva
  }
  const p = parametros(con)
  if (!p) return null
  return { cx: op.sx + p.x0, cy: op.sy + p.y0, a: p.a, b: p.b, angulo: p.angulo, confianza: apoyos / RAYOS }
}

/** Suaviza el seguimiento entre fotogramas. */
export function suavizar(previa: Elipse, nueva: Elipse, k = 0.45): Elipse {
  // El ángulo de una elipse casi circular es inestable: se interpola por el camino corto (periodo π).
  let d = nueva.angulo - previa.angulo
  while (d > Math.PI / 2) d -= Math.PI
  while (d < -Math.PI / 2) d += Math.PI
  return {
    cx: previa.cx + (nueva.cx - previa.cx) * k,
    cy: previa.cy + (nueva.cy - previa.cy) * k,
    a: previa.a + (nueva.a - previa.a) * k,
    b: previa.b + (nueva.b - previa.b) * k,
    angulo: previa.angulo + d * k,
    confianza: nueva.confianza,
  }
}

export interface Pose {
  /** Posición del centro del plato en coordenadas de cámara (metros; la cámara mira a -z). */
  posicion: [number, number, number]
  /** Normal del plato (hacia arriba de la mesa) en coordenadas de cámara. */
  normal: [number, number, number]
  /** Dirección en el plano del plato que apunta «hacia la cámara» (para orientar la comida). */
  frente: [number, number, number]
}

/**
 * Pose del plato a partir de su elipse, suponiendo un plato de radio R (metros) y una cámara con
 * focal f (píxeles) y centro óptico (ox, oy). Si la cámara virtual usa la misma focal, la comida
 * se proyecta exactamente sobre la elipse aunque el radio real del plato sea otro.
 */
export function pose(e: Elipse, f: number, ox: number, oy: number, R = 0.135): Pose {
  // Rayo hacia el centro (y de la imagen hacia abajo; y de la cámara hacia arriba).
  const dx = (e.cx - ox) / f
  const dy = -(e.cy - oy) / f
  const ln = Math.hypot(dx, dy, 1)
  const rayo: [number, number, number] = [dx / ln, dy / ln, -1 / ln]
  const dist = (R * f) / e.a / (1 / ln) // el semieje mayor no se acorta con la inclinación
  const posicion: [number, number, number] = [rayo[0] * dist, rayo[1] * dist, rayo[2] * dist]
  // Inclinación: un círculo inclinado θ se ve como elipse de razón cos θ, girando sobre el eje mayor.
  const tilt = Math.acos(Math.min(1, e.b / e.a))
  const ux = Math.cos(e.angulo)
  const uy = -Math.sin(e.angulo)
  // Normal de partida: mirando a la cámara (opuesta al rayo).
  const n0: [number, number, number] = [-rayo[0], -rayo[1], -rayo[2]]
  // Eje mayor en 3D, perpendicular al rayo.
  let ax: [number, number, number] = [ux, uy, 0]
  const pr = ax[0] * n0[0] + ax[1] * n0[1] + ax[2] * n0[2]
  ax = [ax[0] - pr * n0[0], ax[1] - pr * n0[1], ax[2] - pr * n0[2]]
  const la = Math.hypot(...ax)
  ax = [ax[0] / la, ax[1] / la, ax[2] / la]
  const girar = (v: [number, number, number], ang: number): [number, number, number] => {
    // Rodrigues alrededor de ax.
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const cr: [number, number, number] = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]
    const d = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2]
    return [v[0] * c + cr[0] * s + ax[0] * d * (1 - c), v[1] * c + cr[1] * s + ax[1] * d * (1 - c), v[2] * c + cr[2] * s + ax[2] * d * (1 - c)]
  }
  const n1 = girar(n0, tilt)
  const n2 = girar(n0, -tilt)
  // La mesa está por debajo de la cámara: su normal apunta hacia arriba de la imagen (+y).
  const normal = n1[1] >= n2[1] ? n1 : n2
  // «Frente»: proyección sobre el plato del vector hacia la cámara.
  const haciaCam: [number, number, number] = [-posicion[0], -posicion[1], -posicion[2]]
  const dn = haciaCam[0] * normal[0] + haciaCam[1] * normal[1] + haciaCam[2] * normal[2]
  let fr: [number, number, number] = [haciaCam[0] - dn * normal[0], haciaCam[1] - dn * normal[1], haciaCam[2] - dn * normal[2]]
  const lf = Math.hypot(...fr) || 1
  fr = [fr[0] / lf, fr[1] / lf, fr[2] / lf]
  return { posicion, normal, frente: fr }
}

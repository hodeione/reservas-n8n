/**
 * Seguimiento de personas entre fotogramas (estilo ByteTrack simplificado):
 * predicción con velocidad, emparejamiento por solapamiento (IoU) y, si falla, por cercanía.
 * Cada persona conserva su número mientras está en imagen, lo que permite medir cuánto
 * tiempo pasa en la cola y contar quién cruza una línea.
 */
import { iou, type Caja } from './detector'

export interface Persona {
  id: number
  x: number
  y: number
  w: number
  h: number
  vx: number
  vy: number
  score: number
  aciertos: number
  fallos: number
  confirmada: boolean
  /** Punto de apoyo (pies), en píxeles. */
  pie: [number, number]
  pieAnterior: [number, number] | null
  rastro: [number, number][]
  /** Instante (ms) en que entró en cada zona, por id de zona. */
  desde: Record<string, number>
}

export class Seguimiento {
  personas: Persona[] = []
  private siguiente = 1

  reiniciar() {
    this.personas = []
  }

  actualizar(cajas: Caja[]) {
    // 1. Predicción.
    for (const p of this.personas) {
      p.x += p.vx
      p.y += p.vy
    }
    // 2. Emparejamiento por IoU (de mayor a menor).
    const pares: [number, number, number][] = []
    this.personas.forEach((p, i) => cajas.forEach((c, j) => {
      const v = iou(p, c)
      if (v > 0.2) pares.push([v, i, j])
    }))
    pares.sort((a, b) => b[0] - a[0])
    const usadaP = new Set<number>()
    const usadaC = new Set<number>()
    const asignar = (i: number, j: number) => {
      usadaP.add(i)
      usadaC.add(j)
      const p = this.personas[i]
      const c = cajas[j]
      const k = 0.65
      const nx = p.x + (c.x - p.x) * k
      const ny = p.y + (c.y - p.y) * k
      p.vx = p.vx * 0.6 + (nx - (p.x - p.vx)) * 0.4
      p.vy = p.vy * 0.6 + (ny - (p.y - p.vy)) * 0.4
      p.x = nx
      p.y = ny
      p.w += (c.w - p.w) * k
      p.h += (c.h - p.h) * k
      p.score = c.score
      p.aciertos++
      p.fallos = 0
      if (p.aciertos >= 3) p.confirmada = true
    }
    for (const [, i, j] of pares) if (!usadaP.has(i) && !usadaC.has(j)) asignar(i, j)
    // 3. Lo que queda, por cercanía del centro (personas rápidas o tapadas a medias).
    this.personas.forEach((p, i) => {
      if (usadaP.has(i)) return
      let mejor = -1
      let dist = Infinity
      cajas.forEach((c, j) => {
        if (usadaC.has(j)) return
        const d = Math.hypot(c.x + c.w / 2 - (p.x + p.w / 2), c.y + c.h / 2 - (p.y + p.h / 2))
        const lim = Math.max(p.w, p.h) * 0.7
        if (d < lim && d < dist && Math.abs(c.h / p.h - 1) < 0.5) {
          dist = d
          mejor = j
        }
      })
      if (mejor >= 0) asignar(i, mejor)
    })
    // 4. Sin pareja: falla; nuevas cajas: personas nuevas.
    this.personas.forEach((p, i) => {
      if (!usadaP.has(i)) {
        p.fallos++
        p.vx *= 0.8
        p.vy *= 0.8
      }
    })
    cajas.forEach((c, j) => {
      if (usadaC.has(j) || c.score < 0.45) return
      this.personas.push({ id: this.siguiente++, ...c, vx: 0, vy: 0, aciertos: 1, fallos: 0, confirmada: false, pie: [c.x + c.w / 2, c.y + c.h], pieAnterior: null, rastro: [], desde: {} })
    })
    // 5. Fuera las que llevan demasiado sin verse.
    this.personas = this.personas.filter((p) => p.fallos <= (p.confirmada ? 18 : 3))
    for (const p of this.personas) {
      p.pieAnterior = p.pie
      p.pie = [p.x + p.w / 2, p.y + p.h]
      if (p.fallos === 0) {
        // Un salto grande es un cambio de identidad, no un paso: el recorrido empieza de nuevo.
        const u = p.rastro[p.rastro.length - 1]
        if (u && Math.hypot(u[0] - p.pie[0], u[1] - p.pie[1]) > p.h * 0.35) p.rastro = []
        p.rastro.push(p.pie)
        if (p.rastro.length > 30) p.rastro.shift()
      }
    }
  }

  /** Personas visibles y fiables. */
  visibles() {
    return this.personas.filter((p) => p.confirmada && p.fallos < 6)
  }
}

/** Convierte las personas seguidas en cifras: aforo, cola, espera, pasos por línea y serie temporal. */
import { MapaCalor } from './calor'
import { cruce, dentro, type Escena, type Punto } from './escenas'
import { Seguimiento, type Persona } from './seguimiento'
import type { Caja } from './detector'

export interface Lectura {
  ocupacion: number
  capacidad: number
  cola: number
  /** Segundos que lleva esperando quien más tiempo lleva en la cola. */
  esperaActual: number
  /** Media de segundos en cola de los últimos que la dejaron. */
  esperaMedia: number
  pasos: Record<string, [number, number]>
  total: number
}

export class Analisis {
  seguimiento = new Seguimiento()
  calor = new MapaCalor()
  escena: Escena
  pasos: Record<string, [number, number]> = {}
  tiemposCola: number[] = []
  serie: { t: number; ocupacion: number; cola: number }[] = []
  private ultimaSerie = 0

  constructor(escena: Escena) {
    this.escena = escena
    this.reiniciarConteos()
  }

  cambiarEscena(e: Escena) {
    this.escena = e
    this.seguimiento.reiniciar()
    this.calor.reiniciar()
    this.reiniciarConteos()
    this.serie = []
    this.tiemposCola = []
  }

  reiniciarConteos() {
    this.pasos = Object.fromEntries(this.escena.lineas.map((l) => [l.id, [0, 0]]))
  }

  /** Normaliza un punto en píxeles. */
  private n(p: [number, number], w: number, h: number): Punto {
    return [p[0] / w, p[1] / h]
  }

  /** El vídeo dio la vuelta o se saltó: las personas dejan de ser las mismas. */
  corte() {
    this.seguimiento.reiniciar()
  }

  procesar(cajas: Caja[], ahora: number, w: number, h: number) {
    this.seguimiento.actualizar(cajas)
    const vis = this.seguimiento.visibles()
    const z = this.escena.zonas
    for (const p of vis) {
      const pie = this.n(p.pie, w, h)
      const excluida = z.some((zz) => zz.tipo === 'excluir' && dentro(pie, zz.puntos))
      if (!excluida) this.calor.sumar(pie[0], pie[1], 0.35)
      // Tiempo en cada zona de cola.
      for (const zona of z.filter((zz) => zz.tipo === 'cola')) {
        const esta = !excluida && dentro(pie, zona.puntos)
        if (esta && p.desde[zona.id] === undefined) p.desde[zona.id] = ahora
        if (!esta && p.desde[zona.id] !== undefined) {
          const seg = (ahora - p.desde[zona.id]) / 1000
          if (seg > 1.5) this.tiemposCola = [...this.tiemposCola.slice(-14), seg]
          delete p.desde[zona.id]
        }
      }
      // Pasos por las líneas.
      if (p.pieAnterior) {
        const a = this.n(p.pieAnterior, w, h)
        for (const l of this.escena.lineas) {
          const s = cruce(a, pie, l)
          if (s) this.pasos[l.id][s > 0 ? 0 : 1]++
        }
      }
    }
    if (ahora - this.ultimaSerie > 1000) {
      this.ultimaSerie = ahora
      const l = this.lectura(ahora, w, h)
      this.serie = [...this.serie.slice(-179), { t: ahora, ocupacion: l.ocupacion, cola: l.cola }]
    }
  }

  private enZona(p: Persona, tipo: 'aforo' | 'cola', w: number, h: number) {
    const pie = this.n(p.pie, w, h)
    const z = this.escena.zonas
    if (z.some((zz) => zz.tipo === 'excluir' && dentro(pie, zz.puntos))) return false
    return z.some((zz) => zz.tipo === tipo && dentro(pie, zz.puntos))
  }

  lectura(ahora: number, w: number, h: number): Lectura {
    const vis = this.seguimiento.visibles()
    const enCola = vis.filter((p) => this.enZona(p, 'cola', w, h))
    const esperas = enCola.map((p) => Math.max(...Object.values(p.desde).map((t) => (ahora - t) / 1000), 0))
    return {
      ocupacion: vis.filter((p) => this.enZona(p, 'aforo', w, h) || this.enZona(p, 'cola', w, h)).length,
      capacidad: this.escena.capacidad,
      cola: enCola.length,
      esperaActual: esperas.length ? Math.max(...esperas) : 0,
      esperaMedia: this.tiemposCola.length ? this.tiemposCola.reduce((a, b) => a + b, 0) / this.tiemposCola.length : 0,
      pasos: this.pasos,
      total: vis.length,
    }
  }

  /** ¿Está esta persona en una zona que no cuenta? */
  excluida(p: Persona, w: number, h: number) {
    const pie = this.n(p.pie, w, h)
    return this.escena.zonas.some((zz) => zz.tipo === 'excluir' && dentro(pie, zz.puntos))
  }

  enCola(p: Persona, w: number, h: number) {
    return this.enZona(p, 'cola', w, h)
  }
}

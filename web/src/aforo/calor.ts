/** Mapa de calor de por dónde pasa la gente: se acumula el punto de apoyo de cada persona. */

const W = 160
const H = 90

// Escala de color: transparente → azul → cian → verde lima → amarillo → rojo.
const PARADAS: [number, number, number, number, number][] = [
  [0, 0, 0, 0, 0],
  [0.15, 40, 60, 220, 90],
  [0.35, 0, 200, 230, 150],
  [0.55, 200, 255, 0, 190],
  [0.8, 255, 210, 0, 215],
  [1, 255, 40, 20, 235],
]
const LUT = new Uint8ClampedArray(256 * 4)
for (let i = 0; i < 256; i++) {
  const t = i / 255
  let k = 0
  while (k < PARADAS.length - 2 && t > PARADAS[k + 1][0]) k++
  const [t0, r0, g0, b0, a0] = PARADAS[k]
  const [t1, r1, g1, b1, a1] = PARADAS[k + 1]
  const f = (t - t0) / (t1 - t0 || 1)
  LUT.set([r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f, a0 + (a1 - a0) * f], i * 4)
}

export class MapaCalor {
  private v = new Float32Array(W * H)
  private max = 1e-6
  private lienzo = Object.assign(document.createElement('canvas'), { width: W, height: H })
  private ctx = this.lienzo.getContext('2d')!
  private img = this.ctx.createImageData(W, H)

  reiniciar() {
    this.v.fill(0)
    this.max = 1e-6
  }

  /** Suma una huella gaussiana en (nx, ny) normalizados. */
  sumar(nx: number, ny: number, peso = 1) {
    const cx = nx * W
    const cy = ny * H
    const r = 4
    const s2 = 2 * 2.2 * 2.2
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
        const i = y * W + x
        this.v[i] += peso * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / s2)
        if (this.v[i] > this.max) this.max = this.v[i]
      }
    }
  }

  dibujar(ctx: CanvasRenderingContext2D, ancho: number, alto: number) {
    const d = this.img.data
    // Raíz cuadrada para que las zonas de poco paso también se vean.
    for (let i = 0; i < this.v.length; i++) {
      const t = Math.sqrt(this.v[i] / this.max)
      d.set(LUT.subarray(Math.round(t * 255) * 4, Math.round(t * 255) * 4 + 4), i * 4)
    }
    this.ctx.putImageData(this.img, 0, 0)
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.globalAlpha = 0.8
    ctx.drawImage(this.lienzo, 0, 0, ancho, alto)
    ctx.restore()
  }
}

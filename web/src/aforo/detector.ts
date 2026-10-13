/**
 * Detector de personas en el navegador: YOLOX (Apache 2.0) con ONNX Runtime Web.
 * Usa la GPU con WebGPU cuando existe y, si no, WebAssembly. Ninguna imagen sale del dispositivo.
 *
 * - «preciso»: YOLOX-S a 640 px (ordenadores con WebGPU).
 * - «rapido»: YOLOX-Tiny a 416 px (móviles o sin WebGPU).
 */
import type * as OrtTipos from 'onnxruntime-web'

export interface Caja {
  x: number
  y: number
  w: number
  h: number
  score: number
}

export type Precision = 'preciso' | 'rapido'

const MODELOS: Record<Precision, { url: string; lado: number; mb: number }> = {
  preciso: { url: '/vision/yolox_s_fp16.onnx', lado: 640, mb: 18 },
  rapido: { url: '/vision/yolox_tiny_fp16.onnx', lado: 416, mb: 10 },
}

/** Precisión recomendada para este dispositivo. */
export function precisionRecomendada(): Precision {
  const movil = matchMedia('(pointer: coarse)').matches
  return 'gpu' in navigator && !movil ? 'preciso' : 'rapido'
}

async function descargar(url: string, progreso?: (p: number) => void) {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error('No se pudo descargar el modelo de visión.')
  const total = Number(r.headers.get('content-length')) || 0
  const lector = r.body.getReader()
  const partes: Uint8Array[] = []
  let recibido = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    partes.push(value)
    recibido += value.length
    if (total) progreso?.(recibido / total)
  }
  const buf = new Uint8Array(recibido)
  let o = 0
  for (const p of partes) {
    buf.set(p, o)
    o += p.length
  }
  return buf
}

export class Detector {
  backend = ''
  ms = 0
  precision: Precision = 'preciso'
  private ort!: typeof OrtTipos
  private ses!: OrtTipos.InferenceSession
  private lado = 640
  private lienzo!: OffscreenCanvas | HTMLCanvasElement
  private ctx!: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  private entrada!: Float32Array

  /** Una sola sesión por modelo: WebGPU no admite crear dos a la vez (p. ej. al volver a la página). */
  private static cache = new Map<Precision, Promise<Detector>>()
  private static oyentes = new Map<Precision, Set<(p: number) => void>>()

  static crear(precision: Precision, progreso?: (p: number) => void): Promise<Detector> {
    const oyentes = Detector.oyentes.get(precision) ?? new Set()
    Detector.oyentes.set(precision, oyentes)
    if (progreso) oyentes.add(progreso)
    let p = Detector.cache.get(precision)
    if (!p) {
      p = Detector.construir(precision, (x) => oyentes.forEach((f) => f(x)))
      p.catch(() => Detector.cache.delete(precision))
      Detector.cache.set(precision, p)
    }
    return p
  }

  private static async construir(precision: Precision, progreso?: (p: number) => void) {
    const d = new Detector()
    const ort = await import('onnxruntime-web/webgpu')
    d.ort = ort as unknown as typeof OrtTipos
    // ¿Hay GPU de verdad? Sin ella, el modelo pequeño en un hilo aparte para no bloquear la página.
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    const hayGpu = !!(gpu && (await gpu.requestAdapter().catch(() => null)))
    if (!hayGpu) {
      precision = 'rapido'
      ort.env.wasm.proxy = true
      ort.env.wasm.numThreads = 1
    }
    const m = MODELOS[precision]
    d.lado = m.lado
    const datos = await descargar(m.url, progreso)
    if (hayGpu) {
      d.ses = await ort.InferenceSession.create(datos, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
      d.backend = 'WebGPU'
    } else {
      d.ses = await ort.InferenceSession.create(datos, { executionProviders: ['wasm'] })
      d.backend = 'WebAssembly'
    }
    d.precision = precision
    const S = d.lado
    d.lienzo = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(S, S) : Object.assign(document.createElement('canvas'), { width: S, height: S })
    d.ctx = d.lienzo.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    d.entrada = new Float32Array(3 * S * S)
    return d
  }

  /** Personas en la imagen, en píxeles de la fuente. */
  async detectar(fuente: CanvasImageSource, ancho: number, alto: number, umbral = 0.35): Promise<Caja[]> {
    const S = this.lado
    const k = Math.min(S / ancho, S / alto)
    const w = Math.round(ancho * k)
    const h = Math.round(alto * k)
    const t0 = performance.now()
    // Letterbox con gris 114, como en el entrenamiento de YOLOX.
    this.ctx.fillStyle = 'rgb(114,114,114)'
    this.ctx.fillRect(0, 0, S, S)
    this.ctx.drawImage(fuente, 0, 0, w, h)
    const px = this.ctx.getImageData(0, 0, S, S).data
    const N = S * S
    const e = this.entrada
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      e[i] = px[j + 2] // YOLOX espera BGR en 0–255
      e[N + i] = px[j + 1]
      e[2 * N + i] = px[j]
    }
    const tensor = new this.ort.Tensor('float32', e, [1, 3, S, S])
    const salida = await this.ses.run({ [this.ses.inputNames[0]]: tensor })
    const o = salida[this.ses.outputNames[0]]
    const d = o.data as Float32Array
    const C = o.dims[2]
    const cajas: Caja[] = []
    let idx = 0
    for (const paso of [8, 16, 32]) {
      const g = S / paso
      for (let gy = 0; gy < g; gy++) {
        for (let gx = 0; gx < g; gx++, idx++) {
          const b = idx * C
          const score = d[b + 4] * d[b + 5] // objeto × clase «persona»
          if (score < umbral) continue
          const cx = (d[b] + gx) * paso
          const cy = (d[b + 1] + gy) * paso
          const bw = Math.exp(d[b + 2]) * paso
          const bh = Math.exp(d[b + 3]) * paso
          const x = (cx - bw / 2) / k
          const y = (cy - bh / 2) / k
          if (bw / k < 6 || bh / k < 12) continue
          cajas.push({ x, y, w: bw / k, h: bh / k, score })
        }
      }
    }
    tensor.dispose?.()
    const t = performance.now() - t0
    this.ms = this.ms ? this.ms * 0.85 + Math.min(t, 500) * 0.15 : t // media móvil
    return nms(cajas, 0.45)
  }
}

export function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const i = ix * iy
  return i / (a.w * a.h + b.w * b.h - i || 1)
}

function nms(cajas: Caja[], umbral: number) {
  cajas.sort((a, b) => b.score - a.score)
  const fin: Caja[] = []
  for (const c of cajas) if (!fin.some((f) => iou(f, c) > umbral)) fin.push(c)
  return fin
}

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Plato } from '../lib/api'
import { detectarPlato, gradiente, grises, pose, suavizar, type Elipse, type Gradiente } from '../lib/detectorPlato'
import { REALES, infoModelo, urlMiniatura, urlParaPlato } from '../lib/modelos'

/**
 * «Sírvelo en tu plato»: realidad aumentada en cualquier móvil con cámara.
 * Se apunta a un plato vacío, se toca y aparece el plato de la carta encima, a escala del plato real.
 * El plato se sigue fotograma a fotograma (detector de elipses propio, ver lib/detectorPlato).
 * Sin cámara (ordenador), funciona igual sobre una foto.
 */

const RADIO_PLATO = 0.135 // radio supuesto del plato real (27 cm); la escala sale coherente aunque sea otro
const LADO_PROCESO = 320 // lado largo de la imagen que analiza el detector

export const FOTOS_MUESTRA = [
  { url: '/fotos/plato-mantel.jpg', texto: 'Plato sobre mantel', credito: 'Stock Catalog · CC BY 2.0' },
  { url: '/fotos/plato-madera.jpg', texto: 'Plato en mesa de madera', credito: 'Acabashi · CC BY-SA 4.0' },
]

type Fuente = { tipo: 'camara' } | { tipo: 'foto'; url: string }

interface Ancla {
  elipse: Elipse
  grupo: THREE.Group
  modelo: string
  giro: number
  perdido: number
}

const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const cache = new Map<string, Promise<THREE.Object3D>>()
function cargarModelo(url: string) {
  if (!cache.has(url)) {
    cache.set(
      url,
      cargador.loadAsync(url).then((g) => {
        g.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        return g.scene
      }),
    )
  }
  return cache.get(url)!
}

/** Motor: vídeo o foto de fondo, detector y escena three.js encima con la misma proyección. */
class Motor {
  renderer: THREE.WebGLRenderer
  escena = new THREE.Scene()
  camara = new THREE.PerspectiveCamera(50, 1, 0.01, 20)
  luz = new THREE.DirectionalLight(0xffffff, 2.2)
  anclas: Ancla[] = []
  sw = 0
  sh = 0
  f = 1
  lienzo = document.createElement('canvas')
  ctx = this.lienzo.getContext('2d', { willReadFrequently: true })!
  G: Gradiente | null = null
  guia: Elipse | null = null
  ultimo = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    // Mapeo neutro: respeta el color fotografiado de los escaneos.
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    const pm = new THREE.PMREMGenerator(this.renderer)
    this.escena.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.6))
    this.luz.position.set(0.15, 0.6, 0.1)
    this.luz.castShadow = true
    this.luz.shadow.mapSize.set(1024, 1024)
    const sc = this.luz.shadow.camera
    sc.left = sc.bottom = -0.4
    sc.right = sc.top = 0.4
    sc.near = 0.05
    sc.far = 3
    this.luz.shadow.bias = -0.0005
    this.escena.add(this.luz, this.luz.target)
  }

  /** Tamaño de la fuente (px) y del elemento en pantalla (css). */
  dimensionar(W: number, H: number, cssW: number, cssH: number) {
    const k = LADO_PROCESO / Math.max(W, H)
    this.sw = Math.round(W * k)
    this.sh = Math.round(H * k)
    this.lienzo.width = this.sw
    this.lienzo.height = this.sh
    this.f = 0.8 * Math.max(this.sw, this.sh) // focal típica de la cámara principal de un móvil
    this.camara.aspect = W / H
    this.camara.fov = (2 * Math.atan(this.sh / 2 / this.f) * 180) / Math.PI
    this.camara.updateProjectionMatrix()
    this.renderer.setSize(cssW, cssH, false)
  }

  /** Analiza el fotograma actual. */
  analizar(fuente: CanvasImageSource) {
    this.ctx.drawImage(fuente, 0, 0, this.sw, this.sh)
    const img = this.ctx.getImageData(0, 0, this.sw, this.sh)
    const g = grises(img.data, this.sw, this.sh)
    // Exposición según la luz de la escena, para que el plato no desentone con el vídeo.
    let media = 0
    for (let i = 0; i < g.length; i += 16) media += g[i]
    media /= g.length / 16
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(0.45 + media / 230, 0.65, 1.25)
    this.G = gradiente(g, this.sw, this.sh)
  }

  /** Sigue los platos ya servidos y busca un plato en el centro como guía. */
  seguir() {
    if (!this.G) return
    for (const a of this.anclas) {
      const e = detectarPlato(this.G, { sx: a.elipse.cx, sy: a.elipse.cy, previo: a.elipse, iteraciones: 220 })
      if (e && e.confianza > 0.4) {
        a.elipse = suavizar(a.elipse, e)
        a.perdido = 0
        this.colocar(a)
      } else a.perdido++
    }
    const e = detectarPlato(this.G, { sx: this.sw / 2, sy: this.sh / 2, previo: this.guia && this.guia.confianza > 0.5 ? this.guia : null, iteraciones: 260 })
    const libre = e && !this.anclas.some((a) => Math.hypot(a.elipse.cx - e.cx, a.elipse.cy - e.cy) < a.elipse.b * 0.6)
    this.guia = e && e.confianza > 0.45 && libre ? (this.guia ? suavizar(this.guia, e, 0.5) : e) : null
  }

  colocar(a: Ancla) {
    const p = pose(a.elipse, this.f, this.sw / 2, this.sh / 2, RADIO_PLATO)
    const y = new THREE.Vector3(...p.normal)
    const z = new THREE.Vector3(...p.frente)
    const x = new THREE.Vector3().crossVectors(y, z).normalize()
    const m = new THREE.Matrix4().makeBasis(x, y, z)
    a.grupo.quaternion.setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.giro))
    a.grupo.position.set(...p.posicion)
    a.grupo.visible = true
    this.luz.position.set(p.posicion[0] + 0.25 * y.x + 0.15, p.posicion[1] + 0.9 * y.y + 0.4, p.posicion[2] + 0.6 * y.z + 0.2)
    this.luz.target.position.set(...p.posicion)
  }

  async servir(e: Elipse, modelo: string) {
    const info = infoModelo(modelo)
    const grupo = new THREE.Group()
    grupo.visible = false
    const base = await cargarModelo(urlParaPlato(modelo))
    const obj = base.clone()
    // Tamaño respecto al plato detectado: los servidos cubren el plato, la comida sola ocupa su fondo.
    const real = REALES[modelo]
    const s = real?.comida ? (2 * RADIO_PLATO * 0.66) / real.comida : real ? (2 * RADIO_PLATO * 0.97) / real.diametro : (2 * RADIO_PLATO * 0.6) / (info?.diametro ?? 0.2)
    obj.scale.setScalar(s * (real?.ar ?? 1))
    grupo.add(obj)
    // Sombra de contacto sobre el plato real.
    const sombra = new THREE.Mesh(new THREE.CircleGeometry(RADIO_PLATO * 1.02, 48), new THREE.ShadowMaterial({ opacity: 0.32 }))
    sombra.rotation.x = -Math.PI / 2
    sombra.position.y = 0.001
    sombra.receiveShadow = true
    grupo.add(sombra)
    this.escena.add(grupo)
    const a: Ancla = { elipse: e, grupo, modelo, giro: 0, perdido: 0 }
    this.anclas.push(a)
    this.colocar(a)
    return a
  }

  quitarUltima() {
    const a = this.anclas.pop()
    if (a) this.escena.remove(a.grupo)
  }

  girar(delta: number) {
    const a = this.anclas.at(-1)
    if (!a) return
    a.giro += delta
    this.colocar(a)
  }

  render() {
    this.renderer.render(this.escena, this.camara)
  }

  /** Detecta el plato bajo un punto (en coordenadas normalizadas 0–1). */
  platoEn(nx: number, ny: number): Elipse | null {
    if (!this.G) return null
    const e = detectarPlato(this.G, { sx: nx * this.sw, sy: ny * this.sh, iteraciones: 600 })
    if (e && e.confianza > 0.4) return e
    // Si se toca dentro de la guía, vale la guía.
    const g = this.guia
    if (g) {
      const dx = nx * this.sw - g.cx
      const dy = ny * this.sh - g.cy
      const c = Math.cos(-g.angulo)
      const s = Math.sin(-g.angulo)
      const u = dx * c - dy * s
      const v = dx * s + dy * c
      if ((u * u) / (g.a * g.a) + (v * v) / (g.b * g.b) <= 1) return g
    }
    return null
  }

  liberar() {
    this.renderer.dispose()
  }
}

interface Props {
  platos: Plato[]
  inicial?: string
  onCerrar: () => void
}

export function RealidadPlato({ platos, inicial, onCerrar }: Props) {
  const conModelo = platos.filter((p) => p.modelo)
  const [fuente, setFuente] = useState<Fuente | null>(null)
  const [error, setError] = useState('')
  const [actual, setActual] = useState(inicial ?? conModelo[0]?.id ?? '')
  const [servidos, setServidos] = useState(0)
  const [aviso, setAviso] = useState('')
  const [guia, setGuia] = useState<Elipse | null>(null)
  const [cargando, setCargando] = useState(false)
  const [dim, setDim] = useState({ w: 0, h: 0, left: 0, top: 0, sw: 1, sh: 1 })
  const contenedor = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const foto = useRef<HTMLImageElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const motor = useRef<Motor | null>(null)
  const plato = conModelo.find((p) => p.id === actual)

  // Bloquea el scroll mientras está abierto.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Por defecto, la cámara si el dispositivo la tiene.
  useEffect(() => {
    if (typeof navigator.mediaDevices?.getUserMedia === "function" && matchMedia('(pointer: coarse)').matches) setFuente({ tipo: 'camara' })
  }, [])

  // Arranca la cámara.
  useEffect(() => {
    if (fuente?.tipo !== 'camara') return
    let flujo: MediaStream | null = null
    let vivo = true
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (!vivo) return s.getTracks().forEach((t) => t.stop())
        flujo = s
        const v = video.current!
        v.srcObject = s
        await v.play()
      })
      .catch(() => {
        setError('No hemos podido abrir la cámara. Revisa el permiso del navegador o prueba con una foto.')
        setFuente(null)
      })
    return () => {
      vivo = false
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [fuente])

  // Ajusta la escena al tamaño de la fuente: «cover» con la cámara y «contain» con una foto.
  const encajar = useCallback(() => {
    const el = fuente?.tipo === 'camara' ? video.current : foto.current
    const c = contenedor.current
    if (!el || !c) return
    const W = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
    const H = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
    if (!W || !H) return
    const cw = c.clientWidth
    const ch = c.clientHeight
    const k = fuente?.tipo === 'camara' ? Math.max(cw / W, ch / H) : Math.min(cw / W, ch / H)
    const w = W * k
    const h = H * k
    setDim({ w, h, left: (cw - w) / 2, top: (ch - h) / 2, sw: W, sh: H })
    if (!motor.current && canvas.current) motor.current = new Motor(canvas.current)
    motor.current?.dimensionar(W, H, w, h)
    if (fuente?.tipo === 'foto') {
      motor.current?.analizar(el)
      motor.current?.seguir()
      setGuia(motor.current?.guia ?? null)
    }
  }, [fuente])

  useEffect(() => {
    addEventListener('resize', encajar)
    return () => removeEventListener('resize', encajar)
  }, [encajar])

  // Bucle: analiza la cámara (~15 veces por segundo) y pinta la escena en cada fotograma.
  useEffect(() => {
    if (!fuente) return
    let raf = 0
    let ultimaGuia = 0
    const bucle = (t: number) => {
      raf = requestAnimationFrame(bucle)
      const m = motor.current
      if (!m) return
      if (fuente.tipo === 'camara' && video.current && video.current.readyState >= 2 && t - m.ultimo > 66) {
        m.ultimo = t
        m.analizar(video.current)
        m.seguir()
        if (t - ultimaGuia > 120) {
          ultimaGuia = t
          setGuia(m.guia)
        }
      }
      m.render()
    }
    raf = requestAnimationFrame(bucle)
    return () => cancelAnimationFrame(raf)
  }, [fuente])

  // Cada fuente (cámara o foto) tiene su propio lienzo: el motor se recrea al cambiarla.
  useEffect(
    () => () => {
      motor.current?.liberar()
      motor.current = null
    },
    [fuente],
  )

  const decir = (t: string) => {
    setAviso(t)
    setTimeout(() => setAviso((x) => (x === t ? '' : x)), 3000)
  }

  async function tocar(e: React.PointerEvent) {
    const m = motor.current
    if (!m || !plato) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width
    const ny = (e.clientY - r.top) / r.height
    const el = m.platoEn(nx, ny)
    if (!el) return decir('No vemos un plato ahí. Encuádralo entero y con buena luz.')
    setCargando(true)
    try {
      await m.servir(el, plato.modelo)
      setServidos(m.anclas.length)
      m.seguir()
      setGuia(m.guia)
      decir(`${plato.nombre} servido. Toca otro plato para seguir.`)
    } finally {
      setCargando(false)
    }
  }

  async function capturar() {
    const m = motor.current
    const el = fuente?.tipo === 'camara' ? video.current : foto.current
    if (!m || !el) return
    m.render()
    const c = document.createElement('canvas')
    c.width = m.renderer.domElement.width
    c.height = m.renderer.domElement.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(el, 0, 0, c.width, c.height)
    ctx.drawImage(m.renderer.domElement, 0, 0)
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.9))
    if (!blob) return
    const archivo = new File([blob], 'mi-mesa.jpg', { type: 'image/jpeg' })
    if (navigator.canShare?.({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: 'Mi mesa' }).catch(() => {})
    } else {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'mi-mesa.jpg'
      a.click()
    }
  }

  const k = dim.w / Math.max(1, motor.current?.sw ?? 1)

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Sírvelo en tu plato">
      <div ref={contenedor} className="relative min-h-0 flex-1 overflow-hidden">
        {fuente && (
          <div className="absolute touch-manipulation" style={{ left: dim.left, top: dim.top, width: dim.w, height: dim.h }} onPointerUp={tocar}>
            {fuente.tipo === 'camara' ? (
              <video ref={video} playsInline muted onLoadedMetadata={encajar} className="absolute inset-0 h-full w-full" />
            ) : (
              <img ref={foto} src={fuente.url} alt="" crossOrigin="anonymous" onLoad={encajar} className="absolute inset-0 h-full w-full select-none" draggable={false} />
            )}
            <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
            {guia && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${dim.w} ${dim.h}`}>
                <ellipse
                  cx={guia.cx * k}
                  cy={guia.cy * k}
                  rx={guia.a * k}
                  ry={guia.b * k}
                  transform={`rotate(${(guia.angulo * 180) / Math.PI} ${guia.cx * k} ${guia.cy * k})`}
                  fill="rgba(232,182,76,.12)"
                  stroke="#e8b64c"
                  strokeWidth={3}
                  strokeDasharray="10 8"
                />
              </svg>
            )}
          </div>
        )}

        {!fuente && (
          <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
            <p className="font-serif text-3xl">Sírvelo en tu plato</p>
            <p className="max-w-sm text-white/75">Apunta con el móvil a un plato vacío, tócalo y verás el plato de la carta encima, a su tamaño.</p>
            {error && <p className="max-w-sm rounded-xl bg-teja/40 p-3 text-sm">{error}</p>}
            {typeof navigator.mediaDevices?.getUserMedia === "function" && (
              <button onClick={() => (setError(''), setFuente({ tipo: 'camara' }))} className="rounded-full bg-oro px-6 py-3.5 font-semibold text-tinta">
                📷 Abrir la cámara
              </button>
            )}
            <div className="w-full max-w-md">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-white/50">O prueba con una foto</p>
              <div className="grid grid-cols-3 gap-2">
                {FOTOS_MUESTRA.map((f) => (
                  <button key={f.url} onClick={() => setFuente({ tipo: 'foto', url: f.url })} className="overflow-hidden rounded-xl ring-1 ring-white/20 hover:ring-oro" title={f.credito}>
                    <img src={f.url} alt={f.texto} className="aspect-[4/3] w-full object-cover" />
                  </button>
                ))}
                <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center rounded-xl text-xs ring-1 ring-white/20 hover:ring-oro">
                  <span className="text-2xl">⬆️</span>
                  Tu foto
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && setFuente({ tipo: 'foto', url: URL.createObjectURL(e.target.files[0]) })} />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-white/40">Fotos: {FOTOS_MUESTRA.map((f) => f.credito).join(' · ')}, vía Wikimedia Commons.</p>
            </div>
          </div>
        )}

        {/* Barra superior */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <p className="pointer-events-auto max-w-[75%] text-sm font-semibold drop-shadow">
            {fuente ? (aviso || (cargando ? 'Sirviendo…' : guia ? 'Plato encontrado: tócalo para servir' : servidos ? 'Toca otro plato o haz una foto' : 'Apunta a un plato vacío y tócalo')) : ''}
          </p>
          <button onClick={onCerrar} aria-label="Cerrar" className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-xl">
            ×
          </button>
        </div>
      </div>

      {/* Selector de plato y acciones */}
      <div className="shrink-0 bg-black/90 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-3">
          {conModelo.map((p) => (
            <button key={p.id} onClick={() => setActual(p.id)} aria-pressed={p.id === actual} className={`w-20 shrink-0 rounded-2xl p-1.5 text-center text-[11px] leading-tight ${p.id === actual ? 'bg-white text-tinta' : 'bg-white/10'}`}>
              <img src={urlMiniatura(p.modelo)} alt="" className="mx-auto h-14 w-14 object-contain" />
              <span className="line-clamp-2">{p.nombre}</span>
            </button>
          ))}
        </div>
        {fuente && (
          <div className="mt-3 flex items-center justify-center gap-2 px-3 text-sm">
            <button onClick={() => motor.current?.girar(-Math.PI / 8)} disabled={!servidos} className="h-11 rounded-full bg-white/10 px-4 disabled:opacity-30" aria-label="Girar">
              ⟲ Girar
            </button>
            <button onClick={() => (motor.current?.quitarUltima(), setServidos(motor.current?.anclas.length ?? 0))} disabled={!servidos} className="h-11 rounded-full bg-white/10 px-4 disabled:opacity-30">
              Quitar
            </button>
            <button onClick={capturar} className="h-11 rounded-full bg-oro px-5 font-semibold text-tinta">
              📸 Foto
            </button>
            <button onClick={() => (setServidos(0), setGuia(null), setFuente(null))} className="h-11 rounded-full bg-white/10 px-4">
              Cambiar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

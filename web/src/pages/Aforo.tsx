import { useCallback, useEffect, useRef, useState } from 'react'
import { Analisis, type Lectura } from '../aforo/analisis'
import { Detector, precisionRecomendada, type Precision } from '../aforo/detector'
import { ESCENAS, escenaLibre, type Escena, type Punto, type Zona } from '../aforo/escenas'
import { CLAVE_DEMO, DEMO, api } from '../lib/api'
import { alClicar, useTitulo } from '../lib/util'

type Modo = null | 'aforo' | 'cola' | 'excluir' | 'linea'
const COLOR_ZONA: Record<Zona['tipo'], string> = { aforo: '#C8FF00', cola: '#ff9f1c', excluir: '#8c8c7a' }
const NOMBRE_ZONA: Record<Zona['tipo'], string> = { aforo: 'Aforo', cola: 'Cola', excluir: 'No cuenta' }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function leerClave() {
  if (DEMO) return CLAVE_DEMO
  try {
    return JSON.parse(localStorage.getItem('admin-clave') || '""') as string
  } catch {
    return ''
  }
}

export function Aforo() {
  useTitulo('Aforo y colas por cámara · Taberna Luna')
  const video = useRef<HTMLVideoElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const detector = useRef<Detector | null>(null)
  const analisis = useRef(new Analisis(ESCENAS[0]))
  const flujo = useRef<MediaStream | null>(null)

  const [escena, setEscena] = useState<Escena>(ESCENAS[0])
  const [precision, setPrecision] = useState<Precision>(precisionRecomendada)
  const [carga, setCarga] = useState<{ p: number; error?: string } | null>({ p: 0 })
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [rend, setRend] = useState({ ms: 0, fps: 0, backend: '' })
  const [capas, setCapas] = useState({ cajas: true, rastros: true, calor: false, zonas: true, privacidad: false })
  const [modo, setModo] = useState<Modo>(null)
  const [borrador, setBorrador] = useState<Punto[]>([])
  const [publicado, setPublicado] = useState<{ hace: number; error?: string } | null>(null)
  const [serie, setSerie] = useState<{ ocupacion: number; cola: number }[]>([])
  const estado = useRef({ capas, modo, borrador })
  estado.current = { capas, modo, borrador }

  // Carga del detector (y recarga al cambiar la precisión).
  useEffect(() => {
    let vivo = true
    setCarga({ p: 0 })
    Detector.crear(precision, (p) => vivo && setCarga({ p }))
      .then((d) => {
        if (!vivo) return
        detector.current = d
        setCarga(null)
      })
      .catch((e: Error) => vivo && setCarga({ p: 0, error: e.message }))
    return () => {
      vivo = false
    }
  }, [precision])

  // Fuente de vídeo.
  const ponerFuente = useCallback(async (e: Escena, archivo?: File) => {
    const v = video.current!
    flujo.current?.getTracks().forEach((t) => t.stop())
    flujo.current = null
    v.srcObject = null
    analisis.current.cambiarEscena(e)
    setEscena(e)
    setSerie([])
    setLectura(null)
    setModo(null)
    setBorrador([])
    if (e.id === 'webcam') {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        flujo.current = s
        v.srcObject = s
        v.loop = false
      } catch {
        alert('No se ha podido abrir la cámara. Revisa el permiso del navegador.')
        return ponerFuente(ESCENAS[0])
      }
    } else if (archivo) {
      v.src = URL.createObjectURL(archivo)
      v.loop = true
    } else {
      v.src = e.video!
      v.loop = true
    }
    await v.play().catch(() => {})
  }, [])

  useEffect(() => {
    ponerFuente(ESCENAS[0])
    const v = video.current
    return () => {
      flujo.current?.getTracks().forEach((t) => t.stop())
      v?.pause()
    }
  }, [ponerFuente])

  // Bucle: detección tan rápida como permita el equipo y dibujo a cada fotograma.
  useEffect(() => {
    let vivo = true
    let ultimoT = 0
    let ultimoEstado = 0
    let fotos = 0
    let t0 = performance.now()
    const v = video.current!
    const c = lienzo.current!
    const ctx = c.getContext('2d')!

    const detectar = async () => {
      while (vivo) {
        const d = detector.current
        if (d && v.readyState >= 2 && !v.paused && v.videoWidth) {
          const w = v.videoWidth
          const h = v.videoHeight
          if (v.currentTime + 0.2 < ultimoT) analisis.current.corte() // el vídeo volvió a empezar
          ultimoT = v.currentTime
          const det = await d.detectar(v, w, h)
          analisis.current.procesar(det, performance.now(), w, h)
          fotos++
          const ahora = performance.now()
          if (ahora - ultimoEstado > 300) {
            ultimoEstado = ahora
            setLectura(analisis.current.lectura(ahora, w, h))
            setSerie(analisis.current.serie.map(({ ocupacion, cola }) => ({ ocupacion, cola })))
            setRend({ ms: d.ms, fps: (fotos * 1000) / (ahora - t0), backend: d.backend })
            if (ahora - t0 > 3000) {
              fotos = 0
              t0 = ahora
            }
          }
        }
        await new Promise((r) => setTimeout(r, 16))
        await new Promise((r) => requestAnimationFrame(r))
      }
    }

    const dibujar = () => {
      if (!vivo) return
      requestAnimationFrame(dibujar)
      const w = v.videoWidth
      const h = v.videoHeight
      if (!w) return
      if (c.width !== w) {
        c.width = w
        c.height = h
      }
      const { capas: cp, modo: md, borrador: bd } = estado.current
      const a = analisis.current
      ctx.drawImage(v, 0, 0, w, h)
      const personas = a.seguimiento.visibles()
      if (cp.privacidad) {
        // Las personas se difuminan antes de pintar nada encima.
        ctx.save()
        ctx.filter = 'blur(14px)'
        for (const p of personas) {
          const x = Math.max(0, p.x - 6)
          const y = Math.max(0, p.y - 6)
          const ww = Math.min(w - x, p.w + 12)
          const hh = Math.min(h - y, p.h + 12)
          if (ww > 0 && hh > 0) ctx.drawImage(v, x, y, ww, hh, x, y, ww, hh)
        }
        ctx.restore()
      }
      if (cp.calor) a.calor.dibujar(ctx, w, h)
      const L = Math.max(2, w / 500)
      if (cp.zonas) {
        for (const z of a.escena.zonas) {
          ctx.beginPath()
          z.puntos.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)))
          ctx.closePath()
          ctx.fillStyle = COLOR_ZONA[z.tipo] + (z.tipo === 'excluir' ? '33' : '14')
          ctx.fill()
          ctx.setLineDash(z.tipo === 'excluir' ? [10, 8] : [])
          ctx.lineWidth = L
          ctx.strokeStyle = COLOR_ZONA[z.tipo] + 'cc'
          ctx.stroke()
          ctx.setLineDash([])
          const [lx, ly] = z.puntos.reduce((m, p) => (p[1] < m[1] ? p : m), z.puntos[0])
          ctx.font = `600 ${Math.round(L * 7)}px Inter Variable, sans-serif`
          ctx.fillStyle = COLOR_ZONA[z.tipo]
          ctx.fillText(z.nombre.toUpperCase(), lx * w + L * 4, ly * h + L * 10)
        }
        for (const l of a.escena.lineas) {
          ctx.lineWidth = L * 2
          ctx.strokeStyle = '#ffffff'
          ctx.setLineDash([L * 6, L * 4])
          ctx.beginPath()
          ctx.moveTo(l.a[0] * w, l.a[1] * h)
          ctx.lineTo(l.b[0] * w, l.b[1] * h)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
      if (cp.rastros) {
        for (const p of personas) {
          if (p.rastro.length < 2) continue
          ctx.beginPath()
          p.rastro.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          ctx.lineWidth = L
          ctx.strokeStyle = a.enCola(p, w, h) ? '#ff9f1caa' : '#C8FF00aa'
          ctx.stroke()
        }
      }
      if (cp.cajas) {
        const ahora = performance.now()
        for (const p of personas) {
          const fuera = a.excluida(p, w, h)
          const cola = a.enCola(p, w, h)
          const col = fuera ? '#8c8c7a' : cola ? '#ff9f1c' : '#C8FF00'
          ctx.lineWidth = L
          ctx.strokeStyle = col
          // Esquinas en lugar de caja completa: se lee mejor con mucha gente.
          const k = Math.min(p.w, p.h) * 0.25
          ctx.beginPath()
          for (const [x0, y0, dx, dy] of [[p.x, p.y, 1, 1], [p.x + p.w, p.y, -1, 1], [p.x, p.y + p.h, 1, -1], [p.x + p.w, p.y + p.h, -1, -1]]) {
            ctx.moveTo(x0, y0 + dy * k)
            ctx.lineTo(x0, y0)
            ctx.lineTo(x0 + dx * k, y0)
          }
          ctx.stroke()
          ctx.fillStyle = col
          ctx.beginPath()
          ctx.arc(p.pie[0], p.pie[1], L * 2.2, 0, Math.PI * 2)
          ctx.fill()
          const espera = Object.values(p.desde)[0]
          const etiqueta = cola && espera !== undefined ? `#${p.id} · ${mmss((ahora - espera) / 1000)}` : `#${p.id}`
          ctx.font = `700 ${Math.round(L * 6)}px Inter Variable, sans-serif`
          const tw = ctx.measureText(etiqueta).width
          ctx.fillRect(p.x, p.y - L * 9, tw + L * 4, L * 9)
          ctx.fillStyle = '#0d0b09'
          ctx.fillText(etiqueta, p.x + L * 2, p.y - L * 2.2)
        }
      }
      // Zona que se está dibujando.
      if (md && bd.length) {
        ctx.strokeStyle = md === 'linea' ? '#fff' : COLOR_ZONA[md]
        ctx.lineWidth = L * 1.5
        ctx.beginPath()
        bd.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)))
        ctx.stroke()
        for (const [x, y] of bd) {
          ctx.beginPath()
          ctx.arc(x * w, y * h, L * 3, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'
          ctx.fill()
        }
      }
    }

    detectar()
    dibujar()
    return () => {
      vivo = false
    }
  }, [])

  // Publica el aforo en Taberna Luna cada 15 s (web, panel y aviso de cola).
  useEffect(() => {
    const clave = leerClave()
    if (!clave) return
    const publicar = async () => {
      const v = video.current
      if (!v?.videoWidth || v.paused) return
      const l = analisis.current.lectura(performance.now(), v.videoWidth, v.videoHeight)
      try {
        await api.aforo.enviar(clave, { ocupacion: l.ocupacion, capacidad: l.capacidad, cola: l.cola, espera: Math.round(Math.max(l.esperaActual, l.esperaMedia)) })
        setPublicado({ hace: Date.now() })
      } catch (e) {
        setPublicado({ hace: Date.now(), error: (e as Error).message })
      }
    }
    const primero = setTimeout(publicar, 5000) // la primera lectura, en cuanto hay datos
    const t = setInterval(publicar, 15000)
    return () => {
      clearTimeout(primero)
      clearInterval(t)
    }
  }, [escena.id])

  // Editor de zonas: clic para añadir puntos.
  const clicLienzo = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!modo) return
    const r = ev.currentTarget.getBoundingClientRect()
    const p: Punto = [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]
    const nuevo = [...borrador, p]
    if (modo === 'linea' && nuevo.length === 2) {
      const e = { ...escena, lineas: [...escena.lineas, { id: 'l' + Date.now(), nombre: 'Línea ' + (escena.lineas.length + 1), a: nuevo[0], b: nuevo[1], sentidos: ['Pasan en un sentido', 'Pasan en el otro'] as [string, string] }] }
      aplicarEscena(e)
      setBorrador([])
      setModo(null)
      return
    }
    setBorrador(nuevo)
  }
  const aplicarEscena = (e: Escena) => {
    setEscena(e)
    analisis.current.escena = e
    analisis.current.reiniciarConteos()
  }
  const terminarZona = () => {
    if (!modo || modo === 'linea' || borrador.length < 3) return
    const n = escena.zonas.filter((z) => z.tipo === modo).length + 1
    aplicarEscena({ ...escena, zonas: [...escena.zonas, { id: 'z' + Date.now(), nombre: `${NOMBRE_ZONA[modo]} ${n}`, tipo: modo, puntos: borrador }] })
    setBorrador([])
    setModo(null)
  }

  const pct = lectura ? Math.min(100, Math.round((lectura.ocupacion / Math.max(1, lectura.capacidad)) * 100)) : 0
  const espera = lectura ? Math.max(lectura.esperaActual, lectura.esperaMedia) : 0
  const hayCola = escena.zonas.some((z) => z.tipo === 'cola')
  const chip = (activo: boolean) => `shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${activo ? 'bg-[#C8FF00] text-[#0d0b09]' : 'bg-white/8 text-white/80 ring-1 ring-white/15 hover:text-white'}`

  return (
    <main className="min-h-screen bg-[#0d0b09] pb-16 text-[#f6f1e8]">
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#C8FF00]">Visión artificial · en tu navegador</p>
            <h1 className="mt-2 font-serif text-4xl tracking-tight sm:text-5xl">Aforo y colas por cámara</h1>
            <p className="mt-2 max-w-2xl text-white/65">Una cámara del local cuenta personas, mide la cola y el tiempo de espera y dibuja por dónde pasa la gente. Taberna Luna lo publica en su web y avisa al encargado si la cola se alarga.</p>
          </div>
          <p className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-white/75 ring-1 ring-white/10">
            <span className="h-2 w-2 rounded-full bg-[#C8FF00]" /> Ninguna imagen sale de este dispositivo
          </p>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
              {ESCENAS.map((e) => (
                <button key={e.id} onClick={() => ponerFuente(e)} className={chip(escena.id === e.id)}>
                  {e.nombre}
                </button>
              ))}
              <button onClick={() => ponerFuente(escenaLibre('webcam', 'Tu cámara'))} className={chip(escena.id === 'webcam')}>
                📷 Tu cámara
              </button>
              <label className={chip(escena.id === 'archivo') + ' cursor-pointer'}>
                ⬆ Tu vídeo
                <input type="file" accept="video/*" className="hidden" onChange={(ev) => ev.target.files?.[0] && ponerFuente(escenaLibre('archivo', 'Tu vídeo'), ev.target.files[0])} />
              </label>
            </div>

            <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
              <video ref={video} muted playsInline className="hidden" />
              <canvas ref={lienzo} onClick={clicLienzo} className={`block aspect-video w-full ${modo ? 'cursor-crosshair' : ''}`} />
              {carga && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center">
                  {carga.error ? (
                    <p className="max-w-sm text-sm">{carga.error}</p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold">Cargando el modelo de visión…</p>
                      <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/15">
                        <div className="h-full bg-[#C8FF00] transition-all" style={{ width: `${Math.round(carga.p * 100)}%` }} />
                      </div>
                      <p className="text-xs text-white/60">Se descarga una vez ({precision === 'preciso' ? '18' : '10'} MB) y funciona sin conexión.</p>
                    </>
                  )}
                </div>
              )}
              {modo && (
                <div className="absolute left-3 top-3 rounded-xl bg-black/80 px-3 py-2 text-xs">
                  {modo === 'linea' ? 'Haz clic en los dos extremos de la línea de paso.' : `Haz clic para marcar los vértices de la zona «${NOMBRE_ZONA[modo]}».`}
                </div>
              )}
              <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-black/70 px-2.5 py-1 font-mono text-[11px] text-white/80">
                {rend.backend ? `${rend.backend} · ${Math.round(rend.ms)} ms · ${rend.fps.toFixed(0)} fps` : '—'}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(
                [
                  ['cajas', 'Personas'],
                  ['rastros', 'Recorridos'],
                  ['calor', 'Mapa de calor'],
                  ['zonas', 'Zonas'],
                  ['privacidad', 'Difuminar personas'],
                ] as const
              ).map(([k, t]) => (
                <button key={k} onClick={() => setCapas({ ...capas, [k]: !capas[k] })} aria-pressed={capas[k]} className={chip(capas[k])}>
                  {t}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-white/15" />
              <button onClick={() => setPrecision(precision === 'preciso' ? 'rapido' : 'preciso')} className={chip(false)} title="Modelo YOLOX-S (preciso) o YOLOX-Tiny (rápido)">
                Modelo: {precision === 'preciso' ? 'preciso' : 'rápido'}
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-bold uppercase tracking-widest text-white/50">Zonas</span>
                {(['aforo', 'cola', 'excluir', 'linea'] as const).map((m) => (
                  <button key={m} onClick={() => (setModo(modo === m ? null : m), setBorrador([]))} aria-pressed={modo === m} className={chip(modo === m)}>
                    + {m === 'linea' ? 'Línea de paso' : NOMBRE_ZONA[m]}
                  </button>
                ))}
                {modo && modo !== 'linea' && (
                  <button onClick={terminarZona} disabled={borrador.length < 3} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#0d0b09] disabled:opacity-40">
                    Terminar zona
                  </button>
                )}
                <button onClick={() => aplicarEscena({ ...escena, zonas: [], lineas: [] })} className="ml-auto text-xs font-semibold text-white/60 hover:text-white">
                  Borrar zonas
                </button>
              </div>
              <p className="mt-2 text-xs text-white/55">{escena.descripcion}</p>
              <label className="mt-3 flex items-center gap-3 text-xs text-white/70">
                Aforo máximo
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={escena.capacidad}
                  onChange={(e) => aplicarEscena({ ...escena, capacidad: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-20 rounded-lg bg-black/40 px-2 py-1 text-white ring-1 ring-white/15"
                />
                personas
              </label>
            </div>
          </div>

          {/* Cifras */}
          <aside className="space-y-4">
            <section className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <p className="text-xs font-bold uppercase tracking-widest text-white/50">Aforo ahora</p>
              <p className="mt-1 font-serif text-6xl leading-none">
                {lectura?.ocupacion ?? 0}
                <span className="text-2xl text-white/45"> / {escena.capacidad}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: pct >= 90 ? '#ff5a3c' : pct >= 70 ? '#ff9f1c' : '#C8FF00' }} />
              </div>
              <p className="mt-2 text-sm text-white/70">{pct} % de ocupación · {lectura?.total ?? 0} personas en imagen</p>
              <Grafico serie={serie} capacidad={escena.capacidad} />
            </section>

            {hayCola && (
              <section className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <p className="text-xs font-bold uppercase tracking-widest text-[#ff9f1c]">Cola</p>
                <div className="mt-1 flex items-end gap-6">
                  <p className="font-serif text-5xl leading-none">{lectura?.cola ?? 0}</p>
                  <div className="pb-1 text-sm text-white/70">
                    <p>
                      Espera: <b className="text-white">{mmss(espera)}</b>
                    </p>
                    <p className="text-xs">media de los que ya pasaron: {mmss(lectura?.esperaMedia ?? 0)}</p>
                  </div>
                </div>
              </section>
            )}

            {escena.lineas.length > 0 && (
              <section className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <p className="text-xs font-bold uppercase tracking-widest text-white/50">Pasos por línea</p>
                {escena.lineas.map((l) => (
                  <div key={l.id} className="mt-3">
                    <p className="text-sm font-semibold">{l.nombre}</p>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
                      {l.sentidos.map((s, i) => (
                        <div key={s} className="rounded-xl bg-black/30 px-3 py-2">
                          <p className="font-serif text-3xl leading-none">{lectura?.pasos[l.id]?.[i] ?? 0}</p>
                          <p className="mt-1 text-xs text-white/60">{s}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section className="rounded-2xl bg-[#C8FF00]/10 p-5 ring-1 ring-[#C8FF00]/30">
              <p className="text-xs font-bold uppercase tracking-widest text-[#C8FF00]">Conectado con Taberna Luna</p>
              {leerClave() ? (
                <p className="mt-2 text-sm text-white/80">
                  Cada 15 s el aforo se publica en la web del restaurante y en su panel. Si la espera supera el umbral, n8n avisa al encargado.
                  {publicado && <span className={`mt-2 block text-xs ${publicado.error ? 'text-[#ff9f1c]' : 'text-white/60'}`}>{publicado.error ? `No se pudo publicar: ${publicado.error}` : `✓ Publicado a las ${new Date(publicado.hace).toLocaleTimeString('es-ES')}`}</span>}
                </p>
              ) : (
                <p className="mt-2 text-sm text-white/80">Entra en el panel del restaurante en este dispositivo para publicar el aforo en la web.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <a href="/" onClick={alClicar('/')} className="rounded-full bg-white/10 px-3 py-1.5 hover:bg-white/20">
                  Ver la web ↗
                </a>
                <a href="/admin" onClick={alClicar('/admin')} className="rounded-full bg-white/10 px-3 py-1.5 hover:bg-white/20">
                  Ver el panel ↗
                </a>
                <a href="/admin/automatizaciones" onClick={alClicar('/admin/automatizaciones')} className="rounded-full bg-white/10 px-3 py-1.5 hover:bg-white/20">
                  Ver el aviso ↗
                </a>
              </div>
            </section>
          </aside>
        </div>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['1 · Detecta', 'YOLOX encuentra a cada persona en el fotograma, con la GPU del propio dispositivo (WebGPU).'],
            ['2 · Sigue', 'Cada persona conserva su número entre fotogramas: así se sabe cuánto lleva en la cola o si ha cruzado la puerta.'],
            ['3 · Mide', 'Aforo por zonas, cola y espera, entradas y salidas, y un mapa de calor de por dónde pasa la gente.'],
            ['4 · Actúa', 'Las cifras (nunca la imagen) se publican en la web y n8n avisa al encargado si la cola se alarga.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <p className="font-semibold text-[#C8FF00]">{t}</p>
              <p className="mt-1 text-sm text-white/70">{d}</p>
            </div>
          ))}
        </section>
        <p className="mt-6 text-xs text-white/45">
          Privacidad: el vídeo se analiza en el navegador y no se graba ni se envía; solo salen cifras anónimas. En un local real hay que colocar el cartel de zona videovigilada. {escena.credito ? `${escena.credito}.` : ''} Detector YOLOX (Megvii, Apache 2.0) con ONNX Runtime Web.
        </p>
      </div>
    </main>
  )
}

function Grafico({ serie, capacidad }: { serie: { ocupacion: number; cola: number }[]; capacidad: number }) {
  if (serie.length < 2) return <div className="mt-4 h-20 rounded-xl bg-black/30" />
  const W = 300
  const H = 80
  const max = Math.max(capacidad, ...serie.map((s) => s.ocupacion), 1)
  const x = (i: number) => (i / (serie.length - 1)) * W
  const y = (v: number) => H - (v / max) * (H - 6) - 3
  const linea = (k: 'ocupacion' | 'cola') => serie.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-20 w-full rounded-xl bg-black/30" role="img" aria-label="Evolución del aforo">
      <line x1={0} x2={W} y1={y(capacidad)} y2={y(capacidad)} stroke="#ff5a3c" strokeDasharray="4 4" strokeWidth={1} />
      <path d={linea('ocupacion') + `L${W},${H}L0,${H}Z`} fill="#C8FF0022" />
      <path d={linea('ocupacion')} fill="none" stroke="#C8FF00" strokeWidth={2} />
      {serie.some((s) => s.cola) && <path d={linea('cola')} fill="none" stroke="#ff9f1c" strokeWidth={1.5} />}
    </svg>
  )
}

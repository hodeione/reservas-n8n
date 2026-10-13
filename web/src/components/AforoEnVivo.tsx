import { useEffect, useState } from 'react'
import { api, type EstadoAforo } from '../lib/api'
import { alClicar } from '../lib/util'

/** Lee el aforo que publica la cámara del local, cada 20 s. */
export function useAforo() {
  const [a, setA] = useState<EstadoAforo | null>(null)
  useEffect(() => {
    let vivo = true
    const leer = () => api.aforo.estado().then((x) => vivo && setA(x)).catch(() => {})
    leer()
    const t = setInterval(leer, 20000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [])
  return a
}

const COLOR = { tranquilo: '#5f6b3a', animado: '#c99a2e', 'casi lleno': '#b4532a', lleno: '#8f3f1d' }
const min = (s = 0) => (s < 60 ? 'menos de 1 min' : `${Math.round(s / 60)} min`)

/** Indicador público: «Ahora mismo: animado · 55 %». */
export function AforoPublico() {
  const a = useAforo()
  if (!a?.hay) return null
  return (
    <p className="mt-6 flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-papel px-4 py-3 text-sm shadow-sm ring-1 ring-linea">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: COLOR[a.nivel!] }} />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: COLOR[a.nivel!] }} />
      </span>
      <b>Ahora mismo: {a.nivel}</b>
      <span className="text-gris">
        {a.porcentaje} % del local{a.cola ? ` · cola en barra de ${a.cola} (${min(a.espera)})` : ''}
      </span>
    </p>
  )
}

/** Tarjeta del panel del restaurante. */
export function AforoPanel() {
  const a = useAforo()
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-tinta p-4 text-crema">
      <span className="text-xs font-bold uppercase tracking-widest text-oro">📷 Cámara del local</span>
      {a?.hay ? (
        <>
          <span>
            <b className="text-2xl tabular-nums">{a.ocupacion}</b>
            <span className="text-crema/60"> / {a.capacidad} personas · {a.porcentaje} %</span>
          </span>
          <span className={a.cola ? 'text-oro' : 'text-crema/60'}>
            Cola: <b>{a.cola}</b> · espera {min(a.espera)}
          </span>
          <span className="text-xs text-crema/50">hace {a.hace} s</span>
        </>
      ) : (
        <span className="text-sm text-crema/70">Sin lectura reciente. Abre la cámara en un dispositivo del local para medir el aforo y la cola.</span>
      )}
      <a href="/aforo" onClick={alClicar('/aforo')} className="ml-auto rounded-full bg-crema/10 px-3 py-1.5 text-xs font-semibold hover:bg-crema/20">
        Abrir la cámara →
      </a>
    </div>
  )
}

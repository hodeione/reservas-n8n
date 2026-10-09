import { useEffect, useRef, type ReactNode } from 'react'
import type { Plato, Restaurante } from '../lib/api'
import { ALERGENOS, DIAS, alClicar, euros, useRuta } from '../lib/util'
import { Modelo3D } from './Modelo3D'
import { credito, esReal, urlMiniatura } from '../lib/modelos'

export function Cabecera({ r }: { r: Restaurante }) {
  const ruta = useRuta()
  const link = (href: string, texto: string) => (
    <a href={href} onClick={alClicar(href)} className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${ruta === href ? 'bg-tinta text-crema' : 'hover:bg-linea/60'}`}>
      {texto}
    </a>
  )
  return (
    <header className="sticky top-0 z-30 border-b border-linea/70 bg-crema/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a href="/" onClick={alClicar('/')} className="flex items-center gap-2 font-serif text-xl font-semibold tracking-tight sm:text-2xl">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tinta text-oro">☾</span>
          {r.nombre}
        </a>
        <nav className="flex items-center gap-1">
          {link('/carta', 'Carta')}
          <a href="/#contacto" className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-linea/60 sm:inline">Contacto</a>
          <a href="/reservar" onClick={alClicar('/reservar')} className="ml-1 rounded-full bg-teja px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teja-osc">
            Reservar
          </a>
        </nav>
      </div>
    </header>
  )
}

export function Pie({ r }: { r: Restaurante }) {
  return (
    <footer className="mt-20 border-t border-linea bg-tinta text-crema/80">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3 sm:px-6">
        <div>
          <p className="font-serif text-2xl text-crema">{r.nombre}</p>
          <p className="mt-2 text-sm">{r.eslogan}</p>
        </div>
        <div className="text-sm">
          <p>{r.direccion}</p>
          {r.telefono && <a className="mt-1 block hover:text-white" href={`tel:${r.telefono.replace(/\s/g, '')}`}>{r.telefono}</a>}
          {r.email && <a className="mt-1 block hover:text-white" href={`mailto:${r.email}`}>{r.email}</a>}
          {r.instagram && <a className="mt-1 block hover:text-white" href={`https://instagram.com/${r.instagram}`} target="_blank" rel="noopener noreferrer">@{r.instagram}</a>}
        </div>
        <div className="text-sm sm:text-right">
          <a href="/carta" onClick={alClicar('/carta')} className="block hover:text-white">Carta digital</a>
          <a href="/reservar" onClick={alClicar('/reservar')} className="mt-1 block hover:text-white">Reservar mesa</a>
          <a href="/admin" className="mt-6 block text-xs text-crema/40 hover:text-crema/80">Acceso del restaurante</a>
        </div>
      </div>
    </footer>
  )
}

/** "De martes a domingo · Comida 13:00–15:00 · Cena 20:00–22:00" */
export function horario(r: Restaurante) {
  const abiertos = [1, 2, 3, 4, 5, 6, 7].filter((d) => !r.cerrado.includes(d))
  let dias = abiertos.map((d) => DIAS[d - 1].toLowerCase()).join(', ')
  // Rango consecutivo (p. ej. martes a domingo).
  if (abiertos.length >= 3 && abiertos.every((d, i) => i === 0 || d === abiertos[i - 1] + 1)) {
    dias = `de ${DIAS[abiertos[0] - 1].toLowerCase()} a ${DIAS[abiertos.at(-1)! - 1].toLowerCase()}`
  }
  if (abiertos.length === 7) dias = 'todos los días'
  const turno = (h: string[], dur: number) => {
    if (!h.length) return ''
    const [hh, mm] = h.at(-1)!.split(':').map(Number)
    const fin = hh * 60 + mm + dur
    return `${h[0]}–${String(Math.floor(fin / 60) % 24).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`
  }
  return {
    dias: dias.charAt(0).toUpperCase() + dias.slice(1),
    comida: turno(r.horas.comida, r.duracion.comida),
    cena: turno(r.horas.cena, r.duracion.cena),
    cerrado: r.cerrado.length ? r.cerrado.map((d) => DIAS[d - 1]).join(', ') : '',
  }
}

export function Alergenos({ lista, compacto = false }: { lista: string[]; compacto?: boolean }) {
  if (!lista.length) return compacto ? null : <p className="text-sm text-gris">Sin alérgenos declarados.</p>
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Alérgenos">
      {lista.map((a) => (
        <li key={a} title={ALERGENOS[a]?.nombre} className={`inline-flex items-center gap-1 rounded-full bg-linea/60 ${compacto ? 'px-1.5 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'}`}>
          <span aria-hidden="true">{ALERGENOS[a]?.icono}</span>
          {!compacto && ALERGENOS[a]?.nombre}
          {compacto && <span className="sr-only">{ALERGENOS[a]?.nombre}</span>}
        </li>
      ))}
    </ul>
  )
}

export function Imagen({ p, className = '' }: { p: Plato; className?: string }) {
  const src = p.imagen || (p.modelo ? urlMiniatura(p.modelo) : '')
  if (!src) return <div className={`flex items-center justify-center bg-linea/50 text-3xl ${className}`}>🍽️</div>
  return <img src={src} alt="" loading="lazy" className={`object-contain ${className}`} />
}

/** Ficha de un plato con su modelo 3D, a pantalla completa en el móvil. */
export function FichaPlato({ p, onCerrar, onServir }: { p: Plato; onCerrar: () => void; onServir?: (p: Plato) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    ref.current?.focus()
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', esc)
    }
  }, [onCerrar])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-tinta/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onCerrar}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={p.nombre}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-papel shadow-2xl outline-none sm:rounded-3xl md:flex-row"
      >
        <button onClick={onCerrar} aria-label="Cerrar" className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-xl shadow">×</button>
        <div className="relative h-[46vh] shrink-0 bg-[radial-gradient(circle_at_50%_40%,#fff,#efe6d8)] md:h-auto md:w-1/2">
          {p.modelo ? <Modelo3D modelo={p.modelo} nombre={p.nombre} ar className="h-full w-full" /> : <Imagen p={p} className="h-full w-full p-8" />}
          {p.modelo && <p className="pointer-events-none absolute left-0 right-0 top-3 text-center text-xs text-gris">{esReal(p.modelo) ? 'Escaneo 3D del plato · gíralo con el dedo' : 'Gíralo con el dedo'}</p>}
        </div>
        <div className="overflow-y-auto p-6 md:w-1/2">
          <h2 className="font-serif text-3xl leading-tight">{p.nombre}</h2>
          <p className="mt-1 text-2xl font-semibold text-teja">{euros(p.precio)}</p>
          {p.etiquetas.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.etiquetas.map((e) => <span key={e} className="rounded-full bg-oliva/15 px-2.5 py-1 text-xs font-semibold text-oliva">{e}</span>)}
            </div>
          )}
          <p className="mt-4 leading-relaxed text-tinta/85">{p.descripcion}</p>
          <h3 className="mb-2 mt-6 text-xs font-bold uppercase tracking-widest text-gris">Alérgenos</h3>
          <Alergenos lista={p.alergenos} />
          {p.modelo && onServir && (
            <button onClick={() => onServir(p)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-tinta px-5 py-3.5 font-semibold text-crema">
              🍽️ Sírvelo en tu plato
            </button>
          )}
          {p.modelo && onServir && <p className="mt-2 text-center text-xs text-gris">Apunta con la cámara a un plato vacío y verás cómo llega a tu mesa.</p>}
          {p.modelo && credito(p.modelo) && (
            <p className="mt-5 text-[11px] text-gris">
              Escaneo 3D «{credito(p.modelo).titulo}» de{' '}
              <a className="underline" href={credito(p.modelo).url} target="_blank" rel="noopener noreferrer">
                {credito(p.modelo).autor}
              </a>{' '}
              ({credito(p.modelo).licencia}).
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export function Seccion({ id, titulo, sub, children }: { id?: string; titulo: string; sub?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-20 sm:px-6">
      <h2 className="font-serif text-4xl tracking-tight sm:text-5xl">{titulo}</h2>
      {sub && <p className="mt-2 max-w-2xl text-gris">{sub}</p>}
      <div className="mt-8">{children}</div>
    </section>
  )
}

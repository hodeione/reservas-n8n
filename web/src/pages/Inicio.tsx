import { useState } from 'react'
import { FichaPlato, Imagen, Seccion, horario } from '../components/Sitio'
import { Modelo3D } from '../components/Modelo3D'
import type { DatosWeb, Plato } from '../lib/api'
import { alClicar, euros, useTitulo } from '../lib/util'

export function Inicio({ d }: { d: DatosWeb }) {
  const r = d.restaurante
  useTitulo(`${r.nombre} · ${r.eslogan || 'Restaurante'}`)
  const destacados = d.carta.platos.filter((p) => p.destacado)
  const estrella = destacados.find((p) => p.modelo) ?? d.carta.platos.find((p) => p.modelo)
  const [ficha, setFicha] = useState<Plato | null>(null)
  const h = horario(r)
  const mapa = `https://www.openstreetmap.org/export/embed.html?bbox=${r.lng - 0.004}%2C${r.lat - 0.0025}%2C${r.lng + 0.004}%2C${r.lat + 0.0025}&layer=mapnik&marker=${r.lat}%2C${r.lng}`

  return (
    <main>
      {/* Portada */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_80%_20%,#f3dcc4,transparent_70%),radial-gradient(40rem_20rem_at_0%_100%,#e9e0cc,transparent_70%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-6 px-4 pb-10 pt-10 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-teja">{r.direccion.split(',').slice(-1)[0]?.replace(/\d+/g, '').trim() || 'Restaurante'}</p>
            <h1 className="mt-3 font-serif text-6xl leading-[0.95] tracking-tight sm:text-7xl md:text-8xl">{r.nombre}</h1>
            <p className="mt-5 max-w-lg text-lg text-tinta/75 sm:text-xl">{r.eslogan}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/reservar" onClick={alClicar('/reservar')} className="rounded-full bg-teja px-7 py-4 text-base font-semibold text-white shadow-lg shadow-teja/25 transition-colors hover:bg-teja-osc">
                Reservar mesa
              </a>
              <a href="/carta" onClick={alClicar('/carta')} className="rounded-full border border-tinta/20 bg-papel/70 px-7 py-4 text-base font-semibold transition-colors hover:border-tinta">
                Ver la carta en 3D
              </a>
            </div>
            <p className="mt-6 text-sm text-gris">
              {h.dias} · {[h.comida && `comida ${h.comida}`, h.cena && `cena ${h.cena}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          {estrella && (
            <button onClick={() => setFicha(estrella)} className="group relative mx-auto aspect-square w-full max-w-md text-left" aria-label={`Ver ${estrella.nombre} en 3D`}>
              <div className="absolute inset-6 rounded-full bg-papel shadow-[0_40px_80px_-30px_rgba(43,33,24,.35)]" />
              <Modelo3D modelo={estrella.modelo} nombre={estrella.nombre} controles={false} className="absolute inset-0 h-full w-full" />
              <div className="absolute bottom-4 left-1/2 w-max -translate-x-1/2 rounded-full bg-tinta px-4 py-2 text-sm text-crema shadow-lg transition-transform group-hover:-translate-y-1">
                {estrella.nombre} · {euros(estrella.precio)} <span className="text-oro">→ 3D</span>
              </div>
            </button>
          )}
        </div>
      </section>

      {/* La casa */}
      <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
        <div className="grid gap-8 rounded-[2rem] bg-tinta p-8 text-crema sm:p-12 md:grid-cols-[1fr_1.4fr]">
          <h2 className="font-serif text-4xl leading-tight sm:text-5xl">Nuestra casa</h2>
          <p className="text-lg leading-relaxed text-crema/80">{r.descripcion}</p>
        </div>
      </section>

      {/* Destacados */}
      {destacados.length > 0 && (
        <Seccion titulo="Lo que más se pide" sub="Toca un plato para verlo en 3D. Desde el móvil puedes colocarlo sobre tu mesa.">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {destacados.map((p) => (
              <button key={p.id} onClick={() => setFicha(p)} className="group overflow-hidden rounded-3xl bg-papel text-left shadow-sm ring-1 ring-linea transition-shadow hover:shadow-lg">
                <div className="aspect-square bg-[radial-gradient(circle_at_50%_40%,#fff,#efe6d8)] p-4">
                  <Imagen p={p} className="h-full w-full transition-transform duration-500 group-hover:scale-110" />
                </div>
                <div className="p-4">
                  <p className="font-semibold leading-snug">{p.nombre}</p>
                  <p className="mt-1 text-sm text-gris">{euros(p.precio)} · <span className="text-teja">ver en 3D</span></p>
                </div>
              </button>
            ))}
          </div>
          <a href="/carta" onClick={alClicar('/carta')} className="mt-6 inline-block font-semibold text-teja underline-offset-4 hover:underline">Ver la carta completa →</a>
        </Seccion>
      )}

      {/* Horario y ubicación */}
      <Seccion id="contacto" titulo="Horario y ubicación">
        <div className="grid gap-6 md:grid-cols-[1fr_1.3fr]">
          <div className="rounded-3xl bg-papel p-6 ring-1 ring-linea">
            <dl className="space-y-4">
              <div><dt className="text-xs font-bold uppercase tracking-widest text-gris">Abrimos</dt><dd className="mt-1 text-lg font-semibold">{h.dias}</dd></div>
              {h.comida && <div><dt className="text-xs font-bold uppercase tracking-widest text-gris">Comidas</dt><dd className="mt-1 text-lg">{h.comida}</dd></div>}
              {h.cena && <div><dt className="text-xs font-bold uppercase tracking-widest text-gris">Cenas</dt><dd className="mt-1 text-lg">{h.cena}</dd></div>}
              {h.cerrado && <div><dt className="text-xs font-bold uppercase tracking-widest text-gris">Descanso</dt><dd className="mt-1">{h.cerrado}</dd></div>}
              <div><dt className="text-xs font-bold uppercase tracking-widest text-gris">Dirección</dt><dd className="mt-1">{r.direccion}</dd></div>
              {r.telefono && <div><dt className="text-xs font-bold uppercase tracking-widest text-gris">Teléfono</dt><dd className="mt-1"><a className="font-semibold text-teja" href={`tel:${r.telefono.replace(/\s/g, '')}`}>{r.telefono}</a></dd></div>}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="/reservar" onClick={alClicar('/reservar')} className="rounded-full bg-teja px-5 py-3 text-sm font-semibold text-white">Reservar mesa</a>
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.nombre + ' ' + r.direccion)}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-tinta/20 px-5 py-3 text-sm font-semibold">Cómo llegar</a>
            </div>
          </div>
          <iframe title={`Mapa de ${r.nombre}`} src={mapa} loading="lazy" className="h-80 w-full rounded-3xl ring-1 ring-linea md:h-full" />
        </div>
      </Seccion>

      {ficha && <FichaPlato p={ficha} onCerrar={() => setFicha(null)} />}
    </main>
  )
}

import { useMemo, useState } from 'react'
import { Alergenos, FichaPlato, Imagen } from '../components/Sitio'
import type { DatosWeb, Plato } from '../lib/api'
import { ALERGENOS, euros, useTitulo } from '../lib/util'

const FILTROS = ['vegetariano', 'vegano', 'sin gluten']

export function Carta({ d }: { d: DatosWeb }) {
  useTitulo(`Carta · ${d.restaurante.nombre}`)
  const [ficha, setFicha] = useState<Plato | null>(null)
  const [etiqueta, setEtiqueta] = useState('')
  const [sin, setSin] = useState<string[]>([])
  const [verFiltros, setVerFiltros] = useState(false)

  const platos = useMemo(
    () => d.carta.platos.filter((p) => (!etiqueta || p.etiquetas.includes(etiqueta)) && !sin.some((a) => p.alergenos.includes(a))),
    [d.carta.platos, etiqueta, sin],
  )
  const categorias = d.carta.categorias.filter((c) => platos.some((p) => p.categoria === c.id))
  const ir = (id: string) => document.getElementById('cat-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const filtrando = etiqueta || sin.length

  return (
    <main className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
      <div className="pt-8 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-teja">Carta digital</p>
        <h1 className="mt-2 font-serif text-5xl tracking-tight">{d.restaurante.nombre}</h1>
        <p className="mt-2 text-gris">Toca cualquier plato para verlo en 3D y sus alérgenos.</p>
      </div>

      {/* Secciones y filtros, siempre a mano */}
      <div className="sticky top-[57px] z-20 -mx-4 mt-6 border-b border-linea bg-crema/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {categorias.map((c) => (
            <button key={c.id} onClick={() => ir(c.id)} className="shrink-0 rounded-full bg-papel px-4 py-2 text-sm font-semibold ring-1 ring-linea hover:ring-tinta">
              {c.nombre}
            </button>
          ))}
          <button onClick={() => setVerFiltros((v) => !v)} aria-expanded={verFiltros} className={`ml-auto shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${filtrando ? 'bg-teja text-white' : 'bg-tinta text-crema'}`}>
            {filtrando ? 'Filtros activos' : 'Alergias y dietas'}
          </button>
        </div>
        {verFiltros && (
          <div className="mt-3 rounded-2xl bg-papel p-4 ring-1 ring-linea">
            <p className="text-xs font-bold uppercase tracking-widest text-gris">Mostrar solo</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {FILTROS.map((f) => (
                <button key={f} onClick={() => setEtiqueta(etiqueta === f ? '' : f)} aria-pressed={etiqueta === f} className={`rounded-full px-3 py-1.5 text-sm font-medium ${etiqueta === f ? 'bg-oliva text-white' : 'bg-linea/60'}`}>
                  {f}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs font-bold uppercase tracking-widest text-gris">Ocultar platos con</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(ALERGENOS).map(([k, a]) => (
                <button key={k} onClick={() => setSin(sin.includes(k) ? sin.filter((x) => x !== k) : [...sin, k])} aria-pressed={sin.includes(k)} className={`rounded-full px-3 py-1.5 text-sm ${sin.includes(k) ? 'bg-teja text-white' : 'bg-linea/60'}`}>
                  {a.icono} {a.nombre}
                </button>
              ))}
            </div>
            {filtrando ? <button onClick={() => (setEtiqueta(''), setSin([]))} className="mt-4 text-sm font-semibold text-teja">Quitar filtros</button> : null}
          </div>
        )}
      </div>

      {categorias.length === 0 && <p className="mt-10 text-center text-gris">Ningún plato cumple esos filtros.</p>}
      {categorias.map((c) => (
        <section key={c.id} id={'cat-' + c.id} className="scroll-mt-36 pt-10">
          <h2 className="font-serif text-3xl">{c.nombre}</h2>
          <ul className="mt-4 divide-y divide-linea">
            {platos.filter((p) => p.categoria === c.id).map((p) => (
              <li key={p.id}>
                <button onClick={() => setFicha(p)} className="flex w-full items-center gap-4 py-4 text-left">
                  <div className="relative h-20 w-20 shrink-0 rounded-2xl bg-[radial-gradient(circle_at_50%_40%,#fff,#efe6d8)] p-2">
                    <Imagen p={p} className="h-full w-full" />
                    {p.modelo && <span className="absolute -bottom-1 -right-1 rounded-full bg-tinta px-1.5 py-0.5 text-[10px] font-bold text-oro">3D</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold leading-snug">{p.nombre}</p>
                      <p className="shrink-0 font-semibold text-teja">{euros(p.precio)}</p>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-gris">{p.descripcion}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {p.etiquetas.map((e) => <span key={e} className="rounded-full bg-oliva/15 px-2 py-0.5 text-[11px] font-semibold text-oliva">{e}</span>)}
                      <Alergenos lista={p.alergenos} compacto />
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="mt-10 text-center text-xs text-gris">Si tienes alguna alergia, avisa al personal antes de pedir. Los modelos 3D son orientativos.</p>
      {ficha && <FichaPlato p={ficha} onCerrar={() => setFicha(null)} />}
    </main>
  )
}

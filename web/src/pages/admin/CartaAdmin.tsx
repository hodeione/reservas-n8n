import { useState } from 'react'
import { Modelo3D } from '../../components/Modelo3D'
import { Imagen } from '../../components/Sitio'
import { BarraGuardar, Campo, Interruptor, Modal, Tarjeta, entrada, useBorrador } from '../../components/ui'
import { api, type Carta, type DatosAdmin, type Plato } from '../../lib/api'
import { ALERGENOS, euros } from '../../lib/util'
import { esReal, nombreModelo, urlMiniatura } from '../../lib/modelos'


const mover = <T,>(l: T[], i: number, d: number) => {
  const j = i + d
  if (j < 0 || j >= l.length) return l
  const c = [...l]
  ;[c[i], c[j]] = [c[j], c[i]]
  return c
}

interface Props {
  clave: string
  datos: DatosAdmin
  onGuardado: (c: Carta) => void
}

export function CartaAdmin({ clave, datos, onGuardado }: Props) {
  const { borrador: carta, setBorrador: setCarta, cambios, guardando, guardar, descartar } = useBorrador<Carta>(datos.carta, async (v) => {
    const r = await api.admin.guardar<Carta>(clave, 'carta', v)
    onGuardado(r.valor)
    return r.valor
  })
  const [editando, setEditando] = useState<Plato | null>(null)
  const [esNuevo, setEsNuevo] = useState(false)
  const [nuevaSeccion, setNuevaSeccion] = useState('')

  const setPlatos = (platos: Plato[]) => setCarta({ ...carta, platos })
  const cambiarPlato = (id: string, parcial: Partial<Plato>) => setPlatos(carta.platos.map((p) => (p.id === id ? { ...p, ...parcial } : p)))

  function crear(categoria: string) {
    const ids = new Set(carta.platos.map((p) => p.id))
    let n = carta.platos.length + 1
    while (ids.has('p' + n)) n++
    setEsNuevo(true)
    setEditando({ id: 'p' + n, categoria, nombre: '', descripcion: '', precio: 0, alergenos: [], etiquetas: [], modelo: '', imagen: '', disponible: true, destacado: false })
  }

  function anadirSeccion() {
    const nombre = nuevaSeccion.trim()
    if (!nombre) return
    const base = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'seccion'
    let id = base
    while (carta.categorias.some((c) => c.id === id)) id += '-2'
    setCarta({ ...carta, categorias: [...carta.categorias, { id, nombre }] })
    setNuevaSeccion('')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-3xl sm:text-4xl">Carta</h1>
        <p className="text-sm text-gris">
          {carta.platos.length} platos en {carta.categorias.length} secciones. Lo que cambies aquí se ve en la carta digital y en el QR de las mesas.
        </p>
      </div>

      {carta.categorias.map((c, ci) => {
        const platos = carta.platos.filter((p) => p.categoria === c.id)
        return (
          <Tarjeta key={c.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={c.nombre}
                aria-label="Nombre de la sección"
                onChange={(e) => setCarta({ ...carta, categorias: carta.categorias.map((x) => (x.id === c.id ? { ...x, nombre: e.target.value } : x)) })}
                className="min-w-0 flex-1 rounded-xl border border-transparent bg-transparent px-2 py-1 font-serif text-2xl outline-none hover:border-linea focus:border-teja focus:bg-white"
              />
              <div className="flex gap-1">
                <button onClick={() => setCarta({ ...carta, categorias: mover(carta.categorias, ci, -1) })} disabled={ci === 0} className="h-9 w-9 rounded-full ring-1 ring-linea disabled:opacity-30" aria-label="Subir sección">
                  ↑
                </button>
                <button onClick={() => setCarta({ ...carta, categorias: mover(carta.categorias, ci, 1) })} disabled={ci === carta.categorias.length - 1} className="h-9 w-9 rounded-full ring-1 ring-linea disabled:opacity-30" aria-label="Bajar sección">
                  ↓
                </button>
                <button
                  onClick={() => {
                    if (platos.length && !confirm(`La sección «${c.nombre}» tiene ${platos.length} platos. ¿Borrarla con sus platos?`)) return
                    setCarta({ categorias: carta.categorias.filter((x) => x.id !== c.id), platos: carta.platos.filter((p) => p.categoria !== c.id) })
                  }}
                  className="h-9 rounded-full px-3 text-sm font-semibold text-teja ring-1 ring-teja/30"
                >
                  Borrar
                </button>
              </div>
            </div>
            <ul className="divide-y divide-linea">
              {platos.map((p) => {
                const i = carta.platos.indexOf(p)
                const hermanos = platos.map((x) => carta.platos.indexOf(x))
                const pos = hermanos.indexOf(i)
                const intercambiar = (d: number) => {
                  const j = hermanos[pos + d]
                  if (j === undefined) return
                  const l = [...carta.platos]
                  ;[l[i], l[j]] = [l[j], l[i]]
                  setPlatos(l)
                }
                return (
                  <li key={p.id} className={`flex items-center gap-3 py-3 ${p.disponible ? '' : 'opacity-55'}`}>
                    <button onClick={() => (setEsNuevo(false), setEditando(p))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div className="h-14 w-14 shrink-0 rounded-xl bg-crema p-1.5">
                        <Imagen p={p} className="h-full w-full" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {p.destacado && <span className="text-oro">★ </span>}
                          {p.nombre}
                        </p>
                        <p className="text-sm text-gris">
                          {euros(p.precio)}
                          {p.alergenos.length > 0 && ` · ${p.alergenos.map((a) => ALERGENOS[a]?.icono).join('')}`}
                          {!p.disponible && ' · agotado'}
                        </p>
                      </div>
                    </button>
                    <label className="hidden items-center gap-2 text-xs font-semibold text-gris sm:flex">
                      <input type="checkbox" checked={p.disponible} onChange={(e) => cambiarPlato(p.id, { disponible: e.target.checked })} className="h-4 w-4 accent-oliva" />
                      Disponible
                    </label>
                    <div className="flex flex-col">
                      <button onClick={() => intercambiar(-1)} disabled={pos === 0} className="px-2 text-sm disabled:opacity-20" aria-label="Subir plato">
                        ▲
                      </button>
                      <button onClick={() => intercambiar(1)} disabled={pos === platos.length - 1} className="px-2 text-sm disabled:opacity-20" aria-label="Bajar plato">
                        ▼
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <button onClick={() => crear(c.id)} className="mt-3 w-full rounded-xl border-2 border-dashed border-linea py-3 text-sm font-semibold text-gris hover:border-teja hover:text-teja">
              + Añadir plato a {c.nombre || 'esta sección'}
            </button>
          </Tarjeta>
        )
      })}

      <Tarjeta titulo="Nueva sección">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            anadirSeccion()
          }}
          className="flex gap-2"
        >
          <input value={nuevaSeccion} onChange={(e) => setNuevaSeccion(e.target.value)} placeholder="Por ejemplo: Raciones, Vinos, Menú del día…" className={entrada} maxLength={40} />
          <button className="shrink-0 rounded-xl bg-tinta px-5 font-semibold text-crema">Añadir</button>
        </form>
      </Tarjeta>

      {editando && (
        <EditarPlato
          plato={editando}
          nuevo={esNuevo}
          categorias={carta.categorias}
          opciones={datos.opciones}
          onCerrar={() => setEditando(null)}
          onBorrar={() => {
            setPlatos(carta.platos.filter((p) => p.id !== editando.id))
            setEditando(null)
          }}
          onListo={(p) => {
            setPlatos(esNuevo ? [...carta.platos, p] : carta.platos.map((x) => (x.id === p.id ? p : x)))
            setEditando(null)
          }}
        />
      )}

      <BarraGuardar cambios={cambios} guardando={guardando} onGuardar={guardar} onDescartar={descartar} />
    </div>
  )
}

function EditarPlato({
  plato,
  nuevo,
  categorias,
  opciones,
  onCerrar,
  onBorrar,
  onListo,
}: {
  plato: Plato
  nuevo: boolean
  categorias: Carta['categorias']
  opciones: DatosAdmin['opciones']
  onCerrar: () => void
  onBorrar: () => void
  onListo: (p: Plato) => void
}) {
  const [p, setP] = useState<Plato>(plato)
  const [precio, setPrecio] = useState(plato.precio ? String(plato.precio).replace('.', ',') : '')
  const set = <K extends keyof Plato>(k: K, v: Plato[K]) => setP({ ...p, [k]: v })
  const alternar = (k: 'alergenos' | 'etiquetas', v: string) => set(k, p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v])

  return (
    <Modal titulo={nuevo ? 'Nuevo plato' : 'Editar plato'} onCerrar={onCerrar} ancho="max-w-3xl">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onListo({ ...p, nombre: p.nombre.trim(), precio: Math.round((Number(precio.replace(',', '.')) || 0) * 100) / 100 })
        }}
        className="grid gap-5 md:grid-cols-[1fr_260px]"
      >
        <div className="space-y-4">
          <Campo etiqueta="Nombre del plato">
            <input required value={p.nombre} maxLength={80} onChange={(e) => set('nombre', e.target.value)} className={entrada} autoFocus={nuevo} />
          </Campo>
          <Campo etiqueta="Descripción" ayuda="Una o dos frases. Es lo que lee el cliente.">
            <textarea rows={3} value={p.descripcion} maxLength={300} onChange={(e) => set('descripcion', e.target.value)} className={entrada} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Precio (€)">
              <input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="12,50" className={entrada} />
            </Campo>
            <Campo etiqueta="Sección">
              <select value={p.categoria} onChange={(e) => set('categoria', e.target.value)} className={entrada}>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
          <div>
            <span className="mb-1 block text-sm font-semibold">Alérgenos</span>
            <p className="mb-2 text-xs text-gris">Marca todos los que lleve. Es obligatorio informar de ellos.</p>
            <div className="flex flex-wrap gap-1.5">
              {opciones.alergenos.map((a) => (
                <button type="button" key={a} onClick={() => alternar('alergenos', a)} aria-pressed={p.alergenos.includes(a)} className={`rounded-full px-3 py-1.5 text-sm ${p.alergenos.includes(a) ? 'bg-teja text-white' : 'bg-crema ring-1 ring-linea'}`}>
                  {ALERGENOS[a]?.icono} {ALERGENOS[a]?.nombre ?? a}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-2 block text-sm font-semibold">Etiquetas</span>
            <div className="flex flex-wrap gap-1.5">
              {opciones.etiquetas.map((t) => (
                <button type="button" key={t} onClick={() => alternar('etiquetas', t)} aria-pressed={p.etiquetas.includes(t)} className={`rounded-full px-3 py-1.5 text-sm ${p.etiquetas.includes(t) ? 'bg-oliva text-white' : 'bg-crema ring-1 ring-linea'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1 rounded-2xl bg-crema p-3">
            <Interruptor activo={p.disponible} onCambio={(v) => set('disponible', v)} texto="Disponible" ayuda="Apágalo si hoy se ha acabado. Desaparece de la carta." />
            <Interruptor activo={p.destacado} onCambio={(v) => set('destacado', v)} texto="Destacado" ayuda="Sale en la portada de la web." />
          </div>
        </div>

        <div className="space-y-3">
          <span className="block text-sm font-semibold">Vista en 3D</span>
          <div className="aspect-square rounded-2xl bg-[radial-gradient(circle_at_50%_40%,#fff,#efe6d8)] ring-1 ring-linea">
            {p.modelo ? <Modelo3D key={p.modelo} modelo={p.modelo} nombre={p.nombre || 'plato'} className="h-full w-full" /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gris">Elige abajo el modelo que más se parezca al plato.</div>}
          </div>
          <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto rounded-2xl bg-crema p-1.5">
            <button type="button" onClick={() => set('modelo', '')} aria-pressed={!p.modelo} title="Sin modelo" className={`flex aspect-square items-center justify-center rounded-xl text-xs ${!p.modelo ? 'bg-teja text-white' : 'bg-white'}`}>
              Ninguno
            </button>
            {[...opciones.modelos].sort((a, b) => Number(esReal(b)) - Number(esReal(a))).map((m) => (
              <button type="button" key={m} onClick={() => set('modelo', m)} aria-pressed={p.modelo === m} title={nombreModelo(m) + (esReal(m) ? ' (escaneo real)' : ' (ilustración)')} className={`relative aspect-square rounded-xl p-1 ${p.modelo === m ? 'bg-teja/20 ring-2 ring-teja' : 'bg-white'}`}>
                <img src={urlMiniatura(m)} alt={nombreModelo(m)} className="h-full w-full object-contain" loading="lazy" />
                {esReal(m) && <span className="absolute bottom-0.5 right-0.5 rounded bg-tinta px-1 text-[9px] font-bold text-oro">REAL</span>}
              </button>
            ))}
          </div>
          {p.modelo && <p className="text-center text-xs text-gris">{nombreModelo(p.modelo)}{esReal(p.modelo) ? ' · escaneo 3D real' : ' · ilustración'}</p>}
        </div>

        <div className="flex gap-2 border-t border-linea pt-4 md:col-span-2">
          {!nuevo && (
            <button type="button" onClick={() => confirm(`¿Borrar «${plato.nombre}» de la carta?`) && onBorrar()} className="rounded-full px-4 py-3 text-sm font-semibold text-teja ring-1 ring-teja/30">
              Borrar plato
            </button>
          )}
          <button className="ml-auto rounded-full bg-teja px-8 py-3 font-semibold text-white">{nuevo ? 'Añadir a la carta' : 'Hecho'}</button>
        </div>
        <p className="text-xs text-gris md:col-span-2">Los cambios se aplican al pulsar «Guardar» abajo.</p>
      </form>
    </Modal>
  )
}

import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { MesaSvg, Plano } from '../../components/Plano'
import { BarraGuardar, Campo, Contador, Interruptor, Tarjeta, entrada, useBorrador } from '../../components/ui'
import { api, type DatosAdmin, type Mesa } from '../../lib/api'

const REJILLA = 10
const ajustar = (v: number) => Math.round(v / REJILLA) * REJILLA
const limitar = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

interface Props {
  clave: string
  datos: DatosAdmin
  onGuardado: (mesas: Mesa[]) => void
}

export function EditorPlano({ clave, datos, onGuardado }: Props) {
  const { borrador: mesas, setBorrador: setMesas, cambios, guardando, guardar, descartar } = useBorrador<Mesa[]>(datos.mesas, async (v) => {
    const r = await api.admin.guardar<Mesa[]>(clave, 'mesas', v)
    onGuardado(r.valor)
    return r.valor
  })
  const [sel, setSel] = useState<string>('')
  const arrastre = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const mesa = mesas.find((m) => m.id === sel)
  const zonas = [...new Set(mesas.map((m) => m.zona))]
  const plazas = mesas.filter((m) => m.activa !== false).reduce((s, m) => s + m.plazas, 0)

  const punto = (e: { clientX: number; clientY: number }) => {
    const ctm = svg.current?.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }
  const cambiar = (id: string, parcial: Partial<Mesa>) => setMesas(mesas.map((m) => (m.id === id ? { ...m, ...parcial } : m)))

  function empezar(m: Mesa, e: RPointerEvent<SVGGElement>) {
    e.preventDefault()
    const p = punto(e)
    arrastre.current = { id: m.id, dx: p.x - m.x, dy: p.y - m.y }
    setSel(m.id)
  }
  function mover(e: RPointerEvent<SVGSVGElement>) {
    const a = arrastre.current
    if (!a) return
    const p = punto(e)
    const m = mesas.find((x) => x.id === a.id)
    if (!m) return
    const x = limitar(ajustar(p.x - a.dx), 0, 1000 - m.w)
    const y = limitar(ajustar(p.y - a.dy), 0, 700 - m.h)
    if (x !== m.x || y !== m.y) cambiar(m.id, { x, y })
  }

  function nueva(forma: Mesa['forma']) {
    const usados = new Set(mesas.map((m) => m.id))
    let n = mesas.length + 1
    while (usados.has('m' + n)) n++
    // Busca un hueco libre empezando arriba a la izquierda.
    const tam = forma === 'redonda' ? 80 : 90
    let x = 60
    let y = 60
    const choca = (x: number, y: number) => mesas.some((m) => x < m.x + m.w + 40 && m.x < x + tam + 40 && y < m.y + m.h + 40 && m.y < y + tam + 40)
    while (choca(x, y) && y < 700 - tam) {
      x += 60
      if (x > 1000 - tam) (x = 60), (y += 60)
    }
    const m: Mesa = { id: 'm' + n, nombre: String(n), zona: mesa?.zona ?? zonas[0] ?? 'Salón', plazas: forma === 'redonda' ? 4 : 4, min: 1, x, y: Math.min(y, 700 - tam), w: tam, h: tam, forma, activa: true }
    setMesas([...mesas, m])
    setSel(m.id)
  }

  function duplicar(m: Mesa) {
    const usados = new Set(mesas.map((x) => x.id))
    let n = mesas.length + 1
    while (usados.has('m' + n)) n++
    const copia = { ...m, id: 'm' + n, nombre: String(n), x: limitar(m.x + m.w + 30, 0, 1000 - m.w) }
    setMesas([...mesas, copia])
    setSel(copia.id)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl">Plano de mesas</h1>
          <p className="text-sm text-gris">
            {mesas.filter((m) => m.activa !== false).length} mesas activas · {plazas} plazas. Arrastra las mesas para colocarlas como en tu local.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => nueva('cuadrada')} className="rounded-full bg-tinta px-4 py-2.5 text-sm font-semibold text-crema">
            + Mesa cuadrada
          </button>
          <button onClick={() => nueva('redonda')} className="rounded-full bg-tinta px-4 py-2.5 text-sm font-semibold text-crema">
            + Mesa redonda
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-3xl bg-papel p-2 ring-1 ring-linea">
          <Plano
            mesas={mesas}
            aspecto={() => 'neutra'}
            lienzoCompleto
            svgRef={svg}
            onPointerMove={mover}
            onPointerUp={() => (arrastre.current = null)}
            onFondo={() => setSel('')}
            renderMesa={(m) => (
              <MesaSvg
                mesa={m}
                aspecto={m.id === sel ? 'seleccionada' : m.activa === false ? 'no_cabe' : 'neutra'}
                etiqueta={m.activa === false ? 'desactivada' : `${m.plazas} pax`}
                onPointerDown={(e) => empezar(m, e)}
                interactiva
                titulo={`Mesa ${m.nombre}`}
                onClick={() => setSel(m.id)}
              />
            )}
          />
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          {mesa ? (
            <Tarjeta
              titulo={`Mesa ${mesa.nombre}`}
              accion={
                <button onClick={() => setSel('')} className="text-sm font-semibold text-gris" aria-label="Cerrar">
                  Listo
                </button>
              }
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Campo etiqueta="Nombre o número">
                    <input value={mesa.nombre} maxLength={20} onChange={(e) => cambiar(mesa.id, { nombre: e.target.value })} className={entrada} />
                  </Campo>
                  <Campo etiqueta="Zona">
                    <input value={mesa.zona} maxLength={30} list="zonas" onChange={(e) => cambiar(mesa.id, { zona: e.target.value })} className={entrada} />
                    <datalist id="zonas">
                      {zonas.map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </Campo>
                </div>
                <Campo etiqueta="Plazas" ayuda="Cuántas personas caben como máximo.">
                  <Contador valor={mesa.plazas} max={30} onCambio={(v) => cambiar(mesa.id, { plazas: v, min: Math.min(mesa.min, v) })} />
                </Campo>
                <Campo etiqueta="Mínimo de personas" ayuda="Para no dar una mesa de 8 a una pareja.">
                  <Contador valor={mesa.min} max={mesa.plazas} onCambio={(v) => cambiar(mesa.id, { min: v })} />
                </Campo>
                <div>
                  <span className="mb-1 block text-sm font-semibold">Forma</span>
                  <div className="flex gap-2">
                    {(
                      [
                        ['cuadrada', '▢ Cuadrada'],
                        ['redonda', '◯ Redonda'],
                      ] as const
                    ).map(([f, t]) => (
                      <button key={f} onClick={() => cambiar(mesa.id, { forma: f })} aria-pressed={mesa.forma === f} className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ${mesa.forma === f ? 'bg-tinta text-crema' : 'bg-crema ring-1 ring-linea'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <Campo etiqueta={`Ancho (${mesa.w})`}>
                  <input type="range" min={40} max={300} step={10} value={mesa.w} onChange={(e) => cambiar(mesa.id, { w: Number(e.target.value), x: Math.min(mesa.x, 1000 - Number(e.target.value)) })} className="w-full accent-teja" />
                </Campo>
                <Campo etiqueta={`Largo (${mesa.h})`}>
                  <input type="range" min={40} max={300} step={10} value={mesa.h} onChange={(e) => cambiar(mesa.id, { h: Number(e.target.value), y: Math.min(mesa.y, 700 - Number(e.target.value)) })} className="w-full accent-teja" />
                </Campo>
                <Interruptor activo={mesa.activa !== false} onCambio={(v) => cambiar(mesa.id, { activa: v })} texto="Se puede reservar" ayuda="Desactívala si hoy no la montáis." />
                <div className="flex gap-2 border-t border-linea pt-4">
                  <button onClick={() => duplicar(mesa)} className="flex-1 rounded-xl bg-crema py-2.5 text-sm font-semibold ring-1 ring-linea">
                    Duplicar
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`¿Quitar la mesa ${mesa.nombre} del plano? Las reservas ya hechas no se borran.`)) {
                        setMesas(mesas.filter((m) => m.id !== mesa.id))
                        setSel('')
                      }
                    }}
                    className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-teja ring-1 ring-teja/30"
                  >
                    Quitar mesa
                  </button>
                </div>
              </div>
            </Tarjeta>
          ) : (
            <Tarjeta titulo="Cómo funciona">
              <ul className="space-y-3 text-sm text-gris">
                <li>
                  <b className="text-tinta">Arrastra</b> una mesa para moverla.
                </li>
                <li>
                  <b className="text-tinta">Tócala</b> para cambiar plazas, forma o tamaño.
                </li>
                <li>
                  Pon <b className="text-tinta">zonas</b> como Salón o Terraza y la web las mostrará agrupadas.
                </li>
                <li>
                  Cuando acabes, pulsa <b className="text-tinta">Guardar</b>. Los clientes verán el plano nuevo al momento.
                </li>
              </ul>
            </Tarjeta>
          )}
        </div>
      </div>

      <BarraGuardar cambios={cambios} guardando={guardando} onGuardar={guardar} onDescartar={descartar} />
    </div>
  )
}

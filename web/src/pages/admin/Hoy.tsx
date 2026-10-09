import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Leyenda, Plano, type Aspecto } from '../../components/Plano'
import { Campo, Contador, Modal, Tarjeta, entrada, useAviso } from '../../components/ui'
import { api, type DatosAdmin, type Mesa, type Reserva } from '../../lib/api'
import { fechaLarga, sumarDias, telefono } from '../../lib/util'

const min = (h: string) => {
  const [a, b] = h.split(':').map(Number)
  return a * 60 + b
}
const ACTIVAS: Reserva['estado'][] = ['confirmada', 'llegada']
const ORIGEN: Record<string, string> = { web: '🌐 Web', telefono: '📞 Teléfono', local: '🏠 En el local', ia: '🤖 Recepcionista IA' }
const ESTADO: Record<Reserva['estado'], { texto: string; clase: string }> = {
  confirmada: { texto: 'Pendiente', clase: 'bg-oro/25 text-tinta' },
  llegada: { texto: 'Ha llegado', clase: 'bg-oliva/20 text-oliva' },
  no_show: { texto: 'No vino', clase: 'bg-teja/15 text-teja-osc' },
  cancelada: { texto: 'Cancelada', clase: 'bg-linea text-gris' },
}

interface Props {
  clave: string
  datos: DatosAdmin
  recargar: (fecha?: string) => Promise<void>
}

export function Hoy({ clave, datos, recargar }: Props) {
  const { config: c, reservas, mesas, fecha } = datos
  const avisar = useAviso()
  const horas = useMemo(() => [...c.horas.comida, ...c.horas.cena], [c.horas])
  const dur = (r: { turno: string }) => (r.turno === 'cena' ? c.duracion.cena : c.duracion.comida)
  const activas = mesas.filter((m) => m.activa !== false)

  // Hora del plano: la próxima si es hoy, si no la primera con reservas.
  const horaInicial = () => {
    if (fecha === datos.hoy) {
      const ahora = new Date().getHours() * 60 + new Date().getMinutes()
      const enCurso = [...horas].reverse().find((h) => min(h) <= ahora && ahora < min(h) + 90)
      return enCurso ?? horas.find((h) => min(h) >= ahora) ?? horas.at(-1) ?? ''
    }
    return reservas.find((r) => ACTIVAS.includes(r.estado))?.hora ?? horas[0] ?? ''
  }
  const [hora, setHora] = useState(horaInicial)
  useEffect(() => setHora(horaInicial()), [fecha]) // eslint-disable-line react-hooks/exhaustive-deps

  const [verCanceladas, setVerCanceladas] = useState(false)
  const [resaltada, setResaltada] = useState('')
  const [moviendo, setMoviendo] = useState<Reserva | null>(null)
  const [nueva, setNueva] = useState<{ mesa: string; hora: string } | null>(null)
  const [ocupado, setOcupado] = useState('')

  const enMesa = (m: Mesa, h: string, ignorar?: string) =>
    reservas.find((r) => r.mesa === m.id && r.token !== ignorar && ACTIVAS.includes(r.estado) && min(r.hora) <= min(h) && min(h) < min(r.hora) + dur(r))

  const lista = [...reservas].sort((a, b) => a.hora.localeCompare(b.hora)).filter((r) => verCanceladas || r.estado !== 'cancelada')
  const act = reservas.filter((r) => ACTIVAS.includes(r.estado))
  const kpis = [
    ['Reservas', act.length],
    ['Comensales', act.reduce((s, r) => s + r.personas, 0)],
    ['Han llegado', reservas.filter((r) => r.estado === 'llegada').length],
    ['No vinieron', reservas.filter((r) => r.estado === 'no_show').length],
  ] as const
  const espera = datos.espera.filter((e) => e.fecha === fecha)

  async function cambiar(r: Reserva, estado: Reserva['estado'], texto: string) {
    setOcupado(r.token)
    try {
      await api.admin.estado(clave, r.token, estado)
      await recargar(fecha)
      avisar(texto)
    } catch (e) {
      avisar((e as Error).message, 'error')
    } finally {
      setOcupado('')
    }
  }

  const nombreMesa = (id: string) => mesas.find((m) => m.id === id)?.nombre ?? (id || '—')

  return (
    <div className="space-y-5">
      {/* Fecha */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => recargar(sumarDias(fecha, -1))} className="h-11 w-11 rounded-full bg-papel text-xl ring-1 ring-linea" aria-label="Día anterior">
          ‹
        </button>
        <div className="min-w-0 flex-1 sm:flex-none">
          <h1 className="font-serif text-3xl leading-tight first-letter:uppercase sm:text-4xl">{fecha === datos.hoy ? 'Hoy' : fechaLarga(fecha)}</h1>
          {fecha === datos.hoy && <p className="text-sm text-gris first-letter:uppercase">{fechaLarga(fecha)}</p>}
        </div>
        <button onClick={() => recargar(sumarDias(fecha, 1))} className="h-11 w-11 rounded-full bg-papel text-xl ring-1 ring-linea" aria-label="Día siguiente">
          ›
        </button>
        {fecha !== datos.hoy && (
          <button onClick={() => recargar(datos.hoy)} className="rounded-full bg-tinta px-4 py-2.5 text-sm font-semibold text-crema">
            Volver a hoy
          </button>
        )}
        <input type="date" value={fecha} onChange={(e) => e.target.value && recargar(e.target.value)} className="rounded-full bg-papel px-4 py-2.5 text-sm ring-1 ring-linea" aria-label="Elegir fecha" />
        <button onClick={() => setNueva({ mesa: '', hora })} className="ml-auto w-full rounded-full bg-teja px-5 py-3 font-semibold text-white shadow-lg shadow-teja/20 sm:w-auto">
          + Nueva reserva
        </button>
      </div>

      {datos.cerrado && <p className="rounded-2xl bg-oro/20 p-4 text-sm font-semibold">Este día el restaurante está cerrado ({datos.cerrado}). Puedes cambiarlo en Ajustes.</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-papel p-4 ring-1 ring-linea">
            <p className="text-3xl font-bold tabular-nums">{v}</p>
            <p className="text-sm text-gris">{k}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* Plano en vivo */}
        <Tarjeta titulo="Sala" sub="Toca una mesa libre para apuntar una reserva en ella.">
          <div className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1">
            {horas.map((h) => (
              <button key={h} onClick={() => setHora(h)} aria-pressed={h === hora} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums ${h === hora ? 'bg-tinta text-crema' : 'bg-crema ring-1 ring-linea'}`}>
                {h}
              </button>
            ))}
          </div>
          <div className="rounded-2xl bg-crema p-2 ring-1 ring-linea">
            <Plano
              mesas={activas}
              aspecto={(m): Aspecto => {
                const r = enMesa(m, hora)
                if (!r) return 'libre'
                if (r.token === resaltada) return 'seleccionada'
                return r.estado === 'llegada' ? 'llegada' : 'recomendada'
              }}
              etiqueta={(m) => {
                const r = enMesa(m, hora)
                return r ? `${r.nombre.split(' ')[0].slice(0, 9)} · ${r.personas}` : `${m.plazas} pax`
              }}
              titulo={(m) => {
                const r = enMesa(m, hora)
                return r ? `Mesa ${m.nombre}: ${r.nombre}, ${r.personas} personas a las ${r.hora}` : `Mesa ${m.nombre}: libre a las ${hora}`
              }}
              onElegir={(m) => {
                const r = enMesa(m, hora)
                if (r) {
                  setResaltada(r.token)
                  document.getElementById('r-' + r.token)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else setNueva({ mesa: m.id, hora })
              }}
            />
          </div>
          <div className="mt-3">
            <Leyenda
              items={[
                ['libre', 'Libre'],
                ['recomendada', 'Reservada'],
                ['llegada', 'Ya están'],
              ]}
            />
          </div>
        </Tarjeta>

        {/* Lista de reservas */}
        <Tarjeta
          titulo={`Reservas (${act.length})`}
          accion={
            <button onClick={() => setVerCanceladas((v) => !v)} className="text-sm font-semibold text-teja">
              {verCanceladas ? 'Ocultar canceladas' : 'Ver canceladas'}
            </button>
          }
        >
          {lista.length === 0 && <p className="rounded-2xl bg-crema p-6 text-center text-gris">No hay reservas este día.</p>}
          <ul className="space-y-3">
            {lista.map((r) => {
              const e = ESTADO[r.estado]
              const ocup = ocupado === r.token
              return (
                <li
                  key={r.token}
                  id={'r-' + r.token}
                  onClick={() => (setResaltada(r.token), setHora(r.hora))}
                  className={`rounded-2xl p-4 ring-1 transition-colors ${r.token === resaltada ? 'bg-teja/5 ring-teja' : 'bg-crema/60 ring-linea'} ${r.estado === 'cancelada' ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-lg font-bold tabular-nums">{r.hora}</p>
                      <p className="text-xs text-gris">Mesa {nombreMesa(r.mesa)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{r.nombre}</p>
                        <span className="text-sm text-gris">· {r.personas} pax</span>
                        {(() => {
                          const c = datos.clientes?.[r.telefono]
                          return (
                            <>
                              {c && c.visitas > 0 && <span className="rounded-full bg-oro/25 px-2 py-0.5 text-[11px] font-bold" title={`Última visita: ${c.ultima}`}>★ {c.visitas + 1}ª visita</span>}
                              {c && c.noShows > 0 && <span className="rounded-full bg-teja/15 px-2 py-0.5 text-[11px] font-bold text-teja-osc">⚠ {c.noShows} {c.noShows === 1 ? 'ausencia' : 'ausencias'}</span>}
                              {/cumple|aniversari|celebra|sorpresa|vela/i.test(r.notas) && <span className="text-sm" title="Celebración">🎂</span>}
                            </>
                          )
                        })()}
                        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${e.clase}`}>{e.texto}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-gris">
                        <a href={`tel:${r.telefono}`} onClick={(ev) => ev.stopPropagation()} className="font-medium text-tinta underline-offset-2 hover:underline">
                          {telefono(r.telefono)}
                        </a>{' '}
                        · {ORIGEN[r.origen] ?? r.origen} · {r.codigo}
                      </p>
                      {r.notas && <p className="mt-1.5 rounded-lg bg-oro/15 px-2 py-1 text-sm">📝 {r.notas}</p>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2" onClick={(ev) => ev.stopPropagation()}>
                    {r.estado === 'confirmada' ? (
                      <>
                        <button disabled={ocup} onClick={() => cambiar(r, 'llegada', `${r.nombre} ha llegado.`)} className="rounded-full bg-oliva px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                          ✓ Ha llegado
                        </button>
                        <button disabled={ocup} onClick={() => cambiar(r, 'no_show', 'Marcada como no presentada.')} className="rounded-full bg-papel px-4 py-2 text-sm font-semibold ring-1 ring-linea disabled:opacity-50">
                          No vino
                        </button>
                        <button disabled={ocup} onClick={() => setMoviendo(r)} className="rounded-full bg-papel px-4 py-2 text-sm font-semibold ring-1 ring-linea disabled:opacity-50">
                          Cambiar mesa
                        </button>
                        <button
                          disabled={ocup}
                          onClick={() => cambiar(r, 'cancelada', 'Reserva cancelada. Si había lista de espera, se ha avisado.')}
                          className="rounded-full px-4 py-2 text-sm font-semibold text-teja disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button disabled={ocup} onClick={() => cambiar(r, 'confirmada', 'Cambio deshecho.')} className="rounded-full bg-papel px-4 py-2 text-sm font-semibold ring-1 ring-linea disabled:opacity-50">
                        ↩ Deshacer
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {espera.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-bold uppercase tracking-widest text-gris">Lista de espera ({espera.length})</h3>
              <p className="mt-1 text-xs text-gris">Se les asigna mesa solos en cuanto se libera una.</p>
              <ul className="mt-2 divide-y divide-linea">
                {espera.map((x, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 text-sm">
                    <span className="font-bold tabular-nums">{x.hora}</span>
                    <span className="flex-1">
                      {x.nombre} · {x.personas} pax
                    </span>
                    <a href={`tel:${x.telefono}`} className="text-teja">
                      {telefono(x.telefono)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Tarjeta>
      </div>

      {moviendo && (
        <MoverMesa
          r={moviendo}
          mesas={activas}
          ocupada={(m) => !!enMesa(m, moviendo.hora, moviendo.token) || reservas.some((x) => x.token !== moviendo.token && x.mesa === m.id && ACTIVAS.includes(x.estado) && min(x.hora) < min(moviendo.hora) + dur(moviendo) && min(moviendo.hora) < min(x.hora) + dur(x))}
          onCerrar={() => setMoviendo(null)}
          onMover={async (mesa) => {
            try {
              await api.admin.mover(clave, moviendo.token, mesa)
              await recargar(fecha)
              avisar(`${moviendo.nombre} pasa a la mesa ${nombreMesa(mesa)}.`)
              setMoviendo(null)
            } catch (e) {
              avisar((e as Error).message, 'error')
            }
          }}
        />
      )}

      {nueva && (
        <NuevaReserva
          inicial={nueva}
          fecha={fecha}
          horas={horas}
          mesas={activas}
          maxPersonas={c.maxPersonas}
          onCerrar={() => setNueva(null)}
          onCrear={async (d) => {
            const x = await api.reservar({ ...d, fecha }, clave)
            await recargar(fecha)
            avisar(`Reserva apuntada: ${x.nombre}, ${x.hora}, mesa ${x.mesa}.`)
            setNueva(null)
          }}
        />
      )}
    </div>
  )
}

function MoverMesa({ r, mesas, ocupada, onCerrar, onMover }: { r: Reserva; mesas: Mesa[]; ocupada: (m: Mesa) => boolean; onCerrar: () => void; onMover: (mesa: string) => Promise<void> }) {
  const [sel, setSel] = useState(r.mesa)
  const [enviando, setEnviando] = useState(false)
  const aspecto = (m: Mesa): Aspecto => (m.id === sel ? 'seleccionada' : ocupada(m) ? 'ocupada' : m.plazas < r.personas ? 'no_cabe' : 'libre')
  return (
    <Modal titulo={`Cambiar de mesa a ${r.nombre.split(' ')[0]}`} onCerrar={onCerrar} ancho="max-w-2xl">
      <p className="mb-3 text-sm text-gris">
        {r.personas} personas a las {r.hora}. Ahora en la mesa {mesas.find((m) => m.id === r.mesa)?.nombre ?? '—'}.
      </p>
      <div className="rounded-2xl bg-crema p-2 ring-1 ring-linea">
        <Plano mesas={mesas} aspecto={aspecto} onElegir={(m) => setSel(m.id)} titulo={(m) => `Mesa ${m.nombre}`} />
      </div>
      <div className="mt-3">
        <Leyenda
          items={[
            ['libre', 'Libre'],
            ['seleccionada', 'Elegida'],
            ['ocupada', 'Ocupada'],
            ['no_cabe', 'Pequeña'],
          ]}
        />
      </div>
      <button
        disabled={enviando || sel === r.mesa}
        onClick={async () => {
          setEnviando(true)
          await onMover(sel)
          setEnviando(false)
        }}
        className="mt-5 w-full rounded-full bg-teja py-3.5 font-semibold text-white disabled:opacity-50"
      >
        {sel === r.mesa ? 'Elige otra mesa en el plano' : enviando ? 'Moviendo…' : `Mover a la mesa ${mesas.find((m) => m.id === sel)?.nombre}`}
      </button>
    </Modal>
  )
}

type NuevaDatos = { nombre: string; telefono: string; email: string; notas: string; personas: number; hora: string; mesa: string; origen: 'telefono' | 'local' }

function NuevaReserva({
  inicial,
  fecha,
  horas,
  mesas,
  maxPersonas,
  onCerrar,
  onCrear,
}: {
  inicial: { mesa: string; hora: string }
  fecha: string
  horas: string[]
  mesas: Mesa[]
  maxPersonas: number
  onCerrar: () => void
  onCrear: (d: NuevaDatos) => Promise<void>
}) {
  const [d, setD] = useState<NuevaDatos>({ nombre: '', telefono: '', email: '', notas: '', personas: 2, hora: inicial.hora || horas[0], mesa: inicial.mesa, origen: 'telefono' })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const set = <K extends keyof NuevaDatos>(k: K, v: NuevaDatos[K]) => (setD({ ...d, [k]: v }), setError(''))

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    try {
      await onCrear(d)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Nueva reserva" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-sm text-gris first-letter:uppercase">{fechaLarga(fecha)}</p>
        <div className="flex gap-2">
          {(
            [
              ['telefono', '📞 Por teléfono'],
              ['local', '🏠 En el local'],
            ] as const
          ).map(([k, t]) => (
            <button type="button" key={k} onClick={() => set('origen', k)} aria-pressed={d.origen === k} className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ${d.origen === k ? 'bg-tinta text-crema' : 'bg-crema ring-1 ring-linea'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Personas">
            <Contador valor={d.personas} onCambio={(v) => set('personas', v)} max={maxPersonas} />
          </Campo>
          <Campo etiqueta="Hora">
            <select value={d.hora} onChange={(e) => set('hora', e.target.value)} className={entrada}>
              {horas.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </Campo>
        </div>
        <Campo etiqueta="Mesa" ayuda="Si la dejas en automática, el sistema elige la mejor libre.">
          <select value={d.mesa} onChange={(e) => set('mesa', e.target.value)} className={entrada}>
            <option value="">Automática</option>
            {mesas.map((m) => (
              <option key={m.id} value={m.id}>
                Mesa {m.nombre} · {m.zona} · {m.plazas} plazas
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Nombre">
          <input required minLength={2} value={d.nombre} onChange={(e) => set('nombre', e.target.value)} className={entrada} autoFocus />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Teléfono">
            <input required type="tel" inputMode="tel" value={d.telefono} onChange={(e) => set('telefono', e.target.value)} className={entrada} />
          </Campo>
          <Campo etiqueta="Email (opcional)" ayuda="Si lo pones, le llega la confirmación.">
            <input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} className={entrada} />
          </Campo>
        </div>
        <Campo etiqueta="Notas (opcional)">
          <input value={d.notas} maxLength={300} onChange={(e) => set('notas', e.target.value)} className={entrada} placeholder="Alergias, trona, cumpleaños…" />
        </Campo>
        {error && (
          <p role="alert" className="rounded-xl bg-teja/10 p-3 text-sm font-semibold text-teja-osc">
            {error}
          </p>
        )}
        <button disabled={enviando} className="w-full rounded-full bg-teja py-3.5 font-semibold text-white disabled:opacity-60">
          {enviando ? 'Guardando…' : 'Apuntar reserva'}
        </button>
      </form>
    </Modal>
  )
}

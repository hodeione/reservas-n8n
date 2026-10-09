import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Leyenda, Plano, type Aspecto } from '../components/Plano'
import { ApiError, api, type DatosWeb, type EstadoMesa, type Hora } from '../lib/api'
import { DIAS_CORTOS, alClicar, desdeIso, diaSemana, fechaLarga, sumarDias, useTitulo } from '../lib/util'

type Exito = Awaited<ReturnType<typeof api.reservar>>
interface Fallo {
  mensaje: string
  alternativas: string[]
  espera: boolean
}

function Paso({ n, titulo, hecho, children }: { n: number; titulo: string; hecho?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${hecho ? 'bg-oliva text-white' : 'bg-tinta text-crema'}`}>{hecho ? '✓' : n}</span>
        <h2 className="font-serif text-2xl">{titulo}</h2>
        {hecho && <span className="ml-auto truncate text-sm font-semibold text-oliva first-letter:uppercase">{hecho}</span>}
      </div>
      {children}
    </section>
  )
}

export function Reservar({ d }: { d: DatosWeb }) {
  const r = d.restaurante
  useTitulo(`Reservar mesa · ${r.nombre}`)
  const max = Math.min(r.maxPersonas, Math.max(1, ...d.mesas.map((m) => m.plazas)))

  const [personas, setPersonas] = useState(2)
  const [fecha, setFecha] = useState('')
  const [horas, setHoras] = useState<Hora[] | null>(null)
  const [motivo, setMotivo] = useState('')
  const [hora, setHora] = useState('')
  const [estados, setEstados] = useState<Record<string, EstadoMesa> | null>(null)
  const [recomendada, setRecomendada] = useState<string | null>(null)
  const [mesa, setMesa] = useState('')
  const [form, setForm] = useState<Datos>({ nombre: '', telefono: '', email: '', notas: '', web: '' })
  const [enviando, setEnviando] = useState(false)
  const [fallo, setFallo] = useState<Fallo | null>(null)
  const [exito, setExito] = useState<Exito | null>(null)
  const [enEspera, setEnEspera] = useState<string | null>(null)
  const refMapa = useRef<HTMLDivElement>(null)
  const refForm = useRef<HTMLDivElement>(null)

  // Días reservables: desde hoy hasta el máximo de antelación.
  const dias = useMemo(
    () =>
      Array.from({ length: Math.min(r.diasMax, 60) + 1 }, (_, i) => {
        const f = sumarDias(d.hoy, i)
        return { fecha: f, cerrado: r.cerrado.includes(diaSemana(f)) || r.vacaciones.includes(f) }
      }),
    [d.hoy, r.diasMax, r.cerrado, r.vacaciones],
  )
  useEffect(() => {
    if (!fecha) setFecha(dias.find((x) => !x.cerrado)?.fecha ?? d.hoy)
  }, [dias, fecha, d.hoy])

  // Horas libres al cambiar día o personas.
  useEffect(() => {
    if (!fecha) return
    let vivo = true
    setHoras(null)
    setMotivo('')
    api
      .disponibilidad(fecha, personas)
      .then((x) => {
        if (!vivo) return
        setHoras(x.horas)
        setMotivo(x.cerrado ? x.motivo || 'Ese día está cerrado.' : '')
      })
      .catch((e: Error) => vivo && (setHoras([]), setMotivo(e.message)))
    return () => {
      vivo = false
    }
  }, [fecha, personas])

  // Plano de la hora elegida.
  useEffect(() => {
    setEstados(null)
    setMesa('')
    setFallo(null)
    if (!fecha || !hora) return
    let vivo = true
    api
      .mapa(fecha, hora, personas)
      .then((x) => {
        if (!vivo) return
        setEstados(Object.fromEntries(x.mesas.map((m) => [m.id, m.estado])))
        setRecomendada(x.recomendada)
        setMesa(x.recomendada ?? '')
      })
      .catch(() => vivo && setEstados({}))
    setTimeout(() => refMapa.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => {
      vivo = false
    }
  }, [fecha, hora, personas])

  const horaInfo = horas?.find((h) => h.hora === hora)
  const mesaSel = d.mesas.find((m) => m.id === mesa)
  const libres = d.mesas.filter((m) => estados?.[m.id] === 'libre')
  const turnos: ['comida' | 'cena', string][] = [
    ['comida', 'Comida'],
    ['cena', 'Cena'],
  ]

  const aspecto = (id: string): Aspecto => {
    if (id === mesa) return 'seleccionada'
    const e = estados?.[id] ?? 'ocupada'
    if (e === 'libre') return id === recomendada ? 'recomendada' : 'libre'
    return e
  }

  async function reservar(ev: FormEvent) {
    ev.preventDefault()
    setEnviando(true)
    setFallo(null)
    try {
      setExito(await api.reservar({ ...form, fecha, hora, personas, mesa }))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      const err = e as ApiError
      setFallo({
        mensaje: err.message,
        alternativas: (err.data?.alternativas as string[] | undefined) ?? [],
        espera: !!err.data?.lista_espera,
      })
    } finally {
      setEnviando(false)
    }
  }

  async function apuntarse() {
    setEnviando(true)
    setFallo(null)
    try {
      const x = await api.espera({ ...form, fecha, hora, personas })
      setEnEspera(x.fechaTexto)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setFallo({ mensaje: (e as Error).message, alternativas: [], espera: false })
    } finally {
      setEnviando(false)
    }
  }

  /* ---------------------------------------------------------- pantallas finales */
  if (exito) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <div className="rounded-3xl bg-papel p-8 text-center shadow-xl ring-1 ring-linea">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-oliva text-3xl text-white">✓</div>
          <h1 className="mt-4 font-serif text-4xl">¡Mesa reservada!</h1>
          <p className="mt-2 text-gris">Te esperamos, {exito.nombre.split(' ')[0]}.</p>
          <dl className="mt-6 grid grid-cols-2 gap-3 text-left">
            {[
              ['Día', exito.fechaTexto],
              ['Hora', exito.hora],
              ['Personas', String(exito.personas)],
              ['Mesa', `${exito.mesa}${exito.zona ? ` · ${exito.zona}` : ''}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-crema p-3">
                <dt className="text-xs font-bold uppercase tracking-widest text-gris">{k}</dt>
                <dd className="mt-0.5 font-semibold first-letter:uppercase">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-gris">
            Código de reserva <span className="ml-1 rounded-lg bg-tinta px-2 py-1 font-mono font-bold tracking-widest text-oro">{exito.codigo}</span>
          </p>
          {exito.email && <p className="mt-3 text-sm text-gris">Te hemos enviado la confirmación a {exito.email}.</p>}
          <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <a href={exito.gestionar} className="rounded-full border border-tinta/20 px-5 py-3 text-sm font-semibold">Ver o cancelar la reserva</a>
            <a href="/carta" onClick={alClicar('/carta')} className="rounded-full bg-teja px-5 py-3 text-sm font-semibold text-white">Echar un ojo a la carta</a>
          </div>
        </div>
      </main>
    )
  }
  if (enEspera) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <div className="rounded-3xl bg-papel p-8 text-center shadow-xl ring-1 ring-linea">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-oro text-3xl">⏳</div>
          <h1 className="mt-4 font-serif text-4xl">Estás en la lista de espera</h1>
          <p className="mt-3 text-gris">
            Si se libera una mesa para {personas} el {enEspera}, te la reservamos automáticamente y te avisamos{form.email ? ` en ${form.email}` : ''}. No tienes que hacer
            nada más.
          </p>
          <a href="/" onClick={alClicar('/')} className="mt-8 inline-block rounded-full bg-teja px-6 py-3 text-sm font-semibold text-white">
            Volver al inicio
          </a>
        </div>
      </main>
    )
  }

  /* ---------------------------------------------------------- pasos */
  const input = 'w-full rounded-2xl border border-linea bg-white px-4 py-3 text-base text-tinta outline-none transition-colors focus:border-teja'
  return (
    <main className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
      <div className="py-8 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-teja">Reserva online</p>
        <h1 className="mt-2 font-serif text-5xl tracking-tight">Elige tu mesa</h1>
        <p className="mt-2 text-gris">Confirmación al momento. Sin llamadas.</p>
      </div>

      <div className="space-y-4">
        <Paso n={1} titulo="¿Cuántos sois?" hecho={`${personas} ${personas === 1 ? 'persona' : 'personas'}`}>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => (setPersonas(n), setHora(''))}
                aria-pressed={personas === n}
                className={`h-12 w-12 rounded-2xl text-lg font-semibold transition-colors ${personas === n ? 'bg-teja text-white' : 'bg-crema ring-1 ring-linea hover:ring-tinta'}`}
              >
                {n}
              </button>
            ))}
          </div>
          {r.telefono && (
            <p className="mt-3 text-sm text-gris">
              ¿Sois más de {max}? Llámanos al{' '}
              <a className="font-semibold text-teja" href={`tel:${r.telefono.replace(/\s/g, '')}`}>
                {r.telefono}
              </a>
              .
            </p>
          )}
        </Paso>

        <Paso n={2} titulo="¿Qué día?" hecho={fecha ? fechaLarga(fecha) : undefined}>
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6">
            {dias.map((x) => {
              const dt = desdeIso(x.fecha)
              const sel = x.fecha === fecha
              return (
                <button
                  key={x.fecha}
                  disabled={x.cerrado}
                  onClick={() => (setFecha(x.fecha), setHora(''))}
                  aria-pressed={sel}
                  aria-label={fechaLarga(x.fecha) + (x.cerrado ? ' (cerrado)' : '')}
                  className={`flex w-16 shrink-0 flex-col items-center rounded-2xl py-2.5 transition-colors ${
                    sel ? 'bg-teja text-white' : x.cerrado ? 'bg-crema text-gris/50 line-through' : 'bg-crema ring-1 ring-linea hover:ring-tinta'
                  }`}
                >
                  <span className="text-xs font-semibold uppercase">{x.fecha === d.hoy ? 'hoy' : DIAS_CORTOS[diaSemana(x.fecha) - 1]}</span>
                  <span className="text-2xl font-bold leading-tight">{dt.getDate()}</span>
                  <span className="text-[11px] opacity-75">{dt.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</span>
                </button>
              )
            })}
          </div>
        </Paso>

        <Paso n={3} titulo="¿A qué hora?" hecho={hora || undefined}>
          {!horas && <div className="h-24 animate-pulse rounded-2xl bg-crema" />}
          {horas && motivo && <p className="rounded-2xl bg-crema p-4 text-gris">{motivo}</p>}
          {horas && !motivo && (
            <div className="space-y-4">
              {turnos.map(([t, nombre]) => {
                const hs = horas.filter((h) => h.turno === t)
                if (!hs.length) return null
                return (
                  <div key={t}>
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-gris">{nombre}</p>
                    <div className="flex flex-wrap gap-2">
                      {hs.map((h) => {
                        const sel = h.hora === hora
                        const lleno = !h.disponible && !h.pasada
                        return (
                          <button
                            key={h.hora}
                            disabled={h.pasada}
                            onClick={() => setHora(h.hora)}
                            aria-pressed={sel}
                            aria-label={h.hora + (lleno ? ', completo, lista de espera' : h.pasada ? ', ya no disponible' : '')}
                            className={`min-w-20 rounded-2xl px-4 py-3 font-semibold transition-colors ${
                              sel
                                ? lleno
                                  ? 'bg-tinta text-crema'
                                  : 'bg-teja text-white'
                                : h.pasada
                                  ? 'bg-crema text-gris/40'
                                  : lleno
                                    ? 'bg-crema text-gris line-through ring-1 ring-linea'
                                    : 'bg-crema ring-1 ring-linea hover:ring-tinta'
                            }`}
                          >
                            {h.hora}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {horas.some((h) => !h.disponible && !h.pasada) && <p className="text-sm text-gris">Las horas tachadas están completas. Tócalas para apuntarte a la lista de espera.</p>}
            </div>
          )}
        </Paso>

        {hora && horaInfo && !horaInfo.disponible && (
          <div ref={refMapa} className="scroll-mt-20 rounded-3xl bg-tinta p-6 text-crema">
            <h2 className="font-serif text-2xl">Las {hora} están completas</h2>
            <p className="mt-2 text-crema/80">Apúntate a la lista de espera: si alguien cancela, la mesa es tuya automáticamente y te avisamos.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                apuntarse()
              }}
            >
              <FormDatos form={form} setForm={setForm} input={input} oscuro />
              {fallo && <p className="mt-3 rounded-xl bg-teja/40 p-3 text-sm">{fallo.mensaje}</p>}
              <button type="submit" disabled={enviando} className="mt-4 w-full rounded-full bg-oro py-4 font-semibold text-tinta disabled:opacity-60">
                {enviando ? 'Apuntando…' : 'Apuntarme a la lista de espera'}
              </button>
            </form>
          </div>
        )}

        {hora && horaInfo?.disponible && (
          <div ref={refMapa} className="scroll-mt-20">
            <Paso n={4} titulo="Elige tu mesa" hecho={mesaSel ? `Mesa ${mesaSel.nombre}` : undefined}>
              {!estados && <div className="aspect-[3/2] animate-pulse rounded-2xl bg-crema" />}
              {estados && (
                <>
                  <p className="mb-3 text-sm text-gris">
                    {recomendada ? 'Te proponemos la mejor mesa para vuestro grupo (★). Toca otra libre si la preferís.' : 'No quedan mesas a esa hora. Prueba otra hora.'}
                  </p>
                  <div className="overflow-x-auto rounded-2xl bg-crema p-2 ring-1 ring-linea">
                    <div className="min-w-[540px]">
                    <Plano
                      mesas={d.mesas}
                      aspecto={(m) => aspecto(m.id)}
                      etiqueta={(m) => (m.id === recomendada && m.id !== mesa ? '★ ' : '') + (m.min > 1 ? `${m.min}-${m.plazas} pax` : `${m.plazas} pax`)}
                      titulo={(m) =>
                        `Mesa ${m.nombre}, ${m.zona}, ${m.plazas} plazas: ${estados[m.id] === 'libre' ? 'libre' : estados[m.id] === 'no_cabe' ? 'no es para ' + personas : 'ocupada'}`
                      }
                      onElegir={(m) => setMesa(m.id)}
                    />
                    </div>
                  </div>
                  <p className="mt-1 text-center text-xs text-gris sm:hidden">Desliza el plano para ver todo el local →</p>
                  <div className="mt-3">
                    <Leyenda
                      items={[
                        ['recomendada', 'Recomendada'],
                        ['libre', 'Libre'],
                        ['seleccionada', 'Tu mesa'],
                        ['ocupada', 'Ocupada'],
                        ['no_cabe', 'Otro tamaño'],
                      ]}
                    />
                  </div>
                  {libres.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2" aria-label="Mesas libres">
                      {libres.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setMesa(m.id)}
                          aria-pressed={m.id === mesa}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium ${m.id === mesa ? 'bg-teja text-white' : 'bg-crema ring-1 ring-linea'}`}
                        >
                          {m.nombre} · {m.zona} · {m.plazas} pax{m.id === recomendada ? ' ★' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Paso>
          </div>
        )}

        {hora && horaInfo?.disponible && mesaSel && (
          <div ref={refForm} className="scroll-mt-20">
            <Paso n={5} titulo="Tus datos">
              <form onSubmit={reservar}>
                <FormDatos form={form} setForm={setForm} input={input} />
                <div className="mt-5 rounded-2xl bg-crema p-4 text-sm">
                  <b className="first-letter:uppercase">{fechaLarga(fecha)}</b> a las <b>{hora}</b> · {personas} {personas === 1 ? 'persona' : 'personas'} · mesa <b>{mesaSel.nombre}</b> ({mesaSel.zona})
                </div>
                {fallo && (
                  <div role="alert" className="mt-4 rounded-2xl bg-teja/10 p-4 text-sm text-teja-osc ring-1 ring-teja/30">
                    <p className="font-semibold">{fallo.mensaje}</p>
                    {fallo.alternativas.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span>Prueba a las</span>
                        {fallo.alternativas.map((h) => (
                          <button type="button" key={h} onClick={() => setHora(h)} className="rounded-full bg-white px-3 py-1 font-semibold ring-1 ring-teja/40">
                            {h}
                          </button>
                        ))}
                      </div>
                    )}
                    {fallo.espera && (
                      <button type="button" onClick={apuntarse} disabled={enviando} className="mt-3 font-semibold underline">
                        O apúntate a la lista de espera de las {hora}
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={enviando}
                  className="mt-5 w-full rounded-full bg-teja py-4 text-lg font-semibold text-white shadow-lg shadow-teja/25 transition-colors hover:bg-teja-osc disabled:opacity-60"
                >
                  {enviando ? 'Reservando…' : 'Confirmar reserva'}
                </button>
                <p className="mt-3 text-center text-xs text-gris">Usamos tus datos solo para gestionar esta reserva.</p>
              </form>
            </Paso>
          </div>
        )}
      </div>
    </main>
  )
}

export type Datos = { nombre: string; telefono: string; email: string; notas: string; web: string }

export function FormDatos({ form, setForm, input, oscuro }: { form: Datos; setForm: (f: Datos) => void; input: string; oscuro?: boolean }) {
  const set = (k: keyof Datos) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })
  const label = `mb-1 block text-sm font-semibold ${oscuro ? 'text-crema/90' : ''}`
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="sm:col-span-2">
        <span className={label}>Nombre</span>
        <input required minLength={2} autoComplete="name" value={form.nombre} onChange={set('nombre')} className={input} />
      </label>
      <label>
        <span className={label}>Teléfono</span>
        <input required type="tel" autoComplete="tel" inputMode="tel" value={form.telefono} onChange={set('telefono')} className={input} placeholder="600 123 456" />
      </label>
      <label>
        <span className={label}>
          Email <span className="font-normal opacity-70">(para la confirmación)</span>
        </span>
        <input type="email" autoComplete="email" value={form.email} onChange={set('email')} className={input} />
      </label>
      <label className="sm:col-span-2">
        <span className={label}>
          Algo que debamos saber <span className="font-normal opacity-70">(opcional)</span>
        </span>
        <textarea rows={2} maxLength={300} value={form.notas} onChange={set('notas')} className={input} placeholder="Alergias, trona, celebración…" />
      </label>
      {/* Campo trampa: las personas no lo ven, los bots lo rellenan. */}
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.web} onChange={set('web')} className="hidden" name="web" />
    </div>
  )
}

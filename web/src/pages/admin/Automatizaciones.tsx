import { useCallback, useEffect, useState } from 'react'
import { Modal, Tarjeta, useAviso } from '../../components/ui'
import { DEMO, api, type EmailDemo, type RegistroDemo } from '../../lib/api'
import { FLUJOS, nombreFlujo } from '../../lib/flujos'

const hora = (iso: string) => new Date(iso).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

export function Automatizaciones({ clave, onCambio }: { clave: string; onCambio: () => void }) {
  const avisar = useAviso()
  const [bandeja, setBandeja] = useState<{ emails: EmailDemo[]; registro: RegistroDemo[] } | null>(null)
  const [corriendo, setCorriendo] = useState('')
  const [abierto, setAbierto] = useState<EmailDemo | null>(null)
  const [filtro, setFiltro] = useState('')
  const [flujoVisto, setFlujoVisto] = useState<string | null>(null)

  const recargar = useCallback(() => {
    if (DEMO) api.demo.bandeja().then(setBandeja)
  }, [])
  useEffect(recargar, [recargar])

  async function lanzar(id: string, extra: Record<string, unknown> = {}) {
    setCorriendo(id + JSON.stringify(extra))
    try {
      const r = await api.admin.ejecutar(clave, id, extra)
      avisar('registro' in r && r.registro ? r.registro.resumen : 'Automatización lanzada en n8n.')
      recargar()
      onCambio()
    } catch (e) {
      avisar((e as Error).message, 'error')
    } finally {
      setCorriendo('')
    }
  }

  const emails = (bandeja?.emails ?? []).filter((m) => !filtro || m.flujo === filtro)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-3xl sm:text-4xl">Automatizaciones</h1>
        <p className="text-sm text-gris">Diez flujos de n8n trabajan solos. Puedes lanzar cualquiera ahora para ver qué hace.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FLUJOS.map((f) => {
          const ultima = bandeja?.registro.find((r) => r.flujo === f.id)
          return (
            <section key={f.id} className="flex flex-col rounded-3xl bg-papel p-5 ring-1 ring-linea">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-crema text-2xl" aria-hidden="true">
                  {f.icono}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gris">{f.id}</p>
                  <h2 className="font-semibold leading-snug">{f.nombre}</h2>
                </div>
                <span className="ml-auto mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-oliva/15 px-2 py-0.5 text-[11px] font-bold text-oliva">
                  <span className="h-1.5 w-1.5 rounded-full bg-oliva" /> Activo
                </span>
              </div>
              <p className="mt-3 text-sm">{f.hace}</p>
              <p className="mt-2 text-xs text-gris">
                <b>Cuándo:</b> {f.cuando}
              </p>
              <p className="mt-1 text-xs text-gris">
                <b>Ahorra:</b> {f.ahorra}
              </p>
              {ultima && <p className="mt-3 rounded-xl bg-crema p-2.5 text-xs">Última vez {hora(ultima.cuando)}: {ultima.resumen}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {f.manual && (
                  <button disabled={!!corriendo} onClick={() => lanzar(f.id)} className="rounded-full bg-tinta px-4 py-2 text-sm font-semibold text-crema disabled:opacity-50">
                    {corriendo === f.id + '{}' ? 'Ejecutando…' : '▶ Ejecutar ahora'}
                  </button>
                )}
                {f.id === '08' && (
                  <button disabled={!!corriendo} onClick={() => lanzar('08', { lluvia: 90 })} className="rounded-full bg-crema px-4 py-2 text-sm font-semibold ring-1 ring-linea disabled:opacity-50">
                    🌧️ Simular lluvia
                  </button>
                )}
                {f.id === '09' &&
                  (['comida', 'cena'] as const).map((t) => (
                    <button key={t} disabled={!!corriendo} onClick={() => lanzar('09', { turno: t })} className="rounded-full bg-crema px-3 py-2 text-sm font-semibold ring-1 ring-linea disabled:opacity-50">
                      {t === 'comida' ? 'Comida' : 'Cena'}
                    </button>
                  ))}
                <button onClick={() => setFlujoVisto(f.id)} className="rounded-full px-3 py-2 text-sm font-semibold text-teja">
                  Ver en n8n
                </button>
              </div>
            </section>
          )
        })}
      </div>

      {DEMO && bandeja && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <Tarjeta titulo="Registro" sub="Lo que han hecho las automatizaciones, de lo más reciente a lo más antiguo.">
            <ol className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {bandeja.registro.map((r) => (
                <li key={r.id} className="flex gap-3 rounded-2xl bg-crema/70 p-3 text-sm">
                  <span className="text-lg" aria-hidden="true">
                    {FLUJOS.find((f) => f.id === r.flujo)?.icono}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-gris">
                      {hora(r.cuando)} · {nombreFlujo(r.flujo)}
                      {r.manual ? ' · a mano' : ''}
                    </p>
                    <p>{r.resumen}</p>
                    {r.emails > 0 && <p className="mt-0.5 text-xs font-semibold text-teja">✉ {r.emails} {r.emails === 1 ? 'email' : 'emails'}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Tarjeta>
          <Tarjeta
            titulo={`Emails enviados (${emails.length})`}
            sub="En la demo no salen de verdad: los ves aquí tal cual los recibiría cada persona."
            accion={
              <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="rounded-lg border border-linea bg-white px-2 py-1.5 text-sm" aria-label="Filtrar por automatización">
                <option value="">Todos</option>
                {FLUJOS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} · {f.nombre}
                  </option>
                ))}
              </select>
            }
          >
            <ul className="max-h-[32rem] divide-y divide-linea overflow-y-auto">
              {emails.map((m) => (
                <li key={m.id}>
                  <button onClick={() => setAbierto(m)} className="flex w-full items-start gap-3 py-3 text-left hover:bg-crema/60">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tinta text-sm font-bold text-oro">{m.para[0]?.toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2 text-xs text-gris">
                        <span className="truncate">Para {m.para}</span>
                        <span className="shrink-0">{hora(m.fecha)}</span>
                      </span>
                      <span className="block truncate font-semibold">{m.asunto}</span>
                      <span className="text-xs text-gris">{nombreFlujo(m.flujo)}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!emails.length && <li className="py-8 text-center text-gris">Aún no hay emails. Lanza una automatización o haz una reserva.</li>}
            </ul>
          </Tarjeta>
        </div>
      )}
      {!DEMO && <p className="text-sm text-gris">El historial de cada ejecución está en el editor de n8n, pestaña «Executions».</p>}

      {abierto && (
        <Modal titulo={abierto.asunto} onCerrar={() => setAbierto(null)} ancho="max-w-2xl">
          <p className="mb-3 text-sm text-gris">
            Para <b className="text-tinta">{abierto.para}</b> · {hora(abierto.fecha)} · {nombreFlujo(abierto.flujo)}
          </p>
          {/* Los enlaces del email abren la demo (gestionar reserva, reservar…). */}
          <iframe title={abierto.asunto} srcDoc={abierto.html.replace('<body', '<base target="_top"><body')} className="h-[60vh] w-full rounded-2xl ring-1 ring-linea" sandbox="allow-top-navigation-by-user-activation allow-popups" />
        </Modal>
      )}

      {flujoVisto && (
        <Modal titulo={`${flujoVisto} · ${nombreFlujo(flujoVisto)}`} onCerrar={() => setFlujoVisto(null)} ancho="max-w-5xl">
          <img src={`/flujos/${flujoVisto}.webp`} alt={`Flujo ${nombreFlujo(flujoVisto)} en el editor de n8n`} className="w-full rounded-2xl ring-1 ring-linea" />
          <p className="mt-3 text-sm text-gris">Así se ve este flujo en el editor de n8n. Cada caja es un paso: disparador, lectura de datos, lógica, guardado y email.</p>
        </Modal>
      )}
    </div>
  )
}

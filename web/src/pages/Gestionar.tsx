import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { alClicar, useTitulo } from '../lib/util'

type Datos = Awaited<ReturnType<typeof api.demo.reserva>>

/**
 * Página de una reserva desde el enlace del email (en la demo). En producción la sirve n8n
 * en la misma dirección (/webhook/reserva), con las mismas acciones.
 */
export function Gestionar() {
  useTitulo('Tu reserva')
  const params = new URLSearchParams(location.search)
  const t = params.get('t') ?? ''
  const sugerida = params.get('accion')
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    api.demo.reserva(t).then(setD).catch((e: Error) => setError(e.message))
  }, [t])

  const accion = async (a: 'cancelar' | 'confirmar') => {
    setEnviando(true)
    try {
      setD(await api.demo.reserva(t, a))
    } finally {
      setEnviando(false)
    }
  }

  if (error) return <main className="mx-auto max-w-md px-4 py-16 text-center"><h1 className="font-serif text-3xl">Reserva no encontrada</h1><p className="mt-2 text-gris">{error}</p></main>
  if (!d) return <main className="py-24 text-center text-gris">Cargando…</main>
  const r = d.reserva
  const estado = { confirmada: r.activa ? 'Confirmada' : 'Finalizada', cancelada: 'Cancelada', llegada: 'Disfrutada', no_show: 'No presentada' }[r.estado]
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-3xl bg-papel p-6 shadow-xl ring-1 ring-linea">
        {d.aviso && <p className="mb-4 rounded-2xl bg-oliva/15 p-3 font-semibold text-oliva">{d.aviso}</p>}
        <h1 className="font-serif text-4xl">Tu reserva</h1>
        <p className={`mt-1 font-semibold ${r.estado === 'cancelada' ? 'text-teja' : 'text-oliva'}`}>{estado}</p>
        <dl className="mt-5 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 border-y border-linea py-4 text-sm">
          {[
            ['Fecha', r.fechaTexto],
            ['Hora', r.hora],
            ['Personas', String(r.personas)],
            ['Mesa', `${r.mesaNombre}${r.zona ? ` · ${r.zona}` : ''}`],
            ['Nombre', r.nombre],
            ['Código', r.codigo],
            ...(r.notas ? [['Notas', r.notas]] : []),
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gris">{k}</dt>
              <dd className="font-semibold first-letter:uppercase">{v}</dd>
            </div>
          ))}
        </dl>
        {r.activa && (
          <div className="mt-5 flex flex-col gap-2">
            {r.asistencia === 'confirmada' ? (
              <p className="font-semibold text-oliva">✓ Has confirmado que vienes.</p>
            ) : (
              <button disabled={enviando} onClick={() => accion('confirmar')} className={`rounded-full py-3.5 font-semibold ${sugerida === 'confirmar' ? 'bg-oliva text-white ring-4 ring-oliva/25' : 'bg-tinta text-crema'}`}>
                Confirmo que voy
              </button>
            )}
            <button disabled={enviando} onClick={() => accion('cancelar')} className={`rounded-full py-3.5 font-semibold ${sugerida === 'cancelar' ? 'bg-teja text-white ring-4 ring-teja/25' : 'bg-teja/10 text-teja-osc'}`}>
              Cancelar reserva
            </button>
            <p className="text-center text-xs text-gris">Si cancelas, la mesa pasa sola al primero de la lista de espera.</p>
          </div>
        )}
      </div>
      <p className="mt-5 text-center">
        <a href="/" onClick={alClicar('/')} className="text-sm font-semibold text-teja">
          Volver a la web
        </a>
      </p>
    </main>
  )
}

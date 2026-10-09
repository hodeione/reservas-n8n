import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Avisos } from '../../components/ui'
import { ApiError, api, type DatosAdmin } from '../../lib/api'
import { alClicar, useGuardado, useRuta, useTitulo } from '../../lib/util'
import { Ajustes } from './Ajustes'
import { CartaAdmin } from './CartaAdmin'
import { EditorPlano } from './EditorPlano'
import { Hoy } from './Hoy'

const PESTANAS = [
  { ruta: '/admin', texto: 'Reservas', icono: '📅' },
  { ruta: '/admin/plano', texto: 'Mesas', icono: '🪑' },
  { ruta: '/admin/carta', texto: 'Carta', icono: '🍽️' },
  { ruta: '/admin/ajustes', texto: 'Ajustes', icono: '⚙️' },
]

export function Admin() {
  const [clave, setClave] = useGuardado('admin-clave', '')
  const [datos, setDatos] = useState<DatosAdmin | null>(null)
  const [fecha, setFecha] = useState('')
  const [error, setError] = useState('')
  const ruta = useRuta()
  useTitulo(`${PESTANAS.find((p) => p.ruta === ruta)?.texto ?? 'Panel'} · ${datos?.config.nombre ?? 'Restaurante'}`)

  const cargar = useCallback(
    async (f?: string) => {
      if (!clave) return
      try {
        const d = await api.admin.datos(clave, f)
        setDatos(d)
        setFecha(d.fecha)
        setError('')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setClave('')
          setDatos(null)
          setError('La clave no es correcta.')
        } else setError((e as Error).message)
      }
    },
    [clave, setClave],
  )

  useEffect(() => {
    cargar()
  }, [cargar])

  // Refresco automático de las reservas cada minuto.
  useEffect(() => {
    if (!datos || ruta !== '/admin') return
    const t = setInterval(() => document.visibilityState === 'visible' && cargar(fecha), 60_000)
    return () => clearInterval(t)
  }, [datos, ruta, fecha, cargar])

  if (!clave) return <Acceso onEntrar={setClave} error={error} />
  if (!datos) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        {error ? (
          <>
            <p className="text-gris">{error}</p>
            <button onClick={() => cargar()} className="rounded-full bg-teja px-5 py-3 font-semibold text-white">
              Reintentar
            </button>
          </>
        ) : (
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-linea border-t-teja" aria-label="Cargando" />
        )}
      </div>
    )
  }

  const actualizar = (parcial: Partial<DatosAdmin>) => setDatos((d) => (d ? { ...d, ...parcial } : d))

  return (
    <Avisos>
      <div className="min-h-screen pb-24 sm:pb-10">
        <header className="sticky top-0 z-30 border-b border-linea bg-papel/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tinta text-oro">☾</span>
            <div className="min-w-0 leading-tight">
              <p className="truncate font-serif text-lg font-semibold">{datos.config.nombre}</p>
              <p className="text-xs text-gris">Panel del restaurante</p>
            </div>
            <nav className="ml-6 hidden gap-1 sm:flex">
              {PESTANAS.map((p) => (
                <a
                  key={p.ruta}
                  href={p.ruta}
                  onClick={alClicar(p.ruta)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${ruta === p.ruta ? 'bg-tinta text-crema' : 'hover:bg-linea/60'}`}
                >
                  {p.texto}
                </a>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <a href="/" target="_blank" rel="noopener" className="rounded-full px-3 py-2 text-sm font-medium hover:bg-linea/60">
                Ver la web ↗
              </a>
              <button onClick={() => (setClave(''), setDatos(null))} className="rounded-full px-3 py-2 text-sm font-medium text-gris hover:bg-linea/60">
                Salir
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
          {ruta === '/admin/plano' ? (
            <EditorPlano clave={clave} datos={datos} onGuardado={(mesas) => actualizar({ mesas })} />
          ) : ruta === '/admin/carta' ? (
            <CartaAdmin clave={clave} datos={datos} onGuardado={(carta) => actualizar({ carta })} />
          ) : ruta === '/admin/ajustes' ? (
            <Ajustes clave={clave} datos={datos} onGuardado={(config) => actualizar({ config })} />
          ) : (
            <Hoy clave={clave} datos={datos} recargar={cargar} />
          )}
        </div>

        {/* Pestañas abajo en el móvil, al alcance del pulgar. */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-linea bg-papel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
          {PESTANAS.map((p) => (
            <a
              key={p.ruta}
              href={p.ruta}
              onClick={alClicar(p.ruta)}
              aria-current={ruta === p.ruta ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${ruta === p.ruta ? 'text-teja' : 'text-gris'}`}
            >
              <span className="text-xl" aria-hidden="true">
                {p.icono}
              </span>
              {p.texto}
            </a>
          ))}
        </nav>
      </div>
    </Avisos>
  )
}

function Acceso({ onEntrar, error }: { onEntrar: (c: string) => void; error: string }) {
  useTitulo('Acceso del restaurante')
  const [valor, setValor] = useState('')
  const [probando, setProbando] = useState(false)
  const [fallo, setFallo] = useState(error)
  async function entrar(e: FormEvent) {
    e.preventDefault()
    setProbando(true)
    try {
      await api.admin.datos(valor.trim())
      onEntrar(valor.trim())
    } catch (err) {
      setFallo(err instanceof ApiError && err.status === 401 ? 'La clave no es correcta.' : (err as Error).message)
    } finally {
      setProbando(false)
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={entrar} className="w-full max-w-sm rounded-3xl bg-papel p-8 shadow-xl ring-1 ring-linea">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-tinta text-2xl text-oro">☾</span>
        <h1 className="mt-4 font-serif text-3xl">Panel del restaurante</h1>
        <p className="mt-1 text-sm text-gris">Reservas, mesas, carta y horarios. Todo desde aquí.</p>
        <label className="mt-6 block">
          <span className="mb-1 block text-sm font-semibold">Clave del restaurante</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={valor}
            onChange={(e) => (setValor(e.target.value), setFallo(''))}
            className="w-full rounded-xl border border-linea bg-white px-4 py-3 text-base outline-none focus:border-teja"
          />
        </label>
        {fallo && (
          <p role="alert" className="mt-3 text-sm font-semibold text-teja">
            {fallo}
          </p>
        )}
        <button disabled={probando} className="mt-5 w-full rounded-full bg-teja py-3.5 font-semibold text-white disabled:opacity-60">
          {probando ? 'Comprobando…' : 'Entrar'}
        </button>
        <p className="mt-4 text-center text-xs text-gris">En este dispositivo no tendrás que volver a ponerla.</p>
      </form>
    </main>
  )
}

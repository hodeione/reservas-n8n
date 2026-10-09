import { Suspense, lazy, useEffect, useState } from 'react'
import { DemoBarra, DemoBienvenida } from './components/Demo'
import { Cabecera, Pie } from './components/Sitio'
import { api, type DatosWeb } from './lib/api'
import { alClicar, useRuta } from './lib/util'
import { Carta } from './pages/Carta'
import { Gestionar } from './pages/Gestionar'
import { Inicio } from './pages/Inicio'
import { Reservar } from './pages/Reservar'

// El panel del restaurante se descarga solo cuando alguien entra en /admin.
const Admin = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Admin })))

const Cargando = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-linea border-t-teja" aria-label="Cargando" />
  </div>
)

export default function App() {
  const ruta = useRuta()
  if (ruta === '/admin' || ruta.startsWith('/admin/')) {
    return (
      <Suspense fallback={<Cargando />}>
        <Admin />
        <DemoBienvenida />
      </Suspense>
    )
  }
  return <Publica ruta={ruta} />
}

function Publica({ ruta }: { ruta: string }) {
  const [d, setD] = useState<DatosWeb | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api
      .web()
      .then(setD)
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-serif text-3xl">Ahora mismo no podemos cargar la web</p>
        <p className="text-gris">{error}</p>
        <button onClick={() => location.reload()} className="rounded-full bg-teja px-5 py-3 font-semibold text-white">
          Reintentar
        </button>
      </div>
    )
  }
  if (!d) return <Cargando />

  const pagina =
    ruta === '/carta' ? <Carta d={d} /> : ruta === '/reservar' ? <Reservar d={d} /> : ruta === '/' ? <Inicio d={d} /> : ruta === '/webhook/reserva' ? <Gestionar /> : <NoEncontrada />
  return (
    <>
      <DemoBarra />
      <DemoBienvenida />
      <Cabecera r={d.restaurante} />
      {pagina}
      <Pie r={d.restaurante} />
    </>
  )
}

function NoEncontrada() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="font-serif text-5xl">Esta página no existe</h1>
      <a href="/" onClick={alClicar('/')} className="mt-6 inline-block rounded-full bg-teja px-6 py-3 font-semibold text-white">
        Ir al inicio
      </a>
    </main>
  )
}

import { useState } from 'react'
import { DEMO, api } from '../lib/api'
import { alClicar, useGuardado, useRuta } from '../lib/util'

/** Barra de la demo pública: cambia entre la vista del cliente, el panel y las automatizaciones. */
export function DemoBarra() {
  const ruta = useRuta()
  const [reiniciando, setReiniciando] = useState(false)
  if (!DEMO) return null
  const vista = ruta.startsWith('/admin/automatizaciones') ? 'auto' : ruta.startsWith('/admin') ? 'admin' : 'cliente'
  const enlace = (href: string, id: string, texto: string, corto: string) => (
    <a
      href={href}
      onClick={alClicar(href)}
      aria-current={vista === id ? 'page' : undefined}
      className={`rounded-full px-3 py-1.5 font-semibold transition-colors ${vista === id ? 'bg-oro text-tinta' : 'text-white/80 hover:text-white'}`}
    >
      <span className="hidden sm:inline">{texto}</span>
      <span className="sm:hidden">{corto}</span>
    </a>
  )
  return (
    <div className="relative z-40 bg-[#14100c] text-xs text-white">
      <div className="no-scrollbar mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-3 py-1.5 sm:gap-2 sm:px-6">
        <span className="mr-1 hidden shrink-0 rounded bg-white/10 px-2 py-1 font-bold tracking-widest text-oro md:inline">DEMO</span>
        {enlace('/', 'cliente', 'Vista del cliente', 'Cliente')}
        {enlace('/admin', 'admin', 'Panel del restaurante', 'Restaurante')}
        {enlace('/admin/automatizaciones', 'auto', 'Automatizaciones y emails', 'Automatizaciones')}
        <button
          onClick={async () => {
            if (!confirm('¿Volver a empezar la demo con los datos de ejemplo?')) return
            setReiniciando(true)
            await api.demo.reiniciar()
            location.reload()
          }}
          className="ml-auto shrink-0 rounded-full px-3 py-1.5 text-white/60 hover:text-white"
        >
          {reiniciando ? 'Reiniciando…' : '↺ Reiniciar'}
        </button>
      </div>
    </div>
  )
}

/** Primera visita a la demo: qué se puede probar. */
export function DemoBienvenida() {
  const [visto, setVisto] = useGuardado('demo-bienvenida', false)
  if (!DEMO || visto) return null
  const cerrar = () => setVisto(true)
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-tinta/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={cerrar}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Demo" className="w-full max-w-lg rounded-t-3xl bg-papel p-6 shadow-2xl sm:rounded-3xl sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-teja">Demo de DH Technology</p>
        <h2 className="mt-2 font-serif text-3xl leading-tight">Un restaurante que se gestiona solo</h2>
        <p className="mt-2 text-gris">Taberna Luna es un restaurante de ejemplo. Puedes usarlo todo como lo haría un cliente y como lo haría el propio restaurante:</p>
        <ul className="mt-4 space-y-2.5 text-sm">
          <li>🍽️ <b>Carta con platos reales en 3D.</b> Desde el móvil, apunta a un plato vacío y te lo sirve encima.</li>
          <li>🪑 <b>Reserva eligiendo mesa</b> en el plano del local.</li>
          <li>🧑‍🍳 <b>Panel del restaurante</b> sin código: sala en vivo, plano, carta y horarios.</li>
          <li>⚙️ <b>Diez automatizaciones</b> de n8n: lánzalas y mira los emails que envían.</li>
        </ul>
        <p className="mt-4 text-xs text-gris">Los datos se guardan solo en tu navegador. Los emails no se envían de verdad: los verás en «Automatizaciones y emails».</p>
        <button onClick={cerrar} className="mt-6 w-full rounded-full bg-teja py-3.5 font-semibold text-white">
          Empezar
        </button>
      </div>
    </div>
  )
}

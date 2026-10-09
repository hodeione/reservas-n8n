import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/* ----------------------------------------------------------- avisos */

type Aviso = { id: number; texto: string; tipo: 'ok' | 'error' }
const Ctx = createContext<(texto: string, tipo?: Aviso['tipo']) => void>(() => {})
export const useAviso = () => useContext(Ctx)

export function Avisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Aviso[]>([])
  const avisar = useCallback((texto: string, tipo: Aviso['tipo'] = 'ok') => {
    const id = Date.now() + Math.random()
    setLista((l) => [...l, { id, texto, tipo }])
    setTimeout(() => setLista((l) => l.filter((a) => a.id !== id)), tipo === 'error' ? 6000 : 3000)
  }, [])
  return (
    <Ctx.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {lista.map((a) => (
          <div key={a.id} className={`pointer-events-auto max-w-md rounded-2xl px-5 py-3 text-sm font-semibold shadow-xl ${a.tipo === 'ok' ? 'bg-tinta text-crema' : 'bg-teja text-white'}`}>
            {a.tipo === 'ok' ? '✓ ' : ''}
            {a.texto}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

/* ----------------------------------------------------------- ventana modal */

export function Modal({ titulo, onCerrar, children, ancho = 'max-w-lg' }: { titulo: string; onCerrar: () => void; children: ReactNode; ancho?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    ref.current?.focus()
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', esc)
    }
  }, [onCerrar])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-tinta/50 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={onCerrar}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-[94vh] w-full ${ancho} flex-col overflow-hidden rounded-t-3xl bg-papel shadow-2xl outline-none sm:rounded-3xl`}
      >
        <div className="flex items-center justify-between border-b border-linea px-5 py-4">
          <h2 className="font-serif text-2xl">{titulo}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full text-xl hover:bg-linea/60">
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- formularios */

export const entrada = 'w-full rounded-xl border border-linea bg-white px-3.5 py-2.5 text-base outline-none transition-colors focus:border-teja disabled:bg-crema'

export function Campo({ etiqueta, ayuda, children, className = '' }: { etiqueta: string; ayuda?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-semibold">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-gris">{ayuda}</span>}
    </label>
  )
}

export function Interruptor({ activo, onCambio, texto, ayuda }: { activo: boolean; onCambio: (v: boolean) => void; texto: string; ayuda?: string }) {
  return (
    <button type="button" role="switch" aria-checked={activo} onClick={() => onCambio(!activo)} className="flex w-full items-center gap-3 rounded-xl py-1.5 text-left">
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${activo ? 'bg-oliva' : 'bg-linea'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${activo ? 'left-6' : 'left-1'}`} />
      </span>
      <span>
        <span className="block text-sm font-semibold">{texto}</span>
        {ayuda && <span className="block text-xs text-gris">{ayuda}</span>}
      </span>
    </button>
  )
}

export function Contador({ valor, onCambio, min = 1, max = 99 }: { valor: number; onCambio: (v: number) => void; min?: number; max?: number }) {
  const b = 'flex h-11 w-11 items-center justify-center rounded-xl bg-crema text-xl font-bold ring-1 ring-linea disabled:opacity-40'
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={b} disabled={valor <= min} onClick={() => onCambio(Math.max(min, valor - 1))} aria-label="Menos">
        −
      </button>
      <span className="w-10 text-center text-lg font-bold tabular-nums">{valor}</span>
      <button type="button" className={b} disabled={valor >= max} onClick={() => onCambio(Math.min(max, valor + 1))} aria-label="Más">
        +
      </button>
    </div>
  )
}

export function Tarjeta({ titulo, sub, children, accion }: { titulo?: string; sub?: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-3xl bg-papel p-5 ring-1 ring-linea sm:p-6">
      {(titulo || accion) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {titulo && <h2 className="font-serif text-2xl">{titulo}</h2>}
            {sub && <p className="mt-0.5 text-sm text-gris">{sub}</p>}
          </div>
          {accion}
        </div>
      )}
      {children}
    </section>
  )
}

/** Barra fija para guardar cambios pendientes. */
export function BarraGuardar({ cambios, guardando, onGuardar, onDescartar }: { cambios: boolean; guardando: boolean; onGuardar: () => void; onDescartar: () => void }) {
  useEffect(() => {
    if (!cambios) return
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [cambios])
  if (!cambios) return null
  return (
    <div className="fixed inset-x-0 bottom-16 z-40 px-3 sm:bottom-4">
      <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl bg-tinta p-3 pl-5 text-crema shadow-2xl">
        <span className="flex-1 text-sm font-semibold">Tienes cambios sin guardar</span>
        <button onClick={onDescartar} disabled={guardando} className="rounded-xl px-3 py-2 text-sm font-semibold text-crema/70 hover:text-crema">
          Descartar
        </button>
        <button onClick={onGuardar} disabled={guardando} className="rounded-xl bg-oro px-5 py-2.5 text-sm font-bold text-tinta disabled:opacity-60">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

/** Estado editable con «hay cambios», «guardar» y «descartar». */
export function useBorrador<T>(original: T, guardar: (v: T) => Promise<T>) {
  const [borrador, setBorrador] = useState<T>(original)
  const [base, setBase] = useState<T>(original)
  const [guardando, setGuardando] = useState(false)
  const avisar = useAviso()
  // Si llegan datos nuevos del servidor y no hay cambios, se adoptan.
  const refBase = useRef(base)
  refBase.current = base
  useEffect(() => {
    const b = refBase.current
    if (JSON.stringify(b) === JSON.stringify(original)) return
    setBorrador((x) => (JSON.stringify(x) === JSON.stringify(b) ? original : x))
    setBase(original)
  }, [original])
  const cambios = JSON.stringify(borrador) !== JSON.stringify(base)
  return {
    borrador,
    setBorrador,
    cambios,
    guardando,
    descartar: () => setBorrador(base),
    guardar: async () => {
      setGuardando(true)
      try {
        const v = await guardar(borrador)
        setBase(v)
        setBorrador(v)
        avisar('Cambios guardados. Ya se ven en la web.')
      } catch (e) {
        avisar((e as Error).message, 'error')
      } finally {
        setGuardando(false)
      }
    },
  }
}

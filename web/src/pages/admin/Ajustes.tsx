import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { BarraGuardar, Campo, Tarjeta, entrada, useBorrador } from '../../components/ui'
import { api, type DatosAdmin, type Restaurante } from '../../lib/api'
import { DIAS, fechaLarga } from '../../lib/util'

interface Props {
  clave: string
  datos: DatosAdmin
  onGuardado: (c: Restaurante) => void
}

const ANTELACION = [
  [0, 'Sin mínimo'],
  [30, '30 minutos'],
  [60, '1 hora'],
  [120, '2 horas'],
  [240, '4 horas'],
  [1440, '1 día'],
] as const

export function Ajustes({ clave, datos, onGuardado }: Props) {
  const { borrador: c, setBorrador, cambios, guardando, guardar, descartar } = useBorrador<Restaurante>(datos.config, async (v) => {
    const r = await api.admin.guardar<Restaurante>(clave, 'config', v)
    onGuardado(r.valor)
    return r.valor
  })
  const set = <K extends keyof Restaurante>(k: K, v: Restaurante[K]) => setBorrador({ ...c, [k]: v })
  const texto = (k: 'nombre' | 'eslogan' | 'direccion' | 'telefono' | 'email' | 'instagram' | 'resena' | 'emailDueno') => ({
    value: (c[k] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
    className: entrada,
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-3xl sm:text-4xl">Ajustes</h1>
        <p className="text-sm text-gris">Horarios, reglas de reserva y datos del restaurante.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Tarjeta titulo="Días que abrís">
          <div className="grid grid-cols-7 gap-1.5">
            {DIAS.map((d, i) => {
              const abierto = !c.cerrado.includes(i + 1)
              return (
                <button
                  key={d}
                  onClick={() => set('cerrado', abierto ? [...c.cerrado, i + 1].sort() : c.cerrado.filter((x) => x !== i + 1))}
                  aria-pressed={abierto}
                  aria-label={`${d}: ${abierto ? 'abierto' : 'cerrado'}`}
                  className={`rounded-xl py-3 text-sm font-bold ${abierto ? 'bg-oliva text-white' : 'bg-crema text-gris line-through ring-1 ring-linea'}`}
                >
                  {d.slice(0, 2)}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-gris">Toca un día para abrirlo o cerrarlo.</p>
          <Vacaciones fechas={c.vacaciones} onCambio={(v) => set('vacaciones', v)} />
        </Tarjeta>

        <Tarjeta titulo="Horas de reserva" sub="Las horas a las que el cliente puede llegar.">
          {(
            [
              ['comida', 'Comidas'],
              ['cena', 'Cenas'],
            ] as const
          ).map(([t, nombre]) => (
            <div key={t} className="mb-5 last:mb-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{nombre}</span>
                <label className="flex items-center gap-2 text-xs text-gris">
                  La mesa se ocupa
                  <select value={c.duracion[t]} onChange={(e) => set('duracion', { ...c.duracion, [t]: Number(e.target.value) })} className="rounded-lg border border-linea bg-white px-2 py-1 text-sm text-tinta">
                    {[60, 75, 90, 105, 120, 150, 180].map((m) => (
                      <option key={m} value={m}>
                        {m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Horas horas={c.horas[t]} onCambio={(h) => set('horas', { ...c.horas, [t]: h })} />
            </div>
          ))}
        </Tarjeta>

        <Tarjeta titulo="Reglas de reserva">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Máximo por reserva online" ayuda="Grupos más grandes tendrán que llamar.">
              <input type="number" min={1} max={60} value={c.maxPersonas} onChange={(e) => set('maxPersonas', Number(e.target.value))} className={entrada} />
            </Campo>
            <Campo etiqueta="Llegadas a la vez" ayuda="Personas por hora que la cocina puede atender. 0 es sin límite.">
              <input type="number" min={0} max={500} value={c.franja} onChange={(e) => set('franja', Number(e.target.value))} className={entrada} />
            </Campo>
            <Campo etiqueta="Antelación mínima" ayuda="Cuánto antes hay que reservar online.">
              <select value={c.antelacionMin} onChange={(e) => set('antelacionMin', Number(e.target.value))} className={entrada}>
                {ANTELACION.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Se puede reservar hasta" ayuda="Días por adelantado.">
              <select value={c.diasMax} onChange={(e) => set('diasMax', Number(e.target.value))} className={entrada}>
                {[7, 14, 30, 60, 90, 180].map((d) => (
                  <option key={d} value={d}>
                    {d} días
                  </option>
                ))}
              </select>
            </Campo>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Avisos automáticos">
          <div className="space-y-4">
            <Campo etiqueta="Email para el informe diario" ayuda="Cada mañana a las 9 recibes las reservas del día.">
              <input type="email" {...texto('emailDueno')} />
            </Campo>
            <Campo etiqueta="Enlace para dejar reseña" ayuda="Al día siguiente de venir, se lo pedimos a los clientes. Pega tu enlace de Google.">
              <input type="url" placeholder="https://g.page/r/..." {...texto('resena')} />
            </Campo>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Datos del restaurante">
          <div className="space-y-4">
            <Campo etiqueta="Nombre">
              <input maxLength={60} {...texto('nombre')} />
            </Campo>
            <Campo etiqueta="Frase de presentación">
              <input maxLength={120} {...texto('eslogan')} />
            </Campo>
            <Campo etiqueta="Sobre vosotros" ayuda="Sale en la portada de la web.">
              <textarea rows={4} maxLength={600} value={c.descripcion} onChange={(e) => set('descripcion', e.target.value)} className={entrada} />
            </Campo>
            <Campo etiqueta="Dirección">
              <input maxLength={120} {...texto('direccion')} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Teléfono">
                <input type="tel" {...texto('telefono')} />
              </Campo>
              <Campo etiqueta="Email de contacto">
                <input type="email" {...texto('email')} />
              </Campo>
            </div>
            <Campo etiqueta="Instagram">
              <input placeholder="sin @" {...texto('instagram')} />
            </Campo>
            <Ubicacion lat={c.lat} lng={c.lng} direccion={c.direccion} onCambio={(lat, lng) => setBorrador({ ...c, lat, lng })} />
          </div>
        </Tarjeta>

        <QrCarta nombre={c.nombre} />
      </div>

      <BarraGuardar cambios={cambios} guardando={guardando} onGuardar={guardar} onDescartar={descartar} />
    </div>
  )
}

function Horas({ horas, onCambio }: { horas: string[]; onCambio: (h: string[]) => void }) {
  const [nueva, setNueva] = useState('')
  const anadir = () => {
    if (!/^\d{2}:\d{2}$/.test(nueva) || horas.includes(nueva)) return
    onCambio([...horas, nueva].sort())
    setNueva('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {horas.map((h) => (
        <span key={h} className="inline-flex items-center gap-1 rounded-full bg-crema py-1 pl-3 pr-1 text-sm font-semibold tabular-nums ring-1 ring-linea">
          {h}
          <button onClick={() => onCambio(horas.filter((x) => x !== h))} aria-label={`Quitar ${h}`} className="flex h-6 w-6 items-center justify-center rounded-full text-gris hover:bg-teja hover:text-white">
            ×
          </button>
        </span>
      ))}
      {!horas.length && <span className="text-sm text-gris">Sin horas: este turno no se reserva.</span>}
      <span className="inline-flex items-center gap-1">
        <input type="time" step={900} value={nueva} onChange={(e) => setNueva(e.target.value)} className="rounded-full border border-linea bg-white px-3 py-1 text-sm" aria-label="Nueva hora" />
        <button onClick={anadir} disabled={!nueva} className="rounded-full bg-tinta px-3 py-1.5 text-sm font-semibold text-crema disabled:opacity-40">
          Añadir
        </button>
      </span>
    </div>
  )
}

function Vacaciones({ fechas, onCambio }: { fechas: string[]; onCambio: (f: string[]) => void }) {
  const [nueva, setNueva] = useState('')
  return (
    <div className="mt-5 border-t border-linea pt-4">
      <span className="text-sm font-semibold">Días cerrados sueltos</span>
      <p className="text-xs text-gris">Vacaciones, festivos o eventos privados.</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {fechas.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 rounded-full bg-crema py-1 pl-3 pr-1 text-sm ring-1 ring-linea">
            {fechaLarga(f)}
            <button onClick={() => onCambio(fechas.filter((x) => x !== f))} aria-label={`Quitar ${f}`} className="flex h-6 w-6 items-center justify-center rounded-full text-gris hover:bg-teja hover:text-white">
              ×
            </button>
          </span>
        ))}
        <input type="date" value={nueva} onChange={(e) => setNueva(e.target.value)} className="rounded-full border border-linea bg-white px-3 py-1 text-sm" aria-label="Añadir día cerrado" />
        <button
          onClick={() => {
            if (nueva && !fechas.includes(nueva)) onCambio([...fechas, nueva].sort())
            setNueva('')
          }}
          disabled={!nueva}
          className="rounded-full bg-tinta px-3 py-1.5 text-sm font-semibold text-crema disabled:opacity-40"
        >
          Añadir
        </button>
      </div>
    </div>
  )
}

/** Busca la dirección en OpenStreetMap para colocar el mapa de la web. */
function Ubicacion({ lat, lng, direccion, onCambio }: { lat: number; lng: number; direccion: string; onCambio: (lat: number, lng: number) => void }) {
  const [estado, setEstado] = useState('')
  async function buscar() {
    setEstado('Buscando…')
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(direccion)}`, { headers: { 'accept-language': 'es' } })
      const [x] = (await r.json()) as { lat: string; lon: string }[]
      if (!x) return setEstado('No hemos encontrado esa dirección. Prueba a añadir la ciudad.')
      onCambio(Number(Number(x.lat).toFixed(5)), Number(Number(x.lon).toFixed(5)))
      setEstado('Ubicación actualizada. Pulsa Guardar.')
    } catch {
      setEstado('No se ha podido buscar ahora mismo.')
    }
  }
  return (
    <div className="rounded-2xl bg-crema p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Punto en el mapa</p>
          <p className="truncate text-xs text-gris">
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </p>
        </div>
        <button type="button" onClick={buscar} disabled={!direccion} className="shrink-0 rounded-full bg-tinta px-4 py-2 text-sm font-semibold text-crema disabled:opacity-40">
          Situar por la dirección
        </button>
      </div>
      {estado && <p className="mt-2 text-xs text-gris">{estado}</p>}
    </div>
  )
}

function QrCarta({ nombre }: { nombre: string }) {
  const url = `${window.location.origin}/carta`
  const [img, setImg] = useState('')
  useEffect(() => {
    QRCode.toDataURL(url, { width: 600, margin: 1, color: { dark: '#2b2118', light: '#ffffff' } }).then(setImg)
  }, [url])
  function imprimir() {
    const w = window.open('', '_blank')
    if (!w) return
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string)
    w.document.write(`<!doctype html><meta charset="utf-8"><title>QR carta</title>
<style>body{margin:0;font-family:Georgia,serif;color:#2b2118}.p{display:grid;grid-template-columns:1fr 1fr;gap:0}.c{border:1px dashed #ccc;padding:28px;text-align:center;page-break-inside:avoid}
h1{font-size:26px;margin:0 0 4px}p{font-family:system-ui,sans-serif;margin:4px 0;color:#7b6f63;font-size:13px}img{width:200px;height:200px;margin:12px auto;display:block}b{color:#b4532a}</style>
<div class="p">${Array.from({ length: 4 }, () => `<div class="c"><h1>${esc(nombre)}</h1><p>Escanea y mira la carta</p><img src="${img}"><p><b>Ve los platos en 3D</b> sobre tu mesa</p></div>`).join('')}</div>
<script>onload=()=>print()</script>`)
    w.document.close()
  }
  return (
    <Tarjeta titulo="QR para las mesas" sub="Los clientes escanean y ven la carta en 3D en su móvil.">
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        {img ? <img src={img} alt="Código QR de la carta" className="h-40 w-40 rounded-xl ring-1 ring-linea" /> : <div className="h-40 w-40 animate-pulse rounded-xl bg-crema" />}
        <div className="flex-1 space-y-2 text-center sm:text-left">
          <p className="break-all text-sm text-gris">{url}</p>
          <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
            <button onClick={imprimir} disabled={!img} className="rounded-full bg-teja px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              Imprimir hoja de QR
            </button>
            <a href={img} download="qr-carta.png" className="rounded-full px-5 py-2.5 text-sm font-semibold ring-1 ring-linea">
              Descargar imagen
            </a>
          </div>
        </div>
      </div>
    </Tarjeta>
  )
}

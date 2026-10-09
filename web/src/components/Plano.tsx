import type { PointerEvent as RPointerEvent, ReactNode } from 'react'
import type { Mesa } from '../lib/api'

export type Aspecto = 'libre' | 'ocupada' | 'no_cabe' | 'seleccionada' | 'recomendada' | 'neutra' | 'llegada'

const ESTILO: Record<Aspecto, { fill: string; stroke: string; texto: string; silla: string; dash?: string; opacidad?: number }> = {
  libre: { fill: '#fffdf9', stroke: '#b4532a', texto: '#2b2118', silla: '#d9b8a5' },
  recomendada: { fill: '#fff6e0', stroke: '#e8b64c', texto: '#2b2118', silla: '#e8cf8f' },
  seleccionada: { fill: '#b4532a', stroke: '#8f3f1d', texto: '#ffffff', silla: '#8f3f1d' },
  ocupada: { fill: '#ebe4d9', stroke: '#cfc4b4', texto: '#9d9284', silla: '#ddd3c5' },
  no_cabe: { fill: '#fffdf9', stroke: '#cfc4b4', texto: '#b3a899', silla: '#e6dccd', dash: '6 5', opacidad: 0.7 },
  neutra: { fill: '#fffdf9', stroke: '#7b6f63', texto: '#2b2118', silla: '#d8cdbd' },
  llegada: { fill: '#e7efd9', stroke: '#5f6b3a', texto: '#2b2118', silla: '#b7c39a' },
}

/** Posiciones de las sillas alrededor de una mesa (decorativas). */
function sillas(m: Mesa): [number, number][] {
  const n = Math.max(1, m.plazas)
  const cx = m.x + m.w / 2
  const cy = m.y + m.h / 2
  if (m.forma === 'redonda') {
    const r = Math.max(m.w, m.h) / 2 + 13
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
    })
  }
  // Rectangulares: reparte en los lados largos; si sobran, en las cabeceras.
  const horizontal = m.w >= m.h
  const largo = horizontal ? m.w : m.h
  const cabeceras = n >= 6 && n % 2 === 0 ? 2 : n % 2
  const porLado = Math.ceil((n - cabeceras) / 2)
  const pts: [number, number][] = []
  for (let lado = 0; lado < 2; lado++) {
    const cuantas = lado === 0 ? porLado : n - cabeceras - porLado
    for (let i = 0; i < cuantas; i++) {
      const t = (i + 0.5) / cuantas
      if (horizontal) pts.push([m.x + t * largo, lado === 0 ? m.y - 13 : m.y + m.h + 13])
      else pts.push([lado === 0 ? m.x - 13 : m.x + m.w + 13, m.y + t * largo])
    }
  }
  if (cabeceras >= 1) pts.push(horizontal ? [m.x - 13, cy] : [cx, m.y - 13])
  if (cabeceras >= 2) pts.push(horizontal ? [m.x + m.w + 13, cy] : [cx, m.y + m.h + 13])
  return pts
}

/** Encuadre que contiene todas las mesas, con margen. */
export function encuadre(mesas: Mesa[], margen = 50) {
  if (!mesas.length) return { x: 0, y: 0, w: 1000, h: 700 }
  const x0 = Math.min(...mesas.map((m) => m.x)) - margen
  const y0 = Math.min(...mesas.map((m) => m.y)) - margen - 20
  const x1 = Math.max(...mesas.map((m) => m.x + m.w)) + margen
  const y1 = Math.max(...mesas.map((m) => m.y + m.h)) + margen
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Etiquetas de zona (Salón, Terraza…) encima de cada grupo de mesas. */
function zonas(mesas: Mesa[]) {
  const por = new Map<string, Mesa[]>()
  for (const m of mesas) por.set(m.zona, [...(por.get(m.zona) ?? []), m])
  return [...por.entries()].map(([zona, ms]) => ({
    zona,
    x: Math.min(...ms.map((m) => m.x)),
    y: Math.min(...ms.map((m) => m.y)) - 40,
  }))
}

interface MesaProps {
  mesa: Mesa
  aspecto: Aspecto
  etiqueta?: string
  onPointerDown?: (e: RPointerEvent<SVGGElement>) => void
  onClick?: () => void
  interactiva?: boolean
  titulo?: string
}

export function MesaSvg({ mesa: m, aspecto, etiqueta, onPointerDown, onClick, interactiva, titulo }: MesaProps) {
  const e = ESTILO[aspecto]
  return (
    <g
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={{ cursor: interactiva ? 'pointer' : 'default', opacity: e.opacidad ?? 1, transition: 'opacity .2s' }}
      role={interactiva ? 'button' : undefined}
      tabIndex={interactiva ? 0 : undefined}
      aria-label={titulo}
      onKeyDown={(ev) => interactiva && (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onClick?.())}
    >
      {titulo && <title>{titulo}</title>}
      {sillas(m).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={8} fill={e.silla} />
      ))}
      {m.forma === 'redonda' ? (
        <ellipse cx={m.x + m.w / 2} cy={m.y + m.h / 2} rx={m.w / 2} ry={m.h / 2} fill={e.fill} stroke={e.stroke} strokeWidth={3} strokeDasharray={e.dash} />
      ) : (
        <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={12} fill={e.fill} stroke={e.stroke} strokeWidth={3} strokeDasharray={e.dash} />
      )}
      <text x={m.x + m.w / 2} y={m.y + m.h / 2 - (etiqueta ? 6 : -2)} textAnchor="middle" fontSize={22} fontWeight={700} fill={e.texto} fontFamily="Inter Variable, sans-serif">
        {m.nombre}
      </text>
      <text x={m.x + m.w / 2} y={m.y + m.h / 2 + (etiqueta ? 16 : 20)} textAnchor="middle" fontSize={13} fill={e.texto} opacity={0.8} fontFamily="Inter Variable, sans-serif">
        {etiqueta ?? `${m.plazas} pax`}
      </text>
    </g>
  )
}

interface PlanoProps {
  mesas: Mesa[]
  aspecto: (m: Mesa) => Aspecto
  etiqueta?: (m: Mesa) => string | undefined
  titulo?: (m: Mesa) => string
  onElegir?: (m: Mesa) => void
  /** Para el editor: el encuadre fijo de 1000×700 en lugar de ajustarse a las mesas. */
  lienzoCompleto?: boolean
  children?: ReactNode
  svgRef?: React.Ref<SVGSVGElement>
  onPointerMove?: (e: RPointerEvent<SVGSVGElement>) => void
  onPointerUp?: () => void
  onFondo?: () => void
  renderMesa?: (m: Mesa) => ReactNode
}

export function Plano({ mesas, aspecto, etiqueta, titulo, onElegir, lienzoCompleto, children, svgRef, onPointerMove, onPointerUp, onFondo, renderMesa }: PlanoProps) {
  const v = lienzoCompleto ? { x: 0, y: 0, w: 1000, h: 700 } : encuadre(mesas)
  return (
    <svg
      ref={svgRef}
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      className={`h-auto w-full select-none ${onPointerMove ? 'touch-none' : ''}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      role="img"
      aria-label="Plano de mesas"
    >
      <rect x={v.x} y={v.y} width={v.w} height={v.h} fill="transparent" onClick={onFondo} />
      {lienzoCompleto && (
        <g opacity={0.5}>
          {Array.from({ length: 21 }, (_, i) => <line key={'v' + i} x1={i * 50} y1={0} x2={i * 50} y2={700} stroke="#e6dccd" strokeWidth={1} />)}
          {Array.from({ length: 15 }, (_, i) => <line key={'h' + i} x1={0} y1={i * 50} x2={1000} y2={i * 50} stroke="#e6dccd" strokeWidth={1} />)}
        </g>
      )}
      {zonas(mesas).map((z) => (
        <text key={z.zona} x={z.x} y={z.y + 12} fontSize={15} fontWeight={700} letterSpacing={2} fill="#9d9284" fontFamily="Inter Variable, sans-serif">
          {z.zona.toUpperCase()}
        </text>
      ))}
      {mesas.map((m) =>
        renderMesa ? (
          <g key={m.id}>{renderMesa(m)}</g>
        ) : (
          <MesaSvg
            key={m.id}
            mesa={m}
            aspecto={aspecto(m)}
            etiqueta={etiqueta?.(m)}
            titulo={titulo?.(m)}
            interactiva={!!onElegir && ['libre', 'recomendada', 'seleccionada'].includes(aspecto(m))}
            onClick={onElegir && ['libre', 'recomendada', 'seleccionada'].includes(aspecto(m)) ? () => onElegir(m) : undefined}
          />
        ),
      )}
      {children}
    </svg>
  )
}

export function Leyenda({ items }: { items: [Aspecto, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gris">
      {items.map(([a, t]) => (
        <span key={a} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded" style={{ background: ESTILO[a].fill, border: `2px ${ESTILO[a].dash ? 'dashed' : 'solid'} ${ESTILO[a].stroke}` }} />
          {t}
        </span>
      ))}
    </div>
  )
}

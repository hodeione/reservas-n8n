import { useEffect, useState, type CSSProperties } from 'react'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>
    }
  }
}

// El componente de Google (~1 MB con three.js) se descarga solo cuando hace falta.
let carga: Promise<unknown> | null = null
const cargarVisor = () => (carga ??= import('@google/model-viewer'))

interface Props {
  modelo: string
  nombre: string
  /** Botón «Ver en tu mesa» (realidad aumentada en móviles compatibles). */
  ar?: boolean
  giro?: boolean
  controles?: boolean
  className?: string
  style?: CSSProperties
}

export function Modelo3D({ modelo, nombre, ar = false, giro = true, controles = true, className = '', style }: Props) {
  const [listo, setListo] = useState(false)
  useEffect(() => {
    let vivo = true
    cargarVisor().then(() => vivo && setListo(true))
    return () => {
      vivo = false
    }
  }, [])

  if (!listo) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={style}>
        <img src={`/miniaturas/${modelo}.png`} alt={nombre} className="h-2/3 w-2/3 animate-pulse object-contain opacity-80" />
      </div>
    )
  }
  return (
    <model-viewer
      src={`/modelos/${modelo}.glb`}
      poster={`/miniaturas/${modelo}.png`}
      alt={`Modelo 3D de ${nombre}`}
      {...(controles ? { 'camera-controls': '' } : {})}
      {...(giro ? { 'auto-rotate': '', 'auto-rotate-delay': '0', 'rotation-per-second': '25deg' } : {})}
      {...(ar ? { ar: '', 'ar-modes': 'webxr scene-viewer quick-look', 'ar-scale': 'fixed', 'ar-placement': 'floor' } : {})}
      shadow-intensity="1"
      shadow-softness="0.8"
      exposure="1.05"
      environment-image="neutral"
      camera-orbit="30deg 62deg auto"
      interaction-prompt="none"
      touch-action="pan-y"
      class={className}
      style={{ background: 'transparent', ...style }}
    >
      {ar && (
        <button
          slot="ar-button"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-tinta px-5 py-3 text-sm font-semibold text-white shadow-lg"
        >
          📱 Verlo en tu mesa
        </button>
      )}
    </model-viewer>
  )
}

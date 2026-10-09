import { useEffect, useState, type CSSProperties } from 'react'
import { urlMiniatura, urlModelo } from '../lib/modelos'

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
const cargarVisor = () =>
  (carga ??= import('@google/model-viewer').then((m) => {
    // Los escaneos llevan la geometría comprimida con meshopt: descompresor local, sin CDN.
    ;(m.ModelViewerElement as unknown as { meshoptDecoderLocation: string }).meshoptDecoderLocation = '/vendor/meshopt_decoder.js'
  }))

interface Props {
  modelo: string
  nombre: string
  /** Botón «Ver a tamaño real» (realidad aumentada nativa en móviles compatibles). */
  ar?: boolean
  giro?: boolean
  controles?: boolean
  className?: string
  style?: CSSProperties
  orbita?: string
}

export function Modelo3D({ modelo, nombre, ar = false, giro = true, controles = true, className = '', style, orbita = '25deg 58deg auto' }: Props) {
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
        <img src={urlMiniatura(modelo)} alt={nombre} className="h-3/4 w-3/4 animate-pulse object-contain opacity-90" />
      </div>
    )
  }
  return (
    <model-viewer
      src={urlModelo(modelo)}
      poster={urlMiniatura(modelo)}
      alt={`Modelo 3D de ${nombre}`}
      {...(controles ? { 'camera-controls': '' } : {})}
      {...(giro ? { 'auto-rotate': '', 'auto-rotate-delay': '0', 'rotation-per-second': '18deg' } : {})}
      {...(ar ? { ar: '', 'ar-modes': 'webxr scene-viewer quick-look', 'ar-scale': 'fixed', 'ar-placement': 'floor' } : {})}
      shadow-intensity="1.1"
      shadow-softness="0.8"
      exposure="1.05"
      environment-image="neutral"
      camera-orbit={orbita}
      field-of-view="28deg"
      interaction-prompt="none"
      touch-action="pan-y"
      class={className}
      style={{ background: 'transparent', ...style }}
    >
      {ar && (
        <button slot="ar-button" className="absolute bottom-3 right-3 rounded-full bg-white/90 px-4 py-2.5 text-xs font-semibold text-tinta shadow-lg">
          Tamaño real (AR)
        </button>
      )}
    </model-viewer>
  )
}

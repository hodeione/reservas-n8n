import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { urlMiniatura, urlModelo } from '../lib/modelos'

/**
 * Visor «de foto»: el plato servido sobre una mesa de madera real, con la luz de una cafetería
 * (HDRI de Poly Haven), sombra suave, oclusión ambiental y desenfoque de cámara.
 * Los escaneos se muestran sin iluminación artificial (traen la luz real fotografiada); la mesa
 * y la sombra sí reciben la luz de la escena, así que el plato «se asienta» en ella.
 */

const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
let entorno: Promise<THREE.DataTexture> | null = null
const cargarEntorno = () => (entorno ??= new RGBELoader().loadAsync('/escena/cafe-1k.hdr'))
let madera: { color: THREE.Texture; rugosidad: THREE.Texture; normal: THREE.Texture } | null = null
function texturasMadera() {
  if (madera) return madera
  const t = new THREE.TextureLoader()
  const prep = (url: string, srgb: boolean) => {
    const x = t.load(url)
    x.wrapS = x.wrapT = THREE.RepeatWrapping
    x.repeat.set(13.3, 13.3) // la textura cubre 1,2 m reales
    x.anisotropy = 8
    if (srgb) x.colorSpace = THREE.SRGBColorSpace
    return x
  }
  madera = { color: prep('/escena/madera-color.jpg', true), rugosidad: prep('/escena/madera-rugosidad.jpg', false), normal: prep('/escena/madera-normal.jpg', false) }
  return madera
}

interface Props {
  modelo: string
  nombre: string
  className?: string
}

export function VisorRealista({ modelo, nombre, className = '' }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const [listo, setListo] = useState(false)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    const el = caja.current
    if (!el) return
    let vivo = true
    let raf = 0
    const movil = matchMedia('(pointer: coarse)').matches || el.clientWidth < 560

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch {
      setFallo(true)
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, movil ? 1.75 : 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.VSMShadowMap
    el.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'

    const escena = new THREE.Scene()
    const camara = new THREE.PerspectiveCamera(32, 1, 0.01, 30)
    const controles = new OrbitControls(camara, renderer.domElement)
    controles.enableDamping = true
    controles.dampingFactor = 0.08
    controles.enablePan = false
    controles.minPolarAngle = 0.2
    controles.maxPolarAngle = 1.32
    controles.autoRotate = true
    controles.autoRotateSpeed = 0.6
    controles.addEventListener('start', () => (controles.autoRotate = false))

    // Mesa de madera.
    const tm = texturasMadera()
    const mesa = new THREE.Mesh(
      new THREE.CircleGeometry(8, 96),
      new THREE.MeshStandardMaterial({ map: tm.color, roughnessMap: tm.rugosidad, normalMap: tm.normal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1, envMapIntensity: 0.85 }),
    )
    mesa.rotation.x = -Math.PI / 2
    mesa.receiveShadow = true
    escena.add(mesa)

    // Luz de ventana, cálida, que da la sombra suave del plato.
    const sol = new THREE.DirectionalLight(0xfff1dc, 3.2)
    sol.castShadow = true
    sol.shadow.mapSize.set(2048, 2048)
    sol.shadow.radius = 5
    sol.shadow.blurSamples = 20
    sol.shadow.bias = -0.0004
    const sc = sol.shadow.camera
    sc.left = sc.bottom = -0.45
    sc.right = sc.top = 0.45
    sc.near = 0.1
    sc.far = 4
    escena.add(sol, sol.target)

    // Posprocesado: oclusión ambiental en los huecos y desenfoque de cámara.
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(escena, camara))
    let ao: GTAOPass | null = null
    if (!movil) {
      ao = new GTAOPass(escena, camara, 1, 1)
      ao.updateGtaoMaterial({ radius: 0.06, distanceExponent: 1, thickness: 1, scale: 1.2, samples: 16 })
      ao.blendIntensity = 0.85
      composer.addPass(ao)
    }
    const bokeh = new BokehPass(escena, camara, { focus: 0.5, aperture: movil ? 0.012 : 0.018, maxblur: 0.012 })
    composer.addPass(bokeh)
    composer.addPass(new OutputPass())

    const medir = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      ao?.setSize(w, h)
      camara.aspect = w / h
      camara.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    medir()

    Promise.all([cargarEntorno(), cargador.loadAsync(urlModelo(modelo))])
      .then(([hdr, gltf]) => {
        if (!vivo) return
        hdr.mapping = THREE.EquirectangularReflectionMapping
        escena.environment = hdr
        escena.background = hdr
        escena.backgroundBlurriness = 0.35
        escena.backgroundIntensity = 0.75
        escena.environmentIntensity = 1.1

        const obj = gltf.scene
        obj.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            m.castShadow = true
            m.receiveShadow = false
            // El plato de cerámica generado (no escaneado): loza blanca con brillo.
            const mat = m.material as THREE.MeshStandardMaterial
            if (mat?.name === 'Cerámica') {
              mat.color.set(0xf4f1ea)
              mat.metalness = 0
              mat.roughness = 0.5
              mat.envMapIntensity = 1.1
              mat.emissive.set(0x857f74) // la loza devuelve mucha luz: sin esto parece metal
              m.receiveShadow = true
            }
          }
        })
        escena.add(obj)
        // Encuadre según el tamaño real del plato.
        const caja3 = new THREE.Box3().setFromObject(obj)
        const tam = caja3.getSize(new THREE.Vector3())
        const centro = caja3.getCenter(new THREE.Vector3())
        const radio = Math.max(tam.x, tam.z) / 2
        const dist = (radio / Math.tan(THREE.MathUtils.degToRad(camara.fov / 2))) * (camara.aspect < 1 ? 1.25 : 0.95)
        controles.target.set(centro.x, tam.y * 0.35, centro.z)
        // Cámara baja (unos 32°), como la foto de un plato en la mesa: se ve el local desenfocado al fondo.
        camara.position.set(centro.x + dist * 0.42, dist * 0.53, centro.z + dist * 0.74)
        controles.minDistance = dist * 0.45
        controles.maxDistance = dist * 1.8
        camara.near = dist / 50
        camara.updateProjectionMatrix()
        sol.position.set(centro.x - radio * 4, radio * 7, centro.z + radio * 3)
        sol.target.position.copy(centro)
        sc.left = sc.bottom = -radio * 1.6
        sc.right = sc.top = radio * 1.6
        sc.updateProjectionMatrix()
        setListo(true)
      })
      .catch(() => vivo && setFallo(true))

    const bucle = () => {
      raf = requestAnimationFrame(bucle)
      controles.update()
      // El enfoque sigue al plato aunque se acerque o aleje la cámara.
      ;(bokeh.uniforms as Record<string, { value: number }>).focus.value = camara.position.distanceTo(controles.target)
      composer.render()
    }
    bucle()

    return () => {
      vivo = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      controles.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [modelo])

  return (
    <div ref={caja} className={`relative overflow-hidden ${className}`} aria-label={`Plato ${nombre} en 3D`} role="img">
      {(!listo || fallo) && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#fff,#efe6d8)]">
          <img src={urlMiniatura(modelo)} alt={nombre} className={`h-3/4 w-3/4 object-contain ${fallo ? '' : 'animate-pulse'}`} />
        </div>
      )}
    </div>
  )
}

import creditos from '../creditos-3d.json'

/**
 * Modelos 3D de la carta.
 * - Escaneos reales (fotogrametría, CC BY) en /platos: cada uno a su tamaño real en metros.
 *   «diametro» es el ancho del conjunto servido; los que llegan sin plato se sirven sobre uno
 *   generado y tienen además una versión «-solo» para ponerla sobre un plato real con la cámara.
 * - Ilustraciones (Kenney, CC0) en /modelos, para bebidas y platos sin escaneo.
 */
export interface InfoModelo {
  nombre: string
  real: boolean
  diametro: number
  /** Diámetro de la comida sin plato (solo en los que tienen versión «-solo»). */
  comida?: number
  /** Ajuste del tamaño al servirlo sobre un plato real (por defecto 1). */
  ar?: number
}

export const REALES: Record<string, InfoModelo> = {
  'tabla-ibericos': { nombre: 'Tabla de ibéricos', real: true, diametro: 0.4, ar: 0.9 },
  ostras: { nombre: 'Ostras', real: true, diametro: 0.3 },
  tortilla: { nombre: 'Tortilla de patata', real: true, diametro: 0.27 },
  'tosta-salmon': { nombre: 'Tosta de salmón', real: true, diametro: 0.26 },
  ensalada: { nombre: 'Ensalada', real: true, diametro: 0.26 },
  'melon-jamon': { nombre: 'Melón con jamón', real: true, diametro: 0.29 },
  pulpo: { nombre: 'Pulpo a la brasa', real: true, diametro: 0.29 },
  'arroz-negro': { nombre: 'Arroz negro', real: true, diametro: 0.42, ar: 0.8 },
  chuleton: { nombre: 'Chuletón', real: true, diametro: 0.32 },
  lubina: { nombre: 'Lubina', real: true, diametro: 0.34 },
  salmon: { nombre: 'Salmón', real: true, diametro: 0.28 },
  cordero: { nombre: 'Cordero asado', real: true, diametro: 0.36 },
  tartar: { nombre: 'Steak tartar', real: true, diametro: 0.3 },
  'tarta-queso': { nombre: 'Tarta de queso', real: true, diametro: 0.33, comida: 0.24 },
  'tarta-chocolate': { nombre: 'Tarta de chocolate', real: true, diametro: 0.25 },
  'tarta-higos': { nombre: 'Tarta de higos', real: true, diametro: 0.29, comida: 0.2, ar: 0.9 },
  'tarta-frambuesa': { nombre: 'Tarta de frambuesas', real: true, diametro: 0.27 },
  'tartaleta-limon': { nombre: 'Tartaleta de limón', real: true, diametro: 0.19, comida: 0.085 },
  'cafe-vienes': { nombre: 'Café vienés', real: true, diametro: 0.15 },
}

const ILUSTRACIONES: Record<string, string> = {
  'glass-wine': 'Copa de vino', 'wine-red': 'Botella de vino', cocktail: 'Cóctel', 'cup-coffee': 'Café', 'soda-glass': 'Refresco',
  salad: 'Ensalada', 'skewer-vegetables': 'Brocheta', 'bowl-soup': 'Sopa', fries: 'Patatas', 'burger-cheese': 'Hamburguesa', pizza: 'Pizza',
  'meat-ribs': 'Costillas', fish: 'Pescado', 'meat-cooked': 'Carne', 'maki-salmon': 'Maki', 'sushi-salmon': 'Sushi', cake: 'Tarta', pancakes: 'Tortitas',
  'ice-cream-cup': 'Helado', waffle: 'Gofre', croissant: 'Cruasán', taco: 'Taco', sandwich: 'Bocadillo', pie: 'Pastel', 'dim-sum': 'Dim sum',
  cupcake: 'Magdalena', chinese: 'Wok', pudding: 'Flan', sundae: 'Copa de helado', 'mussel-open': 'Mejillón', 'egg-cooked': 'Huevo',
}

export function infoModelo(id: string): InfoModelo | null {
  if (REALES[id]) return REALES[id]
  if (ILUSTRACIONES[id]) return { nombre: ILUSTRACIONES[id], real: false, diametro: 0.2 }
  return null
}
export const nombreModelo = (id: string) => infoModelo(id)?.nombre ?? id
export const esReal = (id: string) => !!REALES[id]
export const urlModelo = (id: string) => (REALES[id] ? `/platos/${id}.glb` : `/modelos/${id}.glb`)
/** Versión para poner sobre un plato real: la comida sola si existe, si no el plato servido. */
export const urlParaPlato = (id: string) => (REALES[id]?.comida ? `/platos/${id}-solo.glb` : urlModelo(id))
export const urlMiniatura = (id: string) => (REALES[id] ? `/platos/${id}.webp` : `/miniaturas/${id}.png`)
export const credito = (id: string) => (creditos as Record<string, { titulo: string; autor: string; url: string; licencia: string }>)[id]
export const MODELOS_REALES = Object.keys(REALES)
export const MODELOS_ILUSTRADOS = Object.keys(ILUSTRACIONES)

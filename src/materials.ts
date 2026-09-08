import * as T from 'three'
import type { QualityConfig } from './types'

export type SurfaceKind = 'wood' | 'stone' | 'flour' | 'grain' | 'dough' | 'crust' | 'crumb'

export type SurfaceTextures = {
  albedo: T.CanvasTexture
  height: T.CanvasTexture
  roughness: T.CanvasTexture
}

const cache = new Map<string, SurfaceTextures>()

function randomSource(initial: number) {
  let seed = initial
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

function makeCanvas(size: number, fill: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  context.fillStyle = fill
  context.fillRect(0, 0, size, size)
  return { canvas, context }
}

function softPatch(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  center: string,
  edge = 'rgba(0,0,0,0)',
) {
  context.save()
  context.translate(x, y)
  context.scale(radiusX, radiusY)
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1)
  gradient.addColorStop(0, center)
  gradient.addColorStop(1, edge)
  context.fillStyle = gradient
  context.fillRect(-1, -1, 2, 2)
  context.restore()
}

function canvasTexture(canvas: HTMLCanvasElement, color: boolean, repeat: number, anisotropy: number) {
  const texture = new T.CanvasTexture(canvas)
  texture.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace
  texture.wrapS = texture.wrapT = T.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.anisotropy = anisotropy
  texture.minFilter = T.LinearMipmapLinearFilter
  texture.magFilter = T.LinearFilter
  return texture
}

function drawWood(size: number, albedo: CanvasRenderingContext2D, height: CanvasRenderingContext2D, roughness: CanvasRenderingContext2D) {
  const random = randomSource(1103)
  for (let band = 0; band < 28; band += 1) {
    const y = random() * size
    const wave = (random() - 0.5) * size * 0.045
    const width = 0.6 + random() * 2.2
    albedo.strokeStyle = random() > 0.42 ? `rgba(70,34,15,${0.035 + random() * 0.09})` : `rgba(255,240,210,${0.025 + random() * 0.06})`
    albedo.lineWidth = width
    albedo.beginPath()
    albedo.moveTo(-size * 0.05, y)
    albedo.bezierCurveTo(size * 0.28, y - wave, size * 0.7, y + wave, size * 1.05, y - wave * 0.25)
    albedo.stroke()
    height.strokeStyle = random() > 0.5 ? '#747474' : '#8a8a8a'
    height.lineWidth = Math.max(0.65, width * 0.62)
    height.beginPath()
    height.moveTo(-size * 0.05, y)
    height.bezierCurveTo(size * 0.28, y - wave, size * 0.7, y + wave, size * 1.05, y - wave * 0.25)
    height.stroke()
  }
  for (let knot = 0; knot < 2; knot += 1) {
    const x = size * (0.22 + random() * 0.56)
    const y = size * (0.18 + random() * 0.64)
    const radiusX = size * (0.035 + random() * 0.025)
    const radiusY = radiusX * (0.22 + random() * 0.14)
    albedo.strokeStyle = 'rgba(66,29,12,0.14)'
    albedo.lineWidth = 1.5
    albedo.beginPath()
    albedo.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2)
    albedo.stroke()
    height.strokeStyle = '#707070'
    height.lineWidth = 1
    height.beginPath()
    height.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2)
    height.stroke()
    softPatch(roughness, x, y, radiusX * 2, radiusY * 3.2, 'rgba(190,190,190,0.5)')
  }
  const roughGradient = roughness.createLinearGradient(0, 0, 0, size)
  roughGradient.addColorStop(0, 'rgba(255,255,255,0.05)')
  roughGradient.addColorStop(0.5, 'rgba(174,174,174,0.06)')
  roughGradient.addColorStop(1, 'rgba(255,255,255,0.04)')
  roughness.fillStyle = roughGradient
  roughness.fillRect(0, 0, size, size)
}

function drawStone(size: number, albedo: CanvasRenderingContext2D, height: CanvasRenderingContext2D, roughness: CanvasRenderingContext2D) {
  const random = randomSource(2207)
  for (let patch = 0; patch < 58; patch += 1) {
    const x = random() * size
    const y = random() * size
    const rx = size * (0.035 + random() * 0.12)
    const ry = rx * (0.55 + random() * 0.9)
    const light = random() > 0.48
    softPatch(albedo, x, y, rx, ry, light ? `rgba(255,250,233,${0.025 + random() * 0.06})` : `rgba(45,42,36,${0.025 + random() * 0.055})`)
    softPatch(height, x, y, rx, ry, light ? 'rgba(148,148,148,0.18)' : 'rgba(102,102,102,0.2)')
    softPatch(roughness, x, y, rx * 1.15, ry * 1.15, light ? 'rgba(255,255,255,0.1)' : 'rgba(170,170,170,0.12)')
  }
  for (let pit = 0; pit < 180; pit += 1) {
    const x = random() * size
    const y = random() * size
    const radius = 0.45 + random() * 1.7
    albedo.fillStyle = `rgba(34,31,27,${0.025 + random() * 0.07})`
    albedo.beginPath()
    albedo.arc(x, y, radius, 0, Math.PI * 2)
    albedo.fill()
    height.fillStyle = `rgba(${72 + Math.round(random() * 28)},${72 + Math.round(random() * 28)},${72 + Math.round(random() * 28)},0.5)`
    height.fillRect(x, y, Math.max(1, radius), Math.max(1, radius))
  }
}

function drawFlour(size: number, albedo: CanvasRenderingContext2D, height: CanvasRenderingContext2D, roughness: CanvasRenderingContext2D) {
  const random = randomSource(3313)
  const veil = albedo.createLinearGradient(0, 0, size, size)
  veil.addColorStop(0, 'rgba(255,255,255,0.025)')
  veil.addColorStop(1, 'rgba(116,92,58,0.018)')
  albedo.fillStyle = veil
  albedo.fillRect(0, 0, size, size)
  for (let grain = 0; grain < 560; grain += 1) {
    const x = random() * size
    const y = random() * size
    const alpha = 0.012 + random() * 0.025
    albedo.fillStyle = random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(96,76,48,${alpha * 0.45})`
    albedo.fillRect(x, y, 0.55 + random(), 0.55 + random())
    const value = 120 + Math.round(random() * 16)
    height.fillStyle = `rgb(${value},${value},${value})`
    height.fillRect(x, y, 0.5 + random(), 0.5 + random())
  }
  roughness.fillStyle = 'rgba(255,255,255,0.18)'
  roughness.fillRect(0, 0, size, size)
}

function drawDough(size: number, albedo: CanvasRenderingContext2D, height: CanvasRenderingContext2D, roughness: CanvasRenderingContext2D) {
  const random = randomSource(4421)
  for (let patch = 0; patch < 22; patch += 1) {
    const x = random() * size
    const y = random() * size
    const radius = size * (0.06 + random() * 0.16)
    softPatch(albedo, x, y, radius, radius * (0.6 + random() * 0.7), random() > 0.5 ? 'rgba(255,248,222,0.045)' : 'rgba(123,74,36,0.025)')
    softPatch(height, x, y, radius, radius, random() > 0.5 ? 'rgba(141,141,141,0.07)' : 'rgba(112,112,112,0.07)')
    softPatch(roughness, x, y, radius * 1.1, radius * 1.1, random() > 0.52 ? 'rgba(245,245,245,0.1)' : 'rgba(150,150,150,0.13)')
  }
}

function drawGrain(size: number, albedo: CanvasRenderingContext2D, height: CanvasRenderingContext2D, roughness: CanvasRenderingContext2D) {
  const random = randomSource(4903)
  const glow = albedo.createLinearGradient(0, 0, size, size)
  glow.addColorStop(0, 'rgba(255,231,145,0.09)')
  glow.addColorStop(0.52, 'rgba(255,255,255,0)')
  glow.addColorStop(1, 'rgba(91,44,8,0.08)')
  albedo.fillStyle = glow
  albedo.fillRect(0, 0, size, size)
  for (let ridge = 0; ridge < 24; ridge += 1) {
    const x = random() * size
    const bend = (random() - 0.5) * size * 0.05
    albedo.strokeStyle = random() > 0.5 ? `rgba(255,237,163,${0.025 + random() * 0.045})` : `rgba(104,50,9,${0.02 + random() * 0.04})`
    albedo.lineWidth = 0.5 + random() * 1.1
    albedo.beginPath()
    albedo.moveTo(x, -size * 0.04)
    albedo.bezierCurveTo(x - bend, size * 0.3, x + bend, size * 0.7, x - bend * 0.2, size * 1.04)
    albedo.stroke()
    height.strokeStyle = random() > 0.5 ? '#898989' : '#777777'
    height.lineWidth = 0.55
    height.beginPath()
    height.moveTo(x, -size * 0.04)
    height.bezierCurveTo(x - bend, size * 0.3, x + bend, size * 0.7, x - bend * 0.2, size * 1.04)
    height.stroke()
  }
  roughness.fillStyle = 'rgba(255,255,255,0.07)'
  roughness.fillRect(0, 0, size, size)
}

function drawCrust(size: number, albedo: CanvasRenderingContext2D, height: CanvasRenderingContext2D, roughness: CanvasRenderingContext2D) {
  const random = randomSource(5531)
  for (let patch = 0; patch < 46; patch += 1) {
    const x = random() * size
    const y = random() * size
    const radius = size * (0.025 + random() * 0.11)
    const toasted = random() > 0.45
    softPatch(albedo, x, y, radius, radius * (0.55 + random()), toasted ? `rgba(84,28,8,${0.05 + random() * 0.12})` : `rgba(255,210,112,${0.04 + random() * 0.11})`)
    softPatch(roughness, x, y, radius * 1.1, radius, toasted ? 'rgba(255,255,255,0.16)' : 'rgba(155,155,155,0.1)')
  }
  for (let blister = 0; blister < 140; blister += 1) {
    const x = random() * size
    const y = random() * size
    const rx = 0.7 + random() * 2.9
    const ry = rx * (0.45 + random() * 0.75)
    albedo.fillStyle = random() > 0.55 ? `rgba(255,221,142,${0.025 + random() * 0.07})` : `rgba(78,28,8,${0.025 + random() * 0.065})`
    albedo.beginPath()
    albedo.ellipse(x, y, rx, ry, random() * Math.PI, 0, Math.PI * 2)
    albedo.fill()
    height.fillStyle = random() > 0.45 ? '#969696' : '#707070'
    height.beginPath()
    height.ellipse(x, y, rx * 0.72, ry * 0.72, random() * Math.PI, 0, Math.PI * 2)
    height.fill()
  }
}

function drawCrumb(size: number, albedo: CanvasRenderingContext2D, height: CanvasRenderingContext2D, roughness: CanvasRenderingContext2D) {
  const random = randomSource(6653)
  for (let patch = 0; patch < 28; patch += 1) {
    const x = random() * size
    const y = random() * size
    const radius = size * (0.04 + random() * 0.12)
    softPatch(albedo, x, y, radius, radius * (0.7 + random() * 0.7), random() > 0.5 ? 'rgba(255,246,207,0.07)' : 'rgba(141,77,31,0.035)')
  }
  for (let cavity = 0; cavity < 92; cavity += 1) {
    const x = random() * size
    const y = random() * size
    const rx = 0.8 + Math.pow(random(), 1.7) * 4.2
    const ry = rx * (0.45 + random() * 0.75)
    albedo.fillStyle = `rgba(104,55,25,${0.025 + random() * 0.09})`
    albedo.beginPath()
    albedo.ellipse(x, y, rx, ry, random() * Math.PI, 0, Math.PI * 2)
    albedo.fill()
    height.fillStyle = `rgba(68,68,68,${0.28 + random() * 0.34})`
    height.beginPath()
    height.ellipse(x, y, rx * 0.78, ry * 0.78, random() * Math.PI, 0, Math.PI * 2)
    height.fill()
  }
  roughness.fillStyle = 'rgba(255,255,255,0.12)'
  roughness.fillRect(0, 0, size, size)
}

function createSurface(kind: SurfaceKind, quality: QualityConfig) {
  const size = quality.mobile ? 256 : 512
  const key = `${kind}:${size}:${quality.anisotropy}`
  const cached = cache.get(key)
  if (cached) return cached

  const bases = {
    wood: ['#dfcbb0', '#808080', '#dedede'],
    stone: ['#dfddd4', '#808080', '#e8e8e8'],
    flour: ['#fffaf0', '#808080', '#f2f2f2'],
    grain: ['#f0ce82', '#808080', '#e4e4e4'],
    dough: ['#fff0d2', '#808080', '#d7d7d7'],
    crust: ['#e7bd7d', '#808080', '#dedede'],
    crumb: ['#f8dda8', '#808080', '#eeeeee'],
  }[kind]
  const albedo = makeCanvas(size, bases[0])
  const height = makeCanvas(size, bases[1])
  const roughness = makeCanvas(size, bases[2])
  const draw = { wood: drawWood, stone: drawStone, flour: drawFlour, grain: drawGrain, dough: drawDough, crust: drawCrust, crumb: drawCrumb }[kind]
  draw(size, albedo.context, height.context, roughness.context)

  const repeat = { wood: 1, stone: 1.2, flour: 1.55, grain: 1.08, dough: 1.1, crust: 1.25, crumb: 1.08 }[kind]
  const textures = {
    albedo: canvasTexture(albedo.canvas, true, repeat, quality.anisotropy),
    height: canvasTexture(height.canvas, false, repeat, quality.anisotropy),
    roughness: canvasTexture(roughness.canvas, false, repeat, quality.anisotropy),
  }
  cache.set(key, textures)
  return textures
}

export function surfaceTextures(kind: SurfaceKind, quality: QualityConfig) {
  return createSurface(kind, quality)
}

export function material(
  color: T.ColorRepresentation,
  quality: QualityConfig,
  kind?: SurfaceKind,
  options: T.MeshStandardMaterialParameters = {},
) {
  const roughness = kind ? { wood: 0.84, stone: 0.96, flour: 1, grain: 0.8, dough: 0.76, crust: 0.82, crumb: 0.98 }[kind] : 0.84
  const bumpScale = kind ? { wood: 0.012, stone: 0.027, flour: 0.003, grain: 0.009, dough: 0.006, crust: 0.025, crumb: 0.009 }[kind] : 0
  const textures = kind ? createSurface(kind, quality) : undefined
  return new T.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    transparent: true,
    ...(textures ? {
      map: textures.albedo,
      bumpMap: textures.height,
      roughnessMap: textures.roughness,
      bumpScale,
    } : {}),
    ...options,
  })
}

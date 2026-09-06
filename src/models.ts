import * as T from 'three'
import { arcPosition, bell, clamp01, delayed, overlap, weightedOut, windowProgress } from './motion'
import type { PointerState, QualityConfig } from './types'
import { PALETTE, pointsMaterial } from './geometry'

export type SequenceContext = {
  progress: number
  time: number
  delta: number
  pointer: PointerState
  quality: QualityConfig
}

export type JourneySequence = {
  group: T.Group
  update(context: SequenceContext): void
}

const temp = new T.Vector3()
const temp2 = new T.Vector3()

function createRandom(initial: number) {
  let seed = initial
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

let random = createRandom(4937)
const textureCache = new Map<string, T.CanvasTexture>()

function surface(kind: 'wood' | 'stone' | 'flour' | 'crust' | 'crumb', anisotropy: number) {
  const cached = textureCache.get(kind)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const context = canvas.getContext('2d')!
  const noise = createRandom(kind.length * 431)
  const base = { wood: '#e1d1b8', stone: '#d8d5ca', flour: '#fffaf0', crust: '#e7c690', crumb: '#f8e2b4' }[kind]
  context.fillStyle = base
  context.fillRect(0, 0, 512, 512)

  // Broad, low-frequency value changes keep the procedural surfaces from reading
  // as noise stamped on primitives. Fine marks are reserved for tactile breakup.
  const broad = context.createLinearGradient(0, 0, kind === 'wood' ? 512 : 340, 512)
  broad.addColorStop(0, kind === 'flour' ? 'rgba(255,250,236,0.045)' : kind === 'crumb' ? 'rgba(255,246,216,0.11)' : 'rgba(255,248,224,0.12)')
  broad.addColorStop(0.45, kind === 'flour' ? 'rgba(91,72,45,0.012)' : kind === 'crumb' ? 'rgba(155,92,43,0.025)' : 'rgba(70,39,18,0.025)')
  broad.addColorStop(1, kind === 'flour' ? 'rgba(54,42,25,0.028)' : kind === 'crumb' ? 'rgba(99,50,22,0.07)' : 'rgba(21,15,10,0.09)')
  context.fillStyle = broad
  context.fillRect(0, 0, 512, 512)

  for (let i = 0; i < (kind === 'flour' ? 4300 : kind === 'crumb' ? 2400 : 5900); i += 1) {
    const x = noise() * 512
    const y = noise() * 512
    const alpha = kind === 'flour' ? noise() * 0.04 : kind === 'crumb' ? 0.012 + noise() * 0.052 : 0.02 + noise() * 0.075
    context.fillStyle = noise() > 0.5 ? `rgba(255,247,226,${alpha})` : kind === 'crumb' ? `rgba(121,69,31,${alpha * 0.72})` : `rgba(38,22,10,${alpha * 0.8})`
    const markWidth = kind === 'wood' ? 14 + noise() * 64 : kind === 'crust' ? 1 + noise() * 4 : 1 + noise() * 2
    context.fillRect(x, y, markWidth, kind === 'wood' ? 0.65 : 0.8 + noise() * 1.6)
  }

  if (kind === 'wood') {
    for (let i = 0; i < 34; i += 1) {
      const y = noise() * 512
      context.strokeStyle = `rgba(66,34,17,${0.045 + noise() * 0.085})`
      context.lineWidth = 0.7 + noise() * 1.6
      context.beginPath()
      context.moveTo(-20, y)
      context.bezierCurveTo(150, y - 11, 350, y + 13, 532, y + noise() * 10)
      context.stroke()
    }
    for (let knot = 0; knot < 2; knot += 1) {
      const x = 100 + noise() * 320
      const y = 80 + noise() * 350
      context.strokeStyle = 'rgba(73,38,18,0.11)'
      context.lineWidth = 2
      context.beginPath()
      context.ellipse(x, y, 25 + noise() * 18, 7 + noise() * 5, 0, 0, Math.PI * 2)
      context.stroke()
    }
  } else if (kind === 'stone') {
    for (let i = 0; i < 22; i += 1) {
      const y = noise() * 512
      context.strokeStyle = `rgba(61,56,48,${0.025 + noise() * 0.055})`
      context.lineWidth = 2 + noise() * 5
      context.beginPath()
      context.moveTo(-30, y)
      context.bezierCurveTo(120, y + 35, 330, y - 28, 542, y + 12)
      context.stroke()
    }
  } else if (kind === 'crumb') {
    for (let i = 0; i < 150; i += 1) {
      const x = noise() * 512
      const y = noise() * 512
      const radius = 0.8 + Math.pow(noise(), 2.2) * 4.2
      context.fillStyle = `rgba(113,61,28,${0.045 + noise() * 0.11})`
      context.beginPath()
      context.ellipse(x, y, radius, radius * (0.55 + noise() * 0.5), noise() * Math.PI, 0, Math.PI * 2)
      context.fill()
    }
  }

  const texture = new T.CanvasTexture(canvas)
  texture.colorSpace = T.SRGBColorSpace
  texture.wrapS = texture.wrapT = T.RepeatWrapping
  texture.repeat.set(kind === 'wood' ? 1 : 1.25, kind === 'wood' ? 1 : 1.25)
  texture.anisotropy = anisotropy
  textureCache.set(kind, texture)
  return texture
}

function mat(color: T.ColorRepresentation, quality: QualityConfig, kind?: 'wood' | 'stone' | 'flour' | 'crust' | 'crumb', options: T.MeshStandardMaterialParameters = {}) {
  return new T.MeshStandardMaterial({
    color,
    roughness: 0.84,
    metalness: 0.01,
    transparent: true,
    ...(kind ? {
      map: surface(kind, quality.anisotropy),
      bumpMap: surface(kind, quality.anisotropy),
      bumpScale: kind === 'stone' ? 0.034 : kind === 'crust' ? 0.022 : kind === 'wood' ? 0.014 : kind === 'crumb' ? 0.012 : 0.006,
    } : {}),
    ...options,
  })
}

function mesh<G extends T.BufferGeometry, M extends T.Material>(geometry: G, materialInstance: M, parent?: T.Object3D, x = 0, y = 0, z = 0) {
  const object = new T.Mesh(geometry, materialInstance)
  object.position.set(x, y, z)
  object.castShadow = true
  object.receiveShadow = true
  parent?.add(object)
  return object
}

function rod(a: T.Vector3, b: T.Vector3, radius: number, materialInstance: T.Material, parent: T.Object3D) {
  const object = mesh(new T.CylinderGeometry(radius, radius, a.distanceTo(b), 8), materialInstance, parent)
  object.position.copy(a).add(b).multiplyScalar(0.5)
  object.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return object
}

function tube(points: T.Vector3[], radius: number, materialInstance: T.Material, parent: T.Object3D) {
  return mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 28, radius, 8, false), materialInstance, parent)
}

function ring(radius: number, thickness: number, materialInstance: T.Material, parent: T.Object3D, y: number) {
  const object = mesh(new T.TorusGeometry(radius, thickness, 8, 64), materialInstance, parent, 0, y, 0)
  object.rotation.x = Math.PI / 2
  return object
}

function roundBox(width: number, depth: number, height: number, radius = 0.14) {
  const shape = new T.Shape()
  const x = -width / 2
  const y = -depth / 2
  const r = radius
  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + depth - r)
  shape.quadraticCurveTo(x + width, y + depth, x + width - r, y + depth)
  shape.lineTo(x + r, y + depth)
  shape.quadraticCurveTo(x, y + depth, x, y + depth - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  const geometry = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 10 })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

function board(parent: T.Object3D, quality: QualityConfig, width = 3.9, depth = 2.7, color: T.ColorRepresentation = 0xc08a55) {
  const object = mesh(roundBox(width, depth, 0.13), mat(color, quality, undefined, { roughness: 0.84 }), parent, 0, -0.16, 0)
  object.name = 'wood-work-surface'
  const grainRandom = createRandom(Math.round(width * depth * 977))
  const grainColor = new T.Color(color).multiplyScalar(0.48)
  const grainMaterial = mat(grainColor, quality, undefined, { roughness: 0.96, transparent: true, opacity: 0.24, depthWrite: false })
  for (let i = 0; i < 13; i += 1) {
    const z = (grainRandom() - 0.5) * depth * 0.76
    const wave = (grainRandom() - 0.5) * 0.045
    const line = tube([
      new T.Vector3(-width * 0.44, -0.019, z),
      new T.Vector3(-width * 0.08, -0.018, z + wave),
      new T.Vector3(width * 0.2, -0.019, z - wave * 0.45),
      new T.Vector3(width * 0.44, -0.019, z + wave * 0.3),
    ], 0.0022 + grainRandom() * 0.0014, grainMaterial, parent)
    line.castShadow = line.receiveShadow = false
  }
  return object
}

function irregularCylinderGeometry(top: number, bottom: number, height: number, segments: number, seed: number) {
  const geometry = new T.CylinderGeometry(top, bottom, height, segments, 3)
  const position = geometry.attributes.position
  const localRandom = createRandom(seed)
  const offsets = Array.from({ length: segments }, () => (localRandom() - 0.5) * 0.045)
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    const angle = Math.atan2(z, x)
    const slot = ((Math.round(((angle + Math.PI) / (Math.PI * 2)) * segments) % segments) + segments) % segments
    const variation = 1 + offsets[slot] + Math.sin(angle * 5 + seed) * 0.008
    position.setX(i, x * variation)
    position.setZ(i, z * variation)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

function dust(parent: T.Object3D, quality: QualityConfig, count: number, radius = 1.3, y = 0.006) {
  const geometry = new T.CircleGeometry(0.013, 6)
  geometry.rotateX(-Math.PI / 2)
  const particles = new T.InstancedMesh(geometry, mat(0xf0e7d3, quality, 'flour', { roughness: 1 }), count)
  const dummy = new T.Object3D()
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2
    const distance = Math.sqrt(random()) * radius
    dummy.position.set(Math.cos(angle) * distance, y, Math.sin(angle) * distance * 0.66)
    dummy.scale.setScalar(0.25 + random() * 1.05)
    dummy.updateMatrix()
    particles.setMatrixAt(i, dummy.matrix)
  }
  particles.castShadow = false
  parent.add(particles)
  return particles
}

class Visibility {
  private readonly materials: { material: T.Material; opacity: number; depthWrite: boolean }[]
  private last = -1

  constructor(readonly object: T.Object3D) {
    this.materials = []
    object.traverse((child) => {
      const candidate = child as T.Mesh
      const values = Array.isArray(candidate.material) ? candidate.material : candidate.material ? [candidate.material] : []
      values.forEach((material) => {
        if (!this.materials.some((entry) => entry.material === material)) {
          this.materials.push({ material, opacity: material.opacity, depthWrite: material.depthWrite })
        }
      })
    })
  }

  set(value: number) {
    const opacity = T.MathUtils.clamp(value, 0, 1)
    if (opacity === this.last) return
    this.last = opacity
    this.object.visible = opacity > 0.002
    this.materials.forEach((entry) => {
      entry.material.transparent = true
      entry.material.opacity = opacity * entry.opacity
      entry.material.depthWrite = entry.depthWrite && opacity > 0.96
    })
  }
}

// One surface survives mixing, kneading, proofing, oven spring and the final shot.
// All vertex positions are sampled from source coordinates, never last frame's mesh.
class DoughMorph {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
  private readonly original: Float32Array
  private readonly position: T.BufferAttribute
  private readonly colors: T.BufferAttribute
  private lastProgress = -1
  private readonly color = new T.Color()
  private readonly pale = new T.Color(PALETTE.flour)
  private readonly wet = new T.Color(0xd8ae72)
  private readonly crust = new T.Color(0xb96222)
  private readonly toasted = new T.Color(0x5d240f)
  private readonly cut = new T.Color(0xf0c887)
  private readonly raised = new T.Color(0xf2b85d)

  constructor(parent: T.Object3D, quality: QualityConfig) {
    const geometry = new T.SphereGeometry(1, quality.mobile ? 96 : 144, quality.mobile ? 48 : 72)
    this.position = geometry.attributes.position as T.BufferAttribute
    this.original = new Float32Array(this.position.array)
    this.colors = new T.BufferAttribute(new Float32Array(this.position.count * 3), 3)
    geometry.setAttribute('color', this.colors)
    this.mesh = mesh(geometry, mat(0xffffff, quality, 'flour', { vertexColors: true, roughness: 0.96 }), parent)
    this.mesh.name = 'hero-dough-loaf'
    this.mesh.frustumCulled = false
  }

  apply(p: number) {
    if (p === this.lastProgress) return
    this.lastProgress = p
    const mixing = windowProgress(p, 0.505, 0.57)
    const shaping = windowProgress(p, 0.6, 0.68)
    const proof = windowProgress(p, 0.706, 0.77)
    const spring = windowProgress(p, 0.818, 0.868)
    const baking = windowProgress(p, 0.824, 0.91)
    const scoring = windowProgress(p, 0.772, 0.785)
    const knead = windowProgress(p, 0.6, 0.675, (t) => t)
    const pressure = Math.sin(knead * Math.PI * 3) ** 2 * bell(knead)
    // Stop just shy of a mathematically flat collapse; the crumb face covers the
    // remaining cap while avoiding degenerate triangles in the persistent loaf.
    const sliceCut = windowProgress(p, 0.989, 0.997) * 0.9
    const width = 0.8 + mixing * 0.12 + shaping * 0.18 + proof * 0.18 + spring * 0.12
    const height = 0.08 + mixing * 0.57 + proof * 0.2 + spring * 0.11
    const depth = 0.69 + mixing * 0.05 + proof * 0.07
    const stirAngle = windowProgress(p, 0.49, 0.56, (t) => t) * Math.PI * 5
    for (let i = 0; i < this.position.count; i += 1) {
      const x = this.original[i * 3]
      const y = this.original[i * 3 + 1]
      const z = this.original[i * 3 + 2]
      const crown = Math.max(0, y)
      const crownAmount = clamp01((y + 0.12) / 1.12)
      const foot = Math.max(0, (y + 0.64) / 1.64)
      const localPress = Math.exp(-Math.pow((x - Math.sin(knead * Math.PI * 3) * 0.4) / 0.42, 2)) * pressure
      const wetFold = Math.sin(x * 7.5 + z * 5.5 - stirAngle) * crown * mixing * (1 - mixing) * 0.17
      const kneadFold = Math.sin(x * 6.5 + knead * 8) * localPress * crown * 0.075
      const foldAxis = x + z * 0.32 - T.MathUtils.lerp(-0.3, 0.26, knead)
      const foldRidge = (
        Math.exp(-Math.pow((foldAxis + 0.16) / 0.22, 2)) * 0.09
        - Math.exp(-Math.pow(foldAxis / 0.105, 2)) * 0.055
      ) * crown * bell(knead)
      const wetEdge = Math.sin(x * 4.3 + z * 7.1) * mixing * (1 - mixing) * 0.055
      const endTaper = 1 - (proof * 0.035 + spring * 0.12) * Math.pow(Math.abs(x), 1.55)
      const asymmetry = 1 + proof * (0.052 * Math.sin(x * 2.2 + z * 2.7) + x * 0.028 - z * 0.018)
      const proofCrown = proof * crown * (0.024 * Math.sin(x * 3.1 - z * 2.4) + 0.018 * x)
      let py = foot * height * asymmetry * endTaper - localPress * crown * 0.2 + wetFold + kneadFold + foldRidge + proofCrown
      let px = x * width * (1 + pressure * 0.17) + wetEdge * (0.4 + crown) + shaping * Math.sin(z * 3.2 + y) * 0.018
      const pz = z * depth * endTaper * (1 - pressure * 0.09) + wetEdge * 0.42
      if (px > 0.72) px = T.MathUtils.lerp(px, 0.72, sliceCut)
      const cutLine = px + pz * 0.42
      let groove = 0
      let scoreCore = 0
      let scoreEdge = 0
      for (const center of [-0.59, 0, 0.59]) {
        const scoreWidth = 0.014 + spring * 0.035
        const distance = Math.abs(cutLine - center)
        groove = Math.max(groove, Math.exp(-Math.pow(distance / scoreWidth, 2)))
        scoreCore = Math.max(scoreCore, Math.exp(-Math.pow(distance / (scoreWidth * 0.38), 2)))
        scoreEdge = Math.max(scoreEdge, Math.exp(-Math.pow((distance - scoreWidth * 1.05) / (scoreWidth * 0.48), 2)))
      }
      const cutMask = windowProgress(y, 0.28, 0.66) * (1 - windowProgress(Math.abs(z), 0.57, 0.88))
      groove *= cutMask * scoring
      scoreCore *= cutMask * scoring
      scoreEdge *= cutMask * scoring
      py -= groove * (0.022 + spring * 0.055)
      const irregular = Math.sin(px * 21 + pz * 13) * Math.sin(pz * 31 - px * 9)
      py += crown * baking * irregular * 0.009
      this.position.setXYZ(i, px, Math.max(0, py), pz)

      this.color.copy(this.pale).lerp(this.wet, mixing * (0.72 - shaping * 0.25))
      const bakeVariation = clamp01(0.57 + crownAmount * 0.3 + x * 0.065 - z * 0.11 + irregular * 0.12)
      this.color.lerp(this.crust, baking * bakeVariation)
      const toastMottle = Math.max(0, Math.sin(px * 8.5 - pz * 5.2) * Math.cos(pz * 10.5 + px * 2.7))
      this.color.lerp(this.toasted, baking * ((1 - crownAmount) * 0.68 + Math.max(0, z) * 0.11 + scoreCore * 0.34 + toastMottle * crownAmount * 0.08))
      this.color.lerp(this.cut, groove * baking * 0.8)
      this.color.lerp(this.raised, scoreEdge * baking * 0.72)
      const flour = Math.max(0, Math.sin(px * 12 + pz * 7) * Math.sin(pz * 18 - px * 3.5) - 0.34)
      this.color.lerp(this.pale, flour * crownAmount * baking * (1 - groove) * 0.32)
      this.colors.setXYZ(i, this.color.r, this.color.g, this.color.b)
    }
    this.mesh.material.roughness = 0.95 - mixing * 0.22 + shaping * 0.14 + proof * 0.04 + baking * 0.06
    this.mesh.material.bumpScale = 0.006 + baking * 0.025
    this.position.needsUpdate = this.colors.needsUpdate = true
    this.mesh.geometry.computeVertexNormals()
  }
}

type FlourParticle = { x: number; y: number; z: number; delay: number; phase: number; weight: number; near: number }

class FlourSystem {
  readonly group = new T.Group()
  readonly pile: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
  private readonly pileShadow: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>
  private readonly points: T.Points<T.BufferGeometry, T.ShaderMaterial>
  private readonly particles: FlourParticle[] = []
  private readonly positions: T.BufferAttribute
  private readonly alphas: T.BufferAttribute
  private readonly haze: { sprite: T.Sprite; material: T.SpriteMaterial; phase: number; near: number; scale: number }[] = []
  private readonly source = new T.Vector3()
  private readonly destination = new T.Vector3()

  constructor(quality: QualityConfig) {
    this.group.name = 'milling-output'
    const count = quality.flourCount
    const geometry = new T.BufferGeometry()
    this.positions = new T.BufferAttribute(new Float32Array(count * 3), 3)
    this.alphas = new T.BufferAttribute(new Float32Array(count), 1)
    const sizes = new Float32Array(count)
    const clusters = Array.from({ length: 14 }, () => {
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random())
      return { x: Math.cos(angle) * radius * 0.68, z: Math.sin(angle) * radius * 0.46 }
    })
    for (let i = 0; i < count; i += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)]
      const spread = Math.pow(random(), 2.2)
      const angle = random() * Math.PI * 2
      const weight = Math.pow(random(), 1.8)
      this.particles.push({
        x: cluster.x + Math.cos(angle) * spread * 0.26,
        y: (0.15 + random() * 0.85) * (1 - Math.min(0.9, Math.hypot(cluster.x, cluster.z))) * 0.48,
        z: cluster.z + Math.sin(angle) * spread * 0.2,
        delay: random(),
        phase: random() * Math.PI * 2,
        weight,
        near: random(),
      })
      sizes[i] = 0.28 + weight * 1.85
    }
    geometry.setAttribute('position', this.positions)
    geometry.setAttribute('alpha', this.alphas)
    geometry.setAttribute('size', new T.BufferAttribute(sizes, 1))
    const pointMaterial = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { tint: { value: new T.Color(0xf1e6d0) }, pixelRatio: { value: quality.dpr } },
      vertexShader: `attribute float alpha; attribute float size; varying float vAlpha;
        uniform float pixelRatio;
        void main(){ vAlpha=alpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_Position=projectionMatrix*mv; gl_PointSize=clamp(size*19.0*pixelRatio/-mv.z,0.7,10.0); }`,
      fragmentShader: `uniform vec3 tint; varying float vAlpha;
        void main(){ float r=length(gl_PointCoord-0.5)*2.0;
          if(r>1.0) discard;
          gl_FragColor=vec4(tint,vAlpha*(1.0-smoothstep(0.25,1.0,r)));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    this.points = new T.Points(geometry, pointMaterial)
    this.points.frustumCulled = false
    this.group.add(this.points)
    const hazeCanvas = document.createElement('canvas')
    hazeCanvas.width = hazeCanvas.height = 96
    const hazeContext = hazeCanvas.getContext('2d')!
    const hazeGradient = hazeContext.createRadialGradient(48, 48, 4, 48, 48, 47)
    hazeGradient.addColorStop(0, 'rgba(255,247,226,0.42)')
    hazeGradient.addColorStop(0.42, 'rgba(246,235,211,0.2)')
    hazeGradient.addColorStop(1, 'rgba(238,224,198,0)')
    hazeContext.fillStyle = hazeGradient
    hazeContext.fillRect(0, 0, 96, 96)
    const hazeTexture = new T.CanvasTexture(hazeCanvas)
    hazeTexture.colorSpace = T.SRGBColorSpace
    for (let i = 0; i < (quality.mobile ? 4 : 8); i += 1) {
      const material = new T.SpriteMaterial({ map: hazeTexture, color: 0xf5ead2, transparent: true, opacity: 0, depthWrite: false })
      const sprite = new T.Sprite(material)
      sprite.frustumCulled = false
      this.group.add(sprite)
      this.haze.push({ sprite, material, phase: random() * Math.PI * 2, near: random(), scale: 0.7 + random() * 0.85 })
    }
    const pileGeometry = new T.SphereGeometry(1, 48, 24)
    const pos = pileGeometry.attributes.position
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const radius = Math.sqrt(x * x + z * z)
      const angle = Math.atan2(z, x)
      const perimeter = 1 + Math.sin(angle * 5 + 0.8) * 0.065 + Math.sin(angle * 9) * 0.028
      const mound = Math.pow(Math.max(0, 1 - radius * radius), 0.42) * 0.27
      const granular = Math.sin(x * 17 + z * 13) * Math.cos(z * 21 - x * 7) * 0.012
      pos.setXYZ(i, x * 0.96 * perimeter, y < 0 ? 0 : Math.max(0, mound + granular), z * 0.68 * perimeter)
    }
    pileGeometry.computeVertexNormals()
    this.pile = mesh(pileGeometry, mat(PALETTE.flour, quality, 'flour', { roughness: 1 }), this.group)
    this.pile.name = 'flour-pile'
    dust(this.pile, quality, quality.mobile ? 34 : 58, 1.12, 0.008)
    this.pileShadow = contactShadow(this.group, 1.8, 1.15)
    this.pileShadow.material.opacity = 0.24
  }

  update(p: number, time: number, outlet: T.Vector3, bowlTarget: T.Vector3) {
    const emitted = windowProgress(p, 0.283, 0.386, (t) => t)
    const transfer = windowProgress(p, 0.437, 0.487, (t) => t)
    const amount = windowProgress(p, 0.296, 0.39) * (1 - windowProgress(p, 0.44, 0.486))
    this.group.visible = p >= 0.282 && p <= 0.49
    this.pile.position.set(-0.65, 0, 0.85)
    this.pile.scale.setScalar(Math.max(0.001, Math.cbrt(amount)))
    this.pile.visible = amount > 0.0001
    this.pileShadow.position.set(-0.65, 0.002, 0.85)
    this.pileShadow.scale.setScalar(Math.max(0.001, Math.sqrt(amount)))
    this.pileShadow.visible = this.pile.visible
    if (!this.group.visible) return
    const hazePresence = Math.max(bell(emitted) * (1 - transfer) * 0.42, bell(transfer))
    this.haze.forEach((entry, index) => {
      const nearPass = Math.pow(entry.near, 1.6)
      entry.sprite.visible = hazePresence > 0.003
      entry.material.opacity = hazePresence * (0.035 + nearPass * 0.038)
      entry.sprite.position.set(
        T.MathUtils.lerp(-0.62, bowlTarget.x, transfer) + Math.sin(entry.phase + transfer * 3) * 0.42,
        0.34 + nearPass * 0.72 + Math.cos(entry.phase + time * 0.18) * 0.11,
        0.7 + nearPass * 1.65 + Math.sin(index * 1.7) * 0.16,
      )
      const scale = entry.scale * (0.65 + nearPass * 0.75) * (0.7 + hazePresence * 0.45)
      entry.sprite.scale.set(scale, scale * 0.68, 1)
    })
    this.particles.forEach((particle, i) => {
      const flow = clamp01((emitted - particle.delay * 0.72) / 0.28)
      const pour = clamp01((transfer - particle.delay * 0.65) / 0.35)
      this.source.copy(outlet)
      this.destination.set(-0.65 + particle.x, particle.y, 0.85 + particle.z)
      const fall = flow * flow
      temp.lerpVectors(this.source, this.destination, fall)
      let alpha = flow > 0 && flow < 1 ? 0.2 + particle.weight * 0.4 : 0
      if (transfer > 0) {
        this.source.copy(this.destination)
        this.destination.copy(bowlTarget).add(temp2.set(particle.x * 0.7, particle.y * 0.18, particle.z * 0.68))
        arcPosition(this.source, this.destination, pour, 0.65, temp)
        const foregroundPass = bell(pour) * Math.pow(particle.near, 4)
        temp.z += foregroundPass * (1.2 + particle.near * 1.55)
        temp.y += foregroundPass * (0.1 + particle.weight * 0.55)
        temp.x += Math.sin(particle.phase) * foregroundPass * 0.46
        alpha = pour > 0 && pour < 1 ? 0.22 + particle.weight * 0.42 + foregroundPass * 0.13 : 0
      }
      const drift = Math.sin(time * (0.34 + particle.near * 0.32) + particle.phase) * (0.008 + particle.near * 0.022) * alpha
      this.positions.setXYZ(i, temp.x + drift, temp.y + Math.cos(time * 0.28 + particle.phase) * drift * 0.6, temp.z + drift)
      this.alphas.setX(i, alpha)
    })
    this.positions.needsUpdate = this.alphas.needsUpdate = true
  }
}

function wheatEar(parent: T.Object3D, quality: QualityConfig, height: number, seed: number) {
  const randomLocal = createRandom(seed)
  const ear = new T.Group()
  parent.add(ear)
  const stemMaterial = mat(0xba913f, quality, undefined, { roughness: 0.92 })
  const kernelMaterial = mat(PALETTE.wheatLight, quality, 'crust', { roughness: 0.76, emissive: 0x6b450b, emissiveIntensity: 0.18 })
  rod(new T.Vector3(0, 0, 0), new T.Vector3(0.035, height, 0), 0.014, stemMaterial, ear)
  const kernelGeometry = new T.SphereGeometry(1, 12, 10)
  for (let row = 0; row < 9; row += 1) {
    for (const side of [-1, 1]) {
      if (row === 4 && side === 1) continue
      const y = height - 0.88 + row * 0.095
      const kernel = mesh(kernelGeometry, kernelMaterial, ear, side * (0.062 - row * 0.003), y, 0)
      kernel.scale.set(0.061 - row * 0.0018, 0.112 - row * 0.003, 0.064)
      kernel.rotation.z = side * -0.43
      rod(new T.Vector3(side * 0.085, y + 0.045, 0), new T.Vector3(side * (0.21 - row * 0.005), y + 0.39, 0), 0.003, stemMaterial, ear)
    }
  }
  tube([new T.Vector3(0, 0.78, 0), new T.Vector3(-0.19, 1.12, 0.06), new T.Vector3(-0.31, 1.43, 0.03)], 0.017, stemMaterial, ear)
  ear.userData.phase = randomLocal() * Math.PI * 2
  return ear
}

type WheatField = {
  group: T.Group
  update(time: number): void
}

function wheatField(quality: QualityConfig): WheatField {
  const group = new T.Group()
  const count = quality.wheatCount
  const stem = new T.InstancedMesh(
    new T.CylinderGeometry(0.012, 0.018, 1, 6),
    mat(0x667b3e, quality, undefined, { roughness: 0.96 }),
    count,
  )
  const grain = new T.InstancedMesh(
    new T.SphereGeometry(1, 8, 6),
    mat(PALETTE.wheat, quality, 'crust', { roughness: 0.84, emissive: 0x4b2c08, emissiveIntensity: 0.08 }),
    count * 8,
  )
  const awn = new T.InstancedMesh(
    new T.CylinderGeometry(0.0025, 0.0025, 1, 4),
    mat(0x9e7b32, quality, undefined, { roughness: 0.96 }),
    count * 8,
  )
  stem.instanceMatrix.setUsage(T.DynamicDrawUsage)
  grain.instanceMatrix.setUsage(T.DynamicDrawUsage)
  awn.instanceMatrix.setUsage(T.DynamicDrawUsage)
  stem.castShadow = grain.castShadow = awn.castShadow = quality.shadows
  stem.receiveShadow = grain.receiveShadow = awn.receiveShadow = quality.shadows
  group.add(stem, grain, awn)

  const clusterCenters = [-2.55, -1.62, -0.72, 0.2, 1.16, 2.18, 2.78]
  const foregroundCount = Math.max(12, Math.floor(count * 0.065))
  const specs = Array.from({ length: count }, (_, index) => {
    const foreground = index < foregroundCount
    const cluster = clusterCenters[Math.floor(random() * clusterCenters.length)]
    const clusteredOffset = (random() + random() + random() - 1.5) * 0.64
    const side = random() > 0.5 ? 1 : -1
    return {
      x: foreground ? side * (1.25 + random() * 1.75) + (random() - 0.5) * 0.35 : cluster + clusteredOffset,
      z: foreground ? 0.34 + random() * 1.35 : -0.52 - random() * 3.0,
      height: foreground ? 1.62 + random() * 0.72 : 1.15 + random() * 0.82,
      scale: foreground ? 0.92 + random() * 0.32 : 0.72 + random() * 0.46,
      phase: random() * Math.PI * 2,
      lean: (random() - 0.5) * (foreground ? 0.28 : 0.19),
      forward: (random() - 0.5) * 0.13,
      tone: random(),
    }
  })
  const dummy = new T.Object3D()
  const instanceColor = new T.Color()
  let grainColorIndex = 0
  specs.forEach((spec, index) => {
    instanceColor.setHSL(0.22 + spec.tone * 0.018, 0.34, 0.25 + spec.tone * 0.11)
    stem.setColorAt(index, instanceColor)
    for (let row = 0; row < 4; row += 1) {
      for (const side of [-1, 1]) {
        instanceColor.setHSL(0.105 + spec.tone * 0.018, 0.58 + spec.tone * 0.08, 0.41 + spec.tone * 0.15)
        grain.setColorAt(grainColorIndex, instanceColor)
        awn.setColorAt(grainColorIndex, instanceColor.clone().multiplyScalar(0.73))
        grainColorIndex += 1
      }
    }
  })
  stem.instanceColor!.needsUpdate = grain.instanceColor!.needsUpdate = awn.instanceColor!.needsUpdate = true

  return {
    group,
    update(time) {
      let grainIndex = 0
      let awnIndex = 0
      specs.forEach((spec, index) => {
        const sway = Math.sin(time * (0.48 + spec.tone * 0.19) + spec.phase) * (0.018 + spec.tone * 0.014)
        const height = spec.height * spec.scale
        dummy.position.set(spec.x + sway * 0.25, height * 0.5 - 0.03, spec.z)
        dummy.rotation.set(spec.forward + sway * 0.35, 0, spec.lean + sway)
        dummy.scale.set(1, height, 1)
        dummy.updateMatrix()
        stem.setMatrixAt(index, dummy.matrix)

        for (let row = 0; row < 4; row += 1) {
          const y = height * 0.63 + row * 0.105
          for (const side of [-1, 1]) {
            const sideOffset = side * (0.048 - row * 0.002)
            const leanX = (spec.lean + sway) * y * 0.44
            const leanZ = spec.forward * y * 0.38
            dummy.position.set(spec.x + leanX + sideOffset, y, spec.z + leanZ)
            dummy.rotation.set(spec.forward, 0, spec.lean + sway + side * -0.42)
            const grainScale = 0.9 + spec.tone * 0.18
            dummy.scale.set((0.057 - row * 0.002) * grainScale, (0.092 - row * 0.003) * grainScale, 0.06 * grainScale)
            dummy.updateMatrix()
            grain.setMatrixAt(grainIndex, dummy.matrix)
            grainIndex += 1

            dummy.position.set(spec.x + leanX + side * 0.082, y + 0.045, spec.z + leanZ)
            dummy.rotation.set(spec.forward, 0, spec.lean + sway + side * -0.34)
            dummy.scale.set(1, 0.34, 1)
            dummy.updateMatrix()
            awn.setMatrixAt(awnIndex, dummy.matrix)
            awnIndex += 1
          }
        }
      })
      stem.instanceMatrix.needsUpdate = true
      grain.instanceMatrix.needsUpdate = true
      awn.instanceMatrix.needsUpdate = true
    },
  }
}

function grainKernel(quality: QualityConfig, scale = 1) {
  const profile = [[0.012, -0.59], [0.17, -0.53], [0.285, -0.32], [0.325, 0.02], [0.27, 0.34], [0.15, 0.54], [0.01, 0.62]]
  const group = new T.Group()
  const geometry = new T.LatheGeometry(profile.map(([radius, y]) => new T.Vector2(radius, y)), 48)
  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    const angle = Math.atan2(z, x)
    const shoulder = 1 + y * 0.065 + Math.sin(y * 4.2) * 0.022
    const rib = 1 + Math.sin(angle * 3 + y * 2.1) * 0.014
    positions.setXYZ(i, x * shoulder * rib + (1 - y * y) * 0.024, y, z * 0.69 * (1 - y * 0.045) * rib)
  }
  geometry.computeVertexNormals()
  const seed = mesh(geometry, mat(0xe0ad4d, quality, undefined, { roughness: 0.88 }), group)
  seed.scale.setScalar(scale)
  const crease = tube([new T.Vector3(0.018, -0.45, 0.18), new T.Vector3(-0.006, -0.18, 0.218), new T.Vector3(0.012, 0.16, 0.213), new T.Vector3(-0.005, 0.44, 0.176)], 0.013, mat(0x755022, quality, undefined, { roughness: 0.96 }), group)
  crease.scale.setScalar(scale)
  const creaseEdge = tube([new T.Vector3(0.04, -0.41, 0.19), new T.Vector3(0.022, -0.12, 0.227), new T.Vector3(0.035, 0.2, 0.22), new T.Vector3(0.018, 0.4, 0.185)], 0.004, mat(0xf5cf78, quality, undefined, { roughness: 0.82 }), group)
  creaseEdge.scale.setScalar(scale)
  return group
}

function mill(quality: QualityConfig) {
  const group = new T.Group()
  const stone = mat(0xa7a395, quality, 'stone', { roughness: 0.96 })
  const stoneEdge = mat(0x817d71, quality, 'stone', { roughness: 0.98 })
  const grooveMaterial = mat(0x68675f, quality, undefined, { roughness: 0.94 })
  const iron = mat(0x302f2b, quality, undefined, { metalness: 0.48, roughness: 0.55 })
  const rotor = new T.Group()
  rotor.position.y = 0.62
  group.add(rotor)
  mesh(irregularCylinderGeometry(1.19, 1.25, 0.38, 48, 31), stone, group, 0, 0.2, 0)
  mesh(irregularCylinderGeometry(1.16, 1.2, 0.44, 48, 79), stone, rotor)
  ring(1.205, 0.028, stoneEdge, group, 0.37)
  ring(1.18, 0.025, stoneEdge, rotor, -0.2)
  ring(1.16, 0.014, iron, rotor, 0.2)
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2
    const turn = angle + 0.2 + Math.sin(i * 1.7) * 0.035
    rod(new T.Vector3(Math.cos(angle) * 0.29, 0.224, Math.sin(angle) * 0.29), new T.Vector3(Math.cos(turn) * 1.08, 0.224, Math.sin(turn) * 1.08), 0.008, grooveMaterial, rotor)
  }
  rod(new T.Vector3(0, 0.74, 0), new T.Vector3(0, 1.78, 0), 0.052, iron, group)
  rod(new T.Vector3(0, 1.1, 0), new T.Vector3(0.88, 1.1, 0), 0.052, iron, rotor)
  rod(new T.Vector3(0.88, 1.08, 0), new T.Vector3(0.88, 1.5, 0), 0.09, mat(0x8e5a31, quality, 'wood', { roughness: 0.83 }), rotor)
  const funnelWood = mat(0xae7949, quality, undefined, { side: T.DoubleSide, roughness: 0.86, emissive: 0x2b1609, emissiveIntensity: 0.08 })
  const funnel = mesh(new T.CylinderGeometry(0.49, 0.14, 0.56, 4, 1, true), funnelWood, group, 0, 1.35, 0)
  funnel.rotation.y = Math.PI / 4 + 0.16
  ring(0.49, 0.023, mat(0x704629, quality, 'wood', { roughness: 0.9 }), group, 1.63)
  ring(0.145, 0.016, mat(0x5e3c28, quality, undefined, { roughness: 0.92 }), group, 1.07)
  mesh(new T.CylinderGeometry(0.28, 0.28, 0.03, 24), mat(0x8b5a34, quality, 'wood'), group, 0, 1.53, 0)
  const outlet = new T.Vector3(0.25, 0.2, 1.12)
  mesh(roundBox(0.42, 0.84, 0.065, 0.045), mat(0x936039, quality, 'wood'), group, outlet.x, outlet.y, outlet.z).rotation.x = 0.2
  const shadow = contactShadow(group, 2.85, 2.45)
  shadow.scale.set(1.08, 1, 1)
  return { group, rotor, outlet }
}

function bowl(quality: QualityConfig) {
  const group = new T.Group()
  const profile = [[0.48, -0.42], [0.82, -0.36], [1.16, -0.14], [1.3, 0.18], [1.25, 0.4], [1.08, 0.52], [0.96, 0.48], [1.0, 0.28], [0.9, 0.02], [0.72, -0.18], [0.44, -0.27]]
  const shell = mesh(new T.LatheGeometry(profile.map(([radius, y]) => new T.Vector2(radius, y)), 48), mat(0xd4d0c2, quality, undefined, { roughness: 0.34 }), group)
  shell.scale.z = 0.96
  const interior = mesh(new T.CircleGeometry(0.455, 40), mat(0xbab5aa, quality, undefined, { roughness: 0.5 }), group, 0, -0.265, 0)
  interior.rotation.x = -Math.PI / 2
  const flourSurface = mesh(new T.CircleGeometry(0.94, 32), mat(PALETTE.flour, quality, 'flour', { roughness: 1 }), group, 0, 0.39, 0)
  flourSurface.rotation.x = -Math.PI / 2
  const rim = ring(1.14, 0.042, mat(0xeee8d9, quality, undefined, { roughness: 0.27 }), group, 0.48)
  rim.scale.set(1, 0.98, 1)
  ring(0.48, 0.035, mat(0xaaa598, quality, undefined, { roughness: 0.62 }), group, -0.4)
  return { group, flourSurface }
}

function jug(quality: QualityConfig) {
  const group = new T.Group()
  group.position.set(-1.25, 1.47, -0.08)
  group.rotation.z = -0.6
  const glass = mat(0xb5d4d1, quality, undefined, { transparent: true, opacity: 0.48, roughness: 0.1, metalness: 0.08, side: T.DoubleSide, depthWrite: false })
  const jugProfile = [[0.22, -0.34], [0.27, -0.29], [0.3, 0.12], [0.285, 0.27], [0.32, 0.34]]
  mesh(new T.LatheGeometry(jugProfile.map(([radius, y]) => new T.Vector2(radius, y)), 32), glass, group)
  ring(0.32, 0.024, glass, group, 0.34)
  const handle = mesh(new T.TorusGeometry(0.2, 0.037, 12, 32), glass, group, -0.36, 0, 0)
  handle.scale.x = 0.75
  const spout = mesh(new T.ConeGeometry(0.14, 0.3, 4, 1, true), glass, group, 0.25, 0.34, 0)
  spout.rotation.z = -Math.PI / 2
  spout.rotation.y = Math.PI / 4
  const water = mesh(new T.CylinderGeometry(0.274, 0.235, 0.36, 32), mat(0x72aeb5, quality, undefined, { transparent: true, opacity: 0.67, roughness: 0.12, depthWrite: false }), group, 0, -0.11, 0)
  water.castShadow = false
  const waterTop = mesh(new T.CircleGeometry(0.272, 32), mat(0xa9d9da, quality, undefined, { transparent: true, opacity: 0.72, roughness: 0.08, depthWrite: false }), group, 0, 0.07, 0)
  waterTop.rotation.x = -Math.PI / 2
  group.traverse((child) => {
    const candidate = child as T.Mesh
    if (candidate.isMesh) candidate.castShadow = false
  })
  return group
}

function proofBasket(quality: QualityConfig) {
  const group = new T.Group()
  const wicker = [0xc69a60, 0xb98650, 0xd0aa71].map((color) => mat(color, quality, 'wood', { roughness: 0.92 }))
  for (let i = 0; i < 13; i += 1) {
    const strand = ring(0.77 + i * 0.024 + Math.sin(i * 1.7) * 0.006, 0.027 + (i % 3) * 0.002, wicker[i % wicker.length], group, 0.05 + i * 0.035)
    strand.position.x = Math.sin(i * 2.3) * 0.005
    strand.rotation.z = Math.sin(i * 1.2) * 0.004
  }
  const rodMaterials = [mat(0x815631, quality, 'wood', { roughness: 0.95 }), mat(0x9a6b3f, quality, 'wood', { roughness: 0.95 })]
  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * Math.PI * 2
    rod(new T.Vector3(Math.cos(angle) * 0.79, 0.055, Math.sin(angle) * 0.79), new T.Vector3(Math.cos(angle) * (1.056 + Math.sin(i) * 0.008), 0.48, Math.sin(angle) * (1.056 + Math.sin(i) * 0.008)), 0.009, rodMaterials[i % 2], group)
  }
  return group
}

function oven(quality: QualityConfig) {
  const group = new T.Group()
  const bricks = [0x8e4329, 0xa24f2c, 0x733725, 0xb05c36].map((color) => mat(color, quality, 'stone', { roughness: 0.92 }))
  const mortar = mat(0x302821, quality, 'stone', { roughness: 0.97 })
  const dark = mat(0x070403, quality, undefined, { roughness: 1 })
  mesh(roundBox(3.8, 2.65, 0.18), mortar, group, 0, -0.18, 0)
  mesh(new T.BoxGeometry(3.5, 2.2, 0.18), dark, group, 0, 1.02, -1.08)
  mesh(new T.BoxGeometry(0.16, 1.18, 1.5), dark, group, -1.12, 0.59, -0.28)
  mesh(new T.BoxGeometry(0.16, 1.18, 1.5), dark, group, 1.12, 0.59, -0.28)
  mesh(new T.BoxGeometry(2.25, 0.12, 1.5), dark, group, 0, 1.18, -0.28)
  mesh(new T.BoxGeometry(0.55, 1.2, 1.55), mortar, group, -1.47, 0.6, -0.12)
  mesh(new T.BoxGeometry(0.55, 1.2, 1.55), mortar, group, 1.47, 0.6, -0.12)
  for (const side of [-1, 1]) for (let row = 0; row < 4; row += 1) {
    const brick = mesh(new T.BoxGeometry(0.49, 0.265, 0.24), bricks[(row + (side > 0 ? 1 : 0)) % bricks.length], group, side * 1.47, 0.16 + row * 0.3, 0.69)
    brick.position.x += Math.sin(row * 2.1 + side) * 0.012
  }
  for (let i = 0; i < 13; i += 1) {
    const a = (i / 13) * Math.PI + 0.005
    const b = ((i + 1) / 13) * Math.PI - 0.005
    const wedge = new T.Shape()
    wedge.moveTo(Math.cos(a) * 1.2, 1.17 + Math.sin(a) * 0.94)
    wedge.lineTo(Math.cos(a) * 1.745, 1.17 + Math.sin(a) * 1.39)
    wedge.lineTo(Math.cos(b) * 1.745, 1.17 + Math.sin(b) * 1.39)
    wedge.lineTo(Math.cos(b) * 1.2, 1.17 + Math.sin(b) * 0.94)
    wedge.closePath()
    mesh(new T.ExtrudeGeometry(wedge, { depth: 1.5, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.012, bevelThickness: 0.012 }), bricks[i % bricks.length], group, 0, 0, -0.86)
  }
  const floorMaterial = mat(0x655447, quality, 'stone', { roughness: 0.98 })
  for (let i = 0; i < 5; i += 1) mesh(new T.BoxGeometry(0.48, 0.11, 1.45), floorMaterial, group, -0.98 + i * 0.49, 0.04, 0.01)
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = 256
  glowCanvas.height = 128
  const glowContext = glowCanvas.getContext('2d')!
  const glowGradient = glowContext.createRadialGradient(128, 98, 4, 128, 90, 118)
  glowGradient.addColorStop(0, 'rgba(255,139,50,0.92)')
  glowGradient.addColorStop(0.28, 'rgba(209,63,15,0.5)')
  glowGradient.addColorStop(1, 'rgba(63,9,2,0)')
  glowContext.fillStyle = glowGradient
  glowContext.fillRect(0, 0, 256, 128)
  const glowTexture = new T.CanvasTexture(glowCanvas)
  glowTexture.colorSpace = T.SRGBColorSpace
  const glow = mesh(new T.PlaneGeometry(2.15, 0.82), new T.MeshBasicMaterial({ map: glowTexture, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }), group, 0, 0.46, -0.98)
  glow.castShadow = false
  const embers: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[] = []
  for (let i = 0; i < 11; i += 1) {
    const foreground = i < 5
    const side = i % 2 === 0 ? -1 : 1
    const ember = mesh(new T.IcosahedronGeometry(0.026 + random() * 0.027, 0), mat(0x76220e, quality, undefined, {
      emissive: i % 3 === 0 ? 0xe97925 : 0xb83b16, emissiveIntensity: 0.55, roughness: 1,
    }), group,
    foreground ? side * (0.78 + random() * 0.25) : -0.88 + random() * 1.76,
    0.13 + random() * 0.07,
    foreground ? 0.35 + random() * 0.38 : -0.52 - random() * 0.34)
    ember.userData.phase = random() * Math.PI * 2
    embers.push(ember)
  }
  return { group, glow, embers }
}

function breadKnife(quality: QualityConfig) {
  const group = new T.Group()
  group.name = 'bread-knife'
  const bladeProfile = new T.Shape()
  bladeProfile.moveTo(-0.72, 0.065)
  bladeProfile.lineTo(0.72, 0.055)
  bladeProfile.lineTo(0.72, -0.018)
  for (let tooth = 8; tooth >= 0; tooth -= 1) {
    const x = -0.64 + tooth * 0.15
    bladeProfile.lineTo(x, tooth % 2 === 0 ? -0.055 : -0.028)
  }
  bladeProfile.lineTo(-0.72, -0.015)
  bladeProfile.closePath()
  const bladeGeometry = new T.ExtrudeGeometry(bladeProfile, { depth: 0.026, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.006, bevelThickness: 0.005 })
  bladeGeometry.rotateY(Math.PI / 2)
  bladeGeometry.center()
  const blade = mesh(bladeGeometry, mat(0xd1d0c8, quality, undefined, { metalness: 0.78, roughness: 0.2, emissive: 0x3b3832, emissiveIntensity: 0.12 }), group, 0, 0, 0.08)
  blade.castShadow = quality.shadows
  mesh(roundBox(0.13, 0.64, 0.14, 0.04), mat(0x3d261b, quality, 'wood', { roughness: 0.72 }), group, 0, 0.01, -0.94)
  const glint = mesh(new T.BoxGeometry(0.031, 0.008, 0.96), new T.MeshBasicMaterial({ color: 0xffedc9, transparent: true, opacity: 0.48 }), group, 0.018, 0.052, 0.12)
  glint.castShadow = glint.receiveShadow = false
  return group
}

function crumbFaceGeometry() {
  const face = new T.Shape()
  face.moveTo(-0.48, -0.34)
  face.bezierCurveTo(-0.52, -0.08, -0.47, 0.25, -0.22, 0.38)
  face.bezierCurveTo(-0.06, 0.47, 0.23, 0.43, 0.39, 0.27)
  face.bezierCurveTo(0.5, 0.14, 0.52, -0.12, 0.46, -0.34)
  face.lineTo(-0.48, -0.34)
  return new T.ShapeGeometry(face, 5)
}

function breadCutDetails(quality: QualityConfig) {
  const group = new T.Group()
  group.name = 'bread-cut-reveal'
  const crumbMaterial = mat(0xfff3d2, quality, 'crumb', { roughness: 0.97, side: T.DoubleSide, emissive: 0xffc77f, emissiveIntensity: 0.5 })
  const crustMaterial = mat(0x843515, quality, 'crust', { roughness: 0.94, bumpScale: 0.027 })
  const poreMaterial = new T.MeshBasicMaterial({ color: 0x6d3919, transparent: true, opacity: 0.64, side: T.DoubleSide, depthWrite: false })
  const faceGeometry = crumbFaceGeometry()
  const mainCrustFace = mesh(faceGeometry, crustMaterial, group, 0.806, 0.43, 0)
  mainCrustFace.rotation.y = Math.PI / 2
  mainCrustFace.scale.set(1, 1, 1)
  const mainFace = mesh(faceGeometry, crumbMaterial, group, 0.821, 0.43, 0)
  mainFace.rotation.y = Math.PI / 2
  mainFace.scale.set(0.94, 0.94, 0.94)

  const slice = new T.Group()
  slice.name = 'separated-slice'
  const sliceBody = mesh(new T.SphereGeometry(1, 28, 18), crustMaterial, slice)
  sliceBody.scale.set(0.145, 0.44, 0.57)
  const sliceFace = mesh(faceGeometry, crumbMaterial, slice, 0.151, 0, 0)
  sliceFace.rotation.y = Math.PI / 2
  sliceFace.scale.set(0.95, 0.95, 0.95)
  slice.position.set(0.88, 0.43, 0)
  group.add(slice)

  const porePositions = [[0.31, -0.14], [0.52, 0.08], [0.41, 0.21], [0.57, -0.24], [0.27, 0.18], [0.46, -0.02], [0.2, -0.2]]
  porePositions.forEach(([y, z], index) => {
    const pore = mesh(new T.CircleGeometry(0.014 + (index % 3) * 0.005, 8), poreMaterial, group, 0.824, y, z)
    pore.rotation.y = Math.PI / 2
    pore.scale.y = 0.72 + (index % 2) * 0.18
  })
  const slicePores = [[-0.12, -0.16], [0.1, 0.09], [0.23, -0.04], [-0.02, 0.22], [0.27, 0.2], [-0.2, 0.12]]
  slicePores.forEach(([y, z], index) => {
    const pore = mesh(new T.CircleGeometry(0.013 + (index % 3) * 0.004, 8), poreMaterial, slice, 0.154, y, z)
    pore.rotation.y = Math.PI / 2
    pore.scale.y = 0.68 + (index % 2) * 0.2
  })

  const crumbs = Array.from({ length: 8 }, (_, index) => {
    const crumb = mesh(new T.IcosahedronGeometry(0.015 + random() * 0.017, 0), crumbMaterial, group)
    return { crumb, delay: index / 11 + random() * 0.12, x: 0.72 + random() * 0.2, z: (random() - 0.5) * 0.55 }
  })
  return { group, slice, crumbs }
}

function contactShadow(parent: T.Object3D, width: number, depth: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(15,10,5,0.3)')
  gradient.addColorStop(0.55, 'rgba(15,10,5,0.13)')
  gradient.addColorStop(1, 'rgba(15,10,5,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  const shadow = mesh(new T.PlaneGeometry(width, depth), new T.MeshBasicMaterial({
    map: new T.CanvasTexture(canvas), transparent: true, depthWrite: false, opacity: 1,
  }), parent, 0, 0.004, 0)
  shadow.rotation.x = -Math.PI / 2
  shadow.castShadow = shadow.receiveShadow = false
  return shadow
}

export function createJourneySequence(quality: QualityConfig): JourneySequence {
  random = createRandom(4937)
  const group = new T.Group()
  group.name = 'journey-transformation'
  const field = new T.Group()
  const heroEar = wheatEar(field, quality, 2.48, 812)
  heroEar.position.set(-0.21, 0, 0.26)
  const fieldModel = wheatField(quality)
  field.add(fieldModel.group)
  group.add(field)

  // The hero grain starts in a deliberate gap in the ear, then detaches.
  const kernel = grainKernel(quality)
  kernel.name = 'hero-kernel'
  group.add(kernel)
  const millModel = mill(quality)
  millModel.group.name = 'mill'
  group.add(millModel.group)

  const worktop = new T.Group()
  worktop.name = 'shared-worktop'
  board(worktop, quality, 5.5, 3.7, 0xa97950)
  dust(worktop, quality, quality.crumbCount, 1.9, 0.002)
  worktop.rotation.y = -0.018
  group.add(worktop)

  const flour = new FlourSystem(quality)
  group.add(flour.group)
  const bowlModel = bowl(quality)
  bowlModel.group.name = 'mixing-bowl'
  group.add(bowlModel.group)
  const bowlShadow = contactShadow(group, 2.6, 2.3)

  const waterGroup = jug(quality)
  group.add(waterGroup)
  const waterMaterial = mat(0xbcdce0, quality, undefined, { opacity: 0.65, roughness: 0.2, depthWrite: false })
  const waterStream = mesh(new T.CylinderGeometry(0.021, 0.035, 1, 10), waterMaterial, group)
  waterStream.name = 'water-stream'
  const streamHighlight = mesh(new T.CylinderGeometry(0.004, 0.007, 0.94, 6), new T.MeshBasicMaterial({ color: 0xe6ffff, transparent: true, opacity: 0.5, depthWrite: false }), waterStream, 0.018, 0, 0)
  streamHighlight.castShadow = streamHighlight.receiveShadow = false

  const additions = new T.Group()
  const additionSeeds: { mesh: T.Mesh; x: number; z: number; delay: number }[] = []
  for (let i = 0; i < 15; i += 1) {
    const piece = mesh(new T.IcosahedronGeometry(i < 10 ? 0.02 : 0.035, 0), mat(i < 10 ? PALETTE.salt : PALETTE.yeast, quality), additions)
    additionSeeds.push({ mesh: piece, x: (random() - 0.5) * 0.65, z: (random() - 0.5) * 0.45, delay: random() * 0.45 })
  }
  group.add(additions)

  const dough = new DoughMorph(group, quality)
  const cutDetails = breadCutDetails(quality)
  cutDetails.group.visible = false
  dough.mesh.add(cutDetails.group)
  const doughShadow = contactShadow(group, 2.5, 1.85)
  const spoon = new T.Group()
  spoon.name = 'mixing-spoon'
  const spoonMaterial = mat(0xbd8747, quality, 'wood', { roughness: 0.86 })
  mesh(new T.SphereGeometry(1, 24, 16), spoonMaterial, spoon).scale.set(0.16, 0.055, 0.24)
  rod(new T.Vector3(0, 0.03, 0), new T.Vector3(0.28, 1.12, 0), 0.037, spoonMaterial, spoon)
  group.add(spoon)
  const basket = proofBasket(quality)
  basket.name = 'proofing-basket'
  basket.scale.set(1.14, 1, 0.92)
  group.add(basket)

  const proofMotes = new T.Group()
  proofMotes.name = 'proofing-dust-motes'
  const proofMoteCount = quality.mobile ? 12 : 22
  const proofMotePositions = new Float32Array(proofMoteCount * 3)
  const proofMoteSeeds = Array.from({ length: proofMoteCount }, (_, index) => ({
    x: (random() - 0.5) * 3.2,
    y: 0.28 + random() * 1.45,
    z: -0.2 + (random() - 0.5) * 1.8,
    phase: random() * Math.PI * 2 + index,
  }))
  const proofMoteGeometry = new T.BufferGeometry()
  proofMoteGeometry.setAttribute('position', new T.BufferAttribute(proofMotePositions, 3))
  const proofMoteMaterial = pointsMaterial(0xffe1a8, 0.025, 0)
  const proofMotePoints = new T.Points(proofMoteGeometry, proofMoteMaterial)
  proofMotePoints.frustumCulled = false
  proofMotes.add(proofMotePoints)
  group.add(proofMotes)

  const ovenModel = oven(quality)
  ovenModel.group.name = 'oven'
  group.add(ovenModel.group)
  const peel = new T.Group()
  peel.name = 'oven-peel'
  mesh(roundBox(2.65, 1.95, 0.045, 0.25), mat(0xe3be85, quality, 'wood'), peel)
  rod(new T.Vector3(0, 0.005, 0.95), new T.Vector3(0, 0.005, 2.7), 0.055, mat(0xaf854f, quality, 'wood'), peel)
  group.add(peel)

  const knife = breadKnife(quality)
  group.add(knife)

  const finalBoard = new T.Group()
  finalBoard.name = 'final-board'
  board(finalBoard, quality, 3.65, 2.45, 0x633923)
  dust(finalBoard, quality, Math.max(18, Math.floor(quality.crumbCount * 0.62)), 1.48)
  finalBoard.rotation.y = 0.025
  group.add(finalBoard)
  const steam = new T.Group()
  const steamParticles = new Float32Array(24 * 3)
  const steamGeometry = new T.BufferGeometry()
  steamGeometry.setAttribute('position', new T.BufferAttribute(steamParticles, 3))
  const steamMaterial = pointsMaterial(0xe9e1d2, 0.07, 0)
  const steamCanvas = document.createElement('canvas')
  steamCanvas.width = steamCanvas.height = 64
  const steamCtx = steamCanvas.getContext('2d')!
  const steamGradient = steamCtx.createRadialGradient(32,32,0,32,32,32)
  steamGradient.addColorStop(0,'rgba(255,255,255,0.6)')
  steamGradient.addColorStop(1,'rgba(255,255,255,0)')
  steamCtx.fillStyle=steamGradient
  steamCtx.fillRect(0,0,64,64)
  steamMaterial.map=new T.CanvasTexture(steamCanvas)
  const steamPoints = new T.Points(steamGeometry, steamMaterial)
  steamPoints.frustumCulled = false
  steam.add(steamPoints)
  group.add(steam)

  const visibility = {
    field: new Visibility(field), mill: new Visibility(millModel.group),
    top: new Visibility(worktop), bowl: new Visibility(bowlModel.group),
    water: new Visibility(waterGroup), spoon: new Visibility(spoon),
    additions: new Visibility(additions), basket: new Visibility(basket),
    oven: new Visibility(ovenModel.group), peel: new Visibility(peel),
    final: new Visibility(finalBoard), knife: new Visibility(knife),
  }
  const kernelHome = new T.Vector3(-0.155, 1.98, 0.26)
  const kernelFocus = new T.Vector3(0, 1.5, 0.65)
  const hopper = new T.Vector3()
  const outlet = new T.Vector3()
  const bowlTarget = new T.Vector3()
  const doughInBowl = new T.Vector3()
  const doughOnBoard = new T.Vector3(0, 0.002, 0.12)
  const doughInBasket = new T.Vector3(0, 0.075, 0.12)
  const ovenDestination = new T.Vector3(0, 0.105, -1.4)
  const finalDestination = new T.Vector3(0, 0.02, 0.48)
  const waterStart = new T.Vector3()
  const up = new T.Vector3(0,1,0)

  return {
    group,
    update({ progress, time, quality: currentQuality }) {
      const p = clamp01(progress)
      const ambient = currentQuality.reducedMotion ? 0 : time
      const flourish = currentQuality.reducedMotion ? 0.35 : 1
      const extract = windowProgress(p, 0.085, 0.165)
      const feed = windowProgress(p, 0.218, 0.28, weightedOut)
      const millEnter = windowProgress(p, 0.184, 0.235)
      const millExit = windowProgress(p, 0.355, 0.413)
      field.position.set(0, 0, -windowProgress(p, 0.13, 0.25) * 2)
      visibility.field.set(1 - windowProgress(p, 0.166, 0.248))
      if (field.visible) {
        fieldModel.update(ambient)
        heroEar.rotation.z = Math.sin(ambient * 0.65) * 0.016 * (1 - extract)
      }
      kernel.visible = p < 0.285
      temp.set(0.055, 1.98, 0).applyEuler(heroEar.rotation).add(heroEar.position).add(field.position)
      kernelHome.copy(temp)
      kernel.position.lerpVectors(kernelHome, kernelFocus, extract)
      kernel.scale.setScalar(0.11 + extract * 0.64)
      kernel.rotation.set(0.06 * extract, 0.08 * extract, -0.43 + extract * 1.12)
      millModel.group.position.set(2.3 * (1 - millEnter) - millExit * 1.6, 0, -0.4 - (1 - millEnter) * 2.2 - millExit * 1.5)
      visibility.mill.set(windowProgress(p, 0.18, 0.22) * (1 - windowProgress(p, 0.385, 0.42)))
      hopper.set(millModel.group.position.x, 1.21, millModel.group.position.z)
      if (feed > 0) {
        arcPosition(kernelFocus, hopper, feed, 0.65 * flourish, kernel.position)
        kernel.scale.setScalar(1 - feed * 0.94)
        kernel.rotation.z += feed * 1.6
      }
      // Grain is hidden by the opaque hopper when the output begins.
      if (p >= 0.281) kernel.visible = false
      const grind = windowProgress(p, 0.268, 0.372, (t) => t * t)
      millModel.rotor.rotation.y = grind * Math.PI * 9 + Math.sin(ambient * 0.35) * 0.014 * bell(grind)
      outlet.copy(millModel.outlet).add(millModel.group.position)
      visibility.top.set(windowProgress(p, 0.205, 0.24) * (1 - windowProgress(p, 0.785, 0.82)))

      const bowlEnter = windowProgress(p, 0.407, 0.444)
      const bowlCenter = windowProgress(p, 0.487, 0.53)
      const bowlExit = windowProgress(p, 0.58, 0.586)
      bowlModel.group.position.set(2.9 - bowlEnter * 1.45 - bowlCenter * 1.45 - bowlExit * 3.2, 0.43, 0.18 - (1 - bowlEnter) * 1.3)
      visibility.bowl.set(windowProgress(p, 0.404, 0.432) * (1 - windowProgress(p, 0.59, 0.615)))
      bowlShadow.position.set(bowlModel.group.position.x, 0.004, 0.18)
      bowlShadow.visible = bowlModel.group.visible
      bowlTarget.copy(bowlModel.group.position).add(temp.set(0, 0.16, 0))
      flour.update(p, ambient, outlet, bowlTarget)
      const fill = windowProgress(p, 0.442, 0.487)
      const mixing = windowProgress(p, 0.505, 0.57)
      bowlModel.flourSurface.visible = fill > 0 && mixing < 0.38
      bowlModel.flourSurface.scale.setScalar(Math.sqrt(fill) * (1 - mixing * 0.08))
      bowlModel.flourSurface.position.y = -0.18 + fill * 0.38 - mixing * 0.13
      bowlModel.flourSurface.material.opacity = 1 - T.MathUtils.smoothstep(mixing, 0, 0.32)
      bowlModel.flourSurface.material.transparent = mixing > 0.001
      bowlModel.flourSurface.material.depthWrite = mixing < 0.08

      const pouring = windowProgress(p, 0.487, 0.517)
      waterGroup.position.set(bowlModel.group.position.x - 1.12, 1.54 + bell(pouring) * 0.06, 0.16)
      waterGroup.rotation.z = -0.3 - bell(pouring) * 0.72
      visibility.water.set(overlap(p, 0.482, 0.536, 0.012))
      waterStart.set(0.29, 0.27, 0).applyEuler(waterGroup.rotation).add(waterGroup.position)
      waterStream.position.copy(waterStart).add(bowlTarget).multiplyScalar(0.5)
      waterStream.quaternion.setFromUnitVectors(up, temp.copy(waterStart).sub(bowlTarget).normalize())
      waterStream.scale.set(1, waterStart.distanceTo(bowlTarget), 1)
      waterStream.visible = pouring > 0.01 && pouring < 0.99
      waterMaterial.opacity = bell(pouring) * 0.58
      const season = windowProgress(p, 0.5, 0.523, (t) => t)
      visibility.additions.set(overlap(p, 0.498, 0.526, 0.008))
      additionSeeds.forEach((seed) => {
        const t = clamp01((season - seed.delay) / 0.55)
        seed.mesh.position.set(bowlTarget.x + seed.x, bowlTarget.y + 0.88 * (1 - t * t), bowlTarget.z + seed.z)
      })

      const stir = windowProgress(p, 0.49, 0.56, (t) => t)
      const angle = stir * Math.PI * 5
      const resistance = windowProgress(p, 0.535, 0.562)
      spoon.position.set(bowlTarget.x + Math.cos(angle) * (0.48 - resistance * 0.15), 0.66 + mixing * 0.06, bowlTarget.z + Math.sin(angle) * 0.32)
      spoon.rotation.set(-0.2 + Math.sin(angle) * 0.12, angle, -0.34 + resistance * 0.15)
      spoon.position.y += windowProgress(p, 0.554, 0.583) * 1.5
      visibility.spoon.set(overlap(p, 0.493, 0.59, 0.012))

      // Topology is shared from the first cohesive mixture through the final loaf.
      dough.mesh.visible = p > 0.505
      dough.apply(p)
      dough.mesh.material.opacity = windowProgress(p, 0.505, 0.533)
      dough.mesh.material.depthWrite = dough.mesh.material.opacity > 0.98
      doughInBowl.set(p < 0.565 ? bowlModel.group.position.x : 0, 0.48, 0.18)
      const liftOut = windowProgress(p, 0.565, 0.6)
      arcPosition(doughInBowl, doughOnBoard, liftOut, 0.86, dough.mesh.position)
      const knead = windowProgress(p, 0.6, 0.675, (t) => t)
      dough.mesh.rotation.set(0, Math.sin(knead * Math.PI * 3) * bell(knead) * 0.06, 0)

      const basketEnter = windowProgress(p, 0.665, 0.682)
      const basketPlace = windowProgress(p, 0.681, 0.705)
      basket.position.set(1.5 * (1 - basketEnter) + 2.7 * (1 - windowProgress(p, 0.69, 0.702)), 0, 0.12)
      visibility.basket.set(overlap(p, 0.665, 0.807, 0.013))
      if (p >= 0.681) arcPosition(doughOnBoard, doughInBasket, basketPlace, 0.75, dough.mesh.position)
      const proofMotePresence = overlap(p, 0.69, 0.795, 0.018)
      proofMotes.visible = proofMotePresence > 0.002
      proofMoteMaterial.opacity = proofMotePresence * 0.22
      proofMoteSeeds.forEach((seed, index) => {
        const driftTime = currentQuality.reducedMotion ? 0.35 : ambient
        proofMotePositions[index * 3] = seed.x + Math.sin(driftTime * 0.18 + seed.phase) * 0.08
        proofMotePositions[index * 3 + 1] = seed.y + Math.sin(driftTime * 0.11 + seed.phase) * 0.09
        proofMotePositions[index * 3 + 2] = seed.z + Math.cos(driftTime * 0.16 + seed.phase) * 0.05
      })
      proofMoteGeometry.attributes.position.needsUpdate = true

      const ovenEnter = windowProgress(p, 0.75, 0.786)
      const ovenExit = windowProgress(p, 0.929, 0.977)
      ovenModel.group.position.set(0, 0, -1.4 - 2.8 * (1 - ovenEnter) - ovenExit * 2.8)
      visibility.oven.set(windowProgress(p, 0.75, 0.777) * (1 - windowProgress(p, 0.95, 0.985)))
      const intoOven = windowProgress(p, 0.779, 0.817)
      if (p >= 0.779) {
        arcPosition(doughInBasket, ovenDestination, intoOven, 0.62, dough.mesh.position)
        basket.position.x = -windowProgress(p, 0.787, 0.809) * 2.8
      }
      const peelIn = windowProgress(p, 0.783, 0.802)
      peel.position.set(0, 0.053, -1.4 + 2.7 * (1 - peelIn))
      visibility.peel.set(overlap(p, 0.782, 0.835, 0.013))
      peel.position.z += windowProgress(p, 0.814, 0.837) * 3
      const glow = windowProgress(p, 0.782, 0.826) * (1 - ovenExit)
      ovenModel.glow.material.opacity = glow * (0.3 + Math.sin(ambient * 3.1) * 0.025)
      ovenModel.embers.forEach((ember, index) => {
        const flicker = 0.86 + Math.sin(ambient * (1.7 + index * 0.07) + ember.userData.phase) * 0.13 + Math.sin(ambient * 3.3 + index) * 0.05
        ember.material.emissiveIntensity = glow * (0.38 + flicker * 0.44)
        const coalScale = 0.92 + glow * flicker * 0.12
        ember.scale.set(coalScale, coalScale * 0.58, coalScale * 0.84)
      })

      const finish = windowProgress(p, 0.917, 0.967)
      finalBoard.position.set(0, 0, 3.1 * (1 - finish) + 0.48)
      visibility.final.set(windowProgress(p, 0.914, 0.94))
      if (p >= 0.917) arcPosition(ovenDestination, finalDestination, finish, 0.3 * flourish, dough.mesh.position)
      dough.mesh.rotation.y += finish * -0.12
      const knifeDescent = windowProgress(p, 0.974, 0.993)
      const knifeCut = windowProgress(p, 0.989, 0.997)
      const knifeExit = windowProgress(p, 0.996, 1)
      knife.position.set(0.78 + knifeExit * 0.92, 1.78 - knifeDescent * 0.82 - knifeCut * 0.23 + knifeExit * 0.32, 0.49 + (1 - knifeDescent) * 0.14)
      knife.rotation.set(0.04, -0.08 + knifeExit * 0.18, -0.18 + knifeDescent * 0.08 + knifeExit * 0.28)
      visibility.knife.set(overlap(p, 0.971, 1, 0.006))
      cutDetails.group.visible = knifeCut > 0.002
      cutDetails.slice.position.set(0.88 + knifeCut * 0.32, 0.43 - knifeCut * 0.035, knifeCut * 0.045)
      cutDetails.slice.rotation.z = -knifeCut * 0.1
      cutDetails.crumbs.forEach(({ crumb, delay, x, z }, index) => {
        const fall = clamp01((knifeCut - delay) / 0.42)
        crumb.visible = fall > 0
        crumb.position.set(x + fall * (0.06 + index * 0.006), 0.62 - fall * (0.5 + (index % 3) * 0.035), z + Math.sin(index * 2.3) * fall * 0.08)
        crumb.rotation.set(fall * index, fall * 2.1, fall * 0.7)
      })
      doughShadow.position.set(dough.mesh.position.x, p < 0.779 ? 0.003 : p < 0.917 ? 0.101 : 0.019, dough.mesh.position.z)
      doughShadow.visible = p > 0.598
      doughShadow.material.opacity = 0.65 * (1 - bell(liftOut) * 0.8)
      steam.position.copy(dough.mesh.position)
      steam.visible = p > 0.868 && !currentQuality.reducedMotion
      steamMaterial.opacity = delayed(p, 0.863, 0.918, 0.1) * 0.13
      for (let i = 0; i < 24; i += 1) {
        const life = (ambient * 0.11 + i / 24) % 1
        steamParticles[i * 3] = Math.sin(i * 2.4) * 0.65 + Math.sin(ambient * 0.35 + i) * life * 0.1
        steamParticles[i * 3 + 1] = 0.92 + life * 0.55
        steamParticles[i * 3 + 2] = Math.cos(i * 1.3) * 0.22
      }
      steamGeometry.attributes.position.needsUpdate = true
    },
  }
}

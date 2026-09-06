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

function surface(kind: 'wood' | 'stone' | 'flour' | 'crust', anisotropy: number) {
  const cached = textureCache.get(kind)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const context = canvas.getContext('2d')!
  context.fillStyle = { wood: '#f1ece2', stone: '#e5e4df', flour: '#fffdf9', crust: '#eee8dd' }[kind]
  context.fillRect(0, 0, 512, 512)

  const noise = createRandom(kind.length * 431)
  for (let i = 0; i < 7000; i += 1) {
    const x = noise() * 512
    const y = noise() * 512
    const alpha = kind === 'flour' ? noise() * 0.055 : 0.035 + noise() * 0.1
    context.fillStyle = noise() > 0.5 ? `rgba(255,247,226,${alpha})` : `rgba(38,22,10,${alpha * 0.8})`
    context.fillRect(x, y, kind === 'wood' ? 10 + noise() * 80 : 1 + noise() * 3, kind === 'wood' ? 0.7 : 1 + noise() * 2)
  }

  if (kind === 'wood') {
    for (let i = 0; i < 42; i += 1) {
      const y = noise() * 512
      context.strokeStyle = `rgba(63,31,12,${0.08 + noise() * 0.12})`
      context.lineWidth = 1 + noise() * 2
      context.beginPath()
      context.moveTo(-20, y)
      context.bezierCurveTo(150, y - 16, 350, y + 20, 532, y + noise() * 14)
      context.stroke()
    }
  }

  const texture = new T.CanvasTexture(canvas)
  texture.colorSpace = T.SRGBColorSpace
  texture.wrapS = texture.wrapT = T.RepeatWrapping
  texture.anisotropy = anisotropy
  textureCache.set(kind, texture)
  return texture
}

function mat(color: T.ColorRepresentation, quality: QualityConfig, kind?: 'wood' | 'stone' | 'flour' | 'crust', options: T.MeshStandardMaterialParameters = {}) {
  return new T.MeshStandardMaterial({
    color,
    roughness: 0.84,
    metalness: 0.01,
    transparent: true,
    ...(kind ? { map: surface(kind, quality.anisotropy), bumpMap: surface(kind, quality.anisotropy), bumpScale: kind === 'stone' ? 0.028 : 0.009 } : {}),
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

function board(parent: T.Object3D, quality: QualityConfig, width = 3.9, depth = 2.7) {
  return mesh(roundBox(width, depth, 0.13), mat(0xf0d1a0, quality, 'wood'), parent, 0, -0.16, 0)
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
  private readonly wet = new T.Color(0xe2c18e)
  private readonly crust = new T.Color(PALETTE.bread)
  private readonly toasted = new T.Color(PALETTE.crust)
  private readonly cut = new T.Color(0xefc58b)

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
    const width = 0.76 + mixing * 0.13 + shaping * 0.11 + proof * 0.13 + spring * 0.07
    const height = 0.1 + mixing * 0.57 + proof * 0.22 + spring * 0.1
    const depth = 0.66 + mixing * 0.04 + proof * 0.07
    const stirAngle = windowProgress(p, 0.49, 0.56, (t) => t) * Math.PI * 5
    for (let i = 0; i < this.position.count; i += 1) {
      const x = this.original[i * 3]
      const y = this.original[i * 3 + 1]
      const z = this.original[i * 3 + 2]
      const crown = Math.max(0, y)
      const foot = Math.max(0, (y + 0.64) / 1.64)
      const localPress = Math.exp(-Math.pow((x - Math.sin(knead * Math.PI * 3) * 0.4) / 0.42, 2)) * pressure
      const wetFold = Math.sin(x * 8 + z * 6 - stirAngle) * crown * mixing * (1 - mixing) * 0.15
      const kneadFold = Math.sin(x * 7 + knead * 8) * localPress * crown * 0.06
      const asymmetry = 1 + proof * 0.035 * Math.sin(x * 2 + z * 3)
      let py = foot * height * asymmetry - localPress * crown * 0.19 + wetFold + kneadFold
      const px = x * width * (1 + pressure * 0.16)
      const pz = z * depth * (1 - pressure * 0.08)
      const cutLine = px + pz * 0.42
      let groove = 0
      for (const center of [-0.59, 0, 0.59]) {
        const width = 0.016 + spring * 0.052
        groove = Math.max(groove, Math.exp(-Math.pow((cutLine - center) / width, 2)))
      }
      const cutMask = windowProgress(y, 0.24, 0.62) * (1 - windowProgress(Math.abs(z), 0.66, 0.93))
      groove *= cutMask * scoring
      py -= groove * (0.035 + spring * 0.064)
      const irregular = Math.sin(px * 21 + pz * 13) * Math.sin(pz * 31 - px * 9)
      py += crown * baking * irregular * 0.007
      this.position.setXYZ(i, px, Math.max(0, py), pz)

      this.color.copy(this.pale).lerp(this.wet, mixing * 0.55)
      const brownVariation = clamp01(0.82 + x * 0.12 - z * 0.09 + irregular * 0.035)
      this.color.lerp(this.crust, baking * brownVariation)
      this.color.lerp(this.toasted, baking * (1 - crown) * 0.42)
      this.color.lerp(this.cut, groove * baking * 0.95)
      const flour = Math.max(0, Math.sin(px * 13 + pz * 8) * Math.sin(pz * 19 - px * 3) - 0.28)
      this.color.lerp(this.pale, flour * crown * baking * (1 - groove) * 0.38)
      this.colors.setXYZ(i, this.color.r, this.color.g, this.color.b)
    }
    this.mesh.material.roughness = 0.97 - mixing * 0.07 + baking * 0.08
    this.position.needsUpdate = this.colors.needsUpdate = true
    this.mesh.geometry.computeVertexNormals()
  }
}

type FlourParticle = { x: number; y: number; z: number; delay: number; phase: number }

class FlourSystem {
  readonly group = new T.Group()
  readonly pile: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
  private readonly points: T.Points<T.BufferGeometry, T.ShaderMaterial>
  private readonly particles: FlourParticle[] = []
  private readonly positions: T.BufferAttribute
  private readonly alphas: T.BufferAttribute
  private readonly source = new T.Vector3()
  private readonly destination = new T.Vector3()

  constructor(quality: QualityConfig) {
    this.group.name = 'milling-output'
    const count = quality.flourCount
    const geometry = new T.BufferGeometry()
    this.positions = new T.BufferAttribute(new Float32Array(count * 3), 3)
    this.alphas = new T.BufferAttribute(new Float32Array(count), 1)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random())
      this.particles.push({ x: Math.cos(angle) * radius * 0.78, y: (1 - radius) * 0.44, z: Math.sin(angle) * radius * 0.54, delay: random(), phase: random() * Math.PI * 2 })
      sizes[i] = 0.45 + random() * 0.9
    }
    geometry.setAttribute('position', this.positions)
    geometry.setAttribute('alpha', this.alphas)
    geometry.setAttribute('size', new T.BufferAttribute(sizes, 1))
    const pointMaterial = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { tint: { value: new T.Color(PALETTE.flour) }, pixelRatio: { value: quality.dpr } },
      vertexShader: `attribute float alpha; attribute float size; varying float vAlpha;
        uniform float pixelRatio;
        void main(){ vAlpha=alpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_Position=projectionMatrix*mv; gl_PointSize=clamp(size*18.0*pixelRatio/-mv.z,1.0,8.0); }`,
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
    const pileGeometry = new T.SphereGeometry(1, 48, 24)
    const pos = pileGeometry.attributes.position
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const radius = Math.sqrt(x * x + z * z)
      pos.setXYZ(i, x * 0.83, y < 0 ? 0 : Math.pow(1 - Math.min(1, radius), 0.86) * 0.56 * (1 + Math.sin(x * 5 + z * 7) * 0.035), z * 0.58)
    }
    pileGeometry.computeVertexNormals()
    this.pile = mesh(pileGeometry, mat(PALETTE.flour, quality, 'flour', { roughness: 1 }), this.group)
    this.pile.name = 'flour-pile'
  }

  update(p: number, time: number, outlet: T.Vector3, bowlTarget: T.Vector3) {
    const emitted = windowProgress(p, 0.283, 0.386, (t) => t)
    const transfer = windowProgress(p, 0.437, 0.487, (t) => t)
    const amount = windowProgress(p, 0.296, 0.39) * (1 - windowProgress(p, 0.44, 0.486))
    this.group.visible = p >= 0.282 && p <= 0.49
    this.pile.position.set(-0.65, 0, 0.85)
    this.pile.scale.setScalar(Math.max(0.001, Math.cbrt(amount)))
    this.pile.visible = amount > 0.0001
    if (!this.group.visible) return
    this.particles.forEach((particle, i) => {
      const flow = clamp01((emitted - particle.delay * 0.72) / 0.28)
      const pour = clamp01((transfer - particle.delay * 0.65) / 0.35)
      this.source.copy(outlet)
      this.destination.set(-0.65 + particle.x, particle.y, 0.85 + particle.z)
      const fall = flow * flow
      temp.lerpVectors(this.source, this.destination, fall)
      let alpha = flow > 0 && flow < 1 ? 0.62 : 0
      if (transfer > 0) {
        this.source.copy(this.destination)
        this.destination.copy(bowlTarget).add(temp2.set(particle.x * 0.7, particle.y * 0.18, particle.z * 0.68))
        arcPosition(this.source, this.destination, pour, 0.65, temp)
        alpha = pour > 0 && pour < 1 ? 0.7 : 0
      }
      const drift = Math.sin(time * 0.5 + particle.phase) * 0.012 * alpha
      this.positions.setXYZ(i, temp.x + drift, temp.y, temp.z + drift)
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

  const specs = Array.from({ length: count }, () => ({
    x: (random() - 0.5) * 5.8,
    z: -0.8 - random() * 2.35,
    height: 1.2 + random() * 0.72,
    scale: 0.78 + random() * 0.3,
    phase: random() * Math.PI * 2,
    lean: (random() - 0.5) * 0.12,
  }))
  const dummy = new T.Object3D()

  return {
    group,
    update(time) {
      let grainIndex = 0
      let awnIndex = 0
      specs.forEach((spec, index) => {
        const sway = Math.sin(time * 0.62 + spec.phase) * 0.024
        const height = spec.height * spec.scale
        dummy.position.set(spec.x + sway * 0.25, height * 0.5 - 0.03, spec.z)
        dummy.rotation.set(0, 0, spec.lean + sway)
        dummy.scale.set(1, height, 1)
        dummy.updateMatrix()
        stem.setMatrixAt(index, dummy.matrix)

        for (let row = 0; row < 4; row += 1) {
          const y = height * 0.63 + row * 0.105
          for (const side of [-1, 1]) {
            const sideOffset = side * (0.048 - row * 0.002)
            dummy.position.set(spec.x + sway * 0.7 + sideOffset, y, spec.z)
            dummy.rotation.set(0, 0, spec.lean + sway + side * -0.42)
            dummy.scale.set(0.057 - row * 0.002, 0.092 - row * 0.003, 0.06)
            dummy.updateMatrix()
            grain.setMatrixAt(grainIndex, dummy.matrix)
            grainIndex += 1

            dummy.position.set(spec.x + sway * 0.7 + side * 0.082, y + 0.045, spec.z)
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
  const profile = [[0.012, -0.62], [0.12, -0.54], [0.2, -0.3], [0.21, 0], [0.18, 0.29], [0.1, 0.51], [0.012, 0.62]]
  const group = new T.Group()
  const seed = mesh(new T.LatheGeometry(profile.map(([radius, y]) => new T.Vector2(radius, y)), 48), mat(0xd9a84c, quality, 'crust', { roughness: 0.7 }), group)
  seed.scale.setScalar(scale)
  const crease = tube([new T.Vector3(0, -0.45, 0.19), new T.Vector3(0, -0.16, 0.21), new T.Vector3(0, 0.16, 0.21), new T.Vector3(0, 0.45, 0.19)], 0.014, mat(0x8f5d24, quality, undefined, { roughness: 0.92 }), group)
  crease.scale.setScalar(scale)
  return group
}

function mill(quality: QualityConfig) {
  const group = new T.Group()
  const stone = mat(0xc2c0b9, quality, 'stone', { roughness: 0.94 })
  const edge = mat(0xb0a68b, quality, undefined, { roughness: 0.84 })
  const iron = mat(0x393b39, quality, undefined, { metalness: 0.6, roughness: 0.45 })
  const rotor = new T.Group()
  rotor.position.y = 0.62
  group.add(rotor)
  mesh(new T.CylinderGeometry(1.18, 1.22, 0.35, 32), stone, group, 0, 0.2, 0)
  mesh(new T.CylinderGeometry(1.17, 1.18, 0.42, 32), stone, rotor)
  ring(1.18, 0.016, iron, rotor, -0.19)
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2
    rod(new T.Vector3(Math.cos(angle) * 0.31, 0.214, Math.sin(angle) * 0.31), new T.Vector3(Math.cos(angle + 0.23) * 1.1, 0.214, Math.sin(angle + 0.23) * 1.1), 0.009, edge, rotor)
  }
  rod(new T.Vector3(0, 0.72, 0), new T.Vector3(0, 1.72, 0), 0.048, iron, group)
  rod(new T.Vector3(0, 1.08, 0), new T.Vector3(0.8, 1.08, 0), 0.048, iron, rotor)
  rod(new T.Vector3(0.8, 1.06, 0), new T.Vector3(0.8, 1.43, 0), 0.085, mat(0xb68b50, quality, 'wood'), rotor)
  const funnel = mesh(new T.CylinderGeometry(0.47, 0.13, 0.55, 4, 1, true), mat(0xc79451, quality, 'wood', { side: T.DoubleSide }), group, 0, 1.32, 0)
  funnel.rotation.y = Math.PI / 4
  mesh(new T.CylinderGeometry(0.26, 0.26, 0.025, 32), mat(0xd7a556, quality), group, 0, 1.47, 0)
  const outlet = new T.Vector3(0.25, 0.2, 1.12)
  mesh(roundBox(0.38, 0.8, 0.06, 0.04), mat(0xb68b50, quality, 'wood'), group, outlet.x, outlet.y, outlet.z).rotation.x = 0.2
  return { group, rotor, outlet }
}

function bowl(quality: QualityConfig) {
  const group = new T.Group()
  const profile = [[0.48, -0.42], [0.82, -0.36], [1.16, -0.14], [1.3, 0.18], [1.25, 0.4], [1.08, 0.52], [0.96, 0.48], [1.0, 0.28], [0.9, 0.02], [0.72, -0.18], [0.44, -0.27]]
  mesh(new T.LatheGeometry(profile.map(([radius, y]) => new T.Vector2(radius, y)), 48), mat(0xd9e4df, quality, undefined, { roughness: 0.38 }), group)
  const flourSurface = mesh(new T.CircleGeometry(0.94, 32), mat(PALETTE.flour, quality, 'flour', { roughness: 1 }), group, 0, 0.39, 0)
  flourSurface.rotation.x = -Math.PI / 2
  const rim = ring(1.14, 0.035, mat(0xeff0e5, quality, undefined, { roughness: 0.32 }), group, 0.48)
  rim.scale.set(1, 0.98, 1)
  return { group, flourSurface }
}

function jug(quality: QualityConfig) {
  const group = new T.Group()
  group.position.set(-1.25, 1.47, -0.08)
  group.rotation.z = -0.6
  const glass = mat(0xbbd9df, quality, undefined, { transparent: true, opacity: 0.42, roughness: 0.16, metalness: 0.15, side: T.DoubleSide, depthWrite: false })
  mesh(new T.CylinderGeometry(0.3, 0.25, 0.62, 32, 1, true), glass, group)
  ring(0.3, 0.019, glass, group, 0.31)
  const handle = mesh(new T.TorusGeometry(0.2, 0.037, 12, 32), glass, group, -0.36, 0, 0)
  handle.scale.x = 0.75
  mesh(new T.CylinderGeometry(0.265, 0.235, 0.36, 32), mat(0x8dbfc9, quality, undefined, { transparent: true, opacity: 0.58, roughness: 0.15 }), group, 0, -0.09, 0)
  return group
}

function proofBasket(quality: QualityConfig) {
  const group = new T.Group()
  const wicker = mat(0xd2ac76, quality, 'wood', { roughness: 0.9 })
  for (let i = 0; i < 13; i += 1) ring(0.77 + i * 0.024, 0.031, wicker, group, 0.05 + i * 0.035)
  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * Math.PI * 2
    rod(new T.Vector3(Math.cos(angle) * 0.79, 0.055, Math.sin(angle) * 0.79), new T.Vector3(Math.cos(angle) * 1.064, 0.48, Math.sin(angle) * 1.064), 0.009, mat(0x96734b, quality, 'wood', { roughness: 0.95 }), group)
  }
  return group
}

function oven(quality: QualityConfig) {
  const group = new T.Group()
  const brick = mat(0xac7860, quality, 'stone', { roughness: 0.88 })
  const mortar = mat(0x50443c, quality, undefined, { roughness: 0.92 })
  const dark = mat(0x120806, quality, undefined, { roughness: 0.98 })
  mesh(roundBox(3.8, 2.65, 0.18), mortar, group, 0, -0.18, 0)
  mesh(new T.BoxGeometry(3.5, 2.1, 0.2), dark, group, 0, 1.0, -0.8)
  mesh(new T.BoxGeometry(0.55, 1.2, 1.55), mortar, group, -1.47, 0.6, -0.12)
  mesh(new T.BoxGeometry(0.55, 1.2, 1.55), mortar, group, 1.47, 0.6, -0.12)
  for (const side of [-1, 1]) for (let row = 0; row < 4; row += 1) mesh(new T.BoxGeometry(0.51, 0.275, 0.22), brick, group, side * 1.47, 0.16 + row * 0.3, 0.69)
  for (let i = 0; i < 13; i += 1) {
    const a = (i / 13) * Math.PI + 0.005
    const b = ((i + 1) / 13) * Math.PI - 0.005
    const wedge = new T.Shape()
    wedge.moveTo(Math.cos(a) * 1.2, 1.17 + Math.sin(a) * 0.94)
    wedge.lineTo(Math.cos(a) * 1.745, 1.17 + Math.sin(a) * 1.39)
    wedge.lineTo(Math.cos(b) * 1.745, 1.17 + Math.sin(b) * 1.39)
    wedge.lineTo(Math.cos(b) * 1.2, 1.17 + Math.sin(b) * 0.94)
    wedge.closePath()
    mesh(new T.ExtrudeGeometry(wedge, { depth: 1.5, bevelEnabled: false }), brick, group, 0, 0, -0.86)
  }
  mesh(new T.BoxGeometry(2.45, 0.12, 1.5), mat(0x8e7660, quality, 'stone'), group, 0, 0.04, 0.01)
  const glow = mesh(new T.PlaneGeometry(2.2, 0.65), mat(0x722711, quality, undefined, { emissive: PALETTE.ember, emissiveIntensity: 0.4, opacity: 0, depthWrite: false }), group, 0, 0.42, -0.68)
  glow.castShadow = false
  // All oven surfaces share the same 0.10 contact height.
  for (let i = 0; i < 9; i += 1) {
    mesh(new T.IcosahedronGeometry(0.065 + random() * 0.035, 1), mat(0xa13110, quality, undefined, {
      emissive: 0xef631e, emissiveIntensity: 0.9, roughness: 1,
    }), group, -0.9 + i * 0.22, 0.16, -0.58)
  }
  return { group, glow }
}

function contactShadow(parent: T.Object3D, width: number, depth: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(15,10,5,0.42)')
  gradient.addColorStop(0.55, 'rgba(15,10,5,0.22)')
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
  const heroEar = wheatEar(field, quality, 2.75, 812)
  heroEar.position.set(-0.24, 0, 0.32)
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
  board(worktop, quality, 5.5, 3.7)
  dust(worktop, quality, quality.crumbCount, 1.9, 0.002)
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
  const waterStream = mesh(new T.CylinderGeometry(0.023, 0.03, 1, 10), waterMaterial, group)
  waterStream.name = 'water-stream'

  const additions = new T.Group()
  const additionSeeds: { mesh: T.Mesh; x: number; z: number; delay: number }[] = []
  for (let i = 0; i < 15; i += 1) {
    const piece = mesh(new T.IcosahedronGeometry(i < 10 ? 0.02 : 0.035, 0), mat(i < 10 ? PALETTE.salt : PALETTE.yeast, quality), additions)
    additionSeeds.push({ mesh: piece, x: (random() - 0.5) * 0.65, z: (random() - 0.5) * 0.45, delay: random() * 0.45 })
  }
  group.add(additions)

  const dough = new DoughMorph(group, quality)
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

  const ovenModel = oven(quality)
  ovenModel.group.name = 'oven'
  group.add(ovenModel.group)
  const peel = new T.Group()
  peel.name = 'oven-peel'
  mesh(roundBox(2.65, 1.95, 0.045, 0.25), mat(0xe3be85, quality, 'wood'), peel)
  rod(new T.Vector3(0, 0.005, 0.95), new T.Vector3(0, 0.005, 2.7), 0.055, mat(0xaf854f, quality, 'wood'), peel)
  group.add(peel)

  const finalBoard = new T.Group()
  finalBoard.name = 'final-board'
  board(finalBoard, quality, 3.5, 2.4)
  dust(finalBoard, quality, quality.crumbCount, 1.5)
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
    final: new Visibility(finalBoard),
  }
  const kernelHome = new T.Vector3(-0.185, 2.25, 0.32)
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
      temp.set(0.055, 2.25, 0).applyEuler(heroEar.rotation).add(heroEar.position).add(field.position)
      kernelHome.copy(temp)
      kernel.position.lerpVectors(kernelHome, kernelFocus, extract)
      kernel.scale.setScalar(0.13 + extract * 0.87)
      kernel.rotation.set(0.06 * extract, 0.08 * extract, -0.43 + extract * 1.12)
      millModel.group.position.set(2.8 * (1 - millEnter) - millExit * 1.6, 0, -0.4 - millExit * 1.5)
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
      bowlModel.group.position.set(2.9 - bowlEnter * 1.45 - bowlCenter * 1.45 - bowlExit * 3.2, 0.43, 0.18)
      visibility.bowl.set(windowProgress(p, 0.404, 0.432) * (1 - windowProgress(p, 0.59, 0.615)))
      bowlShadow.position.set(bowlModel.group.position.x, 0.004, 0.18)
      bowlShadow.visible = bowlModel.group.visible
      bowlTarget.copy(bowlModel.group.position).add(temp.set(0, 0.16, 0))
      flour.update(p, ambient, outlet, bowlTarget)
      const fill = windowProgress(p, 0.442, 0.487)
      const mixing = windowProgress(p, 0.505, 0.57)
      bowlModel.flourSurface.visible = fill > 0 && mixing < 1
      bowlModel.flourSurface.scale.setScalar(Math.sqrt(fill) * (1 - mixing * 0.08))
      bowlModel.flourSurface.position.y = -0.18 + fill * 0.38
      bowlModel.flourSurface.material.opacity = 1 - mixing

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

      const finish = windowProgress(p, 0.917, 0.967)
      finalBoard.position.set(0, 0, 3.1 * (1 - finish) + 0.48)
      visibility.final.set(windowProgress(p, 0.914, 0.94))
      if (p >= 0.917) arcPosition(ovenDestination, finalDestination, finish, 0.3 * flourish, dough.mesh.position)
      dough.mesh.rotation.y += finish * -0.12
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

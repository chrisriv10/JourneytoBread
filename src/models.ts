import * as T from 'three'
import {
  arcPosition,
  bell,
  clamp01,
  delayed,
  overlap,
  sampleVectorSplineKeyframes,
  weightedOut,
  windowProgress,
  type SplineKeyframe,
} from './motion'
import type { PointerState, QualityConfig } from './types'
import { PALETTE, pointsMaterial } from './geometry'
import { material as mat, surfaceTextures, type SurfaceTextures } from './materials'

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
const _clipPoint = new T.Vector3()
const _clipNormal = new T.Vector3()
const _clipQuat = new T.Quaternion()
const CONTACT_EPSILON = 0.003

type SupportSurface = {
  object: T.Mesh<T.BufferGeometry, T.Material>
  topY: number
}

function geometryYBounds(geometry: T.BufferGeometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  if (!geometry.boundingBox) throw new Error('Unable to measure geometry bounds')
  return { min: geometry.boundingBox.min.y, max: geometry.boundingBox.max.y }
}

// Construction-time measurement only. Grounding stays deterministic and does
// not pay for Box3 traversal in the render loop.
function measureLocalBottomY(object: T.Object3D) {
  object.updateMatrixWorld(true)
  return new T.Box3().setFromObject(object).min.y
}

function groundedY(surfaceY: number, localBottomY: number) {
  return surfaceY - localBottomY + CONTACT_EPSILON
}

const SCORE_SPECS = [
  { center: -0.52, width: 0.92, depth: 0.94, curve: -0.014, angle: 0.47, length: 0.9, lip: 0.72 },
  { center: 0, width: 1.08, depth: 1.12, curve: 0.018, angle: 0.38, length: 1.0, lip: 1.0 },
  { center: 0.5, width: 0.87, depth: 0.8, curve: -0.011, angle: 0.44, length: 0.82, lip: 0.62 },
] as const

const BAKED_CUT_X = 0.72
const BAKED_SLICE_THICKNESS = 0.1

function createRandom(initial: number) {
  let seed = initial
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

let random = createRandom(4937)

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

function board(parent: T.Object3D, quality: QualityConfig, width = 3.9, depth = 2.7, color: T.ColorRepresentation = 0xc08a55): SupportSurface {
  const geometry = roundBox(width, depth, 0.13)
  const object = mesh(geometry, mat(color, quality, 'wood', { roughness: 0.86, bumpScale: 0.012 }), parent, 0, -0.16, 0)
  object.name = 'wood-work-surface'
  const surfaceY = object.position.y + geometryYBounds(geometry).max
  const grainRandom = createRandom(Math.round(width * depth * 977))
  const grainColor = new T.Color(color).multiplyScalar(0.48)
  const grainMaterial = mat(grainColor, quality, undefined, { roughness: 0.96, transparent: true, opacity: 0.24, depthWrite: false })
  for (let i = 0; i < 13; i += 1) {
    const z = (grainRandom() - 0.5) * depth * 0.76
    const wave = (grainRandom() - 0.5) * 0.045
    const line = tube([
      new T.Vector3(-width * 0.44, surfaceY + 0.001, z),
      new T.Vector3(-width * 0.08, surfaceY + 0.0015, z + wave),
      new T.Vector3(width * 0.2, surfaceY + 0.001, z - wave * 0.45),
      new T.Vector3(width * 0.44, surfaceY + 0.0012, z + wave * 0.3),
    ], 0.0022 + grainRandom() * 0.0014, grainMaterial, parent)
    line.castShadow = line.receiveShadow = false
  }
  return { object, topY: surfaceY }
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

function taperedWaterGeometry() {
  const segments = 18
  const sides = 9
  const positions: number[] = []
  const indices: number[] = []
  for (let segment = 0; segment <= segments; segment += 1) {
    const t = segment / segments
    const y = t - 0.5
    const centerX = Math.sin(t * Math.PI) * 0.022 + Math.sin(t * Math.PI * 2.2) * 0.004
    const centerZ = Math.sin(t * Math.PI * 1.3) * 0.008
    const radius = T.MathUtils.lerp(0.035, 0.018, t) * (1 + Math.sin(t * Math.PI * 3) * 0.045)
    for (let side = 0; side < sides; side += 1) {
      const angle = side / sides * Math.PI * 2
      positions.push(centerX + Math.cos(angle) * radius, y, centerZ + Math.sin(angle) * radius)
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    for (let side = 0; side < sides; side += 1) {
      const nextSide = (side + 1) % sides
      const a = segment * sides + side
      const b = segment * sides + nextSide
      const c = (segment + 1) * sides + side
      const d = (segment + 1) * sides + nextSide
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
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

  constructor(readonly object: T.Object3D, private readonly depthWriteThreshold = 0.96) {
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
      entry.material.depthWrite = entry.depthWrite && opacity > this.depthWriteThreshold
    })
  }
}

// One surface survives mixing, kneading, proofing, oven spring and the final shot.
// All vertex positions are sampled from source coordinates, never last frame's mesh.
class DoughMorph {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
  // World-space clipping plane that opens the loaf at the baked cut plane.
  // Assigned once (no shader recompiles); parked far away until the handoff.
  readonly clipPlane = new T.Plane(new T.Vector3(-1, 0, 0), 1e5)
  private readonly original: Float32Array
  private readonly position: T.BufferAttribute
  private readonly colors: T.BufferAttribute
  private readonly doughSurface: SurfaceTextures
  private readonly crustSurface: SurfaceTextures
  private showingCrustSurface = false
  private lastProgress = -1
  private readonly color = new T.Color()
  private readonly pale = new T.Color(PALETTE.flour)
  private readonly wet = new T.Color(0xd8ae72)
  private readonly proofed = new T.Color(0xe5bb78)
  private readonly crust = new T.Color(0xd79b50)
  private readonly toasted = new T.Color(0x75451f)
  private readonly cut = new T.Color(0xf2d19a)
  private readonly raised = new T.Color(0xffdda0)

  constructor(parent: T.Object3D, quality: QualityConfig) {
    // This is the one persistent hero mesh. A denser crown and end-cap keep
    // the final product-shot silhouette clean without adding any new meshes.
    const widthSegments = quality.mobile ? 84 : quality.tier === 'high' ? 168 : 132
    const heightSegments = quality.mobile ? 42 : quality.tier === 'high' ? 82 : 64
    const geometry = new T.SphereGeometry(1, widthSegments, heightSegments)
    this.position = geometry.attributes.position as T.BufferAttribute
    this.original = new Float32Array(this.position.array)
    this.colors = new T.BufferAttribute(new Float32Array(this.position.count * 3), 3)
    geometry.setAttribute('color', this.colors)
    this.doughSurface = surfaceTextures('dough', quality)
    this.crustSurface = surfaceTextures('crust', quality)
    this.mesh = mesh(geometry, mat(0xffffff, quality, 'dough', {
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      emissive: 0x251207,
      emissiveIntensity: 0.035,
    }), parent)
    this.mesh.name = 'hero-dough-loaf'
    this.mesh.frustumCulled = false
    this.mesh.material.clippingPlanes = [this.clipPlane]
  }

  // Samples the deformed cross-section ring at a dough-local x plane and
  // resamples it into an ordered closed contour. The position attribute must
  // currently hold the baked, uncut state (evaluate apply(1) first).
  sampleCutContour(cutX: number, samples = 72) {
    const band: { angle: number; y: number; z: number }[] = []
    let cy = 0
    let cz = 0
    let count = 0
    for (let i = 0; i < this.position.count; i += 1) {
      if (Math.abs(this.position.getX(i) - cutX) > 0.035) continue
      cy += this.position.getY(i)
      cz += this.position.getZ(i)
      count += 1
    }
    if (count === 0) throw new Error('Baked loaf cross-section band is empty')
    cy /= count
    cz /= count
    for (let i = 0; i < this.position.count; i += 1) {
      if (Math.abs(this.position.getX(i) - cutX) > 0.035) continue
      const y = this.position.getY(i)
      const z = this.position.getZ(i)
      band.push({ angle: Math.atan2(z - cz, y - cy), y, z })
    }
    band.sort((a, b) => a.angle - b.angle)
    const contour: { y: number; z: number }[] = []
    for (let k = 0; k < samples; k += 1) {
      const target = -Math.PI + (k / samples) * Math.PI * 2
      let j = 0
      while (j < band.length - 1 && band[j + 1].angle < target) j += 1
      const a = band[j]
      const b = band[(j + 1) % band.length]
      let span = b.angle - a.angle
      if (span <= 0) span += Math.PI * 2
      let local = target - a.angle
      if (local < 0) local += Math.PI * 2
      const t = span > 0 ? T.MathUtils.clamp(local / span, 0, 1) : 0
      contour.push({ y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
    }
    // The band holds vertices from adjacent sphere rings at slightly different
    // radii; raw angular resampling would zigzag between rings and stripe the
    // slice walls. Two gentle circular smoothing passes remove the quantization
    // ripple while leaving the broad baked curvature untouched.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let k = 0; k < samples; k += 1) {
        const prev = contour[(k - 1 + samples) % samples]
        const next = contour[(k + 1) % samples]
        const point = contour[k]
        point.y += ((prev.y + next.y) * 0.5 - point.y) * 0.5
        point.z += ((prev.z + next.z) * 0.5 - point.z) * 0.5
      }
    }
    return { contour, centroid: { y: cy, z: cz } }
  }

  apply(p: number) {
    if (p === this.lastProgress) return
    this.lastProgress = p
    const mixing = windowProgress(p, 0.502, 0.575)
    const shaping = windowProgress(p, 0.598, 0.692)
    const proof = windowProgress(p, 0.705, 0.778)
    const spring = windowProgress(p, 0.834, 0.885)
    const baking = windowProgress(p, 0.842, 0.925)
    // Scoring is introduced during the shaping beat, then remains part of the
    // baked form. The old finite window accidentally erased every score again
    // before the final product shot.
    const scoring = p < 0.776 ? 0 : windowProgress(p, 0.776, 0.803)
    const knead = windowProgress(p, 0.61, 0.69, (t) => t)
    const pressure = Math.sin(knead * Math.PI * 3) ** 2 * bell(knead)
    const useCrustSurface = baking > 0.28
    if (useCrustSurface !== this.showingCrustSurface) {
      const surface = useCrustSurface ? this.crustSurface : this.doughSurface
      this.mesh.material.map = surface.albedo
      this.mesh.material.bumpMap = surface.height
      this.mesh.material.roughnessMap = surface.roughness
      this.mesh.material.needsUpdate = true
      this.showingCrustSurface = useCrustSurface
    }
    const width = 0.8 + mixing * 0.12 + shaping * 0.2 + proof * 0.18 + spring * 0.14
    const height = 0.08 + mixing * 0.56 + proof * 0.2 + spring * 0.12
    const depth = 0.69 + mixing * 0.045 + proof * 0.06 - baking * 0.018
    const stirAngle = windowProgress(p, 0.492, 0.565, (t) => t) * Math.PI * 5
    // Vessel fit: gather the loaf laterally while it must fit the banneton,
    // peel, and oven mouth; released as oven spring inside the dark oven.
    const vesselFit = windowProgress(p, 0.67, 0.72) * (1 - windowProgress(p, 0.82, 0.93))
    const kerfTravel = windowProgress(p, 0.989, 0.996)
    const kerfFade = 1 - windowProgress(p, 0.9965, 0.9985)
    const kerfTipY = T.MathUtils.lerp(1.05, 0.68, windowProgress(p, 0.989, 0.997))
    for (let i = 0; i < this.position.count; i += 1) {
      const x = this.original[i * 3]
      const y = this.original[i * 3 + 1]
      const z = this.original[i * 3 + 2]
      const crown = Math.max(0, y)
      const crownAmount = clamp01((y + 0.12) / 1.12)
      const foot = Math.max(0, (y + 0.64) / 1.64)
      const localPress = Math.exp(-Math.pow((x - Math.sin(knead * Math.PI * 3) * 0.4) / 0.42, 2)) * pressure
      const wetFold = Math.sin(x * 7.5 + z * 5.5 - stirAngle) * crown * mixing * (1 - mixing) * 0.125
      const kneadFold = Math.sin(x * 6.5 + knead * 8) * localPress * crown * 0.06
      const foldAxis = x + z * 0.32 - T.MathUtils.lerp(-0.3, 0.26, knead)
      const foldRidge = (
        Math.exp(-Math.pow((foldAxis + 0.18) / 0.25, 2)) * 0.145
        - Math.exp(-Math.pow((foldAxis - 0.015) / 0.12, 2)) * 0.082
      ) * crown * bell(knead)
      const wetEdge = Math.sin(x * 4.3 + z * 7.1) * mixing * (1 - mixing) * 0.038
      const taperAmount = proof * 0.045 + spring * 0.18
      // Baked ends: left stays rounder, right tapers further. Never mirrored.
      const endTaper = 1 - taperAmount * (Math.pow(Math.max(0, -x), 1.35) + 1.22 * Math.pow(Math.max(0, x), 1.62))
      const asymmetry = 1 + proof * (0.052 * Math.sin(x * 2.2 + z * 2.7) + x * 0.028 - z * 0.018)
      const proofCrown = proof * crown * (0.024 * Math.sin(x * 3.1 - z * 2.4) + 0.018 * x)
      const proofBubble = proof * crown * (1 - baking * 0.55) * (
        Math.exp(-((x - 0.28) ** 2 + (z + 0.16) ** 2) / 0.038) * 0.012
        + Math.exp(-((x + 0.34) ** 2 + (z - 0.08) ** 2) / 0.052) * 0.009
        + Math.exp(-((x - 0.02) ** 2 + (z - 0.31) ** 2) / 0.034) * 0.007
      )
      const handmadeCrown = baking * crown * (Math.sin(x * 2.7 + z * 3.6) * 0.012 + x * 0.008 - z * 0.006)
      let py = foot * height * asymmetry * endTaper - localPress * crown * 0.225 + wetFold + kneadFold + foldRidge + proofCrown + proofBubble + handmadeCrown
      let px = x * width * (1 + pressure * 0.15) + wetEdge * (0.4 + crown) + shaping * Math.sin(z * 3.2 + y) * 0.018
      let pz = z * depth * endTaper * (1 - pressure * 0.09) + wetEdge * 0.42
      // Baked expansion: full shoulders, gently pinched base, fuller +z flank,
      // slight longitudinal arc and settle lean. Broad terms only, no noise.
      const shoulder = 1 + spring * (crown * 0.064 - (1 - foot) * 0.038)
      px *= shoulder
      pz = pz * shoulder
        + spring * crown * (0.045 * Math.max(0, z) - 0.03 * Math.max(0, -z))
        + spring * 0.04 * Math.sin(x * 1.7 + 0.4)
      const vesselGather = 1 - vesselFit * 0.35
      px *= vesselGather
      pz *= vesselGather
      const crownShape = baking * crown * (0.018 + 0.016 * Math.exp(-((x + 0.08) ** 2 + (z - 0.04) ** 2) / 0.36))
      const baseSettle = baking * Math.max(0, 0.18 - py) * 0.38
    py += spring * crown * (0.02 * Math.sin(x * 4.4 + 0.7) + 0.012 * Math.sin(x * 7.9 - z * 2.2) + x * 0.014) + crownShape - baseSettle
    // No vertex collapsing here: the loaf keeps valid baked topology through
    // the knife travel, and a tracked clipping plane opens it at the handoff.
    let groove = 0
      let scoreCore = 0
      let scoreEdge = 0
      let scoreLip = 0
      for (const score of SCORE_SPECS) {
        const scoreWidth = (0.019 + spring * 0.039) * score.width
        const scoreCutLine = px + pz * score.angle
        const curvedCenter = score.center + Math.sin(pz * 2.7 + score.center * 3.2) * score.curve
        const distance = Math.abs(scoreCutLine - curvedCenter)
        const lengthMask = windowProgress(y, 0.28, 0.66) * (1 - windowProgress(Math.abs(z), 0.57 * score.length, 0.88 * score.length))
        groove = Math.max(groove, Math.exp(-Math.pow(distance / scoreWidth, 2)) * lengthMask)
        scoreCore = Math.max(scoreCore, Math.exp(-Math.pow(distance / (scoreWidth * 0.46), 2)) * score.depth * lengthMask)
        const rim = Math.exp(-Math.pow((distance - scoreWidth * 1.04) / (scoreWidth * 0.72), 2)) * 0.4
        // Baked ear: raised lip on one side of the cut only, strongest centrally.
        const lipDistance = (scoreCutLine - curvedCenter) - scoreWidth * 0.95
        const lip = Math.exp(-Math.pow(lipDistance / (scoreWidth * 0.75), 2)) * score.lip
        scoreEdge = Math.max(scoreEdge, Math.max(rim, lip) * lengthMask)
        scoreLip = Math.max(scoreLip, lip * lengthMask)
      }
      groove *= scoring
      scoreCore *= scoring
      scoreEdge *= scoring
      scoreLip *= scoring
      py -= groove * (0.028 + spring * 0.061)
      py += scoreLip * (0.007 + spring * 0.014)
      const irregular = Math.sin(px * 21 + pz * 13) * Math.sin(pz * 31 - px * 9)
      const blister = Math.max(0, Math.sin(px * 8.6 + pz * 4.9) * Math.cos(pz * 10.2 - px * 3.3) - 0.7)
      // A few hand-placed baked blisters, visible mainly in grazing light.
      const bakeBlister = spring * crown * (
        Math.exp(-((x - 0.42) ** 2 + (z - 0.2) ** 2) / 0.02) * 0.01
        + Math.exp(-((x + 0.15) ** 2 + (z + 0.33) ** 2) / 0.014) * 0.008
      )
      py += crown * baking * (irregular * 0.0055 + blister * 0.008) + bakeBlister
      // Knife kerf: while the blade travels, press a narrow dent into the
      // crust ahead of the cut plane. The clipped-away side carries it off at
      // the handoff; the kept side stays pristine for the cap.
      const kerfCut = clamp01((py - kerfTipY) / 0.1)
        * Math.exp(-Math.pow((px - 0.8) / 0.06, 2)) * kerfTravel * kerfFade
      py -= kerfCut * 0.07
      this.position.setXYZ(i, px, Math.max(0, py), pz)

      this.color.copy(this.pale).lerp(this.wet, mixing * (0.72 - shaping * 0.25))
      // Once shaped, return the dough toward a dry, warm ivory before heat
      // starts coloring it. This keeps the basket-to-oven handoff legible.
      this.color.lerp(this.proofed, shaping * 0.52 + proof * 0.2)
      const bakeVariation = clamp01(0.52 + crownAmount * 0.38 + x * 0.065 - z * 0.12 + irregular * 0.15)
      this.color.lerp(this.crust, baking * bakeVariation)
      const toastMottle = Math.max(0, Math.sin(px * 5.2 + pz * 4.1 + Math.sin(pz * 2.7)) * Math.cos(pz * 6.1 - px * 3.4) - 0.08)
        + 0.5 * Math.max(0, Math.sin(px * 9.7 - pz * 7.3 + 1.4) * Math.sin(pz * 11.2 + px * 5.1) - 0.25)
      this.color.lerp(this.toasted, baking * ((1 - crownAmount) * 0.7 + Math.max(0, z) * 0.055 + scoreCore * 0.19 + toastMottle * crownAmount * 0.06))
      this.color.lerp(this.cut, groove * baking * 0.72)
      this.color.lerp(this.toasted, scoreCore * baking * 0.26)
      this.color.lerp(this.raised, scoreEdge * baking * 0.82)
      this.color.lerp(this.toasted, kerfCut * baking * 0.5)
      this.color.lerp(this.toasted, baking * Math.min(1, bakeBlister * 90) * 0.1)
      const flour = Math.max(0, Math.sin(px * 12 + pz * 7) * Math.sin(pz * 18 - px * 3.5) - 0.34)
      this.color.lerp(this.pale, flour * crownAmount * baking * (1 - groove) * 0.4)
      this.colors.setXYZ(i, this.color.r, this.color.g, this.color.b)
    }
    const wetness = mixing * (1 - shaping)
    this.mesh.material.roughness = Math.min(0.99, 0.96 - wetness * 0.34 + shaping * 0.13 + proof * 0.03 + baking * 0.09)
    this.mesh.material.bumpScale = 0.006 + baking * 0.036
    this.mesh.material.emissiveIntensity = 0.025 + baking * 0.018
    this.position.needsUpdate = this.colors.needsUpdate = true
    this.mesh.geometry.computeVertexNormals()
  }
}

type FlourParticle = {
  angle: number
  radius: number
  delay: number
  phase: number
  weight: number
  near: number
  turbulence: number
}

type FlourPointLayer = {
  points: T.Points<T.BufferGeometry, T.ShaderMaterial>
  positions: T.BufferAttribute
  alphas: T.BufferAttribute
}

function flourPointLayer(
  quality: QualityConfig,
  count: number,
  minSize: number,
  maxSize: number,
  tint: T.ColorRepresentation,
) {
  const geometry = new T.BufferGeometry()
  const positions = new T.BufferAttribute(new Float32Array(count * 3), 3)
  const alphas = new T.BufferAttribute(new Float32Array(count), 1)
  const sizes = new Float32Array(count)
  const shapes = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    sizes[index] = T.MathUtils.lerp(minSize, maxSize, Math.pow(random(), 1.65))
    shapes[index] = random()
  }
  geometry.setAttribute('position', positions)
  geometry.setAttribute('alpha', alphas)
  geometry.setAttribute('size', new T.BufferAttribute(sizes, 1))
  geometry.setAttribute('shape', new T.BufferAttribute(shapes, 1))
  const material = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      tint: { value: new T.Color(tint) },
      pixelRatio: { value: quality.dpr },
    },
    vertexShader: `
      attribute float alpha;
      attribute float size;
      attribute float shape;
      varying float vAlpha;
      varying float vShape;
      uniform float pixelRatio;
      void main() {
        vAlpha = alpha;
        vShape = shape;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * 18.0 * pixelRatio / -mv.z, 0.65, 8.5);
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      varying float vAlpha;
      varying float vShape;
      void main() {
        vec2 point = gl_PointCoord - 0.5;
        float angle = atan(point.y, point.x);
        float irregularEdge = 1.0
          + sin(angle * 5.0 + vShape * 6.283) * 0.12
          + sin(angle * 9.0 - vShape * 4.7) * 0.055;
        float radius = length(point) * 2.0 / irregularEdge;
        if (radius > 1.0) discard;
        float feather = 1.0 - smoothstep(0.28, 1.0, radius);
        float granular = 0.94 + sin((point.x - point.y + vShape) * 31.0) * 0.06;
        gl_FragColor = vec4(tint, vAlpha * feather * granular);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const points = new T.Points(geometry, material)
  points.frustumCulled = false
  return { points, positions, alphas } satisfies FlourPointLayer
}

function flourMoundGeometry(quality: QualityConfig, seed: number) {
  const radialSegments = quality.mobile ? 28 : 48
  const rings = quality.mobile ? 7 : 11
  const localRandom = createRandom(seed)
  const perimeter = Array.from({ length: radialSegments }, () => 0.91 + localRandom() * 0.17)
  const positions: number[] = [0, 0.225, 0]
  const uvs: number[] = [0.5, 0.5]
  const colors: number[] = [1, 0.975, 0.91]
  const indices: number[] = []
  for (let ringIndex = 1; ringIndex <= rings; ringIndex += 1) {
    const radial = ringIndex / rings
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = segment / radialSegments * Math.PI * 2
      const irregularRadius = radial * T.MathUtils.lerp(1, perimeter[segment], Math.pow(radial, 1.5))
      const x = Math.cos(angle) * irregularRadius * 0.96
      const z = Math.sin(angle) * irregularRadius * 0.7
      // A broad, shallow angle-of-repose profile. The low derivative at the
      // center avoids the conical peak that made the old mound look sculpted.
      const broadSlope = Math.pow(Math.max(0, 1 - Math.pow(radial, 1.65)), 1.42) * 0.225
      const granular = (
        Math.sin(angle * 5.1 + radial * 8.2)
        + Math.sin(angle * 9.3 - radial * 5.4) * 0.5
      ) * 0.0045 * (1 - radial)
      positions.push(x, Math.max(0, broadSlope + granular), z)
      uvs.push(0.5 + x * 0.5, 0.5 + z / 1.4)
      const light = 0.9 + (1 - radial) * 0.065 + Math.sin(angle * 4.7 + radial * 7.2) * 0.018
      colors.push(light, light * 0.976, light * 0.92)
    }
  }
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments
    indices.push(0, 1 + next, 1 + segment)
  }
  for (let ringIndex = 1; ringIndex < rings; ringIndex += 1) {
    const innerStart = 1 + (ringIndex - 1) * radialSegments
    const outerStart = innerStart + radialSegments
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments
      const a = innerStart + segment
      const b = innerStart + next
      const c = outerStart + segment
      const d = outerStart + next
      indices.push(a, b, c, b, d, c)
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

class FlourSystem {
  readonly group = new T.Group()
  readonly pile = new T.Group()
  private readonly mound: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
  private readonly moundMaterial: T.MeshStandardMaterial
  private readonly settledDust: T.InstancedMesh
  private readonly pileShadow: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>
  private readonly grinding: FlourPointLayer
  private readonly stream: FlourPointLayer
  private readonly impact: FlourPointLayer
  private readonly grindingParticles: FlourParticle[] = []
  private readonly streamParticles: FlourParticle[] = []
  private readonly impactParticles: FlourParticle[] = []
  private readonly haze: { sprite: T.Sprite; material: T.SpriteMaterial; phase: number; near: number; scale: number }[] = []
  private readonly source = new T.Vector3()
  private readonly destination = new T.Vector3()

  constructor(quality: QualityConfig) {
    this.group.name = 'milling-output'
    const grindingCount = quality.mobile ? 56 : quality.tier === 'high' ? 150 : 96
    const streamCount = Math.floor(quality.flourCount * 0.64)
    const impactCount = Math.max(120, quality.flourCount - streamCount - grindingCount)
    this.grinding = flourPointLayer(quality, grindingCount, 0.4, 1.12, 0xd9c49d)
    this.stream = flourPointLayer(quality, streamCount, 0.38, 1.38, 0xe4d5b9)
    this.impact = flourPointLayer(quality, impactCount, 0.4, 1.48, 0xd8c5a7)
    this.group.add(this.grinding.points, this.stream.points, this.impact.points)

    for (let index = 0; index < grindingCount; index += 1) {
      this.grindingParticles.push({
        angle: Math.PI * (0.3 + random() * 0.4),
        // Keep the first dust tight to the exposed front half of the stone gap.
        // Particles inside the stone radius were physically plausible but almost
        // entirely occluded, so the grinding beat did not read on screen.
        radius: 1.155 + random() * 0.115,
        delay: random(),
        phase: random() * Math.PI * 2,
        weight: Math.pow(random(), 0.95),
        near: random(),
        turbulence: 0.003 + random() * 0.009,
      })
    }
    for (let index = 0; index < streamCount; index += 1) {
      this.streamParticles.push({
        angle: random() * Math.PI * 2,
        radius: Math.pow(random(), 2.15),
        delay: random(),
        phase: random(),
        weight: Math.pow(random(), 1.55),
        near: random(),
        turbulence: 0.004 + random() * 0.014,
      })
    }
    for (let index = 0; index < impactCount; index += 1) {
      this.impactParticles.push({
        angle: random() * Math.PI * 2,
        radius: Math.sqrt(random()),
        delay: random(),
        phase: random(),
        weight: Math.pow(random(), 1.45),
        near: random(),
        turbulence: 0.008 + random() * 0.02,
      })
    }

    const hazeCanvas = document.createElement('canvas')
    hazeCanvas.width = hazeCanvas.height = 96
    const hazeContext = hazeCanvas.getContext('2d')!
    const hazeGradient = hazeContext.createRadialGradient(44, 51, 3, 48, 48, 47)
    hazeGradient.addColorStop(0, 'rgba(255,248,230,0.7)')
    hazeGradient.addColorStop(0.38, 'rgba(246,235,211,0.29)')
    hazeGradient.addColorStop(1, 'rgba(238,224,198,0)')
    hazeContext.fillStyle = hazeGradient
    hazeContext.fillRect(0, 0, 96, 96)
    const hazeTexture = new T.CanvasTexture(hazeCanvas)
    hazeTexture.colorSpace = T.SRGBColorSpace
    const hazeCount = quality.mobile ? 3 : 6
    const veilCount = quality.mobile ? 1 : 2
    for (let i = 0; i < hazeCount; i += 1) {
      const material = new T.SpriteMaterial({
        map: hazeTexture,
        color: new T.Color().setHSL(0.105 + i * 0.0025, 0.26, 0.86 + (i % 3) * 0.02),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: i >= veilCount,
      })
      const sprite = new T.Sprite(material)
      sprite.frustumCulled = false
      sprite.renderOrder = i < veilCount ? 12 : 0
      this.group.add(sprite)
      this.haze.push({ sprite, material, phase: random() * Math.PI * 2, near: random(), scale: 0.62 + random() * 0.68 })
    }
    const pileGeometry = flourMoundGeometry(quality, 7301)
    this.moundMaterial = mat(0xe7dcc4, quality, 'flour', { roughness: 1, bumpScale: 0.003, vertexColors: true })
    this.mound = mesh(pileGeometry, this.moundMaterial, this.pile)
    this.mound.name = 'flour-pile-mound'
    this.mound.castShadow = false
    this.pile.name = 'flour-pile'
    this.group.add(this.pile)
    this.settledDust = dust(this.pile, quality, quality.mobile ? 22 : 38, 0.76, CONTACT_EPSILON)
    const settledMaterial = this.settledDust.material as T.MeshStandardMaterial
    settledMaterial.transparent = true
    settledMaterial.opacity = 0
    settledMaterial.depthWrite = false
    this.pileShadow = contactShadow(this.group, 1.45, 0.95)
    this.pileShadow.material.opacity = 0.1
  }

  update(
    p: number,
    time: number,
    outlet: T.Vector3,
    receivingPoint: T.Vector3,
    millCenter: T.Vector3,
    stoneRotation: number,
  ) {
    const grinding = windowProgress(p, 0.274, 0.31) * (1 - windowProgress(p, 0.41, 0.442))
    const streamBuild = windowProgress(p, 0.304, 0.356, (value) => value * value * (2 - value))
    const streamPresence = streamBuild * (1 - windowProgress(p, 0.416, 0.447))
    const impactBuild = windowProgress(p, 0.326, 0.405)
    const atmosphere = windowProgress(p, 0.342, 0.418) * (1 - windowProgress(p, 0.463, 0.505))
    const transitionVeil = windowProgress(p, 0.397, 0.432) * (1 - windowProgress(p, 0.448, 0.486))
    const pileRadiusGrowth = windowProgress(p, 0.326, 0.413, (value) => value * value * (2 - value))
    const pileHeightGrowth = windowProgress(p, 0.332, 0.402, (value) => value * value * (3 - 2 * value))
    const pileFade = 1 - windowProgress(p, 0.414, 0.444)
    const pilePresence = pileRadiusGrowth * pileFade
    this.group.visible = p >= 0.27 && p <= 0.51
    this.pile.position.copy(receivingPoint)
    const footprint = T.MathUtils.lerp(0.11, 0.42, Math.pow(pileRadiusGrowth, 0.62))
    const moundHeight = T.MathUtils.lerp(0.01, 0.155, Math.pow(pileHeightGrowth, 0.92)) * (1 + streamPresence * 0.035)
    this.mound.scale.set(Math.max(0.001, footprint), Math.max(0.001, moundHeight / 0.225), Math.max(0.001, footprint))
    this.moundMaterial.transparent = pileFade < 0.999
    this.moundMaterial.opacity = pileFade
    this.moundMaterial.depthWrite = pileFade > 0.96
    const dustSpread = T.MathUtils.lerp(0.22, 1, Math.pow(pileRadiusGrowth, 0.58))
    this.settledDust.scale.set(dustSpread, 1, dustSpread)
    ;(this.settledDust.material as T.MeshStandardMaterial).opacity = pileFade * (0.1 + pileRadiusGrowth * 0.25)
    this.pile.visible = pilePresence > 0.002
    this.pileShadow.position.set(receivingPoint.x - 0.018, receivingPoint.y + 0.002, receivingPoint.z - 0.032)
    const pileShadowScale = Math.max(0.001, 0.24 + pileRadiusGrowth * 0.58)
    this.pileShadow.scale.set(pileShadowScale * 1.02, pileShadowScale * 0.88, 1)
    this.pileShadow.visible = this.pile.visible
    this.pileShadow.material.opacity = pilePresence * 0.1
    if (!this.group.visible) return

    this.grindingParticles.forEach((particle, index) => {
      // Stay near the visible feed/output side of the seam. The stone-driven
      // phase keeps the dust alive without making it orbit like sparks.
      const angle = particle.angle + Math.sin(stoneRotation * 0.42 + particle.phase) * (0.035 + particle.weight * 0.085)
      const flutter = Math.sin(time * (0.8 + particle.weight * 0.7) + particle.phase) * particle.turbulence
      const radius = particle.radius + flutter + grinding * particle.weight * 0.045
      const lift = grinding * particle.weight * 0.052
      this.grinding.positions.setXYZ(
        index,
        millCenter.x + Math.cos(angle) * radius,
        millCenter.y + 0.408 + lift + (particle.near - 0.5) * 0.038 + Math.sin(particle.phase + stoneRotation) * 0.012,
        millCenter.z + Math.sin(angle) * radius,
      )
      this.grinding.alphas.setX(index, grinding * (0.075 + particle.weight * 0.25))
    })
    this.grinding.positions.needsUpdate = this.grinding.alphas.needsUpdate = true

    this.source.copy(outlet)
    this.streamParticles.forEach((particle, index) => {
      const active = streamBuild >= particle.delay * 0.88 ? 1 : 0
      const cycle = ((particle.phase + p * (17 + particle.weight * 7)) % 1 + 1) % 1
      const fall = cycle
      const spread = (0.015 + particle.radius * 0.14) * (0.3 + fall * 0.7)
      this.destination.set(
        receivingPoint.x + Math.cos(particle.angle) * spread,
        receivingPoint.y + 0.012 + particle.weight * 0.012,
        receivingPoint.z + Math.sin(particle.angle) * spread * 0.72,
      )
      temp.lerpVectors(this.source, this.destination, fall)
      temp.y = this.source.y + (this.destination.y - this.source.y) * fall * fall
      const turbulence = Math.sin(particle.phase * 21 + fall * 7.2 + time * 0.28) * particle.turbulence * fall
      temp.x += turbulence
      temp.z += Math.cos(particle.phase * 17 + fall * 5.4) * particle.turbulence * fall * 0.62
      const edgeFade = windowProgress(fall, 0, 0.08) * (1 - windowProgress(fall, 0.9, 1))
      this.stream.positions.setXYZ(index, temp.x, temp.y, temp.z)
      this.stream.alphas.setX(index, active * streamPresence * edgeFade * (0.24 + particle.weight * 0.48))
    })
    this.stream.positions.needsUpdate = this.stream.alphas.needsUpdate = true

    const impactPresence = Math.max(streamPresence * 0.72, atmosphere * 0.58, transitionVeil * 0.42)
    this.impactParticles.forEach((particle, index) => {
      const cycle = ((particle.phase + p * (10 + particle.weight * 4)) % 1 + 1) % 1
      const rise = Math.sin(cycle * Math.PI)
      const depthPass = transitionVeil * Math.pow(particle.near, 1.55)
      const radial = particle.radius * (0.035 + impactBuild * 0.62 + depthPass * 0.82) * Math.sqrt(cycle)
      const drift = Math.sin(time * 0.2 + particle.phase * 11) * particle.turbulence * atmosphere
      this.impact.positions.setXYZ(
        index,
        receivingPoint.x + Math.cos(particle.angle) * radial + drift,
        receivingPoint.y + 0.014 + rise * (0.04 + impactBuild * (0.16 + particle.near * 0.3)) + depthPass * (0.12 + particle.near * 0.76),
        receivingPoint.z + Math.sin(particle.angle) * radial * 0.68 + drift * 0.6 + depthPass * 1.38,
      )
      const edgeFade = windowProgress(cycle, 0, 0.12) * (1 - windowProgress(cycle, 0.78, 1))
      const activation = impactBuild >= particle.delay * 0.82 ? 1 : 0
      this.impact.alphas.setX(index, activation * impactPresence * edgeFade * (0.09 + particle.weight * 0.34 + depthPass * 0.11))
    })
    this.impact.positions.needsUpdate = this.impact.alphas.needsUpdate = true

    const veilCount = this.haze.length <= 3 ? 1 : 2
    this.haze.forEach((entry, index) => {
      const nearPass = Math.pow(entry.near, 1.6)
      const isVeil = index < veilCount
      const opacity = isVeil
        ? Math.max(atmosphere * (0.075 + nearPass * 0.1), transitionVeil * (0.32 + nearPass * 0.17))
        : atmosphere * (0.09 + nearPass * 0.16)
      entry.sprite.visible = opacity > 0.003
      entry.material.opacity = opacity
      entry.sprite.position.set(
        receivingPoint.x + Math.sin(entry.phase + time * 0.08) * (0.18 + nearPass * 0.42),
        receivingPoint.y + 0.18 + nearPass * 0.62 + Math.cos(entry.phase + time * (0.12 + nearPass * 0.06)) * 0.09,
        receivingPoint.z + 0.1 + nearPass * 1.62 + Math.sin(index * 1.7) * 0.08,
      )
      const scale = entry.scale * (0.52 + atmosphere * 1.05 + transitionVeil * 1.12) * (1 + nearPass * 0.82)
      entry.sprite.scale.set(scale, scale * (0.48 + (index % 3) * 0.09), 1)
      entry.material.rotation = entry.phase * 0.18 + time * (index % 2 === 0 ? 0.018 : -0.013)
    })
  }
}

function heroWheatGrainGeometry() {
  const geometry = new T.SphereGeometry(1, 12, 9)
  const positions = geometry.attributes.position
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    const taper = 0.76 + (1 - Math.pow(Math.abs(y), 1.45)) * 0.24
    const shoulder = 1 + y * 0.045 + Math.sin(y * 3.4) * 0.018
    positions.setXYZ(index, x * taper * shoulder + (1 - y * y) * 0.055, y, z * taper * 0.88)
  }
  geometry.computeVertexNormals()
  return geometry
}

function wheatLeafGeometry(side: number, length: number, width: number, bend: number) {
  const shape = new T.Shape()
  shape.moveTo(0, 0)
  shape.bezierCurveTo(side * width * 0.4, length * 0.18, side * (width + bend * 0.15), length * 0.52, side * bend, length)
  shape.bezierCurveTo(side * (width * 0.34 + bend * 0.42), length * 0.6, side * width * 0.18, length * 0.2, 0, 0)
  return new T.ShapeGeometry(shape, 7)
}

function wheatEar(parent: T.Object3D, quality: QualityConfig, height: number, seed: number) {
  const randomLocal = createRandom(seed)
  const ear = new T.Group()
  parent.add(ear)
  const stemMaterial = mat(0xba913f, quality, undefined, { roughness: 0.92 })
  const kernelMaterial = mat(PALETTE.wheatLight, quality, 'grain', { roughness: 0.76, emissive: 0x6b450b, emissiveIntensity: 0.13 })
  tube([
    new T.Vector3(0, 0, 0),
    new T.Vector3(-0.018, height * 0.34, 0.008),
    new T.Vector3(0.028, height * 0.69, -0.006),
    new T.Vector3(0.035, height, 0),
  ], 0.014, stemMaterial, ear)
  const leafMaterial = mat(0x8d7d39, quality, undefined, { roughness: 0.96, side: T.DoubleSide })
  const lowerLeaf = mesh(wheatLeafGeometry(-1, 1.08, 0.16, 0.5), leafMaterial, ear, -0.004, 0.68, 0.018)
  lowerLeaf.rotation.y = -0.13
  const upperLeaf = mesh(wheatLeafGeometry(1, 0.76, 0.115, 0.3), leafMaterial, ear, 0.018, 1.05, -0.012)
  upperLeaf.rotation.y = 0.22
  const kernelGeometry = heroWheatGrainGeometry()
  for (let row = 0; row < 9; row += 1) {
    for (const side of [-1, 1]) {
      if (row === 4 && side === 1) continue
      const y = height - 0.88 + row * 0.095
      const kernel = mesh(kernelGeometry, kernelMaterial, ear, side * (0.062 - row * 0.003), y, (randomLocal() - 0.5) * 0.028)
      const variation = 0.94 + randomLocal() * 0.12
      kernel.scale.set((0.061 - row * 0.0018) * variation, (0.112 - row * 0.003) * variation, 0.064 * variation)
      kernel.rotation.set((randomLocal() - 0.5) * 0.13, (randomLocal() - 0.5) * 0.18, side * (-0.4 - randomLocal() * 0.08))
      const awnLength = (0.34 - row * 0.004) * (0.86 + randomLocal() * 0.28)
      rod(
        new T.Vector3(side * 0.085, y + 0.045, kernel.position.z),
        new T.Vector3(side * (0.085 + awnLength * 0.37), y + 0.045 + awnLength, kernel.position.z + (randomLocal() - 0.5) * 0.045),
        0.0026 + randomLocal() * 0.0008,
        stemMaterial,
        ear,
      )
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
    mat(PALETTE.wheat, quality, 'grain', { roughness: 0.84, emissive: 0x4b2c08, emissiveIntensity: 0.065 }),
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
  const profile = [[0.008, -0.64], [0.12, -0.59], [0.27, -0.4], [0.345, -0.12], [0.355, 0.14], [0.3, 0.4], [0.18, 0.57], [0.045, 0.65], [0.008, 0.66]]
  const group = new T.Group()
  const geometry = new T.LatheGeometry(profile.map(([radius, y]) => new T.Vector2(radius, y)), quality.mobile ? 28 : quality.tier === 'high' ? 40 : 34)
  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    const angle = Math.atan2(z, x)
    const shoulder = 1 + y * 0.075 + Math.sin(y * 4.2) * 0.024
    const rib = 1 + Math.sin(angle * 3 + y * 2.1) * 0.012
    const bodyX = x * shoulder * rib + (1 - y * y) * 0.03
    const bodyZ = z * 0.71 * (1 - y * 0.05) * rib
    const front = Math.max(0, Math.sin(angle))
    const creaseIndent = Math.exp(-Math.pow(bodyX / 0.078, 2)) * front * (1 - Math.pow(Math.abs(y) / 0.68, 2)) * 0.072
    positions.setXYZ(i, bodyX, y, bodyZ - Math.max(0, creaseIndent))
  }
  geometry.computeVertexNormals()
  const seed = mesh(geometry, mat(0xe0ad4d, quality, 'grain', {
    roughness: 0.78,
    bumpScale: 0.012,
    emissive: 0x351a05,
    emissiveIntensity: 0.075,
  }), group)
  seed.scale.setScalar(scale)
  const crease = tube([new T.Vector3(0.018, -0.48, 0.174), new T.Vector3(-0.01, -0.2, 0.199), new T.Vector3(0.012, 0.15, 0.196), new T.Vector3(-0.004, 0.47, 0.166)], 0.012, mat(0x513113, quality, undefined, { roughness: 0.99 }), group)
  crease.scale.setScalar(scale)
  const creaseEdge = tube([new T.Vector3(0.037, -0.42, 0.183), new T.Vector3(0.019, -0.12, 0.208), new T.Vector3(0.032, 0.2, 0.205), new T.Vector3(0.016, 0.42, 0.177)], 0.0035, mat(0xf5cf78, quality, undefined, { roughness: 0.82 }), group)
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
  const stoneContact = mesh(new T.CircleGeometry(1.075, 48), new T.MeshBasicMaterial({ color: 0x171711, transparent: true, opacity: 0.28, depthWrite: false }), group, 0, 0.397, 0)
  stoneContact.rotation.x = -Math.PI / 2
  stoneContact.castShadow = stoneContact.receiveShadow = false
  ring(1.12, 0.042, mat(0x4e4d47, quality, 'stone', { roughness: 0.99 }), group, 0.025)
  ring(1.205, 0.028, stoneEdge, group, 0.37)
  ring(1.18, 0.025, stoneEdge, rotor, -0.2)
  ring(1.16, 0.014, iron, rotor, 0.2)
  ring(0.19, 0.026, iron, rotor, 0.225)
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2
    const turn = angle + 0.2 + Math.sin(i * 1.7) * 0.035
    rod(new T.Vector3(Math.cos(angle) * 0.29, 0.224, Math.sin(angle) * 0.29), new T.Vector3(Math.cos(turn) * 1.08, 0.224, Math.sin(turn) * 1.08), 0.008, grooveMaterial, rotor)
  }
  const chiselDark = mat(0x625f56, quality, 'stone', { roughness: 0.99 })
  const chiselLight = mat(0xc0bcae, quality, 'stone', { roughness: 0.98 })
  for (let index = 0; index < 11; index += 1) {
    const angle = index / 11 * Math.PI * 2 + 0.13
    const radius = 1.218 + Math.sin(index * 2.4) * 0.008
    const mark = mesh(
      new T.BoxGeometry(0.11 + (index % 3) * 0.035, 0.018 + (index % 2) * 0.008, 0.016),
      index % 4 === 0 ? chiselLight : chiselDark,
      rotor,
      Math.cos(angle) * radius,
      -0.02 + Math.sin(index * 1.7) * 0.105,
      Math.sin(angle) * radius,
    )
    mark.rotation.y = Math.PI / 2 - angle
    mark.rotation.z = Math.sin(index * 2.1) * 0.16
    mark.castShadow = false
  }
  rod(new T.Vector3(0, 0.74, 0), new T.Vector3(0, 1.78, 0), 0.052, iron, group)
  rod(new T.Vector3(0, 1.1, 0), new T.Vector3(0.88, 1.1, 0), 0.052, iron, rotor)
  rod(new T.Vector3(0.88, 1.08, 0), new T.Vector3(0.88, 1.5, 0), 0.09, mat(0x8e5a31, quality, 'wood', { roughness: 0.83 }), rotor)
  const funnelWood = mat(0xae7949, quality, 'wood', { side: T.DoubleSide, roughness: 0.86, emissive: 0x2b1609, emissiveIntensity: 0.05 })
  const hopperGroup = new T.Group()
  hopperGroup.position.y = 1.35
  hopperGroup.rotation.y = Math.PI / 4 + 0.16
  group.add(hopperGroup)
  mesh(new T.CylinderGeometry(0.49, 0.14, 0.56, 4, 1, true), funnelWood, hopperGroup)
  const hopperEdge = mat(0x704629, quality, 'wood', { roughness: 0.92, bumpScale: 0.01 })
  const hopperSeam = mat(0x4e2f1d, quality, undefined, { roughness: 0.96 })
  for (const side of [-1, 1]) {
    mesh(new T.BoxGeometry(0.78, 0.045, 0.045), hopperEdge, hopperGroup, 0, 0.29, side * 0.39)
    mesh(new T.BoxGeometry(0.045, 0.045, 0.78), hopperEdge, hopperGroup, side * 0.39, 0.29, 0)
  }
  for (let corner = 0; corner < 4; corner += 1) {
    const angle = Math.PI / 4 + corner * Math.PI / 2
    rod(
      new T.Vector3(Math.cos(angle) * 0.47, 0.27, Math.sin(angle) * 0.47),
      new T.Vector3(Math.cos(angle) * 0.13, -0.27, Math.sin(angle) * 0.13),
      0.008,
      hopperSeam,
      hopperGroup,
    )
  }
  ring(0.145, 0.016, mat(0x5e3c28, quality, undefined, { roughness: 0.92 }), group, 1.07)
  const chute = new T.Group()
  chute.position.set(0.25, 0.36, 1.15)
  chute.rotation.x = 0.14
  group.add(chute)
  const chuteWood = mat(0x936039, quality, 'wood', { roughness: 0.88, bumpScale: 0.009 })
  const chuteEdge = mat(0x6d4025, quality, 'wood', { roughness: 0.92, bumpScale: 0.008 })
  mesh(roundBox(0.46, 0.82, 0.055, 0.04), chuteWood, chute)
  const trough = mesh(new T.BoxGeometry(0.31, 0.008, 0.56), mat(0x493023, quality, 'wood', { roughness: 0.96 }), chute, 0, 0.034, 0.06)
  trough.castShadow = false
  mesh(new T.BoxGeometry(0.042, 0.105, 0.77), chuteEdge, chute, -0.205, 0.052, 0)
  mesh(new T.BoxGeometry(0.042, 0.105, 0.77), chuteEdge, chute, 0.205, 0.052, 0)
  const chuteMouth = mesh(new T.BoxGeometry(0.37, 0.075, 0.038), mat(0x2f1c12, quality, undefined, { roughness: 0.98 }), chute, 0, 0.025, 0.4)
  chuteMouth.castShadow = false
  const lowerLip = mesh(new T.BoxGeometry(0.47, 0.052, 0.06), chuteEdge, chute, 0, -0.004, 0.405)
  lowerLip.rotation.z = 0.006
  const flourTrace = mat(0xe7d9bd, quality, 'flour', { transparent: true, opacity: 0.42, depthWrite: false })
  for (let index = 0; index < 3; index += 1) {
    const trace = mesh(
      new T.BoxGeometry(0.025 + index * 0.006, 0.004, 0.18 + index * 0.035),
      flourTrace,
      chute,
      (index - 1) * 0.075,
      0.032 + index * 0.001,
      0.18 + index * 0.035,
    )
    trace.rotation.y = (index - 1) * 0.07
    trace.castShadow = trace.receiveShadow = false
  }
  const outlet = new T.Vector3(0, 0.006, 0.408).applyEuler(chute.rotation).add(chute.position)
  const localBottomY = measureLocalBottomY(group)
  const shadow = contactShadow(group, 2.85, 2.45)
  shadow.scale.set(1.08, 1, 1)
  shadow.material.opacity = 0.4
  return { group, rotor, outlet, shadow, localBottomY }
}

function bowl(quality: QualityConfig) {
  const group = new T.Group()
  const profile = [[0.48, -0.42], [0.82, -0.36], [1.16, -0.14], [1.3, 0.18], [1.25, 0.4], [1.08, 0.52], [0.96, 0.48], [1.0, 0.28], [0.9, 0.02], [0.72, -0.18], [0.44, -0.27]]
  const shellGeometry = new T.LatheGeometry(profile.map(([radius, y]) => new T.Vector2(radius, y)), 48)
  const shellPositions = shellGeometry.attributes.position
  for (let index = 0; index < shellPositions.count; index += 1) {
    const x = shellPositions.getX(index)
    const y = shellPositions.getY(index)
    const z = shellPositions.getZ(index)
    const angle = Math.atan2(z, x)
    const warp = 1 + Math.sin(angle * 3 + y * 2.1) * 0.005 + Math.cos(angle * 5 - y) * 0.0025
    shellPositions.setXYZ(index, x * warp, y + Math.sin(angle * 2.2) * 0.003, z * warp)
  }
  shellGeometry.computeVertexNormals()
  const shell = mesh(shellGeometry, mat(0xd8d1c0, quality, undefined, { roughness: 0.36, emissive: 0x17120b, emissiveIntensity: 0.018 }), group)
  shell.scale.z = 0.96
  const interior = mesh(new T.CircleGeometry(0.455, 40), mat(0xaaa69d, quality, undefined, { roughness: 0.58 }), group, 0, -0.265, 0)
  interior.rotation.x = -Math.PI / 2
  const flourSurface = mesh(new T.CircleGeometry(0.94, 32), mat(PALETTE.flour, quality, 'flour', { roughness: 1 }), group, 0, 0.39, 0)
  flourSurface.rotation.x = -Math.PI / 2
  const rim = ring(1.14, 0.042, mat(0xf4ead6, quality, undefined, { roughness: 0.22, emissive: 0x2b2012, emissiveIntensity: 0.045 }), group, 0.48)
  rim.scale.set(1, 0.98, 1)
  const innerLip = ring(1.045, 0.018, mat(0xb9b4a8, quality, undefined, { roughness: 0.48 }), group, 0.455)
  innerLip.scale.set(1, 0.96, 1)
  const footMaterial = mat(0xaaa598, quality, undefined, { roughness: 0.62 })
  const foot = mesh(new T.CylinderGeometry(0.49, 0.455, 0.052, 40), footMaterial, group, 0, -0.401, 0)
  foot.scale.z = 0.96
  const footRing = ring(0.48, 0.035, footMaterial, group, -0.4)
  footRing.scale.z = 0.96
  const localBottomY = measureLocalBottomY(group)
  return { group, flourSurface, localBottomY, doughSupportY: 0.055 }
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
  // Stable transparent layering: water composites first, glass blends over it
  // from every angle instead of flickering with view-dependent sort order.
  water.renderOrder = 1
  waterTop.renderOrder = 1
  group.children.forEach((child) => {
    const candidate = child as T.Mesh
    if (candidate.isMesh && candidate.material === glass) candidate.renderOrder = 2
  })
  return group
}

function proofBasket(quality: QualityConfig) {
  const group = new T.Group()
  const wicker = [0xc69a60, 0xb98650, 0xd0aa71].map((color) => mat(color, quality, 'wood', { roughness: 0.92 }))
  for (let i = 0; i < 12; i += 1) {
    const strand = ring(0.77 + i * 0.022 + Math.sin(i * 1.7) * 0.006, 0.027 + (i % 3) * 0.002, wicker[i % wicker.length], group, 0.05 + i * 0.031)
    strand.position.x = Math.sin(i * 2.3) * 0.005
    strand.rotation.z = Math.sin(i * 1.2) * 0.004
  }
  const rodMaterials = [mat(0x815631, quality, 'wood', { roughness: 0.95 }), mat(0x9a6b3f, quality, 'wood', { roughness: 0.95 })]
  for (let i = 0; i < 28; i += 1) {
    const angle = (i / 28) * Math.PI * 2
    const topRadius = 0.995 + Math.sin(i * 1.31) * 0.008
    rod(new T.Vector3(Math.cos(angle) * 0.79, 0.055, Math.sin(angle) * 0.79), new T.Vector3(Math.cos(angle) * topRadius, 0.405, Math.sin(angle) * topRadius), 0.0095, rodMaterials[i % 2], group)
  }
  return { group, localBottomY: measureLocalBottomY(group), doughSupportY: 0.13 }
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
  const innerLining = mat(0x2c1711, quality, 'stone', { roughness: 0.98 })
  const innerArch = mesh(new T.TorusGeometry(1.18, 0.095, 8, 42, Math.PI), innerLining, group, 0, 1.17, 0.57)
  innerArch.rotation.z = 0
  mesh(new T.BoxGeometry(0.19, 1.17, 0.26), innerLining, group, -1.18, 0.59, 0.57)
  mesh(new T.BoxGeometry(0.19, 1.17, 0.26), innerLining, group, 1.18, 0.59, 0.57)
  mesh(new T.BoxGeometry(0.55, 1.2, 1.55), mortar, group, -1.47, 0.6, -0.12)
  mesh(new T.BoxGeometry(0.55, 1.2, 1.55), mortar, group, 1.47, 0.6, -0.12)
  for (const side of [-1, 1]) for (let row = 0; row < 4; row += 1) {
    const brick = mesh(new T.BoxGeometry(0.49, 0.265, 0.24), bricks[(row + (side > 0 ? 1 : 0)) % bricks.length], group, side * 1.47, 0.16 + row * 0.3, 0.69)
    brick.position.x += Math.sin(row * 2.1 + side) * 0.012
    brick.position.z += Math.cos(row * 1.8 + side) * 0.014
    brick.rotation.z = Math.sin(row * 1.37 + side) * 0.012
    brick.scale.set(0.96 + (row % 3) * 0.025, 0.97 + ((row + 1) % 2) * 0.025, 1)
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
    const archBrick = mesh(new T.ExtrudeGeometry(wedge, { depth: 1.5, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.012, bevelThickness: 0.012 }), bricks[i % bricks.length], group, 0, 0, -0.86)
    archBrick.position.z += Math.sin(i * 1.73) * 0.016
  }
  const floorMaterials = [0x655447, 0x59493e, 0x746054].map((color) => mat(color, quality, 'stone', { roughness: 0.98 }))
  let floorSurfaceY = -Infinity
  for (let i = 0; i < 5; i += 1) {
    const slabGeometry = new T.BoxGeometry(0.47, 0.11, 1.45)
    const slab = mesh(slabGeometry, floorMaterials[i % floorMaterials.length], group, -0.98 + i * 0.49, 0.04, 0.01)
    slab.position.y += Math.sin(i * 2.1) * 0.008
    slab.rotation.y = Math.sin(i * 1.9) * 0.009
    floorSurfaceY = Math.max(floorSurfaceY, slab.position.y + geometryYBounds(slabGeometry).max)
  }
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
  return { group, glow, embers, floorSurfaceY }
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

type CrumbPore = readonly [y: number, z: number, tier: number, twist: number]

type CutContour = { contour: { y: number; z: number }[]; centroid: { y: number; z: number } }

// Shape coordinates are (x=-z, y=y): after rotateY(+PI/2) the face lies in
// the dough-local x=0 plane with +x normals and true (y,z) positions.
function contourShape(contour: { y: number; z: number }[]) {
  const shape = new T.Shape()
  contour.forEach((point, index) => {
    if (index === 0) shape.moveTo(-point.z, point.y)
    else shape.lineTo(-point.z, point.y)
  })
  shape.closePath()
  return shape
}

function erodeContour(contour: { y: number; z: number }[], centroid: { y: number; z: number }, amount: number) {
  return contour.map((point) => ({
    y: centroid.y + (point.y - centroid.y) * (1 - amount),
    z: centroid.z + (point.z - centroid.z) * (1 - amount),
  }))
}

function insideContour(y: number, z: number, contour: { y: number; z: number }[]) {
  let inside = false
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const yi = contour[i].y
    const zi = contour[i].z
    const yj = contour[j].y
    const zj = contour[j].z
    if ((zi > z) !== (zj > z) && y < ((yj - yi) * (z - zi)) / (zj - zi) + yi) inside = !inside
  }
  return inside
}

// Deterministic clustered pores, guaranteed inside the sampled contour.
function sampleContourPores(seed: number, cut: CutContour, count: number): CrumbPore[] {
  const rand = createRandom(seed)
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  cut.contour.forEach((point) => {
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  })
  const clusters: { y: number; z: number }[] = []
  let clusterGuard = 0
  while (clusters.length < 2 && clusterGuard < 40) {
    clusterGuard += 1
    const y = minY + rand() * (maxY - minY)
    const z = minZ + rand() * (maxZ - minZ)
    if (insideContour(y, z, cut.contour)) clusters.push({ y, z })
  }
  const pores: CrumbPore[] = []
  let guard = 0
  while (pores.length < count && guard < count * 80) {
    guard += 1
    let y: number
    let z: number
    if (clusters.length > 0 && rand() < 0.3) {
      const cluster = clusters[Math.floor(rand() * clusters.length)]
      const spread = 0.24
      y = cluster.y + ((rand() + rand() + rand()) / 3 - 0.5) * 2 * spread
      z = cluster.z + ((rand() + rand() + rand()) / 3 - 0.5) * 2 * spread
    } else {
      y = minY + rand() * (maxY - minY)
      z = minZ + rand() * (maxZ - minZ)
    }
    if (!insideContour(y, z, cut.contour)) continue
    const tier = rand() < 0.45 ? 1 : 2
    pores.push([y, z, tier, (rand() - 0.5) * 1.2])
  }
  while (pores.length < count) pores.push([cut.centroid.y, cut.centroid.z, 1, 0])
  return pores
}

function capGeometry(cut: CutContour, erode: number, planeX: number, pores: readonly CrumbPore[] | null) {
  const geometry = new T.ShapeGeometry(contourShape(erode > 0 ? erodeContour(cut.contour, cut.centroid, erode) : cut.contour))
  {
    const position = geometry.attributes.position as T.BufferAttribute
    for (let index = 0; index < position.count; index += 1) {
      const localY = position.getY(index)
      const localZ = -position.getX(index)
      let cavity = 0
      if (pores) {
        pores.forEach(([y, z, tier]) => {
          const radius = [0.058, 0.041, 0.025][tier]
          cavity = Math.max(cavity, Math.exp(-(((localY - y) / radius) ** 2 + ((localZ - z) / (radius * 1.35)) ** 2)))
        })
      }
      // Gentle broad relief always; pore cavities only when pores are passed.
      const broad = Math.sin(localZ * 14.5 + localY * 7.2) * 0.0022 + Math.cos(localY * 19 - localZ * 5) * 0.0013
      position.setZ(index, broad - cavity * 0.006)
    }
    position.needsUpdate = true
  }
  geometry.rotateY(Math.PI / 2)
  geometry.translate(planeX, 0, 0)
  geometry.computeVertexNormals()
  return geometry
}

function sliceWallGeometry(cut: CutContour, x0: number, x1: number) {
  const contour = cut.contour
  const count = contour.length
  const positions = new Float32Array((count + 1) * 2 * 3)
  const normals = new Float32Array((count + 1) * 2 * 3)
  const index: number[] = []
  for (let i = 0; i <= count; i += 1) {
    const point = contour[i % count]
    const prev = contour[(i - 1 + count) % count]
    const next = contour[(i + 1) % count]
    let ny = -(next.z - prev.z)
    let nz = next.y - prev.y
    const length = Math.hypot(ny, nz) || 1
    ny /= length
    nz /= length
    if (ny * (point.y - cut.centroid.y) + nz * (point.z - cut.centroid.z) < 0) {
      ny = -ny
      nz = -nz
    }
    const o = i * 6
    positions[o] = x0
    positions[o + 1] = point.y
    positions[o + 2] = point.z
    positions[o + 3] = x1
    positions[o + 4] = point.y
    positions[o + 5] = point.z
    normals[o] = 0
    normals[o + 1] = ny
    normals[o + 2] = nz
    normals[o + 3] = 0
    normals[o + 4] = ny
    normals[o + 5] = nz
    if (i < count) {
      const a = i * 2
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new T.BufferAttribute(normals, 3))
  geometry.setIndex(index)
  return geometry
}

function irregularPoreGeometry(seed: number) {
  const random = createRandom(11807 + seed * 641)
  const points = 9 + Math.floor(random() * 4)
  const outline = new T.Shape()
  for (let index = 0; index <= points; index += 1) {
    const t = index / points * Math.PI * 2
    const wobble = 0.78 + random() * 0.28 + Math.sin(t * (2 + seed % 3) + seed) * 0.08
    const x = Math.cos(t) * wobble
    const y = Math.sin(t) * wobble * (0.68 + random() * 0.26)
    if (index === 0) outline.moveTo(x, y)
    else outline.lineTo(x, y)
  }
  const geometry = new T.ShapeGeometry(outline, 8)
  geometry.computeVertexNormals()
  return geometry
}

function addPores(parent: T.Object3D, pores: readonly CrumbPore[], baseX: number, materials: { edge: T.Material; cavity: T.Material }) {
  const sizes = [0.042, 0.029, 0.018]
  pores.forEach(([y, z, tier, twist], index) => {
    const radius = sizes[tier] * (0.9 + (index % 3) * 0.07)
    const geometry = irregularPoreGeometry(index + tier * 7)
    const rim = mesh(geometry, materials.edge, parent, baseX + 0.001, y, z)
    rim.rotation.y = Math.PI / 2
    rim.rotation.z = twist
    rim.scale.set(radius * 1.55, radius * 1.28, 1)
    rim.castShadow = rim.receiveShadow = false
    const cavity = mesh(geometry.clone(), materials.cavity, parent, baseX + 0.003, y + radius * 0.025, z + radius * 0.03)
    cavity.rotation.y = Math.PI / 2
    cavity.rotation.z = twist + 0.08
    cavity.scale.set(radius, radius * 0.72, 1)
    cavity.castShadow = cavity.receiveShadow = false
  })
}

function breadCutDetails(quality: QualityConfig, cut: CutContour) {
  const group = new T.Group()
  group.name = 'bread-cut-reveal'
  const mainCut = new T.Group()
  mainCut.name = 'main-cut-cap'
  group.add(mainCut)
  // Solid cut pieces stay opaque: reveals are discrete object visibility, so
  // nothing here can ghost through transparency sorting. Decal pore materials
  // below are the only transparent surfaces, and their opacity never changes.
  const crumbMaterial = mat(0xffe8bd, quality, 'crumb', { roughness: 0.985, side: T.DoubleSide, emissive: 0x5b3219, emissiveIntensity: 0.018, bumpScale: 0.022, transparent: false, opacity: 1 })
  const crustMaterial = mat(0xc08a49, quality, 'crust', { roughness: 0.9, bumpScale: 0.021, transparent: false, opacity: 1 })
  // Thin cut edge: plain matte crust matched to the loaf's shaded crust so
  // extrude-wall UV stretching and facet banding cannot stripe it. Lids keep
  // the full textured materials.
  const crustEdgeMaterial = mat(0x9e6a38, quality, undefined, { roughness: 0.95, transparent: false, opacity: 1, side: T.DoubleSide })
  // Cut-face lids use a plain unmapped crumb: the shared canvas texture's
  // baked blotches read as large brown stains at cap scale. Pore decals
  // carry all interior detail deliberately.
  const crumbCapMaterial = new T.MeshStandardMaterial({ color: 0xffe8bd, roughness: 0.97, metalness: 0, side: T.DoubleSide, emissive: 0x5b3219, emissiveIntensity: 0.018, transparent: false, opacity: 1 })
  const poreEdgeMaterial = new T.MeshStandardMaterial({ color: 0xf5d9a2, roughness: 1, metalness: 0, transparent: true, opacity: 0.2, side: T.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  const poreCavityMaterial = new T.MeshStandardMaterial({ color: 0xd0a878, roughness: 1, metalness: 0, transparent: true, opacity: 0.18, side: T.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  // Both cap layers derive from the sampled loaf cross-section: full-contour
  // crust with a slightly eroded crumb face, so the rim reads as real crust
  // thickness rather than a decal outline.
  mesh(capGeometry(cut, 0, BAKED_CUT_X, null), crustMaterial, mainCut)
  const mainPores = sampleContourPores(4242, cut, 8)
  const mainFace = mesh(capGeometry(cut, 0.02, BAKED_CUT_X + 0.0008, null), crumbCapMaterial, mainCut)
  mainCut.visible = false

  const slice = new T.Group()
  slice.name = 'separated-slice'
  // The slice is the same canonical contour: back lid lands exactly on the
  // loaf cut plane, so pre-separation it fits back like the missing piece.
  // No profile scaling, no yaw compensation. Pose-only animation after.
  // Walls are a custom smooth-shaded strip (analytic outward normals, no UVs),
  // so neither flat-facet banding nor texture stretching can stripe the edge.
  const slicePores = sampleContourPores(4343, cut, 7)
  mesh(capGeometry(cut, 0, BAKED_CUT_X + BAKED_SLICE_THICKNESS, null), crumbCapMaterial, slice)
  mesh(capGeometry(cut, 0, BAKED_CUT_X, null), crumbCapMaterial, slice)
  const sliceWalls = new T.Mesh(sliceWallGeometry(cut, BAKED_CUT_X, BAKED_CUT_X + BAKED_SLICE_THICKNESS), crustEdgeMaterial)
  sliceWalls.castShadow = true
  sliceWalls.receiveShadow = true
  slice.add(sliceWalls)
  addPores(slice, slicePores, BAKED_CUT_X + BAKED_SLICE_THICKNESS + 0.0015, { edge: poreEdgeMaterial, cavity: poreCavityMaterial })
  slice.visible = false
  group.add(slice)

  addPores(mainCut, mainPores, BAKED_CUT_X + 0.0025, { edge: poreEdgeMaterial, cavity: poreCavityMaterial })

  const crumbs = Array.from({ length: 8 }, (_, index) => {
    const size = 0.014 + random() * 0.019
    const crumbGeometry = index % 3 === 0 ? new T.TetrahedronGeometry(size, 0) : new T.IcosahedronGeometry(size, 0)
    const crumb = mesh(crumbGeometry, crumbMaterial, group)
    return {
      crumb,
      delay: index / 11 + random() * 0.12,
      x: 0.72 + random() * 0.2,
      z: (random() - 0.5) * 0.55,
      stretch: 0.68 + random() * 0.72,
      drift: (random() - 0.5) * 0.12,
    }
  })
  return { group, mainCut, slice, crumbs }
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

  const wheatMoteCount = quality.mobile ? 14 : 32
  const wheatMotePositions = new Float32Array(wheatMoteCount * 3)
  const wheatMoteSeeds = Array.from({ length: wheatMoteCount }, (_, index) => ({
    x: -2.8 + random() * 5.6,
    y: 0.45 + random() * 1.75,
    z: -1.9 + random() * 3.2,
    phase: random() * Math.PI * 2 + index,
  }))
  const wheatMoteGeometry = new T.BufferGeometry()
  wheatMoteGeometry.setAttribute('position', new T.BufferAttribute(wheatMotePositions, 3))
  const wheatMoteMaterial = pointsMaterial(0xf4cb79, quality.mobile ? 0.022 : 0.028, 0)
  const wheatMotes = new T.Points(wheatMoteGeometry, wheatMoteMaterial)
  wheatMotes.name = 'wheat-pollen'
  wheatMotes.frustumCulled = false
  group.add(wheatMotes)

  // The hero grain starts in a deliberate gap in the ear, then detaches.
  const kernel = grainKernel(quality)
  kernel.name = 'hero-kernel'
  group.add(kernel)
  const millModel = mill(quality)
  millModel.group.name = 'mill'
  group.add(millModel.group)

  const worktop = new T.Group()
  worktop.name = 'shared-worktop'
  const worktopSurface = board(worktop, quality, 5.5, 3.7, 0x8f6749)
  dust(worktop, quality, quality.crumbCount, 1.9, worktopSurface.topY + CONTACT_EPSILON)
  worktop.rotation.y = -0.018
  group.add(worktop)
  const millGroundY = groundedY(worktopSurface.topY, millModel.localBottomY)

  const flour = new FlourSystem(quality)
  group.add(flour.group)
  const bowlModel = bowl(quality)
  bowlModel.group.name = 'mixing-bowl'
  group.add(bowlModel.group)
  const bowlGroundY = groundedY(worktopSurface.topY, bowlModel.localBottomY)
  const bowlShadow = contactShadow(group, 1.45, 0.92)

  const waterGroup = jug(quality)
  group.add(waterGroup)
  const waterMaterial = mat(0xbcdce0, quality, undefined, { opacity: 0.65, roughness: 0.2, depthWrite: false })
  const waterStream = mesh(taperedWaterGeometry(), waterMaterial, group)
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

  const mixtureClumps = new T.Group()
  mixtureClumps.name = 'forming-dough-clumps'
  const clumpMaterial = mat(0xd3ab73, quality, 'dough', { roughness: 0.82, bumpScale: 0.008 })
  const clumpSpecs = Array.from({ length: quality.mobile ? 5 : 8 }, (_, index) => {
    const clump = mesh(new T.IcosahedronGeometry(1, index % 3 === 0 ? 1 : 0), clumpMaterial, mixtureClumps)
    const angle = random() * Math.PI * 2
    return {
      clump,
      x: Math.cos(angle) * (0.16 + random() * 0.42),
      z: Math.sin(angle) * (0.1 + random() * 0.3),
      size: 0.055 + random() * 0.085,
      phase: random() * Math.PI * 2,
    }
  })
  group.add(mixtureClumps)

  const dough = new DoughMorph(group, quality)
  // Derive the cut profile from the actual baked loaf: evaluate the full
  // deformation once, sample the cross-section ring at the cut plane, and
  // build the cap and slice from that contour. No hand-authored profile.
  dough.apply(1)
  const cutDetails = breadCutDetails(quality, dough.sampleCutContour(BAKED_CUT_X, 144))
  // Keep the parent alive so the cap and separated slice can be revealed
  // independently without fading solid geometry over the loaf.
  cutDetails.group.visible = true
  dough.mesh.add(cutDetails.group)
  const doughShadow = contactShadow(group, 2.22, 1.5)
  const spoon = new T.Group()
  spoon.name = 'mixing-spoon'
  const spoonMaterial = mat(0xbd8747, quality, 'wood', { roughness: 0.86 })
  mesh(new T.SphereGeometry(1, 24, 16), spoonMaterial, spoon).scale.set(0.16, 0.055, 0.24)
  rod(new T.Vector3(0, 0.03, 0), new T.Vector3(0.28, 1.12, 0), 0.037, spoonMaterial, spoon)
  group.add(spoon)
  const basketModel = proofBasket(quality)
  const basket = basketModel.group
  basket.name = 'proofing-basket'
  basket.scale.set(1.14, 1, 0.92)
  group.add(basket)
  const basketGroundY = groundedY(worktopSurface.topY, basketModel.localBottomY)
  const basketShadow = contactShadow(group, 2.1, 1.35)

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
  const peelDeckGeometry = roundBox(2.65, 1.95, 0.045, 0.25)
  mesh(peelDeckGeometry, mat(0xe3be85, quality, 'wood'), peel)
  rod(new T.Vector3(0, 0.005, 0.95), new T.Vector3(0, 0.005, 2.7), 0.055, mat(0xaf854f, quality, 'wood'), peel)
  group.add(peel)
  const peelGroundY = ovenModel.floorSurfaceY - geometryYBounds(peelDeckGeometry).max

  const knife = breadKnife(quality)
  group.add(knife)

  const finalBoard = new T.Group()
  finalBoard.name = 'final-board'
  const finalBoardSurface = board(finalBoard, quality, 3.65, 2.45, 0x633923)
  dust(finalBoard, quality, Math.max(18, Math.floor(quality.crumbCount * 0.62)), 1.48, finalBoardSurface.topY + CONTACT_EPSILON)
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
    field: new Visibility(field), kernel: new Visibility(kernel), mill: new Visibility(millModel.group),
    top: new Visibility(worktop), bowl: new Visibility(bowlModel.group, 0.02),
    water: new Visibility(waterGroup), spoon: new Visibility(spoon),
    additions: new Visibility(additions), clumps: new Visibility(mixtureClumps), basket: new Visibility(basket),
    oven: new Visibility(ovenModel.group), peel: new Visibility(peel),
    final: new Visibility(finalBoard), knife: new Visibility(knife),
  }
  const kernelHome = new T.Vector3(-0.155, 1.98, 0.26)
  const kernelFocus = new T.Vector3(0, 1.5, 0.65)
  const hopper = new T.Vector3()
  const outlet = new T.Vector3()
  const flourReceivingPoint = new T.Vector3()
  const bowlTarget = new T.Vector3()
  const doughInBowl = new T.Vector3(0, bowlGroundY + bowlModel.doughSupportY, 0.18)
  const doughOnBoard = new T.Vector3(0, worktopSurface.topY + CONTACT_EPSILON, 0.12)
  const doughInBasket = new T.Vector3(0, basketGroundY + basketModel.doughSupportY, 0.12)
  const ovenDestination = new T.Vector3(0, ovenModel.floorSurfaceY + CONTACT_EPSILON, -1.4)
  const finalDestination = new T.Vector3(0, finalBoardSurface.topY + CONTACT_EPSILON, 0.48)
  const knifePositionKeys: SplineKeyframe<T.Vector3>[] = [
    { at: 0.968, value: new T.Vector3(0.78, 1.78, 0.63) },
    { at: 0.982, value: new T.Vector3(0.78, 1.26, 0.57) },
    { at: 0.989, value: new T.Vector3(0.78, 0.99, 0.51), tension: 0.58 },
    { at: 0.997, value: new T.Vector3(0.84, 0.73, 0.49) },
    { at: 1, value: new T.Vector3(1.7, 1.05, 0.49) },
  ]
  const knifeRotationKeys: SplineKeyframe<T.Vector3>[] = [
    { at: 0.968, value: new T.Vector3(0.04, -0.08, -0.18) },
    { at: 0.989, value: new T.Vector3(0.04, -0.08, -0.1), tension: 0.5 },
    { at: 0.997, value: new T.Vector3(0.04, -0.02, -0.08) },
    { at: 1, value: new T.Vector3(0.04, 0.1, 0.18) },
  ]
  const knifePosition = new T.Vector3()
  const knifeRotation = new T.Vector3()
  const waterStart = new T.Vector3()
  const up = new T.Vector3(0,1,0)

  return {
    group,
    update({ progress, time, quality: currentQuality }) {
      const p = clamp01(progress)
      const ambient = currentQuality.reducedMotion ? 0 : time
      const flourish = currentQuality.reducedMotion ? 0.35 : 1
      const extract = windowProgress(p, 0.082, 0.17)
      const feed = windowProgress(p, 0.225, 0.292, (value) => value * value)
      const feedScale = windowProgress(p, 0.25, 0.295, (value) => value * value * (3 - 2 * value))
      const throatOcclusion = windowProgress(p, 0.285, 0.295, (value) => value * value)
      const millEnter = windowProgress(p, 0.182, 0.242)
      const fieldRetreat = windowProgress(p, 0.138, 0.285)
      field.position.set(-fieldRetreat * 0.08, 0, -fieldRetreat * 2.3)
      visibility.field.set(1 - windowProgress(p, 0.19, 0.298))
      if (field.visible) {
        fieldModel.update(ambient)
        heroEar.rotation.z = Math.sin(ambient * 0.65) * 0.016 * (1 - extract)
      }
      const wheatMotePresence = 1 - windowProgress(p, 0.14, 0.255)
      wheatMotes.visible = wheatMotePresence > 0.002
      wheatMoteMaterial.opacity = wheatMotePresence * 0.26
      wheatMotes.position.copy(field.position)
      wheatMoteSeeds.forEach((seed, index) => {
        wheatMotePositions[index * 3] = seed.x + Math.sin(ambient * 0.14 + seed.phase) * 0.12
        wheatMotePositions[index * 3 + 1] = seed.y + Math.sin(ambient * 0.2 + seed.phase * 0.7) * 0.06
        wheatMotePositions[index * 3 + 2] = seed.z + Math.cos(ambient * 0.11 + seed.phase) * 0.05
      })
      wheatMoteGeometry.attributes.position.needsUpdate = true
      visibility.kernel.set(1 - windowProgress(p, 0.29, 0.299))
      temp.set(0.055, 1.98, 0).applyEuler(heroEar.rotation).add(heroEar.position).add(field.position)
      kernelHome.copy(temp)
      kernel.position.lerpVectors(kernelHome, kernelFocus, extract)
      kernel.scale.setScalar(0.11 + extract * 0.64)
      kernel.rotation.set(0.06 * extract, 0.08 * extract, -0.43 + extract * 1.12)
      // Once established, the mill remains physically planted. Flour and the
      // camera mask its departure rather than sliding the entire machine away.
      millModel.group.position.set(0.12 + (1 - millEnter) * 0.34, millGroundY, -0.4 - (1 - millEnter) * 2.55)
      visibility.mill.set(windowProgress(p, 0.178, 0.228) * (1 - windowProgress(p, 0.423, 0.448)))
      hopper.set(millModel.group.position.x, millModel.group.position.y + 1.21, millModel.group.position.z)
      if (feed > 0) {
        arcPosition(kernelFocus, hopper, feed, 0.65 * flourish, kernel.position)
        const physicalScale = T.MathUtils.lerp(0.75, 0.115, feedScale)
        kernel.scale.setScalar(physicalScale * T.MathUtils.lerp(1, 0.46, throatOcclusion))
        kernel.rotation.z += feed * 1.6
      }
      // The only remaining fade occurs after the tiny kernel is inside the
      // opaque feed throat, so reverse scrubbing reads as physical emergence.
      const grind = windowProgress(p, 0.284, 0.405, (value) => value * value * (2 - value))
      millModel.rotor.rotation.y = grind * Math.PI * 5.75 + Math.sin(ambient * 0.35) * 0.014 * bell(grind)
      millModel.rotor.position.y = 0.62 + Math.sin(grind * Math.PI * 11.5) * bell(grind) * 0.0045 * flourish
      millModel.shadow.position.y = worktopSurface.topY - millGroundY + CONTACT_EPSILON * 0.5
      outlet.copy(millModel.outlet).add(millModel.group.position)
      flourReceivingPoint.set(outlet.x + 0.018, worktopSurface.topY + CONTACT_EPSILON, outlet.z + 0.055)
      visibility.top.set(windowProgress(p, 0.205, 0.255) * (1 - windowProgress(p, 0.8, 0.845)))

      const bowlRecede = windowProgress(p, 0.626, 0.66)
      // The dough fills the foreground as the camera follows it out; finish the
      // bowl fade while it is still occluded instead of leaving a ghostly rim.
      const bowlPresence = windowProgress(p, 0.425, 0.452, (value) => value * value * (3 - 2 * value)) * (1 - windowProgress(p, 0.621, 0.629, (value) => value ** 4))
      // The bowl is grounded at its final preparation position before it is
      // revealed. Flour atmosphere and camera motion perform the handoff.
      bowlModel.group.position.set(-bowlRecede * 0.2, bowlGroundY, 0.18 - bowlRecede * 1.25)
      visibility.bowl.set(bowlPresence)
      bowlShadow.position.set(bowlModel.group.position.x - 0.025, worktopSurface.topY + CONTACT_EPSILON * 0.5, bowlModel.group.position.z - 0.035)
      bowlShadow.material.opacity = bowlPresence * bowlPresence * 0.48
      bowlShadow.visible = bowlShadow.material.opacity > 0.002
      bowlTarget.copy(bowlModel.group.position).add(temp.set(0, 0.16, 0))
      flour.update(p, ambient, outlet, flourReceivingPoint, millModel.group.position, millModel.rotor.rotation.y)
      const fill = windowProgress(p, 0.434, 0.49)
      const mixing = windowProgress(p, 0.502, 0.575)
      const dryToWet = windowProgress(p, 0.502, 0.542)
      const flourSurfaceOpacity = fill * bowlPresence * (1 - dryToWet)
      bowlModel.flourSurface.visible = flourSurfaceOpacity > 0.002
      bowlModel.flourSurface.scale.setScalar(Math.sqrt(fill) * (1 - mixing * 0.08))
      bowlModel.flourSurface.position.y = -0.18 + fill * 0.38 - mixing * 0.13
      bowlModel.flourSurface.material.opacity = flourSurfaceOpacity
      bowlModel.flourSurface.material.transparent = dryToWet > 0.001
      bowlModel.flourSurface.material.depthWrite = dryToWet < 0.08

      const pouring = windowProgress(p, 0.486, 0.524)
      waterGroup.position.set(bowlModel.group.position.x - 1.12, 1.54 + bell(pouring) * 0.06, 0.16)
      waterGroup.rotation.z = -0.3 - bell(pouring) * 0.72
      visibility.water.set(overlap(p, 0.477, 0.546, 0.016))
      waterStart.set(0.29, 0.27, 0).applyEuler(waterGroup.rotation).add(waterGroup.position)
      waterStream.position.copy(waterStart).add(bowlTarget).multiplyScalar(0.5)
      waterStream.quaternion.setFromUnitVectors(up, temp.copy(waterStart).sub(bowlTarget).normalize())
      waterStream.scale.set(1, waterStart.distanceTo(bowlTarget), 1)
      waterStream.visible = pouring > 0.01 && pouring < 0.99
      waterMaterial.opacity = bell(pouring) * 0.58
      streamHighlight.position.x = 0.014 + Math.sin(ambient * 2.8 + pouring * Math.PI * 2) * 0.006
      ;(streamHighlight.material as T.MeshBasicMaterial).opacity = bell(pouring) * 0.48
      const season = windowProgress(p, 0.498, 0.535, (value) => value * value)
      visibility.additions.set(overlap(p, 0.495, 0.542, 0.011))
      additionSeeds.forEach((seed) => {
        const t = clamp01((season - seed.delay) / 0.55)
        seed.mesh.position.set(bowlTarget.x + seed.x, bowlTarget.y + 0.88 * (1 - t * t), bowlTarget.z + seed.z)
      })

      const clumpPresence = windowProgress(p, 0.49, 0.518) * (1 - windowProgress(p, 0.548, 0.575))
      const clumpMerge = windowProgress(p, 0.505, 0.56)
      visibility.clumps.set(clumpPresence)
      clumpMaterial.roughness = 0.88 - windowProgress(p, 0.498, 0.535) * 0.18
      clumpSpecs.forEach((spec, index) => {
        const orbit = spec.phase + clumpMerge * (0.8 + index * 0.07)
        spec.clump.position.set(
          bowlTarget.x + T.MathUtils.lerp(spec.x, Math.cos(orbit) * 0.07, clumpMerge),
          bowlTarget.y + 0.025 + Math.sin(orbit * 1.7) * 0.035 * (1 - clumpMerge),
          bowlTarget.z + T.MathUtils.lerp(spec.z, Math.sin(orbit) * 0.045, clumpMerge),
        )
        const scale = spec.size * (1 - clumpMerge * 0.64)
        spec.clump.scale.set(scale * (1.08 + (index % 2) * 0.16), scale * (0.72 + (index % 3) * 0.08), scale)
        spec.clump.rotation.set(orbit * 0.23, orbit * 0.5, orbit * -0.16)
      })

      const stir = windowProgress(p, 0.492, 0.568, (value) => value * value * (2 - value))
      const angle = stir * Math.PI * 5
      const resistance = windowProgress(p, 0.535, 0.575)
      const spoonWithdraw = windowProgress(p, 0.552, 0.615, weightedOut)
      spoon.position.set(bowlTarget.x + Math.cos(angle) * (0.48 - resistance * 0.15), 0.66 + mixing * 0.06, bowlTarget.z + Math.sin(angle) * 0.32)
      spoon.rotation.set(-0.2 + Math.sin(angle) * 0.12, angle, -0.34 + resistance * 0.15)
      spoon.position.y += spoonWithdraw * 1.28
      spoon.position.z -= spoonWithdraw * 0.34
      visibility.spoon.set(overlap(p, 0.488, 0.628, 0.018))

      // Topology is shared from the first cohesive mixture through the final loaf.
      const doughOpacity = windowProgress(p, 0.498, 0.538)
      dough.mesh.visible = doughOpacity > 0.002
      dough.apply(p)
      dough.mesh.material.opacity = doughOpacity
      dough.mesh.material.depthWrite = dough.mesh.material.opacity > 0.98
      const liftOut = windowProgress(p, 0.565, 0.625)
      arcPosition(doughInBowl, doughOnBoard, liftOut, 0.42, dough.mesh.position)
      const knead = windowProgress(p, 0.61, 0.69, (value) => value)
      dough.mesh.rotation.set(0, Math.sin(knead * Math.PI * 3) * bell(knead) * 0.06, 0)

      const basketApproach = windowProgress(p, 0.65, 0.705)
      const basketPlace = windowProgress(p, 0.688, 0.735)
      const basketRecede = windowProgress(p, 0.805, 0.848)
      basket.position.set(0.2 * (1 - basketApproach), basketGroundY, 0.12 - (1 - basketApproach) * 1.05 - basketRecede * 0.72)
      const basketPresence = windowProgress(p, 0.666, 0.7) * (1 - windowProgress(p, 0.812, 0.846))
      visibility.basket.set(basketPresence)
      basketShadow.position.set(basket.position.x - 0.02, worktopSurface.topY + CONTACT_EPSILON * 0.5, basket.position.z - 0.025)
      basketShadow.material.opacity = basketPresence * 0.27
      basketShadow.visible = basketShadow.material.opacity > 0.002
      if (p >= 0.688) arcPosition(doughOnBoard, doughInBasket, basketPlace, 0.28, dough.mesh.position)
      const proofMotePresence = overlap(p, 0.69, 0.82, 0.022)
      proofMotes.visible = proofMotePresence > 0.002
      proofMoteMaterial.opacity = proofMotePresence * 0.22
      proofMoteSeeds.forEach((seed, index) => {
        const driftTime = currentQuality.reducedMotion ? 0.35 : ambient
        proofMotePositions[index * 3] = seed.x + Math.sin(driftTime * 0.18 + seed.phase) * 0.08
        proofMotePositions[index * 3 + 1] = seed.y + Math.sin(driftTime * 0.11 + seed.phase) * 0.09
        proofMotePositions[index * 3 + 2] = seed.z + Math.cos(driftTime * 0.16 + seed.phase) * 0.05
      })
      proofMoteGeometry.attributes.position.needsUpdate = true

      const ovenEnter = windowProgress(p, 0.738, 0.812)
      const ovenExit = windowProgress(p, 0.95, 0.988)
      ovenModel.group.position.set(0, 0, -1.4 - 3.2 * (1 - ovenEnter) - ovenExit * 0.25)
      visibility.oven.set(windowProgress(p, 0.735, 0.792) * (1 - windowProgress(p, 0.965, 0.993)))
      const peelIn = windowProgress(p, 0.77, 0.808)
      const intoOven = windowProgress(p, 0.808, 0.858)
      const peelRetract = windowProgress(p, 0.858, 0.9, weightedOut)
      let peelZ = T.MathUtils.lerp(1.2, 0.12, peelIn)
      if (intoOven > 0) peelZ = T.MathUtils.lerp(0.12, ovenDestination.z, intoOven)
      if (peelRetract > 0) peelZ = T.MathUtils.lerp(ovenDestination.z, 1.45, peelRetract)
      peel.position.set(0, peelGroundY, peelZ)
      visibility.peel.set(windowProgress(p, 0.765, 0.8) * (1 - windowProgress(p, 0.88, 0.91)))
      if (p >= 0.808) arcPosition(doughInBasket, ovenDestination, intoOven, 0.22, dough.mesh.position)
      const glow = windowProgress(p, 0.732, 0.83) * (1 - ovenExit)
      ovenModel.glow.material.opacity = glow * (0.3 + Math.sin(ambient * 3.1) * 0.025)
      ovenModel.embers.forEach((ember, index) => {
        const flicker = 0.86 + Math.sin(ambient * (1.7 + index * 0.07) + ember.userData.phase) * 0.13 + Math.sin(ambient * 3.3 + index) * 0.05
        ember.material.emissiveIntensity = glow * (0.38 + flicker * 0.44)
        const coalScale = 0.92 + glow * flicker * 0.12
        ember.scale.set(coalScale, coalScale * 0.58, coalScale * 0.84)
      })

      const finish = windowProgress(p, 0.925, 0.972)
      finalBoard.position.set(0, 0, 0.48)
      visibility.final.set(windowProgress(p, 0.94, 0.97))
      if (p >= 0.925) arcPosition(ovenDestination, finalDestination, finish, 0.28 * flourish, dough.mesh.position)
      dough.mesh.rotation.y += finish * -0.12
      const knifeCut = windowProgress(p, 0.989, 0.997)
      // The loaf keeps valid baked topology through the knife travel; the
      // blade motion sells the cut. At the handoff the tracked clip plane
      // opens the loaf exactly where the matching cap and fitted slice appear
      // behind the blade. Solid pieces use discrete visibility, never opacity.
      const cutHandoff = p >= 0.9985
      const sliceSeparate = windowProgress(p, 0.998, 1)
      sampleVectorSplineKeyframes(p, knifePositionKeys, knifePosition)
      sampleVectorSplineKeyframes(p, knifeRotationKeys, knifeRotation)
      knife.position.copy(knifePosition)
      knife.rotation.set(knifeRotation.x, knifeRotation.y, knifeRotation.z)
      visibility.knife.set(overlap(p, 0.965, 1, 0.007))
      if (cutHandoff) {
        dough.mesh.getWorldQuaternion(_clipQuat)
        _clipNormal.set(-1, 0, 0).applyQuaternion(_clipQuat)
        _clipPoint.set(BAKED_CUT_X, 0.45, 0).applyMatrix4(dough.mesh.matrixWorld)
        dough.clipPlane.normal.copy(_clipNormal)
        dough.clipPlane.constant = -_clipNormal.dot(_clipPoint)
      } else {
        dough.clipPlane.constant = 1e5
      }
      cutDetails.mainCut.visible = cutHandoff
      cutDetails.slice.visible = p >= 0.9988
      // The slice starts fitted exactly onto the loaf; only pose changes after.
      cutDetails.slice.position.set(sliceSeparate * 0.32, -sliceSeparate * 0.018, sliceSeparate * 0.1)
      cutDetails.slice.rotation.z = -sliceSeparate * 0.1
      cutDetails.crumbs.forEach(({ crumb, delay, x, z, stretch, drift }, index) => {
        const fall = clamp01((knifeCut - delay) / 0.42)
        crumb.visible = fall > 0.002
        const growth = windowProgress(fall, 0, 0.28)
        crumb.scale.set(growth * stretch, growth * (0.72 + (index % 2) * 0.25), growth)
        crumb.position.set(x + fall * (0.06 + index * 0.006) + drift * fall, 0.62 - fall * (0.55 + (index % 3) * 0.03), z + Math.sin(index * 2.3) * fall * 0.08)
        crumb.rotation.set(fall * index, fall * 2.1, fall * 0.7)
      })
      const airborne = Math.max(bell(liftOut), bell(basketPlace), bell(intoOven), bell(finish))
      const contactStrength = p < 0.808 ? 0.4 : p < 0.925 ? 0.32 : 0.5
      const doughShadowOpacity = windowProgress(p, 0.61, 0.635) * contactStrength * (1 - airborne * 0.9)
      const doughSupportY = p < 0.808
        ? worktopSurface.topY + CONTACT_EPSILON * 0.5
        : p < 0.925
          ? ovenModel.floorSurfaceY + CONTACT_EPSILON * 0.5
          : finalBoardSurface.topY + CONTACT_EPSILON * 0.5
      doughShadow.position.set(dough.mesh.position.x + sliceSeparate * 0.12, doughSupportY, dough.mesh.position.z)
      doughShadow.scale.set(1 + sliceSeparate * 0.14, 1 + sliceSeparate * 0.05, 1)
      doughShadow.visible = doughShadowOpacity > 0.002
      doughShadow.material.opacity = doughShadowOpacity
      steam.position.copy(dough.mesh.position)
      const steamOpacity = delayed(p, 0.863, 0.93, 0.1) * 0.13
      steam.visible = steamOpacity > 0.002 && !currentQuality.reducedMotion
      steamMaterial.opacity = steamOpacity
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

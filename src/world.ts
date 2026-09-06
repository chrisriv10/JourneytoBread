import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { damp, dampVector, sampleNumberKeyframes, sampleVectorKeyframes, softIn, windowProgress, type Keyframe } from './motion'
import { createJourneySequence, type JourneySequence, type SequenceContext } from './models'
import type { JourneyState, PointerState, QualityConfig } from './types'
import { STAGES } from './types'
import { PALETTE } from './geometry'

type ColorKeyframe = Keyframe<THREE.Color>

const cameraPositionKeys: Keyframe<THREE.Vector3>[] = [
  { at: 0, value: new THREE.Vector3(-0.82, 1.1, 5.25) },
  { at: 0.08, value: new THREE.Vector3(-0.54, 1.2, 4.6) },
  { at: 0.15, value: new THREE.Vector3(0.82, 1.72, 4.25) },
  { at: 0.22, value: new THREE.Vector3(0.95, 1.76, 4.15) },
  { at: 0.3, value: new THREE.Vector3(-1.44, 1.42, 4.9) },
  { at: 0.37, value: new THREE.Vector3(1.2, 1.88, 4.82) },
  { at: 0.45, value: new THREE.Vector3(0.88, 2.72, 5.15) },
  { at: 0.53, value: new THREE.Vector3(0.84, 2.46, 4.7) },
  { at: 0.63, value: new THREE.Vector3(-0.82, 1.72, 4.18) },
  { at: 0.74, value: new THREE.Vector3(0.5, 2.02, 4.45) },
  { at: 0.85, value: new THREE.Vector3(-0.82, 1.45, 4.02) },
  { at: 0.93, value: new THREE.Vector3(1.02, 2.06, 4.85) },
  { at: 0.975, value: new THREE.Vector3(1.8, 1.66, 5.12) },
  { at: 0.99, value: new THREE.Vector3(2.58, 1.62, 4.72) },
  { at: 1, value: new THREE.Vector3(3.15, 1.58, 4.45) },
]

const cameraLookKeys: Keyframe<THREE.Vector3>[] = [
  { at: 0, value: new THREE.Vector3(-0.2, 1.48, -0.02) },
  { at: 0.13, value: new THREE.Vector3(-0.04, 1.7, 0.34) },
  { at: 0.22, value: new THREE.Vector3(0.08, 1.48, 0.4) },
  { at: 0.3, value: new THREE.Vector3(0.06, 0.73, -0.22) },
  { at: 0.37, value: new THREE.Vector3(-0.38, 0.42, 0.25) },
  { at: 0.45, value: new THREE.Vector3(0.28, 0.3, 0.22) },
  { at: 0.53, value: new THREE.Vector3(0.02, 0.38, 0.16) },
  { at: 0.63, value: new THREE.Vector3(0.02, 0.3, 0.12) },
  { at: 0.74, value: new THREE.Vector3(0.02, 0.32, 0.14) },
  { at: 0.85, value: new THREE.Vector3(0.02, 0.68, -1.4) },
  { at: 0.93, value: new THREE.Vector3(0.14, 0.25, 0.46) },
  { at: 1, value: new THREE.Vector3(0.02, 0.42, 0.47) },
]

const cameraFovKeys: Keyframe<number>[] = [
  { at: 0, value: 32 },
  { at: 0.13, value: 28 },
  { at: 0.22, value: 27 },
  { at: 0.3, value: 34 },
  { at: 0.45, value: 35 },
  { at: 0.63, value: 31 },
  { at: 0.74, value: 33 },
  { at: 0.85, value: 36 },
  { at: 0.93, value: 34 },
  { at: 1, value: 31 },
]

const backgroundKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(PALETTE.night) },
  { at: 0.08, value: new THREE.Color(0x121b11) },
  { at: 0.17, value: new THREE.Color(0x293722) },
  { at: 0.25, value: new THREE.Color(0x35402b) },
  { at: 0.34, value: new THREE.Color(0x47473b) },
  { at: 0.43, value: new THREE.Color(0x7f7b65) },
  { at: 0.5, value: new THREE.Color(0xb0a58a) },
  { at: 0.66, value: new THREE.Color(0xa59678) },
  { at: 0.75, value: new THREE.Color(0x80735d) },
  { at: 0.82, value: new THREE.Color(0x21150f) },
  { at: 0.93, value: new THREE.Color(0x120b08) },
  { at: 1, value: new THREE.Color(0x080908) },
]

const keyLightColorKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(0xb7c58d) },
  { at: 0.16, value: new THREE.Color(0xf2c96f) },
  { at: 0.3, value: new THREE.Color(0xe7c891) },
  { at: 0.5, value: new THREE.Color(0xffe0ad) },
  { at: 0.74, value: new THREE.Color(0xf1c783) },
  { at: 0.84, value: new THREE.Color(0xff8a43) },
  { at: 1, value: new THREE.Color(0xffc17d) },
]

const keyLightPositionKeys: Keyframe<THREE.Vector3>[] = [
  { at: 0, value: new THREE.Vector3(-4.5, 6.2, 2.4) },
  { at: 0.18, value: new THREE.Vector3(-2.8, 5.4, 3.2) },
  { at: 0.32, value: new THREE.Vector3(3.4, 5.6, 3.6) },
  { at: 0.5, value: new THREE.Vector3(-3.8, 6.2, 3.4) },
  { at: 0.74, value: new THREE.Vector3(3.1, 5.4, 3.0) },
  { at: 0.84, value: new THREE.Vector3(-2.3, 3.4, 1.2) },
  { at: 1, value: new THREE.Vector3(-3.4, 4.8, 3.2) },
]

const ambientIntensityKeys: Keyframe<number>[] = [
  { at: 0, value: 0.035 }, { at: 0.2, value: 0.065 }, { at: 0.48, value: 0.11 },
  { at: 0.68, value: 0.09 }, { at: 0.84, value: 0.025 }, { at: 1, value: 0.025 },
]

const fillIntensityKeys: Keyframe<number>[] = [
  { at: 0, value: 0.34 }, { at: 0.16, value: 0.48 }, { at: 0.34, value: 0.42 },
  { at: 0.5, value: 0.64 }, { at: 0.68, value: 0.56 }, { at: 0.84, value: 0.2 },
  { at: 1, value: 0.18 },
]

const keyIntensityKeys: Keyframe<number>[] = [
  { at: 0, value: 2.0 }, { at: 0.16, value: 2.7 }, { at: 0.3, value: 3.0 },
  { at: 0.5, value: 2.55 }, { at: 0.68, value: 2.7 }, { at: 0.76, value: 2.25 },
  { at: 0.84, value: 1.85 }, { at: 1, value: 3.15 },
]

const exposureKeys: Keyframe<number>[] = [
  { at: 0, value: 0.84 }, { at: 0.18, value: 0.92 }, { at: 0.5, value: 0.9 },
  { at: 0.74, value: 0.86 }, { at: 0.84, value: 0.78 }, { at: 1, value: 0.94 },
]

const fogDensityKeys: Keyframe<number>[] = [
  { at: 0, value: 0.052 }, { at: 0.14, value: 0.042 }, { at: 0.28, value: 0.027 },
  { at: 0.37, value: 0.038 }, { at: 0.48, value: 0.021 }, { at: 0.74, value: 0.024 },
  { at: 0.85, value: 0.04 }, { at: 1, value: 0.03 },
]

function sampleColorKeyframes(progress: number, keyframes: ColorKeyframe[], target: THREE.Color) {
  const p = THREE.MathUtils.clamp(progress, 0, 1)
  if (p <= keyframes[0].at) return target.copy(keyframes[0].value)
  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1]
    const current = keyframes[index]
    if (p <= current.at) {
      const local = THREE.MathUtils.clamp((p - previous.at) / (current.at - previous.at), 0, 1)
      return target.lerpColors(previous.value, current.value, softIn(local))
    }
  }
  return target.copy(keyframes[keyframes.length - 1].value)
}

export class JourneyWorld {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  readonly renderer: THREE.WebGLRenderer
  readonly root = new THREE.Group()
  readonly pointer: PointerState = { x: 0, y: 0, targetX: 0, targetY: 0 }

  private readonly quality: QualityConfig
  private readonly container: HTMLElement
  private readonly onStateChange?: (state: JourneyState) => void
  private previousTime = 0
  private readonly sequence: JourneySequence
  private readonly lookTarget = new THREE.Vector3()
  private readonly desiredLook = new THREE.Vector3()
  private readonly cameraTarget = new THREE.Vector3()
  private readonly reducedCamera = new THREE.Vector3(0, 3, 7.8)
  private readonly lightTarget = new THREE.Vector3()
  private readonly backgroundColor = new THREE.Color(PALETTE.night)
  private readonly keyLightColor = new THREE.Color()
  private readonly fillLightColor = new THREE.Color(0xb9c29d)
  private readonly groundLightColor = new THREE.Color(0x101311)
  private readonly fillLight: THREE.HemisphereLight
  private readonly keyLight: THREE.DirectionalLight
  private readonly ovenLight: THREE.PointLight
  private readonly breadLight: THREE.PointLight
  private readonly ambientLight: THREE.AmbientLight
  private progress = 0
  private elapsed = 0
  private animationFrame = 0
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private resizeObserver: ResizeObserver | null = null
  private disposed = false

  constructor(container: HTMLElement, quality: QualityConfig, onStateChange?: (state: JourneyState) => void) {
    this.container = container
    this.quality = quality
    this.onStateChange = onStateChange

    this.scene.background = this.backgroundColor
    this.scene.fog = new THREE.FogExp2(PALETTE.night, 0.028)
    this.scene.add(this.root)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    })
    this.renderer.setPixelRatio(quality.dpr)
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.92
    this.renderer.shadowMap.enabled = quality.shadows
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.renderer.domElement.className = 'journey-canvas'
    this.container.appendChild(this.renderer.domElement)

    if (quality.bloom) {
      const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.tier === 'high' ? 4 : 0 })
      this.composer = new EffectComposer(this.renderer, renderTarget)
      this.composer.addPass(new RenderPass(this.scene, this.camera))
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.06, 0.32, 0.86)
      this.composer.addPass(this.bloom)
      this.composer.addPass(new OutputPass())
    }

    this.ambientLight = new THREE.AmbientLight(0xfff5e6, 0.035)
    this.fillLight = new THREE.HemisphereLight(this.fillLightColor, this.groundLightColor, 0.34)
    this.keyLight = new THREE.DirectionalLight(0xffd58d, 2.25)
    this.keyLight.castShadow = quality.shadows
    this.keyLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
    this.keyLight.shadow.camera.near = 0.1
    this.keyLight.shadow.camera.far = 30
    this.keyLight.shadow.camera.left = -6
    this.keyLight.shadow.camera.right = 6
    this.keyLight.shadow.camera.top = 6
    this.keyLight.shadow.camera.bottom = -6
    this.keyLight.shadow.normalBias = 0.025
    this.keyLight.shadow.bias = -0.0002
    this.keyLight.shadow.radius = 2
    this.keyLight.shadow.blurSamples = 8
    this.ovenLight = new THREE.PointLight(PALETTE.ember, 0, 6, 2)
    this.ovenLight.position.set(-0.55, 0.46, -1.1)
    this.breadLight = new THREE.PointLight(0xffc992, 0, 5.5, 2)
    this.breadLight.position.set(2.5, 2.15, 1.45)
    this.keyLight.target.position.set(0, 0.35, 0)
    this.scene.add(this.ambientLight, this.fillLight, this.keyLight, this.keyLight.target, this.ovenLight, this.breadLight)

    this.sequence = createJourneySequence(quality)
    this.root.add(this.sequence.group)

    this.setupEvents()
    this.resize()
    this.camera.position.copy(cameraPositionKeys[0].value)
    this.lookTarget.copy(cameraLookKeys[0].value)
    this.setProgress(0)
    this.animationFrame = requestAnimationFrame(this.render)
  }

  getState(): JourneyState {
    const stage = [...STAGES].reverse().find((candidate) => this.progress >= candidate.start) ?? STAGES[0]
    return {
      progress: this.progress,
      stageIndex: STAGES.indexOf(stage) + 1,
      stageLabel: stage.label,
      remainingSeconds: Math.round(120 * (1 - this.progress)),
    }
  }

  setProgress(progress: number) {
    this.progress = THREE.MathUtils.clamp(progress, 0, 1)
    const state = this.getState()
    this.onStateChange?.(state)
    return state
  }

  readonly resize = () => {
    const width = this.container.clientWidth || window.innerWidth
    const height = this.container.clientHeight || window.innerHeight
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(this.quality.dpr)
    this.renderer.setSize(width, height, false)
    this.composer?.setSize(width, height)
  }

  destroy() {
    this.disposed = true
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver?.disconnect()
    window.removeEventListener('pointermove', this.handlePointer)
    window.removeEventListener('resize', this.resize)
    this.renderer.dispose()
    this.composer?.dispose()
    this.root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
      materials.forEach((entry) => entry.dispose())
    })
    this.container.replaceChildren()
  }

  private readonly handlePointer = (event: PointerEvent) => {
    this.pointer.targetX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2
    this.pointer.targetY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2
  }

  private readonly render = (timestamp: number) => {
    if (this.disposed) return
    const delta = this.previousTime ? Math.min((timestamp - this.previousTime) / 1000, 0.05) : 1 / 60
    this.previousTime = timestamp
    this.elapsed += delta
    const pointerLambda = this.quality.reducedMotion ? 16 : 8
    this.pointer.x = damp(this.pointer.x, this.pointer.targetX, pointerLambda, delta)
    this.pointer.y = damp(this.pointer.y, this.pointer.targetY, pointerLambda, delta)

    const context: SequenceContext = {
      progress: this.progress,
      time: this.elapsed,
      delta,
      pointer: this.pointer,
      quality: this.quality,
    }
    this.sequence.update(context)
    this.updateCamera(context)
    this.updateLighting(context)

    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
    this.animationFrame = requestAnimationFrame(this.render)
  }

  private setupEvents() {
    window.addEventListener('pointermove', this.handlePointer, { passive: true })
    window.addEventListener('resize', this.resize, { passive: true })
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(this.container)
    }
  }

  private updateCamera(context: SequenceContext) {
    const pointerAmount = context.quality.reducedMotion ? 0 : 1
    sampleVectorKeyframes(context.progress, cameraPositionKeys, this.cameraTarget)
    sampleVectorKeyframes(context.progress, cameraLookKeys, this.desiredLook)
    if (context.quality.reducedMotion) {
      // Keep most chapters calm and wide in reduced-motion mode, but preserve
      // the authored three-quarter product angle once the final cut settles.
      const reducedBlend = 0.8 * (1 - windowProgress(context.progress, 0.965, 0.998))
      this.cameraTarget.lerp(this.reducedCamera, reducedBlend)
    }
    // Preserve the authored horizontal composition in portrait viewports.
    const portraitFit = Math.max(1, 1.22 / this.camera.aspect)
    this.cameraTarget.sub(this.desiredLook).multiplyScalar(portraitFit).add(this.desiredLook)
    this.cameraTarget.x += context.pointer.x * 0.12 * pointerAmount
    this.cameraTarget.y += context.pointer.y * -0.06 * pointerAmount
    dampVector(this.camera.position, this.cameraTarget, context.quality.reducedMotion ? 16 : 7, context.delta)

    this.desiredLook.x += context.pointer.x * 0.045 * pointerAmount
    this.desiredLook.y += context.pointer.y * -0.03 * pointerAmount
    dampVector(this.lookTarget, this.desiredLook, context.quality.reducedMotion ? 16 : 7, context.delta)
    this.camera.lookAt(this.lookTarget)

    const fov = sampleNumberKeyframes(context.progress, cameraFovKeys)
    const nextFov = damp(this.camera.fov, fov, context.quality.reducedMotion ? 16 : 6, context.delta)
    if (Math.abs(this.camera.fov - nextFov) > 0.001) {
      this.camera.fov = nextFov
      this.camera.updateProjectionMatrix()
    }
  }

  private updateLighting(context: SequenceContext) {
    const p = context.progress
    sampleColorKeyframes(p, backgroundKeys, this.backgroundColor)
    this.scene.background = this.backgroundColor
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.copy(this.backgroundColor)

    sampleColorKeyframes(p, keyLightColorKeys, this.keyLightColor)
    this.keyLight.color.copy(this.keyLightColor)
    sampleVectorKeyframes(p, keyLightPositionKeys, this.lightTarget)
    const proofQuiet = windowProgress(p, 0.68, 0.71) * (1 - windowProgress(p, 0.775, 0.81))
    if (!context.quality.reducedMotion) {
      this.lightTarget.x += Math.sin(this.elapsed * 0.12) * proofQuiet * 0.42
      this.lightTarget.z += Math.cos(this.elapsed * 0.09) * proofQuiet * 0.22
    }
    this.keyLight.position.copy(this.lightTarget)
    this.keyLight.target.position.set(0, 0.32 + windowProgress(p, 0.72, 0.86) * 0.35, -windowProgress(p, 0.72, 0.86) * 1.2 + windowProgress(p, 0.9, 1) * 1.65)

    const ovenWarmth = windowProgress(p, 0.753, 0.829) * (1 - windowProgress(p, 0.925, 0.98))
    const finishWarmth = windowProgress(p, 0.89, 1)
    this.ambientLight.intensity = damp(this.ambientLight.intensity, sampleNumberKeyframes(p, ambientIntensityKeys), 5, context.delta)
    this.fillLight.intensity = damp(this.fillLight.intensity, sampleNumberKeyframes(p, fillIntensityKeys), 5, context.delta)
    this.keyLight.intensity = damp(this.keyLight.intensity, sampleNumberKeyframes(p, keyIntensityKeys), 5, context.delta)
    this.ovenLight.intensity = damp(this.ovenLight.intensity, ovenWarmth * 2.55, 8, context.delta)
    this.breadLight.intensity = damp(this.breadLight.intensity, finishWarmth * 2.25, 6, context.delta)
    this.renderer.toneMappingExposure = damp(this.renderer.toneMappingExposure, sampleNumberKeyframes(p, exposureKeys), 4, context.delta)
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = damp(this.scene.fog.density, sampleNumberKeyframes(p, fogDensityKeys), 5, context.delta)
    }

    if (this.bloom) {
      this.bloom.strength = 0.045 + ovenWarmth * 0.12 + finishWarmth * 0.035
      this.bloom.radius = 0.28 + ovenWarmth * 0.12
      this.bloom.threshold = 0.84
    }
  }
}

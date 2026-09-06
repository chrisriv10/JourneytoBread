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
  { at: 0, value: new THREE.Vector3(0, 1.36, 7.8) },
  { at: 0.12, value: new THREE.Vector3(0, 1.22, 6.15) },
  { at: 0.25, value: new THREE.Vector3(0.58, 1.52, 6.85) },
  { at: 0.4, value: new THREE.Vector3(0.1, 4.3, 6.9) },
  { at: 0.53, value: new THREE.Vector3(0.15, 3.2, 6.6) },
  { at: 0.64, value: new THREE.Vector3(0, 2.8, 6.5) },
  { at: 0.74, value: new THREE.Vector3(0, 2.7, 6.4) },
  { at: 0.84, value: new THREE.Vector3(0.12, 1.85, 6.2) },
  { at: 0.94, value: new THREE.Vector3(0.4, 2.9, 6.5) },
  { at: 1, value: new THREE.Vector3(0.3, 3, 6.6) },
]

const cameraLookKeys: Keyframe<THREE.Vector3>[] = [
  { at: 0, value: new THREE.Vector3(0, 1.3, 0.05) },
  { at: 0.12, value: new THREE.Vector3(-0.08, 1.5, 0.12) },
  { at: 0.25, value: new THREE.Vector3(0, 0.55, 0.05) },
  { at: 0.42, value: new THREE.Vector3(0, 0.32, 0.05) },
  { at: 0.58, value: new THREE.Vector3(0, 0.36, 0.04) },
  { at: 0.72, value: new THREE.Vector3(0, 0.26, 0.04) },
  { at: 0.84, value: new THREE.Vector3(0, 0.8, -1.3) },
  { at: 0.95, value: new THREE.Vector3(0, -0.34, 0.22) },
  { at: 1, value: new THREE.Vector3(0, -0.36, 0.22) },
]

const cameraFovKeys: Keyframe<number>[] = [
  { at: 0, value: 34 },
  { at: 0.22, value: 32 },
  { at: 0.45, value: 35 },
  { at: 0.7, value: 34 },
  { at: 0.84, value: 37 },
  { at: 1, value: 33 },
]

const backgroundKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(PALETTE.night) },
  { at: 0.12, value: new THREE.Color(0x31442a) },
  { at: 0.28, value: new THREE.Color(0x536344) },
  { at: 0.48, value: new THREE.Color(0x9b9a70) },
  { at: 0.66, value: new THREE.Color(0xc2b596) },
  { at: 0.82, value: new THREE.Color(0x2b2118) },
  { at: 1, value: new THREE.Color(0x0a0d0c) },
]

const keyLightColorKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(0xc5d09c) },
  { at: 0.3, value: new THREE.Color(0xffd58d) },
  { at: 0.66, value: new THREE.Color(0xffe0a2) },
  { at: 0.82, value: new THREE.Color(0xff9b52) },
  { at: 1, value: new THREE.Color(0xffc17d) },
]

const keyLightPositionKeys: Keyframe<THREE.Vector3>[] = [
  { at: 0, value: new THREE.Vector3(-4, 7, 5) },
  { at: 0.46, value: new THREE.Vector3(-3.5, 6, 4) },
  { at: 0.82, value: new THREE.Vector3(-2.5, 4.5, 2.5) },
  { at: 1, value: new THREE.Vector3(3, 5, 4) },
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

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.2)
    this.fillLight = new THREE.HemisphereLight(this.fillLightColor, this.groundLightColor, 1.25)
    this.keyLight = new THREE.DirectionalLight(0xffd58d, 2.25)
    this.keyLight.castShadow = quality.shadows
    this.keyLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
    this.keyLight.shadow.camera.near = 0.1
    this.keyLight.shadow.camera.far = 30
    this.keyLight.shadow.camera.left = -10
    this.keyLight.shadow.camera.right = 10
    this.keyLight.shadow.camera.top = 10
    this.keyLight.shadow.camera.bottom = -10
    this.keyLight.shadow.normalBias = 0.025
    this.keyLight.shadow.bias = -0.0002
    this.ovenLight = new THREE.PointLight(PALETTE.ember, 0, 9, 2)
    this.ovenLight.position.set(-1.1, 0.35, -1.85)
    this.breadLight = new THREE.PointLight(0xffc17c, 0, 7, 2)
    this.breadLight.position.set(1.7, 2.1, 3.6)
    this.scene.add(this.ambientLight, this.fillLight, this.keyLight, this.ovenLight, this.breadLight)

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
      this.cameraTarget.lerp(this.reducedCamera, 0.8)
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
    this.keyLight.position.copy(this.lightTarget)

    const ovenWarmth = windowProgress(p, 0.753, 0.829) * (1 - windowProgress(p, 0.925, 0.98))
    const finishWarmth = windowProgress(p, 0.89, 1)
    this.ambientLight.intensity = damp(this.ambientLight.intensity, 0.16 + finishWarmth * 0.22, 5, context.delta)
    this.fillLight.intensity = damp(this.fillLight.intensity, 1.2 + (1 - ovenWarmth) * 0.22, 5, context.delta)
    this.keyLight.intensity = damp(this.keyLight.intensity, 2.1 + ovenWarmth * 0.52 + finishWarmth * 0.28, 5, context.delta)
    this.ovenLight.intensity = damp(this.ovenLight.intensity, ovenWarmth * 0.9, 8, context.delta)
    this.breadLight.intensity = damp(this.breadLight.intensity, finishWarmth * 1.1, 6, context.delta)

    if (this.bloom) {
      this.bloom.strength = 0.045 + ovenWarmth * 0.12 + finishWarmth * 0.035
      this.bloom.radius = 0.28 + ovenWarmth * 0.12
      this.bloom.threshold = 0.84
    }
  }
}

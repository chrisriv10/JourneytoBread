import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import {
  criticallyDamped,
  damp,
  sampleNumberSplineKeyframes,
  sampleVectorSplineKeyframes,
  softIn,
  windowProgress,
  type Keyframe,
  type SplineKeyframe,
} from './motion'
import { createJourneySequence, type JourneySequence, type SequenceContext } from './models'
import type { JourneyState, PointerState, QualityConfig } from './types'
import { PLAYBACK_DURATION_SECONDS, STAGES } from './types'
import { PALETTE } from './geometry'

type ColorKeyframe = Keyframe<THREE.Color>

const cameraPositionKeys: SplineKeyframe<THREE.Vector3>[] = [
  { at: 0, value: new THREE.Vector3(-0.82, 1.1, 5.25) },
  { at: 0.205, value: new THREE.Vector3(0.56, 1.72, 4.1), tension: 0.42 },
  { at: 0.31, value: new THREE.Vector3(-0.1, 1.46, 4.42) },
  { at: 0.41, value: new THREE.Vector3(0.08, 1.44, 4.16), tension: 0.3 },
  { at: 0.5, value: new THREE.Vector3(0.55, 2.42, 4.88) },
  { at: 0.62, value: new THREE.Vector3(0.04, 1.86, 4.36) },
  { at: 0.74, value: new THREE.Vector3(0.18, 2, 4.42), tension: 0.84 },
  { at: 0.855, value: new THREE.Vector3(-0.46, 1.5, 4.05) },
  { at: 0.945, value: new THREE.Vector3(0.3, 1.74, 4.62) },
  { at: 1, value: new THREE.Vector3(0.75, 1.66, 4.35) },
]

const cameraLookKeys: SplineKeyframe<THREE.Vector3>[] = [
  { at: 0, value: new THREE.Vector3(-0.2, 1.48, -0.02) },
  { at: 0.205, value: new THREE.Vector3(0, 1.54, 0.55), tension: 0.5 },
  { at: 0.31, value: new THREE.Vector3(0, 0.78, -0.35) },
  { at: 0.41, value: new THREE.Vector3(0.16, 0.29, 1.05), tension: 0.3 },
  { at: 0.56, value: new THREE.Vector3(0, 0.39, 0.16) },
  { at: 0.74, value: new THREE.Vector3(0, 0.32, 0.14), tension: 0.85 },
  { at: 0.855, value: new THREE.Vector3(0, 0.68, -1.4) },
  { at: 0.93, value: new THREE.Vector3(0.01, 0.5, -0.35) },
  { at: 1, value: new THREE.Vector3(0.02, 0.42, 0.47) },
]

const cameraFovKeys: SplineKeyframe<number>[] = [
  { at: 0, value: 32 },
  { at: 0.205, value: 27, tension: 0.48 },
  { at: 0.33, value: 32.5 },
  { at: 0.55, value: 34 },
  { at: 0.74, value: 31.5, tension: 0.7 },
  { at: 0.86, value: 35.5 },
  { at: 1, value: 31 },
]

const backgroundKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(PALETTE.night) },
  { at: 0.08, value: new THREE.Color(0x121b11) },
  { at: 0.17, value: new THREE.Color(0x293722) },
  { at: 0.25, value: new THREE.Color(0x35402b) },
  { at: 0.34, value: new THREE.Color(0x47473b) },
  { at: 0.43, value: new THREE.Color(0x5f5949) },
  { at: 0.5, value: new THREE.Color(0x6e6352) },
  { at: 0.66, value: new THREE.Color(0x6c5e48) },
  { at: 0.75, value: new THREE.Color(0x554533) },
  { at: 0.82, value: new THREE.Color(0x21150f) },
  { at: 0.93, value: new THREE.Color(0x120b08) },
  { at: 1, value: new THREE.Color(0x080908) },
]

const backdropTopKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(0x080c0a) },
  { at: 0.17, value: new THREE.Color(0x172418) },
  { at: 0.32, value: new THREE.Color(0x3a392f) },
  { at: 0.48, value: new THREE.Color(0x7a7264) },
  { at: 0.66, value: new THREE.Color(0x685b49) },
  { at: 0.75, value: new THREE.Color(0x746047) },
  { at: 0.83, value: new THREE.Color(0x130b08) },
  { at: 1, value: new THREE.Color(0x050605) },
]

const backdropBottomKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(0x081008) },
  { at: 0.17, value: new THREE.Color(0x273820) },
  { at: 0.32, value: new THREE.Color(0x25251e) },
  { at: 0.48, value: new THREE.Color(0x43392d) },
  { at: 0.66, value: new THREE.Color(0x34291f) },
  { at: 0.75, value: new THREE.Color(0x3d2d1f) },
  { at: 0.83, value: new THREE.Color(0x090504) },
  { at: 1, value: new THREE.Color(0x080504) },
]

const backdropGlowKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(0x9d7a32) },
  { at: 0.22, value: new THREE.Color(0xd4a852) },
  { at: 0.38, value: new THREE.Color(0xc2aa79) },
  { at: 0.62, value: new THREE.Color(0xf0c98e) },
  { at: 0.76, value: new THREE.Color(0xd8a45d) },
  { at: 0.86, value: new THREE.Color(0xb53d16) },
  { at: 1, value: new THREE.Color(0xa34b20) },
]

const backdropGlowStrengthKeys: SplineKeyframe<number>[] = [
  { at: 0, value: 0.08 }, { at: 0.16, value: 0.17 }, { at: 0.34, value: 0.08 },
  { at: 0.5, value: 0.085 }, { at: 0.68, value: 0.075 }, { at: 0.76, value: 0.07 },
  { at: 0.86, value: 0.14 }, { at: 1, value: 0.11 },
]

const keyLightColorKeys: ColorKeyframe[] = [
  { at: 0, value: new THREE.Color(0xb7c58d) },
  { at: 0.16, value: new THREE.Color(0xf2c96f) },
  { at: 0.3, value: new THREE.Color(0xe7c891) },
  { at: 0.5, value: new THREE.Color(0xffe0ad) },
  { at: 0.74, value: new THREE.Color(0xf1c783) },
  { at: 0.82, value: new THREE.Color(0xf6c184) },
  { at: 0.865, value: new THREE.Color(0xff8840) },
  { at: 1, value: new THREE.Color(0xffd2a2) },
]

const keyLightPositionKeys: SplineKeyframe<THREE.Vector3>[] = [
  { at: 0, value: new THREE.Vector3(-4.5, 6.2, 2.4) },
  { at: 0.18, value: new THREE.Vector3(-2.8, 5.4, 3.2) },
  { at: 0.32, value: new THREE.Vector3(3.4, 5.6, 3.6) },
  { at: 0.5, value: new THREE.Vector3(-3.8, 6.2, 3.4) },
  { at: 0.74, value: new THREE.Vector3(3.1, 5.4, 3.0) },
  { at: 0.84, value: new THREE.Vector3(-2.3, 3.4, 1.2) },
  { at: 1, value: new THREE.Vector3(-3.4, 4.8, 3.2) },
]

const ambientIntensityKeys: SplineKeyframe<number>[] = [
  { at: 0, value: 0.035 }, { at: 0.2, value: 0.065 }, { at: 0.48, value: 0.11 },
  { at: 0.68, value: 0.09 }, { at: 0.84, value: 0.025 }, { at: 1, value: 0.032 },
]

const fillIntensityKeys: SplineKeyframe<number>[] = [
  { at: 0, value: 0.34 }, { at: 0.16, value: 0.48 }, { at: 0.34, value: 0.42 },
  { at: 0.5, value: 0.64 }, { at: 0.68, value: 0.56 }, { at: 0.84, value: 0.2 },
  { at: 1, value: 0.27 },
]

const keyIntensityKeys: SplineKeyframe<number>[] = [
  { at: 0, value: 2.0 }, { at: 0.16, value: 2.7 }, { at: 0.3, value: 3.0 },
  { at: 0.5, value: 2.55 }, { at: 0.68, value: 2.7 }, { at: 0.76, value: 2.25 },
  { at: 0.84, value: 1.85 }, { at: 1, value: 2.95 },
]

const exposureKeys: SplineKeyframe<number>[] = [
  { at: 0, value: 0.84 }, { at: 0.18, value: 0.92 }, { at: 0.5, value: 0.9 },
  { at: 0.74, value: 0.86 }, { at: 0.84, value: 0.78 }, { at: 1, value: 0.92 },
]

const fogDensityKeys: SplineKeyframe<number>[] = [
  { at: 0, value: 0.052 }, { at: 0.14, value: 0.042 }, { at: 0.28, value: 0.027 },
  { at: 0.37, value: 0.03 }, { at: 0.48, value: 0.021 }, { at: 0.74, value: 0.024 },
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
  private readonly orbitOffset = new THREE.Vector3()
  private readonly reducedCamera = new THREE.Vector3(0, 3, 7.8)
  private readonly lightTarget = new THREE.Vector3()
  private readonly backgroundColor = new THREE.Color(PALETTE.night)
  private readonly backdropTopColor = new THREE.Color(0x080c0a)
  private readonly backdropBottomColor = new THREE.Color(0x081008)
  private readonly backdropGlowColor = new THREE.Color(0x9d7a32)
  private readonly backdropMaterial: THREE.ShaderMaterial
  private readonly backdrop: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private readonly keyLightColor = new THREE.Color()
  private readonly fillLightColor = new THREE.Color(0xb9c29d)
  private readonly groundLightColor = new THREE.Color(0x101311)
  private readonly fillLight: THREE.HemisphereLight
  private readonly keyLight: THREE.DirectionalLight
  private readonly ovenLight: THREE.PointLight
  private readonly breadLight: THREE.PointLight
  private readonly ambientLight: THREE.AmbientLight
  private progress = 0
  private visualProgress = 0
  private visualVelocity = 0
  private elapsed = 0
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
    this.backdropMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: this.backdropTopColor },
        uBottom: { value: this.backdropBottomColor },
        uGlow: { value: this.backdropGlowColor },
        uGlowStrength: { value: 0.08 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uBottom;
        uniform vec3 uGlow;
        uniform float uGlowStrength;
        uniform vec2 uResolution;
        varying vec3 vLocal;
        void main() {
          vec2 uv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
          float vertical = smoothstep(0.02, 0.98, uv.y);
          vec3 color = mix(uBottom, uTop, vertical);
          vec2 offset = (uv - vec2(0.52, 0.46)) * vec2(1.0, 1.28);
          float radial = 1.0 - smoothstep(0.05, 0.72, length(offset));
          float horizon = exp(-pow((uv.y - 0.42) * 5.2, 2.0));
          color += uGlow * (radial * 0.72 + horizon * 0.28) * uGlowStrength;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    })
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(36, 32, 18), this.backdropMaterial)
    this.backdrop.name = 'journey-gradient-backdrop'
    this.backdrop.renderOrder = -1000
    this.backdrop.frustumCulled = false
    this.scene.add(this.backdrop, this.root)

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
    // Required for the finale loaf clip plane. Planes are parked far away
    // when inactive, so this costs nothing outside the cut handoff.
    this.renderer.localClippingEnabled = true
    this.renderer.shadowMap.enabled = quality.shadows
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.renderer.domElement.className = 'journey-canvas'
    this.container.appendChild(this.renderer.domElement)

    if (quality.bloom) {
      const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.tier === 'high' ? 2 : 0 })
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
    // A restrained finale-only fill preserves the pale crumb without lifting
    // the board or the surrounding dark product-shot environment.
    this.breadLight = new THREE.PointLight(0xffe0b8, 0, 4.2, 2)
    this.breadLight.position.set(2.05, 1.36, 1.12)
    this.keyLight.target.position.set(0, 0.35, 0)
    this.scene.add(this.ambientLight, this.fillLight, this.keyLight, this.keyLight.target, this.ovenLight, this.breadLight)

    this.sequence = createJourneySequence(quality)
    this.root.add(this.sequence.group)

    this.setupEvents()
    this.resize()
    this.camera.position.copy(cameraPositionKeys[0].value)
    this.lookTarget.copy(cameraLookKeys[0].value)
    this.setProgress(0)
  }

  getState(): JourneyState {
    const stage = [...STAGES].reverse().find((candidate) => this.progress >= candidate.start) ?? STAGES[0]
    return {
      progress: this.progress,
      stageIndex: STAGES.indexOf(stage) + 1,
      stageLabel: stage.label,
      remainingSeconds: Math.round(PLAYBACK_DURATION_SECONDS * (1 - this.progress)),
    }
  }

  getMotionState() {
    return { targetProgress: this.progress, visualProgress: this.visualProgress, visualVelocity: this.visualVelocity }
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
    const pixelRatio = this.renderer.getPixelRatio()
    ;(this.backdropMaterial.uniforms.uResolution.value as THREE.Vector2).set(width * pixelRatio, height * pixelRatio)
  }

  destroy() {
    this.disposed = true
    this.resizeObserver?.disconnect()
    window.removeEventListener('pointermove', this.handlePointer)
    window.removeEventListener('resize', this.resize)
    this.renderer.dispose()
    this.composer?.dispose()
    this.backdrop.geometry.dispose()
    this.backdropMaterial.dispose()
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

  // The controller calls this immediately after Lenis has sampled the current
  // scroll frame. Keeping both operations in one rAF prevents a one-frame
  // race between scroll input and the Three.js scene.
  renderFrame(timestamp: number) {
    if (this.disposed) return
    const delta = this.previousTime ? Math.min((timestamp - this.previousTime) / 1000, 0.05) : 1 / 60
    this.previousTime = timestamp
    this.elapsed += delta
    const pointerLambda = this.quality.reducedMotion ? 16 : 8
    this.pointer.x = damp(this.pointer.x, this.pointer.targetX, pointerLambda, delta)
    this.pointer.y = damp(this.pointer.y, this.pointer.targetY, pointerLambda, delta)

    const distance = Math.abs(this.progress - this.visualProgress)
    if (this.quality.reducedMotion) {
      this.visualProgress = this.progress
      this.visualVelocity = 0
    } else {
      // Lenis already smooths the physical scroll input. Keep this second
      // pass quick enough to preserve tiny intentional scrubs while retaining
      // critically damped continuity when the user reverses direction.
      const baseTime = this.quality.mobile ? 0.046 : this.quality.tier === 'high' ? 0.058 : 0.054
      const catchupTime = this.quality.mobile ? 0.032 : this.quality.tier === 'high' ? 0.039 : 0.037
      const urgency = THREE.MathUtils.smoothstep(distance, 0.015, 0.2)
      const result = criticallyDamped(
        this.visualProgress,
        this.progress,
        this.visualVelocity,
        THREE.MathUtils.lerp(baseTime, catchupTime, urgency),
        delta,
      )
      this.visualProgress = THREE.MathUtils.clamp(result.value, 0, 1)
      this.visualVelocity = result.velocity
      if (distance < 0.00001 && Math.abs(this.visualVelocity) < 0.0001) {
        this.visualProgress = this.progress
        this.visualVelocity = 0
      }
    }

    const context: SequenceContext = {
      progress: this.visualProgress,
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
    sampleVectorSplineKeyframes(context.progress, cameraPositionKeys, this.cameraTarget)
    sampleVectorSplineKeyframes(context.progress, cameraLookKeys, this.desiredLook)
    // Restrained reversible finale orbit. The spline carries the dolly while a
    // small progress-driven yaw (smootherstep: zero velocity at both ends)
    // rotates the camera around the loaf anchor. Pure function of progress, so
    // reverse scrubbing unwinds it exactly. Skipped in reduced-motion mode.
    const orbitBlend = context.quality.reducedMotion ? 0 : windowProgress(context.progress, 0.955, 1)
    if (orbitBlend > 0) {
      const orbitAngle = orbitBlend * (Math.PI / 18)
      this.orbitOffset.copy(this.cameraTarget).sub(this.desiredLook)
      const cosA = Math.cos(orbitAngle)
      const sinA = Math.sin(orbitAngle)
      const ox = this.orbitOffset.x
      const oz = this.orbitOffset.z
      this.orbitOffset.x = ox * cosA + oz * sinA
      this.orbitOffset.z = -ox * sinA + oz * cosA
      this.orbitOffset.multiplyScalar(1 - orbitBlend * 0.05)
      this.cameraTarget.copy(this.desiredLook).add(this.orbitOffset)
    }
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
    this.camera.position.copy(this.cameraTarget)

    this.desiredLook.x += context.pointer.x * 0.045 * pointerAmount
    this.desiredLook.y += context.pointer.y * -0.03 * pointerAmount
    this.lookTarget.copy(this.desiredLook)
    this.camera.lookAt(this.lookTarget)

    const fov = sampleNumberSplineKeyframes(context.progress, cameraFovKeys)
    if (Math.abs(this.camera.fov - fov) > 0.001) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
  }

  private updateLighting(context: SequenceContext) {
    const p = context.progress
    sampleColorKeyframes(p, backgroundKeys, this.backgroundColor)
    this.scene.background = this.backgroundColor
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.copy(this.backgroundColor)
    sampleColorKeyframes(p, backdropTopKeys, this.backdropTopColor)
    sampleColorKeyframes(p, backdropBottomKeys, this.backdropBottomColor)
    sampleColorKeyframes(p, backdropGlowKeys, this.backdropGlowColor)
    this.backdropMaterial.uniforms.uGlowStrength.value = sampleNumberSplineKeyframes(p, backdropGlowStrengthKeys)

    sampleColorKeyframes(p, keyLightColorKeys, this.keyLightColor)
    this.keyLight.color.copy(this.keyLightColor)
    sampleVectorSplineKeyframes(p, keyLightPositionKeys, this.lightTarget)
    const proofQuiet = windowProgress(p, 0.68, 0.71) * (1 - windowProgress(p, 0.775, 0.81))
    if (!context.quality.reducedMotion) {
      this.lightTarget.x += Math.sin(this.elapsed * 0.12) * proofQuiet * 0.42
      this.lightTarget.z += Math.cos(this.elapsed * 0.09) * proofQuiet * 0.22
    }
    this.keyLight.position.copy(this.lightTarget)
    this.keyLight.target.position.set(0, 0.32 + windowProgress(p, 0.72, 0.86) * 0.35, -windowProgress(p, 0.72, 0.86) * 1.2 + windowProgress(p, 0.9, 1) * 1.65)

    const ovenWarmth = windowProgress(p, 0.735, 0.829) * (1 - windowProgress(p, 0.925, 0.98))
    const ovenHeat = windowProgress(p, 0.813, 0.86)
    const finishWarmth = windowProgress(p, 0.89, 1)
    this.ambientLight.intensity = sampleNumberSplineKeyframes(p, ambientIntensityKeys)
    this.fillLight.intensity = sampleNumberSplineKeyframes(p, fillIntensityKeys)
    this.keyLight.intensity = sampleNumberSplineKeyframes(p, keyIntensityKeys)
    // The opening glows while it approaches, but the strong ember practical
    // arrives only as the dough crosses the threshold. This preserves the pale
    // proofed material long enough for the physical handoff to read.
    this.ovenLight.intensity = ovenWarmth * (0.82 + ovenHeat * 1.78)
    this.breadLight.intensity = finishWarmth * 2.05
    this.renderer.toneMappingExposure = sampleNumberSplineKeyframes(p, exposureKeys)
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = sampleNumberSplineKeyframes(p, fogDensityKeys)
    }

    if (this.bloom) {
      this.bloom.strength = 0.045 + ovenWarmth * 0.12 + finishWarmth * 0.035
      this.bloom.radius = 0.28 + ovenWarmth * 0.12
      this.bloom.threshold = 0.84
    }
  }
}

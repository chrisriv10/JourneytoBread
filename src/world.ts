import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { blobGeometry, createScoreCut, fieldKernelGeometry, kernelGeometry, loafGeometry, material, overlapOpacity, PALETTE, pointsMaterial, rangeProgress, setOpacity, smoothstep, smootherstep } from './geometry'
import { createChapters, type ChapterModel } from './models'
import type { JourneyState, PointerState, QualityConfig, RenderContext } from './types'
import { STAGES } from './types'

type FieldSample = { x: number; y: number; z: number; height: number; phase: number; lean: number }

const tempObject = new THREE.Object3D()
const tempColor = new THREE.Color()
const tempVector = new THREE.Vector3()
const tempVector2 = new THREE.Vector3()

export class JourneyWorld {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  readonly renderer: THREE.WebGLRenderer
  readonly root = new THREE.Group()
  readonly pointer: PointerState = { x: 0, y: 0, targetX: 0, targetY: 0 }

  private readonly quality: QualityConfig
  private readonly container: HTMLElement
  private readonly onStateChange?: (state: JourneyState) => void
  private readonly clock = new THREE.Clock()
  private progress = 0
  private elapsed = 0
  private animationFrame = 0
  private resizeObserver: ResizeObserver | null = null
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private disposed = false

  private readonly fieldGroup = new THREE.Group()
  private readonly focalWheat = new THREE.Group()
  private readonly kernelGroup = new THREE.Group()
  private readonly millGroup = new THREE.Group()
  private readonly flourCloud = new THREE.Group()
  private readonly bowlGroup = new THREE.Group()
  private readonly ingredientsGroup = new THREE.Group()
  private readonly mixingSpoon = new THREE.Group()
  private readonly doughGroup = new THREE.Group()
  private readonly bubblesGroup = new THREE.Group()
  private readonly ovenGroup = new THREE.Group()
  private readonly breadGroup = new THREE.Group()
  private readonly tableGroup = new THREE.Group()
  private readonly crumbsGroup = new THREE.Group()
  private readonly steamGroup = new THREE.Group()

  private readonly wheatField!: THREE.InstancedMesh
  private readonly wheatHeads!: THREE.InstancedMesh
  private readonly wheatLeaves!: THREE.InstancedMesh
  private readonly fieldSamples: FieldSample[] = []
  private readonly kernel!: THREE.Mesh
  private readonly stones: THREE.Group[] = []
  private readonly flourPoints!: THREE.Points
  private readonly flourPositions!: Float32Array
  private readonly flourSeeds!: Float32Array
  private water!: THREE.Mesh
  private readonly doughVariants: THREE.Mesh[] = []
  private shapedDough!: THREE.Mesh
  private readonly ovenLoaf!: THREE.Mesh
  private readonly ovenGlow!: THREE.Mesh
  private readonly loafWhole!: THREE.Group
  private readonly loafSliceA!: THREE.Group
  private readonly loafSliceB!: THREE.Group
  private readonly knifeGroup = new THREE.Group()
  private readonly crumbPoints!: THREE.Points
  private readonly crumbPositions!: Float32Array
  private readonly crumbSeeds!: Float32Array
  private readonly steamPoints!: THREE.Points
  private readonly steamPositions!: Float32Array
  private readonly steamSeeds!: Float32Array
  private readonly ovenLight: THREE.PointLight
  private readonly breadLight: THREE.PointLight
  private readonly keyLight: THREE.DirectionalLight
  private readonly fillLight: THREE.HemisphereLight
  private readonly chapters: ChapterModel[]

  constructor(container: HTMLElement, quality: QualityConfig, onStateChange?: (state: JourneyState) => void) {
    this.container = container
    this.quality = quality
    this.onStateChange = onStateChange

    this.scene.background = new THREE.Color(PALETTE.night)
    this.scene.fog = new THREE.FogExp2(PALETTE.night, 0.035)
    this.scene.add(this.root)

    this.renderer = new THREE.WebGLRenderer({ antialias: !quality.mobile, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(quality.dpr)
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.82
    this.renderer.shadowMap.enabled = quality.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.renderer.domElement.className = 'journey-canvas'
    this.container.appendChild(this.renderer.domElement)

    if (quality.bloom) {
      this.composer = new EffectComposer(this.renderer)
      this.composer.addPass(new RenderPass(this.scene, this.camera))
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.5, 0.82)
      this.composer.addPass(this.bloom)
    }

    this.camera.position.set(0, 0.35, 7.2)
    this.camera.lookAt(0, 0, -2)

    this.fillLight = new THREE.HemisphereLight(0xb9c29d, 0x101311, 1.35)
    this.keyLight = new THREE.DirectionalLight(0xffd58d, 2.5)
    this.keyLight.position.set(-4, 7, 5)
    this.keyLight.castShadow = quality.shadows
    this.keyLight.shadow.mapSize.set(quality.mobile ? 512 : 1024, quality.mobile ? 512 : 1024)
    this.keyLight.shadow.camera.near = 0.1
    this.keyLight.shadow.camera.far = 30
    this.keyLight.shadow.camera.left = -10
    this.keyLight.shadow.camera.right = 10
    this.keyLight.shadow.camera.top = 10
    this.keyLight.shadow.camera.bottom = -10
    this.ovenLight = new THREE.PointLight(PALETTE.ember, 0, 10, 2)
    this.ovenLight.position.set(0, 0, 1.1)
    this.breadLight = new THREE.PointLight(0xffc17c, 0, 9, 2)
    this.breadLight.position.set(1.8, 2.2, 4.2)
    this.scene.add(this.fillLight, this.keyLight, this.ovenLight, this.breadLight)

    // The original prototype remains available below as a reference, but the
    // rendered journey uses one deliberate tabletop composition per chapter.
    // Keeping only the new chapter groups attached prevents the old detached
    // primitives from competing with the story or reading as visual noise.
    this.chapters = createChapters()
    this.chapters.forEach(({ group }) => {
      setOpacity(group, 0)
      this.root.add(group)
    })

    this.setupEvents()
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
    this.camera.aspect = width / height
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
    this.pointer.targetX = (event.clientX / window.innerWidth - 0.5) * 2
    this.pointer.targetY = (event.clientY / window.innerHeight - 0.5) * 2
  }

  private readonly render = () => {
    if (this.disposed) return
    const delta = Math.min(this.clock.getDelta(), 0.05)
    this.elapsed += delta
    const ease = this.quality.reducedMotion ? 0.12 : 0.065
    this.pointer.x = THREE.MathUtils.lerp(this.pointer.x, this.pointer.targetX, ease)
    this.pointer.y = THREE.MathUtils.lerp(this.pointer.y, this.pointer.targetY, ease)
    this.applyJourney({ progress: this.progress, time: this.elapsed, delta, pointer: this.pointer, quality: this.quality })
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

  private applyJourney(context: RenderContext) {
    this.applyChapterJourney(context)
    return

    // Legacy prototype animation retained below while the new compositions
    // are tuned. It is intentionally unreachable and no longer rendered.
    const p = context.progress
    const pointerStrength = context.quality.reducedMotion ? 0.15 : 1

    const fieldOpacity = p <= 0.001 ? 1 : overlapOpacity(p, 0, 0.16, 0.035)
    setOpacity(this.fieldGroup, fieldOpacity)
    this.fieldGroup.position.z = -p * 2.8
    this.fieldGroup.rotation.y = context.pointer.x * 0.018 * pointerStrength
    this.updateWheat(context)

    const focalOpacity = p <= 0.001 ? 1 : overlapOpacity(p, 0.035, 0.17, 0.035)
    setOpacity(this.focalWheat, focalOpacity)
    this.focalWheat.position.set(context.pointer.x * 0.1 * pointerStrength, -0.82, -2.5 - p * 1.8)
    this.focalWheat.rotation.z = Math.sin(context.time * 0.7) * 0.025 + context.pointer.x * 0.025 * pointerStrength

    const grainProgress = rangeProgress(p, 0.105, 0.34)
    const grainEase = smootherstep(grainProgress)
    setOpacity(this.kernelGroup, overlapOpacity(p, 0.12, 0.25, 0.035))
    this.kernelGroup.position.set(
      THREE.MathUtils.lerp(0.18, -0.28, grainEase) + context.pointer.x * 0.08 * pointerStrength,
      THREE.MathUtils.lerp(0.02, -2.5, grainEase),
      THREE.MathUtils.lerp(-3.05, 0.15, grainEase),
    )
    this.kernelGroup.rotation.set(grainEase * 2.1, grainEase * 4.6, grainEase * 1.7)
    this.kernelGroup.scale.setScalar(THREE.MathUtils.lerp(0.2, 1.55, smoothstep(rangeProgress(p, 0.12, 0.24))))

    const millProgress = rangeProgress(p, 0.21, 0.36)
    setOpacity(this.millGroup, overlapOpacity(p, 0.21, 0.36, 0.035))
    this.millGroup.position.set(0, 0.05, THREE.MathUtils.lerp(-1.5, 0.1, smoothstep(millProgress)))
    this.millGroup.rotation.y = context.time * (0.55 + millProgress * 1.5) * (context.quality.reducedMotion ? 0.2 : 1)
    this.millGroup.scale.setScalar(THREE.MathUtils.lerp(0.72, 1.08, smoothstep(millProgress)))
    this.kernel.scale.setScalar(THREE.MathUtils.lerp(1, 0.16, smoothstep(rangeProgress(p, 0.32, 0.405))))

    const flourProgress = rangeProgress(p, 0.34, 0.48)
    const burst = smoothstep(rangeProgress(p, 0.34, 0.4)) * (1 - smoothstep(rangeProgress(p, 0.42, 0.48)))
    setOpacity(this.flourCloud, overlapOpacity(p, 0.32, 0.47, 0.035))
    this.flourCloud.position.set(0, -0.08, 0.1)
    this.flourCloud.scale.setScalar(THREE.MathUtils.lerp(0.58, 0.96, burst))
    this.updateFlour(flourProgress, burst, context)

    const bowlProgress = rangeProgress(p, 0.46, 0.62)
    setOpacity(this.bowlGroup, overlapOpacity(p, 0.46, 0.62, 0.04))
    this.bowlGroup.position.set(0, THREE.MathUtils.lerp(-1.2, -0.6, smoothstep(bowlProgress)), THREE.MathUtils.lerp(0.7, -0.5, smoothstep(bowlProgress)))
    this.bowlGroup.scale.setScalar(THREE.MathUtils.lerp(0.45, 1.05, smoothstep(rangeProgress(p, 0.4, 0.55))))
    this.ingredientsGroup.position.copy(this.bowlGroup.position)
    this.ingredientsGroup.position.y += THREE.MathUtils.lerp(0.12, -0.04, smoothstep(rangeProgress(p, 0.48, 0.61)))
    setOpacity(this.ingredientsGroup, overlapOpacity(p, 0.48, 0.62, 0.035))
    this.water.position.y = THREE.MathUtils.lerp(0.8, 0.28, smoothstep(rangeProgress(p, 0.48, 0.58)))
    const waterScale = THREE.MathUtils.lerp(0.55, 0.95, smoothstep(rangeProgress(p, 0.48, 0.58)))
    this.water.scale.set(waterScale * 0.62, waterScale * 0.88, waterScale * 0.62)

    const doughProgress = rangeProgress(p, 0.58, 0.75)
    setOpacity(this.doughGroup, overlapOpacity(p, 0.58, 0.84, 0.04))
    this.doughGroup.position.set(0, -0.6, THREE.MathUtils.lerp(0.05, -0.45, smoothstep(doughProgress)))
    this.applyDoughVariants(doughProgress, context)
    this.doughGroup.rotation.z = context.pointer.x * 0.045 * pointerStrength

    const proofProgress = rangeProgress(p, 0.7, 0.83)
    setOpacity(this.bubblesGroup, overlapOpacity(p, 0.7, 0.83, 0.035))
    this.doughGroup.position.y = THREE.MathUtils.lerp(-0.6, -0.05, smoothstep(proofProgress))
    this.shapedDough.scale.set(
      0.96 + smoothstep(proofProgress) * 0.12,
      0.94 + smoothstep(proofProgress) * 0.16,
      0.94 + smoothstep(proofProgress) * 0.12,
    )
    this.bubblesGroup.position.set(0, this.doughGroup.position.y - 0.05, this.doughGroup.position.z + 0.42)
    this.bubblesGroup.scale.setScalar(THREE.MathUtils.lerp(0.45, 1.3, smoothstep(proofProgress)))
    this.bubblesGroup.rotation.y = context.time * 0.12
    this.updateBubbles(proofProgress, context)

    const ovenProgress = rangeProgress(p, 0.78, 0.94)
    const ovenVisibility = overlapOpacity(p, 0.78, 0.94, 0.04)
    setOpacity(this.ovenGroup, ovenVisibility)
    this.ovenGroup.position.set(0, -0.05, THREE.MathUtils.lerp(-2.2, 0.05, smoothstep(ovenProgress)))
    this.ovenGroup.scale.setScalar(THREE.MathUtils.lerp(0.72, 1.08, smoothstep(rangeProgress(p, 0.77, 0.89))))
    this.ovenLoaf.position.set(0, THREE.MathUtils.lerp(-0.45, -0.13, smoothstep(ovenProgress)), 0.72)
    this.ovenLoaf.scale.set(0.52 + smoothstep(ovenProgress) * 0.1, 0.42 + smoothstep(ovenProgress) * 0.1, 0.5 + smoothstep(ovenProgress) * 0.08)
    this.updateOvenMaterial(ovenProgress)
    this.ovenLight.intensity = ovenVisibility * smoothstep(rangeProgress(p, 0.78, 0.98)) * 4.7
    this.breadLight.intensity = smoothstep(rangeProgress(p, 0.87, 1)) * 4.2
    ;(this.ovenGlow.material as THREE.MeshStandardMaterial).opacity = ovenVisibility * smoothstep(rangeProgress(p, 0.79, 0.96)) * 0.28
    this.bloom!.strength = ovenVisibility * smoothstep(rangeProgress(p, 0.78, 0.92)) * 0.22
    this.updateSteam(ovenProgress, context)

    const breadProgress = rangeProgress(p, 0.88, 1)
    const breadOpacity = smoothstep(rangeProgress(p, 0.87, 0.94))
    setOpacity(this.breadGroup, breadOpacity)
    setOpacity(this.tableGroup, smoothstep(rangeProgress(p, 0.91, 0.96)))
    setOpacity(this.crumbsGroup, overlapOpacity(p, 0.953, 1.01, 0.04))
    this.tableGroup.position.y = THREE.MathUtils.lerp(0.4, -0.55, smoothstep(breadProgress))
    this.breadGroup.position.set(0, THREE.MathUtils.lerp(0.55, 0.1, smoothstep(breadProgress)), THREE.MathUtils.lerp(-0.7, 0.1, smoothstep(breadProgress)))
    this.breadGroup.scale.setScalar(THREE.MathUtils.lerp(0.6, 0.66, smoothstep(breadProgress)))
    this.breadGroup.rotation.y = context.pointer.x * 0.06 * pointerStrength + smoothstep(breadProgress) * 0.12
    this.breadGroup.rotation.x = context.pointer.y * 0.025 * pointerStrength
    this.updateBreadReveal(breadProgress, context)
    this.updateCrumbs(breadProgress, context)

    this.updateCamera(p, context)
    this.updateLighting(p, context)
  }

  private applyChapterJourney(context: RenderContext) {
    const p = context.progress
    const pointerStrength = context.quality.reducedMotion ? 0.15 : 1
    const ranges: Array<[number, number]> = STAGES.map(({ start, end }, index) => [
      start,
      index === STAGES.length - 1 ? 1.01 : end,
    ])
    const activeIndex = STAGES.reduce((active, stage, index) => (p >= stage.start ? index : active), 0)
    const activeStart = STAGES[activeIndex].start

    this.chapters.forEach((chapter, index) => {
      const [start, end] = ranges[index]
      // Keep the object and label synchronized. The previous scene eases away
      // just before a chapter boundary, while the newly labeled scene is fully
      // readable as soon as its chapter begins.
      const previousOpacity = index === activeIndex - 1
        ? 1 - smoothstep((p - (activeStart - 0.04)) / 0.04)
        : 0
      const opacity = index === activeIndex ? 1 : THREE.MathUtils.clamp(previousOpacity, 0, 1)
      setOpacity(chapter.group, opacity)
      chapter.group.visible = opacity > 0.001
      if (!chapter.group.visible) return

      const local = rangeProgress(p, start, end)
      chapter.animate(local, context.time)
      chapter.group.position.y = Math.sin(local * Math.PI) * 0.045
      chapter.group.position.x = context.pointer.x * 0.035 * pointerStrength
      chapter.group.rotation.y = context.pointer.x * 0.018 * pointerStrength
      chapter.group.scale.setScalar(0.94 + smoothstep(local) * 0.06)
    })

    this.updateChapterCamera(p, pointerStrength)
    this.updateChapterLighting(p)
  }

  private updateChapterCamera(progress: number, pointerStrength: number) {
    const targetPosition = tempVector.set(0, 1.42, 6.7)
    const targetLook = tempVector2.set(0, 0.48, 0)
    if (progress < 0.18) {
      targetPosition.set(0, 1.23, 6.15)
      targetLook.set(0, 0.78, -0.2)
    } else if (progress < 0.42) {
      targetPosition.set(0, 1.47, 6.85)
      targetLook.set(0, 0.54, 0)
    } else if (progress < 0.76) {
      targetPosition.set(0, 1.72, 6.95)
      targetLook.set(0, 0.48, 0)
    } else if (progress < 0.90) {
      targetPosition.set(0, 1.58, 6.55)
      targetLook.set(0, 0.55, 0)
    }
    targetPosition.x += this.pointer.x * 0.12 * pointerStrength
    targetLook.x += this.pointer.x * 0.05 * pointerStrength
    this.camera.position.lerp(targetPosition, 0.085)
    this.camera.lookAt(targetLook)
  }

  private updateChapterLighting(progress: number) {
    const night = tempColor.set(PALETTE.night)
    const field = new THREE.Color(0x536344)
    const kitchen = new THREE.Color(0xc4b58e)
    const oven = new THREE.Color(0x211914)
    const finish = new THREE.Color(0x10110e)
    const background = new THREE.Color()

    if (progress < 0.2) background.lerpColors(night, field, smoothstep(progress / 0.2))
    else if (progress < 0.52) background.lerpColors(field, kitchen, smoothstep((progress - 0.2) / 0.32))
    else if (progress < 0.82) background.lerpColors(kitchen, oven, smoothstep((progress - 0.52) / 0.3))
    else background.lerpColors(oven, finish, smoothstep((progress - 0.82) / 0.18))

    this.scene.background = background
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.copy(background)
    this.fillLight.intensity = progress > 0.76 ? 1.05 : 1.45
    this.keyLight.intensity = progress > 0.76 ? 2.8 : 2.35
    this.ovenLight.intensity = smoothstep(rangeProgress(progress, 0.76, 0.91)) * 4.2
    this.breadLight.intensity = smoothstep(rangeProgress(progress, 0.88, 1)) * 1.8
    if (this.bloom) this.bloom.strength = progress > 0.76 ? 0.28 : 0.16
  }

  private updateCamera(progress: number, context: RenderContext) {
    const p = progress
    const pointerAmount = context.quality.reducedMotion ? 0.12 : 1
    const camera = this.camera
    const desired = tempVector
    const lookAt = tempVector2

    desired.set(context.pointer.x * 0.22 * pointerAmount, 0.25 + context.pointer.y * -0.12 * pointerAmount, 7.1)
    lookAt.set(0, 0.05, -2.6)
    if (p < 0.18) {
      const local = smoothstep(rangeProgress(p, 0, 0.18))
      desired.set(context.pointer.x * 0.22 * pointerAmount, 0.2 + local * 0.3, THREE.MathUtils.lerp(7.2, 4.55, local))
      lookAt.set(0, 0.06, THREE.MathUtils.lerp(-3.2, -2.1, local))
    } else if (p < 0.38) {
      const local = smoothstep(rangeProgress(p, 0.16, 0.38))
      desired.set(context.pointer.x * 0.12 * pointerAmount, 0.4 + local * 0.3, THREE.MathUtils.lerp(4.5, 6.2, local))
      lookAt.set(0, THREE.MathUtils.lerp(0.1, -0.15, local), THREE.MathUtils.lerp(-1.7, 0, local))
    } else if (p < 0.59) {
      const local = smoothstep(rangeProgress(p, 0.35, 0.59))
      desired.set(context.pointer.x * 0.16 * pointerAmount, THREE.MathUtils.lerp(0.1, 1.1, local), THREE.MathUtils.lerp(5.8, 7.3, local))
      lookAt.set(0, THREE.MathUtils.lerp(-0.1, -0.55, local), THREE.MathUtils.lerp(0, -0.35, local))
    } else if (p < 0.76) {
      const local = smoothstep(rangeProgress(p, 0.56, 0.76))
      desired.set(context.pointer.x * 0.2 * pointerAmount, THREE.MathUtils.lerp(1.1, 0.65, local), THREE.MathUtils.lerp(5.4, 6.1, local))
      lookAt.set(0, THREE.MathUtils.lerp(-0.5, -0.12, local), -0.35)
    } else if (p < 0.91) {
      const local = smoothstep(rangeProgress(p, 0.75, 0.91))
      desired.set(context.pointer.x * 0.16 * pointerAmount, THREE.MathUtils.lerp(0.65, 0.15, local), THREE.MathUtils.lerp(6.3, 4.65, local))
      lookAt.set(0, -0.05, THREE.MathUtils.lerp(-0.6, 0.1, local))
    } else {
      const local = smootherstep(rangeProgress(p, 0.89, 1))
      const arc = Math.sin(local * Math.PI) * 0.45
      desired.set(arc + context.pointer.x * 0.18 * pointerAmount, 0.08 + context.pointer.y * -0.08 * pointerAmount, THREE.MathUtils.lerp(5.35, 5.15, local))
      lookAt.set(0, -0.18, 0.12)
    }

    camera.position.lerp(desired, context.quality.reducedMotion ? 0.15 : 0.075)
    camera.lookAt(lookAt)
  }

  private updateLighting(progress: number, context: RenderContext) {
    const p = progress
    const night = new THREE.Color(PALETTE.night)
    const wheatSky = new THREE.Color(0x667349)
    const flourSky = new THREE.Color(0xbcb18e)
    const ovenSky = new THREE.Color(0x1b100d)
    const breadSky = new THREE.Color(0x202116)
    const background = tempColor

    if (p < 0.3) background.lerpColors(night, wheatSky, smoothstep(rangeProgress(p, 0, 0.25)))
    else if (p < 0.55) background.lerpColors(wheatSky, flourSky, smoothstep(rangeProgress(p, 0.28, 0.55)))
    else if (p < 0.79) background.lerpColors(flourSky, ovenSky, smoothstep(rangeProgress(p, 0.52, 0.79)))
    else background.lerpColors(ovenSky, breadSky, smoothstep(rangeProgress(p, 0.78, 1)))
    this.scene.background = background
    ;(this.scene.fog as THREE.FogExp2).color.copy(background)
    ;(this.scene.fog as THREE.FogExp2).density = THREE.MathUtils.lerp(0.05, 0.022, smoothstep(rangeProgress(p, 0.3, 0.65)))

    const ovenWarmth = smoothstep(rangeProgress(p, 0.72, 0.86)) * (1 - smoothstep(rangeProgress(p, 0.9, 1)))
    this.keyLight.color.setHex(PALETTE.wheatLight).lerp(new THREE.Color(PALETTE.ember), ovenWarmth)
    this.keyLight.intensity = THREE.MathUtils.lerp(2.5, 3.1, ovenWarmth)
    this.keyLight.position.x = -4 + context.pointer.x * 0.8
    this.fillLight.intensity = THREE.MathUtils.lerp(1.35, 0.95, smoothstep(rangeProgress(p, 0.64, 0.85)))
  }

  private updateWheat(context: RenderContext) {
    const wind = context.quality.reducedMotion ? 0.008 : 0.045
    for (let i = 0; i < this.fieldSamples.length; i += 1) {
      const sample = this.fieldSamples[i]
      const sway = Math.sin(context.time * 0.9 + sample.phase) * wind + context.pointer.x * (Math.abs(sample.z) < 3 ? 0.016 : 0)
      tempObject.position.set(sample.x, -1.15 + sample.y, sample.z)
      tempObject.rotation.set(0, sample.lean, sway)
      tempObject.scale.setScalar(1)
      tempObject.scale.y = sample.height
      tempObject.updateMatrix()
      this.wheatField.setMatrixAt(i, tempObject.matrix)

      tempObject.position.set(sample.x + sway * 0.12, -1.15 + sample.y + sample.height * 0.55, sample.z)
      tempObject.rotation.set(0, sample.lean, sway)
      tempObject.scale.set(0.34, sample.height * 0.28, 0.34)
      tempObject.updateMatrix()
      this.wheatHeads.setMatrixAt(i, tempObject.matrix)

      tempObject.position.set(sample.x + Math.sin(sample.phase) * 0.04, -1.15 + sample.y + sample.height * 0.36, sample.z)
      tempObject.rotation.set(0.25, sample.lean + Math.sin(sample.phase) * 0.4, sway * 1.4)
      tempObject.scale.set(0.42, sample.height * 0.16, 0.42)
      tempObject.updateMatrix()
      this.wheatLeaves.setMatrixAt(i, tempObject.matrix)
    }
    this.wheatField.instanceMatrix.needsUpdate = true
    this.wheatHeads.instanceMatrix.needsUpdate = true
    this.wheatLeaves.instanceMatrix.needsUpdate = true
  }

  private updateFlour(flourProgress: number, burst: number, context: RenderContext) {
    const positions = this.flourPoints.geometry.attributes.position as THREE.BufferAttribute
    const gravity = smoothstep(rangeProgress(flourProgress, 0.38, 1))
    const drift = context.quality.reducedMotion ? 0.015 : 0.045
    for (let i = 0; i < this.flourSeeds.length; i += 3) {
      const seedX = this.flourSeeds[i]
      const seedY = this.flourSeeds[i + 1]
      const seedZ = this.flourSeeds[i + 2]
      const angle = context.time * drift + i * 0.002
      const spread = THREE.MathUtils.lerp(0.18, 0.52, burst)
      positions.setXYZ(
        i / 3,
        seedX * spread + Math.sin(angle + seedY) * 0.08,
        seedY * spread - gravity * (flourProgress * 3.4) + Math.cos(angle) * 0.06,
        seedZ * spread + Math.sin(angle * 0.7) * 0.08,
      )
    }
    positions.needsUpdate = true
    const visibility = overlapOpacity(this.progress, 0.32, 0.47, 0.035)
    const opacity = visibility * THREE.MathUtils.lerp(0.04, 0.28, burst) * (1 - smoothstep(rangeProgress(flourProgress, 0.8, 1)))
    ;(this.flourPoints.material as THREE.PointsMaterial).opacity = opacity
  }

  private applyDoughVariants(progress: number, context: RenderContext) {
    const visibility = overlapOpacity(this.progress, 0.58, 0.84, 0.04)
    const rough = 1 - smoothstep(rangeProgress(progress, 0.12, 0.3))
    const ball = smoothstep(rangeProgress(progress, 0.12, 0.26)) * (1 - smoothstep(rangeProgress(progress, 0.28, 0.42)))
    const folded = smoothstep(rangeProgress(progress, 0.34, 0.5)) * (1 - smoothstep(rangeProgress(progress, 0.7, 0.86)))
    const shaped = smoothstep(rangeProgress(progress, 0.72, 1))
    setOpacity(this.doughVariants[0], visibility * rough)
    setOpacity(this.doughVariants[1], visibility * Math.max(ball, 0.02))
    setOpacity(this.doughVariants[2], visibility * Math.max(folded, 0.02))
    setOpacity(this.shapedDough, visibility * Math.max(shaped, 0.02))
    this.doughVariants[0].scale.set(1.2 - progress * 0.25, 0.55 + progress * 0.16, 0.85)
    this.doughVariants[1].scale.setScalar(0.72 + ball * 0.22)
    this.doughVariants[1].scale.y *= 0.88 + Math.sin(context.time * 1.5) * 0.012
    this.doughVariants[2].rotation.z = Math.sin(context.time * 0.8) * 0.04
    this.doughVariants[2].scale.set(0.92, 0.65, 0.72)
    this.shapedDough.scale.set(0.86 + shaped * 0.12, 0.58 + shaped * 0.15, 0.7 + shaped * 0.08)
    this.mixingSpoon.rotation.z = THREE.MathUtils.lerp(-0.32, 0.26, smoothstep(rangeProgress(this.progress, 0.49, 0.61)))
    this.mixingSpoon.rotation.y = Math.sin(context.time * 1.8) * 0.05
  }

  private updateBubbles(progress: number, context: RenderContext) {
    this.bubblesGroup.children.forEach((bubble, index) => {
      const phase = index * 1.7
      bubble.position.y += Math.sin(context.time * 0.65 + phase) * 0.002
      bubble.scale.setScalar(0.7 + Math.sin(context.time * 0.75 + phase) * 0.12 + progress * 0.25)
    })
  }

  private updateOvenMaterial(progress: number) {
    const ovenMaterial = this.ovenLoaf.material as THREE.MeshStandardMaterial
    const doughColor = new THREE.Color(PALETTE.doughLight)
    const crustColor = new THREE.Color(PALETTE.bread)
    ovenMaterial.color.lerpColors(doughColor, crustColor, smoothstep(progress))
    ovenMaterial.roughness = THREE.MathUtils.lerp(0.78, 0.95, progress)
  }

  private updateSteam(progress: number, context: RenderContext) {
    const positions = this.steamPoints.geometry.attributes.position as THREE.BufferAttribute
    const opacity = smoothstep(progress) * (1 - smoothstep(rangeProgress(this.progress, 0.93, 1)))
    ;(this.steamPoints.material as THREE.PointsMaterial).opacity = opacity * 0.45
    for (let i = 0; i < this.steamSeeds.length; i += 3) {
      const baseX = this.steamSeeds[i]
      const baseY = this.steamSeeds[i + 1]
      const baseZ = this.steamSeeds[i + 2]
      const phase = i * 0.02
      positions.setXYZ(
        i / 3,
        baseX + Math.sin(context.time * 0.55 + phase) * 0.12,
        baseY + smoothstep(progress) * 1.35 + (context.time * 0.06 + phase) % 0.8,
        baseZ + Math.cos(context.time * 0.48 + phase) * 0.06,
      )
    }
    positions.needsUpdate = true
  }

  private updateBreadReveal(progress: number, context: RenderContext) {
    const visibility = smoothstep(rangeProgress(this.progress, 0.87, 0.94))
    const cutIn = smoothstep(rangeProgress(progress, 0.2, 0.38))
    const cutOut = smoothstep(rangeProgress(progress, 0.7, 0.92))
    const cutProgress = cutIn * (1 - cutOut)
    const showWhole = Math.max(1 - cutProgress, cutOut)
    setOpacity(this.loafWhole, visibility * showWhole)
    setOpacity(this.loafSliceA, visibility * cutProgress)
    setOpacity(this.loafSliceB, visibility * cutProgress)
    this.loafSliceA.position.x = -cutProgress * 0.62
    this.loafSliceB.position.x = cutProgress * 0.68
    this.loafSliceA.rotation.z = -cutProgress * 0.04
    this.loafSliceB.rotation.z = cutProgress * 0.035
    this.knifeGroup.position.x = THREE.MathUtils.lerp(-1.8, 0.18, cutProgress)
    this.knifeGroup.position.y = THREE.MathUtils.lerp(1.25, 0.3, cutProgress)
    this.knifeGroup.rotation.z = THREE.MathUtils.lerp(-0.22, -0.05, cutProgress)
    setOpacity(this.knifeGroup, visibility * smoothstep(rangeProgress(progress, 0.35, 0.5)) * (1 - smoothstep(rangeProgress(progress, 0.78, 0.95))))
    this.knifeGroup.rotation.y = context.pointer.x * 0.035
  }

  private updateCrumbs(progress: number, context: RenderContext) {
    const positions = this.crumbPoints.geometry.attributes.position as THREE.BufferAttribute
    const scatter = smoothstep(rangeProgress(progress, 0.54, 0.8))
    ;(this.crumbPoints.material as THREE.PointsMaterial).opacity = scatter * 0.72
    for (let i = 0; i < this.crumbSeeds.length; i += 3) {
      const idx = i / 3
      positions.setXYZ(
        idx,
        this.crumbSeeds[i] * (1 + scatter * 1.5) + Math.sin(context.time * 0.9 + idx) * 0.025,
        this.crumbSeeds[i + 1] + scatter * (0.18 + (idx % 4) * 0.035),
        this.crumbSeeds[i + 2] + Math.cos(context.time * 0.8 + idx) * 0.02,
      )
    }
    positions.needsUpdate = true
  }

  private createWheatField() {
    const count = this.quality.wheatCount
    const stalkGeometry = new THREE.CylinderGeometry(0.018, 0.04, 1, 6)
    const headGeometry = fieldKernelGeometry()
    const leafGeometry = new THREE.BoxGeometry(0.055, 0.26, 0.018)
    const stalkMaterial = material(0x69844b, { roughness: 0.96, emissive: 0x1b2d12, emissiveIntensity: 0.24, vertexColors: true })
    const headMaterial = material(PALETTE.wheat, { roughness: 0.84, emissive: 0x3f2b08, emissiveIntensity: 0.16, vertexColors: true })
    const leafMaterial = material(0x476638, { roughness: 0.96, emissive: 0x16280f, emissiveIntensity: 0.28, vertexColors: true, side: THREE.DoubleSide })
    const stalks = new THREE.InstancedMesh(stalkGeometry, stalkMaterial, count)
    const heads = new THREE.InstancedMesh(headGeometry, headMaterial, count)
    const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, count)
    stalks.castShadow = stalks.receiveShadow = this.quality.shadows
    heads.castShadow = heads.receiveShadow = this.quality.shadows
    leaves.castShadow = leaves.receiveShadow = this.quality.shadows
    stalks.userData.heads = heads
    stalks.userData.leaves = leaves

    let seed = 491
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }

    for (let i = 0; i < count; i += 1) {
      const x = (random() - 0.5) * 18
      const z = random() * -12 - 2.5
      const height = 0.65 + random() * 0.9
      const sample = { x, y: random() * 0.08, z, height, phase: random() * Math.PI * 2, lean: (random() - 0.5) * 0.12 }
      this.fieldSamples.push(sample)
      const variation = 0.82 + random() * 0.28
      tempColor.setHex(PALETTE.mossLight).offsetHSL((random() - 0.5) * 0.05, 0, (random() - 0.5) * 0.12)
      stalks.setColorAt(i, tempColor)
      tempColor.setHex(PALETTE.wheat).offsetHSL((random() - 0.5) * 0.04, 0.02, (random() - 0.5) * 0.1)
      heads.setColorAt(i, tempColor)
      tempColor.setHex(PALETTE.moss).offsetHSL((random() - 0.5) * 0.05, 0, (random() - 0.5) * 0.14)
      leaves.setColorAt(i, tempColor)

      tempObject.position.set(x, -1.15 + sample.y, z)
      tempObject.rotation.set(0, sample.lean, 0)
      tempObject.scale.set(variation, height, variation)
      tempObject.updateMatrix()
      stalks.setMatrixAt(i, tempObject.matrix)
      tempObject.position.set(x, -1.15 + sample.y + height * 0.54, z)
      tempObject.scale.set(variation * 0.34, height * 0.28, variation * 0.34)
      tempObject.updateMatrix()
      heads.setMatrixAt(i, tempObject.matrix)
      tempObject.position.set(x, -1.15 + sample.y + height * 0.34, z)
      tempObject.rotation.set(0.28, sample.lean + 0.35, -0.18)
      tempObject.scale.set(variation * 0.42, height * 0.16, variation * 0.42)
      tempObject.updateMatrix()
      leaves.setMatrixAt(i, tempObject.matrix)
    }
    if (stalks.instanceColor) stalks.instanceColor.needsUpdate = true
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
    return stalks
  }

  private createGround() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(17, 32), material(PALETTE.moss, { roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -1.19
    ground.position.z = -5
    ground.scale.set(1, 1, 1.2)
    ground.receiveShadow = this.quality.shadows
    return ground
  }

  private createFocalWheat() {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 2.9, 6), material(PALETTE.mossLight, { roughness: 0.92, emissive: 0x2b4f18, emissiveIntensity: 0.38 }))
    stem.position.y = 0.36
    stem.rotation.z = -0.07
    stem.castShadow = this.quality.shadows
    this.focalWheat.add(stem)

    const head = new THREE.Group()
    const headMaterial = material(PALETTE.wheatLight, { roughness: 0.76, emissive: 0x8c6018, emissiveIntensity: 0.38 })
    const awnMaterial = material(0xe9bd5f, { roughness: 0.78, emissive: 0x6b470d, emissiveIntensity: 0.28 })
    for (let i = 0; i < 8; i += 1) {
      const grain = new THREE.Mesh(kernelGeometry(), headMaterial)
      const side = i % 2 ? 1 : -1
      grain.scale.setScalar(0.2 - i * 0.004)
      grain.position.set(side * 0.1 * (1 - i * 0.04), 0.48 + i * 0.16, Math.sin(i) * 0.015)
      grain.rotation.z = i % 2 ? -0.34 : 0.34
      head.add(grain)

      const awn = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.015, 0.34, 5), awnMaterial)
      awn.position.set(side * 0.2, 0.64 + i * 0.16, 0.01)
      awn.rotation.z = side * -0.32
      head.add(awn)
    }
    const tip = new THREE.Mesh(kernelGeometry(), headMaterial)
    tip.position.set(0, 1.8, 0)
    tip.rotation.z = Math.PI / 2
    tip.scale.setScalar(0.18)
    head.add(tip)
    head.position.y = 0.1
    head.rotation.z = -0.08
    this.focalWheat.add(head)
  }

  private createKernel() {
    const kernelMaterial = material(PALETTE.wheatLight, { roughness: 0.68 })
    const mesh = new THREE.Mesh(kernelGeometry(), kernelMaterial)
    mesh.castShadow = this.quality.shadows
    mesh.position.set(0, 0, 0)
    this.kernelGroup.add(mesh)
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.015, 5, 16), material(PALETTE.wheat, { roughness: 0.7 }))
    ridge.rotation.y = Math.PI / 2
    ridge.scale.set(1, 1.5, 1)
    ridge.position.z = 0.05
    this.kernelGroup.add(ridge)
    return mesh
  }

  private createMillstones() {
    const stoneMaterial = material(0x777466, { roughness: 0.94 })
    const edgeMaterial = material(0xb0a68b, { roughness: 0.84 })
    const darkEdgeMaterial = material(0x35372f, { roughness: 0.98 })
    for (const y of [0.36, -0.38]) {
      const stone = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.32, 0.4, 16), stoneMaterial)
      body.castShadow = body.receiveShadow = this.quality.shadows
      stone.add(body)
      const sideBand = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.055, 6, 32), edgeMaterial)
      sideBand.rotation.x = Math.PI / 2
      stone.add(sideBand)
      const center = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.13, 6, 18), edgeMaterial)
      center.rotation.x = Math.PI / 2
      stone.add(center)
      const centerHole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.035, 16), darkEdgeMaterial)
      centerHole.position.y = 0.21
      stone.add(centerHole)
      for (let i = 0; i < 5; i += 1) {
        const groove = new THREE.Mesh(new THREE.TorusGeometry(0.52 + i * 0.17, 0.022, 5, 28), edgeMaterial)
        groove.rotation.x = Math.PI / 2
        groove.position.y = 0.205 * (i % 2 ? -1 : 1)
        groove.scale.x = 1 + Math.sin(i) * 0.02
        stone.add(groove)
      }
      stone.position.y = y
      this.stones.push(stone)
      this.millGroup.add(stone)
    }
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.94, 10), darkEdgeMaterial)
    spindle.position.y = 0
    this.millGroup.add(spindle)
    const millHopper = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.15, 0.28, 10), material(0x8c6a43, { roughness: 0.9 }))
    millHopper.position.y = 0.79
    millHopper.castShadow = this.quality.shadows
    const hopperThroat = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.18, 10), material(0x5b402b, { roughness: 0.94 }))
    hopperThroat.position.y = 0.59
    this.millGroup.add(millHopper, hopperThroat)
    const radialCuts = new THREE.Group()
    radialCuts.position.y = 0.575
    for (let i = 0; i < 6; i += 1) {
      const cut = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.018, 0.028), edgeMaterial)
      cut.position.x = 0.48
      cut.rotation.y = (i / 6) * Math.PI
      radialCuts.add(cut)
    }
    this.millGroup.add(radialCuts)
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), material(0x161512, { roughness: 1, opacity: 0.66 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = -0.64
    shadow.position.z = 0.2
    this.millGroup.add(shadow)
  }

  private createFlourCloud(): [THREE.Points, Float32Array, Float32Array] {
    const count = this.quality.flourCount
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count * 3)
    let seed = 1327
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3
      const radius = Math.pow(random(), 1.55) * 0.92
      const angle = random() * Math.PI * 2
      const y = (random() - 0.5) * 0.72 + (1 - radius / 0.92) * 0.12
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius * 0.65
      seeds[i3] = x
      seeds[i3 + 1] = y
      seeds[i3 + 2] = z
      positions[i3] = x
      positions[i3 + 1] = y
      positions[i3 + 2] = z
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const points = new THREE.Points(geometry, pointsMaterial(PALETTE.flour, this.quality.mobile ? 0.045 : 0.06, 0))
    points.frustumCulled = false
    return [points, positions, seeds]
  }

  private createFlourPile() {
    const profile = [
      new THREE.Vector2(0.02, -0.08),
      new THREE.Vector2(0.3, -0.09),
      new THREE.Vector2(0.58, -0.07),
      new THREE.Vector2(0.78, 0.0),
      new THREE.Vector2(0.9, 0.11),
      new THREE.Vector2(0.86, 0.22),
      new THREE.Vector2(0.7, 0.32),
      new THREE.Vector2(0.52, 0.42),
      new THREE.Vector2(0.32, 0.51),
      new THREE.Vector2(0.12, 0.56),
      new THREE.Vector2(0.02, 0.57),
    ]
    const pile = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), new THREE.MeshBasicMaterial({ color: 0xfff3dc, transparent: true }))
    pile.position.set(0, -0.62, 0.16)
    pile.scale.set(1, 0.9, 0.72)
    pile.castShadow = pile.receiveShadow = this.quality.shadows
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 28), material(0x8d8878, { roughness: 1, opacity: 0.1 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, -0.7, 0.18)
    shadow.scale.set(1, 0.55, 1)
    return new THREE.Group().add(pile, shadow)
  }

  private createBowlAndIngredients() {
    const bowlMaterial = material(0xcac3aa, { roughness: 0.72 })
    const profile = [
      new THREE.Vector2(0.48, -0.42),
      new THREE.Vector2(0.82, -0.36),
      new THREE.Vector2(1.16, -0.14),
      new THREE.Vector2(1.3, 0.18),
      new THREE.Vector2(1.25, 0.4),
      new THREE.Vector2(1.08, 0.52),
      new THREE.Vector2(0.96, 0.48),
      new THREE.Vector2(1.0, 0.28),
      new THREE.Vector2(0.9, 0.02),
      new THREE.Vector2(0.72, -0.18),
      new THREE.Vector2(0.44, -0.27),
    ]
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), bowlMaterial)
    bowl.castShadow = bowl.receiveShadow = this.quality.shadows
    this.bowlGroup.add(bowl)
    const flourSurface = new THREE.Mesh(new THREE.CircleGeometry(0.94, 24), material(PALETTE.flour, { roughness: 0.98 }))
    flourSurface.rotation.x = -Math.PI / 2
    flourSurface.position.y = 0.39
    this.bowlGroup.add(flourSurface)

    this.water = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), material(0x3f9dba, { roughness: 0.2, metalness: 0.05, opacity: 0.78, emissive: 0x123947, emissiveIntensity: 0.22 }))
    this.water.position.set(0.42, 1.18, 0.04)
    this.water.scale.set(0.62, 0.9, 0.62)
    this.ingredientsGroup.add(this.water)
    const saltMaterial = material(PALETTE.salt, { roughness: 0.9 })
    for (let i = 0; i < 6; i += 1) {
      const salt = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), saltMaterial)
      salt.position.set(Math.sin(i * 2.1) * 0.55, 0.42 + (i % 3) * 0.05, Math.cos(i * 1.7) * 0.36)
      this.ingredientsGroup.add(salt)
    }
    const yeastMaterial = material(PALETTE.yeast, { roughness: 0.92 })
    for (let i = 0; i < 5; i += 1) {
      const yeast = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), yeastMaterial)
      yeast.position.set(-0.38 + (i % 2) * 0.16, 0.48 + Math.floor(i / 2) * 0.08, -0.04 + (i % 3) * 0.12)
      this.ingredientsGroup.add(yeast)
    }

    const spoonHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.95, 8), material(0x7b4b2e, { roughness: 0.84 }))
    spoonHandle.position.y = 0.5
    const spoonBowl = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), material(0x9c6239, { roughness: 0.88 }))
    spoonBowl.position.y = 0.06
    spoonBowl.scale.set(0.78, 0.28, 1.05)
    this.mixingSpoon.add(spoonHandle, spoonBowl)
    this.mixingSpoon.position.set(-0.1, 0.4, 0.48)
    this.mixingSpoon.rotation.z = -0.32
    this.ingredientsGroup.add(this.mixingSpoon)
  }

  private createDoughWorld() {
    const rough = new THREE.Mesh(blobGeometry(1.2, 0.52, 0.76, 2), material(PALETTE.dough, { roughness: 0.98 }))
    const ball = new THREE.Mesh(blobGeometry(0.86, 0.8, 0.8, 3), material(PALETTE.doughLight, { roughness: 0.95 }))
    const folded = new THREE.Mesh(blobGeometry(1.3, 0.46, 0.78, 3), material(PALETTE.dough, { roughness: 0.92 }))
    const shaped = new THREE.Mesh(blobGeometry(1.16, 0.64, 0.82, 3), material(PALETTE.doughLight, { roughness: 0.95 }))
    rough.castShadow = ball.castShadow = folded.castShadow = shaped.castShadow = this.quality.shadows
    rough.position.y = 0.08
    ball.position.y = 0.08
    folded.position.y = 0.08
    shaped.position.y = 0.08
    this.doughVariants.push(rough, ball, folded)
    this.doughGroup.add(rough, ball, folded, shaped)
    return shaped
  }

  private createBubbles() {
    const bubbleMaterial = material(PALETTE.flour, { roughness: 0.45, opacity: 0.22, transparent: true })
    for (let i = 0; i < 11; i += 1) {
      const bubble = new THREE.Mesh(new THREE.TorusGeometry(0.07 + (i % 3) * 0.022, 0.018, 6, 14), bubbleMaterial)
      const angle = (i / 11) * Math.PI * 2
      bubble.position.set(Math.cos(angle) * (0.45 + (i % 2) * 0.35), 0.4 + (i % 4) * 0.14, 0.52 + Math.sin(angle) * 0.08)
      this.bubblesGroup.add(bubble)
    }
  }

  private createOven(): [THREE.Mesh, THREE.Mesh] {
    const bodyMaterial = material(0x35251f, { roughness: 0.88 })
    const trimMaterial = material(0x6c4935, { roughness: 0.72 })
    const interiorMaterial = material(0x100705, { roughness: 0.9 })
    const ovenBody = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3.6, 2.1), bodyMaterial)
    ovenBody.position.y = 0.12
    ovenBody.castShadow = ovenBody.receiveShadow = this.quality.shadows
    this.ovenGroup.add(ovenBody)
    const opening = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.25, 0.16), interiorMaterial)
    opening.position.set(0, 0.1, 1.08)
    this.ovenGroup.add(opening)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.22, 1.3), material(0xc84c20, { emissive: PALETTE.ember, emissiveIntensity: 1.5, opacity: 0, depthWrite: false }))
    glow.position.set(0, 0.12, 1.18)
    this.ovenGroup.add(glow)
    const ovenFloor = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.08, 0.82), trimMaterial)
    ovenFloor.position.set(0, -0.82, 0.78)
    this.ovenGroup.add(ovenFloor)
    const rack = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.035, 0.48), material(0x18100d, { roughness: 0.8, metalness: 0.2 }))
    rack.position.set(0, -0.6, 0.9)
    this.ovenGroup.add(rack)
    for (let i = -2; i <= 2; i += 1) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), material(0x3b2419, { roughness: 0.8, metalness: 0.18 }))
      bar.rotation.x = Math.PI / 2
      bar.position.set(i * 0.42, -0.58, 0.9)
      this.ovenGroup.add(bar)
    }
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(3.62, 0.18, 0.24), trimMaterial)
    frameTop.position.set(0, 1.3, 1.24)
    const frameBottom = frameTop.clone()
    frameBottom.position.y = -1.12
    const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.5, 0.24), trimMaterial)
    frameLeft.position.set(-1.72, 0.1, 1.24)
    const frameRight = frameLeft.clone()
    frameRight.position.x = 1.72
    this.ovenGroup.add(frameTop, frameBottom, frameLeft, frameRight)
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), trimMaterial)
    handle.rotation.z = Math.PI / 2
    handle.position.set(0, -1.48, 1.3)
    this.ovenGroup.add(handle)
    const ovenLoaf = new THREE.Mesh(loafGeometry(), material(0xd79754, { roughness: 0.9, emissive: 0x4b220d, emissiveIntensity: 0.3 }))
    ovenLoaf.position.set(0, -0.18, 0.48)
    this.ovenGroup.add(ovenLoaf)
    const ovenScoreMaterial = material(0x7b3516, { roughness: 0.98 })
    for (let i = 0; i < 3; i += 1) {
      const score = createScoreCut(ovenScoreMaterial, 0.58 + i * 0.04)
      score.position.set(-0.4 + i * 0.4, 0.48, 1.28)
      this.ovenGroup.add(score)
    }
    return [ovenLoaf, glow]
  }

  private createBreadReveal(): [THREE.Group, THREE.Group, THREE.Group] {
    const createHalf = (bodyMaterial: THREE.Material, scoreMaterial: THREE.Material, withCrumb = false) => {
      const group = new THREE.Group()
      const body = new THREE.Mesh(loafGeometry(), bodyMaterial)
      body.castShadow = body.receiveShadow = this.quality.shadows
      group.add(body)
      if (withCrumb) {
        const crumb = new THREE.Mesh(loafGeometry(), material(0xf5c982, { roughness: 0.95, emissive: 0x8b4c1b, emissiveIntensity: 0.26 }))
        crumb.position.set(0, -0.04, 0.43)
        crumb.scale.set(0.76, 0.64, 0.5)
        crumb.castShadow = crumb.receiveShadow = this.quality.shadows
        group.add(crumb)
      }
      for (let i = 0; i < 3; i += 1) {
        const score = createScoreCut(scoreMaterial, 0.62 + i * 0.04)
        score.position.set(-0.42 + i * 0.43, 0.56, 1.02)
        group.add(score)
      }
      return group
    }

    const bodyOptions = { roughness: 0.88, emissive: 0xa75a22, emissiveIntensity: 0.92 }
    const scoreOptions = { roughness: 0.96, emissive: 0x4c1e08, emissiveIntensity: 0.34 }
    const whole = createHalf(material(0xf0a75b, bodyOptions), material(PALETTE.crust, scoreOptions))
    const sliceA = createHalf(material(0xf0a75b, bodyOptions), material(PALETTE.crust, scoreOptions), true)
    const sliceB = createHalf(material(0xf0a75b, bodyOptions), material(PALETTE.crust, scoreOptions), true)
    whole.scale.set(0.82, 0.64, 0.72)
    sliceA.scale.set(0.82, 0.64, 0.72)
    sliceB.scale.set(0.82, 0.64, 0.72)
    this.breadGroup.add(whole, sliceA, sliceB, this.knifeGroup)
    return [whole, sliceA, sliceB]
  }

  private createTableAndKnife() {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.28, 4.8), material(PALETTE.table, { roughness: 0.94 }))
    slab.position.set(0, -1.4, 0)
    slab.castShadow = slab.receiveShadow = this.quality.shadows
    this.tableGroup.add(slab)
    const grainLineMaterial = material(0x715338, { roughness: 1, opacity: 0.4 })
    for (let i = 0; i < 7; i += 1) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(3.2 + (i % 3) * 0.65, 0.014, 0.026), grainLineMaterial)
      line.position.set((i % 2 ? -0.7 : 0.7), -1.245, -1.35 + i * 0.45)
      line.rotation.y = (i % 3 - 1) * 0.05
      this.tableGroup.add(line)
    }
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 1.25, 8), material(0x4d2a1d, { roughness: 0.82 }))
    handle.rotation.z = Math.PI / 2
    handle.position.set(-0.64, 0.32, 0.14)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.045, 0.28), material(0xc0b59a, { roughness: 0.34, metalness: 0.6 }))
    blade.position.set(0.45, 0.32, 0.14)
    blade.rotation.z = 0.03
    this.knifeGroup.add(handle, blade)
  }

  private createCrumbs(): [THREE.Points, Float32Array, Float32Array] {
    const count = this.quality.crumbCount
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count * 3)
    let seed = 6547
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3
      seeds[i3] = (random() - 0.5) * 2.8
      seeds[i3 + 1] = -0.92 + random() * 0.3
      seeds[i3 + 2] = (random() - 0.5) * 1.05
      positions[i3] = seeds[i3]
      positions[i3 + 1] = seeds[i3 + 1]
      positions[i3 + 2] = seeds[i3 + 2]
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const points = new THREE.Points(geometry, pointsMaterial(PALETTE.crumb, this.quality.mobile ? 0.06 : 0.08, 0))
    return [points, positions, seeds]
  }

  private createSteam(): [THREE.Points, Float32Array, Float32Array] {
    const count = this.quality.mobile ? 24 : 46
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count * 3)
    let seed = 3221
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3
      seeds[i3] = (random() - 0.5) * 1.9
      seeds[i3 + 1] = -0.2 + random() * 0.5
      seeds[i3 + 2] = 0.6 + random() * 0.35
      positions[i3] = seeds[i3]
      positions[i3 + 1] = seeds[i3 + 1]
      positions[i3 + 2] = seeds[i3 + 2]
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const points = new THREE.Points(geometry, pointsMaterial(0xf7e4c8, this.quality.mobile ? 0.09 : 0.12, 0))
    return [points, positions, seeds]
  }
}

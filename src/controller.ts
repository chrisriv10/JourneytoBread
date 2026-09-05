import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { JourneyState } from './types'
import { JourneyWorld } from './world'

gsap.registerPlugin(ScrollTrigger)

export class JourneyController {
  readonly lenis: Lenis
  private readonly world: JourneyWorld
  private readonly rail: HTMLElement
  private readonly onStateChange?: (state: JourneyState) => void
  private readonly progressProxy = { value: 0 }
  private timeline: gsap.core.Timeline | null = null
  private trigger: ScrollTrigger | null = null
  private tick: ((time: number) => void) | null = null
  private readonly totalScroll = 9200
  private scrollLockFrames = 0
  private forcedProgress: number | null = null

  constructor(world: JourneyWorld, rail: HTMLElement, onStateChange?: (state: JourneyState) => void) {
    this.world = world
    this.rail = rail
    this.onStateChange = onStateChange
    this.lenis = new Lenis({
      duration: 1.15,
      smoothWheel: false,
      syncTouch: false,
      touchMultiplier: 1.05,
    })
    this.setupTimeline()
  }

  get progress() {
    return this.progressProxy.value
  }

  get maxScroll() {
    return Math.max(document.documentElement.scrollHeight - window.innerHeight, this.totalScroll)
  }

  scrollToProgress(progress: number) {
    const next = Math.max(0, Math.min(1, progress))
    const start = this.trigger?.start ?? 0
    const end = this.trigger?.end ?? this.maxScroll
    const target = start + (end - start) * next
    this.forcedProgress = next
    this.scrollLockFrames = 8
    window.scrollTo({ top: target, left: 0, behavior: 'auto' })
    this.lenis.scrollTo(target, { immediate: true, force: true })
    this.progressProxy.value = next
    this.world.setProgress(next)
    this.timeline?.progress(next)
    ScrollTrigger.update()
    return this.world.getState()
  }

  replay() {
    this.forcedProgress = null
    this.lenis.scrollTo(0, { duration: 1.35, force: true })
  }

  destroy() {
    this.trigger?.kill()
    this.timeline?.kill()
    this.lenis.destroy()
    if (this.tick) gsap.ticker.remove(this.tick)
    window.removeEventListener('wheel', this.releaseForcedProgress)
    window.removeEventListener('touchstart', this.releaseForcedProgress)
    window.removeEventListener('keydown', this.releaseForcedProgress)
    window.removeEventListener('scroll', this.handleWindowScroll)
    window.removeEventListener('wheel', this.handleWheel)
  }

  private setupTimeline() {
    this.timeline = gsap.timeline({ paused: true })
    this.timeline.to(this.progressProxy, {
      value: 1,
      duration: 1,
      ease: 'none',
      onUpdate: () => {
        if (this.scrollLockFrames > 0 || this.forcedProgress !== null) return
        const state = this.world.setProgress(this.progressProxy.value)
        this.onStateChange?.(state)
      },
    })

    this.trigger = ScrollTrigger.create({
      animation: this.timeline,
      trigger: this.rail,
      start: 'top top',
      end: `+=${this.totalScroll}`,
      scrub: 0.68,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        if (this.scrollLockFrames > 0 || this.forcedProgress !== null) return
        this.progressProxy.value = self.progress
        this.onStateChange?.(this.world.setProgress(self.progress))
      },
    })

    this.lenis.on('scroll', (instance) => {
      ScrollTrigger.update()
      this.handleNativeScroll(instance.scroll)
    })
    window.addEventListener('scroll', this.handleWindowScroll, { passive: true })
    this.tick = (time) => {
      this.lenis.raf(time * 1000)
      if (this.scrollLockFrames > 0) this.scrollLockFrames -= 1
      if (this.forcedProgress !== null) {
        this.onStateChange?.(this.world.setProgress(this.forcedProgress))
      }
    }
    gsap.ticker.add(this.tick)
    gsap.ticker.lagSmoothing(0)
    window.addEventListener('wheel', this.releaseForcedProgress, { passive: true })
    window.addEventListener('wheel', this.handleWheel, { passive: false })
    window.addEventListener('touchstart', this.releaseForcedProgress, { passive: true })
    window.addEventListener('keydown', this.releaseForcedProgress, { passive: true })
    this.world.setProgress(0)
  }

  private readonly releaseForcedProgress = () => {
    if (this.forcedProgress !== null) {
      this.forcedProgress = null
      this.scrollLockFrames = 8
    }
  }

  private readonly handleNativeScroll = (scrollTop = window.scrollY) => {
    if (this.scrollLockFrames > 0 || this.forcedProgress !== null) return
    const progress = Math.max(0, Math.min(1, scrollTop / this.totalScroll))
    if (Math.abs(progress - this.progressProxy.value) < 0.0001) return
    this.progressProxy.value = progress
    this.onStateChange?.(this.world.setProgress(progress))
  }

  private readonly handleWindowScroll = () => this.handleNativeScroll()

  private readonly handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.deltaY === 0) return
    if (this.forcedProgress !== null) this.releaseForcedProgress()
    this.scrollLockFrames = 0
    event.preventDefault()
    const nextScroll = Math.max(0, Math.min(this.totalScroll, window.scrollY + event.deltaY))
    window.scrollTo({ top: nextScroll, left: 0, behavior: 'auto' })
  }
}

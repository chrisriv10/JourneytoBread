import Lenis from 'lenis'
import { JourneyWorld } from './world'

export class JourneyController {
  private readonly world: JourneyWorld
  private readonly lenis: Lenis
  private animationFrame = 0
  private readonly handleLenisScroll = (instance: Lenis) => {
    this.world.setProgress(instance.progress)
  }

  constructor(world: JourneyWorld) {
    this.world = world
    this.lenis = new Lenis({
      autoRaf: false,
      smoothWheel: true,
      syncTouch: true,
      lerp: 0.1,
      wheelMultiplier: 0.9,
      touchMultiplier: 1,
      respectReducedMotion: true,
    })
    this.lenis.on('scroll', this.handleLenisScroll)
    window.addEventListener('keydown', this.handleKeydown)
    this.world.setProgress(this.lenis.progress)
    this.animationFrame = requestAnimationFrame(this.raf)
  }

  get progress() {
    return this.lenis.progress
  }

  get maxScroll() {
    return this.lenis.limit
  }

  scrollToProgress(progress: number) {
    const next = Math.max(0, Math.min(1, progress))
    this.lenis.stop()
    this.lenis.start()
    this.lenis.resize()
    this.lenis.scrollTo(next * this.lenis.limit, { immediate: true, force: true })
    const state = this.world.setProgress(next)
    return state
  }

  replay() {
    return this.scrollToProgress(0)
  }

  destroy() {
    cancelAnimationFrame(this.animationFrame)
    window.removeEventListener('keydown', this.handleKeydown)
    this.lenis.off('scroll', this.handleLenisScroll)
    this.lenis.destroy()
  }

  private readonly raf = (time: number) => {
    this.lenis.raf(time)
    this.animationFrame = requestAnimationFrame(this.raf)
  }

  private readonly handleKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    if (event.key === ' ' && target?.closest('button, a')) return
    const page = window.innerHeight * 0.88
    const current = this.lenis.targetScroll
    const destinations: Record<string, number> = {
      Home: 0,
      End: this.lenis.limit,
      PageDown: current + page,
      PageUp: current - page,
      ArrowDown: current + 60,
      ArrowUp: current - 60,
      ' ': current + (event.shiftKey ? -page : page),
    }
    const destination = destinations[event.key]
    if (destination === undefined) return
    event.preventDefault()
    // Keyboard navigation must replace any remaining wheel/touch destination.
    this.lenis.scrollTo(destination, {
      force: true,
      lerp: 0.18,
      immediate: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
  }
}

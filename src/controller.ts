import Lenis from 'lenis'
import { JourneyWorld } from './world'

export const PLAYBACK_DURATION_SECONDS = 120

export class JourneyController {
  private readonly world: JourneyWorld
  private readonly lenis: Lenis
  private readonly onPlaybackChange: (() => void) | null
  private animationFrame = 0
  private playbackPlaying = false
  private playbackStartProgress = 0
  private playbackStartTime = 0
  private readonly handleLenisScroll = (instance: Lenis) => {
    this.world.setProgress(instance.progress)
  }

  constructor(world: JourneyWorld, onPlaybackChange?: () => void) {
    this.world = world
    this.onPlaybackChange = onPlaybackChange ?? null
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
    window.addEventListener('wheel', this.handleUserIntent, { passive: true, capture: true })
    window.addEventListener('touchstart', this.handleUserIntent, { passive: true, capture: true })
    document.addEventListener('visibilitychange', this.handleVisibility)
    this.world.setProgress(this.lenis.progress)
    this.animationFrame = requestAnimationFrame(this.raf)
  }

  get progress() {
    return this.lenis.progress
  }

  get maxScroll() {
    return this.lenis.limit
  }

  get isPlaying() {
    return this.playbackPlaying
  }

  play() {
    let start = this.lenis.progress
    if (start >= 1) {
      // Replay from the beginning without reloading anything.
      this.applyPlaybackProgress(0)
      start = 0
    }
    this.playbackStartProgress = start
    this.playbackStartTime = performance.now()
    this.setPlaying(true)
  }

  pausePlayback() {
    this.setPlaying(false)
  }

  scrollToProgress(progress: number) {
    // Any explicit seek hands control back to manual scrolling.
    this.pausePlayback()
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
    window.removeEventListener('wheel', this.handleUserIntent, { capture: true } as AddEventListenerOptions)
    window.removeEventListener('touchstart', this.handleUserIntent, { capture: true } as AddEventListenerOptions)
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.lenis.off('scroll', this.handleLenisScroll)
    this.lenis.destroy()
  }

  private setPlaying(value: boolean) {
    if (this.playbackPlaying === value) return
    this.playbackPlaying = value
    this.onPlaybackChange?.()
  }

  private applyPlaybackProgress(progress: number) {
    const next = Math.max(0, Math.min(1, progress))
    // Autoplay writes through the same canonical path as scrolling: the real
    // document scroll position stays synchronized, so manual control can
    // resume from the exact frame where playback stops.
    if (this.lenis.limit > 0) {
      this.lenis.scrollTo(next * this.lenis.limit, { immediate: true, force: true })
    }
    this.world.setProgress(next)
  }

  private readonly raf = (time: number) => {
    if (this.playbackPlaying) {
      try {
        // Elapsed real time keeps playback at ~120 seconds regardless of
        // frame rate, refresh rate, or dropped frames.
        const elapsed = (time - this.playbackStartTime) / 1000
        let next = this.playbackStartProgress + elapsed / PLAYBACK_DURATION_SECONDS
        if (next >= 1) {
          next = 1
          this.setPlaying(false)
        }
        this.applyPlaybackProgress(next)
      } catch {
        this.setPlaying(false)
      }
    }
    this.lenis.raf(time)
    this.animationFrame = requestAnimationFrame(this.raf)
  }

  private readonly handleUserIntent = (event: Event) => {
    if (!this.playbackPlaying) return
    // Programmatic scroll synchronization never fires these events, so any
    // real wheel/touch input here is the user taking back control.
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, select, [contenteditable="true"]')) return
    this.setPlaying(false)
  }

  private readonly handleVisibility = () => {
    // Never consume journey time while throttled in a background tab.
    if (document.visibilityState === 'hidden') this.setPlaying(false)
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
    this.setPlaying(false)
    event.preventDefault()
    // Keyboard navigation must replace any remaining wheel/touch destination.
    this.lenis.scrollTo(destination, {
      force: true,
      lerp: 0.18,
      immediate: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
  }
}

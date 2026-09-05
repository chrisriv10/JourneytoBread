import type { JourneyState } from './types'
import { JourneyWorld } from './world'

export class JourneyController {
  private readonly world: JourneyWorld
  private readonly onStateChange?: (state: JourneyState) => void
  private readonly progressProxy = { value: 0 }
  private readonly totalScroll = 9200
  private forcedProgress: number | null = null

  constructor(world: JourneyWorld, _rail: HTMLElement, onStateChange?: (state: JourneyState) => void) {
    this.world = world
    this.onStateChange = onStateChange
    window.addEventListener('scroll', this.handleWindowScroll, { passive: true })
    window.addEventListener('wheel', this.handleWheel, { passive: false })
    this.world.setProgress(0)
  }

  get progress() {
    return this.progressProxy.value
  }

  get maxScroll() {
    return Math.max(document.documentElement.scrollHeight - window.innerHeight, this.totalScroll)
  }

  scrollToProgress(progress: number) {
    const next = Math.max(0, Math.min(1, progress))
    this.forcedProgress = next
    this.progressProxy.value = next
    window.scrollTo({ top: next * this.totalScroll, left: 0, behavior: 'auto' })
    const state = this.world.setProgress(next)
    this.onStateChange?.(state)
    return state
  }

  replay() {
    this.forcedProgress = null
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    this.syncFromScroll()
  }

  destroy() {
    window.removeEventListener('scroll', this.handleWindowScroll)
    window.removeEventListener('wheel', this.handleWheel)
  }

  private readonly releaseForcedProgress = () => {
    this.forcedProgress = null
  }

  private readonly syncFromScroll = () => {
    if (this.forcedProgress !== null) return
    const progress = Math.max(0, Math.min(1, window.scrollY / this.totalScroll))
    if (Math.abs(progress - this.progressProxy.value) < 0.0001) return
    this.progressProxy.value = progress
    const state = this.world.setProgress(progress)
    this.onStateChange?.(state)
  }

  private readonly handleWindowScroll = () => this.syncFromScroll()

  private readonly handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.deltaY === 0) return
    this.releaseForcedProgress()
    event.preventDefault()
    const nextScroll = Math.max(0, Math.min(this.totalScroll, window.scrollY + event.deltaY))
    window.scrollTo({ top: nextScroll, left: 0, behavior: 'auto' })
    this.syncFromScroll()
  }
}

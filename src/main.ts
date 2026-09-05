import './styles.css'
import { AudioManager } from './audio'
import { JourneyController } from './controller'
import { getQualityConfig } from './quality'
import type { JourneyState } from './types'
import { JourneyWorld } from './world'

type ModelContext = {
  registerTool: (
    tool: {
      name: string
      title?: string
      description: string
      inputSchema: Record<string, unknown>
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
      execute: (input: unknown) => unknown | Promise<unknown>
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>
}

const experience = document.querySelector<HTMLElement>('#experience')!
const rail = document.querySelector<HTMLElement>('#scroll-rail')!
const loader = document.querySelector<HTMLElement>('#loader')!
const fallback = document.querySelector<HTMLElement>('#fallback')!
const stageNumber = document.querySelector<HTMLElement>('#stage-number')!
const stageLabel = document.querySelector<HTMLElement>('#stage-label')!
const timer = document.querySelector<HTMLElement>('#timer')!
const introCopy = document.querySelector<HTMLElement>('#intro-copy')!
const sceneCopy = document.querySelector<HTMLElement>('#scene-copy')!
const finishCopy = document.querySelector<HTMLElement>('#finish-copy')!
const soundToggle = document.querySelector<HTMLButtonElement>('#sound-toggle')!
const soundLabel = document.querySelector<HTMLElement>('#sound-label')!
const replayButton = document.querySelector<HTMLButtonElement>('#replay')!

if (!experience || !rail || !loader || !fallback || !stageNumber || !stageLabel || !timer || !introCopy || !sceneCopy || !finishCopy || !soundToggle || !soundLabel || !replayButton) {
  throw new Error('Journey to Bread could not find its interface shell.')
}

const audio = new AudioManager()
const quality = getQualityConfig()
let world: JourneyWorld | null = null
let controller: JourneyController | null = null

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function updateHud(state: JourneyState) {
  const sceneCopyByStage = ['WHEAT', 'ONE GRAIN.', 'BREAKING IT DOWN.', 'FLOUR.', 'FLOUR. WATER. SALT. TIME.', 'MAKE IT SOFT.', 'WAIT.', 'HEAT.', '']
  stageNumber.textContent = `${String(state.stageIndex).padStart(2, '0')} / 09`
  stageLabel.textContent = state.stageLabel
  timer.textContent = formatTime(state.remainingSeconds)
  timer.setAttribute('aria-label', `${formatTime(state.remainingSeconds)} remaining in the journey`)
  introCopy.style.opacity = String(Math.max(0, 1 - state.progress * 14))
  sceneCopy.textContent = sceneCopyByStage[state.stageIndex - 1] ?? ''
  sceneCopy.classList.toggle('is-visible', state.progress > 0.17 && state.progress < 0.93)
  finishCopy.classList.toggle('is-visible', state.progress > 0.93)
  finishCopy.setAttribute('aria-hidden', String(state.progress <= 0.93))
  document.documentElement.style.setProperty('--journey-progress', String(state.progress))
  audio.setProgress(state.progress)
}

function setupWebMcp(activeController: JourneyController) {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext
  if (!context?.registerTool) return

  const lifecycle = new AbortController()
  void Promise.resolve(context.registerTool({
    name: 'set_journey_progress',
    title: 'Set journey progress',
    description: 'Move Journey to Bread to a specific scroll progress between 0 and 1 and return the visible stage and countdown.',
    inputSchema: {
      type: 'object',
      properties: { progress: { type: 'number', minimum: 0, maximum: 1 } },
      required: ['progress'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const value = (input as { progress?: unknown })?.progress
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('progress must be a finite number between 0 and 1')
      }
      return activeController.scrollToProgress(value)
    },
  }, { signal: lifecycle.signal })).catch(() => undefined)

  window.addEventListener('beforeunload', () => lifecycle.abort(), { once: true })
}

try {
  world = new JourneyWorld(experience, quality, updateHud)
  controller = new JourneyController(world, rail, updateHud)
  setupWebMcp(controller)

  soundToggle.addEventListener('click', async () => {
    const enabled = await audio.toggle()
    soundToggle.setAttribute('aria-pressed', String(enabled))
    soundToggle.setAttribute('aria-label', enabled ? 'Turn sound off' : 'Turn sound on')
    soundLabel.textContent = enabled ? 'Sound on' : 'Sound off'
    soundToggle.classList.toggle('is-on', enabled)
  })

  replayButton.addEventListener('click', () => controller?.replay())
  const previewProgress = Number(new URLSearchParams(window.location.search).get('progress'))
  if (Number.isFinite(previewProgress) && previewProgress >= 0 && previewProgress <= 1) {
    window.setTimeout(() => controller?.scrollToProgress(previewProgress), 120)
  }
  window.setTimeout(() => loader.classList.add('is-hidden'), quality.reducedMotion ? 100 : 360)
} catch (error) {
  console.error(error)
  experience.hidden = true
  rail.hidden = true
  loader.hidden = true
  fallback.hidden = false
  document.body.classList.add('webgl-fallback')
}

window.addEventListener('beforeunload', () => {
  controller?.destroy()
  world?.destroy()
  audio.disable()
}, { once: true })

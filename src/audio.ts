// Procedural journey soundscape: restrained physical foley driven by scroll progress.
//
// Design notes:
// - No music, no melody, no beat. Continuous layers are pure functions of
//   journey progress, so slow/fast/reverse scrubbing and `?progress=` jumps
//   always produce the correct mix. Only discrete physical events (thumps,
//   cuts, crackles) are forward-only transients, each with cooldowns and
//   fast-scrub suppression so scrubbing never machine-guns.
// - All gains move through setTargetAtTime: no zipper noise, no clicks.
// - Noise buffers are generated once at init and reused by every layer.
// - The AudioContext/graph is created once, then suspend()/resume() on toggle.

const MASTER_LEVEL = 0.14
const ENABLE_TAU = 0.12 // ~350ms fade-in, no blast on toggle
const DISABLE_TAU = 0.09 // reaches silence before suspend fires
const DISABLE_SUSPEND_MS = 320
const MAX_VOICES = 4
const SCRUB_VELOCITY_LIMIT = 1.5 // progress/sec above which transients stay silent

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(progress: number, start: number, end: number) {
  const t = clamp01((progress - start) / Math.max(end - start, 0.0001))
  return t * t * (3 - 2 * t)
}

type FilterSpec = {
  type: BiquadFilterType
  frequency: number
  q?: number
}

type ContinuousLayer = {
  gain: GainNode
  level: number
  tau: number
  envelope: (p: number) => number
}

type TransientPoint = {
  id: string
  at: number
  cooldownMs: number
  lastFired: number
  play: () => void
}

export class AudioManager {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private buses: Record<string, GainNode> = {}
  private layers: ContinuousLayer[] = []
  private transients: TransientPoint[] = []
  private brownBuffer: AudioBuffer | null = null
  private whiteBuffer: AudioBuffer | null = null
  private burstBuffer: AudioBuffer | null = null
  private suspendTimer = 0
  private activeVoices = 0
  private windEnvelope: (p: number) => number = () => 0
  private windLfoDepth: GainNode | null = null
  private progress = 0
  private lastProgress = 0
  private lastProgressTime = 0
  private enabled = false

  get isEnabled() {
    return this.enabled
  }

  async toggle() {
    if (this.enabled) {
      this.disable()
      return false
    }

    await this.enable()
    return this.enabled
  }

  async enable() {
    if (this.enabled) return

    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return

    if (!this.context) {
      this.context = new AudioContextClass()
      this.buildGraph()
    }
    window.clearTimeout(this.suspendTimer)
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume()
      } catch {
        return
      }
    }

    this.enabled = true
    // Never replay history: enabling mid-journey adopts the current progress
    // as the baseline, so no transient fires for something already on screen.
    this.lastProgress = this.progress
    this.lastProgressTime = performance.now()
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(MASTER_LEVEL, this.context.currentTime, ENABLE_TAU)
      this.applyContinuous(this.progress)
    }
  }

  disable() {
    if (!this.enabled || !this.context || !this.master) return
    this.enabled = false
    // Fade first, suspend after the fade has audibly completed.
    this.master.gain.setTargetAtTime(0, this.context.currentTime, DISABLE_TAU)
    window.clearTimeout(this.suspendTimer)
    this.suspendTimer = window.setTimeout(() => {
      if (!this.enabled) {
        this.context?.suspend().catch(() => undefined)
      }
    }, DISABLE_SUSPEND_MS)
  }

  setProgress(progress: number) {
    const now = performance.now()
    const dt = Math.max((now - this.lastProgressTime) / 1000, 0.001)
    const velocity = (progress - this.lastProgress) / dt
    // Always remember progress, even while muted, so enabling mid-journey
    // immediately reflects the current stage with no extra scroll required.
    this.progress = progress
    if (!this.enabled || !this.context) {
      this.lastProgress = progress
      this.lastProgressTime = now
      return
    }
    this.applyContinuous(progress)
    this.fireTransients(progress, velocity, now)
    this.lastProgress = progress
    this.lastProgressTime = now
  }

  private applyContinuous(progress: number) {
    if (!this.context) return
    const now = this.context.currentTime
    for (const layer of this.layers) {
      layer.gain.gain.setTargetAtTime(layer.envelope(progress) * layer.level, now, layer.tau)
    }
    this.windLfoDepth?.gain.setTargetAtTime(this.windEnvelope(progress) * 0.05, now, 0.25)
  }

  private fireTransients(progress: number, velocity: number, now: number) {
    if (Math.abs(velocity) > SCRUB_VELOCITY_LIMIT) return
    for (const point of this.transients) {
      // Forward crossings only: reverse scrubbing must stay silent.
      if (this.lastProgress < point.at && progress >= point.at && now - point.lastFired >= point.cooldownMs) {
        if (this.activeVoices >= MAX_VOICES) continue
        point.lastFired = now
        point.play()
      }
    }
  }

  // --- graph construction (runs once) ---

  private buildGraph() {
    const context = this.context
    if (!context) throw new Error('Audio context is not ready')

    this.master = context.createGain()
    this.master.gain.value = 0
    this.master.connect(context.destination)

    const bus = (name: string, pan: number) => {
      const gain = context.createGain()
      gain.gain.value = 1
      if (typeof context.createStereoPanner === 'function' && pan !== 0) {
        const panner = context.createStereoPanner()
        panner.pan.value = pan
        gain.connect(panner).connect(this.master as GainNode)
      } else {
        gain.connect(this.master as GainNode)
      }
      this.buses[name] = gain
      return gain
    }
    bus('ambience', 0)
    bus('mill', -0.15)
    bus('flour', 0)
    bus('water', 0.1)
    bus('mixing', 0.05)
    bus('oven', 0)
    bus('foley', 0)

    this.brownBuffer = this.makeBrownNoise(2)
    this.whiteBuffer = this.makeWhiteNoise(2)
    this.burstBuffer = this.makeWhiteNoise(0.3)

    // Continuous layers. Levels are relative (master carries overall loudness);
    // envelopes below keep at most 2-4 layers clearly perceptible at once.
    // Field wind falls fully away once the mill takes over: no wheat character
    // survives into mixing, proofing, the oven, or the finale.
    this.windEnvelope = (p) => 1 - smoothstep(p, 0.1, 0.34)
    const windEnvelope = this.windEnvelope
    this.addLayer('ambience', this.brownBuffer, { type: 'lowpass', frequency: 420 }, 0.3, 0.25,
      (p) => windEnvelope(p))
    this.addLayer('ambience', this.whiteBuffer, { type: 'bandpass', frequency: 2400, q: 0.8 }, 0.1, 0.2,
      (p) => smoothstep(p, 0, 0.03) * (1 - smoothstep(p, 0.14, 0.24)))
    // Buried sub oscillator gives the mill weight without an electronic edge.
    this.addLayer('mill', this.brownBuffer, { type: 'lowpass', frequency: 120 }, 0.55, 0.18,
      (p) => smoothstep(p, 0.24, 0.3) * (1 - smoothstep(p, 0.4, 0.44)))
    this.addLayer('mill', this.whiteBuffer, { type: 'bandpass', frequency: 500, q: 1.2 }, 0.3, 0.08,
      (p) => {
        const grind = smoothstep(p, 0.26, 0.31) * (1 - smoothstep(p, 0.39, 0.43))
        // Progress-derived grit modulation, loosely following the visual rotor
        // without touching visual code. Deterministic and reversible.
        const grindNorm = clamp01((p - 0.284) / 0.121)
        return grind * (0.75 + 0.25 * Math.sin(grindNorm * Math.PI * 5.75))
      })
    this.addLayer('flour', this.whiteBuffer, { type: 'bandpass', frequency: 3000, q: 0.6 }, 0.22, 0.09,
      (p) => smoothstep(p, 0.3, 0.36) * (1 - smoothstep(p, 0.43, 0.48)))
    this.addLayer('flour', this.brownBuffer, { type: 'lowpass', frequency: 500 }, 0.22, 0.12,
      (p) => smoothstep(p, 0.33, 0.38) * (1 - smoothstep(p, 0.42, 0.47)))
    this.addLayer('water', this.whiteBuffer, { type: 'bandpass', frequency: 1600, q: 0.7 }, 0.55, 0.06,
      (p) => smoothstep(p, 0.486, 0.496) * (1 - smoothstep(p, 0.514, 0.524)))
    this.addLayer('mixing', this.whiteBuffer, { type: 'bandpass', frequency: 900, q: 1.5 }, 0.3, 0.07,
      (p) => {
        const base = smoothstep(p, 0.49, 0.505) * (1 - smoothstep(p, 0.56, 0.585))
        // Scrape rhythm derived from mixing progress (mirrors the visual stir
        // window 0.492-0.568), so it stays synchronized and reversible.
        const stirNorm = clamp01((p - 0.492) / 0.076)
        return base * (0.55 + 0.45 * Math.sin(stirNorm * Math.PI * 5))
      })
    this.addLayer('mixing', this.brownBuffer, { type: 'lowpass', frequency: 220 }, 0.3, 0.14,
      (p) => smoothstep(p, 0.55, 0.62) * (1 - smoothstep(p, 0.68, 0.74)))
    this.addLayer('ambience', this.whiteBuffer, { type: 'lowpass', frequency: 600 }, 0.05, 0.25,
      (p) => 1 + smoothstep(p, 0.68, 0.71) * (1 - smoothstep(p, 0.76, 0.8)) * 0.6)
    this.addLayer('oven', this.brownBuffer, { type: 'lowpass', frequency: 240 }, 0.5, 0.2,
      (p) => smoothstep(p, 0.735, 0.8) * (1 - smoothstep(p, 0.925, 0.98)))
    this.addLayer('oven', this.whiteBuffer, { type: 'highpass', frequency: 5000 }, 0.05, 0.15,
      (p) => smoothstep(p, 0.8, 0.86) * (1 - smoothstep(p, 0.92, 0.97)))
    this.addLayer('oven', this.whiteBuffer, { type: 'bandpass', frequency: 4000, q: 0.7 }, 0.18, 0.08,
      (p) => smoothstep(p, 0.87, 0.9) * (1 - smoothstep(p, 0.93, 0.96)))
    this.addLayer('ambience', this.brownBuffer, { type: 'lowpass', frequency: 300 }, 0.08, 0.3,
      (p) => smoothstep(p, 0.97, 1))

    this.addSlowWobble()
    this.registerTransients()
  }

  private addLayer(
    busName: string,
    buffer: AudioBuffer,
    filter: FilterSpec,
    level: number,
    tau: number,
    envelope: (p: number) => number,
  ) {
    const context = this.context
    const bus = this.buses[busName]
    if (!context || !bus) throw new Error('Audio graph is not ready')
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const filterNode = context.createBiquadFilter()
    filterNode.type = filter.type
    filterNode.frequency.value = filter.frequency
    filterNode.Q.value = filter.q ?? 0.7
    const gain = context.createGain()
    gain.gain.value = 0
    source.connect(filterNode).connect(gain).connect(bus)
    source.start()
    this.layers.push({ gain, level, tau, envelope })
  }

  // Slow audio-rate movement for wind texture. Persistent nodes, no per-frame
  // work, and purely textural so reversibility is unaffected. The LFO depth
  // tracks the wind envelope (always one-sixth of the base gain), so the
  // modulation can never exceed the faded layer or push it through zero.
  private addSlowWobble() {
    const context = this.context
    if (!context || this.layers.length < 8) return
    const windLfo = context.createOscillator()
    windLfo.frequency.value = 0.07
    const windDepth = context.createGain()
    windDepth.gain.value = 0
    windLfo.connect(windDepth).connect(this.layers[0].gain.gain)
    windLfo.start()
    this.windLfoDepth = windDepth
  }

  // --- transients (sparse, forward-only, guarded) ---

  private registerTransients() {
    // Kneading fold beats across the visual knead window 0.61-0.69.
    for (const at of [0.623, 0.65, 0.677]) {
      this.transients.push({
        id: `knead-${at}`, at, cooldownMs: 800, lastFired: 0,
        play: () => this.playThump({ level: 0.14, duration: 0.18, sineFrequency: 95, noiseCutoff: 220 }),
      })
    }
    // Arrival on the final board: one of the two clearest transients.
    this.transients.push({
      id: 'board-thump', at: 0.972, cooldownMs: 2000, lastFired: 0,
      play: () => this.playThump({ level: 0.5, duration: 0.35, sineFrequency: 70, noiseCutoff: 320 }),
    })
    this.transients.push({
      id: 'knife-tick', at: 0.989, cooldownMs: 2000, lastFired: 0,
      play: () => this.playBurst({ duration: 0.07, type: 'highpass', frequency: 3000, level: 0.12 }),
    })
    // The final tactile payoff: dry crisp cut, the clearest transient.
    this.transients.push({
      id: 'slice-cut', at: 0.9915, cooldownMs: 2500, lastFired: 0,
      play: () => this.playBurst({ duration: 0.35, type: 'bandpass', frequency: 4200, endFrequency: 1400, q: 1, level: 0.42 }),
    })
    this.transients.push({
      id: 'crumb-tick', at: 0.9945, cooldownMs: 2000, lastFired: 0,
      play: () => this.playBurst({ duration: 0.06, type: 'highpass', frequency: 3600, level: 0.06 }),
    })
    // Sparse seeded oven crackles: fixed progress positions, so scrubbing to
    // the same point always behaves the same way. Quiet by design.
    let seed = 1234567
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    const spots = Array.from({ length: 14 }, () => 0.78 + random() * 0.17).sort((a, b) => a - b)
    spots.forEach((at, index) => {
      this.transients.push({
        id: `crackle-${index}`, at, cooldownMs: 400, lastFired: 0,
        play: () => this.playBurst({
          duration: 0.05 + random() * 0.05,
          type: 'highpass',
          frequency: 2000 + random() * 4000,
          level: 0.03 + random() * 0.05,
        }),
      })
    })
  }

  private playBurst(options: {
    duration: number
    type: BiquadFilterType
    frequency: number
    endFrequency?: number
    q?: number
    level: number
  }) {
    const context = this.context
    const bus = this.buses.foley
    if (!context || !bus || !this.burstBuffer) return
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = this.burstBuffer
    const filter = context.createBiquadFilter()
    filter.type = options.type
    filter.frequency.setValueAtTime(options.frequency, now)
    if (options.endFrequency !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(options.endFrequency, 1), now + options.duration)
    }
    filter.Q.value = options.q ?? 0.8
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(options.level, 0.0002), now + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration)
    source.connect(filter).connect(gain).connect(bus)
    this.trackVoice(source)
    source.start(now)
    source.stop(now + options.duration + 0.05)
  }

  private playThump(options: { level: number; duration: number; sineFrequency: number; noiseCutoff: number }) {
    const context = this.context
    const bus = this.buses.foley
    if (!context || !bus || !this.burstBuffer) return
    const now = context.currentTime
    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(options.sineFrequency, now)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(options.sineFrequency * 0.55, 1), now + options.duration)
    const oscGain = context.createGain()
    oscGain.gain.setValueAtTime(0.0001, now)
    oscGain.gain.exponentialRampToValueAtTime(Math.max(options.level * 0.7, 0.0002), now + 0.01)
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration)
    oscillator.connect(oscGain).connect(bus)
    this.trackVoice(oscillator)
    oscillator.start(now)
    oscillator.stop(now + options.duration + 0.05)

    const noise = context.createBufferSource()
    noise.buffer = this.burstBuffer
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = options.noiseCutoff
    const noiseGain = context.createGain()
    noiseGain.gain.setValueAtTime(0.0001, now)
    noiseGain.gain.exponentialRampToValueAtTime(Math.max(options.level * 0.5, 0.0002), now + 0.008)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration * 0.8)
    noise.connect(filter).connect(noiseGain).connect(bus)
    this.trackVoice(noise)
    noise.start(now)
    noise.stop(now + options.duration + 0.05)
  }

  private trackVoice(source: AudioScheduledSourceNode) {
    this.activeVoices += 1
    source.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1)
      try {
        source.disconnect()
      } catch {
        // Already disconnected; nothing to clean up.
      }
    }
  }

  // --- one-time noise buffers ---

  private makeWhiteNoise(seconds: number) {
    const context = this.context
    if (!context) throw new Error('Audio context is not ready')
    const length = Math.max(1, Math.floor(context.sampleRate * seconds))
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1
    }
    return buffer
  }

  private makeBrownNoise(seconds: number) {
    const context = this.context
    if (!context) throw new Error('Audio context is not ready')
    const length = Math.max(1, Math.floor(context.sampleRate * seconds))
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    return buffer
  }
}

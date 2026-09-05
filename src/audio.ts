import * as THREE from 'three'

export class AudioManager {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private wind: GainNode | null = null
  private rumble: GainNode | null = null
  private heat: GainNode | null = null
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

    this.context = new AudioContextClass()
    this.master = this.context.createGain()
    this.master.gain.value = 0.08
    this.master.connect(this.context.destination)

    this.wind = this.createNoiseLayer(0.18, 700, 0.012)
    this.rumble = this.createRumbleLayer(48, 0.008)
    this.heat = this.createNoiseLayer(0.18, 1600, 0.005)
    this.enabled = true

    if (this.context.state === 'suspended') await this.context.resume()
  }

  disable() {
    if (!this.context) return
    this.context.close()
    this.context = null
    this.master = null
    this.wind = null
    this.rumble = null
    this.heat = null
    this.enabled = false
  }

  setProgress(progress: number) {
    if (!this.enabled || !this.context || !this.wind || !this.rumble || !this.heat) return
    const now = this.context.currentTime
    const windAmount = THREE.MathUtils.lerp(1, 0.16, THREE.MathUtils.smoothstep(progress, 0.12, 0.34))
    const rumbleAmount = THREE.MathUtils.smoothstep(progress, 0.2, 0.38) * (1 - THREE.MathUtils.smoothstep(progress, 0.42, 0.58))
    const heatAmount = THREE.MathUtils.smoothstep(progress, 0.76, 0.96)
    this.wind.gain.setTargetAtTime(windAmount, now, 0.16)
    this.rumble.gain.setTargetAtTime(rumbleAmount, now, 0.18)
    this.heat.gain.setTargetAtTime(heatAmount, now, 0.2)
  }

  private createNoiseLayer(filterFrequency: number, resonance: number, gainValue: number) {
    if (!this.context || !this.master) throw new Error('Audio context is not ready')
    const bufferSize = this.context.sampleRate * 2
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < bufferSize; i += 1) {
      const white = Math.random() * 2 - 1
      last = last * 0.96 + white * 0.04
      data[i] = last
    }
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const filter = this.context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterFrequency
    filter.Q.value = resonance
    const gain = this.context.createGain()
    gain.gain.value = gainValue
    source.connect(filter).connect(gain).connect(this.master)
    source.start()
    return gain
  }

  private createRumbleLayer(frequency: number, gainValue: number) {
    if (!this.context || !this.master) throw new Error('Audio context is not ready')
    const oscillator = this.context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    const gain = this.context.createGain()
    gain.gain.value = gainValue
    oscillator.connect(gain).connect(this.master)
    oscillator.start()
    return gain
  }
}

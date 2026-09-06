import * as THREE from 'three'

export type Keyframe<T> = { at: number; value: T }

export function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1)
}

export function cinematic(value: number) {
  const t = clamp01(value)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function weightedOut(value: number) {
  const t = clamp01(value)
  return 1 - Math.pow(1 - t, 3)
}

export function softIn(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

export function bell(value: number, center = 0.5, width = 0.5) {
  const distance = Math.abs(value - center) / Math.max(width, 0.0001)
  return Math.max(0, 1 - distance * distance) ** 2
}

export function windowProgress(progress: number, start: number, end: number, easing: (value: number) => number = cinematic) {
  return easing(THREE.MathUtils.clamp((progress - start) / Math.max(end - start, 0.0001), 0, 1))
}

export function overlap(progress: number, start: number, end: number, feather = 0.12) {
  const fadeIn = windowProgress(progress, start, start + feather)
  const fadeOut = 1 - windowProgress(progress, end - feather, end)
  return THREE.MathUtils.clamp(Math.min(fadeIn, fadeOut), 0, 1)
}

export function delayed(progress: number, start: number, end: number, delay = 0.1) {
  return windowProgress(progress, start + delay * (end - start), end)
}

export function damp(current: number, target: number, lambda: number, delta: number) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * Math.max(delta, 0)))
}

export function dampVector(current: THREE.Vector3, target: THREE.Vector3, lambda: number, delta: number) {
  current.lerp(target, 1 - Math.exp(-lambda * Math.max(delta, 0)))
  return current
}

export function sampleNumberKeyframes(progress: number, keyframes: Keyframe<number>[]) {
  const p = clamp01(progress)
  if (p <= keyframes[0].at) return keyframes[0].value
  for (let i = 1; i < keyframes.length; i += 1) {
    const previous = keyframes[i - 1]
    const current = keyframes[i]
    if (p <= current.at) return THREE.MathUtils.lerp(previous.value, current.value, cinematic((p - previous.at) / (current.at - previous.at)))
  }
  return keyframes[keyframes.length - 1].value
}

export function sampleVectorKeyframes(progress: number, keyframes: Keyframe<THREE.Vector3>[], target: THREE.Vector3) {
  const p = clamp01(progress)
  if (p <= keyframes[0].at) return target.copy(keyframes[0].value)
  for (let i = 1; i < keyframes.length; i += 1) {
    const previous = keyframes[i - 1]
    const current = keyframes[i]
    if (p <= current.at) return target.lerpVectors(previous.value, current.value, cinematic((p - previous.at) / (current.at - previous.at)))
  }
  return target.copy(keyframes[keyframes.length - 1].value)
}

export function arcPosition(
  start: THREE.Vector3,
  end: THREE.Vector3,
  progress: number,
  height: number,
  target = new THREE.Vector3(),
) {
  const t = clamp01(progress)
  target.lerpVectors(start, end, t)
  target.y += Math.sin(t * Math.PI) * height
  return target
}

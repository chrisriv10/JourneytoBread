import * as THREE from 'three'

export type Keyframe<T> = { at: number; value: T }
export type SplineKeyframe<T> = Keyframe<T> & { tension?: number }

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

export type DampedValue = { value: number; velocity: number }

// Exact critically damped spring integration for a target held constant during
// this frame. Unlike a fixed lerp, this has the same response at any frame rate
// and preserves velocity when the user reverses direction mid-transition.
export function criticallyDamped(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  delta: number,
): DampedValue {
  const step = Math.max(0, Math.min(delta, 0.05))
  const omega = 2 / Math.max(0.001, smoothTime)
  const displacement = current - target
  const coefficient = velocity + omega * displacement
  const decay = Math.exp(-omega * step)
  const value = target + (displacement + coefficient * step) * decay
  const nextVelocity = (velocity - omega * coefficient * step) * decay
  return { value, velocity: nextVelocity }
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

function splineTangent<T>(keyframes: SplineKeyframe<T>[], index: number, valueAt: (value: T) => number) {
  const current = keyframes[index]
  const tension = THREE.MathUtils.clamp(current.tension ?? 0, 0, 1)
  if (index === 0) {
    const next = keyframes[1]
    return ((valueAt(next.value) - valueAt(current.value)) / Math.max(next.at - current.at, 0.0001)) * (1 - tension)
  }
  if (index === keyframes.length - 1) {
    const previous = keyframes[index - 1]
    return ((valueAt(current.value) - valueAt(previous.value)) / Math.max(current.at - previous.at, 0.0001)) * (1 - tension)
  }
  const previous = keyframes[index - 1]
  const next = keyframes[index + 1]
  return ((valueAt(next.value) - valueAt(previous.value)) / Math.max(next.at - previous.at, 0.0001)) * (1 - tension)
}

function monotoneScalarTangent(keyframes: SplineKeyframe<number>[], index: number) {
  const current = keyframes[index]
  const tension = THREE.MathUtils.clamp(current.tension ?? 0, 0, 1)
  if (index === 0) {
    const next = keyframes[1]
    return ((next.value - current.value) / Math.max(next.at - current.at, 0.0001)) * (1 - tension)
  }
  if (index === keyframes.length - 1) {
    const previous = keyframes[index - 1]
    return ((current.value - previous.value) / Math.max(current.at - previous.at, 0.0001)) * (1 - tension)
  }
  const previous = keyframes[index - 1]
  const next = keyframes[index + 1]
  const previousSpan = Math.max(current.at - previous.at, 0.0001)
  const nextSpan = Math.max(next.at - current.at, 0.0001)
  const previousSlope = (current.value - previous.value) / previousSpan
  const nextSlope = (next.value - current.value) / nextSpan
  if (previousSlope === 0 || nextSlope === 0 || Math.sign(previousSlope) !== Math.sign(nextSlope)) return 0
  const weightPrevious = 2 * nextSpan + previousSpan
  const weightNext = nextSpan + 2 * previousSpan
  const harmonic = (weightPrevious + weightNext) / (weightPrevious / previousSlope + weightNext / nextSlope)
  return harmonic * (1 - tension)
}

function hermite(value0: number, value1: number, tangent0: number, tangent1: number, span: number, local: number) {
  const local2 = local * local
  const local3 = local2 * local
  const h00 = 2 * local3 - 3 * local2 + 1
  const h10 = local3 - 2 * local2 + local
  const h01 = -2 * local3 + 3 * local2
  const h11 = local3 - local2
  return h00 * value0 + h10 * span * tangent0 + h01 * value1 + h11 * span * tangent1
}

// Progress-timed cubic Hermite sampling. Interior tangents are derived from the
// surrounding control points, so ordinary keys redirect the path without
// forcing the camera to stop. Optional tension is reserved for narrative rests.
export function sampleNumberSplineKeyframes(progress: number, keyframes: SplineKeyframe<number>[]) {
  const p = clamp01(progress)
  if (p <= keyframes[0].at) return keyframes[0].value
  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1]
    const current = keyframes[index]
    if (p <= current.at) {
      const span = Math.max(current.at - previous.at, 0.0001)
      const local = THREE.MathUtils.clamp((p - previous.at) / span, 0, 1)
      const sampled = hermite(
        previous.value,
        current.value,
        monotoneScalarTangent(keyframes, index - 1),
        monotoneScalarTangent(keyframes, index),
        span,
        local,
      )
      return THREE.MathUtils.clamp(sampled, Math.min(previous.value, current.value), Math.max(previous.value, current.value))
    }
  }
  return keyframes[keyframes.length - 1].value
}

export function sampleVectorSplineKeyframes(progress: number, keyframes: SplineKeyframe<THREE.Vector3>[], target: THREE.Vector3) {
  const p = clamp01(progress)
  if (p <= keyframes[0].at) return target.copy(keyframes[0].value)
  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1]
    const current = keyframes[index]
    if (p <= current.at) {
      const span = Math.max(current.at - previous.at, 0.0001)
      const local = THREE.MathUtils.clamp((p - previous.at) / span, 0, 1)
      const px = splineTangent(keyframes, index - 1, (value) => value.x)
      const py = splineTangent(keyframes, index - 1, (value) => value.y)
      const pz = splineTangent(keyframes, index - 1, (value) => value.z)
      const cx = splineTangent(keyframes, index, (value) => value.x)
      const cy = splineTangent(keyframes, index, (value) => value.y)
      const cz = splineTangent(keyframes, index, (value) => value.z)
      return target.set(
        hermite(previous.value.x, current.value.x, px, cx, span, local),
        hermite(previous.value.y, current.value.y, py, cy, span, local),
        hermite(previous.value.z, current.value.z, pz, cz, span, local),
      )
    }
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

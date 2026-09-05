import type { QualityConfig } from './types'

export function getQualityConfig(): QualityConfig {
  const mobile = window.matchMedia('(max-width: 700px)').matches || /Mobi|Android/i.test(navigator.userAgent)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const cores = navigator.hardwareConcurrency ?? 4
  const cautious = mobile || cores <= 4

  return {
    mobile,
    reducedMotion,
    dpr: Math.min(window.devicePixelRatio || 1, mobile ? 1.1 : cautious ? 1.35 : 1.65),
    wheatCount: mobile ? 420 : cautious ? 850 : 1450,
    flourCount: mobile ? 520 : cautious ? 1100 : 2200,
    crumbCount: mobile ? 28 : 58,
    bloom: !mobile && !reducedMotion && !cautious,
    shadows: !mobile && !reducedMotion,
  }
}

import type { QualityConfig } from './types'

export function getQualityConfig(): QualityConfig {
  const mobile = window.matchMedia('(max-width: 700px)').matches || /Mobi|Android/i.test(navigator.userAgent)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2') ?? probe.getContext('webgl')
  const maxTextureSize = gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? 2048
  const maxSamples = gl && 'MAX_SAMPLES' in gl ? gl.getParameter((gl as WebGL2RenderingContext).MAX_SAMPLES) : 0
  const capable = !mobile && maxTextureSize >= 4096 && maxSamples >= 4
  const tier = mobile ? 'mobile' : capable ? 'high' : 'balanced'
  gl?.getExtension('WEBGL_lose_context')?.loseContext()

  return {
    mobile,
    reducedMotion,
    tier,
    dpr: Math.min(window.devicePixelRatio || 1, tier === 'mobile' ? 1.1 : tier === 'balanced' ? 1.5 : 2),
    wheatCount: tier === 'mobile' ? 180 : tier === 'balanced' ? 420 : 680,
    flourCount: tier === 'mobile' ? 520 : tier === 'balanced' ? 1400 : 2600,
    crumbCount: tier === 'mobile' ? 28 : tier === 'balanced' ? 46 : 72,
    bloom: !mobile && !reducedMotion,
    shadows: !mobile,
    shadowMapSize: mobile ? 512 : capable ? 2048 : 1024,
    anisotropy: mobile ? 2 : capable ? 8 : 4,
  }
}

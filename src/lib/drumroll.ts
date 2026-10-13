/**
 * A tiny showtime drum roll, synthesised on the fly with the Web Audio API.
 *
 * Nothing is downloaded and no audio file ships with the app: the roll is built
 * from filtered noise bursts that speed up and get louder, the cymbal crash is
 * decaying noise, and the "ta-da" is a short rising chord. Browsers block audio
 * until the page has had a gesture and the roll is a progressive enhancement, so
 * every failure here is silent — the score popup still works with no sound.
 */

export interface DrumRollHandle {
  /** Stop the roll and play the crash + "ta-da" sting. */
  stop: () => void
  /** Stop immediately with no sting (unmount / dismissed early). */
  cancel: () => void
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctx: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  try {
    const ctx = new Ctx()
    void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/** One short snare hit: a high-passed noise burst with a fast decay. */
function snare(ctx: AudioContext, when: number, gain: number) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, 0.12)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 1500
  const env = ctx.createGain()
  env.gain.setValueAtTime(Math.max(0.0001, gain), when)
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.12)
  src.connect(hp).connect(env).connect(ctx.destination)
  src.start(when)
  src.stop(when + 0.13)
}

/** A cymbal crash: bright noise with a long tail. */
function crash(ctx: AudioContext, when: number, gain: number) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, 1.4)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 6000
  const env = ctx.createGain()
  env.gain.setValueAtTime(Math.max(0.0001, gain), when)
  env.gain.exponentialRampToValueAtTime(0.0001, when + 1.3)
  src.connect(hp).connect(env).connect(ctx.destination)
  src.start(when)
  src.stop(when + 1.4)
}

/** A rising major-chord "ta-da" stab, game-show style. */
function taDa(ctx: AudioContext, when: number, gain: number) {
  const freqs = [1046.5, 1318.5, 1568.0]
  freqs.forEach((freq, index) => {
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    const env = ctx.createGain()
    const t = when + index * 0.09
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + 0.02)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    osc.connect(env).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.55)
  })
}

/**
 * Start a drum roll that lasts `durationMs` (the roll ramps up over that time).
 * Call `stop()` when the number settles for the crash + "ta-da", or `cancel()`
 * to tear down silently.
 */
export function startDrumRoll(durationMs: number): DrumRollHandle {
  const ctx = getContext()
  if (!ctx) return { stop() {}, cancel() {} }

  const total = Math.max(0.3, durationMs / 1000)
  const start = ctx.currentTime + 0.04
  const end = start + total

  let t = start
  while (t < end) {
    const progress = (t - start) / total
    snare(ctx, t, 0.07 + 0.45 * progress)
    t += 0.05 - 0.032 * progress
  }

  let stopped = false
  let closeTimer = 0

  function shutdown(delayMs: number) {
    closeTimer = window.setTimeout(() => {
      void ctx?.close().catch(() => {})
    }, delayMs)
  }

  return {
    stop() {
      if (stopped) return
      stopped = true
      const now = ctx.currentTime + 0.02
      crash(ctx, now, 0.5)
      taDa(ctx, now + 0.02, 0.26)
      shutdown(2200)
    },
    cancel() {
      if (stopped) return
      stopped = true
      window.clearTimeout(closeTimer)
      void ctx.close().catch(() => {})
    },
  }
}

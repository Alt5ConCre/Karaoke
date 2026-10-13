/**
 * YouTube helpers.
 *
 * This app only ever *embeds* via the official player. It never downloads a
 * video, never extracts audio, and never proxies a stream — that is both a
 * YouTube Terms-of-Service requirement and the whole reason `youtubeId` is a
 * plain id rather than a URL.
 */

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

export function isValidVideoId(id: string): boolean {
  return VIDEO_ID_PATTERN.test(id.trim())
}

/**
 * Accepts a bare id or any common YouTube URL form and returns the id, or null
 * if nothing usable was found. Handy for an operator pasting a link they are
 * permitted to embed.
 */
export function parseVideoId(input: string): string | null {
  const value = input.trim()
  if (value === '') return null
  if (isValidVideoId(value)) return value

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0]
      return isValidVideoId(id) ? id : null
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v')
      if (v && isValidVideoId(v)) return v
      const parts = url.pathname.split('/').filter(Boolean)
      const marker = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v')
      if (marker >= 0 && parts[marker + 1] && isValidVideoId(parts[marker + 1])) {
        return parts[marker + 1]
      }
    }
  } catch {
    return null
  }
  return null
}

/** Privacy-preserving embed base; enablejsapi is required by the IFrame API. */
export function buildEmbedUrl(videoId: string, origin: string): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    origin,
  })
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
}

/**
 * The public watch page for a video. Used for the "watch it on YouTube instead"
 * escape hatch when a video cannot be played in an embed — we never try to work
 * around an embed restriction, we just hand the viewer the sanctioned link.
 */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/**
 * Turn a YouTube IFrame API error code into a plain, honest sentence.
 *
 * These are the documented codes the player reports through `onError`:
 *  2   invalid / bad video id
 *  5   the HTML5 player itself failed
 *  100 video not found, removed or private
 *  101 / 150 the owner has disabled embedding
 * We treat 101/150 distinctly because "the owner turned embedding off" is a
 * permission fact, not a bug, and the UI should say exactly that.
 */
export function describeEmbedError(code: number | null | undefined): string {
  switch (code) {
    case 2:
      return 'This video id does not look valid, so YouTube refused to play it.'
    case 5:
      return 'YouTube\u2019s player could not play this video in an embed.'
    case 100:
      return 'This video is unavailable — it may have been removed, made private, or set to a region that blocks it.'
    case 101:
    case 150:
      return 'The video\u2019s owner has disabled embedding, so it can only be watched on YouTube directly.'
    default:
      return 'This video could not be played in an embed here.'
  }
}

import type { QueueItem, RotationMode, Singer } from '../types.ts'

/**
 * Singer rotation.
 *
 * Two modes:
 *  - 'queue'    → strict first-come-first-served by song.
 *  - 'rotation' → round-robin by singer, so one person cannot hog the mic even
 *                 if they queue five songs. This is the classic videoke rule.
 *
 * `lastSingerId` (the most recent singer in history) is the cursor: the next
 * singer is the one after them in join order, wrapping around.
 */

export function joinOrder(singers: Singer[]): Singer[] {
  return [...singers].sort((a, b) => a.joinedAt - b.joinedAt)
}

function historyMostRecentSingerId(queue: QueueItem[]): string | null {
  const played = queue
    .filter((item) => item.status !== 'waiting')
    .sort((a, b) => (a.startedAt ?? a.addedAt) - (b.startedAt ?? b.addedAt))
  return played.length ? played[played.length - 1].singerId : null
}

export function pickNextItem(
  queue: QueueItem[],
  singers: Singer[],
  mode: RotationMode,
): QueueItem | null {
  const waiting = queue
    .filter((item) => item.status === 'waiting')
    .sort((a, b) => a.addedAt - b.addedAt)

  if (waiting.length === 0) return null
  if (mode === 'queue') return waiting[0]

  const order = joinOrder(singers)
  if (order.length === 0) return waiting[0]

  const lastSingerId = historyMostRecentSingerId(queue)
  if (!lastSingerId) return waiting[0]

  const startIndex = order.findIndex((singer) => singer.id === lastSingerId)
  if (startIndex === -1) return waiting[0]

  for (let step = 1; step <= order.length; step += 1) {
    const singer = order[(startIndex + step) % order.length]
    const item = waiting.find((candidate) => candidate.singerId === singer.id)
    if (item) return item
  }

  return waiting[0]
}

/**
 * Promote the next waiting song to 'singing' when nobody is on the mic.
 * Returns the same array reference when there is nothing to change, so callers
 * can skip a pointless write.
 */
export function ensureSinging(
  queue: QueueItem[],
  singers: Singer[],
  mode: RotationMode,
): QueueItem[] {
  if (queue.some((item) => item.status === 'singing')) return queue
  const next = pickNextItem(queue, singers, mode)
  if (!next) return queue
  const now = Date.now()
  return queue.map((item) =>
    item.id === next.id ? { ...item, status: 'singing' as const, startedAt: now } : item,
  )
}

/** Who is up after the current song, for the rotation panel preview. */
export function upcomingBySinger(
  queue: QueueItem[],
  singers: Singer[],
  mode: RotationMode,
): string[] {
  const simulated: QueueItem[] = queue.map((item) => ({
    ...item,
    status: item.status === 'singing' ? 'done' : item.status,
  }))
  const order: string[] = []
  let guard = 0
  const working = simulated.filter((item) => item.status === 'waiting')
  let remaining = working
  while (remaining.length > 0 && guard < queue.length + singers.length) {
    const next = pickNextItem(remaining, singers, mode)
    if (!next) break
    order.push(next.singerId)
    remaining = remaining.filter((item) => item.id !== next.id)
    guard += 1
  }
  return order
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { QueueItem, Room, RotationMode, ScoreEntry, Singer } from '../types.ts'
import { createId, createRoomCode, normalizeRoomCode, pickSingerColor } from '../lib/ids.ts'
import { generateFunScore } from '../lib/scoring.ts'
import { ensureSinging } from '../lib/rotation.ts'
import { createRoomAdapter } from '../adapters/index.ts'
import type { RoomSyncAdapter } from '../adapters/index.ts'
import { useAuth } from './useAuth.ts'
import { RoomContext } from './roomContext.ts'
import type { RoomContextValue, RoomStatus } from './roomContext.ts'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong talking to the room.'
}

/** Pick a room code that is not already taken (bounded retries). */
async function reserveRoomCode(adapter: RoomSyncAdapter): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = createRoomCode()
    if (!(await adapter.roomExists(candidate))) return candidate
  }
  return createRoomCode()
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const { profile, setDisplayName } = useAuth()

  const [adapter, setAdapter] = useState<RoomSyncAdapter | null>(null)
  const [adapterLabel, setAdapterLabel] = useState('Starting…')
  const [adapterSharingNote, setAdapterSharingNote] = useState('')
  const [adapterDegraded, setAdapterDegraded] = useState(false)
  const [adapterDegradedReason, setAdapterDegradedReason] = useState<string | undefined>(undefined)

  const [room, setRoom] = useState<Room | null>(null)
  const [status, setStatus] = useState<RoomStatus>('booting')
  const [error, setError] = useState<string | null>(null)

  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    createRoomAdapter()
      .then((selection) => {
        if (cancelled) return
        setAdapter(selection.adapter)
        setAdapterLabel(selection.adapter.label)
        setAdapterSharingNote(selection.adapter.sharingNote)
        setAdapterDegraded(selection.degraded)
        setAdapterDegradedReason(selection.reason)
        setStatus((current) => (current === 'booting' ? 'idle' : current))
      })
      .catch((selectionError) => {
        if (cancelled) return
        setError(errorMessage(selectionError))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const watchRoom = useCallback(
    (rawCode: string) => {
      const code = normalizeRoomCode(rawCode)
      if (!adapter) return () => {}

      let cancelled = false
      unsubscribeRef.current?.()
      setStatus('loading')
      setError(null)

      adapter
        .getRoom(code)
        .then((found) => {
          if (cancelled) return
          setRoom(found)
          setStatus(found ? 'ready' : 'idle')
        })
        .catch((loadError) => {
          if (cancelled) return
          setError(errorMessage(loadError))
          setStatus('error')
        })

      const unsubscribe = adapter.subscribe(code, (updated) => {
        if (cancelled) return
        setRoom(updated)
        setStatus('ready')
      })
      unsubscribeRef.current = unsubscribe

      return () => {
        cancelled = true
        unsubscribe()
        if (unsubscribeRef.current === unsubscribe) unsubscribeRef.current = null
      }
    },
    [adapter],
  )

  const createRoom = useCallback(
    async (roomName: string, displayName: string): Promise<string> => {
      if (!adapter) throw new Error('The room service is still starting. Try again in a moment.')
      const owner = setDisplayName(displayName)
      const code = await reserveRoomCode(adapter)
      const now = Date.now()
      const host: Singer = {
        id: owner.id,
        name: owner.name,
        joinedAt: now,
        color: pickSingerColor(owner.id),
        isHost: true,
      }
      const newRoom: Room = {
        code,
        name: roomName.trim() || 'Videoke Night',
        createdAt: now,
        hostId: owner.id,
        rotationMode: 'rotation',
        singers: [host],
        queue: [],
        scores: [],
        rev: 0,
      }
      await adapter.createRoom(newRoom)
      setRoom(newRoom)
      setStatus('ready')
      return code
    },
    [adapter, setDisplayName],
  )

  const joinRoom = useCallback(
    async (rawCode: string, displayName: string): Promise<boolean> => {
      if (!adapter) {
        setError('The room service is still starting. Try again in a moment.')
        return false
      }
      const code = normalizeRoomCode(rawCode)
      if (code.length < 4) {
        setError('Enter the full room code.')
        return false
      }
      const you = setDisplayName(displayName)

      try {
        const existing = await adapter.getRoom(code)
        if (!existing) {
          setError(`No room found for code ${code}. Check the code and try again.`)
          return false
        }
        if (existing.singers.some((singer) => singer.id === you.id)) {
          setRoom(existing)
          setStatus('ready')
          return true
        }
        const entrant: Singer = {
          id: you.id,
          name: you.name,
          joinedAt: Date.now(),
          color: pickSingerColor(you.id),
          isHost: existing.hostId === you.id,
        }
        const updated = await adapter.update(code, (current) =>
          current.singers.some((singer) => singer.id === you.id)
            ? current
            : { ...current, singers: [...current.singers, entrant] },
        )
        if (!updated) {
          setError(`Room ${code} could not be joined.`)
          return false
        }
        setRoom(updated)
        setStatus('ready')
        return true
      } catch (joinError) {
        setError(errorMessage(joinError))
        return false
      }
    },
    [adapter, setDisplayName],
  )

  const runUpdate = useCallback(
    async (updater: (current: Room) => Room) => {
      if (!adapter || !room) return
      try {
        const next = await adapter.update(room.code, updater)
        if (next) setRoom(next)
      } catch (updateError) {
        setError(errorMessage(updateError))
      }
    },
    [adapter, room],
  )

  const addSong = useCallback(
    async (songId: string) => {
      const singerId = profile?.id
      if (!singerId) {
        setError('Set your name before adding a song.')
        return
      }
      await runUpdate((current) => {
        if (!current.singers.some((singer) => singer.id === singerId)) return current
        const item: QueueItem = {
          id: createId(),
          songId,
          singerId,
          addedAt: Date.now(),
          status: 'waiting',
        }
        const queue = ensureSinging([...current.queue, item], current.singers, current.rotationMode)
        return { ...current, queue }
      })
    },
    [profile, runUpdate],
  )

  const removeWaiting = useCallback(
    async (queueItemId: string) => {
      await runUpdate((current) => ({
        ...current,
        queue: current.queue.filter((item) => item.id !== queueItemId || item.status !== 'waiting'),
      }))
    },
    [runUpdate],
  )

  const startNext = useCallback(async () => {
    await runUpdate((current) => {
      if (current.queue.some((item) => item.status === 'singing')) return current
      const queue = ensureSinging(current.queue, current.singers, current.rotationMode)
      return queue === current.queue ? current : { ...current, queue }
    })
  }, [runUpdate])

  const advance = useCallback(
    async (recordScore: boolean) => {
      await runUpdate((current) => {
        const currentItem = current.queue.find((item) => item.status === 'singing')
        if (!currentItem) return current
        const queue = current.queue.map((item) =>
          item.id === currentItem.id ? { ...item, status: 'done' as const } : item,
        )
        const promoted = ensureSinging(queue, current.singers, current.rotationMode)
        if (!recordScore) return { ...current, queue: promoted }
        const score: ScoreEntry = {
          id: createId(),
          singerId: currentItem.singerId,
          songId: currentItem.songId,
          value: generateFunScore(),
          simulated: true,
          createdAt: Date.now(),
        }
        return { ...current, queue: promoted, scores: [...current.scores, score] }
      })
    },
    [runUpdate],
  )

  const endSong = useCallback(() => advance(true), [advance])
  const skipCurrent = useCallback(() => advance(false), [advance])

  const clearWaiting = useCallback(async () => {
    await runUpdate((current) => ({
      ...current,
      queue: current.queue.filter((item) => item.status !== 'waiting'),
    }))
  }, [runUpdate])

  const setRotationMode = useCallback(
    async (mode: RotationMode) => {
      await runUpdate((current) =>
        current.rotationMode === mode ? current : { ...current, rotationMode: mode },
      )
    },
    [runUpdate],
  )

  const me = useMemo(
    () => room?.singers.find((singer) => singer.id === profile?.id) ?? null,
    [room, profile],
  )

  const value = useMemo<RoomContextValue>(
    () => ({
      transportReady: adapter !== null,
      adapterLabel,
      adapterSharingNote,
      adapterDegraded,
      adapterDegradedReason,
      room,
      me,
      joined: me !== null,
      status,
      error,
      createRoom,
      joinRoom,
      watchRoom,
      clearError,
      addSong,
      removeWaiting,
      startNext,
      endSong,
      skipCurrent,
      clearWaiting,
      setRotationMode,
    }),
    [
      adapter,
      adapterLabel,
      adapterSharingNote,
      adapterDegraded,
      adapterDegradedReason,
      room,
      me,
      status,
      error,
      createRoom,
      joinRoom,
      watchRoom,
      clearError,
      addSong,
      removeWaiting,
      startNext,
      endSong,
      skipCurrent,
      clearWaiting,
      setRotationMode,
    ],
  )

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
}

/**
 * Microphone → pitch → score plumbing.
 *
 * Owns a WebAudio graph (getUserMedia → AnalyserNode) and a requestAnimationFrame
 * loop that turns each windowed sample into a PitchReading via lib/pitch.ts and
 * accumulates it into a fresh ScoreTracker. Scoring only ever evaluates frames
 * that have BOTH a reference note (notes.json) and a playing video — everything
 * else is left untallied, and an empty tally is reported as "no score", not 0.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReferenceNote } from '../types.ts'
import {
  ScoreTracker,
  detectPitch,
  noteInTolerance,
  noteNameFromMidi,
  referenceNoteAt,
} from '../lib/pitch.ts'

export interface KaraokeScoring {
  micActive: boolean
  micError: string | null
  detectedName: string | null
  expectedName: string | null
  last: 'on' | 'off' | 'listening' | null
  live: number | null
  evaluated: number
  hits: number
  enableMic: () => Promise<void>
  disableMic: () => void
  finish: () => { score: number | null; evaluated: number; hits: number }
  reset: () => void
}

interface View {
  detectedName: string | null
  expectedName: string | null
  last: 'on' | 'off' | 'listening' | null
  live: number | null
  evaluated: number
  hits: number
}

const EMPTY_VIEW: View = {
  detectedName: null,
  expectedName: null,
  last: null,
  live: null,
  evaluated: 0,
  hits: 0,
}

export function useKaraokeScoring(
  notes: ReferenceNote[],
  playing: boolean,
  videoTime: number,
): KaraokeScoring {
  const [micActive, setMicActive] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [view, setView] = useState<View>(EMPTY_VIEW)

  const notesRef = useRef<ReferenceNote[]>(notes)
  const playingRef = useRef(playing)
  const timeRef = useRef(videoTime)

  const trackerRef = useRef(new ScoreTracker())
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastEmitRef = useRef(0)

  useEffect(() => {
    notesRef.current = notes
  }, [notes])
  useEffect(() => {
    playingRef.current = playing
  }, [playing])
  useEffect(() => {
    timeRef.current = videoTime
  }, [videoTime])

  const pump = (): void => {
    rafRef.current = requestAnimationFrame(pump)
    const analyser = analyserRef.current
    const data = dataRef.current
    const ctx = audioCtxRef.current
    if (!analyser || !data || !ctx) return
    const now = performance.now()
    if (now - lastEmitRef.current < 90) return
    lastEmitRef.current = now

    analyser.getFloatTimeDomainData(data)
    const reading = detectPitch(data, ctx.sampleRate, data.length)

    const expected =
      playingRef.current && notesRef.current.length > 0
        ? (referenceNoteAt(notesRef.current, timeRef.current)?.note.midi ?? null)
        : null

    trackerRef.current.observe(expected, reading)
    const tally = trackerRef.current.frameView()
    let last: View['last'] = null
    if (expected !== null) {
      last = reading.midi === undefined ? 'listening' : noteInTolerance(expected, reading.midi) ? 'on' : 'off'
    }
    setView({
      detectedName: reading.midi === undefined ? null : noteNameFromMidi(reading.midi),
      expectedName: expected === null ? null : noteNameFromMidi(expected),
      last,
      live: trackerRef.current.score(),
      evaluated: tally.evaluated,
      hits: tally.hits,
    })
  }

  const stopGraph = (): void => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    analyserRef.current = null
    dataRef.current = null
  }

  const enableMic = async (): Promise<void> => {
    if (micActive) return
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser exposes no microphone API.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error('This browser has no WebAudio API for pitch analysis.')
      }
      const ctx = new Ctor()
      await ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)

      streamRef.current = stream
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      dataRef.current = new Float32Array<ArrayBuffer>(analyser.fftSize)
      trackerRef.current.reset()
      lastEmitRef.current = 0
      setMicError(null)
      setMicActive(true)
      rafRef.current = requestAnimationFrame(pump)
    } catch (error) {
      setMicError(error instanceof Error ? error.message : 'Could not reach a microphone.')
      setMicActive(false)
    }
  }

  const disableMic = (): void => {
    stopGraph()
    setMicActive(false)
    setView(EMPTY_VIEW)
  }

  const finish = (): { score: number | null; evaluated: number; hits: number } => {
    const tally = trackerRef.current.frameView()
    return { score: trackerRef.current.score(), evaluated: tally.evaluated, hits: tally.hits }
  }

  const reset = (): void => {
    trackerRef.current.reset()
    setView(EMPTY_VIEW)
  }

  useEffect(() => {
    return stopGraph
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    micActive,
    micError,
    detectedName: view.detectedName,
    expectedName: view.expectedName,
    last: view.last,
    live: view.live,
    evaluated: view.evaluated,
    hits: view.hits,
    enableMic,
    disableMic,
    finish,
    reset,
  }
}
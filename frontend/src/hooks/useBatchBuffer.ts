import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageInput } from '../types'

interface UseBatchBufferOptions {
  /** Window duration in ms — buffer auto-flushes after this. */
  windowMs?: number
  /** Hard cap on frames per batch (drops the oldest if exceeded). */
  maxFrames?: number
  /** Called when the buffer flushes — with all frames captured during the window. */
  onFlush: (frames: ImageInput[]) => void | Promise<void>
  /** When true, the buffer is active and the timer runs. */
  enabled?: boolean
}

/**
 * Accumulates frames over a rolling time window and flushes them as a batch.
 *
 * Designed for the video-capture flow: instead of one model call per frame,
 * frames pile up for `windowMs` and then get sent as a single multi-image call.
 *
 * The window resets after each flush. If `flushNow()` is called manually, the
 * timer also resets.
 */
export function useBatchBuffer({
  windowMs = 10_000,
  maxFrames = 30,
  onFlush,
  enabled = true,
}: UseBatchBufferOptions) {
  const bufferRef = useRef<ImageInput[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onFlushRef = useRef(onFlush)
  onFlushRef.current = onFlush

  const [pendingCount, setPendingCount] = useState(0)
  const [windowStartedAt, setWindowStartedAt] = useState<number | null>(null)

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    if (!enabled) return
    flushTimerRef.current = setTimeout(() => {
      const frames = bufferRef.current
      bufferRef.current = []
      setPendingCount(0)
      setWindowStartedAt(null)
      if (frames.length > 0) {
        Promise.resolve(onFlushRef.current(frames)).catch((err) =>
          console.error('Batch flush failed:', err)
        )
      }
    }, windowMs)
  }, [windowMs, enabled])

  const push = useCallback((frame: ImageInput) => {
    if (!enabled) return
    const next = [...bufferRef.current, frame]
    if (next.length > maxFrames) next.splice(0, next.length - maxFrames)
    bufferRef.current = next
    setPendingCount(next.length)
    if (windowStartedAt === null) {
      setWindowStartedAt(Date.now())
      scheduleFlush()
    }
  }, [enabled, maxFrames, scheduleFlush, windowStartedAt])

  const flushNow = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    const frames = bufferRef.current
    bufferRef.current = []
    setPendingCount(0)
    setWindowStartedAt(null)
    if (frames.length > 0) {
      Promise.resolve(onFlushRef.current(frames)).catch((err) =>
        console.error('Manual flush failed:', err)
      )
    }
  }, [])

  const clear = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    bufferRef.current = []
    setPendingCount(0)
    setWindowStartedAt(null)
  }, [])

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
  }, [])

  return { push, flushNow, clear, pendingCount, windowStartedAt, windowMs }
}

import { useCallback, useRef, useState } from 'react'
import type { ImageInput } from '../types'

export type CaptureSource = 'webcam' | 'screen'

interface UseVideoCaptureOptions {
  fps?: number
  onFrame?: (frame: ImageInput) => void
}

/**
 * Captures frames at a configurable FPS and emits them via `onFrame`.
 * Does NOT send to the model — that is the consumer's responsibility
 * (typically buffering until a batch boundary).
 */
export function useVideoCapture({ fps = 1, onFrame }: UseVideoCaptureOptions = {}) {
  const [active, setActive] = useState(false)
  const [source, setSource] = useState<CaptureSource | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const frameCountRef = useRef(0)
  const sessionIdRef = useRef('')

  const captureFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0)
    const data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
    frameCountRef.current += 1
    const session = sessionIdRef.current
    const name = `${session}_${String(frameCountRef.current).padStart(4, '0')}.jpg`
    onFrame?.({
      data,
      rawData: data,
      name,
      preview: `data:image/jpeg;base64,${data}`,
      source: 'webcam',
      capturedAt: Date.now(),
    })
  }, [onFrame])

  const start = useCallback(async (src: CaptureSource) => {
    try {
      const mediaStream =
        src === 'webcam'
          ? await navigator.mediaDevices.getUserMedia({ video: true })
          : await navigator.mediaDevices.getDisplayMedia({ video: true })

      streamRef.current = mediaStream

      if (!videoRef.current) {
        videoRef.current = document.createElement('video')
        videoRef.current.muted = true
        videoRef.current.playsInline = true
      }
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas')
      }

      videoRef.current.srcObject = mediaStream
      await videoRef.current.play()

      mediaStream.getTracks()[0].addEventListener('ended', () => stop())

      setSource(src)
      setActive(true)
      frameCountRef.current = 0
      sessionIdRef.current = `${src}-${Math.random().toString(36).slice(2, 6)}`
      intervalRef.current = setInterval(captureFrame, 1000 / fps)
    } catch (err) {
      console.error('Video capture failed:', err)
    }
  }, [fps, captureFrame])

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setActive(false)
    setSource(null)
  }, [])

  return { active, source, start, stop, captureFrame }
}

import { useCallback, useEffect, useState } from 'react'
import { Camera, Monitor, Square, Settings2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useVideoCapture } from '../../hooks/useVideoCapture'
import { useImagePanelStore } from '../../stores/imagePanelStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { useChatStore } from '../../stores/chatStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { api } from '../../api/client'
import type { ImageInput } from '../../types'

interface Props {
  compact?: boolean
}

/**
 * Webcam + screen capture trigger that pushes frames into:
 *   1. ImagePanel store (so the latest frame becomes the active canvas)
 *   2. Chat batch buffer (so frames are sent to the model in a single call per window)
 *
 * The chat layer owns the actual flush. This component just provides UI for
 * starting/stopping capture and tuning the window/FPS.
 */
export function VideoCaptureControls({ compact = false }: Props) {
  const [fps, setFps] = useState(1)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const appendImage = useImagePanelStore((s) => s.appendImage)
  const pushFrameToBatch = useChatStore((s) => s.pushFrameToBatch)
  const batchWindowMs = useChatStore((s) => s.batchWindowMs)
  const setBatchWindowMs = useChatStore((s) => s.setBatchWindowMs)

  const workspaceId = useWorkspaceStore((s) => s.currentId)

  const handleFrame = useCallback(
    (frame: ImageInput) => {
      // Show the frame in the panel immediately for live preview.
      appendImage(frame)
      pushFrameToBatch(frame)

      // Upload in the background so the server has a content-addressed image.
      // Frames captured at e.g. 1fps tend to be near-identical, so dedupe
      // catches the common case for free.
      if (workspaceId && frame.rawData) {
        ;(async () => {
          try {
            const blob = base64ToBlob(frame.rawData!, 'image/jpeg')
            const uploaded = await api.images.upload(workspaceId, blob, {
              name: frame.name,
              source: (frame.source === 'webcam' || frame.source === 'screen')
                ? frame.source : 'webcam',
            })
            // Patch the ImageInput with the server id + presigned URL so
            // downstream send doesn't re-upload.
            useImagePanelStore.getState().patchImage(frame.name, {
              id: uploaded.id,
              sha256: uploaded.sha256,
              preview: uploaded.presigned_url,
            })
            // Reflect the new (non-deduped) workspace image in the Files section.
            if (!uploaded.deduped) useLibraryStore.getState().bump()
          } catch (err) {
            console.warn('Frame upload failed:', err)
          }
        })()
      }
    },
    [appendImage, pushFrameToBatch, workspaceId]
  )

  const { active, source, start, stop } = useVideoCapture({ fps, onFrame: handleFrame })

  // (helper inlined below to keep this component self-contained)

  // Auto-stop the panel from filling up if the user forgot to stop
  useEffect(() => () => { if (active) stop() }, [])

  if (active) {
    return (
      <button
        onClick={stop}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-soft bg-danger text-white text-xs font-medium"
      >
        <Square size={11} />
        Stop {source}
        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
      </button>
    )
  }

  return (
    <div className="relative inline-flex items-center gap-1">
      <button
        onClick={() => start('webcam')}
        className="btn-ghost inline-flex items-center gap-1"
        title="Start webcam capture"
      >
        <Camera size={12} /> {!compact && 'Webcam'}
      </button>
      <button
        onClick={() => start('screen')}
        className="btn-ghost inline-flex items-center gap-1"
        title="Start screen share capture"
      >
        <Monitor size={12} /> {!compact && 'Screen'}
      </button>
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className={clsx(
          'btn-ghost inline-flex items-center',
          showAdvanced && 'text-primary'
        )}
        title="Capture settings"
      >
        <Settings2 size={12} />
      </button>

      {showAdvanced && (
        <div className="absolute top-full right-0 mt-1 z-40 bg-surface-raised border border-border rounded-cushion shadow-raised p-3 w-56 space-y-3">
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Capture FPS
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.2}
                max={5}
                step={0.1}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="flex-1 h-1 accent-primary"
              />
              <span className="text-xs font-mono tabular-nums w-8 text-right">{fps.toFixed(1)}</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Batch window
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={2}
                max={30}
                step={1}
                value={batchWindowMs / 1000}
                onChange={(e) => setBatchWindowMs(Number(e.target.value) * 1000)}
                className="flex-1 h-1 accent-primary"
              />
              <span className="text-xs font-mono tabular-nums w-8 text-right">
                {(batchWindowMs / 1000).toFixed(0)}s
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
              Frames are buffered, then sent in one model call per window.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}


function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

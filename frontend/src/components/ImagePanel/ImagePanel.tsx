import { useCallback, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { ImagePlus, Camera, Monitor, Loader2 } from 'lucide-react'
import { AnnotationCanvas, type AnnotationCanvasHandle } from './AnnotationCanvas'
import { AnnotationToolbar } from './AnnotationToolbar'
import { ImageThumbnailStrip } from './ImageThumbnailStrip'
import { WorkspaceFilesSection } from './WorkspaceFilesSection'
import { useImagePanelStore } from '../../stores/imagePanelStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { VideoCaptureControls } from '../VideoCapture/VideoCaptureControls'
import { api, ApiError } from '../../api/client'
import type { ImageInput, WorkspaceImage } from '../../types'

type SaveState = 'idle' | 'saving' | 'saved'

export function ImagePanel() {
  const {
    images, activeIndex, annotations, tool, color, strokeWidth,
    appendImage, appendImages, removeImage, setActiveIndex,
    setAnnotations, setCanvasDims, clearAnnotations,
    setTool, setColor, setStrokeWidth,
  } = useImagePanelStore()

  const active = images[activeIndex]
  const activeAnnotations = useMemo(
    () => (active ? annotations[active.name] ?? [] : []),
    [active, annotations]
  )

  const currentWorkspaceId = useWorkspaceStore((s) => s.currentId)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const canvasRef = useRef<AnnotationCanvasHandle>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  // Reset save state whenever annotations change (user drew something new).
  // We use useMemo above to compute activeAnnotations; the "unsaved" condition
  // is simply: there are annotations AND we're not in the 'saved' steady state.
  const unsavedAnnotations = activeAnnotations.length > 0 && saveState !== 'saved'

  // Drag-drop / picker → upload each file to the workspace, then drop
  // a fully-hydrated ImageInput (with server id + presigned preview URL)
  // into the panel.
  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (!currentWorkspaceId) {
        setUploadError('No workspace selected — refresh and try again.')
        return
      }
      setUploadError(null)
      setUploading((n) => n + accepted.length)
      const uploaded: ImageInput[] = []
      for (const file of accepted) {
        try {
          const dataUrl = await fileToDataUrl(file)
          const base64 = dataUrl.split(',')[1] ?? ''
          const img = await api.images.upload(currentWorkspaceId, file, {
            name: file.name,
            source: 'upload',
          })
          uploaded.push({
            id: img.id,
            data: base64,
            rawData: base64,
            name: img.original_name || file.name,
            preview: img.presigned_url,
            source: 'upload',
            sha256: img.sha256,
            capturedAt: Date.now(),
          })
        } catch (err) {
          const msg = err instanceof ApiError ? err.body || err.message : String(err)
          setUploadError(`Upload failed: ${msg}`)
        } finally {
          setUploading((n) => Math.max(0, n - 1))
        }
      }
      if (uploaded.length) {
        appendImages(uploaded)
        // Newly-uploaded images are now workspace files — refresh the Files section.
        useLibraryStore.getState().bump()
      }
    },
    [appendImages, currentWorkspaceId]
  )

  // Add an existing workspace image (from the Files dropdown) onto the canvas.
  // appendImage dedupes by id, so re-adding one already present just focuses it.
  const handleAddFromWorkspace = useCallback((img: WorkspaceImage) => {
    appendImage({
      id: img.id,
      data: '',
      rawData: '',
      name: img.original_name || img.id.slice(0, 8),
      preview: img.presigned_url,
      sha256: img.sha256,
      source: (img.source === 'webcam' || img.source === 'screen') ? img.source : 'upload',
      capturedAt: Date.now(),
    })
  }, [appendImage])

  // A workspace image was permanently deleted — drop it from the canvas too.
  const handleWorkspaceDeleted = useCallback((imageId: string) => {
    const onCanvas = useImagePanelStore.getState().images.find((i) => i.id === imageId)
    if (onCanvas) removeImage(onCanvas.name)
  }, [removeImage])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
    noClick: images.length > 0,  // only fullscreen-clickable when empty
    noKeyboard: true,
  })

  const handleUndo = () => {
    if (!active) return
    setAnnotations(active.name, activeAnnotations.slice(0, -1))
  }

  const handleClear = () => {
    if (!active) return
    clearAnnotations(active.name)
    setSaveState('idle')
  }

  // Bake annotations into a new image, upload to workspace, replace active.
  const handleSave = useCallback(async () => {
    if (!active || !currentWorkspaceId || !canvasRef.current) return
    if (activeAnnotations.length === 0) return

    setSaveState('saving')
    setUploadError(null)
    try {
      const blob = await canvasRef.current.exportAsBlob({ mime: 'image/jpeg', quality: 0.92 })
      if (!blob) throw new Error('canvas not ready')

      // Build a sensible filename: strip extension, suffix _annotated_<ts>.
      const stem = active.name.replace(/\.[^/.]+$/, '')
      const filename = `${stem}_annotated_${Date.now()}.jpg`

      const uploaded = await api.images.upload(currentWorkspaceId, blob, {
        name: filename,
        source: active.source === 'webcam' || active.source === 'screen'
          ? active.source : 'upload',
      })

      // Read the blob back to base64 so the new ImageInput has rawData
      // ready (rendering optimization — saves a fetch on next preview).
      const dataUrl = await blobToDataUrl(blob)
      const base64 = dataUrl.split(',')[1] ?? ''

      const newImage: ImageInput = {
        id: uploaded.id,
        data: base64,
        rawData: base64,
        name: uploaded.original_name || filename,
        preview: uploaded.presigned_url,
        source: active.source,
        sha256: uploaded.sha256,
        capturedAt: Date.now(),
      }

      // Append, switch to it, clear the annotation overlay on the source
      // image so the user doesn't double-annotate accidentally.
      appendImages([newImage])
      useLibraryStore.getState().bump()   // new workspace image → refresh Files section
      setActiveIndex(images.length)
      clearAnnotations(active.name)
      setSaveState('saved')
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1800)
    } catch (err) {
      const msg = err instanceof ApiError ? err.body || err.message : String(err)
      setUploadError(`Save failed: ${msg}`)
      setSaveState('idle')
    }
  }, [active, activeAnnotations.length, currentWorkspaceId, appendImages,
      setActiveIndex, images.length, clearAnnotations])

  const imageUrl = active
    ? active.preview ?? `data:image/jpeg;base64,${active.rawData ?? active.data}`
    : ''

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Workspace library — rendered OUTSIDE the dropzone root so its buttons
          (delete/download/add) never bubble a click into the upload dialog. */}
      <WorkspaceFilesSection
        onAddImage={handleAddFromWorkspace}
        onImageDeleted={handleWorkspaceDeleted}
      />

      {/* Canvas area — this is the dropzone. */}
      <div {...getRootProps()} className="flex flex-col flex-1 min-h-0 relative">
        <input {...getInputProps()} />

        {/* Header bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Canvas
          </h2>
          {active && (
            <span className="chip" title={active.sha256 ? `sha256: ${active.sha256.slice(0, 16)}…` : undefined}>
              {active.name}
            </span>
          )}
          {uploading > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 size={10} className="animate-spin" />
              uploading {uploading}…
            </span>
          )}
          {uploadError && (
            <span className="text-[10px] text-danger truncate max-w-[280px]" title={uploadError}>
              {uploadError}
            </span>
          )}
          <div className="flex-1" />
          <VideoCaptureControls compact />
          {/* stopPropagation: when the canvas is empty the dropzone root is
              click-enabled (noClick=false), so without this the click also
              bubbles to the root and fires open() twice — which dropped the
              first file selection. */}
          <button
            onClick={(e) => { e.stopPropagation(); open() }}
            className="btn-ghost inline-flex items-center gap-1"
            title="Add image"
          >
            <ImagePlus size={12} /> Upload
          </button>
        </div>

        {/* Toolbar */}
        {active && (
          <AnnotationToolbar
            tool={tool}
            onToolChange={setTool}
            color={color}
            onColorChange={setColor}
            strokeWidth={strokeWidth}
            onStrokeWidthChange={setStrokeWidth}
            onUndo={handleUndo}
            onClear={handleClear}
            canUndo={activeAnnotations.length > 0}
            onSave={handleSave}
            saveState={saveState}
            unsaved={unsavedAnnotations}
          />
        )}

        {/* Drop overlay */}
        {isDragActive && (
          <div className="absolute inset-0 z-20 bg-primary/10 border-4 border-dashed border-primary flex items-center justify-center pointer-events-none">
            <p className="text-sm font-medium text-primary">Drop images to add</p>
          </div>
        )}

        {/* Main area */}
        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6">
          {active ? (
            <AnnotationCanvas
              ref={canvasRef}
              imageUrl={imageUrl}
              annotations={activeAnnotations}
              tool={tool}
              color={color}
              strokeWidth={strokeWidth}
              onChange={(anns) => {
                setAnnotations(active.name, anns)
                setSaveState('idle')   // any edit invalidates the "saved" indicator
              }}
              onSizeChange={(dims) => setCanvasDims(active.name, dims)}
            />
          ) : (
            <EmptyState onUploadClick={open} />
          )}
        </div>

        {/* Thumbnail strip */}
        <ImageThumbnailStrip
          images={images}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
          onRemove={removeImage}
        />
      </div>
    </div>
  )
}

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

const blobToDataUrl = fileToDataUrl

function EmptyState({ onUploadClick }: { onUploadClick: () => void }) {
  return (
    <div className="text-center space-y-4 max-w-md">
      <div className="flex items-center justify-center gap-3 text-muted-foreground/40">
        <Camera size={36} strokeWidth={1.2} />
        <ImagePlus size={48} strokeWidth={1.2} />
        <Monitor size={36} strokeWidth={1.2} />
      </div>
      <div>
        <p className="font-serif text-2xl text-foreground italic">
          Drop a frame, take a glance.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Drag images here, upload from disk, or capture a webcam / screen.
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onUploadClick() }}
        className="btn-primary inline-flex items-center gap-1.5"
      >
        <ImagePlus size={13} /> Choose images
      </button>
    </div>
  )
}

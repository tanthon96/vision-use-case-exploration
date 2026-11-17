import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react'
import type { Annotation, ToolKind } from '../../types'

interface Props {
  imageUrl: string
  annotations: Annotation[]
  tool: ToolKind
  color: string
  strokeWidth: number
  onChange: (annotations: Annotation[]) => void
  /**
   * Called whenever the displayed canvas size changes. Used by the panel
   * store so we can bake annotations from outside the live canvas (see
   * bakeImageWithAnnotations in the chat send path).
   */
  onSizeChange?: (size: { w: number; h: number }) => void
}

interface ImageSize {
  natural: { w: number; h: number }
  displayed: { w: number; h: number }
}

export interface AnnotationCanvasHandle {
  /**
   * Bake the current image + annotations into a Blob at the source image's
   * natural resolution. Uses the live displayed dimensions to scale the
   * annotation coordinates correctly (this is the fix for the earlier bug
   * where annotations were drawn at screen-pixel coords on a full-res canvas).
   *
   * Returns null if the canvas isn't ready (no image loaded yet).
   */
  exportAsBlob: (opts?: {
    mime?: 'image/jpeg' | 'image/png'
    quality?: number
  }) => Promise<Blob | null>
  hasAnnotations: () => boolean
}

function uid() {
  return Math.random().toString(36).slice(2, 11)
}

export const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(function AnnotationCanvas(
  { imageUrl, annotations, tool, color, strokeWidth, onChange, onSizeChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<ImageSize | null>(null)
  const [draft, setDraft] = useState<Annotation | null>(null)
  const drawingRef = useRef(false)
  const startPtRef = useRef<{ x: number; y: number } | null>(null)

  // Live refs so the imperative handle always reads the latest values
  const annotationsRef = useRef(annotations)
  const sizeRef = useRef<ImageSize | null>(null)
  annotationsRef.current = annotations
  sizeRef.current = size

  // Stash onSizeChange in a ref so the effect below doesn't depend on its
  // identity. Parents typically pass an inline arrow that's recreated every
  // render; without this we'd tear down and re-install the ResizeObserver
  // on every render, and calling onSizeChange inside update() would feed
  // straight back into a render loop → "Too many re-renders" → blank page.
  const onSizeChangeRef = useRef(onSizeChange)
  onSizeChangeRef.current = onSizeChange

  // Resize observer to keep canvas matching displayed image
  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const update = () => {
      if (!img.complete) return
      const nW = img.naturalWidth
      const nH = img.naturalHeight
      const dW = img.clientWidth
      const dH = img.clientHeight
      // De-dup: identical dimensions are a no-op. Belt and braces against
      // any caller that ignores referential equality (Zustand, parents that
      // recreate objects, etc.).
      const prev = sizeRef.current
      if (prev
        && prev.natural.w === nW && prev.natural.h === nH
        && prev.displayed.w === dW && prev.displayed.h === dH
      ) return
      const next: ImageSize = {
        natural: { w: nW, h: nH },
        displayed: { w: dW, h: dH },
      }
      setSize(next)
      onSizeChangeRef.current?.(next.displayed)
    }
    img.addEventListener('load', update)
    const ro = new ResizeObserver(update)
    ro.observe(img)
    update()
    return () => { img.removeEventListener('load', update); ro.disconnect() }
  }, [imageUrl])

  // Redraw whenever annotations / draft / size change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size) return
    canvas.width = size.displayed.w
    canvas.height = size.displayed.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const all = draft ? [...annotations, draft] : annotations
    for (const ann of all) drawAnnotation(ctx, ann)
  }, [annotations, draft, size])

  // Imperative API for the parent (Save button + auto-bake on send)
  useImperativeHandle(ref, () => ({
    async exportAsBlob({ mime = 'image/jpeg', quality = 0.92 } = {}) {
      const dispSize = sizeRef.current
      if (!dispSize) return null
      return bakeAndExport(
        imageUrl,
        annotationsRef.current,
        dispSize.displayed.w,
        dispSize.displayed.h,
        mime,
        quality,
      )
    },
    hasAnnotations() {
      return annotationsRef.current.length > 0
    },
  }), [imageUrl])

  function eventToPoint(e: React.PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (tool === 'select') return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const p = eventToPoint(e)
    startPtRef.current = p

    let newDraft: Annotation
    const id = uid()
    switch (tool) {
      case 'rectangle':
        newDraft = { id, kind: 'rectangle', x: p.x, y: p.y, w: 0, h: 0, color, strokeWidth }
        break
      case 'ellipse':
        newDraft = { id, kind: 'ellipse', cx: p.x, cy: p.y, rx: 0, ry: 0, color, strokeWidth }
        break
      case 'freehand':
        newDraft = { id, kind: 'freehand', points: [p], color, strokeWidth }
        break
      case 'arrow':
        newDraft = { id, kind: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, strokeWidth }
        break
      default:
        return
    }
    setDraft(newDraft)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawingRef.current || !draft || !startPtRef.current) return
    const p = eventToPoint(e)
    const start = startPtRef.current

    switch (draft.kind) {
      case 'rectangle':
        setDraft({
          ...draft,
          x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
          w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y),
        })
        break
      case 'ellipse':
        setDraft({
          ...draft,
          cx: (start.x + p.x) / 2, cy: (start.y + p.y) / 2,
          rx: Math.abs(p.x - start.x) / 2, ry: Math.abs(p.y - start.y) / 2,
        })
        break
      case 'freehand':
        setDraft({ ...draft, points: [...draft.points, p] })
        break
      case 'arrow':
        setDraft({ ...draft, x2: p.x, y2: p.y })
        break
    }
  }

  function onPointerUp() {
    if (!drawingRef.current || !draft) return
    drawingRef.current = false
    const isTrivial =
      (draft.kind === 'rectangle' && (draft.w < 2 || draft.h < 2)) ||
      (draft.kind === 'ellipse' && (draft.rx < 2 || draft.ry < 2)) ||
      (draft.kind === 'arrow' && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 4) ||
      (draft.kind === 'freehand' && draft.points.length < 2)
    if (!isTrivial) onChange([...annotations, draft])
    setDraft(null)
    startPtRef.current = null
  }

  const cursorClass = tool === 'select' ? 'cursor-default' : 'cursor-crosshair'

  return (
    <div ref={containerRef} className="relative inline-block max-w-full">
      <img
        ref={imgRef}
        src={imageUrl}
        alt="annotation target"
        crossOrigin="anonymous"
        className="max-w-full max-h-[60vh] block rounded-soft select-none"
        draggable={false}
      />
      {size && (
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className={`absolute inset-0 touch-none ${cursorClass}`}
          style={{ width: size.displayed.w, height: size.displayed.h }}
        />
      )}
    </div>
  )
})


// ── Bake helpers ─────────────────────────────────────────────────────────────

function drawAnnotation(ctx: CanvasRenderingContext2D, ann: Annotation) {
  ctx.strokeStyle = ann.color
  ctx.lineWidth = ann.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = ann.color + '22'   // 13% alpha fill

  switch (ann.kind) {
    case 'rectangle':
      ctx.beginPath()
      ctx.rect(ann.x, ann.y, ann.w, ann.h)
      ctx.fill()
      ctx.stroke()
      break
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(ann.cx, ann.cy, ann.rx, ann.ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      break
    case 'freehand': {
      const pts = ann.points
      if (pts.length === 0) break
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
      break
    }
    case 'arrow': {
      const { x1, y1, x2, y2 } = ann
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const head = Math.max(8, ann.strokeWidth * 3)
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fillStyle = ann.color
      ctx.fill()
      break
    }
  }
}

function scaleAnnotation(ann: Annotation, sx: number, sy: number): Annotation {
  // Use the larger dimension for stroke scaling so lines stay visually similar
  const sStroke = Math.max(sx, sy)
  switch (ann.kind) {
    case 'rectangle':
      return {
        ...ann,
        x: ann.x * sx, y: ann.y * sy,
        w: ann.w * sx, h: ann.h * sy,
        strokeWidth: ann.strokeWidth * sStroke,
      }
    case 'ellipse':
      return {
        ...ann,
        cx: ann.cx * sx, cy: ann.cy * sy,
        rx: ann.rx * sx, ry: ann.ry * sy,
        strokeWidth: ann.strokeWidth * sStroke,
      }
    case 'freehand':
      return {
        ...ann,
        points: ann.points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
        strokeWidth: ann.strokeWidth * sStroke,
      }
    case 'arrow':
      return {
        ...ann,
        x1: ann.x1 * sx, y1: ann.y1 * sy,
        x2: ann.x2 * sx, y2: ann.y2 * sy,
        strokeWidth: ann.strokeWidth * sStroke,
      }
  }
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  // Required so toBlob doesn't throw a "tainted canvas" SecurityError when
  // the source comes from a presigned URL on a different origin.
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`failed to load image: ${url}`))
    img.src = url
  })
  return img
}

/**
 * Render image + annotations at NATURAL image dimensions and return a Blob.
 *
 * `displayedW/H` is the size of the source canvas where the user drew. The
 * annotations are stored in those coords, so we scale them up to the natural
 * resolution before drawing.
 */
async function bakeAndExport(
  imageUrl: string,
  annotations: Annotation[],
  displayedW: number,
  displayedH: number,
  mime: 'image/jpeg' | 'image/png',
  quality: number,
): Promise<Blob | null> {
  return bakeImageWithAnnotations(imageUrl, annotations, displayedW, displayedH, mime, quality)
}

/**
 * Public bake helper. Used by Save (via the canvas ref) AND by the chat
 * "auto-bake on send" path (which has no live canvas and looks up the
 * recorded canvas size from imagePanelStore.canvasDims).
 *
 * Rendering at natural resolution gives the model the highest-fidelity view
 * of both the original pixels and the highlights the user drew.
 */
export async function bakeImageWithAnnotations(
  imageUrl: string,
  annotations: Annotation[],
  displayedW: number,
  displayedH: number,
  mime: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality: number = 0.92,
): Promise<Blob | null> {
  const img = await loadImageElement(imageUrl)

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)

  // If the caller doesn't know the displayed dimensions, fall back to natural
  // (scale factor of 1). That's the case when annotations were authored at
  // 1:1 — rare for the panel which max-h-caps at 60vh, but safe.
  const w = displayedW > 0 ? displayedW : img.naturalWidth
  const h = displayedH > 0 ? displayedH : img.naturalHeight
  const sx = img.naturalWidth / w
  const sy = img.naturalHeight / h
  for (const ann of annotations) drawAnnotation(ctx, scaleAnnotation(ann, sx, sy))

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mime, quality)
  })
}

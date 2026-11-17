import { create } from 'zustand'
import type { ImageInput, Annotation, ToolKind } from '../types'

interface ImagePanelStore {
  images: ImageInput[]
  activeIndex: number
  annotations: Record<string, Annotation[]>  // keyed by image name
  /**
   * Displayed (CSS-pixel) canvas dimensions for each annotated image at the
   * moment the user drew on it. Used when baking annotations from outside
   * the live canvas (e.g. the auto-bake-on-send path). Without this we can't
   * scale stored annotations back to the source image's natural resolution.
   */
  canvasDims: Record<string, { w: number; h: number }>
  tool: ToolKind
  color: string
  strokeWidth: number

  setImages: (images: ImageInput[]) => void
  appendImage: (image: ImageInput) => void
  appendImages: (images: ImageInput[]) => void
  /** Merge fields into the image with this name (used to attach upload result). */
  patchImage: (name: string, patch: Partial<ImageInput>) => void
  removeImage: (name: string) => void
  setActiveIndex: (i: number) => void
  clearImages: () => void

  setAnnotations: (imageName: string, annotations: Annotation[]) => void
  setCanvasDims: (imageName: string, dims: { w: number; h: number }) => void
  clearAnnotations: (imageName: string) => void
  clearAllAnnotations: () => void

  setTool: (tool: ToolKind) => void
  setColor: (color: string) => void
  setStrokeWidth: (w: number) => void
}

export const useImagePanelStore = create<ImagePanelStore>((set) => ({
  images: [],
  activeIndex: 0,
  annotations: {},
  canvasDims: {},
  tool: 'select',
  color: '#f97316',  // primary amber
  strokeWidth: 3,

  setImages: (images) =>
    set({ images, activeIndex: 0 }),

  appendImage: (image) =>
    set((s) => {
      // Dedupe by workspace image id: re-adding one already on the canvas (e.g.
      // via the @ picker or Files dropdown) just focuses it, so the send never
      // ships a duplicate image_id (which the backend would reject).
      if (image.id) {
        const existing = s.images.findIndex((i) => i.id === image.id)
        if (existing !== -1) return { activeIndex: existing }
      }
      return { images: [...s.images, image], activeIndex: s.images.length }
    }),

  appendImages: (images) =>
    set((s) => {
      const existingIds = new Set(s.images.map((i) => i.id).filter(Boolean))
      const fresh = images.filter((i) => !i.id || !existingIds.has(i.id))
      if (fresh.length === 0) return s
      return {
        images: [...s.images, ...fresh],
        activeIndex: s.images.length === 0 ? 0 : s.activeIndex,
      }
    }),

  patchImage: (name, patch) =>
    set((s) => ({
      images: s.images.map((i) => (i.name === name ? { ...i, ...patch } : i)),
    })),

  removeImage: (name) =>
    set((s) => {
      const filtered = s.images.filter((i) => i.name !== name)
      const next = { ...s.annotations }; delete next[name]
      const dims = { ...s.canvasDims };   delete dims[name]
      return {
        images: filtered,
        annotations: next,
        canvasDims: dims,
        activeIndex: Math.min(s.activeIndex, Math.max(0, filtered.length - 1)),
      }
    }),

  setActiveIndex: (i) => set({ activeIndex: i }),

  clearImages: () => set({ images: [], annotations: {}, activeIndex: 0 }),

  setAnnotations: (imageName, annotations) =>
    set((s) => ({ annotations: { ...s.annotations, [imageName]: annotations } })),

  setCanvasDims: (imageName, dims) =>
    set((s) => {
      // No-op when unchanged — prevents fan-out re-renders from a recurring
      // ResizeObserver callback that's reporting the same size repeatedly.
      const prev = s.canvasDims[imageName]
      if (prev && prev.w === dims.w && prev.h === dims.h) return s
      return { canvasDims: { ...s.canvasDims, [imageName]: dims } }
    }),

  clearAnnotations: (imageName) =>
    set((s) => {
      const next = { ...s.annotations }
      delete next[imageName]
      const dims = { ...s.canvasDims }
      delete dims[imageName]
      return { annotations: next, canvasDims: dims }
    }),

  clearAllAnnotations: () => set({ annotations: {}, canvasDims: {} }),

  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
}))

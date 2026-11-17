import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search, AlertCircle, ImageOff } from 'lucide-react'
import { clsx } from 'clsx'
import { useWorkspaceImages } from '../../hooks/useWorkspaceImages'
import type { WorkspaceImage } from '../../types'

interface Props {
  /** Filter typed AFTER the '@' character (excluding the '@' itself). */
  query: string
  /** Picker is anchored to the parent input; we position above. */
  onSelect: (image: WorkspaceImage) => void
  onClose: () => void
}

/**
 * Floating popover anchored above the message input. Shows recently uploaded
 * workspace images filtered by `query`. Keyboard:
 *   ↑ / ↓ — move highlight
 *   ⏎      — pick highlight
 *   esc    — close
 */
export function WorkspaceImagePicker({ query, onSelect, onClose }: Props) {
  const { images, loading, error } = useWorkspaceImages(true)
  const [highlight, setHighlight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return images.slice(0, 24)
    return images.filter((i) => i.original_name.toLowerCase().includes(q)).slice(0, 24)
  }, [images, query])

  // Reset highlight when the filter changes
  useEffect(() => { setHighlight(0) }, [query, filtered.length])

  // Global keyboard handler — installed at the window so it works regardless
  // of whether the textarea or the popover has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the picker is open it fully owns these keys. stopPropagation is
      // essential: without it the event still bubbles to the textarea's
      // keydown, and because selecting closes the picker (a synchronous React
      // 18 state flush), that handler would see pickerOpen=false and SEND the
      // chat on Enter instead of just picking the image.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation()
        if (filtered.length) setHighlight((i) => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        if (filtered.length) setHighlight((i) => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation()
        if (filtered.length) onSelect(filtered[highlight])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [filtered, highlight, onSelect, onClose])

  // Scroll highlight into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  return (
    <div
      className="absolute bottom-full left-2 right-2 mb-1 z-30 bg-surface-raised border border-border rounded-cushion shadow-raised overflow-hidden"
      onMouseDown={(e) => e.preventDefault()}  // keep focus on the textarea
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border text-[10px] text-muted-foreground">
        <Search size={10} />
        <span className="font-medium uppercase tracking-wider">Workspace images</span>
        {query && <span className="font-mono normal-case truncate">@{query}</span>}
        <div className="flex-1" />
        {loading && <Loader2 size={10} className="animate-spin" />}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-danger">
          <AlertCircle size={11} /> {error}
        </div>
      )}

      <div ref={listRef} className="max-h-64 overflow-y-auto">
        {!loading && filtered.length === 0 ? (
          <div className="flex items-center gap-1.5 px-2 py-3 text-xs text-muted-foreground italic">
            <ImageOff size={12} />
            {query ? `No images matching "${query}"` : 'No images in this workspace yet'}
          </div>
        ) : (
          filtered.map((img, i) => (
            <button
              key={img.id}
              type="button"
              data-idx={i}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => onSelect(img)}
              className={clsx(
                'w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors',
                i === highlight ? 'bg-primary/15' : 'hover:bg-muted'
              )}
            >
              <img
                src={img.presigned_url}
                alt=""
                className="h-8 w-8 object-cover rounded-soft border border-border shrink-0"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-foreground truncate" title={img.original_name}>
                  {img.original_name || img.id.slice(0, 8)}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                  {img.width && img.height && (
                    <span>{img.width}×{img.height}</span>
                  )}
                  <span className="opacity-70">{(img.size_bytes / 1024).toFixed(0)} KB</span>
                  {img.source && img.source !== 'upload' && (
                    <span className="text-accent">{img.source}</span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground/70 font-mono">
        ↑↓ navigate · ⏎ select · esc close
      </div>
    </div>
  )
}

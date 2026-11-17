import { X } from 'lucide-react'
import { clsx } from 'clsx'
import type { ImageInput } from '../../types'

interface Props {
  images: ImageInput[]
  activeIndex: number
  onSelect: (i: number) => void
  onRemove: (name: string) => void
}

export function ImageThumbnailStrip({ images, activeIndex, onSelect, onRemove }: Props) {
  if (images.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-border bg-surface overflow-x-auto">
      {images.map((img, i) => (
        <div key={img.name} className="relative group shrink-0">
          <button
            onClick={() => onSelect(i)}
            className={clsx(
              'block h-12 w-12 rounded-soft overflow-hidden border-2 transition-all',
              i === activeIndex
                ? 'border-primary shadow-raised'
                : 'border-border hover:border-muted-foreground'
            )}
          >
            <img
              src={img.preview || `data:image/jpeg;base64,${img.rawData ?? img.data}`}
              alt={img.name}
              className="w-full h-full object-cover"
            />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(img.name) }}
            className="absolute -top-1 -right-1 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-danger text-white shadow-soft"
            aria-label={`Remove ${img.name}`}
          >
            <X size={8} />
          </button>
          {img.source && img.source !== 'upload' && (
            <span className="absolute bottom-0 left-0 right-0 bg-foreground/80 text-background text-[8px] font-mono text-center leading-tight py-0.5">
              {img.source}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

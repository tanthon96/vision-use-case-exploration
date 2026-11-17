import {
  MousePointer2, Square, Circle, Pencil, ArrowUpRight, Eraser, Undo2,
  Save, Loader2, Check,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { ToolKind } from '../../types'

const TOOLS: { id: ToolKind; Icon: typeof Square; label: string }[] = [
  { id: 'select',    Icon: MousePointer2, label: 'Select' },
  { id: 'rectangle', Icon: Square,        label: 'Rectangle' },
  { id: 'ellipse',   Icon: Circle,        label: 'Ellipse' },
  { id: 'arrow',     Icon: ArrowUpRight,  label: 'Arrow' },
  { id: 'freehand',  Icon: Pencil,        label: 'Freehand' },
]

const COLORS = ['#f97316', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#facc15', '#fafafa', '#0a0a0a']

interface Props {
  tool: ToolKind
  onToolChange: (t: ToolKind) => void
  color: string
  onColorChange: (c: string) => void
  strokeWidth: number
  onStrokeWidthChange: (w: number) => void
  onUndo: () => void
  onClear: () => void
  canUndo: boolean
  /** Bake current annotations into a new image; null when no image active. */
  onSave?: () => Promise<void> | void
  saveState?: 'idle' | 'saving' | 'saved'
  /** Whether there are annotations that haven't been baked into a saved image yet. */
  unsaved?: boolean
}

export function AnnotationToolbar({
  tool, onToolChange, color, onColorChange,
  strokeWidth, onStrokeWidthChange, onUndo, onClear, canUndo,
  onSave, saveState = 'idle', unsaved = false,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-border bg-surface-raised">
      {/* Tools */}
      <div className="inline-flex rounded-soft border border-border bg-surface p-0.5">
        {TOOLS.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => onToolChange(id)}
            title={label}
            aria-label={label}
            className={clsx(
              'inline-flex h-7 w-7 items-center justify-center rounded-sharp transition-colors',
              tool === id
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>

      {/* Color swatches */}
      <div className="inline-flex rounded-soft border border-border bg-surface p-0.5 gap-0.5">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            title={c}
            className={clsx(
              'h-5 w-5 rounded-sharp border transition-transform',
              color === c
                ? 'border-foreground scale-110'
                : 'border-border hover:scale-105'
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {/* Stroke width */}
      <div className="inline-flex items-center gap-1.5 rounded-soft border border-border bg-surface px-2 py-0.5">
        <span className="text-[10px] text-muted-foreground font-mono">w</span>
        <input
          type="range"
          min={1}
          max={12}
          value={strokeWidth}
          onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
          className="w-16 h-1 accent-primary"
        />
        <span className="text-[10px] text-foreground font-mono tabular-nums w-4 text-right">
          {strokeWidth}
        </span>
      </div>

      <div className="flex-1" />

      {/* Save: bakes annotations into a new workspace image. */}
      {onSave && (
        <button
          onClick={() => { onSave() }}
          disabled={saveState === 'saving' || !canUndo}
          className={clsx(
            'inline-flex items-center gap-1 rounded-soft px-2 py-1 text-xs font-medium transition-colors',
            saveState === 'saved'
              ? 'bg-success/15 text-success'
              : unsaved
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
          title={
            saveState === 'saved' ? 'Saved as a new workspace image'
              : unsaved ? 'Save annotated image to workspace'
                : 'Nothing to save'
          }
        >
          {saveState === 'saving' ? <Loader2 size={12} className="animate-spin" />
            : saveState === 'saved' ? <Check size={12} />
              : <Save size={12} />}
          <span>{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save'}</span>
        </button>
      )}

      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="btn-ghost inline-flex items-center gap-1 disabled:opacity-40"
        title="Undo"
      >
        <Undo2 size={12} /> <span>Undo</span>
      </button>
      <button
        onClick={onClear}
        disabled={!canUndo}
        className="btn-ghost inline-flex items-center gap-1 disabled:opacity-40 text-danger hover:text-danger"
        title="Clear annotations"
      >
        <Eraser size={12} /> <span>Clear</span>
      </button>
    </div>
  )
}

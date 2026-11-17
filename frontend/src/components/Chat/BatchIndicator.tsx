import { useEffect, useState } from 'react'
import { Send, X } from 'lucide-react'

interface Props {
  count: number
  flushInMs: number | null
  windowMs: number
  onFlushNow: () => void
  onClear: () => void
  disabled?: boolean
}

export function BatchIndicator({ count, flushInMs, windowMs, onFlushNow, onClear, disabled }: Props) {
  // Re-render every 250ms so the countdown stays live
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [])

  const remaining = Math.max(0, flushInMs ?? 0) / 1000
  const elapsed = (windowMs - (flushInMs ?? windowMs)) / windowMs
  const pct = Math.max(0, Math.min(100, elapsed * 100))

  return (
    <div className="inline-flex items-center gap-2 rounded-cushion border border-primary/30 bg-primary/5 px-2 py-1">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[11px] font-medium text-foreground">
          {count} frame{count !== 1 ? 's' : ''} buffered
        </span>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          → flush in {remaining.toFixed(1)}s
        </span>
      </div>
      <div className="h-1 w-12 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <button
        onClick={onFlushNow}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-sharp bg-primary text-primary-foreground px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-40"
        title="Send batch now"
      >
        <Send size={9} /> Send now
      </button>
      <button
        onClick={onClear}
        disabled={disabled}
        className="text-muted-foreground hover:text-danger disabled:opacity-40"
        title="Discard buffered frames"
      >
        <X size={11} />
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { X, Loader2, BarChart3 } from 'lucide-react'
import { api, ApiError } from '../../api/client'
import type { ChatStats } from '../../types'

interface Props {
  workspaceId: string
  chatId: string
  chatTitle: string
  onClose: () => void
}

const fmt = new Intl.NumberFormat()

/** Format a USD cost with enough precision to be meaningful for cheap runs. */
function usd(v: number | null): string {
  if (v === null) return '—'
  if (v === 0) return '$0'
  // Extraction tasks are often fractions of a cent; show 4 dp, but never round
  // a real cost down to $0.0000.
  return v < 0.0001 ? '<$0.0001' : `$${v.toFixed(4)}`
}

export function ChatStatsModal({ workspaceId, chatId, chatTitle, onClose }: Props) {
  const [stats, setStats] = useState<ChatStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStats(null)
    setError(null)
    ;(async () => {
      try {
        const s = await api.chats.stats(workspaceId, chatId)
        if (!cancelled) setStats(s)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.body || err.message : String(err))
      }
    })()
    return () => { cancelled = true }
  }, [workspaceId, chatId])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-surface border border-border rounded-cushion shadow-soft overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 size={13} className="text-primary shrink-0" />
            <span className="text-xs font-semibold text-foreground truncate" title={chatTitle}>
              {chatTitle || 'Untitled'} — usage
            </span>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground" title="Close">
            <X size={13} />
          </button>
        </div>

        <div className="p-4">
          {error && <p className="text-xs text-danger">Failed to load stats: {error}</p>}
          {!error && !stats && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-4 justify-center">
              <Loader2 size={12} className="animate-spin" /> Computing…
            </div>
          )}

          {stats && (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <Stat label="Input tokens" value={fmt.format(stats.total_input_tokens)} />
                <Stat label="Output tokens" value={fmt.format(stats.total_output_tokens)} />
                <Stat label="Est. cost" value={usd(stats.estimated_cost)} accent />
              </div>

              {stats.by_model.length > 0 ? (
                <div className="rounded-soft border border-border overflow-hidden">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="bg-muted/60 text-left text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 font-medium">Model</th>
                        <th className="px-2 py-1 font-medium text-right">Msgs</th>
                        <th className="px-2 py-1 font-medium text-right">In</th>
                        <th className="px-2 py-1 font-medium text-right">Out</th>
                        <th className="px-2 py-1 font-medium text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.by_model.map((m, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="px-2 py-1 font-mono truncate max-w-[160px]" title={`${m.model_provider ?? ''} ${m.model_id ?? ''}`}>
                            {m.model_id ?? '—'}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{m.message_count}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmt.format(m.input_tokens)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmt.format(m.output_tokens)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{usd(m.estimated_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No model usage recorded in this chat yet.</p>
              )}

              {stats.has_unpriced && (
                <p className="mt-3 text-[10px] text-muted-foreground">
                  Some models have no pricing data (shown as “—”); the estimate excludes them.
                </p>
              )}
              <p className="mt-1 text-[10px] text-muted-foreground">
                Estimate only — costs derive from published per-token rates and stored token counts.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-soft border border-border bg-background px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${accent ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  )
}

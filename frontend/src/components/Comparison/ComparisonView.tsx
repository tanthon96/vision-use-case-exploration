import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { api, ApiError } from '../../api/client'
import { MessageMarkdown } from '../Chat/MessageMarkdown'
import type { ComparisonItem } from '../../types'

interface Props {
  messageIds: string[]
  onClose: () => void
}

export function ComparisonView({ messageIds, onClose }: Props) {
  const [items, setItems] = useState<ComparisonItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setItems(null); setErr(null)
    api.comparisons.fetch(messageIds)
      .then((d) => { if (!cancelled) setItems(d) })
      .catch((e) => {
        if (cancelled) return
        setErr(e instanceof ApiError ? e.body || e.message : String(e))
      })
    return () => { cancelled = true }
  }, [messageIds])

  // For the shared-image header, find the FIRST image that appears in every
  // selected response. If there isn't one, we just don't pin one at top.
  const sharedImage = useMemo(() => {
    if (!items || items.length === 0) return null
    const first = items[0].images[0]
    if (!first) return null
    const allHaveIt = items.every((it) => it.images.some((i) => i.image_id === first.image_id))
    return allHaveIt ? first : null
  }, [items])

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface shrink-0">
        <h2 className="text-sm font-semibold">
          Comparing {messageIds.length} response{messageIds.length !== 1 ? 's' : ''}
        </h2>
        <button
          onClick={onClose}
          className="h-7 w-7 rounded-soft inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <X size={14} />
        </button>
      </div>

      {!items && !err && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {err && (
        <div className="flex-1 flex items-center justify-center text-danger gap-2 text-sm">
          <AlertCircle size={16} /> {err}
        </div>
      )}

      {items && (
        <div className="flex flex-col flex-1 min-h-0">
          {sharedImage && (
            <div className="border-b border-border bg-surface-raised p-4 flex justify-center">
              <img
                src={sharedImage.presigned_url}
                alt={sharedImage.original_name}
                className="max-h-64 max-w-full rounded-soft border border-border"
              />
            </div>
          )}

          <div
            className="grid flex-1 min-h-0 overflow-x-auto"
            style={{
              gridTemplateColumns: `repeat(${items.length}, minmax(280px, 1fr))`,
            }}
          >
            {items.map((it) => (
              <ResponseColumn
                key={it.message_id}
                item={it}
                showImage={!sharedImage}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


function ResponseColumn({
  item,
  showImage,
}: {
  item: ComparisonItem
  showImage: boolean
}) {
  const isAssistant = item.role === 'assistant'
  const isError = !!item.error

  return (
    <div className="border-r border-border last:border-r-0 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-1.5 mb-1">
          {item.model_provider && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {item.model_provider}
            </span>
          )}
          <span className="font-mono text-xs font-medium text-foreground truncate">
            {item.model_id || 'user message'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
          {item.skill_name && <span className="text-accent">/{item.skill_name}</span>}
          {item.latency_ms !== null && <span>{Math.round(item.latency_ms)}ms</span>}
          {item.prompt_tokens > 0 && (
            <span>{item.prompt_tokens}↑ {item.completion_tokens}↓ tok</span>
          )}
          <span title={item.created_at}>{new Date(item.created_at).toLocaleString()}</span>
        </div>
        <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate" title={item.chat_title}>
          chat: {item.chat_title}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {showImage && item.images.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.images.map((img) => (
              <img
                key={img.image_id}
                src={img.presigned_url}
                alt={img.original_name}
                className="h-20 w-20 object-cover rounded-soft border border-border"
              />
            ))}
          </div>
        )}

        {isAssistant ? (
          isError ? (
            <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-soft px-2 py-1">
              {item.error}
            </p>
          ) : (
            <MessageMarkdown content={item.content_md} />
          )
        ) : (
          <p className={clsx(
            'text-sm whitespace-pre-wrap',
            !item.content_md && 'italic text-muted-foreground'
          )}>
            {item.content_md || '(no instruction)'}
          </p>
        )}
      </div>
    </div>
  )
}

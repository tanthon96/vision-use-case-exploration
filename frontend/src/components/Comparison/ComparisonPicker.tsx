import { useEffect, useState } from 'react'
import { Check, GitCompare, Loader2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { api } from '../../api/client'
import { useChatHistoryStore } from '../../stores/chatHistoryStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { PersistedMessage } from '../../types'
import { ComparisonView } from './ComparisonView'

/**
 * A header bar that lets the user enter "compare mode", check a few chats
 * in the history list, and open ComparisonView with the latest assistant
 * message from each selected chat.
 *
 * The actual checkboxes live in ChatHistoryPanel — this component owns the
 * toggle state and the launch button.
 */
export function ComparisonPicker() {
  const workspaceId = useWorkspaceStore((s) => s.currentId)
  const selectionMode = useChatHistoryStore((s) => s.selectionMode)
  const setSelectionMode = useChatHistoryStore((s) => s.setSelectionMode)
  const selectedMessageIds = useChatHistoryStore((s) => s.selectedMessageIds)
  const clearSelection = useChatHistoryStore((s) => s.clearSelection)

  const [overlayIds, setOverlayIds] = useState<string[] | null>(null)

  const count = selectedMessageIds.size

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-surface-raised">
        {!selectionMode ? (
          <button
            onClick={() => setSelectionMode(true)}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-soft hover:bg-muted transition-colors"
            title="Pick chats to compare side-by-side"
            disabled={!workspaceId}
          >
            <GitCompare size={11} /> Compare
          </button>
        ) : (
          <>
            <span className="text-[11px] text-foreground font-medium">
              {count} selected
            </span>
            <button
              onClick={clearSelection}
              className="text-[10px] text-muted-foreground hover:text-foreground px-1"
              disabled={count === 0}
            >
              clear
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setSelectionMode(false)}
              className="h-5 w-5 rounded-sharp inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
              title="Exit compare mode"
            >
              <X size={11} />
            </button>
            <button
              onClick={() => setOverlayIds(Array.from(selectedMessageIds))}
              disabled={count < 2}
              className={clsx(
                'inline-flex items-center gap-1 rounded-sharp px-2 py-0.5 text-[10px] font-medium transition-colors',
                count >= 2
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              <Check size={10} /> Open
            </button>
          </>
        )}
      </div>

      {overlayIds && (
        <ComparisonView
          messageIds={overlayIds}
          onClose={() => setOverlayIds(null)}
        />
      )}
    </>
  )
}


/**
 * Helper hook used by ChatHistoryPanel: given a chat id, returns the latest
 * assistant message id from that chat (the one the user is most likely to
 * want compared), fetched lazily and cached for the picker.
 */
export function useLatestAssistantMessage(chatId: string | null) {
  const workspaceId = useWorkspaceStore((s) => s.currentId)
  const [messageId, setMessageId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!chatId || !workspaceId) {
      setMessageId(null)
      return
    }
    let cancelled = false
    setLoading(true)
    api.chats.messages(workspaceId, chatId)
      .then((msgs: PersistedMessage[]) => {
        if (cancelled) return
        const last = [...msgs].reverse().find((m) => m.role === 'assistant')
        setMessageId(last?.id ?? null)
      })
      .catch(() => { if (!cancelled) setMessageId(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [chatId, workspaceId])

  return { messageId, loading }
}


export function LoadingSpinner() {
  return <Loader2 size={10} className="animate-spin text-muted-foreground" />
}

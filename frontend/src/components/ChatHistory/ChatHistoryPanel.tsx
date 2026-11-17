import { useEffect, useState } from 'react'
import { Plus, MessageSquare, Archive, Trash2, Pencil, Loader2, BarChart3 } from 'lucide-react'
import { clsx } from 'clsx'
import { useChatHistoryStore } from '../../stores/chatHistoryStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { api } from '../../api/client'
import { ComparisonPicker } from '../Comparison/ComparisonPicker'
import { ChatStatsModal } from './ChatStatsModal'
import type { ChatSummary } from '../../types'

export function ChatHistoryPanel() {
  const {
    chats, activeChatId, loadingChats,
    loadChats, selectChat, newChat, renameChat, archiveChat, deleteChat,
    selectionMode, selectedMessageIds, toggleSelected,
  } = useChatHistoryStore()
  const workspaceId = useWorkspaceStore((s) => s.currentId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  // Chat whose usage/cost stats modal is open (right-click or the stats button).
  const [statsChat, setStatsChat] = useState<ChatSummary | null>(null)
  // Cache of chatId → latest assistant message id (computed lazily for selection)
  const [lastAsstByChat, setLastAsstByChat] = useState<Record<string, string | null>>({})

  useEffect(() => { loadChats() }, [loadChats])

  // Pre-fetch latest assistant message id for each chat once selection mode is on.
  useEffect(() => {
    if (!selectionMode || !workspaceId) return
    let cancelled = false
    ;(async () => {
      const toFetch = chats.filter((c) => !(c.id in lastAsstByChat))
      for (const c of toFetch) {
        try {
          const msgs = await api.chats.messages(workspaceId, c.id)
          const last = [...msgs].reverse().find((m) => m.role === 'assistant')
          if (cancelled) return
          setLastAsstByChat((m) => ({ ...m, [c.id]: last?.id ?? null }))
        } catch {
          if (!cancelled) setLastAsstByChat((m) => ({ ...m, [c.id]: null }))
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionMode, chats.length, workspaceId])

  const finishRename = async (id: string) => {
    const title = editingTitle.trim()
    if (title) await renameChat(id, title)
    setEditingId(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Chats
        </span>
        <button
          onClick={newChat}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          title="New chat"
        >
          <Plus size={11} /> New
        </button>
      </div>

      <ComparisonPicker />

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {/* Implicit "current" entry for an unstarted chat */}
        <button
          onClick={newChat}
          className={clsx(
            'w-full text-left px-2 py-1.5 rounded-soft text-xs transition-colors',
            activeChatId === null
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/60'
          )}
        >
          <span className="font-mono">+ untitled (new)</span>
        </button>

        {loadingChats && (
          <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 size={11} className="animate-spin" /> Loading…
          </div>
        )}

        {!loadingChats && chats.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic px-2 py-2">
            No saved chats yet. Send a message to start one.
          </p>
        )}

        {chats.map((c) => {
          const lastAsstId = lastAsstByChat[c.id]
          const isSelected = !!lastAsstId && selectedMessageIds.has(lastAsstId)
          const canSelect = selectionMode && lastAsstId !== null
          return (
            <ChatRow
              key={c.id}
              chat={c}
              isActive={c.id === activeChatId}
              isEditing={editingId === c.id}
              editingTitle={editingTitle}
              selectionMode={selectionMode}
              isSelected={isSelected}
              selectionLoading={selectionMode && !(c.id in lastAsstByChat)}
              onToggleSelect={canSelect ? () => toggleSelected(lastAsstId!) : undefined}
              onSelect={() => selectChat(c.id)}
              onStartEdit={() => { setEditingId(c.id); setEditingTitle(c.title) }}
              onChangeEdit={setEditingTitle}
              onFinishEdit={() => finishRename(c.id)}
              onCancelEdit={() => setEditingId(null)}
              onArchive={() => archiveChat(c.id)}
              onDelete={() => {
                if (confirm(`Delete chat "${c.title}"? This cannot be undone.`)) deleteChat(c.id)
              }}
              onShowStats={() => setStatsChat(c)}
            />
          )
        })}
      </div>

      {statsChat && workspaceId && (
        <ChatStatsModal
          workspaceId={workspaceId}
          chatId={statsChat.id}
          chatTitle={statsChat.title}
          onClose={() => setStatsChat(null)}
        />
      )}
    </div>
  )
}

interface ChatRowProps {
  chat: ChatSummary
  isActive: boolean
  isEditing: boolean
  editingTitle: string
  selectionMode: boolean
  isSelected: boolean
  selectionLoading: boolean
  onToggleSelect?: () => void
  onSelect: () => void
  onStartEdit: () => void
  onChangeEdit: (t: string) => void
  onFinishEdit: () => void
  onCancelEdit: () => void
  onArchive: () => void
  onDelete: () => void
  onShowStats: () => void
}

function ChatRow({
  chat, isActive, isEditing, editingTitle,
  selectionMode, isSelected, selectionLoading, onToggleSelect,
  onSelect, onStartEdit, onChangeEdit, onFinishEdit, onCancelEdit,
  onArchive, onDelete, onShowStats,
}: ChatRowProps) {
  const rowClick = isEditing
    ? undefined
    : selectionMode
      ? onToggleSelect
      : onSelect

  return (
    <div
      onClick={rowClick}
      onContextMenu={(e) => { e.preventDefault(); onShowStats() }}
      className={clsx(
        'group flex items-start gap-1.5 px-2 py-1.5 rounded-soft transition-colors',
        isSelected && selectionMode
          ? 'bg-primary/15 border border-primary/40'
          : isActive && !selectionMode
            ? 'bg-primary/10 border border-primary/30'
            : 'hover:bg-muted cursor-pointer'
      )}
    >
      {selectionMode ? (
        <div
          className={clsx(
            'h-3.5 w-3.5 rounded-sharp border shrink-0 mt-0.5 flex items-center justify-center',
            isSelected
              ? 'bg-primary border-primary'
              : selectionLoading
                ? 'border-border opacity-40'
                : onToggleSelect
                  ? 'border-border'
                  : 'border-border opacity-40'
          )}
          title={onToggleSelect ? undefined : 'No assistant message in this chat'}
        >
          {isSelected && (
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-none stroke-primary-foreground stroke-2">
              <path d="M2 6.5 L5 9.5 L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ) : (
        <MessageSquare size={11} className="text-muted-foreground shrink-0 mt-0.5" />
      )}

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            autoFocus
            value={editingTitle}
            onChange={(e) => onChangeEdit(e.target.value)}
            onBlur={onFinishEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onFinishEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            className="input-sm"
          />
        ) : (
          <>
            <div className="text-xs text-foreground truncate font-medium" title={chat.title}>
              {chat.title || 'Untitled'}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
              <span className="font-mono">{chat.message_count} msg</span>
              {chat.last_model && (
                <span className="truncate max-w-[100px]" title={chat.last_model}>
                  · {chat.last_model.split(/[/-]/).slice(0, 2).join('-')}
                </span>
              )}
              {chat.last_skill && (
                <span className="text-accent truncate max-w-[80px]" title={chat.last_skill}>
                  · /{chat.last_skill}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {!isEditing && !selectionMode && (
        <div className="hidden group-hover:flex items-center gap-0 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onShowStats() }}
            className="p-1 text-muted-foreground hover:text-foreground rounded-sharp"
            title="Usage & cost (or right-click)"
          >
            <BarChart3 size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onStartEdit() }}
            className="p-1 text-muted-foreground hover:text-foreground rounded-sharp"
            title="Rename"
          >
            <Pencil size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onArchive() }}
            className="p-1 text-muted-foreground hover:text-foreground rounded-sharp"
            title="Archive"
          >
            <Archive size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-1 text-muted-foreground hover:text-danger rounded-sharp"
            title="Delete"
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, FolderKanban, Plus, Pencil } from 'lucide-react'
import { clsx } from 'clsx'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAuthStore } from '../../stores/authStore'
import { useImagePanelStore } from '../../stores/imagePanelStore'

export function WorkspaceSwitcher() {
  const authStatus = useAuthStore((s) => s.status)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const currentId = useWorkspaceStore((s) => s.currentId)
  const hydrate = useWorkspaceStore((s) => s.hydrate)
  const setCurrent = useWorkspaceStore((s) => s.setCurrent)
  const clearImages = useImagePanelStore((s) => s.clearImages)
  const create = useWorkspaceStore((s) => s.create)
  const rename = useWorkspaceStore((s) => s.rename)

  const [open, setOpen] = useState(false)
  const [creatingName, setCreatingName] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (authStatus === 'authenticated' && workspaces.length === 0) {
      hydrate()
    }
  }, [authStatus, workspaces.length, hydrate])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreatingName(null)
        setEditingId(null)
      }
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0]

  const handleCreate = async () => {
    const name = (creatingName ?? '').trim()
    if (!name) return
    await create(name)
    setCreatingName(null)
    setOpen(false)
  }

  const handleRename = async (id: string) => {
    const name = editingName.trim()
    if (!name) { setEditingId(null); return }
    await rename(id, name)
    setEditingId(null)
  }

  if (authStatus !== 'authenticated') return null

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-soft border border-border bg-surface text-xs',
          'hover:bg-muted transition-colors min-w-[140px]',
          open && 'ring-1 ring-primary'
        )}
        title="Switch workspace"
      >
        <FolderKanban size={12} className="text-primary shrink-0" />
        <span className="truncate flex-1 text-left font-medium">
          {current?.name ?? 'Loading…'}
        </span>
        <ChevronsUpDown size={11} className="text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] bg-surface-raised border border-border rounded-cushion shadow-raised py-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Workspaces
          </div>
          <div className="max-h-64 overflow-y-auto">
            {workspaces.map((w) => (
              <div
                key={w.id}
                className={clsx(
                  'group flex items-center gap-1.5 px-2 py-1 mx-1 rounded-soft transition-colors text-xs',
                  w.id === currentId
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {editingId === w.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleRename(w.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(w.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="flex-1 input-sm"
                  />
                ) : (
                  <>
                    <button
                      onClick={() => { setCurrent(w.id); clearImages(); setOpen(false) }}
                      className="flex-1 text-left truncate font-medium"
                    >
                      {w.name}
                    </button>
                    {w.id === currentId && <Check size={11} className="text-primary" />}
                    <button
                      onClick={() => { setEditingId(w.id); setEditingName(w.name) }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5"
                      title="Rename"
                    >
                      <Pencil size={10} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-border mt-1 pt-1 mx-1">
            {creatingName !== null ? (
              <div className="flex items-center gap-1 px-1">
                <input
                  autoFocus
                  value={creatingName}
                  onChange={(e) => setCreatingName(e.target.value)}
                  placeholder="Workspace name"
                  className="flex-1 input-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') setCreatingName(null)
                  }}
                />
                <button onClick={handleCreate} className="btn-primary px-2 py-1">
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreatingName('')}
                className="w-full inline-flex items-center gap-1.5 px-2 py-1 rounded-soft text-xs text-primary hover:bg-primary/10 transition-colors"
              >
                <Plus size={12} /> New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown, ChevronRight, Loader2, AlertCircle, Trash2, Plus, Download, FileText,
} from 'lucide-react'
import { useWorkspaceImages } from '../../hooks/useWorkspaceImages'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { api, ApiError, downloadUrl } from '../../api/client'
import type { WorkspaceImage, WorkspaceFile } from '../../types'

interface Props {
  /** Add a workspace image onto the canvas. */
  onAddImage: (image: WorkspaceImage) => void
  /** A workspace image was permanently deleted — drop it from the canvas too. */
  onImageDeleted: (imageId: string) => void
}

/**
 * Persistent, collapsible library at the top of the canvas panel. Lists the
 * workspace's images (add to canvas / download / delete) and generic files such
 * as model-generated CSVs (download / delete). Deliberately rendered OUTSIDE the
 * dropzone root so its clicks can't trigger the upload dialog.
 */
export function WorkspaceFilesSection({ onAddImage, onImageDeleted }: Props) {
  const workspaceId = useWorkspaceStore((s) => s.currentId)
  const reloadToken = useLibraryStore((s) => s.reloadToken)
  const { images, loading: imgLoading, error: imgError, reload: reloadImages } = useWorkspaceImages(true)

  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reloadFiles = useCallback(async () => {
    if (!workspaceId) { setFiles([]); return }
    setFilesLoading(true)
    try {
      setFiles(await api.files.list(workspaceId))
    } catch (e) {
      setError(e instanceof ApiError ? e.body || e.message : String(e))
    } finally {
      setFilesLoading(false)
    }
  }, [workspaceId])

  // Reload both lists when the workspace changes or something bumps the library.
  useEffect(() => { reloadFiles() }, [reloadFiles, reloadToken])
  useEffect(() => { reloadImages() }, [reloadImages, reloadToken])

  const total = images.length + files.length

  const deleteImage = async (img: WorkspaceImage) => {
    if (!workspaceId) return
    setBusyId(img.id); setError(null)
    try {
      await api.images.delete(workspaceId, img.id)
      onImageDeleted(img.id)
      await reloadImages()
    } catch (e) {
      setError(e instanceof ApiError ? e.body || e.message : String(e))
    } finally { setBusyId(null); setConfirmId(null) }
  }

  const deleteFile = async (file: WorkspaceFile) => {
    if (!workspaceId) return
    setBusyId(file.id); setError(null)
    try {
      await api.files.delete(workspaceId, file.id)
      await reloadFiles()
    } catch (e) {
      setError(e instanceof ApiError ? e.body || e.message : String(e))
    } finally { setBusyId(null); setConfirmId(null) }
  }

  const download = async (url: string, name: string) => {
    setError(null)
    try { await downloadUrl(url, name) }
    catch (e) { setError(e instanceof ApiError ? e.body || e.message : String(e)) }
  }

  return (
    <div className="border-b border-border bg-surface shrink-0">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        Files
        <span className="font-mono normal-case">{total}</span>
        {(imgLoading || filesLoading) && <Loader2 size={11} className="animate-spin" />}
      </button>

      {!collapsed && (
        <div className="max-h-56 overflow-y-auto px-2 pb-2 space-y-0.5">
          {(error || imgError) && (
            <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-danger">
              <AlertCircle size={11} /> {error || imgError}
            </div>
          )}

          {total === 0 && !imgLoading && !filesLoading && (
            <div className="px-1 py-2 text-xs text-muted-foreground italic">
              No files in this workspace yet.
            </div>
          )}

          {images.map((img) => (
            <Row
              key={`img-${img.id}`}
              icon={<img src={img.presigned_url} alt="" className="h-7 w-7 object-cover rounded-soft border border-border shrink-0" loading="lazy" />}
              name={img.original_name || img.id.slice(0, 8)}
              meta={`${(img.size_bytes / 1024).toFixed(0)} KB${img.source && img.source !== 'upload' ? ` · ${img.source}` : ''}`}
              confirming={confirmId === `img-${img.id}`}
              busy={busyId === img.id}
              onConfirm={() => setConfirmId(`img-${img.id}`)}
              onCancel={() => setConfirmId(null)}
              onDelete={() => deleteImage(img)}
              onDownload={() => download(img.presigned_url, img.original_name || `${img.id}.jpg`)}
              extra={
                <button
                  type="button"
                  onClick={() => onAddImage(img)}
                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-sharp text-primary hover:bg-primary/15"
                  title="Add to canvas"
                >
                  <Plus size={11} /> Add
                </button>
              }
            />
          ))}

          {files.map((file) => (
            <Row
              key={`file-${file.id}`}
              icon={<div className="h-7 w-7 rounded-soft border border-border bg-muted flex items-center justify-center shrink-0"><FileText size={13} className="text-muted-foreground" /></div>}
              name={file.name}
              meta={`${(file.size_bytes / 1024).toFixed(1)} KB${file.source === 'model' ? ' · model' : ''}`}
              confirming={confirmId === `file-${file.id}`}
              busy={busyId === file.id}
              onConfirm={() => setConfirmId(`file-${file.id}`)}
              onCancel={() => setConfirmId(null)}
              onDelete={() => deleteFile(file)}
              onDownload={() => download(file.presigned_url, file.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Row({
  icon, name, meta, confirming, busy, onConfirm, onCancel, onDelete, onDownload, extra,
}: {
  icon: React.ReactNode
  name: string
  meta: string
  confirming: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  onDelete: () => void
  onDownload: () => void
  extra?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 rounded-soft hover:bg-muted transition-colors">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-mono text-foreground truncate" title={name}>{name}</div>
        <div className="text-[10px] text-muted-foreground font-mono">{meta}</div>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-[10px] px-1.5 py-0.5 rounded-sharp bg-danger text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '…' : 'Delete'}
          </button>
          <button type="button" onClick={onCancel} className="text-[10px] px-1.5 py-0.5 rounded-sharp hover:bg-border">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          {extra}
          <button type="button" onClick={onDownload} className="text-muted-foreground hover:text-foreground p-0.5" title="Download">
            <Download size={12} />
          </button>
          <button type="button" onClick={onConfirm} className="text-muted-foreground hover:text-danger p-0.5" title="Remove from workspace">
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

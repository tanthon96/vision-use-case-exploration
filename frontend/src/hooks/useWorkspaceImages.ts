import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useWorkspaceStore } from '../stores/workspaceStore'
import type { WorkspaceImage } from '../types'

interface Result {
  images: WorkspaceImage[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

/**
 * Lazy, cached workspace image library. Re-fetches when:
 *   - `enabled` flips from false → true (e.g. user opens the @ picker)
 *   - workspace changes
 *   - the caller manually invokes `reload`
 *
 * Skipped when no workspace is selected (returns empty list).
 */
export function useWorkspaceImages(enabled: boolean = true): Result {
  const workspaceId = useWorkspaceStore((s) => s.currentId)
  const [images, setImages] = useState<WorkspaceImage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastWorkspaceRef = useRef<string | null>(null)

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setImages([])
      return
    }
    setLoading(true); setError(null)
    try {
      setImages(await api.images.list(workspaceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!enabled) return
    // Re-fetch when the workspace changes or this is the first time we're
    // enabled with a workspace selected.
    if (workspaceId !== lastWorkspaceRef.current || images.length === 0) {
      lastWorkspaceRef.current = workspaceId
      reload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workspaceId])

  return { images, loading, error, reload }
}

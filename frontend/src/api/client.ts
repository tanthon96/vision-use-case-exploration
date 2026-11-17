import type {
  BenchmarkRequest, ModelInfo,
  PersistedSkill, ChatSummary, PersistedMessage, ChatStats,
  Workspace, WorkspaceImage, WorkspaceFile, ComparisonItem,
} from '../types'
import type { CurrentUser } from '../stores/authStore'

const BASE = '/api'

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`${status}: ${body}`)
  }
}

/**
 * Download a (possibly cross-origin, e.g. presigned S3) URL as a file with a
 * given filename. Fetches to a Blob and triggers a client-side save, so the
 * browser doesn't just navigate/open inline.
 */
export async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText))
  const blob = await res.blob()
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objUrl)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    // Always send session cookie
    credentials: 'include',
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }
  // 204 no-content
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  auth: {
    me: () => request<CurrentUser>('/auth/me'),
    login: (email: string, password: string) =>
      request<CurrentUser>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () =>
      request<void>('/auth/logout', { method: 'POST' }),
    invite: (email: string, expires_in_hours = 168) =>
      request<{ email: string; token: string; expires_at: string; accept_url: string }>(
        '/auth/invite',
        { method: 'POST', body: JSON.stringify({ email, expires_in_hours }) }
      ),
    acceptInvite: (token: string, password: string, display_name = '') =>
      request<CurrentUser>('/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token, password, display_name }),
      }),
  },

  models: {
    list: () => request<ModelInfo[]>('/models'),
  },

  workspaces: {
    list: () => request<Workspace[]>('/workspaces'),
    current: () => request<Workspace>('/workspaces/current'),
    create: (name: string, description = '') =>
      request<Workspace>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      }),
    update: (id: string, patch: Partial<Pick<Workspace, 'name' | 'description'>>) =>
      request<Workspace>(`/workspaces/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      request<void>(`/workspaces/${id}`, { method: 'DELETE' }),
  },

  images: {
    list: (workspaceId: string) =>
      request<WorkspaceImage[]>(`/workspaces/${workspaceId}/images`),
    /**
     * Upload a single image via multipart. `source` distinguishes ad-hoc
     * uploads from webcam/screen frames. Returns the image record + a
     * presigned URL ready to render in the UI.
     */
    upload: async (
      workspaceId: string,
      file: File | Blob,
      opts: { name?: string; source?: 'upload' | 'webcam' | 'screen' } = {},
    ): Promise<WorkspaceImage> => {
      const fd = new FormData()
      fd.append('file', file, opts.name ?? 'image')
      const params = new URLSearchParams()
      if (opts.source) params.set('source', opts.source)
      const res = await fetch(
        `${BASE}/workspaces/${workspaceId}/images?${params}`,
        { method: 'POST', body: fd, credentials: 'include' }
      )
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new ApiError(res.status, text)
      }
      return res.json() as Promise<WorkspaceImage>
    },
    delete: (workspaceId: string, imageId: string) =>
      request<void>(`/workspaces/${workspaceId}/images/${imageId}`, {
        method: 'DELETE',
      }),
  },

  files: {
    list: (workspaceId: string) =>
      request<WorkspaceFile[]>(`/workspaces/${workspaceId}/files`),
    create: (
      workspaceId: string,
      payload: { name: string; content: string; mime_type?: string; source?: string },
    ) =>
      request<WorkspaceFile>(`/workspaces/${workspaceId}/files`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    delete: (workspaceId: string, fileId: string) =>
      request<void>(`/workspaces/${workspaceId}/files/${fileId}`, { method: 'DELETE' }),
  },

  skills: {
    list: (workspaceId: string) =>
      request<PersistedSkill[]>(`/workspaces/${workspaceId}/skills`),
    get: (workspaceId: string, skillId: string) =>
      request<PersistedSkill>(`/workspaces/${workspaceId}/skills/${skillId}`),
    create: (
      workspaceId: string,
      payload: Omit<PersistedSkill, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>,
    ) =>
      request<PersistedSkill>(`/workspaces/${workspaceId}/skills`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (
      workspaceId: string,
      skillId: string,
      payload: Omit<PersistedSkill, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>,
    ) =>
      request<PersistedSkill>(`/workspaces/${workspaceId}/skills/${skillId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    delete: (workspaceId: string, skillId: string) =>
      request<void>(`/workspaces/${workspaceId}/skills/${skillId}`, { method: 'DELETE' }),
  },

  chats: {
    list: (workspaceId: string, includeArchived = false) => {
      const qs = includeArchived ? '?include_archived=true' : ''
      return request<ChatSummary[]>(`/workspaces/${workspaceId}/chats${qs}`)
    },
    create: (workspaceId: string, title = '') =>
      request<ChatSummary>(`/workspaces/${workspaceId}/chats`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      }),
    patch: (workspaceId: string, chatId: string,
            patch: Partial<{ title: string; archived: boolean }>) =>
      request<ChatSummary>(`/workspaces/${workspaceId}/chats/${chatId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (workspaceId: string, chatId: string) =>
      request<void>(`/workspaces/${workspaceId}/chats/${chatId}`, { method: 'DELETE' }),
    messages: (workspaceId: string, chatId: string) =>
      request<PersistedMessage[]>(`/workspaces/${workspaceId}/chats/${chatId}/messages`),
    stats: (workspaceId: string, chatId: string) =>
      request<ChatStats>(`/workspaces/${workspaceId}/chats/${chatId}/stats`),
  },

  benchmark: {
    /** Returns the raw fetch Response — caller handles SSE. */
    stream: (req: BenchmarkRequest) =>
      fetch(`${BASE}/benchmark/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(req),
      }),
  },

  comparisons: {
    /** Order of `messageIds` is preserved as the column order in the response. */
    fetch: (messageIds: string[]) => {
      const qs = new URLSearchParams()
      for (const id of messageIds) qs.append('message_ids', id)
      return request<ComparisonItem[]>(`/comparisons?${qs}`)
    },
  },
}

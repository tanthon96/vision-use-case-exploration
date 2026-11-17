import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Workspace } from '../types'
import { api } from '../api/client'

interface WorkspaceStore {
  /** All workspaces owned by the current user. */
  workspaces: Workspace[]
  /** Id of the active workspace; chats/images/skills all scope to this. */
  currentId: string | null
  loading: boolean

  hydrate: () => Promise<void>
  setCurrent: (id: string) => void
  create: (name: string, description?: string) => Promise<Workspace>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>

  current: () => Workspace | null
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      workspaces: [],
      currentId: null,
      loading: false,

      hydrate: async () => {
        set({ loading: true })
        try {
          const list = await api.workspaces.list()
          set({ workspaces: list })
          // If the persisted currentId is no longer valid, fall back to first.
          const { currentId } = get()
          if (!currentId || !list.some((w) => w.id === currentId)) {
            set({ currentId: list[0]?.id ?? null })
          }
        } finally {
          set({ loading: false })
        }
      },

      setCurrent: (id) => set({ currentId: id }),

      create: async (name, description = '') => {
        const ws = await api.workspaces.create(name, description)
        set((s) => ({ workspaces: [ws, ...s.workspaces], currentId: ws.id }))
        return ws
      },

      rename: async (id, name) => {
        const updated = await api.workspaces.update(id, { name })
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === id ? updated : w)),
        }))
      },

      remove: async (id) => {
        await api.workspaces.delete(id)
        set((s) => {
          const filtered = s.workspaces.filter((w) => w.id !== id)
          return {
            workspaces: filtered,
            currentId: s.currentId === id ? (filtered[0]?.id ?? null) : s.currentId,
          }
        })
      },

      current: () => {
        const { workspaces, currentId } = get()
        return workspaces.find((w) => w.id === currentId) ?? null
      },
    }),
    {
      name: 'vlm-workspace',
      partialize: (s) => ({ currentId: s.currentId }),
    }
  )
)

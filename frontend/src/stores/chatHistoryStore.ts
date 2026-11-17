import { create } from 'zustand'
import { api } from '../api/client'
import type { ChatSummary, PersistedMessage } from '../types'

interface ChatHistoryStore {
  workspaceId: string | null
  chats: ChatSummary[]
  activeChatId: string | null
  loadingChats: boolean
  loadingMessages: boolean

  // Multi-select for the comparison flow (Phase E)
  selectionMode: boolean
  selectedMessageIds: Set<string>

  setWorkspaceId: (id: string | null) => void
  loadChats: () => Promise<void>
  selectChat: (chatId: string | null) => void
  loadMessages: (chatId: string) => Promise<PersistedMessage[]>

  newChat: () => void                          // local-only: clears active chat
  renameChat: (chatId: string, title: string) => Promise<void>
  archiveChat: (chatId: string) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>

  setSelectionMode: (on: boolean) => void
  toggleSelected: (messageId: string) => void
  clearSelection: () => void
}

export const useChatHistoryStore = create<ChatHistoryStore>((set, get) => ({
  workspaceId: null,
  chats: [],
  activeChatId: null,
  loadingChats: false,
  loadingMessages: false,

  selectionMode: false,
  selectedMessageIds: new Set(),

  setWorkspaceId: (id) => {
    const { workspaceId } = get()
    if (id === workspaceId) return
    set({ workspaceId: id, chats: [], activeChatId: null, selectedMessageIds: new Set() })
    if (id) get().loadChats()
  },

  loadChats: async () => {
    const { workspaceId } = get()
    if (!workspaceId) return
    set({ loadingChats: true })
    try {
      const chats = await api.chats.list(workspaceId)
      set({ chats })
    } finally {
      set({ loadingChats: false })
    }
  },

  selectChat: (chatId) => set({ activeChatId: chatId }),

  loadMessages: async (chatId) => {
    const { workspaceId } = get()
    if (!workspaceId) return []
    set({ loadingMessages: true })
    try {
      return await api.chats.messages(workspaceId, chatId)
    } finally {
      set({ loadingMessages: false })
    }
  },

  newChat: () => set({ activeChatId: null }),

  renameChat: async (chatId, title) => {
    const { workspaceId } = get()
    if (!workspaceId) return
    const updated = await api.chats.patch(workspaceId, chatId, { title })
    set((s) => ({
      chats: s.chats.map((c) => (c.id === chatId ? { ...c, ...updated } : c)),
    }))
  },

  archiveChat: async (chatId) => {
    const { workspaceId } = get()
    if (!workspaceId) return
    await api.chats.patch(workspaceId, chatId, { archived: true })
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== chatId),
      activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
    }))
  },

  deleteChat: async (chatId) => {
    const { workspaceId } = get()
    if (!workspaceId) return
    await api.chats.delete(workspaceId, chatId)
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== chatId),
      activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
    }))
  },

  setSelectionMode: (on) =>
    set({ selectionMode: on, selectedMessageIds: on ? get().selectedMessageIds : new Set() }),

  toggleSelected: (messageId) =>
    set((s) => {
      const next = new Set(s.selectedMessageIds)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return { selectedMessageIds: next }
    }),

  clearSelection: () => set({ selectedMessageIds: new Set() }),
}))

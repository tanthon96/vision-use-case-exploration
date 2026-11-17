import { create } from 'zustand'
import type { ChatMessage, ChatStep, ImageInput } from '../types'

interface ChatStore {
  messages: ChatMessage[]

  /**
   * Frames captured but not yet sent. The chat layer flushes these on a
   * timer (see batchWindowMs) or when the user manually sends.
   */
  batchedFrames: ImageInput[]
  batchWindowMs: number
  /** Epoch ms when the first frame of the current window arrived. */
  batchStartedAt: number | null

  isStreaming: boolean

  addMessage: (msg: ChatMessage) => void
  appendToken: (id: string, token: string) => void
  setContent: (id: string, content: string) => void
  appendThinking: (id: string, token: string) => void
  appendStep: (id: string, step: ChatStep) => void
  finalizeMessage: (id: string, metrics?: ChatMessage['metrics'], error?: string) => void
  clearMessages: () => void
  setStreaming: (v: boolean) => void

  pushFrameToBatch: (frame: ImageInput) => void
  takeBatch: () => ImageInput[]
  clearBatch: () => void
  setBatchWindowMs: (ms: number) => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  batchedFrames: [],
  batchWindowMs: 10_000,
  batchStartedAt: null,
  isStreaming: false,

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  appendToken: (id, token) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + token } : m
      ),
    })),

  setContent: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content } : m
      ),
    })),

  appendThinking: (id, token) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, thinking: (m.thinking ?? '') + token } : m
      ),
    })),

  appendStep: (id, step) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, steps: [...(m.steps ?? []), step] } : m
      ),
    })),

  finalizeMessage: (id, metrics, error) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, streaming: false, metrics, error } : m
      ),
    })),

  clearMessages: () => set({ messages: [] }),

  setStreaming: (v) => set({ isStreaming: v }),

  pushFrameToBatch: (frame) => {
    const { batchedFrames, batchStartedAt } = get()
    // Hard cap to avoid runaway memory
    const next = [...batchedFrames, frame].slice(-60)
    set({
      batchedFrames: next,
      batchStartedAt: batchStartedAt ?? Date.now(),
    })
  },

  takeBatch: () => {
    const { batchedFrames } = get()
    set({ batchedFrames: [], batchStartedAt: null })
    return batchedFrames
  },

  clearBatch: () => set({ batchedFrames: [], batchStartedAt: null }),

  setBatchWindowMs: (ms) => set({ batchWindowMs: ms }),
}))

// Dev-only: expose the store on `window` so the preview/eval workflow can
// inspect or seed state during manual UI verification. Stripped from prod builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__chatStore = useChatStore
}

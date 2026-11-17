import { create } from 'zustand'

/**
 * A trivial cross-component refresh signal for the workspace library (images +
 * files). The Files section reloads its lists whenever `reloadToken` changes;
 * anything that mutates the library (e.g. a finished chat run that auto-saved a
 * CSV) calls `bump()` to trigger that reload.
 */
interface LibraryStore {
  reloadToken: number
  bump: () => void
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  reloadToken: 0,
  bump: () => set((s) => ({ reloadToken: s.reloadToken + 1 })),
}))

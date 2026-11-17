import { create } from 'zustand'
import { api } from '../api/client'

export interface CurrentUser {
  id: string
  email: string
  display_name: string
  is_admin: boolean
}

interface AuthStore {
  user: CurrentUser | null
  /** undefined while we're still checking; null once we've confirmed no session. */
  status: 'loading' | 'authenticated' | 'anonymous'

  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  status: 'loading',

  hydrate: async () => {
    try {
      const user = await api.auth.me()
      set({ user, status: 'authenticated' })
    } catch {
      set({ user: null, status: 'anonymous' })
    }
  },

  login: async (email, password) => {
    const user = await api.auth.login(email, password)
    set({ user, status: 'authenticated' })
  },

  logout: async () => {
    await api.auth.logout()
    set({ user: null, status: 'anonymous' })
  },
}))

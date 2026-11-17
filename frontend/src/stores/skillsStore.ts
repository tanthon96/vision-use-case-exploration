import { create } from 'zustand'
import type { PersistedSkill } from '../types'
import { api } from '../api/client'

interface SkillsStore {
  workspaceId: string | null
  skills: PersistedSkill[]
  activeSkill: PersistedSkill | null
  loading: boolean

  setWorkspaceId: (id: string | null) => void
  loadSkills: () => Promise<void>
  setActiveSkill: (skill: PersistedSkill | null) => void
  saveSkill: (
    skill: Omit<PersistedSkill, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>,
    skillId?: string,
  ) => Promise<void>
  deleteSkill: (skillId: string) => Promise<void>
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  workspaceId: null,
  skills: [],
  activeSkill: null,
  loading: false,

  setWorkspaceId: (id) => {
    const { workspaceId } = get()
    if (id === workspaceId) return
    set({ workspaceId: id, skills: [], activeSkill: null })
    if (id) get().loadSkills()
  },

  loadSkills: async () => {
    const { workspaceId } = get()
    if (!workspaceId) return
    set({ loading: true })
    try {
      const skills = await api.skills.list(workspaceId)
      set({ skills })
    } finally {
      set({ loading: false })
    }
  },

  setActiveSkill: (skill) => set({ activeSkill: skill }),

  saveSkill: async (skill, skillId) => {
    const { workspaceId } = get()
    if (!workspaceId) throw new Error('no workspace selected')
    if (skillId) {
      await api.skills.update(workspaceId, skillId, skill)
    } else {
      await api.skills.create(workspaceId, skill)
    }
    await get().loadSkills()
  },

  deleteSkill: async (skillId) => {
    const { workspaceId } = get()
    if (!workspaceId) return
    await api.skills.delete(workspaceId, skillId)
    set((s) => ({
      skills: s.skills.filter((sk) => sk.id !== skillId),
      activeSkill: s.activeSkill?.id === skillId ? null : s.activeSkill,
    }))
  },
}))

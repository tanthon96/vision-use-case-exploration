import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelInfo, ProviderCredentials } from '../types'

interface BenchmarkStore {
  models: ModelInfo[]
  selectedProvider: string
  selectedModelId: string
  /** Claude thinking effort for the next run: low/medium/high/max/off. */
  thinkingEffort: string
  credentials: ProviderCredentials
  loadingModels: boolean

  setModels: (models: ModelInfo[]) => void
  setSelectedProvider: (p: string) => void
  setSelectedModelId: (id: string) => void
  setThinkingEffort: (e: string) => void
  setCredentials: (creds: Partial<ProviderCredentials>) => void
  setLoadingModels: (v: boolean) => void

  /** API key for the currently selected provider */
  currentApiKey: () => string
}

const defaultCreds: ProviderCredentials = {
  anthropic_api_key: '',
  google_api_key: '',
  aws_access_key_id: '',
  aws_secret_access_key: '',
  aws_region: 'us-east-1',
  ollama_base_url: 'http://localhost:11434',
}

export const useBenchmarkStore = create<BenchmarkStore>()(
  persist(
    (set, get) => ({
      models: [],
      selectedProvider: 'anthropic',
      selectedModelId: 'claude-sonnet-4-6',
      thinkingEffort: 'low',
      credentials: defaultCreds,
      loadingModels: false,

      setModels: (models) => set({ models }),
      setSelectedProvider: (p) => set({ selectedProvider: p }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),
      setThinkingEffort: (e) => set({ thinkingEffort: e }),
      setCredentials: (creds) =>
        set((s) => ({ credentials: { ...s.credentials, ...creds } })),
      setLoadingModels: (v) => set({ loadingModels: v }),

      currentApiKey: () => {
        const { selectedProvider, credentials } = get()
        switch (selectedProvider) {
          case 'anthropic': return credentials.anthropic_api_key
          case 'gemini': return credentials.google_api_key
          default: return ''
        }
      },
    }),
    {
      name: 'vlm-benchmark-config',
      partialize: (s) => ({
        selectedProvider: s.selectedProvider,
        selectedModelId: s.selectedModelId,
        thinkingEffort: s.thinkingEffort,
        credentials: s.credentials,
      }),
    }
  )
)

import { useCallback, useEffect, useState } from 'react'
import { Key, RefreshCw } from 'lucide-react'
import { useBenchmarkStore } from '../../stores/benchmarkStore'
import { api } from '../../api/client'
import { clsx } from 'clsx'

const PROVIDERS = [
  { id: 'anthropic', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'bedrock', label: 'Bedrock' },
  { id: 'ollama', label: 'Ollama' },
]

export function ModelSelector() {
  const {
    models, selectedProvider, selectedModelId,
    thinkingEffort, setThinkingEffort,
    setModels, setSelectedProvider, setSelectedModelId,
    credentials, setCredentials, loadingModels, setLoadingModels,
  } = useBenchmarkStore()

  const [showCreds, setShowCreds] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const loadModels = useCallback(async () => {
    setLoadingModels(true)
    setFetchError(null)
    try {
      const list = await api.models.list()
      setModels(list)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setFetchError(msg)
      console.error('Failed to load models:', err)
    } finally {
      setLoadingModels(false)
    }
  }, [setModels, setLoadingModels])

  // Initial fetch
  useEffect(() => {
    if (models.length === 0 && !loadingModels) loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Reconcile persisted selection against fetched model list ───────────────
  // When the available models change (new fetch, or backend updated its list),
  // the persisted selectedModelId may no longer be valid for the current
  // provider. Auto-correct to the first available model in that case.
  useEffect(() => {
    if (models.length === 0) return
    const providerHasIt = models.some(
      (m) => m.provider === selectedProvider && m.model_id === selectedModelId
    )
    if (providerHasIt) return
    const firstForProvider = models.find((m) => m.provider === selectedProvider)
    if (firstForProvider) {
      setSelectedModelId(firstForProvider.model_id)
    } else {
      // The persisted provider has no models at all — fall back to the very
      // first available model and update both fields.
      const first = models[0]
      if (first) {
        setSelectedProvider(first.provider)
        setSelectedModelId(first.model_id)
      }
    }
  }, [models, selectedProvider, selectedModelId, setSelectedModelId, setSelectedProvider])

  const providerModels = models.filter((m) => m.provider === selectedProvider)

  // The thinking-effort selector is Claude-only and only meaningful for models
  // that support extended thinking.
  const selectedModel = providerModels.find((m) => m.model_id === selectedModelId)
  const showEffort = selectedProvider === 'anthropic' && !!selectedModel?.supports_thinking

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider)
    const first = models.find((m) => m.provider === provider)
    if (first) {
      setSelectedModelId(first.model_id)
    }
    // If models haven't loaded yet, the reconcile effect above will pick a
    // valid model as soon as they do.
  }

  return (
    <div className="flex items-center gap-1.5 text-xs relative">
      <select
        value={selectedProvider}
        onChange={(e) => handleProviderChange(e.target.value)}
        className="bg-surface border border-border rounded-soft px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
      >
        {PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>

      <select
        // Defensive: if the persisted ID isn't in the list, the reconcile effect
        // is mid-flight. Render the first available model's id so the displayed
        // option always matches the visible label and the select isn't "stuck".
        value={
          providerModels.some((m) => m.model_id === selectedModelId)
            ? selectedModelId
            : (providerModels[0]?.model_id ?? '')
        }
        onChange={(e) => setSelectedModelId(e.target.value)}
        disabled={loadingModels || providerModels.length === 0}
        className="bg-surface border border-border rounded-soft px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-[170px] cursor-pointer disabled:opacity-50"
        title={
          fetchError
            ? `Failed to load models: ${fetchError}`
            : providerModels.length === 0
              ? loadingModels ? 'Loading…' : 'No models available for this provider'
              : undefined
        }
      >
        {providerModels.length === 0 ? (
          <option>{loadingModels ? 'Loading…' : fetchError ? 'Failed to load' : '—'}</option>
        ) : (
          providerModels.map((m) => (
            <option key={m.model_id} value={m.model_id}>{m.display_name}</option>
          ))
        )}
      </select>

      {/* Claude-only: reasoning effort for the next run, so runs can be compared
          across thinking depths. */}
      {showEffort && (
        <select
          value={thinkingEffort}
          onChange={(e) => setThinkingEffort(e.target.value)}
          className="bg-surface border border-border rounded-soft px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
          title="Extended-thinking effort (Claude). Higher = more reasoning, slower, more tokens."
        >
          <option value="off">Think: off</option>
          <option value="low">Think: low</option>
          <option value="medium">Think: medium</option>
          <option value="high">Think: high</option>
          <option value="max">Think: max</option>
        </select>
      )}

      {/* Reload models — visible whenever models are empty OR a fetch error occurred */}
      {(models.length === 0 || fetchError) && (
        <button
          onClick={loadModels}
          disabled={loadingModels}
          className="h-7 w-7 rounded-soft inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
          title={fetchError ? `Retry — ${fetchError}` : 'Reload models'}
        >
          <RefreshCw size={12} className={loadingModels ? 'animate-spin' : ''} />
        </button>
      )}

      <button
        onClick={() => setShowCreds(!showCreds)}
        className={clsx(
          'h-7 w-7 rounded-soft inline-flex items-center justify-center transition-colors',
          showCreds
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
        title="API credentials"
      >
        <Key size={12} />
      </button>

      {showCreds && (
        <div className="absolute top-full right-0 mt-2 z-50 bg-surface-raised border border-border rounded-cushion p-4 shadow-raised w-80">
          <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
            Keys are stored in <span className="font-mono">localStorage</span> only — never sent to our server.
          </p>
          <CredField label="Anthropic API Key" value={credentials.anthropic_api_key} onChange={(v) => setCredentials({ anthropic_api_key: v })} />
          <CredField label="Google API Key" value={credentials.google_api_key} onChange={(v) => setCredentials({ google_api_key: v })} />
          <CredField label="AWS Access Key ID" value={credentials.aws_access_key_id} onChange={(v) => setCredentials({ aws_access_key_id: v })} />
          <CredField label="AWS Secret Key" type="password" value={credentials.aws_secret_access_key} onChange={(v) => setCredentials({ aws_secret_access_key: v })} />
          <CredField label="AWS Region" value={credentials.aws_region} onChange={(v) => setCredentials({ aws_region: v })} />
          <CredField label="Ollama Base URL" value={credentials.ollama_base_url} onChange={(v) => setCredentials({ ollama_base_url: v })} />
          <button onClick={() => setShowCreds(false)} className="btn-primary w-full mt-2">
            Save & Close
          </button>
        </div>
      )}
    </div>
  )
}

function CredField({
  label, value, onChange, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div className="mb-2">
      <label className="block text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wider font-medium">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-sm font-mono"
        placeholder="sk-..."
        autoComplete="off"
      />
    </div>
  )
}

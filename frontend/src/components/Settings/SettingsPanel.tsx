import { useBenchmarkStore } from '../../stores/benchmarkStore'
import { useChatStore } from '../../stores/chatStore'

export function SettingsPanel() {
  const { credentials, setCredentials } = useBenchmarkStore()
  const { clearMessages, batchWindowMs, setBatchWindowMs } = useChatStore()

  return (
    <div className="p-3 space-y-5 overflow-y-auto">
      <section>
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Batching
        </h3>
        <label className="block text-[11px] text-foreground mb-1">
          Window: <span className="font-mono tabular-nums">{(batchWindowMs / 1000).toFixed(0)}s</span>
        </label>
        <input
          type="range"
          min={2000}
          max={30000}
          step={1000}
          value={batchWindowMs}
          onChange={(e) => setBatchWindowMs(Number(e.target.value))}
          className="w-full h-1 accent-primary"
        />
        <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
          Frames captured by the webcam/screen are buffered for this duration, then sent
          in one model call.
        </p>
      </section>

      <section>
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          API credentials
        </h3>
        <div className="space-y-2">
          <CredField label="Anthropic API Key" value={credentials.anthropic_api_key} onChange={(v) => setCredentials({ anthropic_api_key: v })} />
          <CredField label="Google API Key (Gemini)" value={credentials.google_api_key} onChange={(v) => setCredentials({ google_api_key: v })} />
          <CredField label="AWS Access Key ID" value={credentials.aws_access_key_id} onChange={(v) => setCredentials({ aws_access_key_id: v })} />
          <CredField label="AWS Secret Access Key" type="password" value={credentials.aws_secret_access_key} onChange={(v) => setCredentials({ aws_secret_access_key: v })} />
          <CredField label="AWS Region" value={credentials.aws_region} onChange={(v) => setCredentials({ aws_region: v })} />
          <CredField label="Ollama Base URL" value={credentials.ollama_base_url} onChange={(v) => setCredentials({ ollama_base_url: v })} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
          Stored in <span className="font-mono">localStorage</span>, sent directly to model
          APIs. Never persisted server-side.
        </p>
      </section>

      <section>
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Chat
        </h3>
        <button
          onClick={() => { if (confirm('Clear all messages?')) clearMessages() }}
          className="text-xs text-danger hover:bg-danger/10 border border-danger/30 rounded-soft px-3 py-1.5 transition-colors"
        >
          Clear message history
        </button>
      </section>
    </div>
  )
}

function CredField({
  label, value, onChange, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="input-sm font-mono"
      />
    </div>
  )
}

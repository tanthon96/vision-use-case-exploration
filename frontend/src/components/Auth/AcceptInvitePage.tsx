import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, Loader2 } from 'lucide-react'
import { api, ApiError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'

/**
 * Lands here when the user opens a link like /accept-invite?token=xyz.
 * On success we drop the token from the URL and let App.tsx render the
 * authenticated UI.
 */
export function AcceptInvitePage({ token }: { token: string }) {
  const hydrate = useAuthStore((s) => s.hydrate)
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) setError('Missing invite token in URL.')
  }, [token])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setBusy(true); setError(null)
    try {
      await api.auth.acceptInvite(token, password, displayName)
      setDone(true)
      // Wait a beat so the user sees the success state, then refresh auth + clear URL.
      setTimeout(async () => {
        await hydrate()
        window.history.replaceState(null, '', '/')
      }, 600)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.body || err.message)
      } else {
        setError('Failed to accept invite.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-cushion bg-primary/15 text-primary flex items-center justify-center shadow-soft">
            <Eye size={18} />
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-semibold">Accept invite</h1>
            <p className="text-[11px] text-muted-foreground font-mono">create your account</p>
          </div>
        </div>

        {done ? (
          <div className="bg-surface border border-border rounded-cushion p-5 text-sm flex items-center gap-2 text-success">
            <CheckCircle2 size={16} /> Account created. Signing you in…
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="bg-surface border border-border rounded-cushion p-5 shadow-soft space-y-3"
          >
            <Field label="Display name (optional)">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input-sm"
                placeholder="Your name"
                autoFocus
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-sm font-mono"
                placeholder="At least 8 characters"
              />
            </Field>
            <Field label="Confirm password">
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input-sm font-mono"
              />
            </Field>

            {error && (
              <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-soft px-2 py-1">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !token}
              className="btn-primary w-full inline-flex items-center justify-center gap-1.5"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Create account
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}

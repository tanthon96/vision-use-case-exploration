import { useState } from 'react'
import { Eye, Loader2 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { ApiError } from '../../api/client'

export function LoginPage() {
  const login = useAuthStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? 'Invalid email or password.' : err.body || err.message)
      } else {
        setError('Sign-in failed.')
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
            <h1 className="text-base font-semibold">VLM Benchmark</h1>
            <p className="text-[11px] text-muted-foreground font-mono">sign in to continue</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-surface border border-border rounded-cushion p-5 shadow-soft space-y-3"
        >
          <div>
            <label htmlFor="email" className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Email
            </label>
            <input
              id="email"
              type="text"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-sm font-mono"
              placeholder="you@example.com"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-sm font-mono"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-soft px-2 py-1">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="btn-primary w-full inline-flex items-center justify-center gap-1.5"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Sign in
          </button>

          <p className="text-[11px] text-muted-foreground leading-snug pt-1">
            New users need an invite from an admin.
          </p>
        </form>
      </div>
    </div>
  )
}

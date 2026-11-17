import type { ReactNode } from 'react'
import { Eye, LogOut, ShieldCheck } from 'lucide-react'
import { ModelSelector } from '../ModelSelector/ModelSelector'
import { ThemeToggle } from './ThemeToggle'
import { WorkspaceSwitcher } from '../Workspace/WorkspaceSwitcher'
import { useAuthStore } from '../../stores/authStore'

interface Props {
  chatToggle?: ReactNode
}

export function Header({ chatToggle }: Props) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  return (
    <header className="flex items-center gap-3 px-3 py-2 border-b border-border bg-surface shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <div className="h-7 w-7 rounded-cushion bg-primary/15 text-primary flex items-center justify-center shadow-soft shrink-0">
          <Eye size={14} />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-sm font-semibold text-foreground truncate">VLM Benchmark</span>
          <span className="text-[10px] text-muted-foreground font-mono truncate hidden sm:block">
            vision · skills · batch
          </span>
        </div>
      </div>
      <div className="w-px h-5 bg-border mx-1" />
      <WorkspaceSwitcher />
      <div className="flex-1" />
      <ModelSelector />
      <ThemeToggle />

      {user && (
        <div className="flex items-center gap-1 border-l border-border pl-2 ml-1">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground" title={user.email}>
            {user.is_admin && <ShieldCheck size={11} className="text-primary" />}
            <span className="font-mono truncate max-w-[120px]">{user.display_name || user.email}</span>
          </div>
          <button
            onClick={logout}
            className="h-7 w-7 rounded-soft inline-flex items-center justify-center text-muted-foreground hover:text-danger hover:bg-muted transition-colors"
            title="Sign out"
          >
            <LogOut size={12} />
          </button>
        </div>
      )}

      {chatToggle}
    </header>
  )
}

import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type Theme } from '../../hooks/useTheme'
import { clsx } from 'clsx'

const OPTIONS: { id: Theme; Icon: typeof Sun; label: string }[] = [
  { id: 'light', Icon: Sun, label: 'Light' },
  { id: 'dark', Icon: Moon, label: 'Dark' },
  { id: 'system', Icon: Monitor, label: 'System' },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="inline-flex items-center gap-0 border border-border rounded-soft bg-surface p-0.5">
      {OPTIONS.map(({ id, Icon, label }) => (
        <button
          key={id}
          onClick={() => setTheme(id)}
          title={label}
          aria-label={label}
          className={clsx(
            'inline-flex h-6 w-6 items-center justify-center rounded-sharp transition-colors',
            theme === id
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon size={12} />
        </button>
      ))}
    </div>
  )
}

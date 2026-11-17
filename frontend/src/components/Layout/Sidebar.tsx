import { useState } from 'react'
import {
  BookOpen, MessagesSquare, Settings, ChevronLeft, ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { clsx } from 'clsx'

export type SidebarTab = 'chats' | 'skills' | 'settings'

interface SidebarProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
}

const TABS: { id: SidebarTab; label: string; Icon: LucideIcon }[] = [
  { id: 'chats', label: 'Chats', Icon: MessagesSquare },
  { id: 'skills', label: 'Skills', Icon: BookOpen },
  { id: 'settings', label: 'Settings', Icon: Settings },
]

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={clsx(
        'flex flex-col border-r border-border bg-surface transition-all duration-200',
        collapsed ? 'w-12' : 'w-44'
      )}
    >
      <div className="flex items-center justify-between p-2 border-b border-border">
        {!collapsed && (
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Workspace
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded-sharp hover:bg-muted text-muted-foreground hover:text-foreground ml-auto"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 p-2 flex-1">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={clsx(
              'group relative flex items-center gap-2 px-2 py-1.5 rounded-soft text-xs font-medium transition-colors',
              activeTab === id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {activeTab === id && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 bg-primary rounded-r" />
            )}
            <Icon size={14} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>
    </aside>
  )
}

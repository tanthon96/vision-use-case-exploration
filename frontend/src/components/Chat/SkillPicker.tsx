import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Sparkles, Slash } from 'lucide-react'
import { clsx } from 'clsx'
import { useSkillsStore } from '../../stores/skillsStore'
import type { PersistedSkill } from '../../types'

interface Props {
  /** Filter typed AFTER the '/' character (excluding the '/' itself). */
  query: string
  onSelect: (skill: PersistedSkill) => void
  onClose: () => void
}

/**
 * Floating popover anchored above the message input, mirroring
 * WorkspaceImagePicker but for skills. Typing '/' at the start of the input
 * opens it; picking a skill sets it as the active skill for the next run.
 * Keyboard:
 *   ↑ / ↓ — move highlight
 *   ⏎      — pick highlight
 *   esc    — close
 */
export function SkillPicker({ query, onSelect, onClose }: Props) {
  const skills = useSkillsStore((s) => s.skills)
  const loading = useSkillsStore((s) => s.loading)
  const [highlight, setHighlight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return skills.slice(0, 24)
    return skills
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      )
      .slice(0, 24)
  }, [skills, query])

  // Reset highlight when the filter changes
  useEffect(() => { setHighlight(0) }, [query, filtered.length])

  // Global keyboard handler — installed at the window (capture) so it works
  // regardless of whether the textarea or the popover has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Own these keys while open; stopPropagation prevents Enter from also
      // reaching the textarea and sending the chat (see WorkspaceImagePicker).
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation()
        if (filtered.length) setHighlight((i) => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        if (filtered.length) setHighlight((i) => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation()
        if (filtered.length) onSelect(filtered[highlight])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [filtered, highlight, onSelect, onClose])

  // Scroll highlight into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  return (
    <div
      className="absolute bottom-full left-2 right-2 mb-1 z-30 bg-surface-raised border border-border rounded-cushion shadow-raised overflow-hidden"
      onMouseDown={(e) => e.preventDefault()}  // keep focus on the textarea
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border text-[10px] text-muted-foreground">
        <Search size={10} />
        <span className="font-medium uppercase tracking-wider">Skills</span>
        {query && <span className="font-mono normal-case truncate">/{query}</span>}
        <div className="flex-1" />
      </div>

      <div ref={listRef} className="max-h-64 overflow-y-auto">
        {!loading && filtered.length === 0 ? (
          <div className="flex items-center gap-1.5 px-2 py-3 text-xs text-muted-foreground italic">
            <Slash size={12} />
            {query ? `No skills matching "${query}"` : 'No skills in this workspace yet'}
          </div>
        ) : (
          filtered.map((skill, i) => (
            <button
              key={skill.id}
              type="button"
              data-idx={i}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => onSelect(skill)}
              className={clsx(
                'w-full flex items-start gap-2 px-2 py-1.5 text-left transition-colors',
                i === highlight ? 'bg-primary/15' : 'hover:bg-muted'
              )}
            >
              <Sparkles size={12} className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-foreground truncate" title={skill.name}>
                  {skill.name}
                </div>
                {skill.description && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    {skill.description}
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground/70 font-mono">
        ↑↓ navigate · ⏎ select · esc close
      </div>
    </div>
  )
}

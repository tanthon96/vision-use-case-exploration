import { useState } from 'react'
import { Plus, Edit2, Trash2, CheckCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useSkills } from '../../hooks/useSkills'
import { SkillEditor } from './SkillEditor'
import type { PersistedSkill } from '../../types'

export function SkillsPanel() {
  const { skills, activeSkill, setActiveSkill, deleteSkill, loading } = useSkills()
  const [editing, setEditing] = useState<PersistedSkill | null | 'new'>(null)

  const handleDelete = async (skill: PersistedSkill) => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return
    await deleteSkill(skill.id)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Skills
        </span>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <Plus size={11} /> New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <button
          onClick={() => setActiveSkill(null)}
          className={clsx(
            'w-full text-left px-2 py-1.5 rounded-soft text-xs font-mono transition-colors',
            !activeSkill
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/60'
          )}
        >
          — no skill —
        </button>

        {loading ? (
          <p className="text-xs text-muted-foreground px-2">Loading…</p>
        ) : (
          skills.map((skill) => (
            <div
              key={skill.id}
              onClick={() => setActiveSkill(skill)}
              className={clsx(
                'group flex items-start gap-1.5 px-2 py-1.5 rounded-soft cursor-pointer transition-colors',
                activeSkill?.id === skill.id
                  ? 'bg-primary/10 border border-primary/30'
                  : 'hover:bg-muted'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono text-foreground truncate">{skill.name}</span>
                  {activeSkill?.id === skill.id && (
                    <CheckCircle size={10} className="text-primary shrink-0" />
                  )}
                </div>
                {skill.description && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{skill.description}</p>
                )}
              </div>

              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(skill) }}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-sharp"
                  title="Edit"
                >
                  <Edit2 size={11} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(skill) }}
                  className="p-1 text-muted-foreground hover:text-danger rounded-sharp"
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editing !== null && (
        <SkillEditor
          skill={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

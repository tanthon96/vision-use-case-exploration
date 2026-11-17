import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useSkillsStore } from '../../stores/skillsStore'
import type { PersistedSkill, FewShotExample, SkillReference } from '../../types'

type EditableSkill = Omit<PersistedSkill, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>

interface Props {
  skill: PersistedSkill | null
  onClose: () => void
}

const EMPTY_SKILL: EditableSkill = {
  name: '',
  description: '',
  system_prompt: '',
  task_template: '{{ user_instruction }}',
  metrics: ['latency', 'token_count'],
  few_shot_examples: [],
  references: [],
  postprocess: {},
}

export function SkillEditor({ skill, onClose }: Props) {
  const { saveSkill } = useSkillsStore()
  const [form, setForm] = useState<EditableSkill>(
    skill
      ? {
          name: skill.name,
          description: skill.description,
          system_prompt: skill.system_prompt,
          task_template: skill.task_template,
          metrics: skill.metrics,
          few_shot_examples: skill.few_shot_examples,
          references: skill.references ?? [],
          postprocess: skill.postprocess ?? {},
        }
      : EMPTY_SKILL
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isNew = !skill

  const set = <K extends keyof EditableSkill>(k: K, v: EditableSkill[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const addExample = () =>
    set('few_shot_examples', [...form.few_shot_examples, { prompt: '', expected: '' }])

  const updateExample = (i: number, patch: Partial<FewShotExample>) =>
    set('few_shot_examples', form.few_shot_examples.map((ex, idx) =>
      idx === i ? { ...ex, ...patch } : ex
    ))

  const removeExample = (i: number) =>
    set('few_shot_examples', form.few_shot_examples.filter((_, idx) => idx !== i))

  const addReference = () =>
    set('references', [...form.references, { name: '', content: '' }])

  const updateReference = (i: number, patch: Partial<SkillReference>) =>
    set('references', form.references.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const removeReference = (i: number) =>
    set('references', form.references.filter((_, idx) => idx !== i))

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    try {
      await saveSkill(form, skill?.id)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border rounded-cushion shadow-raised w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {isNew ? 'New skill' : <>Edit: <span className="font-mono text-primary">{skill!.name}</span></>}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-sharp">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-soft px-2 py-1">
              {error}
            </p>
          )}

          <Field label="Name *">
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="input-sm font-mono"
              placeholder="ocr_extraction"
            />
          </Field>

          <Field label="Description">
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="input-sm"
              placeholder="Short description shown in the panel"
            />
          </Field>

          <Field label="System prompt">
            <textarea
              value={form.system_prompt}
              onChange={(e) => set('system_prompt', e.target.value)}
              rows={4}
              className="input-sm font-mono text-xs resize-y"
              placeholder="You are a precise OCR engine…"
            />
          </Field>

          <Field label="Task template" hint="Use {{ user_instruction }} to insert the user's text">
            <textarea
              value={form.task_template}
              onChange={(e) => set('task_template', e.target.value)}
              rows={3}
              className="input-sm font-mono text-xs resize-y"
            />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Few-shot examples
              </label>
              <button
                onClick={addExample}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Plus size={12} /> Add example
              </button>
            </div>
            <div className="space-y-3">
              {form.few_shot_examples.map((ex, i) => (
                <div key={i} className="bg-muted/40 border border-border rounded-soft p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground font-mono">#{i + 1}</span>
                    <button
                      onClick={() => removeExample(i)}
                      className="text-muted-foreground hover:text-danger"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">User prompt</label>
                    <input
                      value={ex.prompt}
                      onChange={(e) => updateExample(i, { prompt: e.target.value })}
                      className="input-sm"
                      placeholder="What text is in this image?"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Expected response</label>
                    <textarea
                      value={ex.expected}
                      onChange={(e) => updateExample(i, { expected: e.target.value })}
                      rows={2}
                      className="input-sm font-mono text-xs resize-y"
                      placeholder="STOP&#10;ALL WAY"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                References
              </label>
              <button
                onClick={addReference}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Plus size={12} /> Add reference
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/70 mb-2">
              Reference docs are appended to the system prompt under a “References” section at run time.
            </p>
            <div className="space-y-3">
              {form.references.map((ref, i) => (
                <div key={i} className="bg-muted/40 border border-border rounded-soft p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={ref.name}
                      onChange={(e) => updateReference(i, { name: e.target.value })}
                      className="input-sm font-mono flex-1"
                      placeholder="columns.md"
                    />
                    <button
                      onClick={() => removeReference(i)}
                      className="text-muted-foreground hover:text-danger"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <textarea
                    value={ref.content}
                    onChange={(e) => updateReference(i, { content: e.target.value })}
                    rows={4}
                    className="input-sm font-mono text-xs resize-y"
                    placeholder="Reference content (markdown, tables, controlled vocabularies…)"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-2">
              Post-process script
            </label>
            <p className="text-[10px] text-muted-foreground/70 mb-2">
              Runs on the model output after generation (reads it on stdin, writes cleaned output to
              stdout + a JSON report to stderr). Executed only when the server has script execution enabled.
            </p>
            <div className="bg-muted/40 border border-border rounded-soft p-3 space-y-2">
              <input
                value={form.postprocess.script_name ?? ''}
                onChange={(e) =>
                  set('postprocess', { ...form.postprocess, script_name: e.target.value })
                }
                className="input-sm font-mono"
                placeholder="validate_csv.py"
              />
              <textarea
                value={form.postprocess.script_source ?? ''}
                onChange={(e) =>
                  set('postprocess', { ...form.postprocess, script_source: e.target.value })
                }
                rows={5}
                className="input-sm font-mono text-xs resize-y"
                placeholder="#!/usr/bin/env python3&#10;import sys, json&#10;..."
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save skill'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
        {label}
        {hint && <span className="font-normal normal-case text-muted-foreground/70 ml-1">— {hint}</span>}
      </label>
      {children}
    </div>
  )
}

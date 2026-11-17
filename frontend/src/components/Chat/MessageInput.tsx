import { useCallback, useMemo, useRef, useState } from 'react'
import { Send, Square, Layers, Image as ImageIcon, AtSign, Sparkles, X } from 'lucide-react'
import { clsx } from 'clsx'
import { WorkspaceImagePicker } from './WorkspaceImagePicker'
import { SkillPicker } from './SkillPicker'
import { useSkillsStore } from '../../stores/skillsStore'
import type { WorkspaceImage, ImageInput, PersistedSkill } from '../../types'

interface Props {
  text: string
  onTextChange: (text: string) => void
  onSubmit: () => void
  onAbort: () => void
  isStreaming: boolean
  canSend: boolean
  batchSize: number
  panelImageCount: number
  /** Images tagged to this message (shown as removable chips over the input). */
  attachedImages: ImageInput[]
  onAttachImage: (img: WorkspaceImage) => void
  onRemoveAttached: (id: string) => void
}

interface MentionContext {
  /** Start index of the '@' character in the text. */
  start: number
  /** End index (exclusive) of the mention token in the text. */
  end: number
  /** What the user has typed after the '@'. */
  query: string
}

/**
 * Returns the active '@mention' context if the caret is currently inside one,
 * otherwise null. A mention starts with '@' that is either:
 *   - at the very start of the input, OR
 *   - preceded by whitespace
 * and continues until the next whitespace or end of input.
 */
function findMentionAt(text: string, caret: number): MentionContext | null {
  // Walk back from the caret looking for an '@' with the right prefix.
  let i = caret - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') {
      const before = i > 0 ? text[i - 1] : ''
      if (i === 0 || /\s/.test(before)) {
        // Find end (next whitespace at or after caret)
        let end = caret
        while (end < text.length && !/\s/.test(text[end])) end += 1
        return { start: i, end, query: text.slice(i + 1, caret) }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i -= 1
  }
  return null
}

interface SlashContext {
  /** End index (exclusive) of the command token in the text. */
  end: number
  /** What the user has typed after the leading '/'. */
  query: string
}

/**
 * Returns the active '/command' context if the caret is inside a slash command
 * at the very START of the input, otherwise null. Slash commands are a
 * whole-input affordance (like Slack/Discord): the '/' must be the first
 * character and the token runs until the first whitespace.
 */
function findSlashCommandAt(text: string, caret: number): SlashContext | null {
  if (text[0] !== '/') return null
  // The command token ends at the first whitespace.
  const wsIndex = text.search(/\s/)
  const end = wsIndex === -1 ? text.length : wsIndex
  // Caret must sit within the token (between the '/' and the first space).
  if (caret < 1 || caret > end) return null
  return { end, query: text.slice(1, caret) }
}

export function MessageInput({
  text, onTextChange, onSubmit, onAbort, isStreaming, canSend,
  batchSize, panelImageCount, attachedImages, onAttachImage, onRemoveAttached,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [pickerForced, setPickerForced] = useState(false)

  const activeSkill = useSkillsStore((s) => s.activeSkill)
  const setActiveSkill = useSkillsStore((s) => s.setActiveSkill)

  const mention = useMemo(() => findMentionAt(text, caret), [text, caret])
  const slash = useMemo(() => findSlashCommandAt(text, caret), [text, caret])
  const skillPickerOpen = slash !== null
  const pickerOpen = (mention !== null || pickerForced) && !skillPickerOpen

  // Once the user drags the resize grip we stop auto-growing so we don't
  // fight their chosen height.
  const manuallyResizedRef = useRef(false)

  // Auto-grow (until manually resized) + caret-position sync
  const onTextareaInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (!manuallyResizedRef.current) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 240) + 'px'
    }
    setCaret(el.selectionStart)
  }, [])

  // Detect a drag on the bottom-right resize grip so auto-grow yields to it.
  const onTextareaMouseDown = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const nearGrip = r.right - e.clientX < 18 && r.bottom - e.clientY < 18
    if (nearGrip) manuallyResizedRef.current = true
  }, [])

  const onTextareaSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Either picker swallows arrow keys + Enter (they handle those globally)
    if ((pickerOpen || skillPickerOpen) && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Escape')) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      if (canSend) onSubmit()
    }
  }

  const handlePicked = useCallback(
    (img: WorkspaceImage) => {
      // 1. Tag the image to this message (only tagged images are sent).
      onAttachImage(img)

      // 2. Replace the '@query' token in the text with nothing (Slack-style)
      if (mention) {
        const next = text.slice(0, mention.start) + text.slice(mention.end)
        onTextChange(next)
        // Move caret to where the '@' was
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (el) {
            el.selectionStart = el.selectionEnd = mention.start
            el.focus()
          }
        })
      } else if (pickerForced) {
        setPickerForced(false)
        textareaRef.current?.focus()
      }
    },
    [onAttachImage, mention, pickerForced, onTextChange, text]
  )

  const closePicker = useCallback(() => {
    setPickerForced(false)
    // Move caret past the '@' so findMentionAt returns null and the popover closes
    if (mention) {
      const el = textareaRef.current
      if (el) {
        // Type a space after '@' so it no longer looks like a mention
        const next = text.slice(0, mention.start + 1) + ' ' + text.slice(mention.start + 1)
        onTextChange(next)
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = mention.start + 2
        })
      }
    }
  }, [mention, onTextChange, text])

  const handleSkillPicked = useCallback(
    (skill: PersistedSkill) => {
      setActiveSkill(skill)
      // Strip the leading '/command' token from the input — it's a command,
      // not message content. Preserve anything the user typed after it.
      if (slash) {
        const next = text.slice(slash.end).replace(/^\s+/, '')
        onTextChange(next)
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (el) {
            el.selectionStart = el.selectionEnd = 0
            el.focus()
          }
        })
      }
    },
    [setActiveSkill, slash, text, onTextChange]
  )

  const closeSkillPicker = useCallback(() => {
    // Insert a space after the leading '/' so it no longer parses as a command.
    if (slash) {
      const el = textareaRef.current
      const next = '/ ' + text.slice(1)
      onTextChange(next)
      requestAnimationFrame(() => {
        if (el) el.selectionStart = el.selectionEnd = 2
      })
    }
  }, [slash, text, onTextChange])

  const sourceLabel = batchSize > 0
    ? `${batchSize} buffered frame${batchSize !== 1 ? 's' : ''}`
    : attachedImages.length > 0
      ? `${attachedImages.length} image${attachedImages.length !== 1 ? 's' : ''} tagged`
      : panelImageCount > 0
        ? `${panelImageCount} canvas image${panelImageCount !== 1 ? 's' : ''}`
        : 'no image attached'

  return (
    <div className="border-t border-border bg-surface px-3 py-2 shrink-0 relative">
      {pickerOpen && (
        <WorkspaceImagePicker
          query={mention?.query ?? ''}
          onSelect={handlePicked}
          onClose={closePicker}
        />
      )}

      {skillPickerOpen && (
        <SkillPicker
          query={slash?.query ?? ''}
          onSelect={handleSkillPicked}
          onClose={closeSkillPicker}
        />
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {batchSize > 0 ? (
              <Layers size={10} className="text-primary" />
            ) : (
              <ImageIcon size={10} />
            )}
            <span className={clsx(batchSize > 0 && 'text-primary font-medium')}>
              {sourceLabel}
            </span>
            {activeSkill && (
              <span
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-sharp bg-primary/15 text-primary"
                title={activeSkill.description || activeSkill.name}
              >
                <Sparkles size={9} />
                <span className="font-medium">{activeSkill.name}</span>
                <button
                  type="button"
                  onClick={() => setActiveSkill(null)}
                  className="hover:text-foreground"
                  title="Clear active skill"
                >
                  <X size={9} />
                </button>
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                setPickerForced((v) => !v)
                textareaRef.current?.focus()
              }}
              className={clsx(
                'inline-flex items-center gap-0.5 px-1 py-0.5 rounded-sharp transition-colors',
                pickerForced
                  ? 'bg-primary/15 text-primary'
                  : 'hover:bg-muted hover:text-foreground'
              )}
              title="Pick from workspace images"
            >
              <AtSign size={10} />
            </button>
          </div>

          {/* Tagged images — the subset this message will actually use. */}
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {attachedImages.map((img) => (
                <span
                  key={img.id}
                  className="inline-flex items-center gap-1 pl-0.5 pr-1 py-0.5 rounded-sharp bg-primary/15 text-primary text-[11px]"
                  title={img.name}
                >
                  {img.preview && (
                    <img src={img.preview} alt="" className="h-4 w-4 rounded-sharp object-cover" />
                  )}
                  <span className="font-mono max-w-[140px] truncate">{img.name}</span>
                  <button
                    type="button"
                    onClick={() => img.id && onRemoveAttached(img.id)}
                    className="hover:text-foreground"
                    title="Remove image from this message"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onSelect={onTextareaSelect}
            onClick={onTextareaSelect}
            onKeyUp={onTextareaSelect}
            onInput={onTextareaInput}
            onMouseDown={onTextareaMouseDown}
            placeholder="Ask about the image(s)…  '/' for skills · '@' for workspace images. ⏎ to send, ⇧⏎ for newline. Drag the corner to resize."
            rows={4}
            disabled={isStreaming}
            className={clsx(
              'resize-y bg-surface-raised border border-border rounded-soft px-3 py-2',
              'text-sm text-foreground placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-1 focus:ring-primary',
              'min-h-[120px] max-h-[60vh] overflow-y-auto',
              isStreaming && 'opacity-50 cursor-not-allowed'
            )}
          />
        </div>

        <button
          onClick={isStreaming ? onAbort : onSubmit}
          disabled={!isStreaming && !canSend}
          className={clsx(
            'h-10 w-10 rounded-cushion inline-flex items-center justify-center shrink-0 transition-colors shadow-soft',
            isStreaming
              ? 'bg-danger text-white hover:opacity-90'
              : 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed'
          )}
          title={isStreaming ? 'Stop' : 'Send (Enter)'}
        >
          {isStreaming ? <Square size={14} /> : <Send size={14} />}
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { clsx } from 'clsx'
import {
  Layers, Loader2, Sparkles, Cpu, CheckCircle2, AlertCircle, FileText,
  Brain, ChevronRight,
} from 'lucide-react'
import type { ChatMessage, ChatStep } from '../../types'
import { MessageMarkdown } from './MessageMarkdown'

interface Props {
  message: ChatMessage
}

export function StreamingMessage({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={clsx('flex gap-3 py-3 px-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={clsx(
          'h-7 w-7 rounded-cushion flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5 shadow-soft',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        )}
      >
        {isUser ? 'U' : providerInitial(message.modelProvider)}
      </div>

      <div className={clsx('max-w-[80%] min-w-0 flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
        {/* Thumbnail strip — compact, since the canvas is the main view */}
        {message.images && message.images.length > 0 && (
          <div className="flex items-center gap-1 mb-1">
            {message.images.length > 1 && (
              <span className="chip">
                <Layers size={9} />
                {message.images.length} frames
              </span>
            )}
            <div className="flex -space-x-1">
              {message.images.slice(0, 4).map((img) => (
                <img
                  key={img.name}
                  src={img.preview ?? `data:image/jpeg;base64,${img.data}`}
                  alt={img.name}
                  className="h-8 w-8 object-cover rounded-soft border-2 border-surface"
                />
              ))}
              {message.images.length > 4 && (
                <div className="h-8 w-8 rounded-soft border-2 border-surface bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-mono">
                  +{message.images.length - 4}
                </div>
              )}
            </div>
          </div>
        )}

        {message.skillName && message.skillName !== 'none' && (
          <span className="text-[10px] text-accent font-mono">
            /{message.skillName}
          </span>
        )}

        <div
          className={clsx(
            // min-w-0 lets this flex item shrink below its content width so a
            // wide child (e.g. a CSV table) scrolls *inside itself* instead of
            // pushing the whole conversation into a horizontal scroll.
            'px-3 py-2 shadow-soft min-w-0 max-w-full',
            isUser
              ? 'bg-primary text-primary-foreground rounded-l-cushion rounded-tr-cushion rounded-br-sharp'
              : 'bg-surface-raised text-foreground rounded-r-cushion rounded-tl-cushion rounded-bl-sharp border border-border',
            message.error && '!border-danger/50'
          )}
        >
          {/* Execution steps — skill/tool invocations, post-processing, saved
              files — so there's visible progress instead of a blank bubble. */}
          {!isUser && !message.error && message.steps && message.steps.length > 0 && (
            <StepList steps={message.steps} />
          )}

          {/* Extended-thinking trace — collapsible, like Claude/Gemini. Auto-open
              while it's the only thing streaming so the user sees live progress. */}
          {!isUser && !message.error && message.thinking && (
            <ThinkingBlock
              thinking={message.thinking}
              streaming={message.streaming && !message.content}
            />
          )}

          {message.error ? (
            <span className="text-sm text-danger">{message.error}</span>
          ) : isUser ? (
            // User messages render as plain text — paste-friendly, no surprise formatting
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {message.content || <span className="italic opacity-70">(empty)</span>}
            </p>
          ) : message.content ? (
            <MessageMarkdown
              content={message.content}
              streaming={message.streaming}
              variant="assistant"
            />
          ) : message.streaming ? (
            // Streaming but no tokens yet: steps / thinking (above) carry the
            // progress; show a subtle working indicator only when neither is present.
            (!message.steps || message.steps.length === 0) && !message.thinking && (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Working…
              </span>
            )
          ) : (
            <span className="text-sm italic text-muted-foreground">(empty)</span>
          )}
        </div>

        {message.metrics && !message.streaming && (
          <div className="flex gap-2 text-[10px] text-muted-foreground font-mono tabular-nums">
            <span>{Math.round(message.metrics.latency_ms)}ms</span>
            {message.metrics.prompt_tokens > 0 && (
              <span>{message.metrics.prompt_tokens}↑ {message.metrics.completion_tokens}↓</span>
            )}
            {message.thinkingEffort && (
              <span className="text-accent" title="Extended-thinking effort used">
                think:{message.thinkingEffort}
              </span>
            )}
            {message.modelId && <span className="opacity-70">{message.modelId}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBlock({ thinking, streaming }: { thinking: string; streaming?: boolean }) {
  // Open by default while the model is still only thinking (no answer yet);
  // once the answer streams the user can reopen to inspect the reasoning.
  const [open, setOpen] = useState(!!streaming)

  return (
    <div className="mb-1.5 rounded-soft border border-border/60 bg-foreground/[0.03] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          size={11}
          className={clsx('shrink-0 transition-transform', open && 'rotate-90')}
        />
        <Brain size={11} className="shrink-0 text-accent" />
        <span className="font-mono">
          {streaming ? 'Thinking…' : 'Thought process'}
        </span>
        {streaming && <Loader2 size={10} className="animate-spin ml-0.5" />}
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 border-t border-border/50 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  )
}

function StepList({ steps }: { steps: ChatStep[] }) {
  return (
    <div className="mb-1.5 flex flex-col gap-1 border-b border-border/60 pb-1.5">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StepIcon step={step} />
          <span className="font-mono truncate" title={step.label}>{step.label}</span>
        </div>
      ))}
    </div>
  )
}

function StepIcon({ step }: { step: ChatStep }) {
  const cls = 'shrink-0'
  switch (step.kind) {
    case 'skill': return <Sparkles size={11} className={clsx(cls, 'text-primary')} />
    case 'model': return <Cpu size={11} className={clsx(cls, 'text-accent')} />
    case 'files': return <FileText size={11} className={cls} />
    case 'postprocess':
      return step.status === 'error'
        ? <AlertCircle size={11} className={clsx(cls, 'text-danger')} />
        : <CheckCircle2 size={11} className={clsx(cls, 'text-emerald-600')} />
    default: return <Layers size={11} className={cls} />
  }
}

function providerInitial(provider?: string) {
  switch (provider) {
    case 'anthropic': return 'C'
    case 'gemini': return 'G'
    case 'bedrock': return 'A'
    case 'ollama': return 'O'
    default: return '?'
  }
}

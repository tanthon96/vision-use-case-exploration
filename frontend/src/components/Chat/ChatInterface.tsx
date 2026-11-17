import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { BatchIndicator } from './BatchIndicator'
import { useChatStore } from '../../stores/chatStore'
import { useBenchmarkStore } from '../../stores/benchmarkStore'
import { useSkillsStore } from '../../stores/skillsStore'
import { useImagePanelStore } from '../../stores/imagePanelStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useChatHistoryStore } from '../../stores/chatHistoryStore'
import { useSSE } from '../../hooks/useSSE'
import { api, ApiError } from '../../api/client'
import { bakeImageWithAnnotations } from '../ImagePanel/AnnotationCanvas'
import type { Annotation, ChatMessage, ImageInput, PersistedMessage, WorkspaceImage } from '../../types'

function uid() {
  return Math.random().toString(36).slice(2, 11)
}

/**
 * Convert a server-side PersistedMessage into the local ChatMessage shape
 * the renderer already understands.
 */
function persistedToLocal(m: PersistedMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role === 'system' ? 'assistant' : m.role,
    content: m.content_md,
    thinking: m.thinking_md || undefined,
    thinkingEffort: m.thinking_effort || undefined,
    images: m.images.map((mi): ImageInput => ({
      id: mi.image_id,
      data: '',
      name: mi.original_name || mi.image_id.slice(0, 8),
      preview: mi.presigned_url,
      sha256: mi.sha256,
      annotations: mi.annotations,
    })),
    skillName: m.skill_name ?? undefined,
    modelProvider: m.model_provider ?? undefined,
    modelId: m.model_id ?? undefined,
    metrics: m.latency_ms !== null
      ? {
          latency_ms: m.latency_ms,
          prompt_tokens: m.prompt_tokens,
          completion_tokens: m.completion_tokens,
        }
      : undefined,
    error: m.error || undefined,
    streaming: false,
  }
}

export function ChatInterface() {
  const {
    messages, isStreaming, addMessage, appendToken, setContent, appendThinking, appendStep, finalizeMessage,
    setStreaming, batchedFrames, batchWindowMs, batchStartedAt,
    takeBatch, clearBatch, clearMessages,
  } = useChatStore()
  const { selectedProvider, selectedModelId, thinkingEffort, credentials } = useBenchmarkStore()
  const { activeSkill } = useSkillsStore()
  const panelImages = useImagePanelStore((s) => s.images)
  const workspaceId = useWorkspaceStore((s) => s.currentId)
  const activeChatId = useChatHistoryStore((s) => s.activeChatId)
  const selectChat = useChatHistoryStore((s) => s.selectChat)
  const loadMessages = useChatHistoryStore((s) => s.loadMessages)
  const loadChats = useChatHistoryStore((s) => s.loadChats)
  const { stream, abort } = useSSE()

  const [text, setText] = useState('')
  const [hydrationError, setHydrationError] = useState<string | null>(null)
  const [sendNotice, setSendNotice] = useState<string | null>(null)
  // Images explicitly tagged (via '@') to the message being composed. When set,
  // only these are sent — letting the user pick a subset instead of every
  // canvas image. Falls back to the canvas images when nothing is tagged.
  const [attached, setAttached] = useState<ImageInput[]>([])

  const attachImage = useCallback((img: WorkspaceImage) => {
    setAttached((cur) =>
      cur.some((i) => i.id === img.id)
        ? cur
        : [...cur, {
            id: img.id,
            data: '',
            rawData: '',
            name: img.original_name || img.id.slice(0, 8),
            preview: img.presigned_url,
            sha256: img.sha256,
            source: (img.source === 'webcam' || img.source === 'screen') ? img.source : 'upload',
            capturedAt: Date.now(),
          }]
    )
  }, [])

  const removeAttached = useCallback(
    (id: string) => setAttached((cur) => cur.filter((i) => i.id !== id)),
    []
  )
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Hydrate messages from the server whenever the active chat changes ────
  useEffect(() => {
    let cancelled = false
    setHydrationError(null)
    if (!activeChatId) {
      clearMessages()
      return
    }
    ;(async () => {
      try {
        const persisted = await loadMessages(activeChatId)
        if (cancelled) return
        clearMessages()
        for (const m of persisted) addMessage(persistedToLocal(m))
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof ApiError ? err.body || err.message : String(err)
        setHydrationError(msg)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId])

  // ── Send (manual or auto-flush) ──────────────────────────────────────────
  const runBatch = useCallback(async (images: ImageInput[], userText: string) => {
    if (!workspaceId) {
      console.warn('Cannot send: no workspace selected')
      return
    }
    if (images.length === 0 && !userText.trim()) return

    // Local-only mirror of the user turn (instant feedback). We'll patch
    // the message with the baked thumbnails below, once the bake completes.
    const userMsgId = uid()
    addMessage({
      id: userMsgId, role: 'user', content: userText,
      images, skillName: activeSkill?.name,
    })

    // Effective thinking effort for this run (Claude thinking models only) — for
    // the live chip; the server persists the authoritative value.
    const bModels = useBenchmarkStore.getState().models
    const selModel = bModels.find(
      (m) => m.provider === selectedProvider && m.model_id === selectedModelId
    )
    const effEffort =
      selectedProvider === 'anthropic' && selModel?.supports_thinking
        ? (thinkingEffort || 'low')
        : ''

    const asstMsgId = uid()
    addMessage({
      id: asstMsgId, role: 'assistant', content: '', streaming: true,
      modelProvider: selectedProvider, modelId: selectedModelId,
      skillName: activeSkill?.name,
      thinkingEffort: effEffort || undefined,
    })

    setStreaming(true)

    // Wait for any pending image uploads to land their ids on the store.
    // If a frame is still uploading we drop it from this batch — tell the user
    // so a missing frame isn't a silent surprise.
    const readyImages = images.filter((i) => i.id)
    const dropped = images.length - readyImages.length
    setSendNotice(
      dropped > 0
        ? `${dropped} image${dropped > 1 ? 's were' : ' was'} still uploading and left out of this message — resend once uploads finish.`
        : null
    )

    // For every image with annotations, bake them into a NEW workspace
    // image so the model actually sees the highlights. This is the fix
    // for the previously-reported bug where the model would respond that
    // there was no red box despite the user drawing one.
    const panelState = useImagePanelStore.getState()
    const bakedImages = await Promise.all(
      readyImages.map(async (img) => {
        const anns: Annotation[] = panelState.annotations[img.name] ?? []
        if (anns.length === 0) return img
        try {
          const dims = panelState.canvasDims[img.name] ?? { w: 0, h: 0 }
          const url = img.preview ?? `data:image/jpeg;base64,${img.rawData ?? img.data}`
          const blob = await bakeImageWithAnnotations(url, anns, dims.w, dims.h)
          if (!blob) return img
          const stem = img.name.replace(/\.[^/.]+$/, '')
          const filename = `${stem}_annotated_${Date.now()}.jpg`
          const uploaded = await api.images.upload(workspaceId, blob, {
            name: filename,
            source: img.source === 'webcam' || img.source === 'screen'
              ? img.source : 'upload',
          })
          // Return a new ImageInput referencing the baked workspace image
          return {
            ...img,
            id: uploaded.id,
            name: uploaded.original_name || filename,
            preview: uploaded.presigned_url,
            sha256: uploaded.sha256,
          } as ImageInput
        } catch (err) {
          console.warn('Annotation bake failed for', img.name, err)
          return img
        }
      })
    )

    const req = {
      workspace_id: workspaceId,
      chat_id: activeChatId,
      provider: selectedProvider,
      model_id: selectedModelId,
      skill_id: activeSkill?.id ?? null,
      user_instruction: userText,
      thinking_effort: thinkingEffort,
      // The annotations have already been burned INTO the image bytes via
      // bakeImageWithAnnotations above, so we don't pass them again here.
      // We still keep the annotations field on the request for forward
      // compat — the backend stores them on message_images for replay.
      // Dedupe by image_id: the same workspace image can appear more than once
      // on the canvas (e.g. also @-picked), and the backend rejects a request
      // that references an id it can only resolve once.
      images: Array.from(
        bakedImages
          .reduce((m, i, idx) => {
            if (i.id && !m.has(i.id)) {
              m.set(i.id, {
                image_id: i.id,
                annotations: panelState.annotations[readyImages[idx]?.name ?? ''] ?? [],
              })
            }
            return m
          }, new Map<string, { image_id: string; annotations: Annotation[] }>())
          .values()
      ),
      api_key: pickApiKey(selectedProvider, credentials),
      aws_access_key_id: credentials.aws_access_key_id,
      aws_secret_access_key: credentials.aws_secret_access_key,
      aws_region: credentials.aws_region,
      ollama_base_url: credentials.ollama_base_url,
    }

    let finalMetrics: ChatMessage['metrics']
    let errorMsg: string | undefined
    let serverChatId: string | undefined

    await stream(api.benchmark.stream(req), (event) => {
      if (event.type === 'start' && (event as any).chat_id) {
        serverChatId = (event as any).chat_id
      } else if (event.type === 'token' && event.content) {
        appendToken(asstMsgId, event.content)
      } else if (event.type === 'thinking' && event.content) {
        appendThinking(asstMsgId, event.content)
      } else if (event.type === 'replace_content' && typeof event.content === 'string') {
        // Backend converted the model's JSON rows into aligned CSV — swap the
        // streamed JSON for the final CSV so the table renders correctly.
        setContent(asstMsgId, event.content)
      } else if (event.type === 'metrics') {
        finalMetrics = {
          latency_ms: event.latency_ms ?? 0,
          prompt_tokens: event.prompt_tokens ?? 0,
          completion_tokens: event.completion_tokens ?? 0,
        }
      } else if (event.type === 'step') {
        appendStep(asstMsgId, {
          kind: (event.kind as 'skill' | 'model') ?? 'model',
          label: event.label ?? '',
        })
      } else if (event.type === 'postprocess') {
        appendStep(asstMsgId, {
          kind: 'postprocess',
          label: event.ok ? 'Post-processed output' : 'Post-process failed',
          status: event.ok ? 'ok' : 'error',
        })
      } else if (event.type === 'files_saved') {
        // Model auto-saved CSV(s) to the workspace — refresh the Files section.
        useLibraryStore.getState().bump()
        const names = (event.files ?? []).map((f) => f.name).join(', ')
        appendStep(asstMsgId, { kind: 'files', label: names ? `Saved ${names}` : 'Saved file(s)' })
      } else if (event.type === 'error') {
        errorMsg = event.message
      }
    })

    finalizeMessage(asstMsgId, finalMetrics, errorMsg)
    setStreaming(false)
    // Catch anything else that changed the library this run (e.g. annotated
    // images uploaded during send).
    useLibraryStore.getState().bump()

    // Adopt the server-assigned chat id so subsequent turns extend the same chat.
    if (serverChatId && !activeChatId) {
      selectChat(serverChatId)
    }
    // Refresh the sidebar listing so the new/updated chat surfaces.
    loadChats().catch(console.error)
  }, [
    workspaceId, activeChatId, activeSkill, selectedProvider, selectedModelId, thinkingEffort, credentials,
    addMessage, appendToken, setContent, appendThinking, appendStep, finalizeMessage, setStreaming, stream,
    selectChat, loadChats,
  ])

  // ── Auto-flush timer for the batch buffer ────────────────────────────────
  useEffect(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    if (batchedFrames.length === 0 || batchStartedAt === null || isStreaming) return
    const elapsed = Date.now() - batchStartedAt
    const remaining = Math.max(0, batchWindowMs - elapsed)
    flushTimerRef.current = setTimeout(() => {
      const frames = takeBatch()
      if (frames.length > 0) runBatch(frames, text)
    }, remaining)
    return () => { if (flushTimerRef.current) clearTimeout(flushTimerRef.current) }
  }, [batchedFrames.length, batchStartedAt, batchWindowMs, isStreaming, runBatch, takeBatch, text])

  const handleManualSend = useCallback(() => {
    if (isStreaming) return
    const buffered = takeBatch()
    // Precedence: buffered capture frames → explicitly tagged images → all
    // canvas images. Tagged images let the user scope a task to a subset.
    const imagesToSend =
      buffered.length > 0 ? buffered : attached.length > 0 ? attached : panelImages
    runBatch(imagesToSend, text)
    setText('')
    setAttached([])
  }, [isStreaming, takeBatch, attached, panelImages, runBatch, text])

  const handleAbort = useCallback(() => {
    abort()
    setStreaming(false)
  }, [abort, setStreaming])

  const hasInputs =
    batchedFrames.length > 0 || attached.length > 0 || panelImages.length > 0 || text.trim().length > 0

  const flushIn = useMemo(() => {
    if (batchStartedAt === null) return null
    return Math.max(0, batchWindowMs - (Date.now() - batchStartedAt))
  }, [batchStartedAt, batchWindowMs, batchedFrames.length])

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Conversation
          </h2>
          {messages.length > 0 && (
            <span className="chip">{(messages.length / 2) | 0} turns</span>
          )}
        </div>
        {batchedFrames.length > 0 && (
          <BatchIndicator
            count={batchedFrames.length}
            flushInMs={flushIn}
            windowMs={batchWindowMs}
            onFlushNow={handleManualSend}
            onClear={clearBatch}
            disabled={isStreaming}
          />
        )}
      </div>

      {hydrationError && (
        <div className="bg-danger/10 border-b border-danger/30 px-3 py-1.5 text-xs text-danger">
          Failed to load chat: {hydrationError}
        </div>
      )}

      {sendNotice && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-3 py-1.5 text-xs text-amber-600 flex items-center justify-between gap-2">
          <span>{sendNotice}</span>
          <button
            type="button"
            onClick={() => setSendNotice(null)}
            className="opacity-60 hover:opacity-100 shrink-0"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <MessageList messages={messages} />

      <MessageInput
        text={text}
        onTextChange={setText}
        onSubmit={handleManualSend}
        onAbort={handleAbort}
        isStreaming={isStreaming}
        canSend={hasInputs && !isStreaming && !!workspaceId}
        batchSize={batchedFrames.length}
        panelImageCount={panelImages.length}
        attachedImages={attached}
        onAttachImage={attachImage}
        onRemoveAttached={removeAttached}
      />
    </div>
  )
}


function pickApiKey(provider: string, creds: {
  anthropic_api_key: string
  google_api_key: string
}): string {
  // Provider-aware key selection (fixes earlier bug where keys could mix).
  switch (provider) {
    case 'anthropic': return creds.anthropic_api_key
    case 'gemini': return creds.google_api_key
    default: return ''
  }
}

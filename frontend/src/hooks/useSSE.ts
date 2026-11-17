import { useCallback, useRef } from 'react'
import type { SSEEvent } from '../types'

type Handler = (event: SSEEvent) => void

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null)

  const stream = useCallback(async (fetchPromise: Promise<Response>, onEvent: Handler) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const res = await fetchPromise
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => 'Unknown error')
      onEvent({ type: 'error', message: text })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as SSEEvent
              onEvent(event)
            } catch {
              // ignore malformed lines
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        onEvent({ type: 'error', message: err.message })
      }
    } finally {
      reader.releaseLock()
    }
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { stream, abort }
}

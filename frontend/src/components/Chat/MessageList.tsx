import { useEffect, useRef } from 'react'
import { StreamingMessage } from './StreamingMessage'
import type { ChatMessage } from '../../types'

interface Props {
  messages: ChatMessage[]
}

export function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground select-none px-6 py-12">
        <div className="text-center max-w-sm space-y-2">
          <p className="font-serif text-xl italic text-foreground">A quiet canvas.</p>
          <p className="text-sm leading-relaxed">
            Drop an image into the panel, pick a skill, and ask. Streamed batches will land here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {messages.map((msg) => (
        <StreamingMessage key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} className="h-2" />
    </div>
  )
}

import { memo, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { clsx } from 'clsx'
import { splitCsvSegments } from '../../lib/csv'
import { CsvBlock } from './CsvBlock'

interface Props {
  /** Markdown source. Streamed incrementally — incomplete syntax is gracefully rendered as text. */
  content: string
  /** When true, a blinking caret is appended to indicate streaming. */
  streaming?: boolean
  /** Visual variant. User bubbles get inverted contrast on links/code. */
  variant?: 'assistant' | 'user'
}

const COMPONENTS: Components = {
  // Headings — keep them readable but not screaming inside a chat bubble.
  h1: ({ children, ...p }) => (
    <h1 className="text-base font-semibold mt-3 mb-1.5 first:mt-0" {...p}>{children}</h1>
  ),
  h2: ({ children, ...p }) => (
    <h2 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0" {...p}>{children}</h2>
  ),
  h3: ({ children, ...p }) => (
    <h3 className="text-sm font-medium mt-2.5 mb-1 first:mt-0" {...p}>{children}</h3>
  ),
  h4: ({ children, ...p }) => (
    <h4 className="text-xs font-semibold uppercase tracking-wider mt-2.5 mb-1 first:mt-0" {...p}>{children}</h4>
  ),

  // Paragraphs — tight spacing inside a bubble.
  p: ({ children, ...p }) => (
    <p className="leading-relaxed first:mt-0 last:mb-0 my-1.5" {...p}>{children}</p>
  ),

  // Inline & block code.
  code: ({ className, children, ...p }) => {
    // react-markdown 9 no longer passes `inline` — detect by checking for language class
    const isBlock = /language-/.test(className ?? '')
    if (isBlock) {
      // pre wraps it — return the code element only; pre styling is below
      return <code className={clsx('font-mono text-[12.5px]', className)} {...p}>{children}</code>
    }
    return (
      <code
        className="font-mono text-[0.85em] px-1 py-px rounded-sharp bg-foreground/10 border border-foreground/10"
        {...p}
      >
        {children}
      </code>
    )
  },
  pre: ({ children, ...p }) => <CodeBlock {...p}>{children}</CodeBlock>,

  // Links — open in a new tab; keep them inline-readable.
  a: ({ children, href, ...p }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-current/40 hover:decoration-current underline-offset-2"
      {...p}
    >
      {children}
    </a>
  ),

  // Lists.
  ul: ({ children, ...p }) => (
    <ul className="list-disc pl-5 my-1.5 space-y-0.5" {...p}>{children}</ul>
  ),
  ol: ({ children, ...p }) => (
    <ol className="list-decimal pl-5 my-1.5 space-y-0.5" {...p}>{children}</ol>
  ),
  li: ({ children, ...p }) => <li className="leading-relaxed" {...p}>{children}</li>,

  // Blockquote.
  blockquote: ({ children, ...p }) => (
    <blockquote className="border-l-2 border-current/30 pl-3 my-2 italic opacity-90" {...p}>
      {children}
    </blockquote>
  ),

  // GFM table.
  table: ({ children, ...p }) => (
    <div className="overflow-x-auto my-2 rounded-soft border border-current/15">
      <table className="w-full text-xs border-collapse" {...p}>{children}</table>
    </div>
  ),
  thead: ({ children, ...p }) => (
    <thead className="bg-current/10 text-left" {...p}>{children}</thead>
  ),
  th: ({ children, ...p }) => (
    <th className="px-2 py-1 font-medium border-b border-current/15" {...p}>{children}</th>
  ),
  td: ({ children, ...p }) => (
    <td className="px-2 py-1 border-b border-current/10" {...p}>{children}</td>
  ),

  hr: () => <hr className="my-2 border-current/15" />,

  // Inline formatting.
  strong: ({ children, ...p }) => <strong className="font-semibold" {...p}>{children}</strong>,
  em: ({ children, ...p }) => <em className="italic" {...p}>{children}</em>,
  del: ({ children, ...p }) => <del className="line-through opacity-70" {...p}>{children}</del>,

  // Images (rare in model output but possible).
  img: ({ src, alt, ...p }) => (
    <img
      src={src}
      alt={alt}
      className="my-2 max-w-full rounded-soft border border-current/15"
      loading="lazy"
      {...p}
    />
  ),
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const text = extractText(children)
  const lang = extractLang(children)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  return (
    <div className="my-2 group relative rounded-soft border border-current/15 bg-foreground/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-current/10 text-[10px] uppercase tracking-wider text-current/60">
        <span className="font-mono">{lang || 'text'}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity"
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-[12.5px] leading-relaxed font-mono whitespace-pre">
        {children}
      </pre>
    </div>
  )
}

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return extractText((node as any).props?.children)
  }
  return ''
}

function extractLang(node: React.ReactNode): string {
  // The <pre> wraps a <code className="language-xyz">…</code>
  if (node && typeof node === 'object' && 'props' in node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cls = (node as any).props?.className ?? ''
    const m = /language-([\w-]+)/.exec(cls)
    if (m) return m[1]
  }
  if (Array.isArray(node)) {
    for (const n of node) {
      const l = extractLang(n)
      if (l) return l
    }
  }
  return ''
}

/**
 * Renders markdown chat content. Streaming-safe: incomplete fences/lists are
 * tolerated by remark, and a caret element is appended after the rendered tree.
 */
function MessageMarkdownInner({ content, streaming, variant = 'assistant' }: Props) {
  // Assistant responses may embed CSV (e.g. the promo-extraction skill emits raw
  // CSV). Split those regions out and render them as a downloadable table; the
  // rest stays markdown. User bubbles are always plain markdown.
  const segments = useMemo(
    () => (variant === 'assistant' ? splitCsvSegments(content) : null),
    [content, variant]
  )
  const hasCsv = segments?.some((s) => s.type === 'csv')

  return (
    <div
      className={clsx(
        'text-sm break-words',
        variant === 'user' && 'text-current'
      )}
    >
      {hasCsv && segments ? (
        segments.map((seg, i) =>
          seg.type === 'csv' ? (
            <CsvBlock key={i} text={seg.text} />
          ) : (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={COMPONENTS}>
              {seg.text}
            </ReactMarkdown>
          )
        )
      ) : (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
          {content}
        </ReactMarkdown>
      )}
      {streaming && (
        <span
          className="inline-block w-1.5 h-3.5 bg-current ml-0.5 animate-pulse align-middle rounded-sharp"
          aria-hidden
        />
      )}
    </div>
  )
}

// Memoise so token-by-token streaming only re-renders this subtree, not the
// whole MessageList.
export const MessageMarkdown = memo(MessageMarkdownInner)

import { useMemo, useState } from 'react'
import { Check, Copy, Download, Table2 } from 'lucide-react'
import { parseCsv } from '../../lib/csv'

interface Props {
  /** Raw CSV text — downloaded verbatim so nothing is re-serialised or altered. */
  text: string
}

/**
 * Renders a CSV region from a model response as a scrollable table with
 * Download (.csv) and Copy actions. The download preserves the original bytes.
 */
export function CsvBlock({ text }: Props) {
  const [copied, setCopied] = useState(false)
  const rows = useMemo(() => parseCsv(text), [text])

  if (rows.length === 0) return null
  const [header, ...body] = rows
  const cols = header.length

  const onDownload = () => {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestFilename(header, body)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  return (
    <div className="my-2 rounded-soft border border-current/15 bg-foreground/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-current/10 text-[10px] uppercase tracking-wider text-current/60">
        <span className="inline-flex items-center gap-1 font-mono">
          <Table2 size={11} />
          CSV · {body.length} {body.length === 1 ? 'row' : 'rows'} × {cols} cols
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity"
          >
            <Download size={10} />
            Download
          </button>
        </div>
      </div>
      {/* overflow-auto on both axes: vertical scroll for rows, horizontal for
          the (often many) columns. w-max lets the table exceed the container so
          the horizontal scrollbar appears instead of truncating columns. */}
      <div className="overflow-auto max-h-80">
        <table className="w-max min-w-full text-xs border-collapse">
          <thead className="text-left">
            <tr>
              {header.map((h, i) => (
                // Opaque sticky header (bg-surface-raised, not a translucent
                // tint) so scrolled rows don't bleed through it.
                <th
                  key={i}
                  className="sticky top-0 z-10 bg-surface-raised px-2 py-1 font-medium border-b border-current/20 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {header.map((_, c) => (
                  <td key={c} className="px-2 py-1 border-b border-current/10 whitespace-nowrap" title={row[c] ?? ''}>
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Prefer the "Source Photo" of the first row for a friendly filename. */
function suggestFilename(header: string[], body: string[][]): string {
  const idx = header.findIndex((h) => h.trim().toLowerCase() === 'source photo')
  if (idx >= 0 && body[0]?.[idx]) {
    const base = body[0][idx].replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')
    if (base) return `${base}.csv`
  }
  return 'export.csv'
}

/**
 * Minimal CSV handling for rendering model output as a downloadable table.
 * No dependency — a small RFC 4180-ish parser plus heuristics to locate CSV
 * regions inside an otherwise free-form assistant message.
 */

/** Parse a full CSV document into rows of string fields (quotes + escapes handled). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let started = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    started = true
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } // escaped quote
        else inQuotes = false
      } else {
        field += c
      }
      continue
    }
    if (c === '"') { inQuotes = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\r') continue
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += c
  }
  if (started && (field.length > 0 || row.length > 0)) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Count CSV fields in a single physical line. Commas are counted only at the
 * top level — inside quotes, `[...]`, or `{...}` they're ignored. This keeps
 * JSON lines (e.g. `{box_2d: [410, 350, 555], label: X}`) from being mistaken
 * for CSV rows: their structural commas are nested, so the line reads as a
 * single field and fails the CSV heuristic in findCsvRun.
 */
function countFields(line: string): number {
  let count = 1
  let inQuotes = false
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') i++
        else inQuotes = false
      }
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') { if (depth > 0) depth-- }
    else if (c === ',' && depth === 0) count++
  }
  return count
}

export type Segment = { type: 'md' | 'csv'; text: string }

/**
 * True when `line` looks like a CSV data row belonging to a table whose header
 * has `anchor` columns. Model-generated CSV is routinely ragged — an unquoted
 * comma inside a product name (`Milk 1 Litre (Full Cream, Low Fat)`) adds a
 * field, and trailing empties (`…,,` vs `…,`) vary row to row. Requiring an
 * exact field-count match fragments one table into a text/table split, so we
 * accept any row within a tolerance of the header width. `CsvBlock` pads or
 * truncates each row to the header column count at render time, so ragged rows
 * are handled gracefully downstream.
 */
function isTabularLine(line: string, anchor: number): boolean {
  const n = countFields(line)
  if (n < 3) return false
  const tol = Math.max(2, Math.round(anchor * 0.25))
  return Math.abs(n - anchor) <= tol
}

/**
 * A run of ≥2 adjacent non-empty lines with a consistent-ish field count looks
 * like CSV. Require ≥3 columns: two-column data is too easily confused with
 * prose or JSON array elements (which read as `object,` → 2 fields), and the
 * CSV output this renders (e.g. the promo skill) always has many columns.
 */
function findCsvRun(lines: string[]): { start: number; end: number } | null {
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue }
    const n = countFields(lines[i])
    if (n >= 3) {
      // The first line (typically the header) anchors the expected column
      // count; extend the run through ragged-but-tabular rows around it.
      let j = i + 1
      while (j < lines.length && lines[j].trim() !== '' && isTabularLine(lines[j], n)) j++
      // Prose guard: sentences also contain commas, but rows that mostly end in
      // sentence punctuation are prose ("…, eggs, and bread."), not CSV.
      const rows = lines.slice(i, j)
      const sentencey = rows.filter((r) => /[.!?]$/.test(r.trim())).length
      if (j - i >= 2 && sentencey <= rows.length / 2) return { start: i, end: j }
      i = j
    } else {
      i++
    }
  }
  return null
}

/** Split plain (non-fenced) text into interleaved markdown / CSV segments. */
function splitRaw(text: string): Segment[] {
  const lines = text.split('\n')
  const run = findCsvRun(lines)
  if (!run) return text.trim() ? [{ type: 'md', text }] : []

  const before = lines.slice(0, run.start).join('\n')
  const csv = lines.slice(run.start, run.end).join('\n')
  const after = lines.slice(run.end).join('\n')

  const out: Segment[] = []
  if (before.trim()) out.push({ type: 'md', text: before })
  out.push({ type: 'csv', text: csv })
  if (after.trim()) out.push(...splitRaw(after))
  return out
}

/**
 * Break an assistant message into markdown + CSV segments. Fenced ```csv blocks
 * are treated as CSV first; the remaining text is scanned for raw CSV tables.
 */
export function splitCsvSegments(content: string): Segment[] {
  const segments: Segment[] = []
  const fenceRe = /```csv[^\n]*\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(content)) !== null) {
    if (m.index > last) segments.push(...splitRaw(content.slice(last, m.index)))
    segments.push({ type: 'csv', text: m[1].replace(/\n$/, '') })
    last = fenceRe.lastIndex
  }
  if (last < content.length) segments.push(...splitRaw(content.slice(last)))
  return segments
}

/** True when the content contains at least one CSV segment worth rendering. */
export function hasCsv(content: string): boolean {
  return splitCsvSegments(content).some((s) => s.type === 'csv')
}

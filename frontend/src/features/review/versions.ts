import type { VersionEntry } from '@/lib/api'

const pct = (n: number | null) => (n == null ? '?' : `${n}%`)

/** "ATS 92% → 96%, callback 11% → 13%" (or just "ATS 96%" when there's nothing before). */
export function scoreLine(v: Pick<VersionEntry, 'ats' | 'callback'>): string {
  const one = (label: string, s: { from: number | null; to: number | null }) => (s.from == null || s.from === s.to ? `${label} ${pct(s.to)}` : `${label} ${pct(s.from)} → ${pct(s.to)}`)
  return `${one('ATS', v.ats)}, ${one('callback', v.callback)}`
}

/** "v3 · Nov 19, 1:36 PM · Your comment". */
export function versionStamp(v: Pick<VersionEntry, 'version' | 'created_at' | 'reason'>): string {
  const at = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(v.created_at))
  return `v${v.version} · ${at} · ${v.reason.label}`
}

/** "Report for v2 (Nov 19)". */
export function reportTitle(version: number, createdAt: string): string {
  return `Report for v${version} (${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(createdAt))})`
}

export type DiffKind = 'same' | 'added' | 'removed' | 'moved'
export interface DiffLine { text: string; kind: DiffKind }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Two versions side by side: lines only in the old one are removed, only in
 * the new one added, and a line in both but somewhere else (a bullet moved to
 * another place) is marked moved on both sides. LCS over lines.
 */
export function diffLines(oldLines: string[], newLines: string[]): { left: DiffLine[]; right: DiffLine[] } {
  const a = oldLines.map(norm)
  const b = newLines.map(norm)
  const n = a.length
  const m = b.length
  // dp[i][j]: the longest common run of a[i..] and b[j..], kept flat ((n+1) × (m+1)).
  const w = m + 1
  const dp = new Array<number>((n + 1) * w).fill(0)
  const at = (i: number, j: number) => dp[i * w + j] ?? 0
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i * w + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  const left: DiffLine[] = oldLines.map(text => ({ text, kind: 'removed' as DiffKind }))
  const right: DiffLine[] = newLines.map(text => ({ text, kind: 'added' as DiffKind }))
  for (let i = 0, j = 0; i < n && j < m;) {
    const l = left[i]
    const r = right[j]
    if (l && r && a[i] === b[j]) { l.kind = 'same'; r.kind = 'same'; i += 1; j += 1 } else if (at(i + 1, j) >= at(i, j + 1)) i += 1
    else j += 1
  }
  // The same line on both sides but not matched in order: it moved.
  const removed = new Map<string, number[]>()
  left.forEach((l, i) => { const k = a[i] ?? ''; if (l.kind === 'removed') removed.set(k, [...(removed.get(k) ?? []), i]) })
  right.forEach((r, j) => {
    if (r.kind !== 'added') return
    const spots = removed.get(b[j] ?? '')
    const i = spots?.shift()
    const l = i == null ? undefined : left[i]
    if (l) { l.kind = 'moved'; r.kind = 'moved' }
  })
  return { left, right }
}

/** How many lines were added, removed and moved. */
export function diffCounts(d: { left: DiffLine[]; right: DiffLine[] }) {
  return {
    added: d.right.filter(l => l.kind === 'added').length,
    removed: d.left.filter(l => l.kind === 'removed').length,
    moved: d.right.filter(l => l.kind === 'moved').length,
  }
}

/** The pasted people who get emails by default: the first ones, up to the free places. */
export function defaultPick<T>(people: T[], slots: number): Set<number> {
  return new Set(people.slice(0, Math.max(0, slots)).map((_, i) => i))
}

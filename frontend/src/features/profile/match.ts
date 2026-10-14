// Mirrors backend/services/answerBank.js so the page agrees with auto-apply
// about which saved answer covers which question.
const STOP = new Set(['a', 'an', 'the', 'please', 'your', 'you', 'do', 'are', 'is', 'to', 'of', 'in', 'for', 'and', 'or', 'with', 'at', 'on', 'this', 'that', 'us', 'we', 'our', 'any', 'have', 'has'])

export function normalizeQuestion(q: string): string {
  return String(q || '')
    .toLowerCase()
    .replace(/\((?:[^)]*\b(?:words?|characters?|chars?|optional|required|max|min)\b[^)]*)\)/g, ' ')
    .replace(/[*?:.!,;"'`’“”()[\]{}]/g, ' ')
    .replace(/[^a-z0-9/&+#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

function tokens(key: string): Set<string> {
  return new Set(key.split(' ').filter(w => w.length > 1 && !STOP.has(w)))
}

export function similarity(a: string, b: string): number {
  const ta = tokens(normalizeQuestion(a))
  const tb = tokens(normalizeQuestion(b))
  if (!ta.size || !tb.size) return 0
  let shared = 0
  for (const w of ta) if (tb.has(w)) shared++
  return shared / (ta.size + tb.size - shared)
}

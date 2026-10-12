/** Case-insensitive "every word appears somewhere" match. */
export function matches(query: string, haystack: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = haystack.toLowerCase()
  return words.every(w => text.includes(w))
}

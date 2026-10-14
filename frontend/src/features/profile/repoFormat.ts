/** The repo's top languages by size, e.g. ["TypeScript 71%", "Python 22%"]. */
export function topLanguages(languages: Record<string, number>, n = 3): string[] {
  const total = Object.values(languages).reduce((a, b) => a + b, 0)
  if (!total) return []
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, bytes]) => `${name} ${Math.max(1, Math.round((bytes / total) * 100))}%`)
}

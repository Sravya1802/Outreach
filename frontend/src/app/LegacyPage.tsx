import type { ReactNode } from 'react'

/**
 * Hosts a not-yet-rebuilt page. Its old light styling is scoped to .legacy
 * (see styles/legacy.css) so it can't leak into the new UI or vice versa.
 */
export function LegacyPage({ children }: { children: ReactNode }) {
  return <div className="legacy" data-theme-legacy="light">{children}</div>
}

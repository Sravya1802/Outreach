// Job markets. Each account picks one at sign-up; role lists, alerts and
// auto-apply follow it. Mirrors backend/services/markets.js.
import type { Region } from './api'

export type Market = 'usa' | 'india' | 'other'

export interface MarketInfo { value: Market; label: string; region: Region; regionLabel: string; description: string }

const USA: MarketInfo = { value: 'usa', label: 'United States', region: 'usa', regionLabel: 'USA', description: 'Roles across the US, from SpeedyApply, Indeed, LinkedIn and career pages.' }

export const MARKETS: MarketInfo[] = [
  USA,
  { value: 'india', label: 'India', region: 'india', regionLabel: 'India', description: 'Bengaluru, Hyderabad, Pune and the rest, including fresher roles.' },
  { value: 'other', label: 'Other countries', region: 'intl', regionLabel: 'International', description: 'Canada, the UK, Europe and everywhere else.' },
]

export const DEFAULT_MARKET: Market = 'usa'

export function isMarket(v: unknown): v is Market {
  return v === 'usa' || v === 'india' || v === 'other'
}

export function marketInfo(m: Market | null | undefined): MarketInfo {
  return MARKETS.find(x => x.value === m) ?? USA
}

/** The market as it reads mid-sentence: "in the United States", "in India", "in other countries". */
export function marketPhrase(m: Market | null | undefined): string {
  const info = marketInfo(m)
  return info.value === 'usa' ? 'the United States' : info.value === 'other' ? 'other countries' : info.label
}

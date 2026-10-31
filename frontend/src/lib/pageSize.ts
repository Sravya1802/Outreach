// How many rows a paged list shows: ?per= in the address, else the size this
// viewer last picked for that list, else 50.
import { useSearchParams } from 'react-router-dom'

export const PAGE_SIZES = [50, 100, 200] as const

const storeKey = (list: string) => `snj.pageSize.${list}`

export function pickPageSize(fromUrl: string | null, saved: string | null): number {
  for (const v of [fromUrl, saved]) {
    const n = Number(v)
    if ((PAGE_SIZES as readonly number[]).includes(n)) return n
  }
  return PAGE_SIZES[0]
}

function saved(list: string): string | null {
  try { return localStorage.getItem(storeKey(list)) } catch { return null }
}

/** [size, setSize]; changing it goes back to page 1 and is remembered for next time. */
export function usePageSize(list: string): [number, (n: number) => void] {
  const [params, setParams] = useSearchParams()
  const size = pickPageSize(params.get('per'), saved(list))
  const set = (n: number) => {
    try { localStorage.setItem(storeKey(list), String(n)) } catch { /* private window: the address still has it */ }
    const next = new URLSearchParams(params)
    if (n === PAGE_SIZES[0]) next.delete('per'); else next.set('per', String(n))
    next.delete('page')
    setParams(next)
  }
  return [size, set]
}

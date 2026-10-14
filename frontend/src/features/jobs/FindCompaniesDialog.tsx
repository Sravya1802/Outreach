import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Building2, Rocket } from 'lucide-react'
import { useServiceHealth } from '@/app/queries'
import { qk } from '@/app/queryClient'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { Button, Dialog, Field, Input, Segmented, Select, useToast } from '@/ui'
import { CATEGORIES, defaultScrapeQuery } from './categories'

type Mode = 'yc' | 'boards'

const BOARD_SOURCES = [
  { value: '', label: 'All job boards' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'wellfound', label: 'Wellfound' },
  { value: 'google_jobs', label: 'Google Jobs' },
  { value: 'github', label: 'GitHub lists' },
  { value: 'handshake', label: 'Handshake' },
]

/** Pull new companies into the user's list — YC directory (free) or job boards (Apify). */
export function FindCompaniesDialog({ onClose, initialCategory }: { onClose: () => void; initialCategory?: string }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { services } = useServiceHealth()
  const apify = services.find(s => s.id === 'apify')
  const apifyDown = apify?.state === 'down' || apify?.state === 'off'
  const [mode, setMode] = useState<Mode>(apifyDown ? 'yc' : 'boards')

  // YC options
  const industries = useQuery({ queryKey: qk.ycIndustries, queryFn: api.ycIndustries, staleTime: 60 * 60_000, enabled: mode === 'yc' })
  const [industry, setIndustry] = useState('')
  const [usOnly, setUsOnly] = useState(true)
  const [maxTeam, setMaxTeam] = useState('')

  // Job-board options
  const [category, setCategory] = useState(initialCategory && CATEGORIES.some(c => c.label === initialCategory) ? initialCategory : CATEGORIES[0]?.label ?? '')
  const [source, setSource] = useState('')
  const [query, setQuery] = useState(() => defaultScrapeQuery(category))
  const [queryEdited, setQueryEdited] = useState(false)

  const done = (text: string) => {
    void qc.invalidateQueries({ queryKey: qk.companiesAll })
    void qc.invalidateQueries({ queryKey: qk.categoryCounts })
    void qc.invalidateQueries({ queryKey: qk.stats })
    toast.success(text)
    onClose()
  }

  const yc = useMutation({
    mutationFn: () => api.importYc({ location: usOnly ? 'us' : undefined, industry: industry || undefined, maxTeamSize: Number(maxTeam) || undefined }),
    onSuccess: r => done(r.imported ? `Added ${formatNumber(r.imported)} YC companies${r.skipped ? ` (${formatNumber(r.skipped)} already in your list)` : ''}` : `No new YC companies — all ${formatNumber(r.total)} matches are already in your list`),
    onError: (e: Error) => toast.error(e.message),
  })
  const boards = useMutation({
    mutationFn: () => api.scrapeCompanies({ category, subcategory: query.trim() || defaultScrapeQuery(category), source: source || undefined }),
    onSuccess: r => {
      const errs = Array.isArray(r.errors) ? r.errors : Object.values(r.errors ?? {})
      if (!r.added && errs.length) { toast.error(`No new companies — ${String(errs[0]).slice(0, 160)}`); return }
      done(`${formatNumber(r.found)} found · ${formatNumber(r.added)} new in ${category}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const busy = yc.isPending || boards.isPending

  return (
    <Dialog open onClose={busy ? () => {} : onClose} label="Find companies" className="max-w-lg">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-semibold">Find companies</h2>
        <Segmented label="Source" value={mode} onChange={setMode} options={[
          { value: 'yc', label: <><Rocket className="size-3.5" /> YC directory</> },
          { value: 'boards', label: <><Building2 className="size-3.5" /> Job boards</> },
        ]} />
      </div>

      {mode === 'yc' ? (
        <div className="space-y-4 p-5">
          <p className="text-[13px] text-muted">Every Y Combinator company that’s currently hiring, from the public YC directory. Free and instant.</p>
          <Field label="Industry">
            {p => (
              <Select {...p} value={industry} onChange={e => setIndustry(e.target.value)} disabled={industries.isLoading}>
                <option value="">All industries</option>
                {(industries.data ?? []).map(i => <option key={i} value={i}>{i}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Location">
              {p => (
                <Select {...p} value={usOnly ? 'us' : 'all'} onChange={e => setUsOnly(e.target.value === 'us')}>
                  <option value="us">United States</option>
                  <option value="all">Anywhere</option>
                </Select>
              )}
            </Field>
            <Field label="Max team size" hint="Optional">
              {p => <Input {...p} inputMode="numeric" value={maxTeam} onChange={e => setMaxTeam(e.target.value.replace(/\D/g, ''))} placeholder="Any" />}
            </Field>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-5">
          {apifyDown && (
            <p role="status" className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>Apify is unavailable ({apify?.note.toLowerCase()}), so LinkedIn, Wellfound and Google Jobs will return nothing. GitHub lists and the YC directory still work.</span>
            </p>
          )}
          <Field label="Category" hint={CATEGORIES.find(c => c.label === category)?.desc}>
            {p => (
              <Select {...p} value={category} onChange={e => { setCategory(e.target.value); if (!queryEdited) setQuery(defaultScrapeQuery(e.target.value)) }}>
                {CATEGORIES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field label="Search for">
              {p => <Input {...p} value={query} onChange={e => { setQuery(e.target.value); setQueryEdited(true) }} />}
            </Field>
            <Field label="Where">
              {p => (
                <Select {...p} value={source} onChange={e => setSource(e.target.value)}>
                  {BOARD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <p className="text-xs text-subtle">Scraping job boards takes 1–3 minutes. New companies are sorted into categories automatically.</p>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        {mode === 'yc'
          ? <Button variant="primary" loading={yc.isPending} onClick={() => yc.mutate()}>Add YC companies</Button>
          : <Button variant="primary" loading={boards.isPending} onClick={() => boards.mutate()}>{boards.isPending ? 'Searching…' : 'Find companies'}</Button>}
      </div>
    </Dialog>
  )
}

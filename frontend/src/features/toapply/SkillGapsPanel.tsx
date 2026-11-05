import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Button, Card, useToast } from '@/ui'

/**
 * The skills your earlier resumes were missing. Tick the ones you know: they go
 * in your master corrections, so runs can use them where a role asks. No written
 * resume changes by itself; a comment on it does that, one resume at a time.
 */
export function SkillGapsPanel() {
  const qc = useQueryClient()
  const toast = useToast()
  const [picked, setPicked] = useState<string[]>([])
  const gaps = useQuery({
    queryKey: qk.skillGaps, queryFn: api.skillGaps,
    refetchInterval: query => (query.state.data?.updating?.running ? 5_000 : false),
  })
  const updating = gaps.data?.updating
  // As resumes are re-scored (every poll, and once more at the end), the table's ATS column picks up the new scores.
  const running = Boolean(updating?.running)
  const done = updating?.done ?? 0
  const seen = useRef({ running: false, done: 0 })
  useEffect(() => {
    if ((seen.current.running && !running) || (running && done !== seen.current.done)) void qc.invalidateQueries({ queryKey: qk.resumeJobs })
    seen.current = { running, done }
  }, [running, done, qc])
  const add = useMutation({
    mutationFn: () => api.approveSkillGaps(picked),
    onSuccess: (r) => {
      toast.success(`Saved ${r.skills.join(', ')}. Your next resumes can use them.`)
      setPicked([])
      void qc.invalidateQueries({ queryKey: qk.skillGaps })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const d = gaps.data
  if (!d || (!d.skills.length && !running)) return null
  const toggle = (s: string) => setPicked(p => (p.includes(s) ? p.filter(x => x !== s) : [...p, s]))

  return (
    <Card className="p-4">
      <h2 className="font-medium text-fg">Skills your earlier resumes were missing</h2>
      <p className="mt-1 text-[13px] text-muted">
        These are job skills nothing you’ve shared shows. Tick the ones you’ve really used and could talk about in an interview. They go in your master corrections for your next resumes. To add one to a written resume, comment on that resume.
      </p>
      {running && updating ? (
        <p className="mt-3 text-[14px] text-fg">Adding {updating.skills.join(', ')}: {updating.done} of {updating.total} resumes re-scored…</p>
      ) : (
        <>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-2 lg:grid-cols-3">
            {d.skills.map(s => (
              <li key={s.skill}>
                <label className="flex cursor-pointer items-baseline gap-2">
                  <input type="checkbox" className="size-4 translate-y-0.5 accent-[var(--ui-accent)]" checked={picked.includes(s.skill)} onChange={() => toggle(s.skill)} />
                  <span className="text-fg">{s.skill}</span>
                  <span className="text-[12px] text-subtle">{s.resumes} resume{s.resumes === 1 ? '' : 's'}{s.required ? ' · required' : ''}</span>
                </label>
              </li>
            ))}
          </ul>
          <Button className="mt-3" size="sm" disabled={!picked.length} loading={add.isPending} onClick={() => add.mutate()}>
            {picked.length ? `I know these ${picked.length}: save them` : 'Tick the ones you know'}
          </Button>
        </>
      )}
    </Card>
  )
}

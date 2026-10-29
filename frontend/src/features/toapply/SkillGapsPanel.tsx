import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Button, Card, useToast } from '@/ui'

/**
 * The skills holding unsent resumes under 90%, across every draft. Tick the
 * ones you know: they're added to every resume missing them and each is
 * re-scored. Nothing is ever added that you didn't tick.
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
  // When the re-scoring finishes, the table's ATS column picks up the new scores.
  const running = Boolean(updating?.running)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: qk.resumeJobs })
    wasRunning.current = running
  }, [running, qc])
  const add = useMutation({
    mutationFn: () => api.approveSkillGaps(picked),
    onSuccess: (r) => {
      toast.success(r.resumes ? `Adding ${r.skills.join(', ')} to ${r.resumes} resume${r.resumes === 1 ? '' : 's'} and re-scoring each.` : `Saved ${r.skills.join(', ')} for your next resumes.`)
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
      <h2 className="font-medium text-fg">Skills holding your resumes under 90%</h2>
      <p className="mt-1 text-[13px] text-muted">
        {d.underBar} of {d.unsent} unsent resumes are under the bar. These are the job skills nothing you’ve shared shows. Tick the ones you’ve really used and could talk about in an interview: they’re added to every resume missing them, and to your next ones.
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
            {picked.length ? `I know these ${picked.length}: add them` : 'Tick the ones you know'}
          </Button>
        </>
      )}
    </Card>
  )
}

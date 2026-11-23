import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type GapMessage } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Button, Input, useToast } from '@/ui'

/**
 * Your Claude run's questions about this resume's gaps, as a chat: its
 * questions with answer buttons and a free-text box, your answers beside them.
 * The app writes no question text; the run asks and acts on your answers.
 */
export function GapChat({ roleId, gaps }: { roleId: string; gaps: GapMessage[] }) {
  if (!gaps.length) return null
  return (
    <section aria-label="Questions from Claude" className="lg:col-span-3">
      <h3 className="mb-2 text-[12px] font-medium tracking-wide text-subtle uppercase">Questions from Claude</h3>
      <ol className="space-y-2">{gaps.map(g => <GapRow key={g.id} roleId={roleId} g={g} />)}</ol>
    </section>
  )
}

const Bubble = ({ mine, children }: { mine?: boolean; children: React.ReactNode }) => (
  <div className={cn('max-w-[85%] rounded-[10px] px-3 py-2 text-[14px] leading-relaxed', mine ? 'ml-auto bg-accent text-on-accent' : 'bg-raised text-fg')}>{children}</div>
)

function GapRow({ roleId, g }: { roleId: string; g: GapMessage }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [text, setText] = useState('')
  const answer = useMutation({
    mutationFn: (a: string) => api.answerGap(g.id, a),
    onSuccess: () => {
      toast.success('Thanks. Claude will update this resume within the hour.')
      setText('')
      void qc.invalidateQueries({ queryKey: qk.roleCard(roleId) })
      void qc.invalidateQueries({ queryKey: qk.dashboard })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  if (g.sender === 'me') return <li><Bubble mine>{g.text}</Bubble></li>
  const open = g.status === 'open'
  return (
    <li className="space-y-1.5">
      <Bubble>{g.text}</Bubble>
      {open ? (
        <div className="space-y-1.5 pl-1">
          {(g.options ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(g.options ?? []).map(o => <Button key={o} size="sm" disabled={answer.isPending} onClick={() => answer.mutate(o)}>{o}</Button>)}
            </div>
          )}
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) answer.mutate(text.trim()) }}>
            <Input value={text} onChange={e => setText(e.target.value)} placeholder="Or write your answer" aria-label={`Answer: ${g.text}`} className="min-w-0 flex-1" />
            <Button size="sm" variant="primary" type="submit" disabled={!text.trim()} loading={answer.isPending}>Send</Button>
          </form>
        </div>
      ) : (
        <>
          {g.answer && <Bubble mine>{g.answer}</Bubble>}
          <p className="text-right text-[12px] text-subtle">{g.status === 'applied' ? 'Claude used this in the resume.' : 'Claude will update this resume within the hour.'}</p>
        </>
      )}
    </li>
  )
}

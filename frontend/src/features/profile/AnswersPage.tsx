import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { api, type SavedAnswer } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Page, PageHeader, Skeleton, Textarea, useToast } from '@/ui'
import { COMMON_QUESTIONS, unansweredCommon } from './commonQuestions'

function AnswerEditor({ initialQuestion = '', initialAnswer = '', questionEditable, onSave, onCancel, saving }: {
  initialQuestion?: string
  initialAnswer?: string
  questionEditable: boolean
  onSave: (question: string, answer: string) => void
  onCancel?: () => void
  saving: boolean
}) {
  const [question, setQuestion] = useState(initialQuestion)
  const [answer, setAnswer] = useState(initialAnswer)
  const long = answer.length > 120 || /why|describe|tell us|explain/i.test(question)
  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (question.trim() && answer.trim()) onSave(question, answer) }}>
      {questionEditable && (
        <Field label="Question">
          {f => <Input {...f} value={question} onChange={e => setQuestion(e.target.value)} placeholder="What is your expected graduation date?" data-autofocus />}
        </Field>
      )}
      <Field label="Your answer" hint={long ? `${answer.trim().split(/\s+/).filter(Boolean).length} words` : undefined}>
        {f => long
          ? <Textarea {...f} value={answer} onChange={e => setAnswer(e.target.value)} rows={5} data-autofocus={!questionEditable || undefined} />
          : <Input {...f} value={answer} onChange={e => setAnswer(e.target.value)} data-autofocus={!questionEditable || undefined} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!question.trim() || !answer.trim()}>Save answer</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}

function AnswerRow({ row, onEdit, onDelete }: { row: SavedAnswer; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="grid gap-x-6 gap-y-1 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <p className="font-medium text-fg">{row.question}</p>
      <div className="row-span-2 flex items-start gap-1 sm:justify-end">
        <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete answer to “${row.question}”`} icon={<Trash2 className="size-3.5" />} />
      </div>
      <p className="line-clamp-3 text-[14px] whitespace-pre-line text-muted">{row.answer}</p>
      <p className="text-[12px] text-subtle sm:col-span-2">
        {row.use_count > 0 ? `Used ${row.use_count} time${row.use_count === 1 ? '' : 's'} · last ${timeAgo(row.last_used_at)}` : 'Not used yet'}
      </p>
    </li>
  )
}

export default function AnswersPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: qk.answers, queryFn: api.answers })
  const [editing, setEditing] = useState<number | 'new' | string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SavedAnswer | null>(null)

  const pending = rows.filter(r => r.status === 'pending')
  const answered = rows.filter(r => r.status === 'answered')
  const suggestions = unansweredCommon(rows)

  const done = () => { setEditing(null); void qc.invalidateQueries({ queryKey: qk.answers }) }
  const create = useMutation({
    mutationFn: ({ question, answer }: { question: string; answer: string }) => api.saveAnswer(question, answer),
    onSuccess: () => { toast.success('Answer saved'); done() },
    onError: (e: Error) => toast.error(e.message),
  })
  const update = useMutation({
    mutationFn: ({ id, question, answer }: { id: number; question: string; answer: string }) => api.updateAnswer(id, { question, answer }),
    onSuccess: () => { toast.success('Answer saved'); done() },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteAnswer(id),
    onSuccess: () => { toast.success('Answer deleted'); setConfirmDelete(null); done() },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Page>
      <PageHeader
        title="Application answers"
        description="Answer once and every form that asks gets the same answer. Questions a form asks that aren’t here stop that application and show up first."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add a question</Button>}
      />

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <div className="space-y-10">
          {editing === 'new' && (
            <section className="rounded-[4px] border border-line bg-surface p-5">
              <AnswerEditor questionEditable saving={create.isPending} onCancel={() => setEditing(null)}
                onSave={(question, answer) => create.mutate({ question, answer })} />
            </section>
          )}

          {pending.length > 0 && (
            <section aria-labelledby="pending-h" className="rounded-[4px] border border-warning/40 bg-warning-soft px-5 py-4">
              <h2 id="pending-h" className="font-display text-[20px] font-semibold text-fg">
                {pending.length === 1 ? 'A form asked something new' : `${pending.length} new questions from forms`}
              </h2>
              <p className="mb-2 text-[14px] text-muted">Those applications are waiting. Your answer is saved for every later form too.</p>
              <ul>
                {pending.map(p => (
                  <li key={p.id} className="border-t border-line py-3 first:border-t-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-fg">{p.question}</p>
                      {p.asked_by && <span className="text-[13px] text-subtle">{p.asked_by}</span>}
                    </div>
                    {editing === p.id ? (
                      <div className="mt-3">
                        <AnswerEditor initialQuestion={p.question} questionEditable={false} saving={update.isPending}
                          onCancel={() => setEditing(null)} onSave={(question, answer) => update.mutate({ id: p.id, question, answer })} />
                      </div>
                    ) : (
                      <Button size="sm" variant="primary" className="mt-2" onClick={() => setEditing(p.id)}>Answer</Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="saved-h">
            <h2 id="saved-h" className="mb-1 font-display text-[24px] font-semibold text-fg">
              Saved <span className="font-sans text-[15px] font-normal text-subtle">· {answered.length}</span>
            </h2>
            {answered.length === 0 ? (
              <div className="border-t border-rule">
                <EmptyState title="No saved answers yet" description="Start with the common questions below, the ones most forms ask." />
              </div>
            ) : (
              <ul className="border-t border-rule">
                {answered.map(r => editing === r.id ? (
                  <li key={r.id} className="border-b border-line py-4">
                    <AnswerEditor initialQuestion={r.question} initialAnswer={r.answer ?? ''} questionEditable saving={update.isPending}
                      onCancel={() => setEditing(null)} onSave={(question, answer) => update.mutate({ id: r.id, question, answer })} />
                  </li>
                ) : (
                  <AnswerRow key={r.id} row={r} onEdit={() => setEditing(r.id)} onDelete={() => setConfirmDelete(r)} />
                ))}
              </ul>
            )}
          </section>

          {suggestions.length > 0 && (
            <section aria-labelledby="common-h">
              <h2 id="common-h" className="font-display text-[24px] font-semibold text-fg">Commonly asked</h2>
              <p className="mb-3 text-[14px] text-muted">{suggestions.length} of {COMMON_QUESTIONS.length} still to answer. Contact details, work authorization and education are on the Details tab.</p>
              <ul className="border-t border-rule">
                {suggestions.map(q => (
                  <li key={q.question} className="border-b border-line py-3">
                    {editing === `common:${q.question}` ? (
                      <div className="space-y-3">
                        <p className="text-fg">{q.question}</p>
                        <AnswerEditor initialQuestion={q.question} questionEditable={false} saving={create.isPending}
                          onCancel={() => setEditing(null)} onSave={(question, answer) => create.mutate({ question, answer })} />
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-fg">{q.question}</p>
                          {q.hint && <p className="text-[13px] text-subtle">{q.hint}</p>}
                        </div>
                        <Button size="sm" onClick={() => setEditing(`common:${q.question}`)}>Answer</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete.id)}
        title="Delete this answer?"
        description={confirmDelete ? `Forms asking “${confirmDelete.question}” will stop and wait for you again.` : ''}
        confirmLabel="Delete"
        danger
        busy={remove.isPending}
      />
    </Page>
  )
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { NOTES_MAX, parseNotesPatch } from '../services/pipelineNotes.js'

test('only the keys sent are changed; blanks clear', () => {
  assert.deepEqual(parseNotesPatch({ notes: '  Recruiter: Priya  ' }), { notes: 'Recruiter: Priya' })
  assert.deepEqual(parseNotesPatch({ next_step: 'Phone screen', next_step_at: '2026-10-20' }), { next_step: 'Phone screen', next_step_at: '2026-10-20' })
  assert.deepEqual(parseNotesPatch({ notes: '', next_step: null, next_step_at: '' }), { notes: null, next_step: null, next_step_at: null })
})

test('rejects bad input', () => {
  assert.throws(() => parseNotesPatch({}), /Nothing to update/)
  assert.throws(() => parseNotesPatch(null), /Nothing to update/)
  assert.throws(() => parseNotesPatch({ next_step_at: '2026-02-30' }), /date/)
  assert.throws(() => parseNotesPatch({ next_step_at: 'next tuesday' }), /date/)
  assert.throws(() => parseNotesPatch({ notes: 'x'.repeat(NOTES_MAX + 1) }), /at most/)
  assert.throws(() => parseNotesPatch({ notes: 42 }), /text/)
})

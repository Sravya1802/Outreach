import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z'; // these tests make no queries
process.env.TOKEN_ENC_KEY ||= 'a'.repeat(64);
const { formUrl, isLinkedIn, readyKind, sortReady } = await import('../services/readyToSubmit.js');
const { signFillToken, verifyFillToken, signState, verifyState } = await import('../services/secretBox.js');
const { reviewMessage } = await import('../services/whatsapp.js');

test('formUrl: the form itself (Lever /apply, Ashby /application), other links as they are', () => {
  assert.equal(formUrl('https://jobs.lever.co/glsllc/d81bfc16'), 'https://jobs.lever.co/glsllc/d81bfc16/apply');
  assert.equal(formUrl('https://jobs.lever.co/glsllc/d81bfc16/apply'), 'https://jobs.lever.co/glsllc/d81bfc16/apply');
  assert.equal(formUrl('https://jobs.ashbyhq.com/netic/b0ea7aab'), 'https://jobs.ashbyhq.com/netic/b0ea7aab/application');
  assert.equal(formUrl('https://job-boards.greenhouse.io/verkada/jobs/5210813007'), 'https://job-boards.greenhouse.io/verkada/jobs/5210813007');
  assert.equal(formUrl('not a url'), 'not a url');
});

test('readyKind: LinkedIn is never filled; its company-board twin is', () => {
  assert.ok(isLinkedIn('https://www.linkedin.com/jobs/view/4484809997'));
  assert.ok(!isLinkedIn('https://jobs.ashbyhq.com/x/y'));
  assert.deepEqual(readyKind('https://www.linkedin.com/jobs/view/1', null), { kind: 'linkedin', open_url: 'https://www.linkedin.com/jobs/view/1' });
  assert.deepEqual(readyKind('https://www.linkedin.com/jobs/view/1', 'https://jobs.lever.co/a/b'), { kind: 'fill', open_url: 'https://jobs.lever.co/a/b/apply' });
  assert.equal(readyKind('https://grnh.se/whd76nsp1us', null).kind, 'fill');
});

test('sortReady: closing soonest first, no date last, then longest waiting', () => {
  const rows = [
    { id: 'a', deadline: null, waiting_since: '2026-11-09' },
    { id: 'b', deadline: '2026-11-20', waiting_since: '2026-11-14' },
    { id: 'c', deadline: null, waiting_since: '2026-11-01' },
    { id: 'd', deadline: '2026-11-18', waiting_since: '2026-11-16' },
  ];
  assert.deepEqual(sortReady(rows).map(r => r.id), ['d', 'b', 'c', 'a']);
});

test('fill tokens: one role, 24 hours, and never interchangeable with an OAuth state', () => {
  const now = Date.UTC(2026, 10, 17);
  const t = signFillToken('user-1', 6379, { now });
  assert.deepEqual(verifyFillToken(t, { now: now + 3600_000 }), { userId: 'user-1', planItemId: '6379' });
  assert.equal(verifyFillToken(t, { now: now + 25 * 3600_000 }), null);
  assert.equal(verifyFillToken(`${t.split('.')[0]}.x${t.split('.')[1].slice(1)}`, { now }), null);
  assert.equal(verifyState(t, { now }), null);
  assert.equal(verifyFillToken(signState('user-1', { now }), { now }), null);
});

test('9 PM digest: the Ready to submit list, nearest deadline named', () => {
  const m = reviewMessage({ ready: 0, submit: [
    { company: 'Archer', title: 'FAST Analyst', deadline: '2026-11-20', kind: 'fill' },
    { company: 'Garmin', title: 'Software Engineer 1', deadline: null, kind: 'linkedin' },
  ] });
  assert.equal(m.subject, '2 roles ready to submit (Archer closes Fri, Nov 20)');
  assert.match(m.text, /• Archer · FAST Analyst · closes Fri, Nov 20/);
  assert.match(m.text, /• Garmin · Software Engineer 1 · apply on LinkedIn by hand/);
  assert.match(m.text, /\/review\/ready/);
  assert.doesNotMatch(m.text, /0 roles ready for review/);
  assert.doesNotMatch(reviewMessage({ ready: 2 }).text, /ready to submit/);
});

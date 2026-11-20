import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
const { sendBlock } = await import('../services/outbox.js');
const { skipReason, summarize, SKIP_LABEL } = await import('../services/outreachApproval.js');

const claude = { subject: 'Software Engineer Intern: Lakshmi Sravya Rachakonda', body: 'Dear Ana,\n\nI am applying for the Software Engineer Intern role at Acme in Chicago, IL.', written_by: 'claude' };

test('send check: written by your Claude run (or edited by you) and not empty', () => {
  assert.equal(sendBlock(claude), null);
  assert.equal(sendBlock({ ...claude, written_by: 'you' }), null);
  assert.match(sendBlock({ ...claude, body: '  ' }), /empty/);
  assert.match(sendBlock({ ...claude, subject: '' }), /empty/);
  assert.match(sendBlock({ ...claude, written_by: 'app' }), /old template/);
  assert.match(sendBlock({ ...claude, written_by: null }), /no record/);
  // The old template's wording is caught even if a row says otherwise.
  const old = `${claude.body}\n\nI am completing a Master of Science in Computer Science at the University of Illinois at Chicago (May 2027), after two years as a Software Engineer.`;
  assert.match(sendBlock({ ...claude, body: old }), /old template/);
});

const base = { ...claude, name: 'Ana Ruiz', company: 'Acme', quant: false, contact_status: 'pending', email_status: 'valid', resume_ok: true };

test('approve all: what gets skipped, and why', () => {
  assert.equal(skipReason(base), null);
  // Only verified addresses get email.
  for (const st of ['guessed', 'risky', 'unverified', 'unknown', null]) assert.equal(skipReason({ ...base, email_status: st }), 'unverified', String(st));
  assert.equal(skipReason({ ...base, body: '' }), 'writing');
  assert.equal(skipReason({ ...base, subject: null }), 'writing');
  assert.equal(skipReason({ ...base, written_by: 'app' }), 'not_claude');
  assert.equal(skipReason({ ...base, resume_ok: false }), 'no_resume');
  assert.equal(skipReason({ ...base, contact_status: 'replied' }), 'replied');
  assert.equal(skipReason({ ...base, email_status: 'invalid' }), 'invalid');
  assert.equal(skipReason({ ...base, body: `${base.body} We cut latency to 83ns.` }), 'problem');
  assert.equal(skipReason({ ...base, quant: true, body: `${base.body} We cut latency to 83ns.` }), null);
  for (const r of ['unverified', 'writing', 'not_claude', 'no_resume', 'replied', 'invalid', 'problem', 'asked', 'not_in_gmail', 'gmail']) assert.ok(SKIP_LABEL[r]);
});

test('approve all: the summary counts skips by reason, most first', () => {
  const s = summarize(5, [
    { reason: 'writing', name: 'A' }, { reason: 'asked', name: 'B' }, { reason: 'writing', name: 'C' },
  ]);
  assert.equal(s.approved, 5);
  assert.equal(s.skipped, 3);
  assert.deepEqual(s.reasons.map(r => [r.reason, r.count, r.names]), [['writing', 2, ['A', 'C']], ['asked', 1, ['B']]]);
  assert.equal(s.reasons[0].label, SKIP_LABEL.writing);
});

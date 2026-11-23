import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
const { chipFor, groupsOf, sortCards, daysUntil } = await import('../services/roleDashboard.js');

test('dashboard chip: where the role is, most advanced first', () => {
  assert.equal(chipFor({ status: 'closed', replies: 2 }), 'Closed');
  assert.equal(chipFor({ status: 'approved', stage: 'applied' }), 'Applied');
  assert.equal(chipFor({ status: 'applied' }), 'Applied');
  assert.equal(chipFor({ status: 'approved', replies: 1, sent: 3 }), 'Replied');
  assert.equal(chipFor({ status: 'ready', sent: 2 }), 'Emailed');
  assert.equal(chipFor({ status: 'approved' }), 'Approved');
  assert.equal(chipFor({ status: 'ready' }), 'Review');
  assert.equal(chipFor({ status: 'revision_requested', revising: true }), 'Revising');
  assert.equal(chipFor({ status: 'ready', revising: true, sent: 2 }), 'Revising');
});

test('dashboard counts: which filters a card is in', () => {
  const now = new Date('2026-11-20T15:00:00Z');
  assert.deepEqual(groupsOf({ status: 'ready', chip: 'Review', deadline: '2026-11-24', sent: 0, replies: 0 }, now), ['review', 'closing']);
  assert.deepEqual(groupsOf({ status: 'approved', chip: 'Replied', sent: 2, replies: 1, submit: { kind: 'fill' }, deadline: null }, now), ['approved', 'emailed', 'replies', 'submit']);
  assert.deepEqual(groupsOf({ status: 'applied', chip: 'Applied', deadline: '2026-11-21' }, now), ['applied']);
  assert.deepEqual(groupsOf({ status: 'ready', chip: 'Review', deadline: '2026-12-20' }, now), ['review']);
  // Being revised: out of Ready to review.
  assert.deepEqual(groupsOf({ status: 'ready', revising: true, chip: 'Revising', deadline: null }, now), []);
  assert.deepEqual(groupsOf({ status: 'revision_requested', revising: true, chip: 'Revising', deadline: null }, now), []);
  assert.equal(daysUntil('2026-11-20', now), 0);
  assert.equal(daysUntil(null, now), null);
});

test('dashboard order: deadline soonest (none last), then callback highest', () => {
  const cards = [
    { company: 'A', deadline: null, callback: 90 },
    { company: 'B', deadline: '2026-12-01', callback: 20 },
    { company: 'C', deadline: '2026-11-25', callback: 10 },
    { company: 'D', deadline: '2026-12-01', callback: 55 },
    { company: 'E', deadline: null, callback: 95 },
  ];
  assert.deepEqual(sortCards(cards).map(c => c.company), ['C', 'D', 'B', 'E', 'A']);
});

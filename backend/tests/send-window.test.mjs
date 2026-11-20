import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timezoneFor, nextSendSlot, businessDaysLater, partsIn, zonedToUtc, describeSlot } from '../services/sendWindow.js';

test('time zone from a location', () => {
  assert.equal(timezoneFor('New York, NY'), 'America/New_York');
  assert.equal(timezoneFor('San Francisco, CA · Hybrid'), 'America/Los_Angeles');
  assert.equal(timezoneFor('Austin, TX'), 'America/Chicago');
  assert.equal(timezoneFor('Remote - Seattle'), 'America/Los_Angeles');
  assert.equal(timezoneFor('Bengaluru, Karnataka, India'), 'Asia/Kolkata');
  assert.equal(timezoneFor('Columbus, OH'), 'America/New_York');
  assert.equal(timezoneFor('Washington, DC'), 'America/New_York');
  assert.equal(timezoneFor('Denver, Colorado'), 'America/Denver');
  assert.equal(timezoneFor('London, UK'), 'Europe/London');
  assert.equal(timezoneFor('Remote'), null);
  assert.equal(timezoneFor(''), null);
});

test('zonedToUtc handles DST on both sides', () => {
  assert.equal(zonedToUtc({ year: 2026, month: 10, day: 14, hour: 9 }, 'America/New_York').toISOString(), '2026-10-14T13:00:00.000Z');
  assert.equal(zonedToUtc({ year: 2026, month: 12, day: 14, hour: 9 }, 'America/New_York').toISOString(), '2026-12-14T14:00:00.000Z');
  assert.equal(zonedToUtc({ year: 2026, month: 10, day: 14, hour: 9 }, 'Asia/Kolkata').toISOString(), '2026-10-14T03:30:00.000Z');
});

const mid = () => 0.5;

test('a slot lands 8–11 AM on a weekday in the recipient zone', () => {
  // Wed 2026-10-14 22:00 Chicago (= Thu 03:00Z) → Thursday morning in New York.
  const s = nextSendSlot('America/New_York', { now: new Date('2026-10-15T03:00:00Z'), rand: mid });
  const p = partsIn(s, 'America/New_York');
  assert.equal(p.dow, 4);
  assert.ok(p.hour >= 8 && p.hour < 11, `hour ${p.hour}`);
});

test('inside the window it can go today; after it, the next weekday', () => {
  const inside = nextSendSlot('America/New_York', { now: new Date('2026-10-14T13:30:00Z'), rand: () => 0 }); // Wed 9:30 ET
  assert.ok(inside.getTime() - new Date('2026-10-14T13:30:00Z').getTime() <= 3 * 60_000);
  const after = nextSendSlot('America/Los_Angeles', { now: new Date('2026-10-16T20:00:00Z'), rand: mid }); // Fri 1 PM PT
  assert.equal(partsIn(after, 'America/Los_Angeles').dow, 1); // Monday
});

test('never on a weekend', () => {
  for (let h = 0; h < 72; h += 5) {
    const s = nextSendSlot('Europe/London', { now: new Date(Date.UTC(2026, 9, 16, h)), rand: Math.random });
    const p = partsIn(s, 'Europe/London');
    assert.ok(p.dow >= 1 && p.dow <= 5 && p.hour >= 8 && p.hour < 11, JSON.stringify(p));
  }
});

test('follow-ups count business days', () => {
  // Sent Thu 2026-10-15 → 4 business days later = Wed 2026-10-21.
  const f = businessDaysLater(new Date('2026-10-15T14:00:00Z'), 4, 'America/New_York', { rand: mid });
  const p = partsIn(f, 'America/New_York');
  assert.deepEqual([p.month, p.day], [10, 21]);
  assert.ok(p.hour >= 8 && p.hour < 11);
  const ten = partsIn(businessDaysLater(new Date('2026-10-15T14:00:00Z'), 10, 'America/New_York', { rand: mid }), 'America/New_York');
  assert.deepEqual([ten.month, ten.day], [10, 29]);
  assert.match(describeSlot(f, 'America/New_York'), /^Wed \d{1,2}:\d{2} AM$/);
});

// ── Outreach send plan ──
import { planSendTimes, dayKey } from '../services/sendWindow.js';

const local = (d, tz) => { const p = partsIn(d, tz); return { ...p, mins: p.hour * 60 + p.minute }; };

test('approved emails go the next business day, 8 AM–2 PM their time, 2–4 minutes apart', () => {
  // Wed 2026-11-18 9:30 AM Chicago: today's window has started, so Thursday.
  const now = new Date('2026-11-18T15:30:00Z');
  const items = Array.from({ length: 10 }, (_, i) => ({ id: i, tz: 'America/Chicago' }));
  const plan = planSendTimes(items, { now, rand: Math.random });
  assert.equal(plan.size, 10);
  const ts = [...plan.values()].map(d => d.getTime()).sort((a, b) => a - b);
  for (const t of ts) {
    const p = local(new Date(t), 'America/Chicago');
    assert.equal(p.dow, 4);
    assert.ok(p.mins >= 480 && p.mins < 840, `${p.hour}:${p.minute}`);
  }
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1];
    assert.ok(gap >= 120_000 && gap <= 240_000, `gap ${gap}`);
  }
});

test('before the window opens, it is the same morning; unknown zone means Chicago', () => {
  const now = new Date('2026-11-18T12:00:00Z'); // Wed 6 AM Chicago
  const t = planSendTimes([{ id: 1, tz: null }], { now, rand: () => 0 }).get(1);
  const p = local(t, 'America/Chicago');
  assert.equal(p.dow, 3);
  assert.equal(p.hour, 8);
});

test('never on a weekend: Friday afternoon goes Monday', () => {
  const now = new Date('2026-11-20T21:00:00Z'); // Fri 3 PM Chicago
  const t = planSendTimes([{ id: 1, tz: 'America/New_York' }], { now, rand: mid }).get(1);
  const p = local(t, 'America/New_York');
  assert.equal(p.dow, 1);
  assert.ok(p.hour >= 8 && p.hour < 14);
});

test('at most 40 a day: the rest roll to the next business morning', () => {
  const now = new Date('2026-11-18T20:00:00Z'); // Wed afternoon
  // Spread over three zones so the window isn't the limit, only the cap.
  const zones = ['America/New_York', 'America/Chicago', 'America/Los_Angeles'];
  const items = Array.from({ length: 50 }, (_, i) => ({ id: i, tz: zones[i % 3] }));
  const plan = planSendTimes(items, { now, rand: mid, cap: 40 });
  assert.equal(plan.size, 50);
  const days = new Map();
  for (const d of plan.values()) days.set(dayKey(d), (days.get(dayKey(d)) || 0) + 1);
  assert.deepEqual([...days.entries()].sort(), [['2026-11-19', 40], ['2026-11-20', 10]]);
  for (const [id, d] of plan) {
    const p = local(d, zones[id % 3]);
    assert.ok(p.hour >= 8 && p.hour < 14 && p.dow >= 1 && p.dow <= 5);
  }
});

test('emails already scheduled or sent count: spacing and the day cap', () => {
  const now = new Date('2026-11-18T20:00:00Z');
  const thu = (h, m) => zonedToUtc({ year: 2026, month: 11, day: 19, hour: h, minute: m }, 'America/Chicago');
  const taken = Array.from({ length: 39 }, (_, i) => thu(8, 0 + i * 3)).filter(t => partsIn(t, 'America/Chicago').hour < 10);
  const plan = planSendTimes([{ id: 'a', tz: 'America/Los_Angeles' }, { id: 'b', tz: 'America/Los_Angeles' }], { now, taken, rand: mid, cap: 40 });
  const a = plan.get('a');
  const b = plan.get('b');
  // 39 taken + a = 40 on Thursday; b goes Friday.
  assert.equal(dayKey(a), '2026-11-19');
  assert.equal(dayKey(b), '2026-11-20');
  for (const t of taken) assert.ok(Math.abs(t - a) >= 120_000);
});

test('a window that has started can take a pushed-back send when asked', () => {
  const now = new Date('2026-11-18T15:00:00Z'); // Wed 9:00 AM Chicago
  const t = planSendTimes([{ id: 1, tz: 'America/Chicago' }], { now, openWindow: true, rand: () => 0 }).get(1);
  assert.equal(dayKey(t), '2026-11-18');
  assert.ok(t - now >= 60_000 && t - now < 180_000);
});

test('the daily cap is 450 by default: the windows and spacing are what limit a day', async () => {
  const { OUTREACH_CAP } = await import('../services/sendWindow.js');
  assert.equal(OUTREACH_CAP, 450);
  const now = new Date('2026-11-18T20:00:00Z');
  const zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
  const plan = planSendTimes(Array.from({ length: 300 }, (_, i) => ({ id: i, tz: zones[i % 4] })), { now, rand: mid });
  const days = new Map();
  for (const d of plan.values()) days.set(dayKey(d), (days.get(dayKey(d)) || 0) + 1);
  const first = days.get('2026-11-19');
  // Four zones' 8–10 AM windows, 2–4 minutes apart: well under 450, the rest the next morning.
  assert.ok(first > 40 && first < 450, String(first));
  assert.equal(plan.size, 300);
});

test('the window is 8 AM–2 PM: 100 emails to one zone fit one day, spaced 2–4 minutes', () => {
  const now = new Date('2026-11-18T20:00:00Z'); // Wed afternoon Chicago
  const plan = planSendTimes(Array.from({ length: 100 }, (_, i) => ({ id: i, tz: 'America/Chicago' })), { now, rand: mid });
  const ts = [...plan.values()].map(d => d.getTime()).sort((a, b) => a - b);
  for (const t of ts) {
    const p = partsIn(new Date(t), 'America/Chicago');
    assert.equal(p.dow, 4);
    assert.ok(p.hour >= 8 && p.hour < 14, `${p.hour}:${p.minute}`);
  }
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 120_000 && ts[i] - ts[i - 1] <= 240_000);
});

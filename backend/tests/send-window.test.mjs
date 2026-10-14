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

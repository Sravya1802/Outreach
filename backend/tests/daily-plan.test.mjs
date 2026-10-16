import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z'; // imports db.js; no queries here
const { normalizeSettings, assignTiers, localDate, roleTypesFor, planEmail, DEFAULT_SETTINGS } = await import('../services/dailyPlan.js');

test('settings default to opt-in off, 10 PM Central, 9.0, 15 a day, referral first', () => {
  const s = normalizeSettings({});
  assert.deepEqual(s, { ...DEFAULT_SETTINGS, enabled: false });
  assert.equal(s.timezone, 'America/Chicago');
  const c = normalizeSettings({ enabled: true, listHour: 3, minScore: 12, maxPerDay: 99, timezone: 'Mars/Base', referralWaitDays: -1 });
  assert.deepEqual([c.enabled, c.listHour, c.minScore, c.maxPerDay, c.timezone, c.referralWaitDays], [true, 17, 10, 30, 'America/Chicago', 0]);
});

test('local date follows the user zone', () => {
  // 03:30 UTC on the 16th is still the 15th in Chicago.
  assert.equal(localDate('America/Chicago', new Date('2026-10-16T03:30:00Z')), '2026-10-15');
  assert.equal(localDate('Asia/Kolkata', new Date('2026-10-15T20:00:00Z')), '2026-10-16');
});

test('role types from the profile', () => {
  assert.deepEqual(roleTypesFor({ target_job_type: 'intern' }), ['intern']);
  assert.deepEqual(roleTypesFor({ target_job_type: 'full_time' }), ['new_grad']);
  assert.deepEqual(roleTypesFor({}), ['intern', 'new_grad']);
});

test('tiers: best per company, capped, rest worth a look', () => {
  const rows = [
    { company_name: 'Ramp', score: 9.4 }, { company_name: 'ramp', score: 9.1 }, { company_name: 'Stripe', score: 9.0 },
    { company_name: 'Figma', score: 9.6 }, { company_name: 'Acme', score: 8.0 }, { company_name: 'Low', score: 5.5 },
    { company_name: 'Gone', tier: 'excluded', reason: 'Needs US citizens' }, { company_name: 'Blank', score: null },
  ];
  const t = assignTiers(rows, { minScore: 9, maxPerDay: 2 });
  const tierOf = (c, sc) => t.find(r => r.company_name === c && (sc == null || r.score === sc)).tier;
  assert.equal(tierOf('Figma'), 'top');
  assert.equal(tierOf('Ramp', 9.4), 'top');
  assert.equal(tierOf('ramp', 9.1), 'worth');
  assert.match(t.find(r => r.company_name === 'ramp').reason, /another ramp role is on the list/);
  assert.equal(tierOf('Stripe'), 'worth'); // over the cap
  assert.equal(tierOf('Acme'), 'worth');
  assert.equal(tierOf('Low'), 'low');
  assert.equal(tierOf('Gone'), 'excluded');
  assert.equal(tierOf('Blank'), 'low');
});

test('evening email lists the top roles and says what happens next', () => {
  const settings = normalizeSettings({ enabled: true });
  const mail = planEmail({
    items: [
      { tier: 'top', score: 9.4, company_name: 'Ramp', title: 'SWE Intern', location: 'New York', pay: '$55/hr', sponsorship: 'sponsors', reason: 'Kafka + Python match' },
      { tier: 'worth', score: 8.1, company_name: 'Acme', title: 'Data Intern' },
    ],
    stats: { excluded: 2 }, settings, date: '2026-10-15', firstName: 'Sravya',
  });
  assert.equal(mail.subject, '[Scout’n’Jobs] 1 role to approve tonight · Thu, Oct 15');
  assert.match(mail.text, /^Good evening, Sravya\. 1 new role scored 9 or higher today\./);
  assert.match(mail.text, /9\.4 {2}Ramp · SWE Intern · New York · \$55\/hr · Sponsors visas/);
  assert.match(mail.text, /ask someone at the company for a referral tomorrow morning, and apply 2 business days later/);
  assert.match(mail.text, /Also worth a look: 1 role/);
  assert.match(mail.text, /Left out: 2/);
  assert.match(mail.html, /Review and approve/);
  assert.ok(!mail.html.includes('<script'));
  const none = planEmail({ items: [{ tier: 'worth', score: 7.5, company_name: 'A', title: 'B' }], stats: {}, settings, date: '2026-10-15' });
  assert.match(none.subject, /No 9\+ roles tonight · 1 worth a look/);
});

test('fills up to the daily minimum with close matches (8+), never below', async () => {
  const { assignTiers: tiers, CLOSE_MATCH } = await import('../services/dailyPlan.js');
  const rows = [
    { company_name: 'A', score: 9.3 }, { company_name: 'B', score: 9.0 }, { company_name: 'C', score: 8.8 },
    { company_name: 'D', score: 8.4 }, { company_name: 'D', score: 8.3 }, { company_name: 'E', score: 7.9 }, { company_name: 'F', score: 6 },
  ];
  const t = tiers(rows, { minScore: 9, maxPerDay: 15, minPerDay: 10 });
  const top = t.filter(r => r.tier === 'top');
  assert.deepEqual(top.map(r => r.company_name), ['A', 'B', 'C', 'D']); // one per company; E is under 8
  assert.ok(top.filter(r => r.score < 9).every(r => r.reason.startsWith(CLOSE_MATCH)));
  assert.ok(!top.find(r => r.company_name === 'A').reason);
  assert.equal(t.find(r => r.company_name === 'E').tier, 'worth');
  // Re-tiering doesn't stack the label.
  const again = tiers(t, { minScore: 9, maxPerDay: 15, minPerDay: 10 });
  assert.equal(again.find(r => r.company_name === 'C').reason.split(CLOSE_MATCH).length, 2);
  // minPerDay 0 = old behaviour.
  assert.equal(tiers(rows, { minScore: 9, maxPerDay: 15, minPerDay: 0 }).filter(r => r.tier === 'top').length, 2);
});

test('relevant titles are scored first', async () => {
  const { relevanceWords, titleRelevance } = await import('../services/dailyPlan.js');
  const words = relevanceWords({ experience: [{ title: 'Data Engineering Intern' }], skills: [{ items: ['Python', 'Kafka', 'React'] }] });
  assert.ok(titleRelevance('Software Engineer, Data Platform (Python)', words) > titleRelevance('Marketing Associate', words));
  assert.equal(titleRelevance('Account Executive', words), 0);
});

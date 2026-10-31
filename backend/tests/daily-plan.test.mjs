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

test('morning email lists every match to pick and says what each pick does', () => {
  const settings = normalizeSettings({ enabled: true, listHour: 21 });
  const mail = planEmail({
    items: [
      { tier: 'top', score: 9.4, company_name: 'Ramp', title: 'SWE Intern', location: 'New York', pay: '$55/hr', sponsorship: 'sponsors', reason: 'Kafka + Python match', apply_url: 'https://jobs.ramp.com/swe?a=1&b=2' },
      { tier: 'top', score: 9.1, company_name: 'Evil', title: 'Intern', apply_url: 'javascript:alert(1)' },
      { tier: 'worth', score: 8.1, company_name: 'Acme', title: 'Data Intern' },
      { tier: 'low', score: 5, company_name: 'Low', title: 'X' },
    ],
    stats: { excluded: 2 }, settings, date: '2026-10-15', firstName: 'Sravya',
  });
  assert.equal(mail.subject, '[Scout’n’Jobs] 3 roles to pick · Thu, Oct 15');
  assert.match(mail.html, /<a href="https:\/\/jobs\.ramp\.com\/swe\?a=1&amp;b=2" style="color:#0b6bcb">SWE Intern<\/a>/);
  assert.ok(!mail.html.includes('javascript:') && !mail.text.includes('javascript:'));
  assert.match(mail.text, /^Good morning, Sravya\. 3 roles match you today\./);
  assert.match(mail.text, /9\.4 {2}Ramp · SWE Intern · New York · \$55\/hr · Sponsors visas/);
  assert.match(mail.text, /8\.1 {2}Acme · Data Intern/);
  assert.ok(!mail.text.includes('Low · X'));
  assert.match(mail.text, /App drafts .*I’ll draft my own .*Skip/);
  assert.match(mail.text, /ready by 9 PM/);
  assert.match(mail.text, /Left out: 2/);
  assert.match(mail.html, /Pick today’s roles/);
  assert.ok(!mail.html.includes('<script'));
  const fresh = planEmail({ items: [{ tier: 'worth', score: 7.5, company_name: 'A', title: 'B' }], stats: { excluded: 4 }, settings, date: '2026-10-15', fresh: true });
  assert.equal(fresh.subject, '[Scout’n’Jobs] 1 new role to pick since this morning · Thu, Oct 15');
  assert.ok(!fresh.text.includes('Left out'));
  const none = planEmail({ items: [], stats: {}, settings, date: '2026-10-15' });
  assert.match(none.subject, /No matching roles today/);
});

test('settings carry the morning and afternoon hours, clamped', () => {
  const s = normalizeSettings({});
  assert.deepEqual([s.morningHour, s.updateHour], [9, 14]);
  const c = normalizeSettings({ morningHour: 2, updateHour: 23 });
  assert.deepEqual([c.morningHour, c.updateHour], [5, 18]);
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

test('scores spread out by qualifications met', async () => {
  const { blendScore } = await import('../services/dailyPlan.js');
  const all = blendScore({ score: 9.2, required_total: 6, required_met: 6, preferred_total: 4, preferred_met: 4, level: 'match' });
  const most = blendScore({ score: 9.2, required_total: 6, required_met: 6, preferred_total: 4, preferred_met: 1, level: 'match' });
  const gap = blendScore({ score: 9.2, required_total: 6, required_met: 5, preferred_total: 4, preferred_met: 1, level: 'match' });
  assert.ok(all > most && most > gap, `${all} > ${most} > ${gap}`);
  assert.equal(all, 9.6);
  assert.ok(blendScore({ score: 9.5, required_total: 5, required_met: 5, level: 'wrong' }) <= 6.5, 'wrong level is capped');
  assert.ok(blendScore({ score: 8 }) > 0, 'works without counts');
});

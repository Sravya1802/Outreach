import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugsFor, normTitle, sameTitle, resolveToBoard, _cache } from '../services/boardResolver.js';

test('company → board slugs', () => {
  assert.deepEqual(slugsFor('Ramp'), ['ramp']);
  assert.ok(slugsFor('Databricks, Inc.').includes('databricks'));
  assert.ok(slugsFor('Scale AI').includes('scaleai') && slugsFor('Scale AI').includes('scale-ai'));
  assert.ok(slugsFor('The Trade Desk').includes('tradedesk'));
});

test('titles match across seasons, years and parentheticals', () => {
  assert.equal(normTitle('Software Engineer Intern (Summer 2027) - USA'), 'software engineer intern');
  assert.ok(sameTitle('Software Engineering Intern, Backend (Summer 2027)', 'Software Engineering Intern, Backend'));
  assert.ok(sameTitle('Data Scientist Intern', 'Data Scientist Intern - Fall 2026'));
  assert.ok(!sameTitle('Software Engineer Intern', 'Marketing Intern'));
});

test('resolveToBoard finds the posting on a Greenhouse board and caches', async () => {
  _cache.clear();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes('greenhouse.io/v1/boards/ramp/jobs')) return { ok: true, json: async () => ({ jobs: [{ title: 'Software Engineer Intern (Summer 2027)', absolute_url: 'https://jobs.ashbyhq.com/ramp/abc' }, { title: 'Recruiter', absolute_url: 'https://x/r' }] }) };
    return { ok: false };
  };
  const r = await resolveToBoard('Ramp', 'Software Engineer Intern', { fetchImpl });
  assert.deepEqual(r, { kind: 'greenhouse', url: 'https://jobs.ashbyhq.com/ramp/abc', title: 'Software Engineer Intern (Summer 2027)' });
  const before = calls;
  assert.equal(await resolveToBoard('Ramp', 'Marketing Intern', { fetchImpl }), null);
  assert.equal(calls, before, 'second lookup for the same company uses the cache');
  assert.equal(await resolveToBoard('Nobody Corp', 'Intern', { fetchImpl }), null);
});

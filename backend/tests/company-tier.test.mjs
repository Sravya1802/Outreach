import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z'; // imports db.js; no queries here
const { companyKey, tierTable, tierFor, industryFor } = await import('../services/companyTier.js');

const table = tierTable([{ company_name: 'NVIDIA', tier: 'faang' }, { company_name: 'Hudson River Trading', tier: 'quant' }, { company_name: 'Stripe', tier: 'faang' }]);

test('company names are compared without suffixes or brackets', () => {
  assert.equal(companyKey('Amazon Web Services (AWS), Inc.'), 'amazon web services');
  assert.equal(companyKey('Citadel Securities LLC'), 'citadel securities');
});

test('FAANG+ and Quant whatever the posting calls the company', () => {
  assert.equal(tierFor('Amazon Web Services (AWS)', table), 'faang');
  assert.equal(tierFor('Amazon', table), 'faang');
  assert.equal(tierFor('AWS', table), 'faang');
  assert.equal(tierFor('Google DeepMind', table), 'faang');
  assert.equal(tierFor('YouTube', table), 'faang');
  assert.equal(tierFor('NVIDIA Corporation', table), 'faang');
  assert.equal(tierFor('Stripe', table), 'faang');
  assert.equal(tierFor('Hudson River Trading', table), 'quant');
  assert.equal(tierFor('Citadel Securities', table), 'quant');
  assert.equal(tierFor('Jane Street', table), 'quant');
  assert.equal(tierFor('Garmin', table), null);
  assert.equal(tierFor('Fidelity Investments', table), null);
  assert.equal(tierFor('Metadata Labs', table), null);
  assert.equal(tierFor('', table), null);
});

test('industry from the known-company map', () => {
  assert.equal(industryFor('Amazon Web Services (AWS)'), 'Tech & Software');
  assert.equal(industryFor('Some Startup Nobody Knows'), null);
});

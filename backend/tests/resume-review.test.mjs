import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z'; // the engine imports db.js; these tests make no queries
const { better } = await import('../services/resumeEngine.js');

const pass = (score, { pages = 1, lint = 0 } = {}) => ({ score: { score }, pages, lint: Array(lint).fill({}) });

test('the revision wins unless it breaks one page, the ATS bar or the rules', () => {
  const first = pass(93);
  // Answering the review can cost a keyword point; it still wins while above the bar.
  const r = pass(92);
  assert.equal(better(first, r), r);
  assert.equal(better(first, pass(90)), first, 'drops to the bar');
  assert.equal(better(first, pass(95, { pages: 2 })), first, 'two pages');
  assert.equal(better(first, pass(94, { lint: 2 })), first, 'new rule problems');
  // Under the bar, the revision has to hold or raise the score.
  const low = pass(80);
  const up = pass(84);
  assert.equal(better(low, up), up);
  assert.equal(better(low, pass(78)), low);
});

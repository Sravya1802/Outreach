import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// HTTP header values must be ASCII: fetch throws on characters like the curly
// apostrophe in "Scout’n’Jobs" before the request is even sent.
test('no non-ASCII characters on header lines in backend code', () => {
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js')) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
          if (/'User-Agent'|setHeader\(/.test(l) && /[^\x00-\x7f]/.test(l)) bad.push(`${p}:${i + 1}`);
        });
      }
    }
  };
  walk(path.resolve(import.meta.dirname, '..'));
  assert.deepEqual(bad, []);
});

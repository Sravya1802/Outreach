import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
const { versionReason, changeBullets, inPlaceEdit, latexLines } = await import('../services/roleTools.js');

test('why a version exists: your comment (quoted), first tailoring, master update, fix', () => {
  const comments = [{ addressed_in_version: 2, body: 'i have all this experience add it' }];
  assert.deepEqual(versionReason({ version: 2, change_log: 'v2: Comment 164: kept skills' }, comments), { kind: 'comment', label: 'Your comment', quote: 'i have all this experience add it' });
  assert.equal(versionReason({ version: 1, change_log: 'v1: scheduled run' }).label, 'First tailoring');
  assert.equal(versionReason({ version: 3, change_log: 'v3: master_latex now has the Azure chatbot' }).label, 'Master update');
  assert.equal(versionReason({ version: 3, change_log: 'v3: fixed the compile error in Projects' }).label, 'Fix');
  assert.equal(versionReason({ version: 2, change_log: 'v2: answered comment 12' }).label, 'Your comment');
});

test('what changed: up to 3 lines from the change log and the report, without the in-place note', () => {
  const v = { change_log: 'v2: Comment 164: C# kept in skills; Nov 16: Cancer Center chatbot deployment changed from AWS to Azure (Sravya)', report: { changes_made: ['v2: no LaTeX change', 'Comment 164: C# kept in skills'] } };
  assert.deepEqual(changeBullets(v), ['Comment 164: C# kept in skills', 'no LaTeX change']);
  assert.deepEqual(changeBullets({ change_log: 'v1: scheduled run', report: { changes_made: ['a', 'b', 'c', 'd'] } }), ['a', 'b', 'c']);
});

test('an in-place edit (the Nov 16 Azure fix) shows on the version it changed', () => {
  const v = { edited_at: '2026-11-16T18:41:33Z', change_log: 'v1: scheduled run; Nov 16: Cancer Center chatbot deployment changed from AWS to Azure (Sravya)' };
  assert.deepEqual(inPlaceEdit(v), { at: '2026-11-16T18:41:33Z', text: 'Nov 16: Cancer Center chatbot deployment changed from AWS to Azure (Sravya)' });
  assert.equal(inPlaceEdit({ edited_at: null, change_log: 'x' }), null);
});

test('a LaTeX resume as plain lines for comparing', () => {
  const tex = String.raw`\documentclass{article}\begin{document}
\section{Experience}
\textbf{Mercedes Benz} \hfill Bengaluru \\
\begin{itemize}
\item Built \textbf{20+} dashboards in Tableau % comment
\item Led migration of 500\% users
\end{itemize}
\end{document}`;
  assert.deepEqual(latexLines(tex), ['## Experience', 'Mercedes Benz · Bengaluru', '• Built 20+ dashboards in Tableau', '• Led migration of 500% users']);
});

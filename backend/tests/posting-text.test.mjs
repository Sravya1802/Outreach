import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeJobDescription, looksClosed, linkedInJobId } from '../services/postingText.js';

// Real texts the evening list was scored on (2026-10-15).
const PAY_BOX = 'Whatnot provided pay range\n\nThis range is provided by Whatnot. Your actual pay will be based on your skills and experience — talk with your recruiter to learn more.\n\nBase pay range\n\n$155,000.00/yr - $160,000.00/yr';
const SHELL = 'Current OpeningsInterested in becoming an Instacart Shopper? Start the process here.Loading job openings…This link leads to the machine-readable files that are made available in response to the federal Transparency in Coverage Rule';
const COMEET = "An error occured. Please try again\n\n{{company.name}}\n\nThanks for your interest in {{company.name}}.\n\nWe're sorry, but there are currently no open positions.\n\nContact us on our website.\n\nWe don't have any open positions at this time.";
const REAL = `Software Engineer, New Grad. About the role: you will build backend services in Go and Python for our live marketplace.
Responsibilities: design APIs, write tests, ship features with product and design partners every week.
Requirements: a bachelor's degree in computer science or similar, experience with Python, Go or Java, strong skills in data structures.
Preferred: experience with Kafka, PostgreSQL and AWS. We're looking for curious engineers who like owning problems end to end.
Benefits: health, dental and vision coverage, a learning budget and a hybrid schedule in New York or San Francisco.`;

test('a pay box, a page shell or an error page is not a job description', () => {
  for (const t of [PAY_BOX, SHELL, COMEET, '', 'x'.repeat(2000)]) assert.equal(looksLikeJobDescription(t), false, t.slice(0, 40));
  assert.equal(looksLikeJobDescription(REAL), true);
});

test('closed postings are told apart', () => {
  assert.equal(looksClosed(COMEET), true);
  assert.equal(looksClosed(REAL), false);
});

test('LinkedIn job ids from the URL shapes the scrapers save', () => {
  assert.equal(linkedInJobId('https://www.linkedin.com/jobs/view/4460205602'), '4460205602');
  assert.equal(linkedInJobId('https://www.linkedin.com/jobs/view/software-engineer-at-whatnot-4460205602/'), '4460205602');
  assert.equal(linkedInJobId('https://www.linkedin.com/jobs/search/?currentJobId=4460205602'), '4460205602');
  assert.equal(linkedInJobId('https://boards.greenhouse.io/x/jobs/1'), null);
});


test('AI rate limits: wait as long as Groq asks, never for billing errors', async () => {
  process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z';
  const { rateLimitWait } = await import('../services/llm.js');
  assert.equal(rateLimitWait({ status: 429, message: 'Rate limit reached ... Please try again in 12.5s.' }), 13500);
  assert.equal(rateLimitWait({ status: 429, message: 'Please try again in 1m2.0s' }), 60000);
  assert.equal(rateLimitWait({ status: 429, message: 'You have no credits remaining' }), null);
  assert.equal(rateLimitWait({ status: 500, message: 'server error' }), null);
});

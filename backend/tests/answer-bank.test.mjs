import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z' // answerBank imports db.js; these tests make no queries
const { normalizeQuestion, pickAnswer, similarity } = await import('../services/answerBank.js')

test('normalizes the same question from different forms to one key', () => {
  const k = normalizeQuestion('Tell us about a product you love and why. (150 words)*')
  assert.equal(k, 'tell us about a product you love and why')
  assert.equal(normalizeQuestion('  Tell us about a product you LOVE, and why? '), k)
  assert.equal(normalizeQuestion('What is your cumulative GPA? (optional)'), 'what is your cumulative gpa')
  // Keeps meaningful symbols
  assert.equal(normalizeQuestion('Experience with C++ / C#?'), 'experience with c++ / c#')
})

test('picks an exact match first, then a close one, never a weak one', () => {
  const rows = [
    { id: 1, question: 'What is your cumulative GPA?', question_key: 'what is your cumulative gpa', answer: '3.9', status: 'answered' },
    { id: 2, question: 'How did you hear about us?', question_key: 'how did you hear about us', answer: 'LinkedIn', status: 'answered' },
    { id: 3, question: 'Why do you want to work here?', question_key: 'why do you want to work here', answer: null, status: 'pending' },
  ]
  assert.equal(pickAnswer('What is your cumulative GPA? *', rows).id, 1)
  assert.equal(pickAnswer('How did you hear about this job?', rows)?.id, 2, 'same intent, reuse')
  assert.equal(pickAnswer('How many hours per week can you work?', rows), null, 'different question')
  assert.equal(pickAnswer('Cumulative GPA', rows), null, 'too little overlap')
  assert.equal(pickAnswer('What is your cumulative undergraduate GPA?', rows)?.id, 1)
  assert.equal(pickAnswer('Why do you want to work here?', rows), null, 'pending rows have no answer')
  assert.equal(pickAnswer('', rows), null)
})

test('similarity ignores filler words', () => {
  assert.equal(similarity('Are you willing to relocate?', 'Willing to relocate'), 1)
  assert.ok(similarity('Desired salary', 'Do you require sponsorship?') === 0)
})

import { describe, expect, it } from 'vitest'
import { outreachMatch, outreachState, appliedLine, canMarkApplied, yearMatch, yearsLabel, approvedLine, atsOk, backlog, bulkLine, canApprove, cleanPosting, isRunning, keywordStates, markPosting, needsOutreach, nextRunLine, outreachLine, readReport, reviewTab, runLine, safeToBulk } from './review'

describe('reviewTab', () => {
  it('puts each status in its tab', () => {
    expect(reviewTab({ status: 'ready', open_comments: 0 })).toBe('ready')
    expect(reviewTab({ status: 'revision_requested', open_comments: 1 })).toBe('revising')
    expect(reviewTab({ status: 'approved', open_comments: 0 })).toBe('approved')
    expect(reviewTab({ status: 'applied', open_comments: 0 })).toBe('applied')
    expect(reviewTab({ status: 'closed', open_comments: 0 })).toBe('closed')
  })
  it('keeps a role in Revising while a run answers its comments', () => {
    expect(reviewTab({ status: 'in_progress', open_comments: 2 })).toBe('revising')
  })
  it('shows roles before their first resume', () => {
    expect(reviewTab({ status: 'queued', open_comments: 0 })).toBe('waiting')
    expect(reviewTab({ status: 'in_progress', open_comments: 0 })).toBe('working')
  })
})

describe('backlog', () => {
  it('counts written and closed roles as done', () => {
    const row = (status: 'queued' | 'in_progress' | 'ready' | 'closed') => ({ status, open_comments: 0 })
    expect(backlog([row('ready'), row('closed'), row('queued'), row('in_progress')])).toEqual({ done: 2, total: 4, percent: 50 })
  })
  it('is empty without roles', () => {
    expect(backlog([])).toEqual({ done: 0, total: 0, percent: 0 })
  })
})

describe('runLine', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  const run = { id: '5', started_at: '2026-11-05T11:50:00Z', finished_at: null, roles_done: 0, roles_failed: 0 }
  it('says when no run has happened', () => {
    expect(runLine(null, now)).toBe('No run has started yet.')
    expect(isRunning(null, now)).toBe(false)
  })
  it('shows a run still going', () => {
    expect(runLine(run, now)).toBe('Run 5 started 10m ago.')
    expect(isRunning(run, now)).toBe(true)
  })
  it('shows how a finished run went', () => {
    const done = { ...run, finished_at: '2026-11-05T11:30:00Z', roles_done: 12 }
    expect(runLine(done, now)).toBe('Run 5 finished 30m ago: 12 roles done.')
    expect(runLine({ ...done, roles_done: 1, roles_failed: 2 }, now)).toBe('Run 5 finished 30m ago: 1 role done, 2 failed.')
    expect(isRunning(done, now)).toBe(false)
  })
  it('stops calling a run active after the 2 hours', () => {
    const stuck = { ...run, started_at: '2026-11-05T09:00:00Z' }
    expect(isRunning(stuck, now)).toBe(false)
    expect(runLine(stuck, now)).toBe('Run 5 started 3h ago and never finished. Its roles go back in line on the next run.')
  })
})

describe('approvedLine', () => {
  const result = { emails: 2, inGmail: 2, notes: 2, skipped: [] }
  it('says where the emails went', () => {
    expect(approvedLine(result)).toBe('Approved. 2 emails on the way to Outbox and Gmail Drafts. OK each one in Outbox to send it.')
    expect(approvedLine({ ...result, emails: 1, inGmail: 0 })).toBe('Approved. 1 email on the way to Outbox and Gmail Drafts. OK each one in Outbox to send it.')
  })
  it('says when there is nothing to draft', () => {
    expect(approvedLine({ ...result, emails: 0, inGmail: 0, notes: 0 })).toBe('Approved. No outreach went out, so it applies only when you press Apply without referral.')
  })
  it('says when only LinkedIn notes went, and when someone was already asked', () => {
    expect(approvedLine({ ...result, emails: 0, inGmail: 0 })).toBe('Approved. LinkedIn notes are waiting in People → Contacts; mark each one sent, and applying waits 2 business days from then.')
    expect(approvedLine({ ...result, emails: 1, inGmail: 1, repeated: 1 })).toBe('Approved. 1 email on the way to Outbox and Gmail Drafts. OK each one in Outbox to send it. 1 person already asked for another role wasn’t contacted again.')
    expect(approvedLine({ ...result, emails: 0, inGmail: 0, notes: 0, repeated: 2 })).toBe('Approved. 2 people already asked for another role weren’t contacted again. No outreach went out, so it applies only when you press Apply without referral.')
  })
})

describe('atsOk', () => {
  it('needs more than 90', () => {
    expect(atsOk(91)).toBe(true)
    expect(atsOk(90)).toBe(false)
    expect(atsOk(null)).toBe(false)
  })
})

describe('readReport', () => {
  it('reads what a run wrote', () => {
    const r = readReport({
      top_5_hiring_needs: ['Ship agents'], gaps: ['Monitoring'], changes_made: ['Led with the chatbot'], verdict: 'Apply with a referral',
      keyword_table: [{ keyword: 'Python', where: 'Projects' }, { where: 'Nowhere' }, null], eligibility_flag: 'No sponsorship',
      scores: { ats_reason: 'Covers the core skills' },
    })
    expect(r.needs).toEqual(['Ship agents'])
    expect(r.keywords).toEqual([{ keyword: 'Python', where: 'Projects' }])
    expect(r.eligibility).toBe('No sponsorship')
    expect(r.atsReason).toBe('Covers the core skills')
  })
  it('reads a keyword table written as an object', () => {
    expect(readReport({ keyword_table: { AWS: 'Summary, Skills', Kafka: '' } }).keywords).toEqual([{ keyword: 'AWS', where: 'Summary, Skills' }, { keyword: 'Kafka', where: null }])
  })
  it('survives a missing or odd report', () => {
    for (const bad of [null, undefined, 'x', { gaps: 'not a list', keyword_table: 7, scores: 3 }]) {
      expect(readReport(bad)).toMatchObject({ needs: [], gaps: [], changes: [], keywords: [], verdict: null })
    }
  })
})

describe('bulk approve', () => {
  const row = { status: 'ready' as const, check_status: 'passed' as const, referral_mode: 'recruiters' as const, outreach: 2, ats_after: 94, eligibility: null, sponsorship: null }
  it('takes a passed resume that is ready', () => {
    expect(canApprove(row)).toBe(true)
    expect(canApprove({ ...row, check_status: 'flagged' })).toBe(false)
    expect(canApprove({ ...row, status: 'approved' })).toBe(false)
  })
  it('holds back a recruiter role with no outreach, but not one that emails nobody', () => {
    expect(needsOutreach({ ...row, outreach: 0 })).toBe(true)
    expect(canApprove({ ...row, outreach: 0 })).toBe(false)
    expect(safeToBulk({ ...row, outreach: 0 })).toBe(false)
    expect(canApprove({ ...row, outreach: 0, referral_mode: 'my_contact' })).toBe(true)
    expect(canApprove({ ...row, outreach: 0, referral_mode: 'none' })).toBe(true)
  })
  it('says where a role with no outreach stands', () => {
    expect(outreachLine({ outreach_due: true, contacts_at: '2026-11-06' })).toBe('Emails coming')
    expect(outreachLine({ outreach_due: false, contacts_at: '2026-11-06' })).toBe('No recruiter found')
    expect(outreachLine({ outreach_due: false, contacts_at: null })).toBe('No outreach yet')
  })
  it('leaves anything under the ATS rule or with an eligibility question out of Select all', () => {
    expect(safeToBulk(row)).toBe(true)
    expect(safeToBulk({ ...row, ats_after: 90 })).toBe(false)
    expect(safeToBulk({ ...row, eligibility: 'US citizens only' })).toBe(false)
    expect(safeToBulk({ ...row, sponsorship: 'citizens_only' })).toBe(false)
    expect(safeToBulk({ ...row, sponsorship: 'sponsors' })).toBe(true)
  })
  it('says how it went', () => {
    const r = { emails: 2, inGmail: 2, notes: 2, skipped: [] }
    expect(bulkLine([r, r], 0)).toBe('Approved 2 roles. 4 emails on the way to Outbox and Gmail Drafts over the next few minutes, each waiting for your OK.')
    expect(bulkLine([{ ...r, emails: 0 }], 1)).toBe('Approved 1 role. 1 couldn’t be approved.')
    expect(bulkLine([r, { ...r, emails: 0, repeated: 2 }], 0)).toBe('Approved 2 roles. 2 emails on the way to Outbox and Gmail Drafts over the next few minutes, each waiting for your OK. 2 people already asked for another role weren’t contacted again.')
  })
})

describe('nextRunLine', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  it('says when one is due', () => {
    expect(nextRunLine(null, now)).toBe('Not scheduled')
    expect(nextRunLine('2026-11-05T11:00:00Z', now)).toBe('Due now')
    expect(nextRunLine('2026-11-05T15:05:00Z', now)).toMatch(/^About \d/)
  })
})

describe('cleanPosting', () => {
  it('keeps plain text and its line breaks as they are', () => {
    expect(cleanPosting('Title\n\nLine one\nLine two')).toBe('Title\n\nLine one\nLine two')
  })
  it('turns tags into text with breaks', () => {
    expect(cleanPosting('<h3>About</h3>\n<p>We <strong>build</strong> tools</p>\n<p>One<br/>Two</p>')).toBe('About\n\nWe build tools\n\nOne\nTwo')
    expect(cleanPosting('<ul>\n<li>Python</li>\n<li><span>Go</span></li>\n</ul>')).toBe('• Python\n• Go')
  })
  it('drops scripts and styles with what is inside them', () => {
    expect(cleanPosting('<style>p { color: red }</style>Hi<script>alert(1)</script>')).toBe('Hi')
  })
  it('decodes entities once, and leaves ones it doesn’t know', () => {
    expect(cleanPosting('R&amp;D &mdash; &#8217;x&#x2019; &amp;lt; &nope; &#99999999;')).toBe('R&D — ’x’ &lt; &nope; &#99999999;')
  })
  it('leaves a less-than that isn’t a tag', () => {
    expect(cleanPosting('Teams < 10 people, C++ > 3 years')).toBe('Teams < 10 people, C++ > 3 years')
  })
  it('splits sentences a scrape ran together', () => {
    expect(cleanPosting('Driven by excellence.At Aquatic you ship.Are you ready?Join us:Apply now')).toBe('Driven by excellence.\nAt Aquatic you ship.\nAre you ready?\nJoin us:\nApply now')
    expect(cleanPosting('Computer science degreeStrong PythonExperience with AWSFamiliarity')).toBe('Computer science degree\nStrong Python\nExperience with AWSFamiliarity')
  })
  it('leaves names and normal text in one piece', () => {
    const fine = 'JavaScript, GitHub, LinkedIn, TikTok, PyTorch, TensorFlow, PayPal, DevOps, ByteDance, ASP.NET, Node.js, e.g. this, U.S. citizen, 3.5 years, 10:30 AM, https://acme.com/Jobs'
    expect(cleanPosting(fine)).toBe(fine)
  })
  it('survives no posting', () => {
    expect(cleanPosting(null)).toBe('')
    expect(cleanPosting(undefined)).toBe('')
  })
})

describe('keywordStates', () => {
  const list = [{ keyword: 'AWS / GCP' }, { keyword: 'Kafka' }]
  it('uses the PDF check, each side on its own', () => {
    expect(keywordStates(list, { present: ['AWS'], missing: ['GCP', 'Kafka'] })).toEqual([
      { keyword: 'AWS', state: 'found' }, { keyword: 'GCP', state: 'missing' }, { keyword: 'Kafka', state: 'missing' },
    ])
  })
  it('never calls a keyword found without a check under the current rules', () => {
    for (const check of [null, undefined, { missing: [] }, { missing: ['Kafka'] }]) {
      expect(keywordStates(list, check).map(k => k.state)).toEqual(['unchecked', 'unchecked'])
    }
  })
})

describe('markPosting', () => {
  const marked = (text: string, ...keywords: string[]) =>
    markPosting(text, keywords.map(keyword => ({ keyword, state: 'found' as const }))).parts.filter(p => 'state' in p).map(p => p.text)

  it('puts the text back together with its states', () => {
    const { parts, placed } = markPosting('Python and Kafka.', [{ keyword: 'Python', state: 'found' }, { keyword: 'Kafka', state: 'missing' }, { keyword: 'Legal domain', state: 'missing' }])
    expect(parts).toEqual([{ text: 'Python', state: 'found' }, { text: ' and ' }, { text: 'Kafka', state: 'missing' }, { text: '.' }])
    expect([...placed]).toEqual(['Python', 'Kafka'])
  })
  it('matches whole words only', () => {
    expect(marked('JavaScript and Javanese', 'Java')).toEqual([])
    expect(marked('C++ and C# not C', 'C')).toEqual(['C'])
    expect(marked('C++ and C#', 'C++', 'C#')).toEqual(['C++', 'C#'])
  })
  it('splits "A / B" and brackets but not CI/CD', () => {
    expect(marked('Azure then GCP', 'AWS / Azure / GCP')).toEqual(['Azure', 'GCP'])
    expect(marked('unit testing with Google Test', 'Unit testing (Google Test)')).toEqual(['unit testing', 'Google Test'])
    expect(marked('our CI/CD, a CI tool', 'CI/CD')).toEqual(['CI/CD'])
  })
  it('lets the longer term win', () => {
    expect(marked('Apache Spark and Spark', 'Spark', 'Apache Spark')).toEqual(['Apache Spark', 'Spark'])
  })
  it('matches across case, hyphens, spaces and plurals', () => {
    expect(marked('end-to-end', 'End to end')).toEqual(['end-to-end'])
    expect(marked('python', 'Python')).toEqual(['python'])
    expect(marked('an LLM and some APIs', 'LLMs', 'API')).toEqual(['LLM', 'APIs'])
  })
  it('needs the case to match on short terms', () => {
    expect(marked('we go to Go', 'Go')).toEqual(['Go'])
    expect(marked('a rag and RAG', 'RAG')).toEqual(['RAG'])
    expect(marked('use git', 'Git')).toEqual(['git'])
  })
  it('treats regex characters as text', () => {
    expect(marked('Node.js, Nodexjs', 'Node.js')).toEqual(['Node.js'])
  })
  it('handles no keywords and no text', () => {
    expect(markPosting('Hello', []).parts).toEqual([{ text: 'Hello' }])
    expect(markPosting('', [{ keyword: 'Python', state: 'found' }]).parts).toEqual([])
  })
})

describe('year filter', () => {
  it('keeps roles that name the year, and unstated ones only when asked', () => {
    expect(yearMatch(['2027'], '2027')).toBe(true)
    expect(yearMatch(['2026', '2027'], '2027')).toBe(true)
    expect(yearMatch(['2026'], '2027')).toBe(false)
    expect(yearMatch([], '2027')).toBe(false)
    expect(yearMatch([], '2027-or-unstated')).toBe(true)
    expect(yearMatch(['2026'], '2027-or-unstated')).toBe(false)
    expect(yearMatch(['2026'], '')).toBe(true)
    expect(yearMatch(null, 'junk')).toBe(true)
  })
  it('labels one year or a range', () => {
    expect(yearsLabel(['2027'])).toBe('2027')
    expect(yearsLabel(['2026', '2027'])).toBe('2026–27')
  })
})

describe('I already applied', () => {
  it('is offered until the role has gone out or a run has it', () => {
    for (const status of ['queued', 'ready', 'revision_requested', 'approved'] as const) expect(canMarkApplied({ status })).toBe(true)
    for (const status of ['in_progress', 'applied', 'closed'] as const) expect(canMarkApplied({ status })).toBe(false)
    expect(canMarkApplied({ status: 'approved', finishing: true })).toBe(false)
  })
  it('says what is left in Outbox', () => {
    expect(appliedLine(0)).toBe('Marked as applied. Nothing will apply for you.')
    expect(appliedLine(2)).toBe('Marked as applied. Nothing will apply for you. 2 emails are still in Outbox: OK or discard them there.')
  })
})

describe('outreach filter', () => {
  const row = { referral_mode: 'recruiters' as const, outreach: 0, outreach_due: false, contacts_at: null as string | null }
  it('puts each role in one state', () => {
    expect(outreachState({ ...row, outreach: 2 })).toBe('written')
    expect(outreachState({ ...row, outreach_due: true, contacts_at: '2026-11-09' })).toBe('coming')
    expect(outreachState({ ...row, contacts_at: '2026-11-09' })).toBe('nobody')
    expect(outreachState(row)).toBe('none')
    expect(outreachState({ ...row, referral_mode: 'my_contact' })).toBe('self')
    expect(outreachState({ ...row, referral_mode: 'none', outreach: 1 })).toBe('written')
  })
  it('keeps everything with no filter', () => {
    expect(outreachMatch(row, '')).toBe(true)
    expect(outreachMatch(row, 'written')).toBe(false)
    expect(outreachMatch({ ...row, outreach: 1 }, 'written')).toBe(true)
  })
})

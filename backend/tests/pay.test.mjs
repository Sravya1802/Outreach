import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPay, payFromText } from '../services/payParse.js'

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z' // payEnricher imports db.js; no queries here
const { boardFor, payFromAshby, payFromGreenhouse, payFromLever, postingApiFor } = await import('../services/payEnricher.js')
const { toCatalogRow } = await import('../services/jobSpy.js')

test('formats pay across currencies and intervals', () => {
  assert.equal(formatPay({ min: 22, max: 28, interval: 'hourly' }), '$22–28/hr')
  assert.equal(formatPay({ min: 120000, max: 150000, interval: 'yearly' }), '$120k–150k/yr')
  assert.equal(formatPay({ min: 120000, max: 120000, interval: 'year' }), '$120k/yr')
  assert.equal(formatPay({ min: 600000, max: 800000, interval: 'yearly', currency: 'INR' }), '₹6L–8L/yr')
  assert.equal(formatPay({ min: 25000, max: 30000, interval: 'monthly', currency: 'INR' }), '₹25k–30k/mo')
  assert.equal(formatPay({ min: 55000, interval: 'year', currency: 'EUR' }), '€55k/yr')
  assert.equal(formatPay({ min: 150000, max: 100000, interval: 'year' }), '$100k–150k/yr', 'swapped')
  assert.equal(formatPay({ min: null, max: 0 }), null)
})

test('reads pay ranges out of job descriptions', () => {
  assert.equal(payFromText('The hourly rate for this role is $45 - $55 per hour.'), '$45–55/hr')
  assert.equal(payFromText('Base salary range: $120,000—$150,000 USD'), '$120k–150k/yr')
  assert.equal(payFromText('<p>Compensation: $135K to $165K annually</p>'), '$135k–165k/yr')
  assert.equal(payFromText('Pay: $40/hour'), '$40/hr')
  assert.equal(payFromText('We raised $50 to $100 million from investors.'), null)
  assert.equal(payFromText('$5 - $10 Starbucks card'), null)
  assert.equal(payFromText('No pay info here.'), null)
})

test('recognises job-board URLs', () => {
  assert.deepEqual(boardFor('https://job-boards.greenhouse.io/figma/jobs/5549990004'), { ats: 'greenhouse', board: 'figma', id: '5549990004' })
  assert.deepEqual(boardFor('https://boards.greenhouse.io/stripe/jobs/7012345?gh_src=x'), { ats: 'greenhouse', board: 'stripe', id: '7012345' })
  assert.deepEqual(boardFor('https://job-boards.greenhouse.io/embed/job_app?for=ramp&token=123'), { ats: 'greenhouse', board: 'ramp', id: '123' })
  assert.deepEqual(boardFor('https://jobs.ashbyhq.com/ramp/1f2e3d4c-aaaa/application'), { ats: 'ashby', board: 'ramp', id: '1f2e3d4c-aaaa' })
  assert.deepEqual(boardFor('https://jobs.lever.co/palantir/6ed76ce8-4156/apply'), { ats: 'lever', board: 'palantir', id: '6ed76ce8-4156' })
  assert.equal(boardFor('https://www.linkedin.com/jobs/view/1'), null)
  assert.equal(boardFor('not a url'), null)
})

test('reads each board API’s pay fields', () => {
  assert.equal(payFromGreenhouse({ pay_input_ranges: [{ min_cents: 16500000, max_cents: 19000000, currency_type: 'USD', title: 'Annual Base Salary Range:' }] }), '$165k–190k/yr')
  assert.equal(payFromGreenhouse({ pay_input_ranges: [{ min_cents: 4500, max_cents: 5500, currency_type: 'USD', title: 'Intern pay' }] }), '$45–55/hr')
  assert.equal(payFromGreenhouse({ pay_input_ranges: [], content: '&lt;p&gt;The pay range is $50 - $60 per hour.&lt;/p&gt;' }), '$50–60/hr')
  assert.equal(payFromAshby({ compensation: { compensationTiers: [{ components: [
    { compensationType: 'EquityPercentage', interval: 'NONE' },
    { compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 211400, maxValue: 290600 },
  ] }] } }), '$211k–291k/yr')
  assert.equal(payFromLever({ salaryRange: { min: 40, max: 50, currency: 'USD', interval: 'per-hour-wage' } }), '$40–50/hr')
  assert.equal(payFromLever({ descriptionPlain: 'Salary: $130,000 - $160,000' }), '$130k–160k/yr')
  assert.equal(payFromLever({ descriptionPlain: 'nothing' }), null)
})

test('JobSpy rows keep their currency', () => {
  const r = toCatalogRow({ site: 'indeed', title: 'Software Engineer Intern', company: 'Zoho', job_url: 'https://in.indeed.com/viewjob?jk=9', min_amount: 25000, max_amount: 30000, interval: 'monthly', currency: 'INR' }, 'intern', 'india')
  assert.equal(r.salary_range, '₹25k–30k/mo')
})

test('per-posting APIs for Workday and SmartRecruiters', () => {
  assert.deepEqual(postingApiFor('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/SoC-Engineer_JR2001234'),
    { ats: 'workday', url: 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/SoC-Engineer_JR2001234' })
  assert.deepEqual(postingApiFor('https://acme.wd1.myworkdayjobs.com/Careers/job/Remote/Intern_R-1'),
    { ats: 'workday', url: 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/job/Remote/Intern_R-1' })
  assert.deepEqual(postingApiFor('https://jobs.smartrecruiters.com/Visa/744000012345678-software-engineer-intern'),
    { ats: 'smartrecruiters', url: 'https://api.smartrecruiters.com/v1/companies/Visa/postings/744000012345678' })
  assert.equal(postingApiFor('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite'), null)
  assert.equal(postingApiFor('https://www.linkedin.com/jobs/view/1'), null)
})

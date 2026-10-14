// Questions most application forms ask that aren't plain profile fields.
// Shown as prompts on the Answers page until the user has answered them.
import { similarity } from './match'

export interface CommonQuestion { question: string; hint?: string }

export const COMMON_QUESTIONS: CommonQuestion[] = [
  { question: 'How did you hear about this position?', hint: 'Usually “LinkedIn”, “Company website” or “Referral”.' },
  { question: 'Why do you want to work here?', hint: 'A template; the company paragraph gets rewritten from each role’s evaluation.' },
  { question: 'Tell us about a project you are proud of.' },
  { question: 'Describe a challenging technical problem you solved.' },
  { question: 'What is your earliest start date?' },
  { question: 'What are your salary expectations?', hint: 'A range or “Open / negotiable”.' },
  { question: 'Are you willing to work in-office 5 days a week?' },
  { question: 'Have you previously worked for this company?' },
  { question: 'Do you know anyone who currently works at this company?' },
  { question: 'Are you at least 18 years of age?' },
  { question: 'Can you work 40 hours per week during the internship?' },
  { question: 'What programming languages are you most comfortable with?' },
]

/** Common questions with no answered row that matches them closely. */
export function unansweredCommon(rows: { question: string; status: string }[]): CommonQuestion[] {
  const answered = rows.filter(r => r.status === 'answered')
  return COMMON_QUESTIONS.filter(q => !answered.some(r => similarity(q.question, r.question) >= 0.75))
}

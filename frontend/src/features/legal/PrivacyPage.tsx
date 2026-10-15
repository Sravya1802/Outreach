import { APP_NAME, CONTACT_EMAIL, LegalLayout } from './LegalLayout'

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy policy">
      <p>{APP_NAME} helps students and new grads find internships and new-grad roles, tailor resumes and reach out to people at companies. This page says what we collect, why, and what you control.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account:</strong> your email address and, if you sign in with Google, your name and profile picture from Google. We don’t get your Google password.</li>
        <li><strong>What you enter:</strong> profile details (education, experience, work authorization, links), saved answers to application questions, and job search preferences.</li>
        <li><strong>Your resume:</strong> the PDFs you upload and the tailored versions and cover letters made for each role, stored in our cloud storage so you can see which file went with which application.</li>
        <li><strong>GitHub (optional):</strong> if you connect it, the names, descriptions, languages and README text of your public repositories, used to pick projects for your resume. We don’t read private repositories.</li>
        <li><strong>Gmail (optional):</strong> if you connect it with a Google app password, we store that password encrypted. We use it only to send the emails you write or schedule, to email you your own lists and alerts, and to read replies to emails sent through {APP_NAME}, plus LinkedIn’s notification emails, so a contact can be marked as replied. We don’t read, store or analyze the rest of your inbox, and we open it read-only.</li>
        <li><strong>Contacts you find:</strong> names, titles, work emails and LinkedIn links of people at companies you look up, gathered from public sources and email-finding services.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To score roles against your background, write tailored resumes and cover letters, and fill in applications you approve.</li>
        <li>To send outreach and follow-ups you approve, and to tell you when someone replies.</li>
        <li>We don’t sell your data, use it for advertising, or share it with employers except in applications you choose to send.</li>
      </ul>

      <h2>Services that process your data</h2>
      <p>We use Supabase (database, sign-in and file storage), Vercel (website hosting), and our own server for the app. To write and score resumes we send the relevant resume text and job description to AI providers (Anthropic, Groq and OpenAI), which don’t use API data to train their models by default. Contact lookups use Hunter, Prospeo, Apollo and Google search.</p>

      <h2>Google user data</h2>
      <p>If you sign in with Google, we receive only your name, email address and profile picture, and use them only to create and identify your account. {APP_NAME}’s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Disconnect Gmail or GitHub at any time under Integrations. You can also revoke the Gmail app password in your Google account.</li>
        <li>Download your data or erase sensitive profile fields under Settings → Privacy.</li>
        <li>To delete your account and everything stored with it, email <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a>. We delete it within 30 days.</li>
      </ul>

      <h2>Security</h2>
      <p>Connections are encrypted (HTTPS). Gmail app passwords and GitHub tokens are stored encrypted, and each account can only see its own data and files.</p>

      <h2>Contact</h2>
      <p>Questions about this policy: <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a>.</p>
    </LegalLayout>
  )
}

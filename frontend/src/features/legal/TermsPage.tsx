import { APP_NAME, CONTACT_EMAIL, LegalLayout } from './LegalLayout'

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of service">
      <p>By using {APP_NAME} you agree to these terms. If you don’t agree, don’t use it.</p>

      <h2>What it is</h2>
      <p>{APP_NAME} is a personal job-search tool: it lists open roles, scores them against your background, tailors your resume, and helps you apply and reach out to people. It’s provided as is, without guarantees that any role is accurate or still open, or that any application leads to an interview.</p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>The information in your profile and resume must be true. {APP_NAME} only rewords and reorders what you provide and is designed not to add skills or experience you don’t have. You’re responsible for what is sent in your name.</li>
        <li>Review what you approve. Applications and emails go out only after you approve them, and you can cancel scheduled emails any time before they’re sent.</li>
        <li>Use outreach respectfully: no spam, no harassment, and follow the rules of the sites and companies you contact. Daily limits exist to keep your accounts in good standing.</li>
        <li>Keep your sign-in details and app passwords private.</li>
      </ul>

      <h2>Accounts you connect</h2>
      <p>When you connect Gmail or GitHub, you allow {APP_NAME} to act for you only as described in the <a href="/privacy" className="text-accent">privacy policy</a>. Their own terms still apply to your use of those services.</p>

      <h2>Limits</h2>
      <p>AI features have monthly usage limits. We may change or stop features, and suspend accounts that misuse the service.</p>

      <h2>Liability</h2>
      <p>To the extent the law allows, {APP_NAME} isn’t liable for indirect or consequential losses, including missed opportunities, application outcomes, or actions taken by third-party services.</p>

      <h2>Contact</h2>
      <p><a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a></p>
    </LegalLayout>
  )
}

import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { PageSpinner } from '@/ui'
import { AppShell } from './AppShell'
import { useAuth } from './auth'
import { lazyWithRetry } from './lazy'
import { LEGACY_REDIRECTS } from './nav'
import { MarketGate } from '@/features/auth/MarketGate'

const HomePage = lazyWithRetry(() => import('@/features/home/HomePage'), 'HomePage')
const SettingsPage = lazyWithRetry(() => import('@/features/settings/SettingsPage'), 'SettingsPage')
const RolesPage = lazyWithRetry(() => import('@/features/jobs/RolesPage'), 'RolesPage')
const CompaniesPage = lazyWithRetry(() => import('@/features/jobs/CompaniesPage'), 'CompaniesPage')
const DetailsPage = lazyWithRetry(() => import('@/features/profile/DetailsPage'), 'DetailsPage')
const AnswersPage = lazyWithRetry(() => import('@/features/profile/AnswersPage'), 'AnswersPage')
const GithubPage = lazyWithRetry(() => import('@/features/profile/GithubPage'), 'GithubPage')
const ResumePage = lazyWithRetry(() => import('@/features/profile/ResumePage'), 'ResumePage')
const GmailPage = lazyWithRetry(() => import('@/features/integrations/GmailPage'), 'GmailPage')
const LinkedInPage = lazyWithRetry(() => import('@/features/integrations/LinkedInPage'), 'LinkedInPage')
const WhatsAppPage = lazyWithRetry(() => import('@/features/integrations/WhatsAppPage'), 'WhatsAppPage')
const UsagePage = lazyWithRetry(() => import('@/features/usage/UsagePage'), 'UsagePage')
const DashboardPage = lazyWithRetry(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage')
const HowItWorksPage = lazyWithRetry(() => import('@/features/howitworks/HowItWorksPage'), 'HowItWorksPage')
const AutoApplyPage = lazyWithRetry(() => import('@/features/applications/AutoApplyPage'), 'AutoApplyPage')
const EvaluatePage = lazyWithRetry(() => import('@/features/applications/EvaluatePage'), 'EvaluatePage')
const ContactsPage = lazyWithRetry(() => import('@/features/outreach/ContactsPage'), 'ContactsPage')
const TemplatesPage = lazyWithRetry(() => import('@/features/outreach/TemplatesPage'), 'TemplatesPage')
const OutboxPage = lazyWithRetry(() => import('@/features/outreach/OutboxPage'), 'OutboxPage')
const MessagesPage = lazyWithRetry(() => import('@/features/outreach/MessagesPage'), 'MessagesPage')
const LoginPage = lazyWithRetry(() => import('@/features/auth/LoginPage'), 'LoginPage')
const PrivacyPage = lazyWithRetry(() => import('@/features/legal/PrivacyPage'), 'PrivacyPage')
const TermsPage = lazyWithRetry(() => import('@/features/legal/TermsPage'), 'TermsPage')
const ResetPasswordPage = lazyWithRetry(() => import('@/features/auth/ResetPasswordPage'), 'ResetPasswordPage')

// Pages not rebuilt yet — rendered inside the new shell until they are.
const CompanyPage = lazyWithRetry(() => import('@/features/jobs/CompanyPage'), 'CompanyPage')

/** Redirect that keeps ?query and #hash (old deep links carry ids in them). */
function Redirect({ to }: { to: string }) {
  const { search, hash } = useLocation()
  const target = new URL(to, window.location.origin)
  new URLSearchParams(search).forEach((v, k) => target.searchParams.set(k, v))
  return <Navigate to={`${target.pathname}${target.search}${hash || target.hash}`} replace />
}

/** Old /category/:name links → the Companies list filtered to that industry. */
function CategoryRedirect() {
  const { name = '' } = useParams()
  const category = decodeURIComponent(name)
  if (category === 'yc-startups') return <Navigate to="/jobs/companies?find=1" replace />
  return <Navigate to={`/jobs/companies?category=${encodeURIComponent(category)}`} replace />
}


function SignedInRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/home" element={<HomePage />} />
        <Route path="/home/analytics" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        <Route path="/jobs" element={<Navigate to="/jobs/roles/intern" replace />} />
        <Route path="/jobs/roles" element={<Navigate to="/jobs/roles/intern" replace />} />
        <Route path="/jobs/roles/:kind" element={<RolesPage />} />
        <Route path="/jobs/companies" element={<CompaniesPage />} />
        <Route path="/jobs/find" element={<Navigate to="/jobs/companies?find=1" replace />} />
        <Route path="/jobs/alerts" element={<Navigate to="/jobs/roles/intern" replace />} />
        <Route path="/category/:name" element={<CategoryRedirect />} />
        <Route path="/company/:id" element={<CompanyPage />} />

        <Route path="/applications" element={<Navigate to="/applications/auto-apply" replace />} />
        <Route path="/applications/auto-apply" element={<AutoApplyPage />} />
        <Route path="/applications/evaluate" element={<EvaluatePage />} />
        {/* The Pipeline tab became the tracker at the bottom of Auto-apply. */}
        <Route path="/applications/pipeline" element={<Navigate to="/dashboard#tracker" replace />} />
        <Route path="/applications/board" element={<Navigate to="/dashboard?view=board#tracker" replace />} />
        <Route path="/applications/ranked" element={<Navigate to="/dashboard?sort=score#tracker" replace />} />

        <Route path="/people" element={<Navigate to="/people/contacts" replace />} />
        <Route path="/people/contacts" element={<ContactsPage />} />
        <Route path="/people/templates" element={<TemplatesPage />} />
        <Route path="/people/outbox" element={<OutboxPage />} />
        <Route path="/people/messages" element={<MessagesPage />} />

        <Route path="/profile" element={<Navigate to="/profile/details" replace />} />
        <Route path="/profile/details" element={<DetailsPage />} />
        <Route path="/profile/resume" element={<ResumePage />} />
        <Route path="/profile/answers" element={<AnswersPage />} />
        <Route path="/profile/github" element={<Navigate to="/integrations/github" replace />} />
        <Route path="/integrations" element={<Navigate to="/integrations/gmail" replace />} />
        <Route path="/integrations/gmail" element={<GmailPage />} />
        <Route path="/integrations/github" element={<GithubPage />} />
        <Route path="/integrations/linkedin" element={<LinkedInPage />} />
        <Route path="/integrations/whatsapp" element={<WhatsAppPage />} />
        <Route path="/integrations/services" element={<Navigate to="/usage" replace />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />

        <Route path="/settings/*" element={<SettingsPage />} />

        {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
          <Route key={from} path={from} element={<Redirect to={to} />} />
        ))}
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  const { session } = useAuth()
  const { pathname } = useLocation()

  // The recovery link lands here with or without a session; it handles both.
  if (pathname === '/reset-password') return <ResetPasswordPage />
  // Public: Google's consent screen links to these.
  if (pathname === '/privacy') return <PrivacyPage />
  if (pathname === '/terms') return <TermsPage />
  if (session === undefined) return <div className="flex h-full bg-canvas"><PageSpinner /></div>
  if (!session) return <LoginPage />
  return <MarketGate><SignedInRoutes /></MarketGate>
}

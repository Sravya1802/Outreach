import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { PageSpinner } from '@/ui'
import { AppShell } from './AppShell'
import { useAuth } from './auth'
import { lazyWithRetry } from './lazy'
import { LegacyPage } from './LegacyPage'
import { LEGACY_REDIRECTS } from './nav'

const HomePage = lazyWithRetry(() => import('@/features/home/HomePage'), 'HomePage')
const SettingsPage = lazyWithRetry(() => import('@/features/settings/SettingsPage'), 'SettingsPage')
const RolesPage = lazyWithRetry(() => import('@/features/jobs/RolesPage'), 'RolesPage')
const CompaniesPage = lazyWithRetry(() => import('@/features/jobs/CompaniesPage'), 'CompaniesPage')
const DetailsPage = lazyWithRetry(() => import('@/features/profile/DetailsPage'), 'DetailsPage')
const AnswersPage = lazyWithRetry(() => import('@/features/profile/AnswersPage'), 'AnswersPage')
const GithubPage = lazyWithRetry(() => import('@/features/profile/GithubPage'), 'GithubPage')
const LoginPage = lazyWithRetry(() => import('@/features/auth/LoginPage'), 'LoginPage')
const ResetPasswordPage = lazyWithRetry(() => import('@/features/auth/ResetPasswordPage'), 'ResetPasswordPage')

// Pages not rebuilt yet — rendered inside the new shell until they are.
const JobDashboard = lazyWithRetry(() => import('@/components/JobDashboard'), 'JobDashboard')
const CompanyDetail = lazyWithRetry(() => import('@/components/CompanyDetail'), 'CompanyDetail')
const CareerOps = lazyWithRetry(() => import('@/components/CareerOps'), 'CareerOps')
const AutoApplyPage = lazyWithRetry(() => import('@/components/AutoApplyPage'), 'AutoApplyPage')
const ApplicationPipeline = lazyWithRetry(() => import('@/components/ApplicationPipeline'), 'ApplicationPipeline')
const CareerOpsPage = lazyWithRetry(() => import('@/components/CareerOpsPage'), 'CareerOpsPage')
const OutreachPage = lazyWithRetry(() => import('@/components/OutreachPage'), 'OutreachPage')
const TemplatesPage = lazyWithRetry(() => import('@/components/TemplatesPage'), 'TemplatesPage')

/** Redirect that keeps ?query and #hash (old deep links carry ids in them). */
function Redirect({ to }: { to: string }) {
  const { search, hash } = useLocation()
  return <Navigate to={`${to}${search}${hash}`} replace />
}

/** Old /category/:name links → the Companies list filtered to that industry. */
function CategoryRedirect() {
  const { name = '' } = useParams()
  const category = decodeURIComponent(name)
  if (category === 'yc-startups') return <Navigate to="/jobs/companies?find=1" replace />
  return <Navigate to={`/jobs/companies?category=${encodeURIComponent(category)}`} replace />
}

const legacy = (node: ReactNode) => <LegacyPage>{node}</LegacyPage>

function SignedInRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/home" element={<HomePage />} />
        <Route path="/home/analytics" element={legacy(<JobDashboard />)} />

        <Route path="/jobs" element={<Navigate to="/jobs/roles/intern" replace />} />
        <Route path="/jobs/roles" element={<Navigate to="/jobs/roles/intern" replace />} />
        <Route path="/jobs/roles/:kind" element={<RolesPage />} />
        <Route path="/jobs/companies" element={<CompaniesPage />} />
        <Route path="/jobs/find" element={<Navigate to="/jobs/companies?find=1" replace />} />
        <Route path="/jobs/alerts" element={<Navigate to="/jobs/roles/intern" replace />} />
        <Route path="/category/:name" element={<CategoryRedirect />} />
        <Route path="/company/:id" element={legacy(<CompanyDetail />)} />

        <Route path="/applications" element={<Navigate to="/applications/evaluate" replace />} />
        <Route path="/applications/evaluate" element={legacy(<CareerOps />)} />
        <Route path="/applications/auto-apply" element={legacy(<AutoApplyPage />)} />
        <Route path="/applications/board" element={legacy(<ApplicationPipeline />)} />
        <Route path="/applications/ranked" element={legacy(<CareerOpsPage />)} />

        <Route path="/outreach" element={<Navigate to="/outreach/contacts" replace />} />
        <Route path="/outreach/contacts" element={legacy(<OutreachPage />)} />
        <Route path="/outreach/templates" element={legacy(<TemplatesPage />)} />

        <Route path="/profile" element={<Navigate to="/profile/details" replace />} />
        <Route path="/profile/details" element={<DetailsPage />} />
        <Route path="/profile/answers" element={<AnswersPage />} />
        <Route path="/profile/github" element={<GithubPage />} />

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
  if (session === undefined) return <div className="flex h-full bg-canvas"><PageSpinner /></div>
  if (!session) return <LoginPage />
  return <SignedInRoutes />
}

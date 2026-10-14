import type { ComponentType, ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { PageSpinner } from '@/ui'
import type { Stats } from '@/lib/api'
import { AppShell } from './AppShell'
import { useAuth } from './auth'
import { lazyWithRetry } from './lazy'
import { LegacyPage } from './LegacyPage'
import { LEGACY_REDIRECTS } from './nav'
import { useStats } from './queries'
import { qk } from './queryClient'

const HomePage = lazyWithRetry(() => import('@/features/home/HomePage'), 'HomePage')
const SettingsPage = lazyWithRetry(() => import('@/features/settings/SettingsPage'), 'SettingsPage')
const RolesPage = lazyWithRetry(() => import('@/features/jobs/RolesPage'), 'RolesPage')
const LoginPage = lazyWithRetry(() => import('@/features/auth/LoginPage'), 'LoginPage')
const ResetPasswordPage = lazyWithRetry(() => import('@/features/auth/ResetPasswordPage'), 'ResetPasswordPage')

// Pages not rebuilt yet — rendered inside the new shell until they are.
const JobDashboard = lazyWithRetry(() => import('@/components/JobDashboard'), 'JobDashboard')
interface CompanyDashboardProps { onStatsChange: (s: Stats) => void; statsSnapshot: Stats | null; userId?: string }
const CompanyDashboard = lazyWithRetry(
  () => import('@/components/CompanyDashboard') as Promise<{ default: ComponentType<CompanyDashboardProps> }>,
  'CompanyDashboard',
)
const ScraperPage = lazyWithRetry(() => import('@/components/ScraperPage'), 'ScraperPage')
const CategoryView = lazyWithRetry(() => import('@/components/CategoryView'), 'CategoryView')
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

function LegacyCompanies() {
  const { session } = useAuth()
  const stats = useStats()
  const qc = useQueryClient()
  const userId = session?.user?.id
  return (
    <CompanyDashboard
      key={userId ?? 'companies'}
      userId={userId}
      statsSnapshot={stats.data ?? null}
      onStatsChange={(s: Stats) => qc.setQueryData(qk.stats, s)}
    />
  )
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
        <Route path="/jobs/companies" element={legacy(<LegacyCompanies />)} />
        <Route path="/jobs/find" element={legacy(<ScraperPage />)} />
        <Route path="/jobs/alerts" element={<Navigate to="/jobs/roles/intern" replace />} />
        <Route path="/category/:name" element={legacy(<CategoryView />)} />
        <Route path="/company/:id" element={legacy(<CompanyDetail />)} />

        <Route path="/applications" element={<Navigate to="/applications/evaluate" replace />} />
        <Route path="/applications/evaluate" element={legacy(<CareerOps />)} />
        <Route path="/applications/auto-apply" element={legacy(<AutoApplyPage />)} />
        <Route path="/applications/board" element={legacy(<ApplicationPipeline />)} />
        <Route path="/applications/ranked" element={legacy(<CareerOpsPage />)} />

        <Route path="/outreach" element={<Navigate to="/outreach/contacts" replace />} />
        <Route path="/outreach/contacts" element={legacy(<OutreachPage />)} />
        <Route path="/outreach/templates" element={legacy(<TemplatesPage />)} />

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

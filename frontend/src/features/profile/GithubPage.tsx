import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw, Star } from 'lucide-react'
import { api, type GithubRepo } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { topLanguages } from './repoFormat'
import { Button, ConfirmDialog, EmptyState, ErrorState, Page, PageHeader, Skeleton, Spinner, useToast } from '@/ui'

function RepoRow({ repo, onToggle, busy }: { repo: GithubRepo; onToggle: (include: boolean) => void; busy: boolean }) {
  const langs = topLanguages(repo.languages)
  return (
    <li className={cn('grid gap-x-6 gap-y-1.5 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto]', !repo.include && 'opacity-60')}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <a href={repo.html_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-fg hover:text-accent">
          {repo.name}<ExternalLink className="size-3 text-subtle" />
        </a>
        {repo.fork && <span className="text-[12px] text-subtle">fork</span>}
        {repo.archived && <span className="text-[12px] text-subtle">archived</span>}
        {repo.stars > 0 && <span className="inline-flex items-center gap-0.5 font-mono text-[12px] text-subtle"><Star className="size-3" />{repo.stars}</span>}
      </div>
      <label className="row-span-3 flex cursor-pointer items-center gap-2 self-start text-[13px] text-muted sm:justify-end">
        <input type="checkbox" checked={repo.include} disabled={busy} onChange={e => onToggle(e.target.checked)} className="size-4 accent-[var(--ui-accent)]" />
        Use in resumes
      </label>
      {repo.description && <p className="text-[14px] text-muted">{repo.description}</p>}
      <p className="text-[12px] text-subtle">
        {[langs.join(' · ') || repo.language, repo.pushed_at && `updated ${timeAgo(repo.pushed_at)}`, repo.has_readme ? 'README read' : 'no README'].filter(Boolean).join(' · ')}
      </p>
    </li>
  )
}

export default function GithubPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const status = useQuery({
    queryKey: qk.githubStatus,
    queryFn: api.githubStatus,
    // Poll while the first import runs in the background.
    refetchInterval: q => (q.state.data?.sync_status === 'syncing' ? 2000 : false),
  })
  const connected = status.data?.connected === true
  const syncing = status.data?.sync_status === 'syncing'
  const repos = useQuery({ queryKey: qk.githubRepos, queryFn: api.githubRepos, enabled: connected })

  // Refresh the repo list once a background import finishes.
  useEffect(() => {
    if (connected && !syncing) void qc.invalidateQueries({ queryKey: qk.githubRepos })
  }, [connected, syncing, qc])

  // Result of the GitHub redirect: show it once, then clean the URL.
  const announced = useRef<string | null>(null)
  useEffect(() => {
    const result = params.get('github')
    if (!result || announced.current === params.toString()) return
    announced.current = params.toString()
    if (result === 'connected') toast.success(`Connected GitHub as @${params.get('login') ?? ''}. Importing your public repos…`)
    else toast.error(params.get('reason') || 'GitHub sign-in failed')
    setParams({}, { replace: true })
  }, [params, setParams, toast])

  const connect = useMutation({
    mutationFn: api.githubConnectUrl,
    onSuccess: url => { window.location.assign(url) },
    onError: (e: Error) => toast.error(e.message),
  })
  const sync = useMutation({
    mutationFn: api.githubSync,
    onSuccess: r => { toast.success(`Imported ${r.repos} repo${r.repos === 1 ? '' : 's'}`); void qc.invalidateQueries({ queryKey: qk.githubStatus }); void qc.invalidateQueries({ queryKey: qk.githubRepos }) },
    onError: (e: Error) => { toast.error(e.message); void qc.invalidateQueries({ queryKey: qk.githubStatus }) },
  })
  const toggle = useMutation({
    mutationFn: ({ repoId, include }: { repoId: number; include: boolean }) => api.githubSetInclude(repoId, include),
    onMutate: ({ repoId, include }) => {
      qc.setQueryData<GithubRepo[]>(qk.githubRepos, list => list?.map(r => (r.repo_id === repoId ? { ...r, include } : r)))
    },
    onError: (e: Error) => { toast.error(e.message); void qc.invalidateQueries({ queryKey: qk.githubRepos }) },
  })
  const disconnect = useMutation({
    mutationFn: api.githubDisconnect,
    onSuccess: () => {
      setConfirmDisconnect(false)
      toast.success('GitHub disconnected')
      qc.removeQueries({ queryKey: qk.githubRepos })
      void qc.invalidateQueries({ queryKey: qk.githubStatus })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const list = repos.data ?? []
  const included = list.filter(r => r.include).length

  return (
    <Page>
      <PageHeader
        title="GitHub projects"
        description="Your public repos are the pool of projects each tailored resume picks from. Only what’s in a repo’s description, languages and README is used. Nothing is made up."
        actions={connected ? (
          <>
            <Button icon={<RefreshCw className="size-4" />} onClick={() => sync.mutate()} loading={sync.isPending} disabled={syncing}>Sync now</Button>
            <Button variant="ghost" onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>
          </>
        ) : undefined}
      />

      {status.error ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : status.isLoading ? <Skeleton className="h-32" /> : !connected ? (
        <section className="max-w-2xl rounded-[4px] border border-line bg-surface p-6">
          <h2 className="font-display text-[22px] font-semibold text-fg">Connect GitHub</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            You’ll sign in on github.com. Scout’n’Jobs can then read your profile and <b className="text-fg">public</b> repos, and nothing else.
            It can’t see private repos or change anything. You can disconnect here any time, or revoke access in GitHub’s settings.
          </p>
          {status.data?.configured === false
            ? <p className="mt-4 text-[14px] text-warning">GitHub sign-in isn’t set up on the server yet.</p>
            : <Button variant="primary" className="mt-5" onClick={() => connect.mutate()} loading={connect.isPending}>Sign in with GitHub</Button>}
        </section>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4 text-[14px] text-muted">
            {status.data?.avatar_url && <img src={status.data.avatar_url} alt="" className="size-8 rounded-full" />}
            <span>Connected as <a href={`https://github.com/${status.data?.login}`} target="_blank" rel="noreferrer" className="font-medium text-fg hover:text-accent">@{status.data?.login}</a></span>
            <span className="text-subtle">·</span>
            {syncing
              ? <span className="inline-flex items-center gap-2"><Spinner size={14} /> Importing repos…</span>
              : status.data?.sync_status === 'error'
                ? <span className="text-danger">Last import failed: {status.data.sync_error}</span>
                : <span>{list.length ? `${included} of ${list.length} repos used` : 'No repos yet'} · synced {timeAgo(status.data?.last_synced_at)}</span>}
          </div>

          {repos.error ? <ErrorState error={repos.error} onRetry={() => repos.refetch()} /> : repos.isLoading || (syncing && !list.length) ? (
            <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16" />)}</div>
          ) : list.length === 0 ? (
            <EmptyState title="No public repos found" description="Make a project repo public on GitHub, then press Sync now." />
          ) : (
            <>
              <p className="text-[13px] text-subtle">Forks and archived repos start unticked. Untick anything you don’t want on a resume.</p>
              <ul className="border-t border-rule">
                {list.map(r => (
                  <RepoRow key={r.repo_id} repo={r} busy={toggle.isPending} onToggle={include => toggle.mutate({ repoId: r.repo_id, include })} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect GitHub?"
        description="Scout’n’Jobs forgets your repos and asks GitHub to revoke its access. Tailored resumes already made keep their projects."
        confirmLabel="Disconnect"
        danger
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </Page>
  )
}

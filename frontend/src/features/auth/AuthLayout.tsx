import type { ReactNode } from 'react'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-canvas px-4 py-12 text-fg">
      <div className="w-full max-w-[360px]" style={{ animation: 'ui-slide-up 200ms ease-out' }}>
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-5 grid size-10 place-items-center rounded-xl bg-accent text-lg font-bold text-on-accent shadow-pop">◈</span>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-pop">{children}</div>
        {footer && <div className="mt-6 text-center text-[13px] text-subtle">{footer}</div>}
      </div>
    </div>
  )
}

export function FormMessage({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error'
        ? 'rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger'
        : 'rounded-md bg-info-soft px-3 py-2 text-[13px] text-info'}>
      {children}
    </p>
  )
}

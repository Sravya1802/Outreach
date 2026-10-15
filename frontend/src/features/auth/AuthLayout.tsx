import type { ReactNode } from 'react'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-canvas px-4 py-12 text-fg">
      <div className="w-full max-w-[400px]" style={{ animation: 'ui-slide-up 200ms ease-out' }}>
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-6 font-display text-[26px] font-semibold tracking-tight">OutreachOS</span>
          <h1 className="font-display text-[28px] leading-tight font-normal tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[14px] text-muted">{subtitle}</p>}
        </div>
        <div className="rounded-[4px] border border-line bg-surface p-6">{children}</div>
        {footer && <div className="mt-6 text-center text-[13px] text-subtle">{footer}</div>}
        <p className="mt-8 text-center text-[12px] text-subtle">
          <a href="/privacy" className="hover:text-fg">Privacy</a> · <a href="/terms" className="hover:text-fg">Terms</a>
        </p>
      </div>
    </div>
  )
}

export function FormMessage({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error'
        ? 'rounded-[4px] bg-danger-soft px-3 py-2 text-[13px] text-danger'
        : 'rounded-[4px] bg-info-soft px-3 py-2 text-[13px] text-info'}>
      {children}
    </p>
  )
}

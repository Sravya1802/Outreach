import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pb-6">
      <div className="min-w-0">
        <h1 className="font-display text-[30px] leading-tight font-normal tracking-tight text-fg sm:text-[36px]">{title}</h1>
        {description && <p className="mt-2 text-[14px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Standard centred, max-width page body with consistent gutters. */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  // The outer box matches the top bar's width so page content lines up with the
  // wordmark; narrow pages cap their own width but stay left-aligned.
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-9">
        <div className={wide ? '' : 'max-w-5xl'}>{children}</div>
      </div>
    </div>
  )
}

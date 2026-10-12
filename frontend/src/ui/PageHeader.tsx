import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Standard centred, max-width page body with consistent gutters. */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`mx-auto w-full px-4 py-6 sm:px-8 sm:py-8 ${wide ? 'max-w-7xl' : 'max-w-5xl'}`}>{children}</div>
    </div>
  )
}

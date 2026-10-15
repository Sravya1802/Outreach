import type { ReactNode } from 'react'

export const APP_NAME = 'OutreachOS'
export const CONTACT_EMAIL = 'lakshmisravyar@gmail.com'
export const UPDATED = 'October 15, 2026'

/** Public page shell for the privacy policy and terms (no sign-in needed). */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-full bg-canvas px-4 py-12 text-fg">
      <article className="mx-auto max-w-2xl">
        <a href="/" className="font-display text-[22px] font-semibold tracking-tight">{APP_NAME}</a>
        <h1 className="mt-8 font-display text-[36px] leading-tight">{title}</h1>
        <p className="mt-2 text-[13px] text-subtle">Last updated {UPDATED}</p>
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-muted [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-[22px] [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg">
          {children}
        </div>
        <p className="mt-12 border-t border-line pt-6 text-[13px] text-subtle">
          <a href="/privacy" className="hover:text-fg">Privacy policy</a> · <a href="/terms" className="hover:text-fg">Terms of service</a> · <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-fg">{CONTACT_EMAIL}</a>
        </p>
      </article>
    </div>
  )
}

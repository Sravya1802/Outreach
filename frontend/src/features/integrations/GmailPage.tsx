import { Page, PageHeader } from '@/ui'
import { GmailTab } from '@/features/settings/GmailTab'

export default function GmailPage() {
  return (
    <Page>
      <PageHeader title="Gmail" description="Your own Gmail sends your outreach and follow-ups, reads the replies, and emails you your lists and alerts." />
      <GmailTab />
    </Page>
  )
}

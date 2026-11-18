import { Page, PageHeader } from '@/ui'
import { GmailTab } from '@/features/settings/GmailTab'

export default function GmailPage() {
  return (
    <Page>
      <PageHeader title="Gmail" description="Your own Gmail sends your outreach, keeps a draft of each email waiting for your OK (always the latest text), reads the replies, and emails you your lists and alerts." />
      <GmailTab />
    </Page>
  )
}

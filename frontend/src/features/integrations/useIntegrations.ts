import { useQuery } from '@tanstack/react-query'
import { qk } from '@/app/queryClient'
import { api } from '@/lib/api'
import { integrationCards } from './overview'

/** Every integration's live status. Shared by the Integrations overview, its tab dots and Home. */
export function useIntegrations() {
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const github = useQuery({ queryKey: qk.githubStatus, queryFn: api.githubStatus })
  const linkedin = useQuery({ queryKey: qk.connections, queryFn: api.connections })
  const whatsapp = useQuery({ queryKey: qk.whatsapp, queryFn: api.whatsappStatus })
  const cards = integrationCards({
    gmail: gmail.data, github: github.data, linkedin: linkedin.data, whatsapp: whatsapp.data,
    errors: { gmail: gmail.isError, github: github.isError, linkedin: linkedin.isError, whatsapp: whatsapp.isError },
  })
  return { cards, connected: cards.filter(c => c.state === 'on').length, loading: cards.some(c => c.state === 'loading') }
}

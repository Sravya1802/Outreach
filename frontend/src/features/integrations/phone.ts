/** "15550102000" → "+1 (555) 010-2000"; India and others get a plain + prefix. */
export function formatPhone(digits: string | null): string {
  if (!digits) return ''
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  return `+${digits}`
}

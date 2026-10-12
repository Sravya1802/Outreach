export const MIN_PASSWORD_LENGTH = 8

export function validatePassword(next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (next !== confirm) return 'Passwords don’t match.'
  return null
}

import { describe, expect, it } from 'vitest'
import { appendSpoken } from './VoiceInput'

describe('appendSpoken', () => {
  it('adds spoken words after the typed text with one space', () => {
    expect(appendSpoken('', ' make the summary shorter ')).toBe('make the summary shorter')
    expect(appendSpoken('Move Python up.', 'add Kafka to skills')).toBe('Move Python up. add Kafka to skills')
    expect(appendSpoken('Move Python up.   ', 'add Kafka')).toBe('Move Python up. add Kafka')
    expect(appendSpoken('Keep this', '   ')).toBe('Keep this')
  })
})

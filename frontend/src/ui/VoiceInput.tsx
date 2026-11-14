import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { Button } from './Button'

// The browser's own speech recognition (Chrome, Edge, Safari): no service, no cost.
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}
type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Adds dictated words to the end of the text, with a space between. */
export function appendSpoken(text: string, spoken: string) {
  const s = spoken.trim()
  if (!s) return text
  return text.trim() ? `${text.replace(/\s+$/, '')} ${s}` : s
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Allow the microphone for this site to use voice typing.',
  'service-not-allowed': 'Allow the microphone for this site to use voice typing.',
  'no-speech': 'Didn’t hear anything. Try again.',
  'audio-capture': 'No microphone found.',
  network: 'Voice typing needs an internet connection.',
}

/**
 * A Speak / Stop button that types what the user says into a text box:
 * `onText` gets each finished phrase. The words still being heard show beside it.
 */
export function VoiceInput({ onText, disabled }: { onText: (spoken: string) => void; disabled?: boolean }) {
  const Ctor = recognitionCtor()
  const rec = useRef<Recognition | null>(null)
  const [listening, setListening] = useState(false)
  const [hearing, setHearing] = useState('')
  const [error, setError] = useState<string | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  useEffect(() => () => rec.current?.stop(), [])

  if (!Ctor) {
    return <p className="text-[12px] text-subtle">Voice typing works in Chrome, Edge and Safari.</p>
  }

  function start() {
    if (!Ctor) return
    setError(null)
    const r = new Ctor()
    r.lang = 'en-US'
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let done = ''
      let partial = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (!result) continue
        if (result.isFinal) done += result[0].transcript
        else partial += result[0].transcript
      }
      if (done.trim()) onTextRef.current(done)
      setHearing(partial)
    }
    r.onerror = (e) => setError(ERRORS[e.error] ?? `Voice typing stopped (${e.error}).`)
    r.onend = () => { setListening(false); setHearing('') }
    rec.current = r
    try { r.start(); setListening(true) } catch { setError('Voice typing couldn’t start. Try again.') }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {listening ? (
        <Button type="button" size="sm" onClick={() => rec.current?.stop()} icon={<Square className="size-3.5 fill-current" />} aria-label="Stop voice typing">
          Stop
        </Button>
      ) : (
        <Button type="button" size="sm" disabled={disabled} onClick={start} icon={<Mic className="size-3.5" />} title="Speak and the words are typed in">
          Speak
        </Button>
      )}
      {listening && (
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted" aria-live="polite">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" />
          <span className="truncate">{hearing || 'Listening…'}</span>
        </span>
      )}
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </div>
  )
}

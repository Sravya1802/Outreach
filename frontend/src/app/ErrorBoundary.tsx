import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props { children: ReactNode; resetKey?: string; fullScreen?: boolean }
interface State { error: Error | null }

/** Catches render errors. Resets itself when `resetKey` (the route) changes. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className={`flex flex-1 flex-col items-center justify-center px-6 py-16 text-center ${this.props.fullScreen ? 'min-h-full bg-canvas text-fg' : ''}`}>
        <AlertTriangle className="mb-3 size-6 text-danger" />
        <h1 className="text-[15px] font-semibold">This page hit an error</h1>
        <p className="mt-1 max-w-md text-[13px] text-muted">{error.message || 'Unexpected error'}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => this.setState({ error: null })}
            className="h-8 rounded-md border border-line bg-raised px-3 text-[13px] font-medium hover:bg-hover">Try again</button>
          <button type="button" onClick={() => window.location.reload()}
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover">Reload</button>
        </div>
      </div>
    )
  }
}

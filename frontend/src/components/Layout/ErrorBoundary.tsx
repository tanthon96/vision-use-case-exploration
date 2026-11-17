import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches uncaught render errors anywhere in the tree and shows a recoverable
 * fallback UI. Before this existed, a thrown render (e.g. an infinite render
 * loop in AnnotationCanvas) would unmount everything and present a blank page
 * with no indication of what went wrong.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Render error caught by ErrorBoundary:', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const err = this.state.error
    if (!err) return this.props.children

    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-lg w-full bg-surface-raised border border-danger/30 rounded-cushion p-5 shadow-raised">
          <div className="flex items-center gap-2 mb-3 text-danger">
            <AlertTriangle size={18} />
            <h1 className="text-sm font-semibold">Something went wrong</h1>
          </div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            The UI crashed while rendering. The page would normally go blank — this
            screen replaces that. Reloading is safe.
          </p>
          <pre className="text-[11px] font-mono text-foreground bg-muted/40 border border-border rounded-soft px-2 py-1.5 overflow-auto max-h-48 mb-3">
            {err.message}
            {'\n\n'}
            {err.stack?.split('\n').slice(0, 6).join('\n')}
          </pre>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => location.reload()}
              className="btn-ghost inline-flex items-center gap-1"
            >
              <RotateCcw size={12} /> Reload page
            </button>
            <button onClick={this.reset} className="btn-primary">
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}

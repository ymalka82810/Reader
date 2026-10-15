import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** shown in place of the crashed subtree; the button calls this (e.g. to return to the library) */
  onClose: () => void
  children: ReactNode
}

/** keeps a render crash in one screen (the reader) from blanking the whole app */
export default class ErrorBoundary extends Component<Props, { error?: Error }> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="overlay-msg error" role="alert" dir="rtl" style={{ position: 'fixed' }}>
        <p>משהו השתבש בפתיחת הספר.</p>
        <p style={{ fontSize: '.85rem', opacity: 0.7 }}>{this.state.error.message}</p>
        <button
          onClick={() => {
            this.setState({ error: undefined })
            this.props.onClose()
          }}
        >
          חזרה לספרייה
        </button>
      </div>
    )
  }
}

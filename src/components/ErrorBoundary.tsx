import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n'
import { errorReport } from '../lib/errorReport'

interface Props {
  /** shown in place of the crashed subtree; the button calls this (e.g. to return to the library) */
  onClose: () => void
  children: ReactNode
}

interface State {
  error?: Error
  componentStack?: string
  copied?: boolean
}

/** keeps a render crash in one screen (the reader) from blanking the whole app */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? undefined })
  }

  private copy = () => {
    const { error, componentStack } = this.state
    if (!error) return
    navigator.clipboard
      ?.writeText(errorReport(error, componentStack))
      .then(() => this.setState({ copied: true }))
      .catch(() => {})
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="overlay-msg error" role="alert" style={{ position: 'fixed' }}>
        <p>{t('error.title')}</p>
        <p style={{ fontSize: '.85rem', opacity: 0.7 }}>{this.state.error.message}</p>
        <button className="secondary" onClick={this.copy}>
          {t(this.state.copied ? 'error.copied' : 'error.copy')}
        </button>
        <button
          onClick={() => {
            this.setState({ error: undefined, copied: false })
            this.props.onClose()
          }}
        >
          {t('reader.backToLibrary')}
        </button>
      </div>
    )
  }
}

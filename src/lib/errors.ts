import { t } from '../i18n'

/** an error whose message is already written for the user (in the UI language, no technical detail) */
export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

/** turns whatever a failed import threw into a message a reader can act on */
export function explainImportError(e: unknown): string {
  if (e instanceof ImportError) return e.message
  const name = e instanceof Error ? e.name : ''
  if (name === 'PasswordException') return t('err.pdfPassword')
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') return t('err.pdfInvalid')
  if (name === 'QuotaExceededError') return t('err.quota')
  if (name === 'AbortError') return t('err.aborted')
  return t('err.generic')
}

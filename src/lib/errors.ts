/** an error whose message is already written for the user (Hebrew, no technical detail) */
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
  if (name === 'PasswordException') return 'ה-PDF מוגן בסיסמה. הסירו את ההגנה ונסו שוב.'
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') return 'קובץ ה-PDF פגום או שאינו PDF תקין.'
  if (name === 'QuotaExceededError') return 'אין מספיק מקום באחסון של הדפדפן. מחקו ספרים או פנו מקום ונסו שוב.'
  if (name === 'AbortError') return 'הפעולה בוטלה.'
  return 'לא הצלחנו לקרוא את הקובץ. ייתכן שהוא פגום או שהפורמט שלו לא נתמך.'
}

// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)
import ErrorBoundary from './ErrorBoundary'
import { errorReport } from '../lib/errorReport'

function Boom(): never {
  throw new Error('boom')
}

it('copies a crash report to the clipboard', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  render(
    <ErrorBoundary onClose={() => {}}>
      <Boom />
    </ErrorBoundary>,
  )
  fireEvent.click(screen.getByRole('button', { name: /העתק פרטי שגיאה|Copy error details/ }))
  expect(writeText).toHaveBeenCalledOnce()
  expect(writeText.mock.calls[0]?.[0]).toContain('Error: boom')
})

it('leaves the URL query and hash out of the report', () => {
  const report = errorReport(new Error('x'))
  expect(report).not.toContain('?')
  expect(report).toContain('Browser:')
})

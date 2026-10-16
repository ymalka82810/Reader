import { useState } from 'react'

export type ConfirmAsk = {
  title: string
  text?: string
  /** the confirm button's label */
  ok: string
  /** shows the confirm button as destructive */
  danger?: boolean
}

export type Confirm = (ask: ConfirmAsk) => Promise<boolean>

/** an in-app replacement for window.confirm: `confirm` resolves once the dialog for `pending` is answered */
export function useConfirm() {
  const [pending, setPending] = useState<ConfirmAsk & { answer: (yes: boolean) => void }>()

  const confirm: Confirm = (ask) =>
    new Promise((resolve) =>
      setPending({
        ...ask,
        answer: (yes) => {
          setPending(undefined)
          resolve(yes)
        },
      }),
    )

  return { pending, confirm }
}

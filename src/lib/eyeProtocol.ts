import type { GazeMove } from './gaze'

export type EyeStatus = 'off' | 'starting' | 'calibrating' | 'active' | 'denied' | 'error'

/** what the eye page (an iframe, see eye.html) tells the reader */
export type EyeEvent = { type: 'status'; status: EyeStatus } | { type: 'move'; move: GazeMove }
export type EyeMessage = EyeEvent & { source: 'reader-eye' }

/** what the reader tells the eye page */
export type EyeCommand = { source: 'reader'; type: 'recalibrate' }

export const isEyeMessage = (d: unknown): d is EyeMessage =>
  !!d && typeof d === 'object' && (d as { source?: unknown }).source === 'reader-eye'

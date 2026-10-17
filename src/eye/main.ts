import type { FaceMesh } from '@mediapipe/face_mesh'
import { faceMeshFile, FACE_MESH_SCRIPT } from '../lib/faceMeshAssets'
import type { EyeCommand, EyeEvent } from '../lib/eyeProtocol'
import { createGazeTracker, verticalGaze } from '../lib/gaze'

// Runs inside the hidden iframe of useEyeScroll: opens the front camera, runs the on-device face model on it
// and sends only "down" / "up" moves and a status to the reader. No frame or landmark leaves this page.

/** the camera is sampled at most this often: gaze changes slowly and the model is the costly part */
const FRAME_MS = 70

const send = (m: EyeEvent) => window.parent.postMessage({ source: 'reader-eye', ...m }, location.origin)

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('face-mesh script failed to load'))
    document.head.append(s)
  })

async function run() {
  send({ type: 'status', status: 'starting' })
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } })
  } catch {
    send({ type: 'status', status: 'denied' })
    return
  }
  const tracker = createGazeTracker()
  window.addEventListener('message', (e: MessageEvent<EyeCommand>) => {
    if (e.source === window.parent && e.data?.source === 'reader' && e.data.type === 'recalibrate') tracker.recalibrate()
  })

  await loadScript(FACE_MESH_SCRIPT)
  const Ctor = (window as unknown as { FaceMesh?: typeof FaceMesh }).FaceMesh
  if (!Ctor) throw new Error('FaceMesh missing')
  const mesh = new Ctor({ locateFile: faceMeshFile })
  mesh.setOptions({ maxNumFaces: 1, refineLandmarks: true })
  let last = ''
  mesh.onResults((r) => {
    const lm = r.multiFaceLandmarks?.[0]
    const move = tracker.feed(lm ? verticalGaze(lm) : null, performance.now())
    const status = tracker.calibrated ? 'active' : 'calibrating'
    if (status !== last) send({ type: 'status', status: (last = status) })
    if (move) send({ type: 'move', move })
  })
  await mesh.initialize()

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()
  send({ type: 'status', status: 'calibrating' })

  let prev = 0
  let busy = false
  const tick = (now: number) => {
    requestAnimationFrame(tick)
    if (busy || now - prev < FRAME_MS || video.readyState < 2) return
    prev = now
    busy = true
    mesh.send({ image: video }).catch(console.error).finally(() => (busy = false))
  }
  requestAnimationFrame(tick)
}

run().catch((e) => {
  console.error(e)
  send({ type: 'status', status: 'error' })
})

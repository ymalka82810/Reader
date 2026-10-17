// MediaPipe Face Mesh is loaded only when eye scrolling is switched on. Its files are bundled (not fetched
// from a CDN) so the feature works offline and no camera frame or request leaves the device.
import script from '@mediapipe/face_mesh/face_mesh.js?url'
import binarypb from '@mediapipe/face_mesh/face_mesh.binarypb?url'
import packedData from '@mediapipe/face_mesh/face_mesh_solution_packed_assets.data?url'
import packedLoader from '@mediapipe/face_mesh/face_mesh_solution_packed_assets_loader.js?url'
import simdJs from '@mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.js?url'
import simdWasm from '@mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.wasm?url'
import simdData from '@mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.data?url'
import wasmJs from '@mediapipe/face_mesh/face_mesh_solution_wasm_bin.js?url'
import wasm from '@mediapipe/face_mesh/face_mesh_solution_wasm_bin.wasm?url'

export const FACE_MESH_SCRIPT = script

const FILES: Record<string, string> = {
  'face_mesh.binarypb': binarypb,
  'face_mesh_solution_packed_assets.data': packedData,
  'face_mesh_solution_packed_assets_loader.js': packedLoader,
  'face_mesh_solution_simd_wasm_bin.js': simdJs,
  'face_mesh_solution_simd_wasm_bin.wasm': simdWasm,
  'face_mesh_solution_simd_wasm_bin.data': simdData,
  'face_mesh_solution_wasm_bin.js': wasmJs,
  'face_mesh_solution_wasm_bin.wasm': wasm,
}

/** where the solution asks for one of its files */
export const faceMeshFile = (name: string) => FILES[name] ?? name

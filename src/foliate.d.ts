declare module 'foliate-js/view.js' {
  export const makeBook: (file: File | Blob | string) => Promise<any>
}
declare module 'foliate-js/overlayer.js' {
  export const Overlayer: { highlight: (rects: unknown, options?: object) => SVGElement }
}
declare module 'foliate-js/*.js'

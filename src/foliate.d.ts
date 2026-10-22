declare module 'foliate-js/view.js' {
  export interface FoliateTocItem {
    label: string
    href: string
    subitems?: FoliateTocItem[]
  }

  export interface FoliateSection {
    /** source size in bytes, used to estimate page counts */
    size?: number
    linear?: string
  }

  /** the paginator / scroller inside the view */
  export interface FoliateRenderer extends HTMLElement {
    scrolled: boolean
    /** page count of the current section, including the two padding pages in paginated mode */
    pages: number
    page: number
    /** size of one page / viewport along the reading axis */
    size: number
    start: number
    end: number
    viewSize: number
    /** container property that holds the scroll position ('scrollLeft' for vertical writing in scrolled mode) */
    scrollProp: 'scrollTop' | 'scrollLeft'
    /** on the last page of the last section */
    atEnd: boolean
    setStyles?(css: string): void
    /** lays the book out again (the fixed-layout renderer pairs its pages into spreads here) */
    open?(book: object): void
    prev(distance?: number): Promise<unknown>
    next(distance?: number): Promise<unknown>
    scrollToAnchor?(anchor: Range | Element | number): Promise<unknown>
    getContents?(): { doc?: Document; index?: number }[]
  }

  export interface FoliateRelocateDetail {
    fraction?: number
    cfi?: string
    section?: { current: number; total: number }
    tocItem?: { label?: string; href?: string }
    /** the text currently on screen */
    range?: Range
  }

  export interface FoliateSearchResult {
    label: string
    subitems?: { cfi: string; excerpt: { pre: string; match: string; post: string } }[]
  }

  /** the <foliate-view> custom element */
  export interface FoliateView extends HTMLElement {
    renderer: FoliateRenderer
    book: {
      dir?: string
      /** 'pre-paginated' for a PDF shown as is and a fixed-layout EPUB */
      rendition?: { layout?: string }
      metadata?: { language?: string | string[] }
      toc?: FoliateTocItem[]
      sections: FoliateSection[]
    }
    open(source: Blob | File | string | object): Promise<void>
    init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
    close?(): void
    goTo(target: string | number): Promise<unknown>
    goToFraction(f: number): Promise<unknown>
    next(): Promise<unknown>
    prev(): Promise<unknown>
    goLeft(): Promise<unknown>
    goRight(): Promise<unknown>
    resolveNavigation(target: string): { index: number } | Promise<{ index: number }>
    getSectionFractions(): number[]
    getTOCItemOf(target: string): Promise<{ label?: string } | undefined>
    getCFI(index: number, range?: Range): string
    addAnnotation(a: { value: string; color?: string }): Promise<unknown>
    deleteAnnotation(a: { value: string }): Promise<unknown>
    search(opts: { query: string }): AsyncIterable<FoliateSearchResult | 'done'>
    clearSearch(): void
    /** speech helper for the open section; (re)created by initTTS */
    tts: {
      start(): string | undefined
      next(): string | undefined
      from(range: Range): string | undefined
      setMark(name: string): void
    }
    initTTS(granularity?: 'word' | 'sentence', highlight?: (range: Range) => void): Promise<void>
  }

  export const makeBook: (file: File | Blob | string) => Promise<any>
}
declare module 'foliate-js/overlayer.js' {
  export const Overlayer: { highlight: (rects: unknown, options?: object) => SVGElement }
}
declare module 'foliate-js/*.js'

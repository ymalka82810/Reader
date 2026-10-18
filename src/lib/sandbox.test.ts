// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { classifyLink, isScriptedBook, parseSandboxMessage, toSandboxHtml } from './sandbox'

describe('parseSandboxMessage', () => {
  it('accepts the known messages', () => {
    expect(parseSandboxMessage({ source: 'reader-sandbox', type: 'ready' })).toEqual({ type: 'ready' })
    expect(parseSandboxMessage({ source: 'reader-sandbox', type: 'shell-ready' })).toEqual({ type: 'shell-ready' })
    expect(parseSandboxMessage({ source: 'reader-sandbox', type: 'link', href: 'ch2.xhtml#a' })).toEqual({ type: 'link', href: 'ch2.xhtml#a' })
  })
  it('drops everything else, including extra fields and oversized links', () => {
    expect(parseSandboxMessage(null)).toBeNull()
    expect(parseSandboxMessage('ready')).toBeNull()
    expect(parseSandboxMessage({ type: 'ready' })).toBeNull()
    expect(parseSandboxMessage({ source: 'reader-sandbox', type: 'eval', code: 'x' })).toBeNull()
    expect(parseSandboxMessage({ source: 'reader-sandbox', type: 'link', href: 5 })).toBeNull()
    expect(parseSandboxMessage({ source: 'reader-sandbox', type: 'link', href: 'a'.repeat(5000) })).toBeNull()
    expect(parseSandboxMessage({ source: 'reader-sandbox', type: 'ready', extra: 1 })).toEqual({ type: 'ready' })
  })
})

describe('classifyLink', () => {
  it('lets only web links and relative book links through', () => {
    expect(classifyLink('https://example.com/x')).toBe('web')
    expect(classifyLink('HTTP://example.com')).toBe('web')
    expect(classifyLink('ch2.xhtml#top')).toBe('book')
    expect(classifyLink('../text/ch2.xhtml')).toBe('book')
    expect(classifyLink('javascript:alert(1)')).toBe('blocked')
    expect(classifyLink('data:text/html,x')).toBe('blocked')
    expect(classifyLink('blob:https://x/1')).toBe('blocked')
    expect(classifyLink('file:///etc/passwd')).toBe('blocked')
  })
})

describe('isScriptedBook', () => {
  it('detects the scripted property and script files', () => {
    expect(isScriptedBook({ resources: { manifest: [{ properties: ['scripted'] }] } })).toBe(true)
    expect(isScriptedBook({ resources: { manifest: [{ mediaType: 'application/javascript' }] } })).toBe(true)
    expect(isScriptedBook({ resources: { manifest: [{ properties: ['nav'], mediaType: 'application/xhtml+xml' }] } })).toBe(false)
    expect(isScriptedBook({})).toBe(false)
  })
})

describe('toSandboxHtml', () => {
  const blobs: Record<string, Blob> = {
    'blob:http://x/js': new Blob(['document.title = "</script>"'], { type: 'text/javascript' }),
    'blob:http://x/css': new Blob(['p { background: url("blob:http://x/img") }'], { type: 'text/css' }),
    'blob:http://x/img': new Blob(['PNG'], { type: 'image/png' }),
  }
  const read = async (url: string) => blobs[url] ?? Promise.reject(new Error('gone'))

  it('serialises XHTML so self-closing script tags survive the HTML parser', async () => {
    const out = await toSandboxHtml('<html xmlns="http://www.w3.org/1999/xhtml"><head><script>1</script></head><body><p>hi</p></body></html>', 'application/xhtml+xml', read)
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<p>hi</p>')
  })
  it('inlines blob: resources, which an opaque-origin page cannot open', async () => {
    const xhtml =
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="blob:http://x/css"/><script src="blob:http://x/js"/></head>' +
      '<body><img src="blob:http://x/img"/><img src="blob:http://x/missing"/></body></html>'
    const out = await toSandboxHtml(xhtml, 'application/xhtml+xml', read)
    expect(out).not.toMatch(/blob:http:\/\/x\/(js|css|img)/)
    expect(out).toContain('<script>document.title = "<\\/script>"</script>')
    expect(out).toContain('<style>p { background: url("data:image/png;base64,')
    expect(out).toContain('src="data:image/png;base64,')
    expect(out).toContain('src=""')
  })
  it('falls back to the HTML parser for broken XHTML', async () => {
    expect(await toSandboxHtml('<p>unclosed<br>', 'application/xhtml+xml', read)).toContain('<p>unclosed<br></p>')
  })
})

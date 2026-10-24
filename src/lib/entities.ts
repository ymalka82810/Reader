// Names read from a file's metadata sometimes arrive with HTML entities still in them ("ג&apos;יימס", "Tom &amp; Jerry"),
// which then show up as they are in the library and in the phone's folder names. Decoded once, here, wherever a name is read.
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' }

/** "&apos;" -> "'", "&#39;" / "&#x27;" -> "'", "&amp;" -> "&"; an entity left over from a double encoding ("&amp;apos;") is decoded too */
export function decodeEntities(s: string): string {
  let out = s
  for (let i = 0; i < 3 && /&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(out); i++) {
    out = out.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (m, dec?: string, hex?: string, name?: string) => {
      if (name) return NAMED[name.toLowerCase()] ?? m
      const code = dec ? Number(dec) : parseInt(hex!, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    })
  }
  return out
}

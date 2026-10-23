import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { downloadPack, fetchPackList, installedPacks, removePack, type InstalledPack, type PackInfo } from '../../lib/offlineDict'
import { DICT_LANGS } from '../../lib/settings'
import { formatBytes } from '../../lib/storage'
import { Row, Section } from './parts'

/** the dictionaries that can be downloaded to the device, one per language */
export function OfflineDictSection() {
  const [installed, setInstalled] = useState<Record<string, InstalledPack>>({})
  const [offered, setOffered] = useState<Record<string, PackInfo> | null | undefined>(undefined)
  /** the language being downloaded and how far it got */
  const [busy, setBusy] = useState<{ lang: string; share: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    void installedPacks().then((p) => !ctl.signal.aborted && setInstalled(p))
    void fetchPackList(ctl.signal).then((p) => !ctl.signal.aborted && setOffered(p))
    return () => {
      ctl.abort()
      abort.current?.abort()
    }
  }, [])

  const download = async (lang: string, info: PackInfo) => {
    const ctl = new AbortController()
    abort.current = ctl
    setFailed(null)
    setBusy({ lang, share: 0 })
    try {
      await downloadPack(lang, info.bytes, (share) => setBusy({ lang, share }), ctl.signal)
    } catch {
      if (!ctl.signal.aborted) setFailed(lang)
    }
    abort.current = null
    setBusy(null)
    setInstalled(await installedPacks())
  }

  const remove = async (lang: string) => {
    await removePack(lang)
    setInstalled(await installedPacks())
  }

  return (
    <Section title={t('prefs.offlineDict')}>
      <small className="muted">{t('prefs.offlineDictNote')}</small>
      {offered === null && <small className="muted">{t('prefs.offlineDictOffline')}</small>}
      {DICT_LANGS.map(([lang, name]) => {
        const have = installed[lang]
        const info = offered?.[lang]
        const downloading = busy?.lang === lang
        return (
          <Row
            key={lang}
            label={name}
            hint={
              downloading
                ? t('prefs.offlineDictProgress', { pct: Math.round(busy.share * 100) })
                : failed === lang
                  ? t('prefs.offlineDictFailed')
                  : have
                    ? t('prefs.offlineDictInstalled', { words: have.words.toLocaleString(), size: formatBytes(have.bytes) })
                    : undefined
            }
          >
            {downloading && <button onClick={() => abort.current?.abort()}>{t('common.cancel')}</button>}
            {!downloading && have && (
              <button aria-label={`${t('prefs.offlineDictRemove')}: ${name}`} onClick={() => void remove(lang)}>
                {t('prefs.offlineDictRemove')}
              </button>
            )}
            {!downloading && !have && info && (
              <button
                disabled={!!busy}
                aria-label={`${t('prefs.offlineDictDownload', { size: formatBytes(info.bytes) })}: ${name}`}
                onClick={() => void download(lang, info)}
              >
                {t('prefs.offlineDictDownload', { size: formatBytes(info.bytes) })}
              </button>
            )}
          </Row>
        )
      })}
    </Section>
  )
}

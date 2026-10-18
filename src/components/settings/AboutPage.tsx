import { isNativeApp } from '../../lib/updater'
import { t } from '../../i18n'
import { Row, Section } from './parts'

export function AboutPage({ busy, onCheckUpdate }: { busy: boolean; onCheckUpdate: () => void }) {
  return (
    <>
      <Section title={t('app.title')}>
        <p className="prefs-about">{t('prefs.aboutText')}</p>
      </Section>
      {isNativeApp && (
        <Section title={t('prefs.updates')}>
          <Row label={t('menu.checkUpdate')} hint={t('menu.checkUpdateTip')}>
            <button disabled={busy} onClick={onCheckUpdate}>{t('menu.checkUpdate')}</button>
          </Row>
        </Section>
      )}
      <Section title={t('prefs.shortcuts')}>
        <ul className="shortcuts-list">
          <li><kbd>←</kbd> <kbd>→</kbd> <kbd>{t('kbd.space')}</kbd> {t('kbd.turnPage')}</li>
          <li><kbd>+</kbd> <kbd>-</kbd> {t('kbd.fontSize')}</li>
          <li><kbd>b</kbd> {t('kbd.bookmark')} · <kbd>[</kbd> <kbd>]</kbd> {t('kbd.bookmarkNav')}</li>
          <li><kbd>t</kbd> {t('kbd.toc')} · <kbd>n</kbd> {t('kbd.notes')}</li>
          <li><kbd>a</kbd> {t('kbd.auto')} · <kbd>,</kbd> <kbd>.</kbd> {t('kbd.pace')}</li>
          <li><kbd>r</kbd> {t('kbd.tts')} · <kbd>f</kbd> {t('kbd.focus')} · <kbd>m</kbd> {t('kbd.bars')}</li>
          <li><kbd>/</kbd> {t('kbd.search')} · <kbd>s</kbd> {t('kbd.settings')} · <kbd>Esc</kbd> {t('kbd.close')}</li>
        </ul>
      </Section>
    </>
  )
}

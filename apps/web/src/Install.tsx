import type { CurrentBrowser } from './current-browser.js';
import type { ExtensionFiles } from './controller.js';
import type { Language } from './presentation.js';
import { browserGuide } from './presentation.js';
import { translate as t } from './i18n.js';
export function Install({
  locale,
  agent,
  files = null,
  current,
  next,
}: {
  locale: Language;
  agent: string;
  files?: ExtensionFiles | null;
  current?: CurrentBrowser | undefined;
  next: () => void;
}) {
  const guide = browserGuide(agent);
  return (
    <section className="install">
      <p className="eyebrow">{t(locale, 'install.eyebrow')}</p>
      <h1>{t(locale, 'install.title')}</h1>
      <p className="lead">
        {guide.name || t(locale, 'install.unknownBrowser')} ·{' '}
        {t(locale, 'install.detectionNotice')}
      </p>
      <p className="notice">
        {files
          ? t(locale, 'install.prepared', { version: files.version })
          : t(locale, 'install.packageNotice')}
      </p>
      <ol className="install-steps">
        <li>
          <h2>{t(locale, 'install.openManager')}</h2>
          <p>{t(locale, 'install.copyAddress')}</p>
          <code className="selectable">
            {guide.address || t(locale, 'install.supportedBrowser')}
          </code>
        </li>
        <li>
          <h2>{t(locale, 'install.load')}</h2>
          <p>{t(locale, 'install.loadInstructions')}</p>
          {files && (
            <>
              <code
                className="selectable"
                aria-label={t(locale, 'install.directory')}
              >
                {files.directory}
              </code>
              <p>{t(locale, 'install.pathHelp')}</p>
              <p>{t(locale, 'install.reload')}</p>
            </>
          )}
        </li>
        <li>
          <h2>{t(locale, 'install.connect')}</h2>
          <p role="status">
            {t(locale, `install.current.${current?.status ?? 'unavailable'}`)}
          </p>
          {current?.version && (
            <p>
              {t(locale, 'install.currentVersion', {
                version: current.version,
              })}
            </p>
          )}
        </li>
      </ol>
      <button className="primary" onClick={next}>
        {t(locale, 'install.overview')} →
      </button>
    </section>
  );
}

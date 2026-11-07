import type { Language } from './presentation.js';
import { browserGuide } from './presentation.js';
import { translate as t } from './i18n.js';
export function Install({
  locale,
  agent,
  next,
}: {
  locale: Language;
  agent: string;
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
      <p className="notice">{t(locale, 'install.packageNotice')}</p>
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
        </li>
        <li>
          <h2>{t(locale, 'install.connect')}</h2>
          <p>{t(locale, 'install.pairInstructions')}</p>
        </li>
      </ol>
      <button className="primary" onClick={next}>
        {t(locale, 'install.overview')} →
      </button>
    </section>
  );
}

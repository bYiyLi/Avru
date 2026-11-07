import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
export function Welcome({
  locale,
  next,
}: {
  locale: Language;
  next: () => void;
}) {
  return (
    <section className="welcome">
      <div className="hero">
        <div>
          <p className="eyebrow">{t(locale, 'welcome.eyebrow')}</p>
          <h1>
            {t(locale, 'welcome.title')}
            <br />
            <em>{t(locale, 'welcome.subtitle')}</em>
          </h1>
          <p className="lead">{t(locale, 'welcome.description')}</p>
          <button className="primary" onClick={next}>
            {t(locale, 'welcome.enter')} <span aria-hidden="true">→</span>
          </button>
          <p className="muted">{t(locale, 'welcome.control')}</p>
        </div>
        <div className="illustration" aria-hidden="true">
          <div className="orbit" />
          <div className="browser-art">
            <div className="art-bar">
              ● ● ● <span>Avru</span>
            </div>
            <div className="art-body">
              <i />
              <i />
              <div className="art-blocks">
                <b />
                <b />
              </div>
            </div>
            <div className="art-caption">{t(locale, 'welcome.caption')}</div>
          </div>
        </div>
      </div>
      <Flow locale={locale} />
    </section>
  );
}

function Flow({ locale }: { locale: Language }) {
  return (
    <ol className="flow">
      <li>
        <span>01</span>
        <div>
          <strong>{t(locale, 'welcome.stepOne')}</strong>
          <p>{t(locale, 'welcome.stepOneDescription')}</p>
        </div>
      </li>
      <li>
        <span>02</span>
        <div>
          <strong>{t(locale, 'welcome.stepTwo')}</strong>
          <p>{t(locale, 'welcome.stepTwoDescription')}</p>
        </div>
      </li>
      <li>
        <span>03</span>
        <div>
          <strong>{t(locale, 'welcome.stepThree')}</strong>
          <p>{t(locale, 'welcome.stepThreeDescription')}</p>
        </div>
      </li>
    </ol>
  );
}

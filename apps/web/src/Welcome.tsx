import { RecentCalls } from './Calls.js';
import type { CallHistory } from './call-types.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
export function Welcome({
  locale,
  next,
  history,
  onOpenLogs,
}: {
  locale: Language;
  next: () => void;
  history?: CallHistory | null;
  onOpenLogs: () => void;
}) {
  return (
    <section className="welcome" aria-label={t(locale, 'nav.welcome')}>
      <WelcomeHero locale={locale} next={next} />
      <WelcomeStory locale={locale} />
      <WelcomeAssurance locale={locale} onOpenLogs={onOpenLogs} />
      <WelcomeTrust locale={locale} />
      <WelcomeStart locale={locale} next={next} />
      <RecentCalls
        history={history ?? null}
        locale={locale}
        onOpenLogs={onOpenLogs}
      />
    </section>
  );
}

function WelcomeHero({ locale, next }: { locale: Language; next: () => void }) {
  return (
    <div className="hero">
      <div className="welcome-hero-copy">
        <p className="eyebrow">{t(locale, 'welcome.eyebrow')}</p>
        <h1>
          {t(locale, 'welcome.title')}
          <br />
          <em>{t(locale, 'welcome.subtitle')}</em>
        </h1>
        <p className="lead">{t(locale, 'welcome.description')}</p>
        <button className="primary welcome-cta" type="button" onClick={next}>
          {t(locale, 'welcome.enter')} <span aria-hidden="true">→</span>
        </button>
        <p className="muted welcome-micro">{t(locale, 'welcome.control')}</p>
      </div>
      <div className="illustration" aria-hidden="true">
        <div className="orbit" />
        <div className="browser-art">
          <div className="art-bar">
            <span className="welcome-window-dots">● ● ●</span>
            <span className="welcome-browser-name">
              {t(locale, 'welcome.visualBrowser')}
            </span>
          </div>
          <div className="art-body">
            <i />
            <i />
            <div className="art-blocks">
              <b />
              <b />
            </div>
            <i />
          </div>
        </div>
        <div className="art-caption">
          <span className="welcome-note-icon">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path
                d="M7 16.5 13 22l12-13"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            <strong>{t(locale, 'welcome.caption')}</strong>
            <small>{t(locale, 'welcome.captionDetail')}</small>
          </span>
        </div>
      </div>
    </div>
  );
}

function WelcomeStory({ locale }: { locale: Language }) {
  return (
    <section className="welcome-story" aria-labelledby="welcome-story-title">
      <div>
        <p className="welcome-section-label">
          {t(locale, 'welcome.storyEyebrow')}
        </p>
        <h2 id="welcome-story-title">
          {t(locale, 'welcome.storyTitleTop')}
          <br />
          {t(locale, 'welcome.storyTitleBottom')}
        </h2>
      </div>
      <div className="welcome-story-points">
        <article>
          <span className="welcome-point-number" aria-hidden="true">
            01
          </span>
          <div>
            <h3>{t(locale, 'welcome.storyPointOneTitle')}</h3>
            <p>{t(locale, 'welcome.storyPointOneDescription')}</p>
          </div>
        </article>
        <article>
          <span className="welcome-point-number" aria-hidden="true">
            02
          </span>
          <div>
            <h3>{t(locale, 'welcome.storyPointTwoTitle')}</h3>
            <p>{t(locale, 'welcome.storyPointTwoDescription')}</p>
            <small>{t(locale, 'welcome.storyNote')}</small>
          </div>
        </article>
      </div>
    </section>
  );
}

function WelcomeAssurance({
  locale,
  onOpenLogs,
}: {
  locale: Language;
  onOpenLogs: () => void;
}) {
  return (
    <section
      className="welcome-assurance"
      aria-labelledby="welcome-assurance-title"
    >
      <div>
        <p className="welcome-section-label">
          {t(locale, 'welcome.assuranceEyebrow')}
        </p>
        <h2 id="welcome-assurance-title">
          {t(locale, 'welcome.assuranceTitleTop')}
          <br />
          {t(locale, 'welcome.assuranceTitleBottom')}
        </h2>
      </div>
      <div>
        <p>{t(locale, 'welcome.assuranceDescription')}</p>
        <button
          className="welcome-text-link"
          type="button"
          onClick={onOpenLogs}
        >
          {t(locale, 'welcome.assuranceAction')}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </section>
  );
}

function WelcomeTrust({ locale }: { locale: Language }) {
  return (
    <section className="welcome-trust" aria-labelledby="welcome-trust-title">
      <div className="welcome-trust-visual" aria-hidden="true">
        <span className="welcome-trust-ring">
          <svg viewBox="0 0 64 64" fill="none">
            <rect
              x="13"
              y="19"
              width="38"
              height="31"
              rx="7"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <path
              d="M22 19v-5a10 10 0 0 1 20 0v5"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="m26 34 5 5 9-10"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span>{t(locale, 'welcome.trustVisualCaption')}</span>
      </div>
      <div className="welcome-trust-copy">
        <p className="welcome-section-label">
          {t(locale, 'welcome.trustEyebrow')}
        </p>
        <h2 id="welcome-trust-title">
          {t(locale, 'welcome.trustTitleTop')}
          <br />
          {t(locale, 'welcome.trustTitleBottom')}
        </h2>
        <p>{t(locale, 'welcome.trustDescription')}</p>
        <div className="welcome-trust-steps">
          <span>{t(locale, 'welcome.trustStepOne')}</span>
          <span aria-hidden="true">→</span>
          <span>{t(locale, 'welcome.trustStepTwo')}</span>
          <span aria-hidden="true">→</span>
          <span>{t(locale, 'welcome.trustStepThree')}</span>
        </div>
        <small>{t(locale, 'welcome.trustNote')}</small>
      </div>
    </section>
  );
}

function WelcomeStart({
  locale,
  next,
}: {
  locale: Language;
  next: () => void;
}) {
  return (
    <section className="welcome-start" aria-labelledby="welcome-start-title">
      <p className="welcome-section-label">
        {t(locale, 'welcome.startEyebrow')}
      </p>
      <h2 id="welcome-start-title">{t(locale, 'welcome.startTitle')}</h2>
      <p>{t(locale, 'welcome.startDescription')}</p>
      <Flow locale={locale} />
      <button className="primary welcome-cta" type="button" onClick={next}>
        {t(locale, 'welcome.startAction')} <span aria-hidden="true">→</span>
      </button>
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

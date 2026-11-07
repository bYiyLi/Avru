import type { ViewState } from './controller.js';
import type { Language } from './presentation.js';
import { translate as t } from './i18n.js';
export interface Actions {
  approve: (id: string) => void;
  reject: (id: string) => void;
  revoke: (id: string) => void;
}
export function Pairings({
  state,
  locale,
  approve,
  reject,
}: { state: ViewState; locale: Language } & Pick<
  Actions,
  'approve' | 'reject'
>) {
  return (
    <>
      {state.pairings.map((pairing) => (
        <section
          className="pairing"
          key={pairing.id}
          aria-label={t(locale, 'pairing.label')}
        >
          <div>
            <h2>{t(locale, 'pairing.requestTitle', { name: pairing.name })}</h2>
            <p>{t(locale, 'pairing.verify')}</p>
            <code className="pair-code">{pairing.code}</code>
            <p className="muted">
              {pairing.origin} · {t(locale, 'pairing.expires')}{' '}
              {new Date(pairing.expiresAt).toLocaleTimeString(locale)}
            </p>
          </div>
          <div className="actions">
            <button
              disabled={state.busy}
              onClick={() => {
                approve(pairing.id);
              }}
            >
              {t(locale, 'pairing.approve')}
            </button>
            <button
              disabled={state.busy}
              onClick={() => {
                reject(pairing.id);
              }}
            >
              {t(locale, 'pairing.reject')}
            </button>
          </div>
        </section>
      ))}
    </>
  );
}

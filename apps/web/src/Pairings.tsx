import type { ViewState } from './controller.js';
import type { Language } from './presentation.js';
import { translate as t } from './presentation.js';
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
          aria-label={t(locale, '配对请求', 'Pairing request')}
        >
          <div>
            <h2>
              {pairing.name} · {t(locale, '请求配对', 'Pairing requested')}
            </h2>
            <p>
              {t(
                locale,
                '核对扩展弹窗与这里的六位码完全一致，再批准。不要批准不认识的请求。',
                'Compare this code with the extension popup before approval. Reject unfamiliar requests.',
              )}
            </p>
            <code className="pair-code">{pairing.code}</code>
            <p className="muted">
              {pairing.origin} · {t(locale, '到期', 'Expires')}{' '}
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
              {t(locale, '核对一致，批准配对', 'Codes match, approve')}
            </button>
            <button
              disabled={state.busy}
              onClick={() => {
                reject(pairing.id);
              }}
            >
              {t(locale, '拒绝请求', 'Reject')}
            </button>
          </div>
        </section>
      ))}
    </>
  );
}

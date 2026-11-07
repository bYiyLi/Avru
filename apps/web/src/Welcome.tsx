import { translate as t } from './presentation.js';
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
          <p className="eyebrow">
            {t(locale, '本地浏览器 · 由你掌控', 'YOUR BROWSER, CONNECTED.')}
          </p>
          <h1>
            {t(locale, '你的浏览器，', 'Your browser,')}
            <br />
            <em>{t(locale, '多一种可能。', 'more possibilities.')}</em>
          </h1>
          <p className="lead">
            {t(
              locale,
              '在熟悉的浏览器里连接 Avru。先安装扩展，再核验本机连接，统一查看所有浏览器的状态。',
              'Connect Avru to your everyday browser. Install the extension, verify the local connection, and see all your browsers in one place.',
            )}
          </p>
          <button className="primary" onClick={next}>
            {t(locale, '进入 Avru', 'Enter Avru')}{' '}
            <span aria-hidden="true">→</span>
          </button>
          <p className="muted">
            {t(
              locale,
              '本机连接 · 由你确认安装 · 随时撤销配对',
              'Local connection · You approve installation · Revoke anytime',
            )}
          </p>
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
            <div className="art-caption">
              {t(
                locale,
                '让连接，各就其位。',
                'A little help. More possibility.',
              )}
            </div>
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
          <strong>{t(locale, '欢迎使用 Avru', 'Meet Avru')}</strong>
          <p>
            {t(
              locale,
              '本机浏览器连接工作台。',
              'Your local browser workspace.',
            )}
          </p>
        </div>
      </li>
      <li>
        <span>02</span>
        <div>
          <strong>{t(locale, '加载浏览器扩展', 'Load the extension')}</strong>
          <p>
            {t(
              locale,
              '在当前浏览器中完成安装与配对。',
              'Install and pair in this browser.',
            )}
          </p>
        </div>
      </li>
      <li>
        <span>03</span>
        <div>
          <strong>{t(locale, '查看系统总览', 'See the overview')}</strong>
          <p>
            {t(
              locale,
              '检查浏览器、版本与可用能力。',
              'Inspect browsers, versions and capabilities.',
            )}
          </p>
        </div>
      </li>
    </ol>
  );
}

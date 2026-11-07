import type { ViewState, BrowserProfile } from './controller.js';
import type { Actions } from './Pairings.js';
import { translate as t, versionStatus } from './presentation.js';
import type { Language } from './presentation.js';
function Version({
  browser,
  expected,
  locale,
}: {
  browser: BrowserProfile;
  expected: string | undefined;
  locale: Language;
}) {
  const metadata = browser.connected ? browser.metadata : null;
  const status = versionStatus(metadata?.extensionVersion, expected);
  const labels = {
    match: t(locale, '一致', 'Match'),
    mismatch: t(locale, '不一致', 'Mismatch'),
    unknown: t(locale, '未知', 'Unknown'),
  };
  return (
    <>
      <td>
        {reportedValue(metadata?.browserVersion, locale)}
        <small>{sourceLabel(metadata?.versionSource, locale)}</small>
      </td>
      <td>
        {metadata?.extensionVersion || '—'}
        <small className={status}>
          {labels[status]} · {t(locale, '期望', 'Expected')} {expected || '—'}
        </small>
      </td>
    </>
  );
}
function BrowserRows({
  state,
  locale,
  revoke,
}: { state: ViewState; locale: Language } & Pick<Actions, 'revoke'>) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {[
              t(locale, '浏览器 / 配置', 'Browser / profile'),
              t(locale, '浏览器版本', 'Browser version'),
              t(locale, '插件版本', 'Extension version'),
              t(locale, '状态', 'Status'),
              t(locale, '操作', 'Action'),
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.browsers.map((browser) => (
            <tr key={browser.id}>
              <td>
                <strong>{browser.name}</strong>
                <small>
                  {reportedValue(
                    browser.connected
                      ? browser.metadata?.browserName
                      : undefined,
                    locale,
                  )}
                </small>
                <small>{browser.id}</small>
                {browser.connected && (
                  <details>
                    <summary>
                      {browser.tabs.length} {t(locale, '个标签页', 'tabs')}
                    </summary>
                    <ul>
                      {browser.tabs.map((tab) => (
                        <li key={tab.id}>
                          <strong>{tab.title}</strong>
                          <small>{tab.url}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </td>
              <Version
                browser={browser}
                expected={state.system?.expectedExtensionVersion}
                locale={locale}
              />
              <td>
                <span className={browser.connected ? 'match' : 'muted'}>
                  {browser.connected
                    ? t(locale, '在线', 'Online')
                    : t(locale, '离线', 'Offline')}
                </span>
                <small>{t(locale, '已配对', 'Paired')}</small>
              </td>
              <td>
                <button
                  disabled={state.busy}
                  onClick={() => {
                    revoke(browser.id);
                  }}
                >
                  {t(locale, '撤销此浏览器配对', 'Revoke pairing')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Overview({
  state,
  locale,
  revoke,
}: { state: ViewState; locale: Language } & Pick<Actions, 'revoke'>) {
  const online = state.browsers.filter((browser) => browser.connected).length;
  return (
    <section className="overview">
      <p className="eyebrow">{t(locale, '本机工作台', 'LOCAL WORKSPACE')}</p>
      <h1>{t(locale, '让连接，各就其位。', 'Every connection, in place.')}</h1>
      <div className="metrics">
        <div>
          <span>{t(locale, 'Avru 守护进程', 'Avru daemon')}</span>
          <strong>{state.system ? state.system.daemonVersion : '—'}</strong>
          <small>
            {state.system
              ? t(locale, '管理 API 已响应', 'Management API responding')
              : t(locale, '状态未确认', 'Status not confirmed')}
          </small>
        </div>
        <div>
          <span>{t(locale, '浏览器连接', 'Browsers')}</span>
          <strong>
            {online} / {state.browsers.length}
          </strong>
          <small>{t(locale, '在线 / 已配对', 'Online / paired')}</small>
        </div>
        <div>
          <span>MCP</span>
          <strong>{t(locale, '尚未实现', 'Not implemented')}</strong>
          <small>
            {t(
              locale,
              '本机配对不代表远程可用',
              'Local pairing is not remote access',
            )}
          </small>
        </div>
      </div>
      <div className="section-heading">
        <h2>{t(locale, '已对接浏览器', 'Connected browser profiles')}</h2>
        <span>
          {t(
            locale,
            '版本一致性比较：插件与期望版本',
            'Version comparison: extension vs expected',
          )}
        </span>
      </div>
      {state.browsers.length ? (
        <BrowserRows state={state} locale={locale} revoke={revoke} />
      ) : (
        <p className="empty">
          {t(
            locale,
            '尚未连接浏览器，请先安装扩展并配对。',
            'No paired browsers. Install the extension and pair it first.',
          )}
        </p>
      )}
      <Capabilities locale={locale} />
    </section>
  );
}

function Capabilities({ locale }: { locale: Language }) {
  return (
    <div className="lower-grid">
      <section>
        <h2>{t(locale, '连接你的 AI', 'Connect your AI')}</h2>
        {['ChatGPT', 'FRPC'].map((name) => (
          <details className="channel" key={name}>
            <summary>
              <strong>{name}</strong>
              <span>{t(locale, '尚未实现', 'Not implemented')} ＋</span>
            </summary>
            <p>
              {t(
                locale,
                '当前版本没有可用的通道配置或 MCP OAuth 服务，不能保存配置或生成接入地址。浏览器连接不代表已授权远程访问。',
                'This version has no working channel configuration or MCP OAuth service. Configuration and connection URLs are unavailable. Browser pairing does not authorize remote access.',
              )}
            </p>
          </details>
        ))}
      </section>
      <section>
        <h2>{t(locale, 'MCP 调用与链路日志', 'MCP calls & trace logs')}</h2>
        <p className="empty">
          {t(locale, '暂无真实调用记录', 'No real call records')}
        </p>
        <p className="muted">
          {t(
            locale,
            'MCP 执行与日志后端尚未实现。此处不生成模拟请求、成功率或链路。后续将以 Trace / Request / Span 关联真实步骤与脱敏日志，超时保留结果未知。',
            'MCP execution and logging are not implemented. No simulated calls, success rates or traces are generated here. Future Trace / Request / Span records will correlate real steps and redacted logs; timeouts remain unknown.',
          )}
        </p>
      </section>
    </div>
  );
}

function reportedValue(value: string | undefined, locale: Language) {
  return value && value !== 'Unknown' ? value : t(locale, '未知', 'Unknown');
}
function sourceLabel(source: string | undefined, locale: Language) {
  if (source === 'userAgent')
    return t(locale, '浏览器报告，可能已缩减', 'Reported, may be reduced');
  if (source === 'clientHints')
    return t(locale, '浏览器报告', 'Browser reported');
  return t(locale, '未取得版本信息', 'Version information unavailable');
}

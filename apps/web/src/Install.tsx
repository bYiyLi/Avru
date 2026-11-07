import type { Language } from './presentation.js';
import { browserGuide, translate as t } from './presentation.js';
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
      <p className="eyebrow">
        {t(locale, '本地安装 / 02', 'LOCAL INSTALLATION / 02')}
      </p>
      <h1>{t(locale, '连接当前浏览器', 'Connect this browser')}</h1>
      <p className="lead">
        {guide.name || t(locale, '未识别的浏览器', 'Unknown browser')} ·{' '}
        {t(
          locale,
          '浏览器类型仅用于提供指引，不代表已检测到扩展。未响应也可能是扩展被禁用、无痕模式或连接异常。',
          'Browser identification only selects this guide. No response can also mean a disabled extension, private browsing or a connection issue.',
        )}
      </p>
      <p className="notice">
        {t(
          locale,
          '当前开发包尚未包含可安装的扩展目录。下面是本地加载流程，需使用项目构建产生的扩展目录；不要选择 npx 缓存目录。',
          'This development package does not yet include an installable extension directory. The steps below require the project-built extension folder, not the npx cache.',
        )}
      </p>
      <ol className="install-steps">
        <li>
          <h2>{t(locale, '打开扩展管理页', 'Open extension management')}</h2>
          <p>
            {t(
              locale,
              '将下方地址复制到当前浏览器地址栏。浏览器可能禁止普通网页直接打开内部设置页。',
              'Copy this address into this browser’s address bar. Browsers may block direct navigation from a web page.',
            )}
          </p>
          <code className="selectable">
            {guide.address ||
              t(
                locale,
                '请在受支持的 Chrome 或 Edge 中打开此页面',
                'Open this page in supported Chrome or Edge',
              )}
          </code>
        </li>
        <li>
          <h2>{t(locale, '加载本地扩展', 'Load the local extension')}</h2>
          <p>
            {t(
              locale,
              '开启「开发者模式」，点击「加载已解压的扩展程序」，选择构建生成的 chrome-mv3 文件夹。Mac 可在文件选择器按 ⌘⇧G 输入路径；Windows 可在地址栏粘贴路径。',
              'Enable Developer mode, choose Load unpacked, and select the built chrome-mv3 folder. On Mac use ⌘⇧G in the picker; on Windows paste the folder path into the address bar.',
            )}
          </p>
        </li>
        <li>
          <h2>{t(locale, '发起连接并核验', 'Connect and verify')}</h2>
          <p>
            {t(
              locale,
              '打开 Avru 扩展弹窗并点击配对，返回本页核对配对请求。批准后可在系统总览查看连接。当前版本仍保留核对码，不会自动批准未知扩展。',
              'Open the Avru extension popup and choose Pair. Return here to verify its pairing request. This version retains verification codes and never auto-approves unknown extensions.',
            )}
          </p>
        </li>
      </ol>
      <button className="primary" onClick={next}>
        {t(locale, '查看系统总览', 'Open system overview')} →
      </button>
    </section>
  );
}

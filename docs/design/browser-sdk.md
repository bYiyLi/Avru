# 浏览器 SDK 与页面操作

> **当前最高优先级的设计合同：D-17（2026-11-08 全自动执行）。** 本文件在 D-17 之前写成的“按敏感动作确认”“CDP 仅当前 origin”“必须先人工认领”和“页面 JS/Cookie 不开放”等表述均为历史草案，需按本文下方已更新的确认策略和 D-17 执行；这不代表相关 M2–M5 能力已经实现。

本文件拥有浏览器 SDK 能力面、接口契约、层间协议、全自动执行状态机、调度与恢复、客户端/设备身份边界及调用链审计的合同。MCP 工具定义见[MCP 与授权](mcp.md)；连接与目标路由见[浏览器连接](browser-connection.md)；运行器与进程间协议见[运行器](runner.md)；数据与安全见[数据与安全](security.md)；实施与验收见[08 浏览器 SDK 与 MCP 执行](../development/phases/08-browser-sdk-mcp.md)。设计选择不等于代码或真实浏览器验收已完成。

对应 R-16、D-12、D-15、D-16；Q-08 的首版动作集部分由 D-15 决定。

## 对齐目标（D-15，已确认）

Avru 的浏览器 SDK 与 Codex `26.1103.32239` 相同的浏览器控制能力对齐，由 Avru 自己实现，不使用 OpenAI 代码。

- 对照基准为 Mac 本机 Codex `26.1103.32239` 的静态接口定义：`docs/api.json`（SHA256 `ad0f401b995bb3e590e46d2b95b6306c6f231ba849268bbaec055ebe59daae6d`，2090 行，22 个接口）、`documents.json` 及 `docs/capabilities`。只归纳接口事实和自写说明，不复制专有实现或长篇原文。
- 例外一：反爬上报（botDetection）不实现。
- 例外二：登录与认证协助由 Avru 适配，不照搬 browserAuth / siwc；客户端 OAuth 首次连接认证与 AI 浏览器内动作无需人工逐次批准是两个独立边界（见 D-17）。
- 不适用：iab、mcpapps 后端与 siwc 登录是 ChatGPT 产品面，Avru 没有对应后端，不实现；Avru 的后端为 extension 与 cdp（用户自己的浏览器）。
- 参考目录 `docs/26.1103.32239` 保留作对照，不删除，不进入发布物。

## 架构（引用，不复制）

调用链为 AI → MCP 工具 → Avru 守护进程 → QuickJS 受控脚本 → 浏览器 SDK → 扩展 → 浏览器。

- MCP 是 AI 调用 Avru 的入口；SDK 是脚本里操作浏览器的能力；两者不是同一层。MCP 工具定义见[mcp.md](mcp.md)。
- 守护进程是可信的权限、连接与路由中心，管理独立、可复用的 QuickJS WASM 执行进程；与扩展使用 WebSocket 通信；浏览器操作使用 CDP 或扩展 API。连接合同见[browser-connection.md](browser-connection.md)，运行器合同见[runner.md](runner.md)。
- 脚本命名不使用 `avru.` 品牌前缀；以 `browser` 作为语义化入口。
- 一个环境可连接多个浏览器和个人资料；开发版与正式版的进程、目录、数据和插件身份隔离。环境合同见[开发与正式环境](environments.md)。
- MCP OAuth 的同意操作放在已可信连接的插件授权窗口中，不提供仅凭链接就能批准的网页。授权合同见[mcp.md](mcp.md)。

## 操作方式

已确认，照抄 Codex。先观察，再操作，再验证。页面结构和元素引用为主要观察与操作方式，截图作为补充（对应 Codex `api-use-behavior.md`）。

- AI 从页面结构（快照）中选择搜索框、按钮等元素的引用，不凭空编造引用。
- 页面导航或内容变化后，引用是否仍然有效，由接口明确说明，不能让 AI 猜测。
- 每次动作后用最便宜的方式确认状态：要定位依据就拿新的 DOM 快照，要视觉确认再截图，默认不同时要两个。
- 动作没效果时不盲目重试，也不立刻降级到坐标操作；先查页面是否被挡住或状态已变，处理后再重试最直接的语义动作。
- 按可见状态操作，不按 DOM 源码顺序；页面上第一个链接不一定是 DOM 里的第一个 `a`。
- 同一网址不重复打开（重复打开会刷新并丢失已填信息）；要刷新调 `reload()`。
- 一个强有力的页面信号即视为答案，除非有直接矛盾的信号：选中项、勾选态、成功弹窗/toast、篮子行、排序选项、URL 参数；不要对同一事实反复核验。
- 只读查找任务可一次聚焦直达明显的结果/详情 URL 再验证，不猜 URL 变体、不遍历候选 URL。
- 动作后重新观察结果；旧观察不能无限沿用。

示例（按[SDK 接口契约](#sdk-接口契约)的方法签名书写；target 必须明确指向用户授权的浏览器与标签页）：

```js
const page = browser.tab; // 本次任务已认领的目标标签页
const view = await page.snapshot();
// AI 从 view 中选择搜索框与按钮的引用，不凭空编造引用。
await page.fill(searchInputRef, '耳机');
await page.click(searchButtonRef);
await page.waitFor(resultCondition);
const result = await page.snapshot();
```

## SDK 接口契约

本节是实现依据：方法名、入参、返回、错误、前置条件。方法签名用 TypeScript 风格书写，实际脚本运行在 QuickJS WASM 内，只支持 JSON 可序列化值往返；函数、DOM 节点、Promise 不能跨越桥接。

### 类型

```ts
type BrowserId = string; // daemon 分配的浏览器连接标识
type TabId = string; // 浏览器内标签页标识，只在所属浏览器内有效
type Generation = number; // 连接代次，重连后递增；旧代次引用失效
type ElementRef = string; // 快照返回的元素引用，不透明字符串
type NodeId = number; // DomCUA 可见 DOM 节点标识

interface BrowserTab {
  browserId: BrowserId;
  tabId: TabId;
  generation: Generation;
  title?: string;
  url?: string;
  active: boolean;
  claimed: boolean;
}

interface SnapshotNode {
  ref: ElementRef;
  role: string; // 如 button / textbox / link
  name?: string; // 可访问名称
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  children?: SnapshotNode[];
}

interface PageSnapshot {
  tabId: TabId;
  generation: Generation;
  pageVersion: number; // 导航代次：每次导航或同页重大变化递增
  url: string;
  title: string;
  root: SnapshotNode;
  truncated: boolean; // 内容被截断时为 true
  dialog?: {
    type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
    message: string;
  };
}

interface ActionResult {
  ok: boolean;
  tabId: TabId;
  generation: Generation;
  pageVersion: number; // 动作完成时的页面版本
  changed: boolean; // 动作是否改变了页面；判定见标签页方法说明
}

interface WaitCondition {
  kind: 'selector' | 'text' | 'url' | 'navigation' | 'state';
  value: string;
  state?: 'attached' | 'visible' | 'hidden' | 'detached';
  timeoutMs?: number;
  pollingMs?: number; // 条件轮询间隔，不填用默认值
}

interface ScreenshotOptions {
  fullPage?: boolean; // 默认 false，只截视口
  quality?: number; // JPEG 质量，默认 80
  maxEdgePx?: number; // 最长边上限，默认 1920
  clip?: { x: number; y: number; width: number; height: number }; // 区域截图，坐标为页面坐标
}

interface CapabilityInfo {
  name: string;
  title: string;
  description: string;
  supported: boolean;
  reason?: string; // 不支持时说明原因
}

interface SdkError {
  code: string; // 取自错误码表
  message: string;
  method?: string;
  ref?: ElementRef;
  tabId?: TabId;
  generation?: Generation;
}

interface Browser {
  browserId: BrowserId;
  name: string;
  type: 'extension' | 'cdp';
  profileName?: string;
}

// 定位器选项（对齐 Codex Locator*Options）
type MouseButton = 'left' | 'right' | 'middle';
type KeyboardModifier = 'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift';
type TextMatcher = string | RegExp;
type WaitForState = 'attached' | 'detached' | 'visible' | 'hidden';
type LoadState = 'load' | 'domcontentloaded' | 'networkidle';
type WaitUntil = LoadState | 'commit';

interface LocatorClickOptions {
  button?: MouseButton;
  modifiers?: KeyboardModifier[];
  clickCount?: number; // Avru 扩展：Codex 无此项；双击另有 dblclick
  position?: { x: number; y: number }; // Avru 扩展：元素内相对坐标，默认点中心
  timeoutMs?: number;
  // force（绕过可操作性检查）不开放（M0 已冻结，force 不开放）
}
interface LocatorCheckOptions {
  timeoutMs?: number;
}
interface LocatorFilterOptions {
  has?: Locator;
  hasNot?: Locator;
  hasText?: TextMatcher;
  hasNotText?: TextMatcher;
  visible?: boolean;
}
interface LocatorLocatorOptions {
  has?: Locator;
  hasNot?: Locator;
  hasText?: TextMatcher;
  hasNotText?: TextMatcher;
}
interface LocatorWaitForOptions {
  state: WaitForState;
  timeoutMs?: number;
}
interface LocatorPressSequentiallyOptions {
  timeoutMs?: number;
}
interface LocatorDownloadMediaOptions {
  timeoutMs?: number;
} // 默认 120000，不含权限提示等待
interface PlaywrightEvaluateOptions {
  timeoutMs?: number;
}
type SelectOptionDescriptor = {
  index?: number;
  label?: string;
  value?: string;
};
type SelectOptionInput = string | SelectOptionDescriptor;

// 无障碍树选项（对齐 Codex AX*）
type AXMouseButton = 'left' | 'right' | 'middle';
type AXDirection = 'up' | 'down' | 'left' | 'right';
type AXPoint = { x: number; y: number }; // Codex 为 [unknown, unknown]，Avru 用具名坐标
interface AXClickOptions {
  clickCount?: number;
  duration?: number;
  key?: string;
  mouseButton?: AXMouseButton;
}
interface AXPressKeyOptions {
  duration?: number;
} // 按住秒数，0–30
interface AXPasteOptions {
  format?: 'text' | 'md' | 'html';
}
interface AXSelectTextOptions {
  prefix?: string;
  selectionType?: 'text' | 'cursor_before' | 'cursor_after';
  suffix?: string;
}
interface AXStateOptions {
  disableDiffing?: boolean;
}

// 坐标操作选项（对齐 Codex CUA / DomCUA *Options）
interface ClickOptions {
  button?: number;
  keypress?: string[];
  x: number;
  y: number;
} // button：1 左、2 中、3 右、4 后退、5 前进
interface DoubleClickOptions {
  keypress?: string[];
  x: number;
  y: number;
}
interface DragOptions {
  keys?: string[];
  path: { x: number; y: number }[];
}
interface KeypressOptions {
  duration?: number;
  keys: string[];
} // duration 按住秒数，0–30
interface MoveOptions {
  keys?: string[];
  x: number;
  y: number;
}
interface ScrollOptions {
  keypress?: string[];
  scrollX: number;
  scrollY: number;
  x: number;
  y: number;
}
interface TypeOptions {
  text: string;
}
interface CuaDownloadMediaOptions {
  timeoutMs?: number;
  x: number;
  y: number;
}
interface DomClickOptions {
  node_id: string;
} // getVisibleTree 返回的节点标识
interface DomDownloadMediaOptions {
  node_id: string;
  timeoutMs?: number;
}
interface DomKeypressOptions {
  keys: string[];
}
interface DomScrollOptions {
  node_id?: string;
  x: number;
  y: number;
}
interface DomTypeOptions {
  text: string;
}

// 截图与元素信息（对齐 Codex ScreenshotOptions / ElementInfo*）
interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface ElementInfoOptions {
  includeNonInteractable?: boolean;
  x: number;
  y: number;
}
interface ElementScreenshotOptions {
  includeNonInteractable?: boolean;
  x: number;
  y: number;
}
interface ElementInfo {
  ariaName?: string | null;
  boundingBox?: ClipRect | null;
  nodeId?: number | null;
  preview: string;
  role?: string | null;
  selector: {
    candidates: string[];
    frameSelectors?: string[];
    primary?: string | null;
  };
  tagName: string;
  testId?: string | null;
  visibleText?: string | null;
}

// 剪贴板、日志、内容（对齐 Codex TabClipboard* / TabDevLogs* / TabsContent*）
interface TabClipboardEntry {
  base64?: string;
  mimeType: string;
  text?: string;
}
interface TabClipboardItem {
  entries: TabClipboardEntry[];
  presentationStyle?: 'unspecified' | 'inline' | 'attachment';
}
interface TabDevLogsOptions {
  filter?: string;
  levels?: ('debug' | 'info' | 'log' | 'warn' | 'error' | 'warning')[];
  limit?: number;
}
interface TabDevLogEntry {
  level: 'debug' | 'info' | 'log' | 'warn' | 'error';
  message: string;
  timestamp: string;
  url?: string;
}
interface TabsContentOptions {
  contentType: 'html' | 'text' | 'domSnapshot';
  timeoutMs?: number;
  urls: string[];
}
interface TabsContentResult {
  content: string | null;
  title: string | null;
  url: string;
}
interface BrowserHistoryOptions {
  from?: string;
  limit?: number;
  queries?: string[];
  to?: string;
}
interface BrowserHistoryEntry {
  dateVisited: string;
  title?: string;
  url: string;
}

// 对话框与能力集合
type Dialog = {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
};
interface TabCapabilityCollection {
  list(): Promise<{ id: string; description: string }[]>;
  get(id: string): Promise<unknown>;
}

interface Frame {
  snapshot(options?: { maxBytes?: number }): Promise<PageSnapshot>;
  click(
    ref: ElementRef,
    options?: { timeoutMs?: number },
  ): Promise<ActionResult>;
  fill(
    ref: ElementRef,
    text: string,
    options?: { timeoutMs?: number },
  ): Promise<ActionResult>;
  locator(selector: string): Locator;
  frameLocator(frameSelector: string): FrameLocator;
  getByLabel(text: TextMatcher, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: TextMatcher, options?: { exact?: boolean }): Locator;
  getByRole(
    role: string,
    options?: { exact?: boolean; name?: TextMatcher },
  ): Locator;
  getByTestId(testId: string): Locator;
  getByText(text: TextMatcher, options?: { exact?: boolean }): Locator;
  waitFor(
    condition: WaitCondition,
  ): Promise<{ matched: boolean; snapshot: PageSnapshot }>;
}
```

### 入口与目标

脚本启动时，daemon 将 AI 自动选定并以内部锁保护的目标注入为 `browser.tab`；一个任务的写操作定向该标签页。AI 可继续提交任务选择同设备的其他可控浏览器与标签页，无须人工认领或逐操作确认。

```ts
browser.tab: Tab;                                   // 本次任务自动选定并锁定的目标标签页
browser.tabs.list(): Promise<BrowserTab[]>;         // 只读：已连接浏览器的标签页元数据
browser.tabs.get(tabId: TabId): Promise<BrowserTab>; // 只读：单个标签页元数据
browser.tabs.new(url?: string, options?: { active?: boolean }): Promise<BrowserTab>;
browser.tabs.close(tabId: TabId): Promise<ActionResult>;
browser.tabs.select(tabId: TabId): Promise<ActionResult>;
browser.tabs.selected(): Promise<BrowserTab | undefined>;  // 当前活动标签页，未选返回 undefined
browser.tabs.content(options: TabsContentOptions): Promise<TabsContentResult[]>;  // 临时后台标签页批量读页，不切换当前选中标签页
browser.history(options?: BrowserHistoryOptions): Promise<BrowserHistoryEntry[]>; // 当前目标浏览器配置的浏览历史
browser.windows.list(): Promise<{ id: string; focused: boolean; type?: string; state?: string }[]>;
browser.tabs.move(tabId: TabId, options: { index: number; windowId?: number }): Promise<ActionResult>;
browser.capabilities.list(): Promise<CapabilityInfo[]>;
browser.capabilities.get(name: string): Promise<CapabilityInfo>;

// 以下为 daemon 侧发现接口，不进入 QuickJS；MCP browser_list 发现目标，browser_claim_tab 仅为可选的兼容入口
daemon.browsers.getDefault(): Promise<Browser>;        // 默认浏览器；选取规则待 M1 细化（候选：首个已连接 / 上次使用）
daemon.browsers.getForUrl(url: string): Promise<Browser>;  // 按 URL 选最合适的浏览器；匹配规则待 M1 细化
daemon.browsers.nameSession(name: string): Promise<void>;  // 为当前浏览器自动化会话命名
```

- `browser.tabs.list()` / `get()` 只返回元数据（标题、URL、在线状态），不返回页面内容；标题与 URL 也可能敏感，只发给已授权客户端。
- 同一脚本的 `browser.tab` 定向本次任务的目标；AI 可以无人工门槛地继续选择同设备其他可控标签页提交任务。跨浏览器相同 tabId 不得互相替代，daemon 按 browserId、tabId 与连接代次准确路由。
- `browser.tabs.new()` 新建目标按连接代次自动纳入可控范围；既有标签页、新接入浏览器的可控标签页也可由 AI 直接选择并自动申请任务内部锁，无需 MCP 手动认领。新标签页的 pageVersion 从 0 起；浏览器离线报 `TARGET_GONE`。
- `browser.tabs.close()` 为自动浏览器操作，不需任何人工操作确认；关闭目标标签页后任务按 `TAB_CLOSED` 中断，内部锁释放，旧元素引用失效。结果不确定时不自动重试关闭。
- `browser.tabs.select()` 可切换同设备已连接浏览器的可控标签页，无须人工认领；内部校验准确目标与连接代次，目标不存在时报 `TARGET_GONE`。
- 新建、关闭、切换的前置条件与 `browser.tab` 相同：连接代次一致；三个方法对齐 Codex 的 Tabs / Tab 接口面（见[分层模型](#分层模型)），由 Avru 自己实现；三项全部进入首版，是 D-15 对齐范围的一部分。
- `browser.tabs.selected()` 返回当前活动标签页；未选中任何标签页时返回 undefined。
- `browser.tabs.content()` 在临时后台标签页中批量打开 URL 并提取内容，不切换当前选中标签页；Codex 侧 extension / cdp 默认不支持，Avru 用临时后台标签页自实现，M5 交付；批量读取不改变用户当前浏览状态。
- `browser.tabs.content()` 当前实现支持每批 1–8 个 HTTP(S) URL、`text` / `html` / `domSnapshot`，批次共用默认 30 秒、最大 30 秒的截止时间。每页内容最多 4096 个 UTF-16 代码单元，批次返回 JSON 的 UTF-8 编码最多 60000 字节；超量缩减摘录或报错，不承诺全文导出。临时标签页在成功与失败后清理，网页不可达时按浏览器限制返回失败；不包含任意本地文件读取。
- `browser.history()` 通过所选、可信连接的浏览器扩展原生 `history.search` 查访问记录，`limit` 为 1–20（默认 20）、`queries` 最多 4 个文本条件、`from/to` 为日期字符串；按 URL 去重并按最近访问时间排序。需要扩展安装级 `history` 权限，未授予时不能返回伪造的空历史；它不是逐次业务操作确认。返回的是当前浏览器配置可见的记录，不跨未连接的配置。
- `browser.windows.list()` 只列出目标浏览器配置中浏览器原生可见的普通窗口，最多 100 条，忽略无痕窗口及无效 ID，不包含窗口内网页正文。`browser.tabs.move(tabId,{index,windowId?})` 在本次目标浏览器配置中移动标签页：`index` 为从 0 开始的整数或 `-1`（追加到末尾），`windowId` 可选；daemon 校验连接代次和目标标签页的内部占用锁，不能跨浏览器配置串用 ID，结果未知时不自动重试移动。
- `daemon.browsers.getDefault()` / `getForUrl()` / `nameSession()` 是 daemon 侧接口，不进入 QuickJS 脚本；选取与匹配规则待 M1 细化；nameSession 见[AI 控制可视化](#ai-控制可视化)。

### 标签页方法

```ts
interface Tab {
  // 观察（只读）
  snapshot(options?: {
    maxBytes?: number;
    root?: ElementRef;
    frame?: string;
  }): Promise<PageSnapshot>;
  screenshot(
    options?: ScreenshotOptions,
  ): Promise<{ data: string; mimeType: 'image/jpeg' }>;
  evaluate(expression: string, args?: unknown): Promise<unknown>;
  devLogs(
    options?: TabDevLogsOptions & { since?: number },
  ): Promise<TabDevLogEntry[]>;

  // 导航
  navigate(
    url: string,
    options?: {
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      timeoutMs?: number;
    },
  ): Promise<ActionResult>;
  goBack(options?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    timeoutMs?: number;
  }): Promise<ActionResult>;
  forward(options?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    timeoutMs?: number;
  }): Promise<ActionResult>;
  reload(options?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    timeoutMs?: number;
  }): Promise<ActionResult>;

  // 标题与网址（快照已返回同名信息；独立查询用于不取整页快照时）
  title(): Promise<string | undefined>;
  url(): Promise<string | undefined>;
  getJsDialog(): Promise<Dialog | undefined>;

  // 操作（元素引用来自最近一次 snapshot）
  click(
    ref: ElementRef,
    options?: {
      timeoutMs?: number;
      button?: 'left' | 'right' | 'middle';
      modifiers?: ('Shift' | 'Control' | 'Alt' | 'Meta')[];
      clickCount?: number;
      position?: { x: number; y: number };
    },
  ): Promise<ActionResult>;
  fill(
    ref: ElementRef,
    text: string,
    options?: { timeoutMs?: number },
  ): Promise<ActionResult>;
  press(
    key: string,
    options?: {
      timeoutMs?: number;
      modifiers?: ('Shift' | 'Control' | 'Alt' | 'Meta')[];
    },
  ): Promise<ActionResult>;
  selectOption(
    ref: ElementRef,
    values: SelectOptionInput | SelectOptionInput[],
  ): Promise<ActionResult>;
  scroll(options: {
    x?: number;
    y?: number;
    ref?: ElementRef;
    behavior?: 'auto' | 'smooth';
  }): Promise<ActionResult>;
  hover(
    ref: ElementRef,
    options?: { timeoutMs?: number },
  ): Promise<ActionResult>;
  focus(ref: ElementRef): Promise<ActionResult>;
  setFiles(
    ref: ElementRef,
    files: { name: string; data: string; mimeType?: string }[],
  ): Promise<ActionResult>;
  locator(selector: string): Locator;

  // 视口与键盘
  setViewport(size: { width: number; height: number }): Promise<ActionResult>;
  keyboardDown(key: string): Promise<ActionResult>;
  keyboardUp(key: string): Promise<ActionResult>;

  // frame 与下载
  frame(selector: string): Promise<Frame>;
  downloads(): Promise<
    { downloadId: string; url: string; suggestedFilename: string }[]
  >;
  saveDownload(downloadId: string, path?: string): Promise<{ path: string }>;

  // 等待与验证
  waitFor(
    condition: WaitCondition,
  ): Promise<{ matched: boolean; snapshot: PageSnapshot }>;

  // 对话框
  dialogAccept(text?: string): Promise<ActionResult>;
  dialogDismiss(): Promise<ActionResult>;

  // 交还用户接管（验证码、登录等必须由用户亲自操作的场景）
  requestUserTakeover(
    reason?: 'authentication' | 'captcha' | 'user_requested' | 'other',
  ): Promise<ActionResult>;

  // 内容、导出与剪贴板
  contentExport(options: {
    format: 'html' | 'markdown' | 'text';
  }): Promise<{ data: string; truncated: boolean }>;
  exportGsuite(
    type: 'pdf' | 'md' | 'xlsx' | 'csv' | 'docx' | 'pptx',
  ): Promise<{ path: string }>;
  exportYouTubeTranscript(): Promise<{ path: string }>;
  clipboardReadText(): Promise<string>;
  clipboardWriteText(text: string): Promise<ActionResult>;
  clipboardRead(): Promise<TabClipboardItem[]>;
  clipboardWrite(items: TabClipboardItem[]): Promise<ActionResult>;

  // DomCUA / CUA / AX / Playwright（高级能力，见下表）
  dom: DomCUA;
  cua: CUA;
  ax: AX;
  playwright: Playwright;
  capabilities: TabCapabilityCollection;
}

interface Locator {
  // 组合与筛选（同步返回新定位器，不触网）
  and(locator: Locator): Locator;
  or(locator: Locator): Locator;
  filter(options: LocatorFilterOptions): Locator;
  locator(selector: string, options?: LocatorLocatorOptions): Locator;
  first(): Locator;
  last(): Locator;
  nth(index: number): Locator;
  getByLabel(text: TextMatcher, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: TextMatcher, options?: { exact?: boolean }): Locator;
  getByRole(
    role: string,
    options?: { exact?: boolean; name?: TextMatcher },
  ): Locator;
  getByTestId(testId: string): Locator;
  getByText(text: TextMatcher, options?: { exact?: boolean }): Locator;

  // 读取（只读）
  count(): Promise<number>;
  all(): Promise<Locator[]>;
  allTextContents(options?: { timeoutMs?: number }): Promise<string[]>;
  textContent(options?: { timeoutMs?: number }): Promise<string | null>;
  innerText(options?: { timeoutMs?: number }): Promise<string>;
  getAttribute(
    name: string,
    options?: { timeoutMs?: number },
  ): Promise<string | null>;
  isEnabled(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  evaluate(
    expression: string,
    args?: unknown,
    options?: PlaywrightEvaluateOptions,
  ): Promise<unknown>;
  evaluateAll(
    expression: string,
    args?: unknown,
    options?: PlaywrightEvaluateOptions,
  ): Promise<unknown>;

  // 操作
  click(options?: LocatorClickOptions): Promise<ActionResult>;
  dblclick(options?: LocatorClickOptions): Promise<ActionResult>;
  fill(text: string, options?: { timeoutMs?: number }): Promise<ActionResult>;
  type(
    text: string,
    options?: { timeoutMs?: number; delayMs?: number },
  ): Promise<ActionResult>;
  press(
    key: string,
    options?: {
      timeoutMs?: number;
      modifiers?: ('Shift' | 'Control' | 'Alt' | 'Meta')[];
    },
  ): Promise<ActionResult>;
  pressSequentially(
    text: string,
    options?: LocatorPressSequentiallyOptions,
  ): Promise<ActionResult>;
  check(options?: LocatorCheckOptions): Promise<ActionResult>;
  uncheck(options?: LocatorCheckOptions): Promise<ActionResult>;
  setChecked(
    checked: boolean,
    options?: LocatorCheckOptions,
  ): Promise<ActionResult>;
  selectOption(
    values: SelectOptionInput | SelectOptionInput[],
    options?: { timeoutMs?: number },
  ): Promise<ActionResult>;
  downloadMedia(
    options?: LocatorDownloadMediaOptions,
  ): Promise<{ path: string }>;

  // 等待
  waitFor(options: LocatorWaitForOptions): Promise<void>;
}
```

- `snapshot()` 默认截断上限见[限制数值表](#限制数值表)；`truncated: true` 时调用方应缩小范围重读，不得据截断内容宣称页面全貌。
- `evaluate()` 接受字符串表达式与 JSON 可序列化参数；可执行页面 JavaScript，包括有副作用的表达式，不再设置只读限制。函数对象和 DOM 节点不能跨 QuickJS 桥接；执行大小与超时受限，发生不确定的副作用时不自动重放。
- `click()` / `fill()` / `press()` / `selectOption()` 不幂等；调用方操作后必须用 `snapshot()` 或 `waitFor()` 验证结果，不得假设成功。
- 元素引用来自最近一次 `snapshot()`；导航、内容变化或目标过期后引用失效，须重新观察（见[元素引用与失效](#元素引用与失效)）。
- `click()` 默认左键、单击、无修饰键；`position` 为元素内相对坐标，不填点元素中心。`fill()` 先清空再填入（`Locator.fill()` 同样）；`press()` 的 `modifiers` 与按键组合发送。
- 所有带 `timeoutMs` 的方法：不填时用任务级默认超时（见[限制数值表](#限制数值表)）。
- `ActionResult.changed` 由扩展在动作后比较页面关键状态（URL、标题、可操作元素集合摘要）得出，无法判断时为 false，不得据此宣称动作一定生效。
- `setFiles()` 的文件内容以 base64 传，大小受单次桥接 64 KiB 上限约束；超大文件分片约定待 M5 细化。`saveDownload()` 的保存路径由 daemon 决定并返回。
- `requestUserTakeover()` 把当前标签页交还用户亲自操作（如验证码、登录）；调用后任务挂起等待用户接管；挂起期间的计时与接管结束后的任务状态待 M1 细化。
- `frame()` 返回的 Frame 复用 Tab 的观察与操作方法（snapshot / click / fill / locator / getBy* / frameLocator / waitFor），作用域限于该 frame 内；frame 内元素引用绑定该 frame 的 pageVersion。

### Playwright 接口（完整签名）

```ts
interface Playwright {
  domSnapshot(): Promise<string>;
  elementInfo(options: ElementInfoOptions): Promise<ElementInfo[]>;
  elementScreenshot(
    options: ElementScreenshotOptions,
  ): Promise<{ data: string; mimeType: 'image/jpeg' }>;
  evaluate(
    expression: string,
    args?: unknown,
    options?: PlaywrightEvaluateOptions,
  ): Promise<unknown>;
  expectNavigation<T>(
    action: () => Promise<T>,
    options: { timeoutMs?: number; url?: string; waitUntil?: LoadState },
  ): Promise<T>;
  frameLocator(frameSelector: string): FrameLocator;
  getByLabel(text: TextMatcher, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: TextMatcher, options?: { exact?: boolean }): Locator;
  getByRole(
    role: string,
    options?: { exact?: boolean; name?: TextMatcher },
  ): Locator;
  getByTestId(testId: string): Locator;
  getByText(text: TextMatcher, options?: { exact?: boolean }): Locator;
  locator(selector: string): Locator;
  waitForDownload(options?: {
    timeoutMs?: number;
  }): Promise<{ downloadId: string; url: string; suggestedFilename: string }>;
  waitForFileChooser(options?: { timeoutMs?: number }): Promise<FileChooser>;
  waitForLoadState(options?: {
    state?: LoadState;
    timeoutMs?: number;
  }): Promise<void>;
  waitForTimeout(timeoutMs: number): Promise<void>;
  waitForURL(
    url: string,
    options?: { timeoutMs?: number; waitUntil?: WaitUntil },
  ): Promise<void>;
}

interface FileChooser {
  isMultiple(): boolean;
  setFiles(
    files: { name: string; data: string; mimeType?: string }[],
  ): Promise<ActionResult>;
}

interface FrameLocator {
  frameLocator(frameSelector: string): FrameLocator;
  getByLabel(text: TextMatcher, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: TextMatcher, options?: { exact?: boolean }): Locator;
  getByRole(
    role: string,
    options?: { exact?: boolean; name?: TextMatcher },
  ): Locator;
  getByTestId(testId: string): Locator;
  getByText(text: TextMatcher, options?: { exact?: boolean }): Locator;
  locator(selector: string): Locator;
}
```

- `tab.playwright` 与 `tab.locator` / `tab.evaluate` / `tab.frame` / `tab.downloads` 是同一能力的两种入口：前者按 Codex 的 PlaywrightAPI 组织，后者是 Avru 的 Tab 直达方法；实现时两者共用同一桥接方法，不得各做一套。
- `waitForDownload` / `waitForFileChooser` 是 Codex `waitForEvent` 两个重载的 Avru 形态：调用方先注册等待器再触发下载 / 文件选择动作；下载完成后用 `saveDownload()` 取路径，文件选择用返回的 FileChooser 的 `setFiles()` 提交；超时报 `TIMEOUT`。`setFiles` 的文件形态与 `tab.setFiles` 一致（base64 内容；Codex 用浏览器可见的绝对路径，形态不同、能力相同）。
- `evaluate` 只接受字符串表达式；函数形态受 QuickJS 桥接限制不开放（函数、DOM 节点不能跨越桥接）。
- `expectNavigation` 的 action 是脚本内闭包（不跨越桥接），由 SDK 包装执行；等价的等待形态是 `tab.waitFor({ kind: 'navigation', ... })`。
- `waitForTimeout` 是固定等待；调用方应优先用条件等待（`waitFor` / `waitForLoadState` / `waitForURL`）。

### 高级能力方法

DomCUA / CUA / AX 的完整签名如下；浏览器组织、页面资产、导出、WebMCP、CDP 仍在下表（M5 交付，方法名与签名已冻结）。

```ts
interface DomCUA {
  getVisibleTree(): Promise<{
    nodes: { nodeId: NodeId; role: string; name?: string }[];
  }>;
  click(options: DomClickOptions): Promise<ActionResult>;
  doubleClick(options: DomClickOptions): Promise<ActionResult>;
  downloadMedia(options: DomDownloadMediaOptions): Promise<{ path: string }>;
  fill(nodeId: NodeId, text: string): Promise<ActionResult>; // Avru 扩展：Codex DomCUA 无 fill；等价于先点节点再输入
  keypress(options: DomKeypressOptions): Promise<ActionResult>;
  scroll(options: DomScrollOptions): Promise<ActionResult>;
  type(options: DomTypeOptions): Promise<ActionResult>;
}

interface CUA {
  click(options: ClickOptions): Promise<ActionResult>;
  doubleClick(options: DoubleClickOptions): Promise<ActionResult>;
  downloadMedia(options: CuaDownloadMediaOptions): Promise<void>;
  drag(options: DragOptions): Promise<ActionResult>;
  keypress(options: KeypressOptions): Promise<ActionResult>;
  move(options: MoveOptions): Promise<ActionResult>;
  scroll(options: ScrollOptions): Promise<ActionResult>;
  type(options: TypeOptions): Promise<ActionResult>;
}

interface AX {
  get(mode?: 'state', options?: AXStateOptions): Promise<string>;
  get(mode: 'screenshot'): Promise<{ data: string; mimeType: 'image/jpeg' }>;
  get(
    mode: 'both',
    options?: AXStateOptions,
  ): Promise<{
    state: string;
    screenshot?: { data: string; mimeType: 'image/jpeg' };
  }>;
  write(mode?: 'state', options?: AXStateOptions): Promise<void>;
  write(mode: 'screenshot'): Promise<void>;
  write(mode: 'both', options?: AXStateOptions): Promise<void>;
  snapshot(options?: AXStateOptions): Promise<{
    nodes: { index: number; role: string; name?: string }[];
    truncated: boolean;
  }>;
  click(
    target: number | AXPoint,
    options?: AXClickOptions,
  ): Promise<ActionResult>;
  drag(from: AXPoint, to: AXPoint): Promise<ActionResult>;
  paste(
    elementIndex: number | null,
    text: string,
    options?: AXPasteOptions,
  ): Promise<ActionResult>;
  performSecondaryAction(
    elementIndex: number,
    action: string,
  ): Promise<ActionResult>;
  pressKey(
    elementIndex: number | null,
    key: string,
    options?: AXPressKeyOptions,
  ): Promise<ActionResult>;
  scroll(
    target: number | AXPoint,
    direction: AXDirection,
    pages?: number,
  ): Promise<ActionResult>;
  selectText(
    elementIndex: number,
    text: string,
    options?: AXSelectTextOptions,
  ): Promise<ActionResult>;
  setValue(elementIndex: number, value: string): Promise<ActionResult>;
  typeText(elementIndex: number | null, text: string): Promise<ActionResult>;
}
```

- 旧表中的简写签名（`dom.click(nodeId)`、`cua.click(x, y)`、`cua.key(key)`、`ax.click(index)`）已作废，以上接口为准；`cua.key` 改名 `cua.keypress`，与 Codex 对齐。
- `tab.ax.snapshot()` 是 `get('state')` 的结构化形态（返回节点数组而非字符串）；`get` 返回值给脚本用，`write` 把状态 / 截图展示给模型（返回 void），两者区分。
- `tab.ax.click` 的目标可以是元素索引或视口坐标；`paste` / `pressKey` / `typeText` 的 elementIndex 为 null 时作用于当前焦点。

| 组         | 方法                                                                                            | 说明                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 浏览器组织 | `browser.windows.list() / browser.tabs.move() / browser.tabGroups.* / browser.bookmarks.*`      | 窗口、标签、分组、书签整理；仅限用户要求的整理，带审计轨迹                                        |
| 页面资产   | `tab.assets.list(): Promise<{ url: string; type: string; size?: number }[]>`                    | 资产清单                                                                                          |
| 页面资产   | `tab.assets.download(urls: string[]): Promise<{ files: { url: string; path: string }[] }>`      | 打包下载到本地                                                                                    |
| 导出       | `tab.exportFile(options: { format: 'pdf' \| 'html' \| 'markdown' }): Promise<{ path: string }>` | 导出创建本地文件                                                                                  |
| WebMCP     | `tab.webmcp.listTools(): Promise<{ name: string; description?: string }[]>`                     | 列出页面注册的工具                                                                                |
| WebMCP     | `tab.webmcp.invokeTool(name: string, args: unknown): Promise<unknown>`                          | 调用页面注册的工具                                                                                |
| CDP        | `tab.cdp.send(method: string, params?: unknown): Promise<unknown>`                              | CDP 所有支持的命令经 SDK 暴露，无命令白名单、单 origin 裁剪或敏感命令例外；由浏览器自身决定可用性 |
| CDP        | `tab.cdp.events(cursor?: string): Promise<{ events: unknown[]; nextCursor?: string }>`          | 事件游标分页读取                                                                                  |

- 浏览器组织、页面资产、导出、WebMCP、CDP 在 M5 交付；本节方法名与签名已冻结；实现范围已决定：全部进入首版（M0，2026-11-08），M5 按[对齐表](#与-codex-参考的对照)与[逐成员覆盖矩阵](#与-codex-的逐成员覆盖矩阵)逐项实现。
- CDP 各域命令和事件经 Avru SDK 全量暴露，不设白名单、单 origin 裁剪、按敏感命令的二次确认。日常操作可优先选择语义 SDK；低层 `cdp.send` 不被人为裁剪，事件按游标读取；浏览器调试接口自身不支持的操作返回真实错误。

### 方法契约通用规则

- 所有方法返回 Promise；入参先做结构校验，非法入参报 `INVALID_ARGUMENT`，不发往扩展。
- 方法失败时抛出 `SdkError`（见类型定义），`code` 取自[错误码表](#错误码表)；调用方按 code 分支处理，不得只按 message 文本判断。
- 每个方法调用都是一次桥接调用，受单任务桥接次数上限约束（见[限制数值表](#限制数值表)）。
- 每个 SDK 调用由 daemon 验证任务是否活跃、客户端和设备连接是否可信、目标与连接代次是否匹配、输入是否合法及内部并发状态；不验证敏感业务动作类别，不弹出用户确认，不筛选 CDP 命令名。
- 超时不等于动作没发生；超时后方法报 `TIMEOUT`，调用方须先查页面再决定下一步，不得自动重放。
- 返回值一律 JSON 可序列化；截图返回 base64 JPEG 字符串；大输出按上限截断并置 `truncated: true`。

## 层间协议

本节定义三段连接上的消息格式。传输与帧格式、进程生命周期见[runner.md](runner.md)；连接与配对见[browser-connection.md](browser-connection.md)。

### daemon ↔ runner IPC

- 传输：继承的私有管道，不开端口；子进程不继承环境变量，固定 Node 启动参数，只走 IPC。
- 帧格式：NDJSON，每行一个 JSON 对象，UTF-8 编码，单条消息 ≤64 KiB。
- 信封：每条消息含 `{ v: 1, type, taskId, seq }`；`seq` 为每个方向、每个任务内单调递增的序号，从 1 开始。
- 校验：收到错任务、重复序号、越界序号或超大消息时拒绝该消息并记日志；不自动重放。
- 超时与取消由 daemon 侧独立计时（见[生产桥接](#生产桥接)）。

| 方向            | 消息          | 关键字段                       | 说明                                                                                                          |
| --------------- | ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| daemon → runner | run_task      | taskId、script、target、limits | 启动任务；target 为 { browserId, tabId, generation }；limits 为 { timeoutMs, maxOutputBytes, maxBridgeCalls } |
| daemon → runner | cancel_task   | taskId、reason                 | 取消任务；runner 发出 AbortSignal，见[生产桥接](#生产桥接)                                                    |
| daemon → runner | ping          | —                              | 保活                                                                                                          |
| runner → daemon | bridge_call   | taskId、callId、method、args   | SDK 方法调用请求；method 为 SDK 方法名，args 为 JSON 数组                                                     |
| runner → daemon | task_result   | taskId、state、result?、error? | 任务终态；state 见[执行状态机](#执行状态机)                                                                   |
| runner → daemon | pong          | —                              | 保活响应                                                                                                      |
| daemon → runner | bridge_result | callId、ok、value?、error?     | 对 bridge_call 的回答                                                                                         |

- `bridge_call` 与 `bridge_result` 用 `callId` 一一对应；daemon 按[生产桥接](#生产桥接)的 5 项检查决定放行或拒绝。
- `task_result` 发出后，该任务的后续桥接调用一律拒绝；迟到的 `bridge_result` 不转发。
- 完整字段定义与进程生命周期见[runner.md](runner.md)。

### daemon ↔ extension 动作消息

沿用 WS v1 合同风格（见[browser-connection.md](browser-connection.md)）：所有消息含 `v: 1` 和 `type`；动作消息另含 `requestId` 关联请求与结果。

| 方向          | 消息          | 关键字段                                   | 说明                                              |
| ------------- | ------------- | ------------------------------------------ | ------------------------------------------------- |
| daemon → 扩展 | action        | requestId、tabId、generation、method、args | 执行一个 SDK 方法对应的浏览器动作                 |
| 扩展 → daemon | action_result | requestId、ok、value?、error?              | 动作结果；ok 为 false 时 error 含 code 与 message |
| 扩展 → daemon | tabs          | tabs: id、title、url                       | 标签页清单变化时上报（已有 v1 合同）              |
| 扩展 → daemon | error         | code、message                              | 协议或执行错误（已有 v1 合同）                    |

- `action.method` 与 SDK 方法一一对应（见[SDK 接口契约](#sdk-接口契约)与下表）；`args` 为 JSON 数组。
- 截图与大 DOM 分片传输：单条 WS 消息上限已决定为 1 MiB（见[限制数值表](#限制数值表)）；超出时按 `chunk` 分片，含 `requestId`、`index`、`total`，收齐后重组；任一片丢失或超时则整个动作报 `TIMEOUT`，不按残缺数据继续。
- 断线后的未完成动作按[调度并发与恢复](#调度并发与恢复)处理：区分“未执行”和“结果未知”，不自动重放。

### 扩展 → 浏览器：SDK 方法到扩展实现方式的映射

| SDK 方法                                                 | 扩展实现方式                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| snapshot / ax.snapshot / dom.getVisibleTree              | 内容脚本遍历 DOM / 无障碍树，序列化后返回                                                                                                 |
| click / fill / press / selectOption / scroll（元素引用） | 内容脚本按引用定位元素后操作；定位不到报 STALE_REF                                                                                        |
| locator.*                                                | 内容脚本按选择器查询后操作                                                                                                                |
| cua.*（坐标）                                            | CDP Input.dispatchMouseEvent / dispatchTouchEvent / Input.dispatchKeyEvent；每次鼠标动作前先动虚拟鼠标，见[AI 控制可视化](#ai-控制可视化) |
| navigate / goBack / reload                               | chrome.tabs.update / goBack / reload，或 CDP Page.navigate                                                                                |
| screenshot                                               | CDP Page.captureScreenshot（JPEG）                                                                                                        |
| evaluate                                                 | 内容脚本内只读求值，或 CDP Runtime.evaluate（只读约定）                                                                                   |
| devLogs                                                  | 扩展收集 console / CDP Log.entryAdded                                                                                                     |
| dialogAccept / dialogDismiss                             | CDP Page.handleJavaScriptDialog                                                                                                           |
| contentExport / exportFile                               | 内容脚本提取内容；导出走 chrome.downloads                                                                                                 |
| clipboardReadText / clipboardWriteText                   | 扩展剪贴板 API（浏览器 session 级）                                                                                                       |
| assets.list / assets.download                            | 内容脚本收集资源 URL；下载走 chrome.downloads                                                                                             |
| webmcp.listTools / invokeTool                            | 内容脚本收集页面注册的 WebMCP 工具并调用                                                                                                  |
| cdp.send / cdp.events                                    | 扩展持有的 CDP 会话，CDP 全部能力直通（不设白名单）                                                                                       |
| windows / tabs / tabGroups / bookmarks                   | chrome.windows / chrome.tabs / chrome.tabGroups / chrome.bookmarks                                                                        |

- 扩展只在自身权限范围内使用 CDP 与扩展 API；拒绝不可访问页面和未授权能力；CDP 断开或调试器冲突要显式报告（`CDP_DISCONNECTED`）。
- `cdp.send` 保留 Chrome DevTools Protocol 提供的全部能力；仅做任务、客户端身份、目标连接代次与协议形态校验，不按命令、origin、Cookie/JS 或业务动作类型筛选或逐次确认。

## 生产桥接

SDK 方法调用从脚本出发，经过 runner 的宿主桥接，到达 daemon，再由 daemon 鉴权、路由到扩展。桥接缺省拒绝；只有通过以下检查的调用才会执行。

daemon 对每次桥接调用按顺序检查：

1. **任务仍活跃**：任务未取消、未超时、未进入终态；`bridge_call` 的 taskId 与当前运行任务一致，`callId` 未重复。
2. **授权仍有效**：MCP OAuth grant 仍有效且未撤销；目标浏览器仍处于配对状态；grant 的能力范围包含本次调用。
3. **目标仍有效**：标签页存在；连接代次与认领时一致；认领属于本任务；目标不是受限页面（系统页面、扩展页面、文件 URL 等按能力表拒绝）。
4. **能力在允许范围内**：方法名在 SDK 允许清单内；`cdp.send` 的方法属于 CDP 提供的能力（全量暴露，不设白名单）；当前后端支持该方法（见 `capabilities`）；读操作与写操作按授权范围区分。
5. **无人工业务动作确认**：已认证 AI 直接调用浏览器能力；任务、客户端身份、目标连接代次、参数与并发冲突仍需技术校验，不要求任何敏感动作分级审批。

- 任一检查失败，daemon 返回 `bridge_result`（`ok: false`），`error.code` 为对应错误码（见[错误码表](#错误码表)）；不把失败调用发往扩展。
- 已认证 AI 可通过 SDK/CDP 获取页面 JavaScript 和 Cookie 等浏览器数据；内部 OAuth/设备连接凭据不应暴露为 SDK 结果。审计日志只保存脱敏事件，不记录 Token、Cookie 值、输入文本、页面正文或敏感 URL。
- 取消用 AbortSignal 协作取消：daemon 发 `cancel_task` 后，runner 向任务发出 AbortSignal；在途桥接调用标记取消，daemon 收到取消后不再下发新调用；迟到结果丢弃，不转发给已结束的任务。
- 桥接的进程生命周期、IPC 帧格式与崩溃处理见[runner.md](runner.md)。

### 墙钟：5 秒基础上限与生产 timeoutMs

- runner.md 里独立基础的任务墙钟 5 秒是基础的保守上限，只适用于无副作用的 mock 基础，不适用于真实网页任务。
- 生产任务由 daemon 按任务传入 `timeoutMs`（已决定默认 60 秒、上限 300 秒，见[限制数值表](#限制数值表)）；未传入时沿用 5 秒基础上限；runner 的墙钟按 daemon 传入值执行，5 秒基础上限不作为生产任务的上限。
- 单步 SDK 调用等待随任务 timeoutMs 计入总时长；`waitFor` 的 timeoutMs 不得超过任务剩余时间。脚本中止不保证网页动作未发生。

## 执行状态机

### 任务状态

| 状态      | 含义                                         |
| --------- | -------------------------------------------- |
| queued    | 已提交，等待执行                             |
| running   | 正在执行脚本                                 |
| succeeded | 脚本正常结束，全部步骤有确定结果             |
| failed    | 脚本或执行失败，失败原因有确定错误码         |
| cancelled | 用户或系统取消，后续步骤未执行               |
| unknown   | 任务结束，但至少一个副作用步骤的结果无法确定 |

转移：

- queued → running（daemon 取出任务、启动 runner）
- running → succeeded（脚本正常结束且全部步骤结果确定）
- running → failed（脚本抛错、入参非法、目标失效、授权失效等确定失败）
- running → cancelled（收到取消且无在途副作用调用；或取消时在途调用已确认未执行；或本次任务的目标标签页被关闭，原因 TAB_CLOSED）
- running → unknown（超时或崩溃发生在副作用桥接调用中，无法确定该调用是否已执行）
- queued → cancelled（排队中被取消）
- 终态（succeeded / failed / cancelled / unknown）不可再转移。

### 步骤状态

每个桥接调用（步骤）记录：`pending`（已发出，未回）→ `done`（有确定结果）/ `failed`（有确定错误码）/ `unknown`（发出后失去联系，无法确定是否执行）。

- 超时发生在副作用桥接调用中时，该步骤为 `unknown`，任务终态为 `unknown`。
- 超时发生在纯计算（脚本执行、无在途桥接调用）时，任务终态为 `failed(TIMEOUT)`。
- 取消时在途副作用调用已确认未执行的，任务终态为 `cancelled`；无法确认的，终态为 `unknown`。
- `unknown` 的任务不得自动重放；调用方须先查页面再决定下一步。

## 调度并发与恢复

### 调度与并发

- 首版串行执行：同一时间最多 1 个任务运行，最多 8 个任务排队（沿用 runner.md 的数值）；排队不启动 CPU 时限。
- 每个任务独立运行时与授权范围；不同任务不得共享脚本变量、句柄或认领。
- 同一标签页同时只能被一个任务认领并操作；第二个任务对同一标签页的认领请求返回 `TAB_ALREADY_CLAIMED`。
- daemon 侧须单例管理 Runner 或统一预算（runner.md 的 32 个未 settle 宿主调用上限仅针对单个 Runner）。

### 故障矩阵

| 故障                  | 未完成操作定性                                       | 认领与标签状态                                          | 进程与恢复                                                                           | 是否重跑         |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| runner 崩溃           | 在途副作用调用为结果未知，其余为未执行               | 认领释放                                                | daemon 停止接收该实例的新请求，确认旧进程关闭后为下一任务重建进程                    | 否，不重跑原脚本 |
| 扩展断开              | 在途调用为结果未知（若是副作用调用），只读调用为失败 | 认领释放；标签清单清空，重连后重新查询                  | 扩展按退避重连；重连后重新认证与同步标签                                             | 否               |
| daemon 重启           | 全部未完成操作为结果未知                             | 认领与 grant 全部失效（仅内存保存）                     | runner 子进程随父进程结束；MCP 客户端须重新授权                                      | 否               |
| 浏览器重启            | 在途调用为结果未知                                   | 连接代次递增，旧引用失效；同 profile 重连保留 browserId | 扩展重新配对连接后恢复                                                               | 否               |
| 标签页关闭或导航      | 引用失效，在途调用为结果未知                         | 认领释放（关闭时）；导航后引用失效须重新观察            | 无须重建进程                                                                         | 否               |
| CDP 断开 / 调试器冲突 | 在途调用为结果未知                                   | 认领保留，等待恢复或由调用方决定取消                    | 扩展显式报告 CDP_DISCONNECTED；恢复后重新观察再决定                                  | 否               |
| 超时                  | 副作用调用中超时为结果未知；纯计算超时为失败         | 认领保留到任务终态后释放                                | 超时强制结束执行进程，等关闭后建新进程                                               | 否               |
| 取消                  | 已确认未执行的为未执行，无法确认的为结果未知         | 认领释放                                                | 取消不释放 runner 的未 settle 调用计数；强制结束进程，等关闭后建新进程（与超时一致） | 否               |

原则：任何情况下都不自动重放整个脚本或单个副作用操作；结果未知时先查页面，再由调用方决定下一步。

## 错误码表

统一错误码，各层含义一致；MCP、SDK、桥接、扩展返回同一套码。

| 错误码                 | 含义                                                                               | 主要产生层      |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------- |
| INVALID_ARGUMENT       | 入参结构非法或缺失必填项                                                           | SDK / daemon    |
| INVALID_TARGET         | 目标不存在或已关闭                                                                 | daemon / 扩展   |
| TAB_NOT_CLAIMED        | 历史兼容错误码（旧版人工认领路径）；新任务运行时自动获取内部执行锁，不要求手动认领 | daemon          |
| TAB_ALREADY_CLAIMED    | 目标正被别的任务控制                                                               | daemon          |
| TARGET_GONE            | 目标在操作中消失（标签页关闭、浏览器断开）                                         | daemon / 扩展   |
| STALE_REF              | 元素引用已失效（导航或内容变化后）                                                 | daemon / 扩展   |
| PERMISSION_DENIED      | 授权无效、已撤销或超出授权范围                                                     | daemon          |
| CAPABILITY_NOT_ALLOWED | 调用未知 Avru SDK 方法或当前浏览器原生能力不支持；不表示有 CDP 命令白名单          | daemon          |
| EXECUTION_NOT_FOUND    | 执行不存在或已过期清理                                                             | daemon          |
| QUEUE_FULL             | 执行队列已满                                                                       | daemon          |
| SCRIPT_TOO_LARGE       | 脚本超出大小上限                                                                   | daemon          |
| OUTPUT_TOO_LARGE       | 单次输出超出上限                                                                   | daemon / runner |
| TIMEOUT                | 超时（是否伴随副作用见执行状态机）                                                 | daemon / runner |
| UNKNOWN_RESULT         | 结果无法确定（见 unknown 终态）                                                    | daemon          |
| DAEMON_UNAVAILABLE     | 守护进程连不上                                                                     | MCP 客户端侧    |
| EXTENSION_OFFLINE      | 目标浏览器扩展离线                                                                 | daemon          |
| CDP_DISCONNECTED       | CDP 会话断开或调试器冲突                                                           | 扩展            |
| RUNNER_CRASHED         | 执行进程崩溃                                                                       | daemon          |
| BRIDGE_REJECTED        | 桥接调用被拒绝（缺省拒绝、序号或任务不匹配）                                       | runner / daemon |
| TOPIC_NOT_FOUND        | 请求的 SDK 文档主题不存在                                                          | daemon          |
| TAB_CLOSED             | 任务目标标签页被关闭，任务取消                                                     | daemon          |

- 错误不能一律包装为成功文本；错误响应含 `code` 与 `message`，`message` 不含凭据、Token、Cookie 或完整敏感 URL。
- 同一错误码在不同层含义一致；调用方据码决定重试、重新观察或交还用户。

## 限制数值表

以下为已决定值（M0，用户 2026-11-08 确认按建议值）。沿用 runner.md 已有数值的，不再重复定。

| 项目                         | 已决定值                                               | 来源      |
| ---------------------------- | ------------------------------------------------------ | --------- |
| 脚本源码上限                 | 64 KiB                                                 | runner.md |
| 单次桥接调用 / 输出上限      | 64 KiB                                                 | runner.md |
| 单任务桥接调用次数上限       | 32 次                                                  | runner.md |
| QuickJS 堆上限               | 16 MiB                                                 | runner.md |
| QuickJS 栈上限               | 256 KiB                                                | runner.md |
| 执行队列                     | 最多 8 个等待、1 个运行                                | runner.md |
| 任务 timeoutMs               | 默认 60 秒，上限 300 秒                                | 已决定    |
| 快照默认上限                 | 64 KiB，超出置 truncated: true                         | 已决定    |
| 截图                         | JPEG 质量 80，最长边 ≤1920px                           | 已决定    |
| MCP 执行队列                 | 最多 8 个等待、1 个运行                                | 已决定    |
| WS 单条消息上限              | 1 MiB，超出分片                                        | 已决定    |
| browser_list 默认 limit      | 100                                                    | 已决定    |
| setFiles 单文件 base64 上限  | 64 KiB（受单次桥接上限约束）                           | 已决定    |
| 任务级默认方法超时           | 30 秒（单个方法调用；与任务 timeoutMs 默认 60 秒区分） | 已决定    |
| snapshot 子树 / frame 作用域 | 不改变 64 KiB 上限                                     | 已决定    |

- 5 秒任务墙钟是 runner.md 独立基础的保守上限，生产任务按上表 timeoutMs 执行（见[生产桥接](#生产桥接)）。
- 脚本 64 KiB 上限指源码本身；run_task 信封约 200 字节，满额脚本在提交时以 source limit 拒绝（映射为 SCRIPT_TOO_LARGE）。
- 实现中若真实网页业务证明某值不合理，可在 M1 提出调整、经确认后修改；调整前不得据此承诺性能。

## SDK 能力面

### 分层模型

| 层                 | 对应 Codex 接口                                                 | Avru 的实现位置              | 说明                                                                     |
| ------------------ | --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| 浏览器发现         | Agent.browsers、Browsers                                        | daemon + extension           | 列出、选择已连接的浏览器                                                 |
| 浏览器             | Browser                                                         | daemon                       | browserId、capabilities、tabs、文档、会话命名                            |
| 用户浏览器上下文   | BrowserUser                                                     | daemon + extension           | 发现用户已开标签页、不认领读任意标签页上下文（只读）、显式认领（写操作） |
| 标签页集合         | Tabs                                                            | daemon                       | list / get / new / selected                                              |
| 单个标签页         | Tab                                                             | extension（经 daemon）       | 导航、标题、网址、截图、对话框                                           |
| 语义定位与页面操作 | PlaywrightAPI、PlaywrightLocator                                | SDK（QuickJS 内）+ extension | 定位器、点击、输入、等待                                                 |
| 可见 DOM 操作      | DomCUAAPI                                                       | SDK + extension              | 按节点引用操作可见 DOM                                                   |
| 坐标操作           | CUAAPI                                                          | SDK + extension              | 坐标点击、拖拽、按键、滚动                                               |
| 无障碍树           | AXAPI                                                           | SDK + extension              | 状态快照与差分、按元素索引操作                                           |
| 内容与剪贴板       | ContentAPI、TabClipboardAPI                                     | extension                    | 导出、剪贴板读写（浏览器 session 级）                                    |
| 调试与日志         | TabDevAPI                                                       | extension                    | console 日志                                                             |
| 对话框             | AlertDialog / ConfirmDialog / PromptDialog / BeforeUnloadDialog | extension                    | accept / dismiss                                                         |
| 可选能力           | BrowserCapabilityCollection、TabCapabilityCollection            | daemon（发现）+ 各后端       | 能力发现、按后端显式表达支持情况                                         |

### 首版范围

与 Codex 相同的浏览器控制能力全部进入首版范围，分阶段交付（见[08 阶段](../development/phases/08-browser-sdk-mcp.md)）：148 个成员全部进首版（已定义 60 + 待细化 88），无例外。不把整张表默认纳入首版的旧说法已由 D-15 取代。

| 能力           | AI 用它做什么                                              | 需要共同确定                                                                          |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 浏览器与标签页 | 列出连接、选择目标、查看标签页、显式认领、新建、关闭、切换 | 浏览器和个人资料如何标识；新建/关闭/切换已决定进入首版（见[入口与目标](#入口与目标)） |
| 页面结构       | 读取文本、可操作元素及其引用                               | 内容范围、截断、iframe、失效引用处理                                                  |
| 截图           | 辅助理解布局和视觉内容                                     | 整页、视口、区域及输出大小                                                            |
| 基础操作       | 点击、填入、按键、滚动                                     | 元素引用和坐标操作的边界                                                              |
| 页面导航       | 打开网址、返回、刷新                                       | 支持的协议、受限页面与安全边界                                                        |
| 等待与验证     | 等待元素、导航或状态变化                                   | 条件表达、超时、取消和结果未知                                                        |
| 浏览器组织     | 窗口、标签、分组、书签整理                                 | 仅限用户要求的整理，带审计轨迹                                                        |
| 页面资产       | 资产清单与打包下载                                         | 下载到本地的副作用说明                                                                |
| 导出           | 磁盘文件、格式导出                                         | 导出创建文件，不视为纯内存读取                                                        |
| CDP            | 全量 CDP 各域命令与事件                                    | 不设命令白名单、单 origin 裁剪或敏感动作确认；仍按目标和连接代次准确路由              |

### CDP 能力与浏览器原生限制

- `cdp.send` 支持浏览器允许的全部 CDP 命令，包括页面 JavaScript 与 Cookie；文件访问由浏览器及操作系统原生权限决定，不设置 Avru 命令白名单。
- AI 可以全自动操作账户创建、表单和交易相关网页流程，不加业务审批；网站自身的登录、验证码、支付验证与浏览器权限提示仍可能阻止操作，不承诺绕过这些限制。
- 反爬上报：按 D-15 不实现；本地记日志并告诉用户，不做绕过。

### 能力发现与后端差异

- 统一对象模型不代表每个浏览器或后端支持全部方法；可选能力和不支持的情况需要显式表达。
- 能力通过 `capabilities.list/get` 运行时发现，再读取对应文档；不据类型定义宣称当前浏览器可用。
- 未文档化接口仅记录，不建议依赖为稳定 API。

### 元素引用与失效

- 元素引用应来自新观察；输入和按键作用于当前焦点。
- 导航、内容变化或目标过期后，引用失效，须重新观察或重新检测；不自动沿用旧引用。
- 元素引用绑定 pageVersion：`PageSnapshot` 与 `ActionResult` 携带的 pageVersion 变化后，旧引用失效；pageVersion 与连接代次 `generation` 是两回事，前者是页面版本，后者是连接代次。
- 定位器工厂同步返回定位器，不表示已经操作网页。

## 执行与安全边界

本节只保留原则，完整契约见[层间协议](#层间协议)、[生产桥接](#生产桥接)、[执行状态机](#执行状态机)、[调度并发与恢复](#调度并发与恢复)：

- 复用执行进程，不意味着不同任务共享脚本变量。每个任务使用独立运行时或上下文。
- SDK 调用由守护进程逐次检查授权、浏览器目标和能力范围，不能只在脚本入口检查一次。
- 浏览器编号、任务编号和链路编号用于定位，不作为凭证。
- 超时不等于动作没有发生。取消也不能撤销已经提交的表单或已完成的点击。
- 结果未知时先检查页面，不自动重放整个脚本。
- 独立进程与 WASM 能增加隔离，但不等于完整的操作系统沙箱。插件配对、MCP 授权和任务执行权限是三个不同的问题。

运行器合同见[runner.md](runner.md)，数据与安全见[security.md](security.md)。

## 确认策略

**历史四档摩擦/人工确认策略已被 D-17（2026-11-08）明确取消，不得实施。** 对已完成客户端连接认证的 AI，不按导航、点击、提交、删除、发消息、上传、下载、Cookie/JS、金融交易、敏感信息等动作分类增加人工审批、逐次权限判断、确认弹窗或强制接管。AI 可主动操作同设备当前及后续连接的所有可控标签页，无须用户逐页选择或手动认领；内部自动认领只作为并发冲突锁，不能变成人工门槛。

CDP 全量各域命令与事件均通过 Avru SDK 暴露，不设 CDP 命令白名单、当前 origin 限制或敏感命令例外。初次 MCP 客户端身份认证、受信设备连接、会话撤销和浏览器自身不允许访问的页面等技术边界依然有效，它们不是业务操作确认。

取消人工审批不代表网页、邮件、附件或工具输出可以成为高优先级指令来源；脚本仍应遵守用户目标，敏感数据不写入日志。已发生或结果未知的副作用不能自动重复执行；超时、取消、断线按执行状态机如实报告。

## AI 控制可视化

AI 操作浏览器时可视化仅用于展示执行，不是确认门槛；虚拟鼠标、标签分组与调试条由 Avru SDK/daemon/扩展原生实现，不恢复旧四档审批。

### 虚拟鼠标

- 形态：扩展内容脚本往目标标签页注入一个全屏覆盖层（`position: fixed`、全屏、最高 z-index、`pointer-events: none`、不拦截用户点击、`aria-hidden`、打印时隐藏），在层里画一个 24px 聊天气泡式箭头光标，带蓝色辉光。
- 行为：长距离按贝塞尔曲线走、短距离贴地滑过；移动时光标旋转朝向运动方向；到位后淡入淡出，静止时保持“思考”态；无动画时直接跳变。
- 触发与同步：每次 CUA 鼠标动作（移动、点击、双击、拖拽）前先动虚拟鼠标、再发真实 CDP 事件；状态同步靠消息协议（光标状态下发 + 到达回执，带 moveSequence / sessionId / turnId）；等待到达与否由调用方指定（拖拽不等到达）。
- 实现层：SDK 的 CUA 层决定何时动 → daemon 经 native messaging 下发 → 扩展 background 排序与等回执 → 内容脚本覆盖层真正画出来。
- 容错：虚拟鼠标是 best-effort，失败吞掉、不阻塞真实操作；页面里没有覆盖层时光标直接跳变。
- 默认值（已决定，用户 2026-11-08 确认）：虚拟鼠标常开，样式沿用蓝辉光；是否向用户暴露关闭开关待 M1 决定。

### 标签组

- 形态：Chrome 原生标签组。扩展调 `chrome.tabs.group()` 把任务相关的标签页建组，再调 `chrome.tabGroups.update()` 设颜色与标题；组的描边与色条由 Chrome 原生渲染。
- 标题：组标题 = 会话名。任务开始时 daemon 调 `nameSession`（emoji + 简短任务名）命名，组标题随之设置。
- 颜色：Codex 是 9 色随机。Avru 默认值（已决定，用户 2026-11-08 确认）：固定品牌色，不随机，让用户一眼认出是 Avru 的组。
- 默认组标题（已决定，用户 2026-11-08 确认）：`"Avru"`；任务开始后由 `nameSession` 的任务名覆盖。
- 实现层：扩展 background 的标签组管理器（建组、设标题与颜色、持久化组 ID 与会话标题、组被删时清理）；daemon 在任务开始时调 `nameSession`。

### favicon 角标

- 形态：扩展改写页面 `<link rel=icon>` 的 href，换成一张 32×32 的 SVG（原 favicon + 右下角标记）；原 href 存起，清角标时恢复。
- 两态（Avru）：active——标签页正被任务控制（已认领/受控），原图标变淡 + 一个指针形标记；任务结束——任务完成、结果在该标签页，原图标 + 右下角彩色圆点。Codex 的 deliverable / handoff 两态在 Avru 合并为任务结束态；触发条件是任务结束：daemon 在任务结束时标记结果标签页（markDeliverable 的 Avru 原生映射）并把标签页交还用户（markHandoff 的 Avru 原生映射）。
- 生命周期：导航完成时重发布；任务结束态跨重启保留，直到用户激活该标签页才清除；active 态随认领释放清除。
- 实现层：扩展 background 的角标管理器（读当前 favicon 转 data URL、上限 64 KiB、拼 SVG、发布/重发布/清除）+ 内容脚本改写 link。

### 调试提示条

- 形态：Chrome 原生 infobar。扩展调 `chrome.debugger.attach` 接入调试器后，Chrome 即在窗口顶部显示“<扩展名>已开始调试此浏览器”，附“取消”按钮；文案里的名字是扩展的显示名。
- 取消：点“取消”= detach；扩展监听 `onDetach`，视同用户夺回控制，走中断路径：结束任务（已决定，用户 2026-11-08 确认），对用户只说浏览器操作已停止，不报内部错误词。
- 实现层：扩展 background（attach / detach / onDetach 中断处理）；manifest 须有 `debugger` 权限；页面脚本拿不到调试器（`Target.exposeDevToolsProtocol` 拒绝）。

### 标签页前台切换

- 形态：每次操作前，扩展把被操作的标签页切到前台，用户能看见正在被操作的那个标签页。
- 实现层：扩展 background 的 `followSessionTab`（受开关控制）；daemon 在每次动作前下发。
- 与系统级浏览器唤起的区别：标签页前台切换只在浏览器内切换活动标签页，不涉及把浏览器窗口提到操作系统前台；系统级浏览器唤起（把浏览器窗口摆到用户面前）已决定不做（见本文件 M0 设计冻结一节与[与 Codex 参考的对照](#与-codex-参考的对照)），两者不要混淆。

## 调用链与日志

目标是从一次 MCP 调用，追到脚本、SDK 操作及浏览器扩展响应，在同一个详情视图排查问题。

| 层级     | 需要看到的内容                           |
| -------- | ---------------------------------------- |
| MCP 请求 | 调用了什么工具、授权结果、请求状态       |
| 脚本执行 | 开始与结束时间、执行状态、限制或取消原因 |
| SDK 操作 | 目标浏览器和标签页、动作类型、耗时、结果 |
| 扩展响应 | 是否收到、是否执行、浏览器返回的错误     |

- 关联请求 ID、执行 ID 和各步骤 ID；失败步骤可直接定位对应日志。
- 默认不记录 Token、Cookie、输入文本、网页正文或带敏感参数的完整网址。
- 日志保存（已决定，M0，用户 2026-11-08 确认）：日志存到独立的 SQLite 数据库（与 browsers.sqlite 分开，专用于日志）；最多保留 7 天（超期淘汰）；容量上限 1 GB（超限按时间淘汰最旧的）；脱敏规则不变（默认不记 Token、Cookie、输入文本、页面正文、带敏感参数的完整 URL）；导出方式随 M1 实现（直接读该 SQLite 数据库）。
- 不能把已有的基础调用记录视作完整浏览器动作追踪已经实现。

## 与 Codex 参考的对照

| 类别               | 结论            | 说明                                                                                                                |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| 浏览器发现与选择   | ✅ 相同         | 扩展接管用户自己的 Chrome / Edge / Brave，daemon 列出已连接的浏览器和个人资料                                       |
| 标签页管理与认领   | ✅ 相同         | chrome.tabs 加 daemon 侧认领模型；会话命名放 daemon                                                                 |
| 页面观察           | ✅ 相同         | DOM 快照、语义定位、无障碍树、console 日志、对话框，走 CDP 或扩展内容脚本                                           |
| 页面操作           | ✅ 相同         | 点击、输入、按键、滚动、坐标操作、剪贴板、文件选择、下载，走 CDP 或扩展 API                                         |
| 截图与视口         | ✅ 相同         | CDP 截图 JPEG、视口覆盖；浏览器唤起不实现：任务完成后不主动把浏览器弹到前台，用户自行切换查看                       |
| AI 控制可视化      | ✅ 相同         | 虚拟鼠标、标签组、favicon 角标、调试提示条、标签页前台切换，见[AI 控制可视化](#ai-控制可视化)；系统级浏览器唤起不做 |
| 浏览器组织         | ✅ 相同         | chrome.windows / tabs / tabGroups / bookmarks；审计轨迹由 daemon 记日志                                             |
| CDP 与页面资产     | ⚠️ Avru 原生    | CDP 所有支持的域与事件开放，不限单 origin、无命令白名单；页面资产另由 CDP 与扩展下载能力实现并独立验收              |
| WebMCP 与页面工具  | ✅ 相同         | 内容脚本收集页面注册的工具再调用                                                                                    |
| 导出               | ✅ 相同         | 磁盘文件与格式导出，走扩展下载                                                                                      |
| 登录与认证协助     | ⚠️ 按 Avru 的来 | 不照搬 browserAuth / siwc；见[确认策略](#确认策略)                                                                  |
| 反爬上报           | ❌ 不实现       | 按 D-15 不实现；本地记日志并告诉用户                                                                                |
| 自动执行与安全边界 | ⚠️ Avru 原生    | 不实施 Codex 四档人工确认；保留设备/客户端身份保护、任务互斥、断线与未知副作用处理及脱敏审计                        |
| 诊断与安装检查     | ✅ 大多已有     | 安装器已在做环境检查，可复用现有验证脚本                                                                            |

不适用：Codex 的 iab、mcpapps 后端，siwc 登录，以及其遥测后端。

## 与 Codex 的逐成员覆盖矩阵

对照基准：`docs/26.1103.32239/docs/api.json`（SHA256 `ad0f401b995bb3e590e46d2b95b6306c6f231ba849268bbaec055ebe59daae6d`，2090 行，22 个接口，148 个成员）。本矩阵 148 个成员全部列出，一个不漏；状态计数：已定义 60、待细化 88、不实现 0（2026-11-09 更新 history/content 两项技术合同）；首版范围：148 个成员全部进入首版，无例外；3 个 ChatGPT 回合模型成员按 Avru 原生映射实现（见矩阵）。此处是设计状态，不是代码测试覆盖率或全部交付证明。

- **已定义**：方法与签名已写入[SDK 接口契约](#sdk-接口契约)，实现范围已确认。
- **待细化**：签名已按接口分组展开在[SDK 接口契约](#sdk-接口契约)中；实现范围已决定（全部进首版，M0 2026-11-08），“待细化”指实现细节随阶段展开，不表示做不做待定。
- **不实现**：无（148 个成员全部进首版；原 ChatGPT 回合模型三项已按 Avru 原生映射实现，见矩阵）。

api.json 之外的能力（浏览器组织 windows / tabGroups / bookmarks、页面资产、导出、WebMCP、CDP）不在 148 个成员内，见[高级能力方法](#高级能力方法)。

### Agent（2）

| Codex 成员    | Avru 对应                        | 状态   | 说明                                             |
| ------------- | -------------------------------- | ------ | ------------------------------------------------ |
| browsers      | MCP `browser_list` + daemon 发现 | 已定义 | 浏览器发现与选择；脚本内不选浏览器，见入口与目标 |
| documentation | MCP `browser_sdk_docs`           | 已定义 | SDK 文档查询，见 mcp.md                          |

### Browsers（4）

| Codex 成员     | Avru 对应                                                | 状态   | 说明                                                        |
| -------------- | -------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| get(id)        | MCP `browser_list` 返回元数据 + `browser_claim_tab` 选定 | 已定义 | 脚本内无选浏览器方法；选择发生在 MCP 层                     |
| getDefault()   | daemon `browsers.getDefault()`                           | 待细化 | 默认浏览器选取规则待 M1 细化（候选：首个已连接 / 上次使用） |
| getForUrl(url) | daemon `browsers.getForUrl(url)`                         | 待细化 | 按 URL 匹配浏览器的规则待 M1 细化                           |
| list()         | MCP `browser_list`                                       | 已定义 |                                                             |

### Browser（7）

| Codex 成员        | Avru 对应                            | 状态   | 说明                                                                                                           |
| ----------------- | ------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| browserId         | `BrowserId` / `BrowserTab.browserId` | 已定义 |                                                                                                                |
| capabilities      | `browser.capabilities.list/get`      | 已定义 |                                                                                                                |
| tabs              | `browser.tabs`                       | 已定义 |                                                                                                                |
| user              | `browser.user`                       | 待细化 | 当前用户的浏览器上下文入口；下挂 getTabContext，签名待 M1 展开                                                 |
| documentation()   | MCP `browser_sdk_docs`               | 已定义 |                                                                                                                |
| history(options)  | `browser.history(options)`           | 已定义 | 已认证 AI 可直接查询浏览历史，不逐次请求用户批准；仍限制输出量并脱敏审计，具体已冻结签名与限制见「入口与目标」 |
| nameSession(name) | daemon `browsers.nameSession(name)`  | 待细化 | 会话命名放 daemon；见[AI 控制可视化](#ai-控制可视化)；落盘与展示细节待 M1 细化                                 |

### BrowserUser（3）

| Codex 成员          | Avru 对应                          | 状态   | 说明                                                                                                                                              |
| ------------------- | ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| claimTab(tab)       | MCP `browser_claim_tab`            | 已定义 |                                                                                                                                                   |
| getTabContext(tab?) | `browser.user.getTabContext(tab?)` | 待细化 | 已认证 AI 可读取同设备任意可控标签页的上下文；写操作也不强制预先调用 `claimTab`，执行时自动获取内部锁；直接读页是 SDK 方法，不额外增加 MCP 工具。 |
| openTabs()          | `browser.tabs.list()`（仅元数据）  | 已定义 |                                                                                                                                                   |

### Tabs（5）

| Codex 成员       | Avru 对应                          | 状态   | 说明                                                                                                |
| ---------------- | ---------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| content(options) | `browser.tabs.content(options)`    | 已定义 | Codex 侧 extension / cdp 默认不支持，Avru 用临时后台标签页自实现；M5 已有受限实现，完整首版仍待验收 |
| get(id)          | `browser.tabs.get(tabId)`          | 已定义 |                                                                                                     |
| list()           | `browser.tabs.list()`              | 已定义 |                                                                                                     |
| new()            | `browser.tabs.new(url?, options?)` | 已定义 | 新建自动纳入本次任务目标                                                                            |
| selected()       | `browser.tabs.selected()`          | 待细化 | 查询当前活动标签页，与 select 配对                                                                  |

### Tab（22）

| Codex 成员                   | Avru 对应                                                         | 状态   | 说明                                                                         |
| ---------------------------- | ----------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| ax                           | `tab.ax`                                                          | 已定义 | 方法见 AX 接口；Codex 侧四后端默认不支持，Avru 用 CDP Accessibility 实现     |
| capabilities                 | `tab.capabilities`                                                | 待细化 | 标签页级能力发现；浏览器级已定义，标签页级待 M1 细化                         |
| clipboard                    | `tab.clipboardReadText/WriteText` + `tab.clipboard.read/write`    | 已定义 | 文本读写已定义；多格式读写见 TabClipboardAPI                                 |
| content                      | `tab.contentExport` / `tab.exportFile`                            | 已定义 | 导出见 ContentAPI                                                            |
| cua                          | `tab.cua`                                                         | 已定义 | 方法见 CUA 接口                                                              |
| dev                          | `tab.devLogs`                                                     | 已定义 | 日志读取；选项已对齐 TabDevLogsOptions                                       |
| dom_cua                      | `tab.dom`                                                         | 已定义 | 方法见 DomCUA 接口                                                           |
| id                           | `BrowserTab.tabId`                                                | 已定义 |                                                                              |
| playwright                   | `tab.playwright` / `tab.locator`                                  | 已定义 | 方法见 Playwright / Locator 接口                                             |
| back()                       | `tab.goBack()`                                                    | 已定义 | Avru 用 goBack 命名                                                          |
| close()                      | `browser.tabs.close(tabId)`                                       | 已定义 | 自动关闭，无需逐操作人工确认；结果未知不自动重试                             |
| forward()                    | `tab.forward()`                                                   | 待细化 | 与 goBack 配对                                                               |
| getJsDialog()                | `tab.getJsDialog()`                                               | 待细化 | 快照的 dialog 字段已报告活动对话框；独立查询方法待 M1 补                     |
| goto(url)                    | `tab.navigate(url, options?)`                                     | 已定义 | Avru 用 navigate 命名，另有 waitUntil / timeout                              |
| markDeliverable()            | daemon 在任务结束时标记结果标签页（favicon 角标任务结束态）       | 待细化 | Avru 原生映射：任务完成、结果在该标签页时标出；不是 ChatGPT 的 turn 交付物   |
| markHandoff()                | daemon 在任务结束时标记标签页已交还用户（favicon 角标任务结束态） | 待细化 | Avru 原生映射：任务结束把标签页交还用户时标出；不是 ChatGPT 的 turn 间交接   |
| reload()                     | `tab.reload()`                                                    | 已定义 |                                                                              |
| requestManualHandoff()       | `tab.requestUserTakeover(reason?)`                                | 待细化 | 网站本身需手动验证或用户主动请求接管时的可选入口，不由四档确认策略强制触发   |
| requestUserTakeover(reason?) | `tab.requestUserTakeover(reason?)`                                | 待细化 | 用户主动接管或站点验证无法自动完成时可显式请求；不是普通浏览器操作的审批门槛 |
| screenshot(options)          | `tab.screenshot(options)`                                         | 已定义 |                                                                              |
| title()                      | `tab.title()`                                                     | 待细化 | 快照已返回 title；独立查询方法待 M1 补                                       |
| url()                        | `tab.url()`                                                       | 待细化 | 快照已返回 url；独立查询方法待 M1 补                                         |

### AXAPI（11）

| Codex 成员                                   | Avru 对应                            | 状态   | 说明                                                                       |
| -------------------------------------------- | ------------------------------------ | ------ | -------------------------------------------------------------------------- |
| click(target, options?)                      | `tab.ax.click(target, options?)`     | 待细化 | Avru 已有 click(index)，已按 AXClickOptions 展开坐标与按键选项，见 AX 接口 |
| drag(from, to)                               | `tab.ax.drag(from, to)`              | 待细化 | 见 AX 接口                                                                 |
| get(mode, options?)                          | `tab.ax.get(mode, options?)`         | 待细化 | state / screenshot / both 三形态；Avru 已有 snapshot()（状态结构化形态）   |
| paste(elementIndex, text, options?)          | `tab.ax.paste(...)`                  | 待细化 | 见 AX 接口                                                                 |
| performSecondaryAction(elementIndex, action) | `tab.ax.performSecondaryAction(...)` | 待细化 | 见 AX 接口                                                                 |
| pressKey(elementIndex, key, options?)        | `tab.ax.pressKey(...)`               | 待细化 | 见 AX 接口                                                                 |
| scroll(target, direction, pages?)            | `tab.ax.scroll(...)`                 | 待细化 | 见 AX 接口                                                                 |
| selectText(elementIndex, text, options?)     | `tab.ax.selectText(...)`             | 待细化 | 见 AX 接口                                                                 |
| setValue(elementIndex, value)                | `tab.ax.setValue(...)`               | 待细化 | 见 AX 接口                                                                 |
| typeText(elementIndex, text)                 | `tab.ax.typeText(...)`               | 待细化 | 见 AX 接口                                                                 |
| write(mode, options?)                        | `tab.ax.write(mode, options?)`       | 待细化 | 向模型展示状态 / 截图（返回 void）；与 get（返回值）区分                   |

### ContentAPI（3）

| Codex 成员                | Avru 对应                                          | 状态   | 说明                                           |
| ------------------------- | -------------------------------------------------- | ------ | ---------------------------------------------- |
| export()                  | `tab.exportFile({ format })` / `tab.contentExport` | 已定义 | 默认路径导出；格式由 exportFile 的 format 指定 |
| exportGsuite(type)        | `tab.exportGsuite(type)`                           | 待细化 | Google Workspace 导出；M5 交付                 |
| exportYouTubeTranscript() | `tab.exportYouTubeTranscript()`                    | 待细化 | YouTube 字幕导出；M5 交付                      |

### CUAAPI（8）

| Codex 成员             | Avru 对应                        | 状态   | 说明                                                                         |
| ---------------------- | -------------------------------- | ------ | ---------------------------------------------------------------------------- |
| click(options)         | `tab.cua.click(options)`         | 待细化 | Avru 已有 click(x, y)，已按 ClickOptions 展开 button / keypress，见 CUA 接口 |
| double_click(options)  | `tab.cua.doubleClick(options)`   | 待细化 | 见 CUA 接口                                                                  |
| downloadMedia(options) | `tab.cua.downloadMedia(options)` | 待细化 | 见 CUA 接口                                                                  |
| drag(options)          | `tab.cua.drag(options)`          | 待细化 | Avru 已有 drag(from, to)，已按 DragOptions 展开 keys / path，见 CUA 接口     |
| keypress(options)      | `tab.cua.keypress(options)`      | 待细化 | Avru 曾写作 cua.key，已改名对齐；已按 KeypressOptions 展开 keys / duration   |
| move(options)          | `tab.cua.move(options)`          | 待细化 | 鼠标移动；与 hover（元素悬停）区分                                           |
| scroll(options)        | `tab.cua.scroll(options)`        | 待细化 | Avru 已有 scroll(x, y)，已按 ScrollOptions 展开 keypress / scrollX / scrollY |
| type(options)          | `tab.cua.type(options)`          | 待细化 | 见 CUA 接口                                                                  |

### DomCUAAPI（7）

| Codex 成员             | Avru 对应                        | 状态   | 说明                                                               |
| ---------------------- | -------------------------------- | ------ | ------------------------------------------------------------------ |
| click(options)         | `tab.dom.click(options)`         | 已定义 | Avru 曾写作 click(nodeId)，已改为选项对象，与 DomClickOptions 对齐 |
| double_click(options)  | `tab.dom.doubleClick(options)`   | 待细化 | 见 DomCUA 接口                                                     |
| downloadMedia(options) | `tab.dom.downloadMedia(options)` | 待细化 | 见 DomCUA 接口                                                     |
| get_visible_dom()      | `tab.dom.getVisibleTree()`       | 已定义 | Avru 用 getVisibleTree 命名，返回结构化节点                        |
| keypress(options)      | `tab.dom.keypress(options)`      | 待细化 | 见 DomCUA 接口                                                     |
| scroll(options)        | `tab.dom.scroll(options)`        | 待细化 | 见 DomCUA 接口                                                     |
| type(options)          | `tab.dom.type(options)`          | 待细化 | 不清空直接输入；与 fill（先清空）区分                              |

### PlaywrightAPI（16）

| Codex 成员                             | Avru 对应                                                          | 状态   | 说明                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------- |
| domSnapshot()                          | `tab.playwright.domSnapshot()` / `tab.snapshot()`                  | 已定义 | 字符串 DOM 快照（含 iframe 正文）；结构化快照见 snapshot()                                              |
| elementInfo(options)                   | `tab.playwright.elementInfo(options)`                              | 待细化 | 坐标定位元素元数据；M5 交付                                                                             |
| elementScreenshot(options)             | `tab.playwright.elementScreenshot(options)`                        | 待细化 | 带元素框标注的视口截图；M5 交付                                                                         |
| evaluate(pageFunction, arg?, options?) | `tab.evaluate(expression, args?)` / `tab.playwright.evaluate(...)` | 已定义 | 字符串表达式与 JSON 参数可执行页面 JavaScript，包括有副作用的操作；函数对象和 DOM 节点不跨 QuickJS 桥接 |
| expectNavigation(action, options)      | `tab.waitFor({ kind: 'navigation', ... })`                         | 已定义 | 导航等待；动作 + 断言的组合形态由脚本内顺序调用覆盖                                                     |
| frameLocator(frameSelector)            | `tab.frame(selector)`                                              | 已定义 | Frame 接口见下；嵌套与 getBy* 见 PlaywrightFrameLocator                                                 |
| getByLabel(text, options)              | `tab.playwright.getByLabel(text, options)`                         | 待细化 | 见 Playwright 接口                                                                                      |
| getByPlaceholder(text, options)        | `tab.playwright.getByPlaceholder(text, options)`                   | 待细化 | 见 Playwright 接口                                                                                      |
| getByRole(role, options)               | `tab.playwright.getByRole(role, options)`                          | 待细化 | 见 Playwright 接口                                                                                      |
| getByTestId(testId)                    | `tab.playwright.getByTestId(testId)`                               | 待细化 | 见 Playwright 接口                                                                                      |
| getByText(text, options)               | `tab.playwright.getByText(text, options)`                          | 待细化 | 见 Playwright 接口                                                                                      |
| locator(selector)                      | `tab.locator(selector)`                                            | 已定义 |                                                                                                         |
| waitForEvent(event, options?)          | `tab.playwright.waitForDownload()` / `waitForFileChooser()`        | 已定义 | 先注册等待器再触发的时序模式；下载与文件选择分别见 downloads() / setFiles()                             |
| waitForLoadState(options)              | `tab.playwright.waitForLoadState(options)`                         | 待细化 | 见 Playwright 接口                                                                                      |
| waitForTimeout(timeoutMs)              | `tab.playwright.waitForTimeout(timeoutMs)`                         | 待细化 | 固定等待；调用方应优先用条件等待                                                                        |
| waitForURL(url, options)               | `tab.playwright.waitForURL(url, options)`                          | 待细化 | 见 Playwright 接口                                                                                      |

### PlaywrightFrameLocator（7）

| Codex 成员                      | Avru 对应                               | 状态   | 说明                             |
| ------------------------------- | --------------------------------------- | ------ | -------------------------------- |
| frameLocator(frameSelector)     | `frame.frameLocator(frameSelector)`     | 待细化 | 嵌套 frame；见 FrameLocator 接口 |
| getByLabel(text, options)       | `frame.getByLabel(text, options)`       | 待细化 | 见 FrameLocator 接口             |
| getByPlaceholder(text, options) | `frame.getByPlaceholder(text, options)` | 待细化 | 见 FrameLocator 接口             |
| getByRole(role, options)        | `frame.getByRole(role, options)`        | 待细化 | 见 FrameLocator 接口             |
| getByTestId(testId)             | `frame.getByTestId(testId)`             | 待细化 | 见 FrameLocator 接口             |
| getByText(text, options)        | `frame.getByText(text, options)`        | 待细化 | 见 FrameLocator 接口             |
| locator(selector)               | `frame.locator(selector)`               | 已定义 |                                  |

### PlaywrightLocator（34）

| Codex 成员                                | Avru 对应                                          | 状态   | 说明                                                   |
| ----------------------------------------- | -------------------------------------------------- | ------ | ------------------------------------------------------ |
| all()                                     | `locator.all()`                                    | 待细化 | 见 Locator 接口                                        |
| allTextContents(options)                  | `locator.allTextContents(options)`                 | 待细化 | 见 Locator 接口                                        |
| and(locator)                              | `locator.and(locator)`                             | 待细化 | 同步组合，不触网                                       |
| check(options)                            | `locator.check(options)`                           | 待细化 | 见 Locator 接口                                        |
| click(options)                            | `locator.click(options)`                           | 已定义 | 选项已对齐 LocatorClickOptions；force 不开放           |
| count()                                   | `locator.count()`                                  | 待细化 | 见 Locator 接口                                        |
| dblclick(options)                         | `locator.dblclick(options)`                        | 待细化 | click 的 clickCount=2 覆盖双击语义；独立方法为对齐而补 |
| downloadMedia(options)                    | `locator.downloadMedia(options)`                   | 待细化 | 默认超时 120000，不含权限提示等待                      |
| evaluate(pageFunction, arg?, options?)    | `locator.evaluate(expression, args?, options?)`    | 待细化 | 只读作用域求值；函数形态受桥接限制，只接受字符串表达式 |
| evaluateAll(pageFunction, arg?, options?) | `locator.evaluateAll(expression, args?, options?)` | 待细化 | 见 Locator 接口                                        |
| fill(value, options)                      | `locator.fill(text, options)`                      | 已定义 | 先清空再填入                                           |
| filter(options)                           | `locator.filter(options)`                          | 待细化 | 同步筛选，不触网                                       |
| first()                                   | `locator.first()`                                  | 待细化 | 见 Locator 接口                                        |
| getAttribute(name, options)               | `locator.getAttribute(name, options)`              | 待细化 | 见 Locator 接口                                        |
| getByLabel(text, options)                 | `locator.getByLabel(text, options)`                | 待细化 | 作用域限于本定位器内                                   |
| getByPlaceholder(text, options)           | `locator.getByPlaceholder(text, options)`          | 待细化 | 见 Locator 接口                                        |
| getByRole(role, options)                  | `locator.getByRole(role, options)`                 | 待细化 | 见 Locator 接口                                        |
| getByTestId(testId)                       | `locator.getByTestId(testId)`                      | 待细化 | 见 Locator 接口                                        |
| getByText(text, options)                  | `locator.getByText(text, options)`                 | 待细化 | 见 Locator 接口                                        |
| innerText(options)                        | `locator.innerText(options)`                       | 待细化 | 渲染后可见文本                                         |
| isEnabled()                               | `locator.isEnabled()`                              | 待细化 | 见 Locator 接口                                        |
| isVisible()                               | `locator.isVisible()`                              | 待细化 | 见 Locator 接口                                        |
| last()                                    | `locator.last()`                                   | 待细化 | 见 Locator 接口                                        |
| locator(selector, options)                | `locator.locator(selector, options)`               | 待细化 | 后代定位器                                             |
| nth(index)                                | `locator.nth(index)`                               | 待细化 | 见 Locator 接口                                        |
| or(locator)                               | `locator.or(locator)`                              | 待细化 | 同步组合，不触网                                       |
| press(value, options)                     | `locator.press(key, options)`                      | 已定义 |                                                        |
| pressSequentially(value, options)         | `locator.pressSequentially(text, options)`         | 待细化 | 不清空逐字输入                                         |
| selectOption(value, options)              | `locator.selectOption(values, options)`            | 已定义 | 选项已对齐 SelectOptionInput                           |
| setChecked(checked, options)              | `locator.setChecked(checked, options)`             | 待细化 | 见 Locator 接口                                        |
| textContent(options)                      | `locator.textContent(options)`                     | 待细化 | 原始 textContent，可为 null                            |
| type(value, options)                      | `locator.type(text, options)`                      | 已定义 | 不清空直接输入                                         |
| uncheck(options)                          | `locator.uncheck(options)`                         | 待细化 | 见 Locator 接口                                        |
| waitFor(options)                          | `locator.waitFor(options)`                         | 已定义 | 选项已对齐 LocatorWaitForOptions（state 必填）         |

### PlaywrightDownload（1）

| Codex 成员    | Avru 对应                             | 状态   | 说明                                     |
| ------------- | ------------------------------------- | ------ | ---------------------------------------- |
| path(options) | `tab.saveDownload(downloadId, path?)` | 已定义 | 返回本地保存路径；下载列表见 downloads() |

### PlaywrightFileChooser（2）

| Codex 成员               | Avru 对应                  | 状态   | 说明                                                                                                |
| ------------------------ | -------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| isMultiple()             | `fileChooser.isMultiple()` | 待细化 | 与 setFiles 配对；见 waitForFileChooser 返回的 FileChooser                                          |
| setFiles(files, options) | `tab.setFiles(ref, files)` | 已定义 | Avru 用 base64 文件内容（受 64 KiB 桥接上限约束）；Codex 用浏览器可见的绝对路径，形态不同、能力相同 |

### TabClipboardAPI（4）

| Codex 成员      | Avru 对应                      | 状态   | 说明                                |
| --------------- | ------------------------------ | ------ | ----------------------------------- |
| read()          | `tab.clipboard.read()`         | 待细化 | 多格式剪贴板项（含二进制）；M5 交付 |
| readText()      | `tab.clipboardReadText()`      | 已定义 |                                     |
| write(items)    | `tab.clipboard.write(items)`   | 待细化 | 多格式写入；M5 交付                 |
| writeText(text) | `tab.clipboardWriteText(text)` | 已定义 |                                     |

### TabDevAPI（1）

| Codex 成员    | Avru 对应              | 状态   | 说明                                                                          |
| ------------- | ---------------------- | ------ | ----------------------------------------------------------------------------- |
| logs(options) | `tab.devLogs(options)` | 已定义 | 选项已对齐 TabDevLogsOptions（filter / levels / limit），另有 Avru 扩展 since |

### AlertDialog（2）

| Codex 成员 | Avru 对应                            | 状态   | 说明             |
| ---------- | ------------------------------------ | ------ | ---------------- |
| type       | `PageSnapshot.dialog.type = 'alert'` | 已定义 | 判别字段，非方法 |
| dismiss()  | `tab.dialogDismiss()`                | 已定义 |                  |

### BeforeUnloadDialog（2）

| Codex 成员 | Avru 对应                                   | 状态   | 说明 |
| ---------- | ------------------------------------------- | ------ | ---- |
| type       | `PageSnapshot.dialog.type = 'beforeunload'` | 已定义 |      |
| dismiss()  | `tab.dialogDismiss()`                       | 已定义 |      |

### ConfirmDialog（3）

| Codex 成员 | Avru 对应                              | 状态   | 说明 |
| ---------- | -------------------------------------- | ------ | ---- |
| type       | `PageSnapshot.dialog.type = 'confirm'` | 已定义 |      |
| accept()   | `tab.dialogAccept()`                   | 已定义 |      |
| dismiss()  | `tab.dialogDismiss()`                  | 已定义 |      |

### Documentation（1）

| Codex 成员 | Avru 对应              | 状态   | 说明                            |
| ---------- | ---------------------- | ------ | ------------------------------- |
| get(name)  | MCP `browser_sdk_docs` | 已定义 | 按主题读 SDK 文档；不填返回索引 |

### PromptDialog（3）

| Codex 成员   | Avru 对应                             | 状态   | 说明 |
| ------------ | ------------------------------------- | ------ | ---- |
| type         | `PageSnapshot.dialog.type = 'prompt'` | 已定义 |      |
| accept(text) | `tab.dialogAccept(text)`              | 已定义 |      |
| dismiss()    | `tab.dialogDismiss()`                 | 已定义 |      |

## M0 设计冻结（已冻结，2026-11-08）

M0 原始 8 项决定已记录；2026-11-08 用户再次确认 D-17 后，以下列出截至本轮应遵守的最新设计合同。旧四档确认与强制认领等原结论已经被覆盖，相关实现及跨文档验收仍需单独完成：

1. **操作方式**：页面结构和元素引用为主、截图为辅，照抄 Codex（见[操作方式](#操作方式)）。
2. **限制数值**：按建议值，见[限制数值表](#限制数值表)（任务 timeoutMs 默认 60 秒/上限 300 秒、方法默认超时 30 秒、快照/桥接/输出/脚本 64 KiB、32 桥接/任务、堆 16 MiB/栈 256 KiB、队列 8 等待/1 运行、截图 JPEG 80/最长边 1920px、WS 单条消息 1 MiB、setFiles 64 KiB）。
3. **全自动操作**：D-17 取代四档摩擦，取消业务动作分级、逐次权限确认及强制人工接管；AI 可自动操作同设备全部已连接可控标签页。
4. **CDP**：所有 CDP 命令与事件经 SDK 暴露，不设白名单、不限单 origin、不实施敏感命令确认。高级 SDK 是便捷入口，不裁剪 CDP 原生能力。
5. **直接读页面的 MCP 工具**：不增加额外工具；保持 6 个 MCP 工具。AI 可直接选择目标运行包含只读或写入方法的脚本，不需要先调用人工认领；`browser.tab.snapshot()` 属于 SDK 方法。
6. **日志保存**：存独立 SQLite 数据库（与 browsers.sqlite 分开）、最多保留 7 天、容量上限 1 GB；脱敏规则不变；导出方式随 M1 实现。
7. **浏览器唤起**：不强行将操作系统浏览器窗口切到前台；浏览器内标签切换与自动化可视化按阶段实现，不引入确认弹窗。
8. **BrowserUser**：AI 可自动读取和操作同设备现在及之后接入的全部可控标签页；历史读取不需逐次人工批准，但输出与审计仍应脱敏。

M5 的 22 个接口、148 个成员全部进入首版目标范围，不因人工确认分类而删减。3 个 ChatGPT 回合模型成员按 Avru 原生概念映射（markDeliverable = 结果标签标记，markHandoff = 任务结束交还标签，requestManualHandoff = 可选请求手动接管而非强制审批）。方法是否已交付必须逐一以真实代码与测试证明。

产品默认值（已决定，用户 2026-11-08 确认）：[AI 控制可视化](#ai-控制可视化)的产品默认值——标签组颜色固定品牌色、默认组标题 "Avru"、虚拟鼠标常开（样式沿用蓝辉光）、点调试条“取消”= 结束任务、favicon 角标两态（active / 任务结束）。未决事项：无。

代码实现、测试通过、合并和真实环境验收分别记录，不能用其中一项代替全部完成。

# 浏览器连接与控制分层

本文件拥有 WS、浏览器身份、配对与管理接口合同；实施与测试证据归[连接阶段](../development/phases/01-browser-connection.md)。远程 OAuth 不是本机配对。

## 当前本机信任合同（2026-11-08）

用户确认默认信任同机程序：本机 Web 不要求管理 capability，继续严格校验 literal Host、可选 Origin、跨站 Fetch Metadata；所有写接口要求同源 Origin。仅 `/api/runtime` 与 `/api/shutdown` 保留启动器实例凭据，防止错误实例被安装器操作。远程 OAuth、MCP 和 FRPC 接口的认证不因此取消；不向隧道暴露管理接口。

新插件在加载时发送 `{v:1,type:"local-connect",channel,profileId,name}`，服务器按本环境与扩展来源下的稳定 profileId 登记，直接返回既有 `paired`/`ready` 格式，无待批准请求或短码。内部 token 仅为旧协议兼容与恢复存储，不是新客户端取得本机信任的证明。相同 profile 重连保留 browserId，独立 profile 不相互替换；元数据、标签与 OAuth 同意仍只在 ready 后交换。新插件工具栏图标打开对应端口的 `/#overview`，不设置 default_popup 或 externally_connectable。

旧版已保存凭据的 authenticate 及配对/票据消息暂保留兼容，以下相关协议章节仅说明旧版行为；新 Web 不调用它们。用户通过禁用或移除插件停止连接。同 OS 用户的其他本地程序被信任，可以访问本机管理及模拟连接；普通网页仍受 Origin/Host 限制，dev/prod 端口、扩展 ID、数据库与消息环境继续隔离。

## 多浏览器发现与目标路由

### 已确认的使用体验

连接完成后，AI 一次发现所有已连接浏览器及其标签页，自行判断任务需要操作哪一个。用户不需要先在扩展里选一个标签页才能让 AI 看到它，也不需要逐个浏览器授权后再切换。

“全部可见”指可发现目标集合，不要求在连接时把所有标签页的全文和截图一次发送给 AI。建议先返回目标元数据，再按任务读取页面内容，降低无关数据暴露和结果体积。

### 建议的身份模型

| 对象               | 草案身份与状态                                            | 作用                                               |
| ------------------ | --------------------------------------------------------- | -------------------------------------------------- |
| Device             | deviceId、安装身份、当前运行实例                          | 区分物理目标安装，不能仅用设备名称或 IP            |
| BrowserConnection  | connectionId、浏览器/配置显示名、连接代次、能力、在线状态 | 区分同浏览器多个连接，代次防止重连后旧引用误用     |
| Tab                | connectionId + tabId + 连接代次，页面版本                 | 浏览器 tabId 只在其自身上下文内解释                |
| AuthorizationGrant | 客户端、目标设备、允许范围、状态                          | 将 OAuth 授权绑定到正确设备，具体期限/刷新机制待定 |
| Operation          | requestId、授权身份、目标引用、动作、状态                 | 把执行结果关联回原请求，不以“已转发”冒充成功       |

这些是逻辑字段，不确定数据库、序列化格式或最终公开命名。标签页关闭、浏览器重连、配置切换和页面导航后，要重新判断目标引用是否仍有效。

### 发现结果与执行语义建议

- 发现结果包含浏览器连接、标签页标识、可用标题/URL、活动状态、可执行能力和受限原因。标题与 URL 也可能敏感，只发给已授权客户端。
- 跨浏览器的相同 tabId 不得相互替代。目标失效时返回明确错误，不自动切换到相似标题的页面。
- 读取后的页面引用应绑定页面版本或导航代次。页面已变化时重新观察，避免按过期定位点击。
- 多客户端或多任务同时操作同一标签页时，建议串行处理写操作或返回冲突；不能交错输入导致无法归因的结果。是否支持多客户端并发见 Q-09。
- 用户主动操作、导航和关闭页面都应触发状态更新。不能把上一次截图当成当前页面事实。
- 新连接是否继承既有 grant 由 Q-04 决定；无论采用何种生命周期，都保持 AI 不必人工逐页选目标的已确认体验。

### 已确定的本机 WS 与浏览器控制分层

**D-11：扩展与守护进程采用本机 WebSocket，浏览器控制采用 CDP / 浏览器扩展 API。** Native Messaging 不作为首版并行通道；也不以默认开放 Chrome 远程调试端口替代扩展路线。WS 负责传消息，CDP 负责浏览器控制，两者不是替代关系。具体浏览器矩阵仍见 Q-10，不能从 Chromium 的能力推定 Firefox/Safari 同等支持。

选择原因是多个扩展直接汇入单守护进程，无需为每种浏览器注册 Native Host。代价是 Avru 自己承担配对认证、端口发现、连接恢复与本地网络入口防护。Native Messaging 的扩展 ID 允许列表及无插件监听端口是有价值的备选，但会增加桥接进程、跨平台注册和升级维护；并非能力更弱或绝对更安全。决定依据见 D-11，外部项目只作可行性参考。

以下为落实该选择的安全与协议设计约束，本机连接子集由下文 v1 合同细化，其余动作约束仍待实现验证：

- WS 仅监听显式 loopback 地址，不监听 LAN/公网接口；IPv4/IPv6、端口冲突和服务发现行为需在协议中固定，不能盲连任意同名服务。
- 握手校验预期 Host、获准扩展 Origin、协议版本、安装身份与浏览器配置身份；仅允许整个 `chrome-extension://` 前缀或仅凭 `127.0.0.1` 不足以认证。没有 Origin 的客户端不能自动信任。
- 首次配对须通过可信本机引导建立身份绑定；凭据或密钥由程序管理，不让用户手抄。防伪造服务、挑战重放、旧连接复用以及任意网页自助配对。下文已明确本机首次配对、存储与撤销；远程授权绑定和未来轮换仍是 Q-03 的缺口，不能以“已选 WS”宣称同机授权已完成。
- 扩展配对、MCP OAuth grant 与网站业务操作许可相互独立；扩展连接成功不能批准 OAuth 或自动授权敏感网站操作。本地管理 Web 和授权确认接口仍须独立认证、CSRF 与 DNS rebinding 防护。
- 每个浏览器配置连接具有独立身份和连接代次；新连接不得替换另一个已连接浏览器。路由继续使用本文件目标模型 的复合目标引用。
- 建立连接后协商版本和能力、同步当前标签页，再进入可执行状态。心跳/退避重连、扩展后台休眠恢复、daemon 重启和升级兼容均须定义；具体保活实现与时间阈值待目标浏览器验证。
- 应用消息需有关联请求 ID、类型、目标与结构校验，设置单消息/累计大小、排队数量、超时和背压限制。WS 支持二进制不意味着无限制传输；截图和大 DOM 的编码、分片及数值上限在接口合同中确定。
- 断线后的未完成操作区分“未执行”和“结果未知”；重新认证和刷新目标后才能继续，不自动重放可能产生副作用的操作。
- 扩展在自身权限范围内使用 CDP 和扩展 API；拒绝不可访问页面和未授权能力，CDP 断开/调试器冲突要显式报告。不得把完整 CDP 透传成 AI 的无约束通用能力。

### 扩展工程选型与职责边界

D-13 确定扩展使用 **WXT + TypeScript**，开发包管理继续使用 **pnpm**。WXT 负责扩展工程的开发与构建组织；TypeScript 是扩展源码语言，不是 AI 脚本运行引擎。pnpm 属于维护者的开发工具，不增加终端用户安装 pnpm 的前置条件，用户仍通过 `npx -y avru` 使用安装入口。

此决定不替换 D-11 的本机 WS 通信或 CDP / 扩展 API 控制层，也不把 D-12 的 QuickJS WASM 运行器移进扩展。扩展继续承担连接注册、标签页发现和获准动作执行；daemon 负责鉴权和路由；独立 QuickJS 进程执行受控 SDK 脚本。WXT 不提供 Avru 的配对认证、同机 OAuth 或跨任务隔离证明。

采用框架的工程取舍是统一扩展构建组织，避免自行维护全部工程工具链；代价是需要管理框架及构建依赖、核实生成清单和目标浏览器差异。这是选型理由与后续验证要求，不是已运行 WXT 的结果。当前不引入第二套扩展框架；本地管理 Web 的 React + Vite 另由 D-14 确认，不从 WXT 选择推导。

WXT、TypeScript、pnpm 的初始开发版本、入口布局见 [架构](architecture.md)；现有清单权限见下文连接合同；正式浏览器权限、产品支持和分发矩阵仍待确定。框架能够构建某浏览器包，不代表该浏览器已支持 Avru 所需 CDP / 扩展能力。实现验收需核对可重复依赖安装、类型检查、构建产物及清单权限，并在最终支持矩阵上实测扩展安装、WS 连接/重连、后台生命周期和实际浏览器动作；真实连接测试见[连接阶段](../development/phases/01-browser-connection.md)，网页操作测试仍未实施。

## 已实现的本机连接 v1 合同

### 旧版兼容：信任与配对

- daemon 仅监听 `127.0.0.1:43821`。管理 API 需要本次 daemon 启动生成的随机管理 capability；开发启动链接以 fragment 携带，Web 读取到 sessionStorage 后立即移除 fragment。重启后旧链接失效。该入口不能暴露到隧道。
- 旧版本兼容配对由扩展主动发起待批准请求；服务器绑定当前 WebSocket、扩展 Origin、配置身份与有效期，在扩展和管理页展示同一六位核对码。用户比较后在可信管理页点击批准。不复制、输入或保存配对码。
- 六位码仅供识别当前请求，不是可以兑换凭据的密码。批准只向发起请求的原连接发送随机内部凭据；扩展自动保存。管理 API 不返回长期凭据。
- 浏览器 ID 和连接 ID 只是路由标识，不是凭据。恢复连接必须验证内部凭据及原扩展 Origin。服务端仅保存凭据哈希。撤销配对关闭连接并使后续认证失败。
- 限制 Host、WebSocket Origin、消息尺寸、消息形状和认证等待时间；管理写接口校验同源及 bearer。普通网页不能请求或批准连接。
- 本机同一 OS 用户的恶意程序不属于已隔离对手：它可以读取用户存储或启动进程。扩展 Origin 也不能证明客户端程序本身可信，必须依赖管理端批准。浏览器配对不代替以后 MCP / SDK 的动作授权。

### 消息合同 v1

| 方向               | 消息         | 关键字段                       |
| ------------------ | ------------ | ------------------------------ |
| 扩展→daemon        | pair         | profileId、name                |
| daemon→扩展        | pairing      | requestId、code、expiresAt     |
| daemon→扩展        | paired       | browserId、token、connectionId |
| 扩展→daemon        | authenticate | browserId、token               |
| daemon→扩展        | ready        | browserId、connectionId        |
| 扩展→daemon        | tabs         | tabs: id、title、url           |
| 扩展→daemon / 反向 | ping / pong  | 无附加授权                     |
| daemon→扩展        | error        | code、message                  |

所有消息含 `v: 1` 和 `type`。`paired` 后发送 `ready`；只有 ready 后才同步标签。每个配置可有同名标签 ID，身份必须结合 browserId 和连接代次。替换连接后旧 socket 的关闭/消息不得覆盖新连接。

### 管理接口（访问规则以上文当前合同为准）

管理接口响应不缓存；旧客户端仍可发送已有 bearer，当前访问规则见本文件开头。

- `GET /api/browsers`：连接配置、在线状态、连接代次、标签清单及可空 `metadata`（浏览器名称、版本、版本来源、扩展版本）。离线时元数据清空，不将旧版本冒充实时。
- `GET /api/status`：同样需要本机管理认证，返回 `daemonVersion`、`expectedExtensionVersion` 与 MCP/ChatGPT/FRPC 的 `notImplemented` 状态，不提供公网通道。
- `DELETE /api/browsers/:id`：撤销配置与内部凭据。
- `GET /api/pairings`：尚有效的请求、名称、Origin、核对码、截止时间。
- `POST /api/pairings/:id/approve`：批准当前请求，成功 204。
- `DELETE /api/pairings/:id`：拒绝当前请求，成功 204。

### 数据与恢复

配置身份及内部凭据哈希持久保存到当前 OS 用户的数据目录；标签仅在内存，不写数据库或日志。扩展限制普通 HTTP/HTTPS、排除无痕，去除 URL 查询、fragment 和用户信息。最多 500 标签；标题最多 256 字符、URL 最多 2048 字符。连接断开即清空旧标签，重新连接后重新查询。扩展使用事件、心跳、退避与 alarm 恢复，不重放网页副作用，因为本阶段没有动作接口。

### 可选版本元数据扩展

新版 daemon 的 `ready` 包含 `metadataSupported: true`；新版扩展只在此协商成功后发送 `{v:1,type:"metadata",metadata:{browserName,browserVersion,versionSource,extensionVersion}}`。旧扩展不发送仍可连接，新扩展对旧 daemon 不发送未知消息。元数据仅从已认证当前 socket 接受，与标签同样由连接代次隔离，不持久保存。

`versionSource` 为 `clientHints`、`userAgent` 或 `unknown`。Client Hints 全版本可用时优先，失败退回 UA；UA 版本可能降精度，UI 不承诺完整版本。扩展版本来自自身 manifest。所有名称与版本受类型/长度校验；这只是认证客户端自报，不是浏览器安装证明或代码签名验证。

`release-info.ts` 声明当前发行与预期扩展版本；测试核对 CLI 包身份及 WXT 清单防止常量漂移。当前 `0.1.0-dev.1` daemon 与 `0.0.1` 扩展分别是应用发行和浏览器清单版本，不拿二者直接判插件不一致；插件比较目标为 `expectedExtensionVersion`。

### 旧版兼容：当前浏览器免短码连接

旧版安装引导使用当前浏览器内的 external messaging，而不是从全部在线浏览器猜测本页身份。管理页须先持有本次 daemon 的管理 capability；打开普通地址、知道扩展 ID 或伪造 WS Origin 都不能批准连接。欢迎页只探测；用户进入安装页后，新安装且允许自动连接的扩展才开始以下握手：

1. 页面定向调用当前环境的固定扩展 ID；扩展逐次校验 sender 的 origin、精确根 URL、顶层 frameId、documentId、tab.id 和非隐私上下文，禁止其他扩展调用。扩展只返回实际版本、连接状态与非凭据 browserId，不返回长期凭据。
2. 当前配置扩展经原 WS 发 `auto-probe`，daemon 生成 256 位随机 challenge，绑定原 socket、扩展 Origin、profileId 与 channel，30 秒失效。探测不授予标签读取或 OAuth 权限，也不进入六位码列表。
3. 可信管理页面把 challenge 提交到受 bearer、Host、同源校验保护的 `POST /api/connection-ticket`，得到 256 位随机单次 ticket。同一 challenge 再申请替换旧票据，不延长截止时间。
4. 页面将 ticket 仅交回当前浏览器扩展。扩展核对原 tab/document/challenge 且20秒内有效，再由原 WS 发 `auto-redeem`。daemon 原子消费，只有原连接收到内部随机凭据和 ready；票据不经 URL、日志、存储或远程 MCP 传输。

不同 socket、环境、document、过期、重复兑换均失败；断线/daemon重启清除待定授权。扩展等待挑战8秒超时关闭该连接，管理页面每次进入后只尝试一次，不盲重放未知结果。撤销、拒绝旧凭据或用户断开会在扩展持久写入自动连接禁用标记；刷新页面、扩展重启不会静默重授。用户可通过原插件显式配对流程重新启用；旧版本兼容路径仍保留，不作为默认新安装引导。浏览器没有响应只能说明无法探测，不能区分未安装、禁用、隐私模式或不支持。

manifest 的 `externally_connectable.matches` 限为 `http://127.0.0.1/*`；匹配规则不限定端口，因此运行时继续精确校验当前 channel 固定端口。缺少 sender 字段时拒绝，而非降低校验。该链路与远程 OAuth 分离，不把本机管理接口暴露给 FRPC/ChatGPT。公开 manifest key、ID 和 Origin 不是代码签名；恶意同 OS 用户可读取用户存储或替换 unpacked 代码，不在本方案隔离承诺内。

依据（2026-11-08查阅）：[Chrome match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)、[externally_connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)、[MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender)。固定 [Chromium 142.0.7444.59 parser](https://github.com/chromium/chromium/blob/142.0.7444.59/extensions/common/manifest_handlers/externally_connectable.cc) 接受解析成功的loopback模式；文档与源码证据不代表所有 Chrome/Edge 版本实际验收。真实浏览器结果归连接阶段记录。

### 管理入口 fragment 与真实文档隔离

Chromium 的外部消息 `MessageSender.url` 可能缓存文档初始 URL，
`history.replaceState` 不能保证清除其初始 capability fragment。
Web 导入 capability 到本标签页 sessionStorage 并清除地址 fragment 后，
必须真正 reload；旧文档不挂载 controller，也不发送任何扩展消息。
仅新加载的无 fragment 文档可以开始检测。扩展仍严格检查根 URL、
精确 origin/端口、顶层 frame、documentId、tabId 与非隐私模式，不放宽规则。
Windows Chromium 158.0.8127.18 的诊断已复现该缓存行为，回归测试断言
实际外部消息无 fragment，禁止日志记录完整 sender URL 或 capability。

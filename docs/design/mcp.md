# 远程 MCP 与同机 OAuth

本文件拥有远程接入和授权合同；当前实现范围与验收见[OAuth阶段](../development/phases/04-oauth.md)。本机扩展配对另见[browser-connection.md](browser-connection.md)。

## MCP 能力与接口草案

MCP 是正式对外接口，OAuth 是正式远程授权方式。传输版本、客户端注册方式、服务发现与兼容范围仍需按选定 MCP 规范核对，不能仅凭服务返回 JSON 就宣称兼容 ChatGPT。

MCP 不把每个 SDK 函数都复制成独立工具。用少量 MCP 工具管理脚本执行，让脚本通过 SDK 完成多步操作（SDK 能力面见[浏览器 SDK](browser-sdk.md)）。工具名前缀 `browser_`，与脚本里的 `browser` 入口一致。执行走异步：提交后返回执行 id，再用查询工具取结果。

### browser_list —— 列出已连接的浏览器与标签页

只读，只发现，不取得控制权。入参 `{ limit?: number; cursor?: string; browserId?: BrowserId }`。返回 `{ browsers: [{ browserId, name, type: 'extension' | 'cdp', profileName?, tabs: [{ tabId, title?, url?, claimed }] }], nextCursor?: string, total: number }`，total 为符合过滤条件的浏览器总数。默认 limit 100（已决定，M0，2026-11-08）；cursor 为不透明翻页标记。标题与 URL 敏感、只发给已授权客户端。守护进程连不上时报 `DAEMON_UNAVAILABLE`；没有已连接的浏览器时返回空列表，不算错。

### browser_claim_tab —— 认领标签页

显式取得一个用户标签页的控制权；发现不等于控制。入参 `{ browserId: string（必填）, tabId: string（必填）, title?: string, url?: string }`，title 与 url 是快照校验用的，防止浏览器重启后数字 id 被复用。返回 `{ browserId, tabId, title?, url?, claimedAt }`。错误：`INVALID_TARGET`（标签页不存在或已关闭）、`TAB_ALREADY_CLAIMED`（正被别的任务控制）、`DAEMON_UNAVAILABLE`。认领按任务持有，任务的执行结束或取消时自动释放；编号只是定位用的，不当凭证。

### browser_run_script —— 执行脚本

提交一段受控 JavaScript 到指定目标执行，脚本通过 SDK（`browser` 入口）完成多步操作。入参 `{ browserId: string（必填）, tabId: string（必填）, script: string（必填）, taskName?: string, timeoutMs?: number, limits?: { maxOutputBytes?, maxSteps? } }`。返回 `{ executionId, state: 'queued' | 'running', submittedAt }`。错误：`TAB_NOT_CLAIMED`（没认领就执行）、`SCRIPT_TOO_LARGE`、`QUEUE_FULL`、`INVALID_TARGET`。首版串行执行；每个任务独立运行时，变量不互串；守护进程对每次 SDK 调用都检查授权、目标和能力范围。

### browser_get_execution —— 查询执行

查询一次执行的当前状态和结果。入参 `{ executionId: string（必填） }`。返回 `{ executionId, state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown', startedAt?, endedAt?, result?, error?: { code, message, step? }, steps?: [{ stepId, action, target, durationMs, result }] }`。错误：`EXECUTION_NOT_FOUND`（不存在或已过期清理）。`unknown` 是正式状态，意思是结果没法确定，这时先去页面上查，不自动重放整个脚本。

### browser_cancel_execution —— 取消执行

停止后续执行，报告已经发生的动作。入参 `{ executionId: string（必填） }`。返回 `{ executionId, state: 'cancelled', completedSteps: [...], pendingStepsCancelled: number }`。错误：`EXECUTION_NOT_FOUND`；已经结束的执行直接返回它的最终状态。取消撤不回已经提交的表单和点过的按钮。

### browser_sdk_docs —— SDK 使用说明

提供当前版本的 SDK 能力和示例。入参 `{ topic?: string | string[] }`。不填返回索引，不返回全文；填一个主题返回该文档全文；填多个主题（数组）一次返回多个文档全文。

不填时返回 `{ version, index: [{ topic, title, description }] }`，索引只列主题名、标题与一句话说明，AI 按需再取全文。填了时返回 `{ version, documents: [{ topic, title, content }] }`，按请求顺序返回。请求的任一主题不存在时报 `TOPIC_NOT_FOUND`，并指明是哪个主题。

数字限制（超时、输出大小、步数、排队数）已决定（M0，2026-11-08），见[浏览器 SDK](browser-sdk.md)限制数值表。直接读页面的 MCP 工具首版不列入，简单任务先走“认领 + 执行一段只读脚本”；SDK 说明先用工具，不单独设 Resource。

公开接口应区分协议错误、授权失败、目标离线、标签页不存在、页面已变化、页面不可访问、动作不支持、排队冲突、超时与结果未知。错误不能一律包装为成功文本。

对可能产生副作用的动作，建议输出“未执行”“已执行且已核对”“可能执行但结果未知”等状态。不能在超时后自动重放点击、提交表单或输入操作。只读操作的重试也需重核目标与授权。

本版不提供任意 shell、读写本地文件或不受限制的 JavaScript 执行能力。它们不是 MCP 的默认能力，也不因浏览器扩展已连接而成立。

## 同机 OAuth 授权设计

### 安全目标与明确允许的情况

- 只有经目标电脑上可信本机组件的用户确认，才能建立控制该电脑的 grant。
- 用户无需记、复制、输入 token，必要凭据由软件内部产生、保存和使用。
- 允许远程桌面操作目标电脑。目标是确认路径经过这台电脑，不是证明人坐在现场。
- 仅在其他电脑打开公网授权链接不能完成目标电脑授权；其他电脑安装了 Avru 也不能替代目标身份。
- 仅持有目标电脑名称、IP、公开链接或 FRP 通道不足以授权。

同机确认不能抵御已经控制目标操作系统账号或受信本机组件的攻击者。安装身份的复制、备份恢复及虚拟机克隆也需要在具体方案中处理，不能把一个可复制标识直接宣称为硬件级同机证明。这是本设计的能力边界，不应描述成强人身认证或硬件级可信证明。

### 已确认交互与当前实现边界

用户确认：批准只能由目标电脑上**已配对扩展的自有弹窗**提交，不提供管理 Web 的 OAuth 批准按钮。拿到 URL 不等于批准；远程桌面操作者可以使用这台电脑上的弹窗。无需用户记忆 token，不代表内部协议没有凭据。

现有本机扩展配对继续使用连接阶段的可信管理入口；它不是 OAuth 批准，不在本阶段替换。OAuth 流程开始前必须至少有一个已认证且在线的扩展连接。此实现授予 `browser:read`（读工具：`browser_list`、`browser_get_execution`、`browser_sdk_docs`，开放浏览器元数据与已清洗的普通标签快照）与 `browser:control`（控制工具：`browser_claim_tab`、`browser_run_script`、`browser_cancel_execution`；M1 暂定，需 Emma 确认）。动作、QuickJS、文件访问的开放范围以 grant 的 scope 为准，不因批准而越权开放。

### 组件和协议

- 本机管理与扩展 WS 仍在原 loopback 端口；单独的远程协议服务在另一 loopback 端口监听。反向代理只能转发后者，不能映射原管理服务。
- 远程服务默认关闭。显式配置固定 HTTPS origin `issuer`、独立端口、可信客户端 ID/显示名/精确 HTTPS redirect URI。未配置或配置无效不自动暴露服务。Host 必须匹配配置；忽略代理提供的身份/授权头，不把 loopback 来源当用户批准。
- 发布 RFC 9728 resource metadata 和 RFC 8414 server metadata；资源固定为 `${issuer}/mcp`。采用 authorization-code、PKCE S256、RFC 9207 `iss`；只支持预登记 public client (`none`)，没有用户密码、DCR、CIMD 网络取回或密钥共享。避免任意客户端URL取回产生SSRF；实际 ChatGPT 客户端/回调须以管理页显示值登记，不能凭名称推断。
- 当前 stateless MCP JSON POST 子集协商 `2025-11-25`，提供 initialize、ping、tools/list、tools/call 及通知202；没有 SSE 流、会话恢复或2026协议新功能。授权合同参考2026-07-28最新版，不把它等同于完整新版MCP实现。

### 授权状态机

1. `/oauth/authorize` 验证 client、精确 redirect、state、resource、唯一参数、response_type、scope和PKCE挑战；不合格不重定向。
2. 创建120秒待批请求，绑定随机requestId/nonce、当时已认证连接代次、请求参数及当前daemon实例。只允许一个pending；10秒最小间隔，5分钟最多3次弹窗，避免无限窗口堆积。公开授权入口仍可能被已知client_id滥用造成拒绝服务，限流不保证消除DoS。
3. 将请求发到当时在线的已配对扩展，扩展以 `windows.create({type:'popup'})` 打开自身 `consent.html`。显示请求应用、完整回调、资源和实际读取范围。客户端显示名不证明发起者身份；用户只批准自己刚发起的请求。
4. 唯一批准入口是已认证WS上的 `oauth-decision`，服务重验连接代次、browser配对、requestId、nonce和期限。扩展后台另验证准确runtime sender ID/URL和所创建窗口ID，不信任普通网页或配对页消息。第一个有效同意/拒绝原子结束请求，并关闭其他扩展窗口。重连后的新连接不能代答旧请求。
5. 同意后产生60秒单次授权码；原 `/authorize` HTTP响应返回302到已验证回调，带code、原state和iss。没有Web确认页或批准API。等待期间HTTP连接不返回正文；浏览器关闭或代理超时使请求取消，用户须重新发起，不能自动批准或重放。部署代理超时需超过120秒。
6. token端点重验client、redirect、resource、PKCE后签发600秒opaque access token；服务仅保留哈希和grant，不向日志、页面或浏览器网站传递token。used-code墓碑保留到grant期限，重放拒绝并撤销对应grant。
7. 每个MCP POST重新检查当前grant、期限与批准浏览器仍被配对，随后只提供已登记只读工具。撤销立即阻断新调用；断开临时WS不等于永久撤销，撤销浏览器配对才作废其grant。全部凭据和pending仅内存保存，daemon重启全部失效。

本版不签发refresh token，也不实现持久登录；用户再次连接/令牌到期需重新批准。授权列表和单grant撤销仅在受现有管理能力保护的本地 `/api/grants` 中提供，完整Web授权管理UI尚未实现；现有界面的撤销浏览器配对也会使对应grant失效。

### 安全与故障边界

TLS由获准公网入口终止，FRPC仅转发独立协议端口并保留固定Host；不能仅因issuer写了HTTPS就声称部署已加密。本轮不创建隧道、不修改网络权限、不安装用户扩展。反向代理误映射管理端口仍是配置错误，不能由应用自动纠正。

待确认状态、授权码、token均不跨重启；无token持久化/刷新的便利，换取当前最小密钥持有面。操作系统账号被控制、同用户程序读取扩展存储或调试浏览器不在同机确认的保护范围。当前extension origin并非硬件身份。

HTTP不接受浏览器跨源Origin请求，不提供CORS授权端点或Web批准兜底。弹窗创建失败、连接断开、关窗、拒绝、过期都失败关闭。此子集没有用户密码认证、OIDC身份声明、用户账户注册、任意第三方登录或OAuth token透传。

### 依据与限制（2026-11-07查阅）

- [MCP authorization 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)：资源发现、OAuth、PKCE、资源/issuer绑定；CIMD优先，DCR仅兼容路径。本版选择受控预登记客户端，不宣称所有客户端自动兼容。
- [OpenAI认证说明](https://developers.openai.com/plugins/build/auth)：支持预定义客户端与PKCE，回调须使用当前管理页精确值；iss用于回调混淆防护。真实ChatGPT和公网隧道尚未验收。
- [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows#method-create)：扩展可创建popup类型窗口。本实现不依赖工具栏瞬态popup；浏览器实际运行结果另由CI记录，不能以API存在代替实测。
- [Chrome action.openPopup](https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup)：常规扩展自Chrome127才可调用；118–126限制策略安装扩展，因此未选作唯一弹出机制。
- [RFC9700](https://www.rfc-editor.org/rfc/rfc9700.html)、[RFC7636](https://www.rfc-editor.org/rfc/rfc7636)、[RFC9207](https://www.rfc-editor.org/rfc/rfc9207)：精确回调、PKCE及issuer识别的安全依据；不是对自定义实现的认证或安全保证。

## 本机自动连接合同（2026-11-08 批准实施）

本轮用户只导入 `ConnectionBundleV1` JSON 文件，由 Avru 自动管理 FRPC。文件包含 `schemaVersion:1`、`channel`、`oauth:{issuer,port,clients}` 和 `frp:{serverAddr,serverPort,token,serverCaPem,certificatePem,privateKeyPem}`。最大 256 KiB，字段固定，证书及私钥采用 PEM，不接受任意 FRPC 配置、文件路径、可执行路径或命令。channel 必须匹配构建，OAuth 端口不能占用本机管理或另一环境管理端口；issuer、证书名称和密钥必须匹配。配置只经受管理 capability 和 Host/Origin 保护的本机接口导入，不传到远程 MCP。

`GET /api/connection` 返回脱敏配置摘要、程序版本、连接状态及最近 200 条固定活动事件；`POST /api/connection/import` 校验、原子保存并自动应用；`DELETE /api/connection` 停止连接、撤销授权并清除 Avru 自有连接配置。导入有效配置即启动，重启自动恢复；用户不管理 FRPC 启停。未配置时不启动 FRPC。外部 AVRU_OAUTH_CONFIG 与导入配置冲突时远程入口停用，管理页保持可用并报告冲突。

连接配置、TLS材料和私密运行描述符只保存在各环境私有根；macOS 使用 0700/0600，Windows 限当前用户 ACL。配置切换串行，旧进程未确认停止时不启动第二个实例、不删除现场。FRPC 管理 API 仅监听随机 loopback 端口，使用每实例随机用户名/密码；只代理 OAuth 端口，不代理管理 API。崩溃恢复先用私密描述符证明旧实例归属，再停止或复用其管理状态；不能只凭 PID 杀进程。进程异常确认退出后以 1 秒起、最多 30 秒退避恢复，公网故障由 FRPC 自身重连。

状态为 unconfigured、applying、connecting、registered、unavailable、unknown；registered 只说明 FRPC 管理 API 报告本环境 HTTPS 代理运行。公网可达性和 ChatGPT 联调另记为未验证。固定活动事件持久化到对应 SQLite，不保存配置、token、证书/私钥或原始 FRPC 输出。OAuth 仍为 browser:read / browser:control（M1 暂定，需 Emma 确认）、预登记客户端、PKCE S256 和本机可信扩展确认。

内嵌官方 FRP v0.72.0 的 darwin-amd64、darwin-arm64、windows-amd64、windows-arm64 FRPC。资产在构建准备时下载，校验固定 archive/程序 SHA-256 与可执行文件架构，许可随包；终端用户无需另装或下载。仅支持 Windows/macOS。此次验收只执行替身进程与模拟管理 API；不运行官方 FRPC（包括 --version/verify）、不部署 FRPS、不做公网或真实 ChatGPT 联调。

### 纯预检与自动管理的分工

`apps/daemon/src/transports/frpc-plan.ts` 的 `planFrpc` 继续作为纯配置生成和校验接口，不读写文件、不取密钥、不连接公网，返回 `previewOnly`、`enabled=false`、`verified=false`。本机管理器消费其类型化配置，负责已导入配置的保存与进程生命周期；纯预检不能作为连接成功的证据。

输入必须来自当前环境已验证 OAuth 配置以及部署者明确提供的 FRPS 主机/端口、FRPS CA 文件路径、公开域名证书/私钥路径。默认只支持无显式端口的 HTTPS issuer（公开 443）；其他 TLS 拓扑暂不自动生成。输出 FRP JSON 配置，只映射 OAuth 独立 `127.0.0.1` 端口，拒绝管理端口。`https2http` 在本机客户端终止公开 HTTPS；Host 重写到精确 issuer，不能照抄官方示例的 `127.0.0.1`，否则 Avru 正确拒绝。FRPC→FRPS 开启 TLS 且指定受信 CA/serverName，不仅依赖链路加密。

FRP token 只输出环境变量引用 `AVRU_DEV_FRP_TOKEN` 或 `AVRU_PROD_FRP_TOKEN`，不会把真实 token 放进返回结果；变量由后续获准部署注入。路径/主机拒绝控制字符和 Go 模板标记，避免用户输入被当模板执行。生成器不保证文件存在、证书域名正确、域名归属、FRPS权限、环境变量已配置或服务可用。若手工改为转发管理端口，生成器不能保护被修改的部署。

正式接通还须核验：FRPS 443 路由与 DNS/证书、精确客户端 ID/回调、超过120秒的授权等待链路、插件弹窗允许/拒绝、实际 ChatGPT 工具发现和读取、撤销后401、跨环境拒绝。此预检不增加匿名入口，不把隧道身份当作 OAuth grant。

### Secure MCP Tunnel 尚未就绪的原因

OpenAI 官方 tunnel-client 的 OAuth 行为不能当通用 HTTP 反向代理：它不改写 `authorization_endpoint`，浏览器仍直接访问上游授权服务；只有注册的 `harpoon://` token/revocation 等端点走 shim，普通 HTTPS 端点仍由产品直接访问。Avru 当前 metadata 全部使用 HTTPS issuer，且监听器要求对应 Host，因此不能直接填入 loopback MCP URL 和 tunnel ID 就宣布 OAuth 接通。需要核实 Host、发现/端点路由、浏览器可达授权地址和目标账户实际权限后再落实该适配，不能靠关闭 Host/授权校验解决。

本段依据（2026-11-07查阅）：[FRP 配置格式及模板](https://gofrp.org/en/docs/features/common/configure/)、[FRP HTTPS2HTTP](https://gofrp.org/en/docs/examples/https2http/)、[OpenAI Tunnel onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md)、[官方 Tunnel 说明](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。官方文档证明接口与限制，不证明 Avru 的真实联网结果。FRP 生成格式要求支持 JSON/TOML 的 v0.52.0 或更新版本；实际部署仍须以选定二进制 `frpc verify` 验证，未在本阶段下载运行 frpc。

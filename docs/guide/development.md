# 开发与连接验证

以下命令供开发者从源码构建，不是已发布的 npx 安装流程。前置环境和检查从仓库根目录执行；实例默认私有，不得转发管理入口。

先准备 Node.js 24.22.1 与 pnpm 11.25.0，在仓库根目录运行：

配置文件的证书反例测试使用 OpenSSL CLI 生成临时测试证书；开发验证环境需提供该命令。已发布程序解析证书使用 Node 内建能力，终端用户不需要 OpenSSL 或 Go。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @avru/cli dev --help
pnpm build
pnpm dev:daemon
```

最后一条启动 `127.0.0.1:43822` 本机服务，并在终端给出本次启动的管理链接。打开该链接；请不要分享链接。重启后需重新打开新链接。Ctrl+C 停止。此为开发入口，不安装系统服务、不配置自启动，也不开放 MCP/OAuth。

开发扩展产物位于 `apps/extension/.output/dev/chrome-mv3`。在浏览器扩展管理页手动开启开发者模式并加载该目录；插件随后自动连接本机服务，不需要弹窗、配对或核对码。点击工具栏 Avru 图标可直接打开管理页面；普通 Web 入口先显示欢迎页，用户进入管理页面后可自行选择安装手册。

08 阶段的浏览器 SDK 除了 CDP 与页面操作，还通过扩展提供批量后台读页和浏览历史检索。扩展 manifest 含 `history` 安装级权限，加载或升级时浏览器可能提示这一权限；这不是 AI 逐次动作审批。历史检索只作用于本次所选、已连接的浏览器配置，结果可包含敏感的标题/URL；管理 Web 不因安装权限而自动显示历史全文。真实能力以当前 SDK 的 `browser.capabilities.list()` 及 MCP `browser_sdk_docs` 为准。

管理页显示普通 HTTP/HTTPS 标签的标题和去掉查询参数/片段的地址；不采集无痕、浏览器系统或文件页面，不读取页面正文。关闭浏览器后显示离线，重新打开后自动恢复；需要停止连接时，在浏览器中禁用或移除插件。

daemon 默认使用当前 OS 用户的数据目录保存连接身份与兼容凭据哈希（不保存标签）。可用 `AVRU_DATA_DIR` 指定专用开发目录；不要指向含其他应用数据的目录。`AVRU_PORT` 可调整 daemon 的开发测试端口；扩展固定连接本环境默认端口，不能自动连接自定义端口。`pnpm dev:web` 只用于界面开发；管理写操作须使用 daemon 同源托管页面，而不是 Vite 的独立端口。

端到端开发检查需要浏览器：正常开发环境先 `pnpm exec playwright install chromium`，再 `pnpm test:e2e`。也可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定现有测试 Chromium；此选项不改变产品接入用户浏览器的方案。实际端到端执行证据见本机连接记录；测试配置存在不等于通过。

如果本机已有 Avru Dev 实例使用 `127.0.0.1:43822`，不要停止/覆盖它来跑 E2E：先确认 `43821` 未被其他 Avru 正式实例使用，再构建用于隔离测试的私有 prod 候选件（`pnpm package:prod`），执行 `AVRU_E2E_CHANNEL=prod pnpm test:e2e`。此流程使用测试临时数据和隔离 Chromium 配置，不是发布 npm、安装正式版或对现有浏览器进行自动操作。

## 构建安装包

先运行 `pnpm prepare:frpc` 从官方固定版本下载并静态核对四平台程序，再运行 `pnpm package:cli` 生成 `artifacts/avru`。打包本身只读取已准备资产，不隐式下载或执行 FRPC。`pnpm test:installer` 验证真实 bundle 的安装/修复/缓存删除/卸载。`pnpm package:prod` 生成仅用于本机隔离验收的 private `artifacts/avru-prod`，编译身份为 0.1.0。不要使用源码目录作为登录自启动位置。

当前五项交付状态见[06 阶段](../development/phases/06-local-connection-delivery.md)。连接文件导入方式见[连接指南](connection.md)。本轮测试执行替身进程和模拟管理 API，不执行内嵌的官方 FRPC。

详细安装影响、命令和恢复见[安装指南](installation.md)。门禁阈值见[质量指南](quality.md)。

默认数据位置、dev/prod身份、旧版迁移限制见[环境合同](../design/environments.md)。源码开发默认dev，不能以AVRU_CHANNEL伪装正式包。扩展可分别以AVRU_BUILD_CHANNEL=dev/prod构建，实际加载时必须匹配相应daemon。

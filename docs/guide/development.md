# 开发与连接验证

以下命令供开发者从源码构建，不是已发布的 npx 安装流程。前置环境和检查从仓库根目录执行；实例默认私有，不得转发管理入口。

先准备 Node.js 24.22.1 与 pnpm 11.25.0，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @avru/cli dev --help
pnpm build
pnpm dev:daemon
```

最后一条启动 `127.0.0.1:43821` 本机服务，并在终端给出本次启动的管理链接。打开该链接；请不要分享链接。重启后需重新打开新链接。Ctrl+C 停止。此为开发入口，不安装系统服务、不配置自启动，也不开放 MCP/OAuth。

开发扩展产物位于 `apps/extension/.output/chrome-mv3`。在受支持的 Chromium 测试浏览器扩展管理页启用开发者模式并加载该目录，然后打开 Avru 扩展弹窗，输入配置名称并点击“配对”。比较弹窗与管理页的六位核对码，在管理页批准。无需复制或填写内部凭据。其他浏览器配置重复该步骤。

管理页显示普通 HTTP/HTTPS 标签的标题和去掉查询参数/片段的地址；不采集无痕、浏览器系统或文件页面，不读取页面正文。关闭浏览器后显示离线，重新打开会使用内部凭据恢复连接。需要停止访问时，在管理页撤销该浏览器配对。扩展弹窗“断开并清除本地凭据”只清除扩展端，服务端登记需在管理页撤销。

daemon 默认使用当前 OS 用户的数据目录保存配对身份与凭据哈希（不保存标签）。可用 `AVRU_DATA_DIR` 指定专用开发目录；不要指向含其他应用数据的目录。`AVRU_PORT` 可调整开发端口，扩展弹窗需使用相同端口。`pnpm dev:web` 只用于界面开发；完整配对须使用 daemon 同源托管页面，而不是 Vite 的独立端口。

端到端开发检查需要浏览器：正常开发环境先 `pnpm exec playwright install chromium`，再 `pnpm test:e2e`。也可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定现有测试 Chromium；此选项不改变产品接入用户浏览器的方案。实际端到端执行证据见本机连接记录；测试配置存在不等于通过。

## 构建安装包

运行 `pnpm package:cli` 生成 `artifacts/avru`，`pnpm test:installer` 验证真实 daemon bundle 的安装/修复/缓存删除/卸载。正式 npm 包尚未发布。不要使用开发源码目录作为登录自启动位置。

详细安装影响、命令和恢复见[安装指南](installation.md)。门禁阈值见[质量指南](quality.md)。

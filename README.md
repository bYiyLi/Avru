# Avru

Avru 是一个独立的浏览器控制项目：让 ChatGPT 等 AI 通过 MCP，操作用户电脑上已经打开的浏览器与标签页。

## 当前状态

本仓库已实现第一阶段本机连接：Fastify daemon 托管管理 Web，Chromium MV3 扩展经管理页批准配对，同步多个浏览器配置的普通网页标签并在断线后恢复。实现与验证范围见[本机连接记录](docs/development/phases/01-browser-connection.md)。Clack 安装/修复/卸载与登录启动实现见[安装阶段](docs/development/phases/02-installer.md)，实际跨平台验收状态单独记录。网页操作与 QuickJS 生产接线尚未实现；独立执行基础见[运行器阶段](docs/development/phases/07-runner-foundation.md)，已有 MCP/OAuth 只读切片见[授权阶段](docs/development/phases/04-oauth.md)；未发布 npm 包或浏览器扩展，不代表完整产品验收。

项目名称已确定为 **Avru**。仓库名不代表 npm 包名、域名或商标已取得。

## 已确认的方向

- 扩展工程使用 WXT + TypeScript，开发包管理使用 pnpm；用户仍使用 npx 入口，无需安装 pnpm。开发依赖已固定并提交锁文件；当前验证范围见开发计划。
- 自定义浏览器扩展通过本机 WebSocket 连接守护进程，使用 CDP / 浏览器扩展 API 控制网页；不默认开放远程调试端口。
- AI 通过受控浏览器 SDK 脚本请求操作；QuickJS 运行于单个独立、可复用进程，实际权限和目标校验由守护进程负责。
- 多个已连接浏览器共用一个本机守护进程。
- AI 可以看到所有已连接浏览器的标签页，并按任务自行选择目标，不要求用户先手动选择浏览器或标签页。
- 对外通过 MCP 提供能力，使用 MCP OAuth；FRPC/FRPS 提供内网穿透链路。
- 授权确认必须在目标守护进程所在电脑完成，允许通过远程桌面操作这台电脑。
- 用户不需要记、复制或填写 token；必要的内部凭据由系统管理。
- 用户自备 Node.js/npm，以 `npx -y avru` 为入口，支持 Windows 和 macOS。首次运行安装 Avru、配置用户登录后自启动、启动守护进程并打开本地管理 Web。
- 再次运行同一命令检查并更新 Avru、保留已有设置，确保守护进程启动并打开本地管理 Web。
- 使用 `npx -y avru uninstall` 停止守护进程、移除自启动和程序文件；配置与数据由用户在卸载时选择保留或删除。
- 浏览器选择、扩展安装引导、连接配置与运行状态由守护进程提供的本地 Web 承担；扩展安装仍需用户在浏览器中确认，不静默安装。

## 文档导航

| 入口                                   | 职责                           |
| -------------------------------------- | ------------------------------ |
| [产品需求](docs/requirements.md)       | 产品承诺、来源与验收标准       |
| [设计索引](docs/design.md)             | 按主题定位唯一技术合同及决定   |
| [开发计划](docs/development/README.md) | 阶段范围、实际证据与未完成项   |
| [开发指南](docs/guide/development.md)  | 从源码构建、启动与连接验证     |
| [安装指南](docs/guide/installation.md) | CLI 行为、安装影响、卸载与恢复 |
| [质量指南](docs/guide/quality.md)      | 门禁阈值、命令与依赖风险       |

## 开发入口

使用仓库固定的 Node.js 24.22.1 / pnpm 11.25.0，在根目录执行 `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm build`，再按[开发指南](docs/guide/development.md)启动本机 daemon 并加载测试扩展。终端管理链接是私密能力，不可分享或暴露到隧道。

Avru 独立于 Giunto/Kivo；不自动继承其平台能力。已实现代码和 CI 不等于 npm 发布或用户机器安装。目录职责见[架构](docs/design/architecture.md)，开发协作规则见[AGENTS](AGENTS.md)。

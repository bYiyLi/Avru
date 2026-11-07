# Avru

Avru 是一个独立的浏览器控制项目：让 ChatGPT 等 AI 通过 MCP，操作用户电脑上已经打开的浏览器与标签页。

## 当前状态

本仓库已建立开发骨架：CLI 帮助入口、Fastify 健康检查、React 管理界面占位页和 WXT 无权限扩展可构建。浏览器连接、MCP/OAuth、QuickJS 执行器、安装升级和自启动尚未实现；未发布 npm 包或浏览器扩展，也没有完成产品与跨平台运行验收。

项目名称已确定为 **Avru**。仓库名不代表 npm 包名、域名或商标已取得。

## 已确认的方向

- 扩展工程使用 WXT + TypeScript，开发包管理使用 pnpm；用户仍使用 npx 入口，无需安装 pnpm。开发依赖已固定并提交锁文件；当前验证范围见初始化记录。
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

| 文档                                                   | 内容                                               |
| ------------------------------------------------------ | -------------------------------------------------- |
| [产品需求](docs/requirements.md)                       | 已确认需求、来源及可观察的验收标准                 |
| [技术设计](docs/design.md)                             | 系统边界、逻辑架构、连接与授权流程、安全与故障设计 |
| [初始化范围与验证](docs/development/initialization.md) | 工程目录、开发命令、已验证范围与阻塞               |
| [决定与开放问题](docs/decisions.md)                    | 已确认决定、重要待定项及实现前的阻塞条件           |

需求文档拥有产品承诺，设计文档拥有技术方案，决定清单记录确认程度。设计建议不能自动升级为已批准需求，验收标准也不表示测试已经通过。

## 与其他项目的关系

Avru 独立设计和维护。Kivo 等项目可以作为参考，不默认继承其代码、脚本保存、重复执行或工作流平台能力。本次初始化不包含完整产品实现、发布、部署或改动其他仓库。

以上命令是已确认的目标接口，当前尚未发布可用 npm 包，也未验证命令执行。待包名可用性、发行方式和实现通过验证后，再补充实际可用的快速开始。

## 开发入口（不是终端用户安装流程）

先准备 Node.js 24.22.1 与 pnpm 11.25.0，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @avru/cli dev --help
pnpm dev:daemon
```

最后一条仅启动随机 loopback 端口上的 `/health` 开发服务，并打印 URL；Ctrl+C 停止。不安装服务、不创建数据库或配置自启动，也不开放 MCP、OAuth、配对或浏览器控制接口。

`pnpm dev:web` 启动独立的本地开发页面。正式版由 daemon 托管 Web 的流程尚未实现。`pnpm --filter @avru/extension build` 生成 `.output/chrome-mv3`，目前只有无权限提示页，不能控制浏览器。

端到端开发检查需要浏览器：正常开发环境先 `pnpm exec playwright install chromium`，再 `pnpm test:e2e`。也可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定现有测试 Chromium；此选项不改变产品接入用户浏览器的方案。当前云端浏览器启动受限，详见初始化记录，不将测试配置视作通过。

```text
apps/cli         npx 生命周期入口（当前仅帮助/版本）
apps/daemon      可信服务与路由中心（当前仅健康检查）
apps/web         React 管理界面
apps/extension   WXT 浏览器扩展
packages/runner  独立 QuickJS WASM 进程边界，待实现
packages/protocol 跨组件消息合同边界，待实现
tests/e2e        跨组件/UI 验收
```

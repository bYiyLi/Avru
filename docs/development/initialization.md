# Avru 工程初始化

## 范围与完成条件

本次只建立可继续开发的目录、依赖、最小入口和检查，不实现完整浏览器控制产品，不发布 npm/扩展，不安装自启动或接入用户浏览器。输入是 requirements、design §2.4 和 D-11 至 D-14；保留此前未定的安全、IPC、数据库和浏览器矩阵问题。

验收条件：依赖可按锁文件安装；CLI/daemon/Web/扩展可类型检查和构建；CLI 不把未实现的安装/卸载当成功；daemon 不开放未完成控制接口；目录责任和命令能在仓库找到。UI 端到端测试与跨平台 CI 必须分别给出真实结果，不用构建成功替代。当前未满足的检查保留为阻塞，不改成“通过”。

## 目录及开发基线

应用入口放在 `apps/cli`、`apps/daemon`、`apps/web`、`apps/extension`；共享合同和独立执行器边界放在 `packages/protocol`、`packages/runner`。后两个尚未实现，不是可运行 workspace 包。没有为了凑目录增加数据库层、通用 core 或插件平台。

Node 24.22.1 / pnpm 11.25.0 为本轮开发基线；TypeScript 5.9.3；WXT 0.21.5；Fastify 5.12.8；ws 8.22.1；MCP SDK 1.32.2；React 19.3.1 / Vite 8.3.6；Vitest 5.1.0 / Playwright 1.65.0。直接依赖固定版本，间接依赖见 `pnpm-lock.yaml`，这些不是未来产品支持版本的承诺。

SQLite 已选但 schema/驱动/迁移未实现；QuickJS WASM 已选但具体包和 IPC 未冻结，因此不加入不必要依赖。MCP SDK 与 ws 已声明，但没有伪造可用的接入端点。

所有 workspace 包暂为 private，避免误发布。扩展 Manifest 版本为 0.0.1（Chrome 不接受全零版本），不表示产品发行；它不请求 debugger、站点或连接权限。

## 开发命令与验证方法

命令均从仓库根目录运行。`pnpm install --frozen-lockfile` 安装后，用 `pnpm check` 完成基础门禁和构建；当前完整顺序见 [工程质量门禁](quality.md)。单独命令见根 package.json 和 README。`pnpm format` 是修复格式，不是检查。

`pnpm --filter @avru/cli dev --help` 只显示开发帮助。缺省、安装/卸载和未知参数返回非零，不改变宿主系统。`pnpm dev:daemon` 只监听 127.0.0.1 随机端口的 health 服务，Ctrl+C 关闭。`pnpm dev:web` 是独立开发服务器，不是正式 daemon 托管管理页面。

`pnpm test:e2e` 需要 Playwright Chromium；可先运行 `pnpm exec playwright install chromium`。现有测试 Chromium 可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定。测试创建临时 profile，不能使用用户日常 profile；测试浏览器与产品扩展控制是两个不同用途。

## 初始骨架证据与状态（门禁增量前）

检查针对本次工程文件、固定依赖与锁文件，在云端 Linux（Node 24.22.1 / pnpm 11.25.0）执行；不是 Windows/macOS 实机验收。

| 检查               | 结果与范围                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 锁文件安装         | 通过；首轮 pnpm 11 拒绝 esbuild 未批准构建，改成明确 `allowBuilds.esbuild: true` 后 frozen install 与 esbuild rebuild 通过；没有放开全部依赖脚本 |
| 类型检查           | 通过，四个已实现应用包及根目录测试/工具配置                                                                                                      |
| Vitest             | 通过，2 文件、9 用例，覆盖 CLI 不支持动作失败关闭及 daemon health/未开放端点                                                                     |
| 构建               | 通过，CLI/daemon JS、React Web 和 WXT Chrome MV3 骨架                                                                                            |
| 扩展清单检查       | 已核对无浏览器权限，修复原 0.0.0 全零版本；尚未在 Chrome/Edge 安装                                                                               |
| CLI 运行           | `--help` 输出帮助；`uninstall` 返回 1 并声明无系统变更                                                                                           |
| Playwright UI      | 阻塞：Chromium 启动时报 `socket() failed: Operation not permitted`，并出现 crashpad 本地目录错误；页面断言没有执行，未绕过宿主限制               |
| 格式及最终文件检查 | 通过，最终 `pnpm check` 包含 Prettier 检查；发布前核对版本、链接与生成文件排除                                                                   |
| CI                 | 配置 Ubuntu/Windows/macOS 的同一 `pnpm check`，Linux 另执行 Playwright；配置存在不等于运行通过，实际提交的状态单独回执                           |

已做独立源码/配置审查，修复扩展全零 Manifest 版本；没有将 UI 占位、依赖声明或目录存在记为产品功能。后续已获准的覆盖率、文件长度等门禁及增量验证见 [工程质量门禁](quality.md)，不将下述初始证据冒充最新测试结果。

## 下一步与真实阻塞

1. 在可启动测试 Chromium 的正常环境跑完 UI E2E，核验提交对应的 CI；当前工程验收保留部分完成状态。
2. 完成同机 OAuth、首次配对和 OS 用户隔离合同后，才能实现对外 MCP 和扩展控制入口。
3. 固定最小动作与权限、WS 消息及 runner IPC、QuickJS 包/资源限制，然后建立真实浏览器到 daemon 的完整链路测试。
4. 安装升级、用户登录自启动、数据库迁移、扩展分发与 npm 发布均未实现。不得用本轮基础检查替代这些产品验收。

## 第一阶段连接增量

本机配对与多配置标签同步现在按 [本机连接合同](browser-connection.md) 实施。前述“无权限扩展/仅健康检查”是历史骨架证据，不再描述本次源码；原 CI Ubuntu 项亦为历史，当前工作流仅 Windows/macOS。配对身份存储由 daemon 创建，标签仍仅在内存。开发者使用 `pnpm build` 后 `pnpm dev:daemon`，按 README 打开本次管理链接及加载扩展。

本次真实 Chromium 云端启动仍在测试逻辑前受到 `socket() failed: Operation not permitted` 限制，未绕过。Windows/macOS 的实际 CI 结果须独立核验；本机连接不等同于远程授权、网页操作或安装能力完成。

# 工程基础阶段

## 目标与验收

本次只建立可继续开发的目录、依赖、最小入口和检查，不实现完整浏览器控制产品，不发布 npm/扩展，不安装自启动或接入用户浏览器。输入是 requirements、design §2.4 和 D-11 至 D-14；保留此前未定的安全、IPC、数据库和浏览器矩阵问题。

验收条件：依赖可按锁文件安装；CLI/daemon/Web/扩展可类型检查和构建；CLI 不把未实现的安装/卸载当成功；daemon 不开放未完成控制接口；目录责任和命令能在仓库找到。UI 端到端测试与跨平台 CI 必须分别给出真实结果，不用构建成功替代。当前未满足的检查保留为阻塞，不改成“通过”。

现行结构见[架构](../../design/architecture.md)，命令见[开发指南](../../guide/development.md)，质量合同见[质量指南](../../guide/quality.md)。本阶段旧骨架证据不是当前产品状态；连接与安装有各自阶段。

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

已做独立源码/配置审查，修复扩展全零 Manifest 版本；没有将 UI 占位、依赖声明或目录存在记为产品功能。后续已获准的覆盖率、文件长度等门禁及增量验证见 [工程质量门禁](../../guide/quality.md)，不将下述初始证据冒充最新测试结果。

## 门禁增量验收与限制

2026-11-07 云端 Linux、Node 24.22.1/pnpm 11.25.0：正向 check 通过，12 个单测；当前统计的 command.ts、app.ts、App.tsx 三个生产模块四项均 100%。这是骨架模块覆盖，不是整个产品已完成。Web 测试为 React SSR 单测，不能代替真实浏览器。7 类门禁负向测试全部通过。frozen install 通过。门禁提交 9a05058339cf87d505fc13d76fabc3811951d58f 对应 [Actions run 42376841343](https://github.com/bYiyLi/Avru/actions/runs/42376841343) 已完成成功：Windows/macOS 的 check、7 类负向门禁、Chromium E2E 均成功，独立 audit 成功。这是现有骨架/UI 验收，不是完整产品验收。

audit 无 high/critical，存在 minimatch 10.2.6 的 moderate 公告 GHSA-g3hv-75wg-m249（globparts amplification DoS）；其修复版本 ≥11.0.1，属于开发工具传递依赖。没有为清零报告强制覆盖不兼容大版本，后续升级直接上游并重跑门禁。

当前云端 Chromium 启动被宿主限制，本地 Playwright 页面断言尚未执行。初始 commit 4424788 的 GitHub Ubuntu E2E 已成功，macOS 基础 check 成功；Windows 因全文件 Prettier 格式失败，已增加 .gitattributes 固定 LF 行尾，新 CI 已验证修复。Windows/macOS 产品实机、自启动、浏览器控制、安全授权、QuickJS 限制均未验收。门禁只防回归，不代替这些产品测试。

## 状态与后续

初始云端 E2E 阻塞后由精确提交的 Windows/macOS CI 补证，基础门禁子集完成；初始 Ubuntu workflow 已移除，不是当前支持目标。产品远程授权、动作、runner 与发行不在本阶段完成声明内。后续连接和安装的较新证据见开发总览。

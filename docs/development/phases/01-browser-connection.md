# 本机浏览器连接阶段

## 目标、输入与范围

本阶段实现 daemon、本机管理 Web、Chromium MV3 扩展之间的连接闭环。只发现普通 HTTP/HTTPS 标签页，不执行页面操作，不启用 debugger、远程 MCP、OAuth、FRP 或 QuickJS。不包含发布、用户安装、自启动或卸载实现。

输入为 R-02/R-03/R-04/R-10/R-15/R-17；技术合同见[浏览器连接设计](../../design/browser-connection.md)。本阶段以真实双配置、进程重启恢复与既有门禁共同验收，不以配对单测代替。

## 实施与验收计划

1. 独立测试协议验证、认证、过期/撤销、SQLite 恢复、代次隔离与敏感字段过滤。
2. 扩展测试配对等待、凭据保存、重连、快照事件及取消；管理页测试 capability 生命周期、待批准请求、错误状态与渲染。
3. 真实 Chromium 持久配置加载构建扩展，验证两配置共享 daemon、配对批准、标签变化和重连。Windows/macOS CI 分别运行，不能用构建通过代替浏览器实测。
4. 全量执行既有工程门禁；如某环境无法启动监听或浏览器，如实记录限制，不放宽门禁。

本文件拥有上述验收目标与下列实际证据；接口与安全合同只在设计文件维护。

## 本次云端验证记录

- `pnpm install --frozen-lockfile`、`pnpm check` 通过；全量 45 个测试包含真实本机 WebSocket 握手、拒绝非法来源、批准及撤销，另覆盖持久化、过期、重连和竞态。
- 全量覆盖率串行重跑通过：statements 98.96%、branches 97.38%、functions 100%、lines 99.44%，每文件维持既有四项 ≥90% 门禁，没有扩大排除范围。
- `pnpm test:gates` 7 个故意失败的反例均正确拦截；`pnpm check:audit` 通过高危门槛，仍有此前记录的 1 个 moderate 开发依赖告警，未隐藏。
- 已回读构建扩展清单：仅 storage/tabs/alarms 和 loopback host permission；没有 debugger、内容脚本或远程站点权限。传输上限 8 MiB，与 500 条标签及各字段上限相容。
- 真实 Chromium 双配置 Playwright 已编写，但本云端启动即因 socket 权限限制失败，尚未进入页面断言。后续 Windows/macOS 的真实浏览器 CI 结果见下节，不由单元/WS 测试推断。

限制：当前验证目标为 Chromium MV3（最低 Chrome 116），不声称已经验收所有 Chrome/Edge 版本、Firefox/Safari、系统休眠或系统安装流程。内部凭据存于扩展 local storage；不抵抗同 OS 用户恶意程序。管理 capability 仅在本机开发启动链接与会话内使用，后续安装器入口合同见[安装设计](../../design/installation.md)。

## Windows/macOS 集成验收

2026-11-07，提交 `68f266d40f050af3241516ef6d6a0bd8430a624e` 的 [GitHub Actions 42380159568](https://github.com/bYiyLi/Avru/actions/runs/42380159568) 已完成，Windows、macOS 和 audit 三个 job 均 success；已读取 job 步骤及日志，不仅检查 workflow 配置。

- Node 24.22.1、pnpm 11.25.0；Playwright 1.65.0 下载的 Chrome for Testing 158.0.8127.18。
- 两平台均通过完整工程检查、45 单元/集成用例、7 门禁反例和真实 Chromium 扩展端到端用例。E2E macOS 16.2 秒、Windows 19.8 秒仅为该次测试耗时，不是产品性能承诺。
- E2E 启动构建后的 `apps/daemon/dist/main.js` 独立进程，加载两个独立持久浏览器配置的真实 MV3 扩展，完成视觉码核对批准、分别展示标签和 URL 脱敏；关闭并重新打开一个浏览器配置后无需重新配对。
- 随后退出 daemon OS 进程、在相同数据目录重新启动，使用新管理入口重新打开 UI；两个扩展自动认证恢复标签；最后撤销其中一个配对并验证对应配置消失、扩展不再显示已连接。
- 首次提交 `ce027f4` 的 [42379802909](https://github.com/bYiyLi/Avru/actions/runs/42379802909) 同样通过，但当时 daemon 恢复仅在同一测试进程内重建服务。后续明确补强为真实进程退出/启动，不把两者混称。

以上验收完成本阶段开发闭环；仍未在用户电脑安装，未验证商店分发、品牌 Chrome/Edge 全版本、睡眠唤醒、OS 登录自启动、远程 MCP/OAuth、网页操作及 QuickJS 执行。原 moderate 开发依赖告警保留如实记录，不影响本次既定门禁通过，也不当作风险已经消失。

# QuickJS 独立执行基础

## 目标与边界

实现 R-16 / D-12 已确认的独立复用进程、任务隔离和受控边界，技术真源见[runner 设计](../../design/runner.md)。完整浏览器 SDK/MCP schema 尚待评审。本阶段不接入真实网页、daemon、OAuth 或公开工具，不把基础完成当作 AI 已能操作网页。

交付 `packages/runner` 内部包、固定引擎依赖、单元失败测试和 Windows/macOS 真实子进程 CI；无需用户账户或外部服务。源码、版本和限额由同一包拥有，避免平行执行器。

## 验收

| 范围          | 验证入口与预期                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------- |
| 状态/权限隔离 | engine 单测：任务全局不共享，Node/fetch/import 不可用，默认 bridge 拒绝；只有 mock echo             |
| 资源与调度    | 源码/输出/堆/栈/调用次数限制；无限循环、未决 Promise 到期；有界队列、串行复用                       |
| 故障与 IPC    | 错 ID、重放/重复、错误/过大回复、spawn/pipe 错误拒绝；取消/崩溃不重放；迟到结果无效                 |
| 真实进程      | `pnpm test:runner`：正常复用、跨任务隔离、mock Promise、超时强杀重建、取消重建、畸形 IPC 与断开退出 |
| 工程          | `pnpm check`、`test:gates`、`check:audit`、既有 E2E；本次准确 SHA 的 Windows/macOS CI               |

## 当前状态

基于 main `d6d39786bdaa96c86ddc908abd1c35f1cc14df2f` 的本次工作树：云端 Node 24.22.1 / pnpm 11.25.0，`pnpm check` 通过（219 测试，43 文件）；新增 runner 各生产文件 statements/branches/functions/lines 均 ≥90%。`pnpm test:runner` 真实子进程 3/3、`pnpm test:gates` 7/7 通过；audit high/critical 门禁通过，仍有既有 moderate 工具链告警，不声明零漏洞。

独立只读复审发现并已修复：取消前 microtask 仍调用宿主、未 await 桥接提前报告完成。复跑证据：取消后 invoke=0；完成时 mock host 已 settle；33 次取消的非协作调用实际 invoke 上限为 32。该上限仅单 Runner，未来 daemon 必须单例或统一预算。

尚未取得本次 Windows/macOS CI；实际平台验收随此阶段后续记录。实现和 mock 测试不能证明生产 browser grant 校验、实际网页操作、RSS 极限或 OS 沙箱安全。

本地既有 Chromium E2E 未通过环境启动：Playwright 缓存没有目标浏览器；使用现有系统 Chromium 156 后被云端沙箱拒绝 Unix socket，并遇到只读 crash 配置路径，4 个用例未进入业务验收。未绕过限制、不把本地失败写成浏览器回归通过；Windows/macOS CI 仍须实际执行全部 E2E。

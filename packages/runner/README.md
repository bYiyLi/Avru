# QuickJS WASM 执行器基础

内部执行器，`private: true`，不对 npm 发布。使用 quickjs-emscripten 0.32.0；由内部 `Runner` 监督单个独立复用进程，每次任务新建并销毁 QuickJS runtime/context。

## 生产协议（M1）

daemon ↔ runner 走 NDJSON 私有管道（子进程 fd 3/4，不开端口、不继承环境变量、固定 Node 启动参数），信封 `{v:1, type, taskId, seq}`，`seq` 每方向每任务从 1 单调递增；消息为 `run_task` / `cancel_task` / `ping` / `bridge_call` / `task_result` / `pong` / `bridge_result`（见 `src/protocol.ts`）。错任务、重复/越界序号、超大消息拒绝记日志，不重放。基础的 fork `{run,reply,call,done}` 形态已按 B6 移除，不保留兼容。

`Runner.run(code, invoke?, options?)`：`options.timeoutMs` 未传入时用 5 秒基础上限，传入时 clamp 到 1ms–300s（默认 60 秒、上限 300 秒，M0）；`options.target` 为已认领目标 `{browserId, tabId, generation}`；`options.limits` 为 `{maxOutputBytes, maxBridgeCalls}`。超时且有桥接在途时终态为 `unknown`，纯计算超时为 `timeout`；取消返回 `cancelled`；超时/取消/崩溃强制结束进程，等关闭后才建新进程，崩溃不重跑。

## SDK 空壳（M1）

每个任务的 QuickJS 上下文注入 `browser` 全局，只含只读面：`browser.tab.title()`、`browser.tabs.list/get`、`browser.capabilities.list/get`（静态最小集，见 `src/sdk.ts`）。每个方法是一次 `__hostCall` 桥接调用，方法名用点分路径；入参先做结构校验，非法报 `INVALID_ARGUMENT`（脚本内抛 `SdkError`），不发往扩展；返回值一律 JSON 可序列化。M1 不提供任何写方法。桥接方法契约（方法名、入参、返回值）见 `src/sdk.ts` 顶部注释。

当前仅交付执行骨架和 mock bridge 验证。**daemon 尚未实例化运行器，MCP 没有新增执行工具，浏览器 SDK 和真实网页动作尚未实现。** `__hostCall` 是测试内部桥接探针，不是承诺给 AI 的 SDK；缺省拒绝所有宿主调用。将来接入必须由可信 daemon 每次校验实际授权、目标与动作，不能把回调注入本身当授权。

执行 `pnpm --filter @avru/runner build` 后，可运行根命令 `pnpm test:runner` 验证真实子进程。正常工程 `pnpm check` 会覆盖源码与 mock 测试；Windows/macOS CI 在 build 后另运行真实进程测试。

合同及限制见 [运行器设计](../../docs/design/runner.md) 与 [浏览器 SDK 设计](../../docs/design/browser-sdk.md)，验收状态见 [阶段 08](../../docs/development/phases/08-browser-sdk-mcp.md)。不保证 OS 沙箱隔离，不会自动重放失败脚本。

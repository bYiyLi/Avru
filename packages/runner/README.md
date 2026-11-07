# QuickJS WASM 执行器基础

内部执行器，`private: true`，不对 npm 发布。使用 quickjs-emscripten 0.32.0；由内部 `Runner` 监督单个独立复用进程，每次任务新建并销毁 QuickJS runtime/context。

当前仅交付独立基础和 mock bridge 验证。**daemon 尚未实例化运行器，MCP 没有新增执行工具，浏览器 SDK 和真实网页动作尚未实现。** `__hostCall` 是测试内部桥接探针，不是承诺给 AI 的 SDK；缺省拒绝所有宿主调用。将来接入必须由可信 daemon 每次校验实际授权、目标与动作，不能把回调注入本身当授权。

执行 `pnpm --filter @avru/runner build` 后，可运行根命令 `pnpm test:runner` 验证真实子进程。正常工程 `pnpm check` 会覆盖源码与 mock 测试；Windows/macOS CI 在 build 后另运行真实进程测试。

合同及限制见 [运行器设计](../../docs/design/runner.md)，验收状态见 [基础阶段](../../docs/development/phases/07-runner-foundation.md)。不保证 OS 沙箱隔离，不会自动重放失败脚本。

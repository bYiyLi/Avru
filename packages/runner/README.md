# QuickJS WASM 执行器边界

此目录预留独立复用的 QuickJS WASM 执行进程，尚无可运行实现或 package.json。
由 daemon 启停和监督，通过受控 SDK 请求 daemon 执行浏览器动作。不得持有 OAuth 或插件配对密钥，不直接连接扩展。
具体 WASM 包、IPC、任务上下文和限额仍见 [设计](../../docs/design.md#531-与-quickjs-受控-sdk-的关系)。确定并验证这些合同后再加入 workspace 包，不能用空运行器冒充已实现隔离。

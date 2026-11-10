# 受控 SDK 与 QuickJS 运行器

对应 R-16、D-12；本文件拥有执行器边界；独立基础实现与完整浏览器 SDK 区分见下文。

### 与 QuickJS 受控 SDK 的关系

D-12 已确定 QuickJS 采用 WASM 版，放在由守护进程管理的单个独立、可复用执行进程中，而不是 daemon 主进程或主线程内。运行器是同一个 Avru 产品的内部组件，不要求用户单独安装或启动 QuickJS。AI 脚本调用受控 SDK，执行请求交给守护进程；守护进程鉴权和路由后，经 WS 发送给目标扩展。QuickJS 不与 WS 传输选型绑定，也不直接获取插件或 OAuth 凭据。

进程复用不意味着任务全局变量、句柄或权限可共享。每次任务须隔离执行状态与授权范围，任务结束后释放资源；持久 JS 会话语义仍未确认。WASM 路线已确定，原生 QuickJS 不再作为待选的并行实现。独立基础的包版本、上下文、IPC 与调度见下文；生产宿主绑定和浏览器 SDK 合同仍需细化。

内存、脚本执行时间和宿主 SDK 调用超时需要分别限制；脚本中止不保证网页动作未发生。执行进程失效时守护进程应停止接收该实例的新请求，标记未决操作，按结果查证后恢复，不自动重跑整个脚本。独立进程不是操作系统级沙箱，WASM 也不替代宿主权限控制；二者都不是安全已验证的证据。

采用 WASM 的理由是便于随 npm 包分发同一引擎资产，减少为不同操作系统/架构维护原生 QuickJS 绑定的负担；代价是宿主桥接、异步任务推进、资源释放和性能仍须验证。将执行器放进 daemon 主进程虽可减少一层通信，但异常和资源耗尽会更直接影响连接、OAuth 与管理服务，因此保留独立进程。进程复用减少反复启动开销，不作为跨任务隔离或资源占用已达标的证明。

## 独立执行基础合同

此基础遵循已确定的独立进程和任务隔离要求，不冻结尚未确定的浏览器 SDK 或公开 MCP schema。`packages/runner` 为私有内部包；daemon 尚未连接它，安装包尚不分发运行器。

- 引擎固定 `quickjs-emscripten@0.32.0` 标准 WASM 构建。每个进程复用模块，每个任务独立 runtime/context/heap；不提供持久脚本会话。显式释放 Promise/返回值句柄，结束后忽略迟到的宿主 Promise。
- 只提供 Promise 型内部桥接探针；缺省拒绝。测试注入 mock echo，不连接浏览器、OAuth、文件、网络或 shell。没有模块加载器、Node 全局或任意 CDP。不得直接将此探针公开为用户 SDK。
- `Runner` 串行执行；最多 8 个等待任务、1 个运行任务，排队不启动 CPU 时限。源码与单次桥接/输出各最多 64 KiB，单任务最多 32 次桥接，QuickJS 堆 16 MiB、栈 256 KiB，任务墙钟 5 秒。数值是保守内部上限，不是性能承诺；尚未测真实网页业务适配。
- 守护侧父进程独立计时，超时/取消强制结束执行进程，等待进程关闭才允许后续任务新建进程。崩溃不重跑原脚本。正常完成复用进程但不复用 VM 状态。IPC 使用继承的私有管道，随机任务 ID 和单调调用序号绑定，拒绝错任务、重复调用、越界消息；不会开端口。
- 子进程不继承环境变量，固定 Node executable/启动参数，忽略标准输入输出，仅用 IPC。V8 堆 64 MiB 不能当成总 RSS 上限，QuickJS 限额也不覆盖引擎/Node 的全部内存。没有 OS 级文件系统/网络沙箱；若引擎逃逸或宿主受控，进程权限仍是当前 OS 用户权限。
- 内部结果区分完成、脚本/输出/协议失败、超时、取消、崩溃。这里只运行无副作用 mock。未来接入真实动作必须另记录“未派发/已完成/结果未知”，不能拿这些脚本终态推断网页副作用或安全重试。
- 此阶段没有生产 bridge 授权实现、远程工具注册、追踪持久化、发布分发和 daemon 启停接线；已有 OAuth 的 `browser:read` 不扩展。

依据：[quickjs-emscripten v0.32.0 README](https://github.com/justjake/quickjs-emscripten/blob/v0.32.0/README.md) 的 runtime 限额、句柄释放、Promise/executePendingJobs 合同。标准 Promise 不要求 Asyncify，避免其跨模块挂起/重入限制。资料读取于 2026-11-07；库文档不等于 Avru 安全认证或性能实测。

宿主桥接的生命周期：未 await 的桥接也须 settle 且 VM jobs 排空才能报告完成。实际 invoke 前再次检查任务仍活跃；终态发出 AbortSignal，迟到结果不转发。单个 Runner 最多保留 32 个实际未 settle 的宿主调用，取消不释放该计数，避免非协作回调跨任务无限累积。AbortSignal 是协作取消，不保证撤回已发生副作用；生产适配器必须检查信号并执行独立业务授权。SDK 入口按用户最新方向使用 `browser`，具体方法尚未定，本阶段内部探针不代表公开命名。

## 生产桥接与进程间协议

本节是独立基础之上的生产接线合同：daemon 与 runner 之间的进程间协议，以及真实浏览器动作的桥接授权。SDK 方法定义见[浏览器 SDK](browser-sdk.md)；MCP 工具定义见[MCP 与授权](mcp.md)。

### 进程间协议

- 传输：继承的私有管道，不开端口；子进程不继承环境变量，固定 Node 启动参数，只走 IPC。
- 帧格式：NDJSON，每行一个 JSON 对象，UTF-8 编码，单条消息 ≤64 KiB。
- 信封：每条消息含 `{ v: 1, type, taskId, seq }`；`seq` 为每个方向、每个任务内单调递增的序号，从 1 开始。
- 校验：收到错任务、重复序号、越界序号或超大消息时拒绝该消息并记日志；不自动重放。

| 方向            | 消息          | 关键字段                       | 说明                                                                                                          |
| --------------- | ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| daemon → runner | run_task      | taskId、script、target、limits | 启动任务；target 为 { browserId, tabId, generation }；limits 为 { timeoutMs, maxOutputBytes, maxBridgeCalls } |
| daemon → runner | cancel_task   | taskId、reason                 | 取消任务；runner 向任务发出 AbortSignal                                                                       |
| daemon → runner | ping          | —                              | 保活                                                                                                          |
| runner → daemon | bridge_call   | taskId、callId、method、args   | SDK 方法调用请求；method 为 SDK 方法名，args 为 JSON 数组                                                     |
| runner → daemon | task_result   | taskId、state、result?、error? | 任务终态；state 为 queued / running / succeeded / failed / cancelled / unknown                                |
| runner → daemon | pong          | —                              | 保活响应                                                                                                      |
| daemon → runner | bridge_result | callId、ok、value?、error?     | 对 bridge_call 的回答                                                                                         |

- `bridge_call` 与 `bridge_result` 用 `callId` 一一对应。
- `task_result` 发出后，该任务的后续桥接调用一律拒绝；迟到的 `bridge_result` 不转发。

### 生产桥接

宿主桥接缺省拒绝；只有通过 daemon 检查的调用才会执行。daemon 对每次桥接调用按顺序检查：

1. **任务仍活跃**：任务未取消、未超时、未进入终态；`bridge_call` 的 taskId 与当前运行任务一致，`callId` 未重复。
2. **授权仍有效**：MCP OAuth grant 仍有效且未撤销；目标浏览器仍处于配对状态；grant 的能力范围包含本次调用。
3. **目标仍有效**：标签页存在且属于已连接的可信设备；连接代次与当前任务一致；目标不是浏览器原生无法访问的系统页面。内部自动认领仅用于并发互斥，无须人工批准。
4. **协议与能力有效**：SDK 桥接方法及参数符合当前 SDK 合同；`cdp.send` 直接传递全部 CDP 命令，不设 CDP 命令白名单、单 origin 限制或业务敏感命令过滤；浏览器若不支持某命令，如实返回后端错误。
5. **自动执行**：已认证客户端的 AI 不需要逐次用户确认或操作时挂起。任务操作仍按超时、取消、断线和结果未知状态机处理，不自动重放可能已生效的副作用。

- 任一检查失败，daemon 返回 `bridge_result`（`ok: false`），`error.code` 为对应错误码（错误码表见[浏览器 SDK](browser-sdk.md)）；不把失败调用发往扩展。
- CDP/SDK 可向任务返回浏览器允许读取的 Cookie、页面正文和 JavaScript 结果；**内部连接 Token 与 OAuth 凭据不得泄露**。审计日志默认不持久保存 Cookie 值、输入文本、网页正文或含敏感查询参数的完整 URL。
- 取消用 AbortSignal 协作取消：daemon 发 `cancel_task` 后，runner 向任务发出 AbortSignal；在途桥接调用标记取消，daemon 收到取消后不再下发新调用；迟到结果丢弃，不转发给已结束的任务。
- 生产适配器必须检查 AbortSignal、已认证客户端、有效目标连接及任务互斥；不进行逐业务动作授权或人工确认。AbortSignal 不保证撤回已发生副作用。

### 超时、取消与崩溃

- daemon 侧父进程独立计时；超时或取消强制结束执行进程，等待进程关闭才允许后续任务新建进程。
- 崩溃不重跑原脚本；执行进程失效时 daemon 停止接收该实例的新请求，标记未决操作，按结果查证后恢复。
- 超时或崩溃发生在副作用桥接调用中时，任务终态为 unknown；发生在纯计算时为 failed(TIMEOUT)。完整状态机见[浏览器 SDK](browser-sdk.md)。

### 墙钟：5 秒基础上限与生产 timeoutMs

- 独立基础的任务墙钟 5 秒是基础的保守上限，只适用于无副作用的 mock 基础，不适用于真实网页任务。
- 生产任务由 daemon 按任务传入 `timeoutMs`（已决定默认 60 秒、上限 300 秒，M0，2026-11-08）；未传入时沿用 5 秒基础上限；runner 的墙钟按 daemon 传入值执行，5 秒基础上限不作为生产任务的上限。
- 单步 SDK 调用等待随任务 timeoutMs 计入总时长。脚本中止不保证网页动作未发生。

# 第一阶段：本机浏览器连接

## 范围与合同

本阶段实现 daemon、本机管理 Web、Chromium MV3 扩展之间的连接闭环。只发现普通 HTTP/HTTPS 标签页，不执行页面操作，不启用 debugger、远程 MCP、OAuth、FRP 或 QuickJS。不包含发布、用户安装、自启动或卸载实现。

### 信任与配对

- daemon 仅监听 `127.0.0.1:43821`。管理 API 需要本次 daemon 启动生成的随机管理 capability；开发启动链接以 fragment 携带，Web 读取到 sessionStorage 后立即移除 fragment。重启后旧链接失效。该入口不能暴露到隧道。
- 扩展主动发起待批准请求；服务器绑定当前 WebSocket、扩展 Origin、配置身份与有效期，在扩展和管理页展示同一六位核对码。用户比较后在可信管理页点击批准。不复制、输入或保存配对码。
- 六位码仅供识别当前请求，不是可以兑换凭据的密码。批准只向发起请求的原连接发送随机内部凭据；扩展自动保存。管理 API 不返回长期凭据。
- 浏览器 ID 和连接 ID 只是路由标识，不是凭据。恢复连接必须验证内部凭据及原扩展 Origin。服务端仅保存凭据哈希。撤销配对关闭连接并使后续认证失败。
- 限制 Host、WebSocket Origin、消息尺寸、消息形状和认证等待时间；管理写接口校验同源及 bearer。普通网页不能请求或批准连接。
- 本机同一 OS 用户的恶意程序不属于已隔离对手：它可以读取用户存储或启动进程。扩展 Origin 也不能证明客户端程序本身可信，必须依赖管理端批准。浏览器配对不代替以后 MCP / SDK 的动作授权。

### 消息合同 v1

| 方向               | 消息         | 关键字段                       |
| ------------------ | ------------ | ------------------------------ |
| 扩展→daemon        | pair         | profileId、name                |
| daemon→扩展        | pairing      | requestId、code、expiresAt     |
| daemon→扩展        | paired       | browserId、token、connectionId |
| 扩展→daemon        | authenticate | browserId、token               |
| daemon→扩展        | ready        | browserId、connectionId        |
| 扩展→daemon        | tabs         | tabs: id、title、url           |
| 扩展→daemon / 反向 | ping / pong  | 无附加授权                     |
| daemon→扩展        | error        | code、message                  |

所有消息含 `v: 1` 和 `type`。`paired` 后发送 `ready`；只有 ready 后才同步标签。每个配置可有同名标签 ID，身份必须结合 browserId 和连接代次。替换连接后旧 socket 的关闭/消息不得覆盖新连接。

### 管理接口

所有接口要求 `Authorization: Bearer <启动 capability>`，响应不缓存。

- `GET /api/browsers`：连接配置、在线状态、连接代次、标签清单。
- `DELETE /api/browsers/:id`：撤销配置与内部凭据。
- `GET /api/pairings`：尚有效的请求、名称、Origin、核对码、截止时间。
- `POST /api/pairings/:id/approve`：批准当前请求，成功 204。
- `DELETE /api/pairings/:id`：拒绝当前请求，成功 204。

### 数据与恢复

配置身份及内部凭据哈希持久保存到当前 OS 用户的数据目录；标签仅在内存，不写数据库或日志。扩展限制普通 HTTP/HTTPS、排除无痕，去除 URL 查询、fragment 和用户信息。最多 500 标签；标题最多 256 字符、URL 最多 2048 字符。连接断开即清空旧标签，重新连接后重新查询。扩展使用事件、心跳、退避与 alarm 恢复，不重放网页副作用，因为本阶段没有动作接口。

## 实施与验收计划

1. 独立测试协议验证、认证、过期/撤销、SQLite 恢复、代次隔离与敏感字段过滤。
2. 扩展测试配对等待、凭据保存、重连、快照事件及取消；管理页测试 capability 生命周期、待批准请求、错误状态与渲染。
3. 真实 Chromium 持久配置加载构建扩展，验证两配置共享 daemon、配对批准、标签变化和重连。Windows/macOS CI 分别运行，不能用构建通过代替浏览器实测。
4. 全量执行既有工程门禁；如某环境无法启动监听或浏览器，如实记录限制，不放宽门禁。

本文件记录实现合同与验收目标，不表示以上测试已经通过。最终证据另补。

## 本次云端验证记录

- `pnpm install --frozen-lockfile`、`pnpm check` 通过；全量 45 个测试包含真实本机 WebSocket 握手、拒绝非法来源、批准及撤销，另覆盖持久化、过期、重连和竞态。
- 全量覆盖率串行重跑通过：statements 98.96%、branches 97.38%、functions 100%、lines 99.44%，每文件维持既有四项 ≥90% 门禁，没有扩大排除范围。
- `pnpm test:gates` 7 个故意失败的反例均正确拦截；`pnpm check:audit` 通过高危门槛，仍有此前记录的 1 个 moderate 开发依赖告警，未隐藏。
- 已回读构建扩展清单：仅 storage/tabs/alarms 和 loopback host permission；没有 debugger、内容脚本或远程站点权限。传输上限 8 MiB，与 500 条标签及各字段上限相容。
- 真实 Chromium 双配置 Playwright 已编写，但本云端启动即因 socket 权限限制失败，尚未进入页面断言。Windows/macOS 验证分支 CI 待运行，不能由以上单元/WS 测试推断已通过浏览器闭环。

限制：当前验证目标为 Chromium MV3（最低 Chrome 116），不声称已经验收所有 Chrome/Edge 版本、Firefox/Safari、系统休眠或系统安装流程。内部凭据存于扩展 local storage；不抵抗同 OS 用户恶意程序。管理 capability 仅在本机开发启动链接与会话内使用，未来安装器自动打开入口的安全合同另行设计。

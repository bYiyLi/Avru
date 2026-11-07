# OAuth开发验证

此入口面向开发联调，不是已完成的用户ChatGPT/FRPC向导。用户无需保存token；下面客户端配置由部署者按可信入口的真实值准备，不能复制示例当作可用生产地址。

1. 先使用现有配对流程连接本机扩展。OAuth批准窗口只发送给已认证在线连接。
2. 准备仅本机可读配置JSON，含`channel`（dev或prod，必须匹配当前构建）、`issuer`（精确HTTPS origin，无末尾斜杠）、独立`port`、`clients`数组（每项`id`、`name`、`redirectUris`精确HTTPS值）。设`AVRU_OAUTH_CONFIG`为文件路径再启动daemon。错误配置启动失败；未设置则无远程端口。不要在日志输出配置凭据。
3. 获准HTTPS反向代理只映射这个新端口，保留issuer Host，超时超过120秒；禁止映射原管理/WS端口。本任务不会自动创建该代理或改变系统网络。
4. 客户端读取metadata并发起PKCE S256授权，resource是`issuer + /mcp`，scope为`browser:read`。授权浏览器等待标准302，没有Web批准页。目标机器扩展弹窗显示客户端、回调和范围，用户允许/拒绝；关窗等同拒绝。
5. 当前访问令牌10分钟、daemon重启失效，无refresh token。管理页撤销批准浏览器配对会作废它的grant；受管理能力保护的`GET /api/grants`与`DELETE /api/grants/:id`供后续Web集成使用，不暴露至公网。

检查入口：`pnpm check`、`pnpm check:audit`、`pnpm test:e2e`（含oauth.spec）。本地模拟客户端验收不是ChatGPT生产连接验收。故障时先查配置、是否存在在线配对、精确回调、issuer/Host、代理超时和限流；不要将access token/code/nonce放进共享日志。

双环境分别配置独立issuer、port及文件，遵循[环境隔离](../design/environments.md)。不要将一个环境的授权地址或配对凭据用于另一个环境。

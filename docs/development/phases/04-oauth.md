# 扩展确认 OAuth 实施与验收

## 范围与依据

用户授权实现通过本机已配对扩展弹窗批准远程MCP。依据[R-05/R-06/R-08](../../requirements.md)和[MCP设计](../../design/mcp.md)。本阶段不改变配对方式、不实现FRPC/ChatGPT通道、不发行npm、不修改网络权限或操作用户电脑。不把后续真实网页控制纳入只读grant。

基线为 main `ee02ee8cf8676dc12464c03a28416379155f96e6`；独立工作树。与Web/发行工作并行，合并前重核main。正式版本与发布状态不因本阶段源码完成自动升级。

## 交付与接受标准

| 交付                                  | 验收                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| 可信预登记、PKCE S256与OAuth metadata | 篡改client/redirect/state/resource/scope、重复参数与PKCE失败无grant                      |
| 同机插件确认                          | 只有已认证旧请求对应WS代次+nonce能答复；HTTP及普通网页不能答复；多扩展首答生效，其余失效 |
| 失败关闭                              | 关窗、断线、拒绝、过期、popup失败、HTTP请求取消、进程重启不能自动批准                    |
| 标准回调与只读MCP                     | 正确state/iss回调、单次code换token、每请求Bearer校验、browsers_list只读输出              |
| 生命周期                              | code重放、token过期、单grant撤销、浏览器配对撤销阻断新调用；没有refresh/persistent token |
| 入口隔离                              | remote端口没有管理/批准路由，只有固定Host，默认不启动，配置不正确拒绝                    |
| 实浏览器                              | Win/mac CI运行真实扩展popup →允许→302→token→MCP→撤销；截图保存在CI artifact              |
| 工程与评审                            | 全部现有门禁、每生产文件90%、依赖审计；安全review无未修复的本范围实质问题                |

## 当前证据与未决验收

实现提交为 `b26b9cb95b73ca4ef0fe9f3c5a5e721edce16527`，基于合并前核验的 main `1d05014768a12efba0bc249c2b4b5faf3ba8246e`，见[PR #2](https://github.com/bYiyLi/Avru/pull/2)。

- 云端完整 `pnpm check` 通过：27个测试文件、150测试通过；逐生产文件90%覆盖门禁通过；7个负向门禁测试通过。覆盖结果为 statements 99.12%、branches 97.89%、functions 98.72%、lines 99.44%。
- [提交CI](https://github.com/bYiyLi/Avru/actions/runs/42398469981) macOS、Windows、audit全部通过。Windows单测148通过、2个既有POSIX专属测试按平台跳过，不计作150全通过；两平台各3个真实Chromium E2E通过，包含扩展批准、302回调、PKCE换令牌、MCP读取及撤销。
- 本地E2E因未安装浏览器二进制未运行成功；真实浏览器证据来自上述CI，而非本地模拟。macOS artifact中的授权窗口截图已回看，显示客户端、回调、资源与允许/拒绝按钮；不把headless截图尺寸当作桌面窗口尺寸验证。
- 安全review发现并修复累计弹窗限流、code重放撤销窗口问题；修复后的同一提交由上述门禁覆盖。依赖审计无high/critical，存在既有minimatch开发依赖moderate项，未声称零漏洞。

开发联调入口见[OAuth开发验证](../../guide/oauth-development.md)。

真实ChatGPT客户端、HTTPS终止/FRPC链路、品牌Chrome/Edge全矩阵、OS睡眠/锁屏均尚未验收。当前授权等待使用最长120秒HTTP请求，代理超时导致失败关闭；这是显式限制，不通过增加Web批准按钮绕过。

## 改进与后续边界

自定义授权服务不是成熟IdP安全认证；当前以最小预登记public-client、仅内存短期token、无网络客户端元数据抓取降低范围。公开授权入口可被恶意请求占用，最多1个pending/10秒间隔/5分钟3次弹窗仅限制影响；公网运营前需要受审查的入口限流和真实客户端验证。未来增加CIMD、refresh token、写操作scope或持久grant必须更新合同与反例测试，不自动扩大本次grant。

## 环境隔离交接

用户新增dev/prod同机隔离要求由独立阶段实现。本提交只验证单daemon配置，**不宣称dev/prod隔离已经完成**。后续必须把issuer/resource、监听端口、扩展身份与配对存储、管理能力、pending/code/grant/token存储统一绑定环境；不得跨环境接收批准或复用令牌。合并实现需添加跨环境反例测试，并重新核验上述联调入口。

## 后续远程接入推进：FRPC 离线预检

基线 main `3a4f3efb656253e9271e80c847ee43ed320b1305`。本次实现纯 `planFrpc` 预览生成与静态检查，具体合同归[MCP设计](../../design/mcp.md)。独立本地目录，不改并行 Web/扩展/i18n。验收包括：只映射 OAuth 端口、固定 HTTPS Host、FRPS CA 校验、dev/prod 独立 token 环境变量引用、拒绝管理端口/模板注入/无效配置、正确序列化 Windows 路径。没有联网副作用。

状态：代码已在本地实现，尚未提交或接入管理向导；不等于 FRPC/ChatGPT 通道完成。真实 FRPC 二进制校验、网络连接、平台账户权限、最终 ChatGPT OAuth 与工具调用仍未验证。Tunnel 的授权 URL/Host 路由缺口已定位，不以取消 OAuth 或暴露管理服务绕过。

本地核验（Linux / Node 24.22.1）：新增5组测试通过且生成器全部维度100%覆盖；全仓ESLint、daemon类型检查、类型覆盖99.77%、依赖边界、零重复和Secretlint通过；依赖审计high/critical门禁通过，保留既有1 moderate告警。首次全仓单测因复制目录未生成WXT类型失败，按正式WXT prepare生成后恢复；不隐藏该环境前置。未运行真实frpc、TLS证书连接或ChatGPT。完整Windows/macOS CI仍须对待交付提交核验，不能用本地单测替代。

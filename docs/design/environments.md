# 开发与正式环境隔离

本合同对应用户确认的同机 dev/prod 共存要求（R-22）。这是安装、连接和数据的逻辑隔离，不是 OS 沙箱，不能抵御同一 OS 用户下的恶意进程。当前发行版本仍为 `0.1.0-dev.1`，不是已发布正式版；本轮实现及验证状态见[五项交付](../development/phases/06-local-connection-delivery.md)。

## 身份与目录

环境来自编译产物版本：`X.Y.Z-dev.N` 为 dev，`X.Y.Z` 为 prod，其余预发行格式拒绝。不能依赖 npx dist-tag 或运行时环境变量决定身份。默认共享版本为 `0.1.0-dev.1`；`package:prod` 构建仅供本机验收的 private `0.1.0` 包，编译时同步固化 CLI、daemon、launcher 与 MCP 身份，插件使用 prod 身份。这不是正式版公开发布。

| 项目                 | dev                                | prod                               |
| -------------------- | ---------------------------------- | ---------------------------------- |
| 目标入口             | `npx -y @avru/setup@dev`           | 本轮仅 private 本机验收包          |
| macOS 根             | `~/Avru/dev`                       | `~/Avru/prod`                      |
| Windows 根           | `%USERPROFILE%\Avru\dev`           | `%USERPROFILE%\Avru\prod`          |
| 本机 HTTP / WS       | `127.0.0.1:43822`                  | `127.0.0.1:43821`                  |
| macOS 登录项 label   | `ai.avru.daemon.dev`               | `ai.avru.daemon.prod`              |
| Windows Startup 文件 | `Avru-dev.cmd`                     | `Avru-prod.cmd`                    |
| 扩展 ID              | `cbjgomelhiahmdadpkeijpbkldblanei` | `dpkmmdoagnlnjcdfakmlblpaagoniehp` |

按用户于 2026-11-08 确认，默认目录直接放在个人目录的 Avru 下，便于在浏览器中选择插件文件夹。Windows Startup 仍尊重 APPDATA 重定向。AVRU_DATA_DIR 继续表示完整自定义根，不偷偷追加目录或搬走数据，但必须是独立绝对目录。根目录不可跨环境共用。每个根的 `.avru-channel` 固定记录 `dev` 或 `prod`，安装、运行、升级、卸载都检查归属；未知非空根拒绝自动收编。

根内分别保存`program/releases`、`program/active.json`、稳定launcher、`browsers.sqlite`（含本环境调用记录）及其WAL、`runtime.json`、`daemon.log`，因此程序版本、安装锁、实例管理capability、配对库与日志互不共享。runtime描述符和认证响应均需channel一致；不能仅凭PID停止进程。SQLite内部schema不因目录变更而改写。日志连接使用 WAL 和 `synchronous=FULL`，保留逐次提交的持久性，减少 Windows 上反复创建/删除回滚日志的磁盘同步开销；侧文件属于对应环境，关闭数据库后才能清理。参见 [SQLite WAL](https://www.sqlite.org/wal.html) 与 [同步合同](https://www.sqlite.org/pragma.html#pragma_synchronous)。

connection/ 保存本环境配置、证书材料和 FRPC 私密进程描述符；FRPC 程序属于本环境 release。连接活动保存在对应 SQLite，导入文件 channel 必须匹配。两环境不能复用配置、管理口令、OAuth 端口或 issuer；运行时未知归属不能靠改 PID 或目录接管。卸载数据清理范围归[安装合同](installation.md)维护。

## 扩展与连接边界

WXT构建目录分别为`.output/dev/chrome-mv3`与`.output/prod/chrome-mv3`，不覆盖另一环境产物。WXT使用两个固定公开manifest公钥，使本地解压扩展各自ID稳定且不同，名称标明开发环境。公钥/ID是路由标识，不是秘密或完整身份认证。扩展storage由各ID隔离；固定连接本环境端口，不提供跨环境切换选项。

生产 daemon 只接受本 channel 的 extension Origin，连接/旧版认证首包携带 channel，回复与保存的连接身份必须相符。新客户端在受限本机通道内自动登记，旧 token 仅用于旧插件恢复兼容；本机管理页面按已确认的本机信任合同访问。实例确认/退出仍校验本环境管理 key，其他环境的 key 不能操作该实例。两个管理端口的跨来源写请求仍拒绝，数据库及扩展身份不共享。

随包扩展分发使用对应环境稳定 `extension/` 目录，不能使用 npx 缓存或临时 release UUID 作为加载路径；跨环境升级/卸载不得操作另一目录。用户手动加载并在升级后重新加载扩展，插件后台自动登记和重连；旧协议仅用于升级兼容。交付事务及实际验收分别见[安装设计](installation.md)与安装阶段。

## OAuth、配置与运行

OAuth默认关闭。显式AVRU_OAUTH_CONFIG文件必须包含与当前环境一致的`channel`，另配独立监听port、HTTPS issuer及注册客户端。dev/prod必须使用不同公网issuer；隧道、DNS实际映射在部署时核验，当前代码不能从本机配置证明外部映射正确。两个进程的authorization code、token、待批准请求与撤销状态在各自内存，重启失效，不复制授权。

可显式覆盖测试监听端口，但不能使用另一channel默认端口；扩展固定端口不能因此自动发现测试端口。正常产品使用表中端口。端口已占用时启动失败，不抢占、不终止其他环境进程。配置、管理网页和扩展渠道任何一方不匹配都停止而非自动降级到另一环境。

## 旧安装、自定义根与恢复

旧版 `~/.avru` 及其 `ai.avru.daemon` / `Avru.cmd` 不自动删除、重命名、移动或归属某个环境。它的扩展和授权没有 channel，不应复制成双份长期有效授权。此前未发布包的 macOS `~/Library/Application Support/Avru/<channel>` 与 Windows `%LOCALAPPDATA%\Avru\<channel>` 同样不自动迁移。默认入口发现旧位置仍有程序、运行描述符或数据库时先拒绝继续，避免留下看不见的旧实例；其他环境不受影响。

迁移是显式操作：用旧版本正常停止/卸载程序并保留数据，备份整个旧根和登录项；确认旧实例及登录项已停，再安装新环境到空根。保留旧数据库备份供人工恢复，不自动导入旧配对凭据；重新加载正确 channel 扩展并等待自动连接。自定义旧非空根同样拒绝自动采用，选择新空根后原目录保持不变。切勿手写marker绕过检查。需要保留其他将来的业务配置时，先制定相应schema迁移，不把本轮目录拆分当作通用迁移工具。

同环境更新沿用原安装事务、旧 release 和 launcher 回滚，不改变另一环境。卸载认证并停止目标根实例及其连接，删除该 channel 登录项和 program；默认保留数据库与配置，明确删除数据的范围以[安装合同](installation.md)列出的 Avru 自有文件为准，不递归清理未知文件。恢复旧版先停止新实例，再恢复备份及旧版本，避免两版本写同一根。

## 验证边界

单元和集成验收必须覆盖双根并行、错channel根拒绝、不同登录项、两个HTTP/WS服务并存、token/Origin/首包channel交叉拒绝、一个停止或卸载不影响另一实例、旧数据保留；Windows/macOS由CI运行。扩展分别构建并核对manifest ID。OS真实注销登录、最终Chrome/Edge全品牌矩阵、正式发布、两个已发布包同机安装与公网OAuth隧道仍需对应真实验收，不以云端测试替代。

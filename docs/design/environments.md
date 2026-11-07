# 开发与正式环境隔离

本合同对应用户确认的同机 dev/prod 共存要求（R-22）。这是安装、连接和数据的逻辑隔离，不是 OS 沙箱，不能抵御同一 OS 用户下的恶意进程。当前发行版本仍为 `0.1.0-dev.1`，不是已发布正式版；实现及验证状态见[阶段计划](../development/phases/05-environment-isolation.md)。

## 身份与目录

环境来自编译产物版本：`X.Y.Z-dev.N` 为 dev，`X.Y.Z` 为 prod，其余预发行格式先拒绝。不能仅依赖 npx dist-tag 或临时环境变量决定已安装程序身份。当前共享版本为 `0.1.0-dev.1`；未来正式构建必须同步升级此版本和发行合同，不把 dev 包通过改目录伪装正式包。

| 项目                 | dev                                      | prod                                      |
| -------------------- | ---------------------------------------- | ----------------------------------------- |
| 目标入口             | `npx -y avru@dev`                        | `npx -y avru`                             |
| macOS 根             | `~/Library/Application Support/Avru/dev` | `~/Library/Application Support/Avru/prod` |
| Windows 根           | `%LOCALAPPDATA%\Avru\dev`                | `%LOCALAPPDATA%\Avru\prod`                |
| 本机 HTTP / WS       | `127.0.0.1:43822`                        | `127.0.0.1:43821`                         |
| macOS 登录项 label   | `ai.avru.daemon.dev`                     | `ai.avru.daemon.prod`                     |
| Windows Startup 文件 | `Avru-dev.cmd`                           | `Avru-prod.cmd`                           |
| 扩展 ID              | `cbjgomelhiahmdadpkeijpbkldblanei`       | `dpkmmdoagnlnjcdfakmlblpaagoniehp`        |

Windows 未设置 LOCALAPPDATA 时回落用户 `AppData\Local`；Startup仍尊重APPDATA重定向。AVRU_DATA_DIR继续表示完整自定义根，不偷偷追加目录或搬走数据，但必须是独立绝对目录。根目录不可跨环境共用。每个根的`.avru-channel`固定记录`dev`或`prod`，安装、运行、升级、卸载都检查归属；未知非空根拒绝自动收编。

根内分别保存`program/releases`、`program/active.json`、稳定launcher、`browsers.sqlite`及其WAL、`runtime.json`、`daemon.log`，因此程序版本、安装锁、实例管理capability、配对库与日志互不共享。runtime描述符和认证响应均需channel一致；不能仅凭PID停止进程。SQLite内部schema不因目录变更而改写。

## 扩展与连接边界

WXT构建目录分别为`.output/dev/chrome-mv3`与`.output/prod/chrome-mv3`，不覆盖另一环境产物。WXT使用两个固定公开manifest公钥，使本地解压扩展各自ID稳定且不同，名称标明开发环境。公钥/ID是路由标识，不是秘密或完整身份认证。扩展storage由各ID隔离；固定连接本环境端口，不提供跨环境切换选项。

生产daemon只接受本channel的extension Origin，配对/认证首包携带channel，回复与持久凭据必须相符；原有随机token、Origin绑定、管理capability验证仍保留。其他环境的token、配对ID与管理key不能复用。旧无channel凭据拒绝并需重新配对。

随包扩展分发使用对应环境稳定`extension/`目录，不能使用npx缓存或临时release UUID作为加载路径；跨环境升级/卸载不得操作另一目录。用户仍须手动加载并在升级后重新加载扩展；这不代表自动安装或免短码首次配对。交付事务及实际验收分别见[安装设计](installation.md)与安装阶段。

## OAuth、配置与运行

OAuth默认关闭。显式AVRU_OAUTH_CONFIG文件必须包含与当前环境一致的`channel`，另配独立监听port、HTTPS issuer及注册客户端。dev/prod必须使用不同公网issuer；隧道、DNS实际映射在部署时核验，当前代码不能从本机配置证明外部映射正确。两个进程的authorization code、token、待批准请求与撤销状态在各自内存，重启失效，不复制授权。

可显式覆盖测试监听端口，但不能使用另一channel默认端口；扩展固定端口不能因此自动发现测试端口。正常产品使用表中端口。端口已占用时启动失败，不抢占、不终止其他环境进程。配置、管理网页和扩展渠道任何一方不匹配都停止而非自动降级到另一环境。

## 旧安装、自定义根与恢复

旧版`~/.avru`及其`ai.avru.daemon` / `Avru.cmd`不自动删除、重命名、移动或归属某个环境。它的扩展和授权没有channel，不应复制成双份长期有效授权。默认入口发现旧安装时先拒绝继续，避免用户误以为旧实例已升级。

迁移是显式操作：用旧版本正常停止/卸载程序并保留数据，备份整个旧根和登录项；确认旧实例及登录项已停，再安装新环境到空根。保留旧数据库备份供人工恢复，不自动导入旧配对凭据；重新加载正确channel扩展并配对。自定义旧非空根同样拒绝自动采用，选择新空根后原目录保持不变。切勿手写marker绕过检查。需要保留其他将来的业务配置时，先制定相应schema迁移，不把本轮目录拆分当作通用迁移工具。

同环境更新沿用原安装事务、旧release和launcher回滚，不改变另一环境。卸载仅认证并停止目标根实例、删除该channel登录项和program；默认保留数据库，`--remove-data`仅删除已知SQLite文件。配置、日志、备份及手工加载的扩展不自动删除，避免不受控扩大清理范围。恢复旧版应先停止新实例，再恢复备份与旧版本，不让两个版本同时写同一根。

## 验证边界

单元和集成验收必须覆盖双根并行、错channel根拒绝、不同登录项、两个HTTP/WS服务并存、token/Origin/首包channel交叉拒绝、一个停止或卸载不影响另一实例、旧数据保留；Windows/macOS由CI运行。扩展分别构建并核对manifest ID。OS真实注销登录、最终Chrome/Edge全品牌矩阵、正式发布、两个已发布包同机安装与公网OAuth隧道仍需对应真实验收，不以云端测试替代。

# Clack 安装与维护

## 范围与技术合同

用户确认使用 Clack。终端承担本机程序生命周期，管理 Web 承担浏览器扩展安装引导、配对与连接设置。本阶段不发布 npm 包、不自动安装扩展、不实现远程 MCP/OAuth 或 QuickJS。生成的 npm 包仍为 private，仅供本地打包验证。

目标公开入口为 `npx -y avru`；在正式发布前不能据此声称用户已可从 npm 安装。`-y` 是 npm 下载确认，不是 Avru 删除数据确认。Avru 交互终端展示影响并确认；无人值守必须显式 `--yes`。

- `avru`：检查 payload、安装/更新/修复，启动 daemon，设置当前用户下次登录启动，打开私密管理链接。
- `avru uninstall`：停止 daemon、移除程序和自启动；默认保留配对数据，可明确选择删除。
- `avru uninstall --yes --remove-data`：明确删除已知配对数据库，不递归删除用户自建文件。
- `--help` / `--version`：只读，不启动或安装。

支持 Windows/macOS；Linux 明确拒绝安装。Node 24.22.1 至 24.x 由用户提供，程序记录绝对 Node 路径；删除或搬动 Node 后需重跑安装修复。用户不需要安装 pnpm。

## 目录、事务与恢复

`~/.avru` 是私有数据根：`browsers.sqlite` 为配对数据；`program/releases/<uuid>` 保存完整 bundle 与 Web；`program/active.json` 原子切换当前版本；`program/launcher.mjs` 为稳定登录入口。daemon 不依赖 npx 缓存。`runtime.json` 保存当前实例与私密管理链接，权限 0600；日志同样私有，不能将原始日志或链接贴到公开报告。

安装持有 `.install.lock` 排他锁，拒绝未知 program 归属及符号链接。候选完整后停止旧实例，再切换指针、启动并认证就绪，然后配置登录入口。失败恢复旧指针并重启旧实例；停止失败时不删除可能仍在使用的版本。旧 release 暂保留，不自动清理或迁移用户数据。崩溃遗留锁不自动抢占，先确认没有安装进程再人工处理，不能盲重试。浏览器打开失败不会回滚健康实例，而是给出本机私密链接。

runtime 描述符中的 PID 不是杀进程依据。CLI 验证 loopback 地址、管理 capability 和随机实例，再请求认证关机并等待描述符消失；不对旧 PID 发送信号，未知结果停止更新并报错。

## 登录启动

macOS 写用户 `~/Library/LaunchAgents/ai.avru.daemon.plist`，Windows 写用户 Startup `Avru.cmd`，支持 APPDATA 重定向。只改 Avru 标记文件，拒绝覆盖外部文件。不是系统级服务，不需要管理员，不承诺登录前运行；当前启动由 CLI 完成，下一次登录由 OS 触发。macOS launcher 在 launchd 所属进程加载当前 daemon，不提前退出后遗留子进程；Windows launcher 启动后台子进程后退出。Windows 命令窗口可能短暂出现。关闭管理页不停止 daemon。

这是受当前 OS 用户保护的本机边界，不抵抗同用户恶意程序。macOS/Windows 文件权限和登录策略差异需实际机器验收，不能从 Unix mode 推断 Windows ACL。

## 验证与交付状态

`pnpm package:cli` 构建自包含 CLI、launcher、daemon payload 与 Web，输出 `artifacts/avru`。`pnpm test:installer` 在临时数据目录运行实际 bundle；测试自启动文件只写临时 home，不改 CI 宿主的真实登录入口。正式 npm 发布、真实 OS 注销登录、用户电脑安装另行验收。

2026-11-07 云端 Linux 的完整 `pnpm check` 通过：93 项测试，逐模块覆盖维持 ≥90%；7 项门禁反例通过，audit 仍有既有 1 个 moderate 开发依赖告警。真实 bundle 生命周期测试通过。Windows/macOS CI 结果待核验，不能由 Linux 推断 OS 登录已验收。

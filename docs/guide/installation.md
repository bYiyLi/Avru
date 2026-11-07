# 安装与卸载操作说明

当前仅适用于从源码构建的 artifacts/avru bundle；正式 npm 包尚未发布，以下 avru/npx 名称说明目标命令，不保证 registry 可安装。实现来源为 apps/cli/src/main.ts、flow.ts 与 install.ts。

目标公开入口为 `npx -y avru`；在正式发布前不能据此声称用户已可从 npm 安装。`-y` 是 npm 下载确认，不是 Avru 删除数据确认。Avru 交互终端展示影响并确认；无人值守必须显式 `--yes`。

- `avru`：检查 payload、安装/更新/修复，启动 daemon，设置当前用户下次登录启动，打开私密管理链接。
- `avru uninstall`：停止 daemon、移除程序和自启动；默认保留配对数据，可明确选择删除。
- `avru uninstall --yes --remove-data`：明确删除已知配对数据库，不递归删除用户自建文件。
- `--help` / `--version`：只读，不启动或安装。

支持 Windows/macOS；Linux 明确拒绝安装。Node 24.22.1 至 24.x 由用户提供，程序记录绝对 Node 路径；删除或搬动 Node 后需重跑安装修复。用户不需要安装 pnpm。

## 执行前与故障处理

安装会写当前用户 Avru 稳定目录、启动 daemon 并注册登录入口；卸载会停止服务和删除程序。不要把数据目录指向其他应用或使用符号链接。删除配对数据会失去连接身份；未明确选择时保留。运行前先 `--help` 查看该 bundle 支持参数。

安装失败时查看实际报错，未知旧进程或归属冲突先停止，不反复覆盖。浏览器打开失败而服务健康时使用 CLI 给出的本机私密链接；不可分享。崩溃残留锁需先确认没有安装进程，不能自动抢占。Node 路径失效后恢复支持的 Node，再重跑安装修复。具体目录、认证关闭、回滚和登录边界见[安装设计](../design/installation.md)。

验收覆盖和未执行项见[安装阶段](../development/phases/02-installer.md)；本指南不宣称已在用户机器执行。

## 输出、参数与退出状态

当前 bundle `--help` 显示 `avru [--yes] | avru uninstall [--yes] [--remove-data]`；`--version` 显示 `0.1.0-dev (unpublished)`。不支持的参数、非交互未给 `--yes`、安装/卸载失败以及非 Windows/macOS 安装均返回 1；正常完成或交互取消返回 0，取消会明确输出“未作更改”，不能仅凭退出码判断已安装。`--remove-data` 只与卸载搭配；`--yes` 不自动代表删数据。

环境：`AVRU_DATA_DIR` 可指定专用私有数据目录；`AVRU_PACKAGE_ROOT` 用于开发测试定位 bundle，不作为终端用户配置流程。Node 绝对路径被记录，移动 Node 后须修复。实际自启动文件与回滚细节只在安装设计维护。

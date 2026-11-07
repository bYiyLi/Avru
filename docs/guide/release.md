# 私有开发测试包发行

本指南用于维护者生成、领取并核验 `0.1.0-dev.1` 测试包。它不是公开 npm 发布，也不说明完整浏览器控制产品已经交付。安装合同见[安装设计](../design/installation.md)，功能完成范围见[开发计划](../development/README.md)。

## 分发与保密边界

- 私有仓库保持私有。工作流拒绝非 `bYiyLi/Avru`、非私有仓库、非 `main` 的发行。
- 只上传经过校验的运行包、SHA-256 清单和提交/运行标识，不上传源码仓库、source map、测试报告、运行日志或本机数据。
- 编译、压缩及局部混淆不是加密。收到包的人仍能分析运行逻辑；私有 GitHub Actions artifact 只限制领取权限，不构成防逆向承诺。
- 不添加 npm 凭据，不执行 `npm publish`，不创建 GitHub Release，也不更改仓库权限。后续公开发布须另行明确目标、包名归属、许可与授权。

## 触发与门禁

工作流为 `.github/workflows/private-release.yml`，名称 **Private development release**。相关源码、依赖、构建、测试与发行工作流合入 `main` 时自动运行；有 Actions 执行权限的维护者也可在 `main` 手动 Run workflow。一次重跑只能证明该次源提交和执行结果，不能用旧的成功运行代替当前提交验收。

1. Windows/macOS 分别使用 `.node-version` 和固定 pnpm 安装依赖。`--frozen-lockfile --ignore-scripts` 拒绝锁文件漂移并跳过默认安装脚本；随后仅显式执行已审查的 esbuild 重建与 WXT 类型准备。新增依赖安装脚本须重新审查，不扩大 allowBuilds。
2. 两平台执行 `pnpm check`、`pnpm test:gates`、`pnpm check:audit`、`pnpm package:cli`、`pnpm test:release`。任何失败均阻断交付，不能将网络审计失败记为安全通过。
3. `npm pack --ignore-scripts` 生成真实 tgz；解包回测试目录后执行 CLI 版本和安装回归，避免只测未打包工作树。然后执行 Chromium E2E。
4. 只有两平台均成功，macOS 交付任务才从同一 SHA 重建、复核包并上传。最终 artifact 名包含版本、完整 SHA、run ID 和 attempt，保留 14 天；失败不上传发行 artifact。

这里的双平台安装回归不证明用户电脑已安装，也不替代真实注销/重新登录自启动、最终品牌浏览器矩阵及完整功能验收。开发包仍须以实际内容说明扩展本地加载、配对、MCP、QuickJS 等能力，不能把尚未实现的安装引导写成已完成。

## 领取与核验

1. 在私有仓库 Actions 打开目标 SHA 的 **Private development release**，确认 `validate` 两个平台和 `deliver` 全部成功。
2. 从该运行的 Artifacts 下载对应 `avru-0.1.0-dev.1-<SHA>-<run>-<attempt>`。需要仓库访问权限，过期后需重新运行；这不是无需登录的公开下载地址。
3. 解压 artifact 容器，核对 `release.json` 的 sourceCommit、workflowRun、workflowAttempt 和版本与页面一致。
4. 对 `avru-0.1.0-dev.1.tgz` 计算 SHA-256，与 `SHA256SUMS` 比较。macOS 可用 `shasum -a 256 avru-0.1.0-dev.1.tgz`；Windows PowerShell 可用 `Get-FileHash .\avru-0.1.0-dev.1.tgz -Algorithm SHA256`。不一致则停止安装，保留文件调查来源。
5. 本机已具备规定 Node/npm 后，在该目录先运行 `npx -y --package=./avru-0.1.0-dev.1.tgz avru --version`，确认版本。需要安装时再运行 `npx -y --package=./avru-0.1.0-dev.1.tgz avru`，按 Clack 提示确认本机程序与登录启动变更。

尚未公开发布时不能声称 `npx -y avru` 可用；不要让用户用裸包名去执行一个未确认归属的 npm 包。卸载同样使用已核验测试包：`npx -y --package=./avru-0.1.0-dev.1.tgz avru uninstall`。默认保留配对数据，删除数据选项需用户明确选择。

## 故障与恢复

- 依赖审计、产物检查、安装或 E2E 失败：先查看本次私有 Actions 步骤日志并修复，不上传未经验证的替代包。日志不得复制到公开工单，尤其不能带私密管理链接。
- 包已下载但 checksum 或版本不符：不安装、不重命名冒充正确版本，从精确成功 run 重新领取。
- 已安装候选发生问题：现有安装事务的失败回滚边界由安装设计规定。保留旧已验证包；不要删除用户配置或手工改 active pointer。不同数据版本兼容尚须独立验证，不承诺任意降级安全。
- 本流程不支持覆盖 npm 已发布版本。后续测试版本递增预发行编号；`0.1.0-dev.1` 不是正式 `0.1.0`。

## 验收记录

指南及工作流文件存在仅代表流程已定义。交付时还需报告实际 commit、成功 run、双平台结果、artifact ID/下载入口、SHA-256 与已验证范围；未跑 CI、无可领取产物或任一必需检查失败时，状态仍是未完成。

## 本地工具链复核

固定 `javascript-obfuscator@4.1.1`，其 `postinstall` 募资脚本明确禁用；只调用同步本地 `obfuscate`，不采用带云 API 的新版本。保守选项和唯一首方模块位于 `scripts/release/obfuscate.mjs`。升级依赖必须重新检查依赖闭包、脚本、许可证及行为，不将“本地包”当作无出网证明。

支持 Linux/libseccomp 的隔离审查机可运行 `python tests/release/offline-linux.py node scripts/package-cli.mjs`：进程级过滤拒绝网络 socket/connect/send 类系统调用并关闭继承描述符，不改变宿主网络设置。先用同一封装运行 `node -e "require('node:net').connect(443,'1.1.1.1').on('error', e => { console.error(e.code); process.exit(1); })"`，必须确认为 EPERM，而非网络不可达；再运行构建。此验证只证明该次被隔离构建的出网边界，不是 Windows/macOS 的网络沙箱或 Linux 产品支持。CI 的平台验收不自动等同于该断网实验。

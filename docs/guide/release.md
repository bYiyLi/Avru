# 私有开发测试包发行

本指南用于维护者生成、领取并核验 `0.1.0-dev.1` 测试包。它不是公开 npm 发布，也不说明完整浏览器控制产品已经交付。安装合同见[安装设计](../design/installation.md)，功能完成范围见[开发计划](../development/README.md)。

## 分发与保密边界

- 私有仓库保持私有。工作流拒绝非 `bYiyLi/Avru`、非私有仓库、非 `main` 的发行。
- 只上传经过校验的运行包、SHA-256 清单和提交/运行标识，不上传源码仓库、source map、测试报告、运行日志或本机数据。
- 编译、压缩及局部混淆不是加密。收到包的人仍能分析运行逻辑；私有 GitHub Actions artifact 只限制领取权限，不构成防逆向承诺。
- 私有候选流程不添加 npm 凭据，不执行实际 `npm publish`，不创建 GitHub Release，也不更改仓库权限。后续公开发布须另行明确目标、包名归属、许可与授权。

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

## npm dev 通道准备（尚未公开发布）

目标入口是 `npx -y avru@dev`，首个目标版本为 `0.1.0-dev.1`；用户指定的 npm 账号是 `baiyihuan`，已告知启用 2FA；实际登录身份、2FA 状态、包名归属和发布权限仍需操作时核验。当前已实现候选生成和只做 dry-run 的 CI，正式发布仍是后续方案：没有公开发布、没有保存 Trusted Publisher、没有改变认证或权限。现有私有 CI 继续按上文工作。

### 先生成可公开的候选包

默认 `scripts/package-cli.mjs` 仍生成 `private:true`；现有私有 tgz **不能直接用于 npm 发布**。运行 `pnpm package:cli` 后，显式执行 `node scripts/release/npm-candidate.mjs`，才会在独立的 `artifacts/npm-dev` 生成候选：`private:false`、固定 `dev` tag、public access 和 npm 官方 registry，workspace 与默认包仍私有。校验器要求显式 `npm-dev` 模式，拒绝 `latest`、正式版本以及源码、map、凭据及未批准文件。公开元数据 `repository.url` 指向 `https://github.com/bYiyLi/Avru`，不改变仓库私有性。

`.github/workflows/npm-dev-prepare.yml` 在 main 相关发行脚本变更或手动触发时，仅执行双平台门禁、候选打包、`npm publish --dry-run`、真实 tgz 安装回归和 Chromium E2E。没有发布凭据、`id-token:write` 或实际上传 npm 的命令。成功后将候选 tgz、SHA256SUMS、release.json 保存在私有 Actions artifact；须核对同一 SHA 的 Windows/macOS 两项都成功，不能凭某一平台 artifact 判定全部通过。产物仍不含浏览器扩展，不能承诺一键完成完整浏览器能力。

元数据变化也会改变 tgz 摘要。候选须重新打包、逐项比较包内容、检查第三方许可及敏感数据，重新计算摘要并完成 Win/mac 安装测试和对应提交 CI；不能临时修改旧 tgz 后沿用旧校验结果。候选可公开性和首次发布获得明确授权之前停止在这里。

### 最小首次发布与 CI 信任接续

1. **核对身份和包名。** 在 npm 官方登录流程中确认账号与用户指定身份一致、2FA 可用，并核验 `avru` 可创建或账号确有写权限。404 不代表包名已保留给本账号；身份/权限未确认则不发布。不把登录凭据、2FA 秘密或长期发布 token 放入聊天、仓库或工作流。
2. **初始化 npm 包。** 如果包尚不存在，需要一次经过授权的初始化，之后才能在包设置中配置 Trusted Publisher。[npm trust 前置条件](https://docs.npmjs.com/cli/v11/commands/npm-trust/) 明确要求包已存在。此前采用下节首次 CI staging 方案；当前明确批准的备选见末节一次性直接 CI 发布；维护者交互发布仅为另行选择的备选，仍须显式使用 `dev` tag；不是发布现有 `private:true` 私有包。不要为“占名”擅自公开占位版本。`npm stage publish` 对全新包也会公开 `0.0.0-stage` 占位版本，不能当成无公开副作用的演练。[npm staged publishing](https://docs.npmjs.com/staged-publishing/)
3. **配置限定的信任。** 包初始化成功后，在 npm 的 `avru` 设置中添加 GitHub Actions Trusted Publisher：GitHub owner 为 `bYiyLi`、repository 为 `Avru`、workflow filename 为届时已提交的专用 npm 发布文件名（不是路径）；若使用 GitHub environment，名称必须准确一致。保存信任及其允许操作属于权限变更，需要针对该配置的授权。不要把当前仅生成私有 artifact 的工作流误认为已经获得 npm 发布权限。
4. **接续专用发布 job。** 后续实现须保留双平台质量/产物门禁和明确的发布触发点，仅发布 job 申请 `id-token: write`，其余维持最小只读权限；使用 GitHub-hosted runner 和满足 OIDC 要求且固定版本的 npm，不配置长期写 token。信任配置中的直接发布与独立 dist-tag 管理权限分别按实际所需授权，不顺手扩大权限。此 job 及权限尚未在本次实现。[npm Trusted Publisher 配置](https://docs.npmjs.com/trusted-publishers/)
5. **核验后才给出安装入口。** 发布获准并完成后，回读 registry 中 `avru@0.1.0-dev.1` 的完整元数据、tarball integrity 和 `dev` 指向，再从 registry 包核验版本/安装路径。只成功构建、`npm whoami` 成功或信任设置已保存都不能证明发布成功。确认后才能告知 `npx -y avru@dev` 可用；不自动改 `latest`，也不覆盖已发布的相同版本。[npm 发布与标签规则](https://docs.npmjs.com/cli/v11/commands/npm-publish/)

截至 2026-11-07 官方说明，私有 GitHub 仓库可使用 OIDC Trusted Publishing，但不能生成 npm provenance；**不要为了 provenance 将仓库改公开，也不要把内部 SHA/摘要记录称作 npm provenance**。本方案保留私有仓库与内部构建证据，并在后续发布结果中注明该限制。[npm provenance 限制](https://docs.npmjs.com/trusted-publishers/#automatic-provenance-generation)

## 首次 CI staging：维护者操作

用户已选择首次也由 CI 上传，并接受新包公开 `0.0.0-stage` 占位。专用工作流为 `.github/workflows/npm-dev-stage.yml`（**Stage first npm dev release**），仅手动触发，不随 push 发布。它固定领取已通过双平台的运行 `42394455061`、artifact `13582611914`、源码 `2f87b5a7407b0ff266a8b28b73c87fbd48590fa9`，校验 checksum、来源记录、dev 元数据和文件白名单，不重建新主分支内容。artifact 过期或任一校验失败就停止，不能自行换包。这是首次专用流程，不是后续通用发布器。

1. 在 npm 用 `baiyihuan` 登录，头像 → **Access Tokens → Generate New Token**。选择 **Read and write (stage only)**，不要勾选 Bypass 2FA，组织权限设 No access，到期设一天。优先限定 `avru`；如果未创建的 unscoped 包无法在下拉中选择，**先停止**。官方仅描述 All Packages 或已有指定包/作用域，没有证实可预先限定未存在的 `avru`。All Packages 会扩大到账号可访问的包，必须明确确认范围；不能把用户同意 staging 当成默认同意账号全包权限。替代为先通过交互会话建立目标包，或另行决定 scoped 名称，均不可擅改目标。
2. 仅当权限范围已确认，由用户复制 token 到 GitHub `bYiyLi/Avru` → **Settings → Secrets and variables → Actions → New repository secret**。Name 精确填写 `AVRU_NPM_STAGE_TOKEN`，Secret 填 token。不要发到聊天、提交到仓库或贴进普通变量。助手不创建、不接收、不回读这个秘密。stage-only 仍有移动 dist-tag、废弃版本等写权限，并非无害只读凭据。
3. GitHub **Actions → Stage first npm dev release → Run workflow**，branch 选择 main，勾选确认首次公开占位的选项。工作流固定 npm `11.21.2`、Node `24.22.1`；令牌只在身份核对与 staging 步骤注入，不向构建/依赖安装步骤开放。身份不是 `baiyihuan` 时停止。只运行 `npm stage publish ... --tag dev`，绝不执行 `npm stage approve` 或直接 `npm publish`。没有 secret 就失败且不上传。
4. 成功上传后，用户在 npm **Staged Packages** 找到 `avru@0.1.0-dev.1`，核对 dev 标签、来源及包内容，再使用本人 2FA 批准。上传成功不等于已发布；批准后回读 registry 和 `dev` tag 才能确认 `npx -y avru@dev` 可用。重复触发撞到已暂存/已发布版本时停止核查，不删除版本、不改 tag、不自动重传。
5. 首包已建立后，另行配置仅此包和专用工作流的 OIDC Trusted Publisher，然后撤销 npm 一次性 token、删除对应 GitHub secret。现有首次工作流没有 OIDC 写权限，不要把其文件误当成已获授权的 OIDC 流程。清理和信任设置须明确授权或用户自行完成。

该段记录 staging 方案建立时的范围；随后两次 CI 暂存均返回 E400，未获得成功 stage ID。首次 staging 会公开占位包，但候选内容要经 npm 2FA 批准后公开；审批前同一版本已占用，不能按普通“失败重试”发布第二份。公开包是运行文件，源码仓库保持私有，混淆不保证无法逆向。

官方依据（2026-11-07 核对）：[新包支持公告](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/)、[stage 命令/标签](https://docs.npmjs.com/cli/v11/commands/npm-stage/)、[token 创建界面](https://docs.npmjs.com/creating-and-viewing-access-tokens/)、[stage-only 权限边界](https://docs.npmjs.com/about-access-tokens/)。


## 一次性直接 CI 发布（0.1.0-dev.1）

用户已明确批准固定候选直接公开到 `dev`，无需 npm 人工审批。两次 staging 分别在运行 `42397893155`、`42400572399` 返回 `Version uniqueness check failed unexpectedly`，根因未确定，不能保证改走直接发布能够解决。不得自行重复上传、改包名、抬高版本或改为 latest。

工作流 `.github/workflows/npm-dev-publish.yml`（**Publish approved npm dev candidate**）仅手动 main 触发，确认立即公开后执行一次 `npm publish`。它仍使用固定源码 `2f87b5a7407b0ff266a8b28b73c87fbd48590fa9`、双平台成功运行 `42394455061`、artifact `13582611914`，tgz SHA-256 为 `aa76c1e620b0a817c79f1c82476aab6570d013f25b6641425679e51b43fe3b39`。不是当前 main 的新版本：包不含浏览器扩展，也不包含后续 Web/MCP/环境隔离进展；它只供早期 CLI 安装验证。已审查的第三方许可告知随原包发布，不重新打包或加入源码。校验器固定在 `1d05014768a12efba0bc249c2b4b5faf3ba8246e`，依赖安装与候选验证步骤没有 npm 写凭据。

维护者步骤：

1. 删除旧 `AVRU_NPM_STAGE_TOKEN`，撤销旧 npm token。旧 stage-only 凭据不能用于直接发布。
2. 在 npm 本人账户创建短期 granular token：Packages and scopes 选择 **Read and write (publish and stage)**，勾选 **Bypass two-factor authentication**；用户已确认首次未创建 unscoped 包所需的 **All Packages** 范围。Organizations 保持 No access，有效期一天。不填写与 GitHub 托管 runner 不匹配的家庭 IP 限制。此 token 可直接影响账户其他包，不能把本工作流限 avru 当成 token 自身只限 avru；只允许本次使用并立即撤销。
3. 用户将值直接保存到私有仓库 GitHub Actions repository secret `AVRU_NPM_PUBLISH_TOKEN`，不发到聊天，不存普通变量或文件。助手仅核对名称存在，不读取值。凭据只注入身份核对/发布步骤，临时 npmrc 使用受限文件模式并通过 EXIT trap 删除。
4. 手动运行上述 workflow，勾选立即公开确认。它核对账户 `baiyihuan`、精确包/hash、成功的双平台验证和文件白名单，明确指定 `--tag dev --access public --ignore-scripts --provenance=false`，不运行 npm 维护者审批，也不配置 OIDC 或更改仓库可见性。
5. 发布后读取 dev/version/shasum，再从 registry 执行固定版 CLI 的 `--version`；不执行安装或开机启动。若后验检查失败，先只读检查 registry，不重跑发布步骤；失败不代表一定没有发布。完整安装功能仍以产品实际边界为准。
6. 无论成功失败，删除 `AVRU_NPM_PUBLISH_TOKEN` 并撤销 npm token；GitHub 删除若触发 Confirm access，由维护者完成验证。凭据清理未回读成功不能称已清理。成功后再另行确认仅 `avru`、owner `bYiyLi`、repo `Avru`、专用 workflow 的 OIDC 信任配置，不沿用一次性全包凭据。

截至 2026-11-07，npm 官方允许 bypass-2FA granular token 直接发布，但该途径预计 2027-01 移除，故本方案不是长期凭据设计。标准非交互 GitHub CI 不提供等待本人浏览器 2FA 的保证；npm 11.21.2 的 `otplease` 非 TTY 会直接抛错。参见 [token 规则](https://docs.npmjs.com/about-access-tokens/)、[CLI 验证源码](https://github.com/npm/cli/blob/v11.21.2/lib/utils/auth.js)。本节流程存在不等于已公开发布；必须以本次 registry 回读与 CLI 检查为准。

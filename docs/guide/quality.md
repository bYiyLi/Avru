# 工程质量门禁

## 合同与范围

本文件拥有 Avru 工程门禁的阈值、命令及验证范围；产品验收仍由需求和设计定义。本轮按用户批准参考 KG OS commit `f85081f0cf700aea0c7d4e3c688bb82ce3560d42` 的 TypeScript 门禁适配，不复制其 Go/native runtime、Docker-only 交付或公开分发结构。

| 门禁       | 规则                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 格式与类型 | Prettier；所有实现包 tsc；strict type-coverage ≥99%，扩展独立项目检查                                                |
| 文件与函数 | JS/TS 文件有效行 ≤500，函数有效行 ≤90；TS 测试函数 ≤220；空行和注释不计                                              |
| 可维护性   | 嵌套 ≤4，参数 ≤4，语句 ≤40（TS 测试 ≤80），认知复杂度 ≤15                                                            |
| 类型安全   | strict type-aware ESLint、禁止显式 any、未处理 Promise、无效禁用注释；warnings=0                                     |
| 依赖边界   | 无循环/无法解析依赖；应用不互相导入；protocol 不导入应用/runner；runner 不导入应用；UI 不导入 runner；生产不导入测试 |
| 重复代码   | jscpd 重复率 0；最小 8 行/80 token；排除测试和生成文件                                                               |
| 单测覆盖率 | V8，每个生产源文件 statements/branches/functions/lines 均 ≥90%，包含未被测试导入的文件                               |
| 秘密扫描   | Secretlint 推荐规则；只扫描工作树，不是完整 Git 历史扫描，不保证识别所有秘密                                         |
| 依赖安全   | pnpm audit：high/critical 阻断，moderate 仍需记录评估；网络失败不可视作安全通过                                      |
| 门禁自检   | 真实临时负向样本，校验超限、any/Promise、循环/越界、生产导入测试、未测源码、合成秘密、重复代码均被拒绝，结束删除样本 |

没有设定“每目录最多 N 个文件”：参考实现未发现此阈值，目录按职责拆分，不能把臆测数字写成现有规范。本轮也未实现 Knip、许可证白名单或拼写检查，不宣称完整复制 KG OS。

## 源码与排除边界

覆盖 apps 各应用 src、packages 各包 src，以及 WXT 扩展根下 TS/TSX（含 utils/components/entrypoints）。扩展仅排除 wxt.config.ts、tests、node_modules、.wxt、.output；全局排除类型声明。三个精确薄入口 apps/cli/src/main.ts、apps/daemon/src/main.ts、apps/web/src/main.tsx 不计单测覆盖率：其中不得积累业务逻辑，它们的真实启动、关闭和故障恢复须由集成验收补齐。

生成产物 dist/.wxt/.output/artifacts（安装 bundle）、依赖 node_modules、coverage 和测试报告不计源码质量；具体 glob 以配置为准。新增源码不得通过扩大排除范围逃避门禁。扩展连接与配对 TypeScript 业务源码纳入独立类型覆盖及逐模块测试覆盖；覆盖率不代表已完成网页控制。

## 运行与 CI

`pnpm check` 顺序执行格式、类型、ESLint、类型覆盖、依赖边界、重复、秘密、单测覆盖和构建。`pnpm test:gates` 独立执行门禁负向测试；勿与其它检查并行运行，以免临时样本干扰。`pnpm check:audit` 需要 registry 网络。`pnpm validate` 加上上述负向、安全和 Playwright E2E。

Actions 的 Windows/macOS 矩阵执行 check 和 test:gates；两平台均跑 Chromium E2E，独立 macOS audit job 检查依赖。仅提交 workflow 不等于 CI 已通过；本轮未修改 GitHub 分支保护/required checks，现有 CI 不能宣称已强制禁止合并。

## 风险与证据入口

基础门禁执行证据见[工程基础阶段](../development/phases/00-engineering-foundation.md)，后续连接与安装回归见[开发总览](../development/README.md)。生产能力不以覆盖率代替。

## minimatch 中危复核（2026-11-07）

依据 [GitHub 官方公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)（更新于 2026-11-04，CVE-2026-118764）：攻击者可控 glob 且 optimizationLevel ≥2 时，预处理可放大 globParts，继而造成 CPU/内存消耗；受影响范围 ≥7.0.0 <11.0.1，首个修复版 11.0.1。不能仅凭开发依赖身份宣称不可利用，也不能把 audit 高危门禁通过写成零漏洞。

本次读取 npm registry 的 latest 清单：ESLint 10.14.0（^10.2.6）、@eslint/config-array 0.23.5（^10.2.4）、typescript-eslint/@typescript-eslint/typescript-estree 8.72.1（后者 ^10.2.2）、SonarJS 4.2.2（^10.2.6）、type-coverage-core 2.31.2（6 || 7 || 8 || 9 || 10）。已安装版本就是这些 latest；现有多条上游约束不能正常解析修复的 11.x，未找到通过常规兼容升级全部消除告警的路径。

实际执行 pnpm why -r minimatch：仅 10.2.6，位于这些开发工具链。pnpm audit --prod --json 返回 0 公告；完整 audit 仍保留 1 moderate。前者是当次 registry 扫描结论，不是生产安全保证；没有运行拒绝服务攻击或穷尽所有间接调用。

当前处理：不加入 audit 忽略、不降低门禁、不强行跨主版本 override、不引入自维护补丁。现有门禁使用仓库受审查的固定 glob，不把外部用户输入传入这些工具；未来若引入用户提供的 glob 或以工具处理不可信配置，须重新评估。后续升级条件：上游发布支持修复版的依赖，或可验证的兼容安全回补；更新锁文件后重跑 check、7 类负向门禁、完整及生产 audit、Windows/macOS E2E。未经这些证据不标记为已修复。

CLI 的 `main.ts` 和 `background.ts` 仅为薄入口；安装事务、平台文件、引导状态机和 runtime 业务全部纳入逐文件覆盖。`artifacts/` 为可重建安装产物，不计入源码检查，不允许放手写源代码。

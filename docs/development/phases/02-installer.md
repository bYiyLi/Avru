# Clack 安装生命周期阶段

## 目标、输入与范围

落实 R-11–R-14、D-08/D-09 及用户确认的 Clack 引导。依赖已完成的本机连接/管理入口；设计真源见[安装生命周期](../../design/installation.md)，命令操作见[安装指南](../../guide/installation.md)。不包含 npm 发布、扩展自动安装、远程 MCP/OAuth、QuickJS 或用户电脑安装。

## 工作与验收

| 工作/交付物                         | 验收入口与完成条件                                          |
| ----------------------------------- | ----------------------------------------------------------- |
| Clack 初装/修复/升级与取消/失败     | CLI 流程测试；取消与部分失败不得报成功                      |
| 稳定 payload、launcher、active 指针 | 实际 bundle 安装，移除临时包后仍可恢复；失败还原旧版本      |
| 认证启动/关闭与自定义目录           | 生命周期集成测试，旧 PID 不能成为杀进程依据                 |
| 用户登录启动适配                    | 平台文件/路径测试与 CI；真实 OS 登录触发需另行实测          |
| 卸载保留/删除配对数据               | 实际 bundle 用例；不删除自建文件、未知归属或符号链接        |
| 回归                                | 全量 check、7 项负向门禁、audit、Windows/macOS Chromium E2E |

## 评审、修复与状态

代码及跨平台 bundle 子集已实现并通过下述检查。生产发行和真实 OS 注销登录未完成，不能据此宣布完整 R-11–R-14 通过。保留原验收条件，不用平台文件测试代替真实登录。

## 验证与交付状态

`pnpm package:cli` 构建自包含 CLI、launcher、daemon payload 与 Web，输出 `artifacts/avru`。`pnpm test:installer` 在临时数据目录运行实际 bundle；测试自启动文件只写临时 home，不改 CI 宿主的真实登录入口。正式 npm 发布、真实 OS 注销登录、用户电脑安装另行验收。

2026-11-07 云端 Linux 的完整 `pnpm check` 通过：100 项测试，逐模块覆盖维持 ≥90%；7 项门禁反例通过，audit 仍有既有 1 个 moderate 开发依赖告警。真实 bundle 生命周期测试通过。提交 `74d610ae46c1a1ca7ab0afc94f90e5d195c74def` 的 [CI 42382474135](https://github.com/bYiyLi/Avru/actions/runs/42382474135) 已通过 Windows、macOS 和 audit 三个 job，已读取步骤与日志。两平台验证真实 bundle 安装、修复、保留数据、删除临时包后从自定义目录 launcher 恢复、卸载，以及既有真实 Chromium 双配置配对/重连 E2E。Windows 跳过不稳定权限前提的符号链接创建测试，其他安全用例继续执行。首次 Windows 验证发现普通文件被当父目录时系统返回 ENOENT 而非 ENOTDIR，已改为显式父目录类型校验后重跑通过；没有降低质量阈值。CI 未实际注销/登录或注册宿主自启动项，因此 OS 登录触发仍需单独验收。

## 0.1.0-dev.1 私有候选发行补充

用户授权本地构建压缩、小范围首方混淆、测试包及 CI 发行流程。交付对象限定私有 Actions artifact，不公开 npm、不改仓库可见性、不配置用户机器。

验收：版本为 0.1.0-dev.1；包白名单与泄漏负例通过；保留完整所打包第三方许可；混淆流程本地断网实测；Win/mac 现有完整门禁、实际 tgz 安装回归与 Chromium E2E 均通过后才上传。源码 SHA、run、artifact/hash 分别回读。真实 OS 登录自启动、扩展本地安装、MCP及runner不计本次已完成。

本地准备已增加受控构建、负向产物测试、许可收集与双平台私有工作流；CI 实际结果须在交付时按目标 SHA 核对，不能由本段替代。使用方法见[发行指南](../../guide/release.md)。

## 本地扩展交付继续实施

范围：将预构建的真实扩展加入开发包，按环境安装到稳定目录；失败回滚、不采用 npx 缓存、受保护 API 提供真实准备目录，配套当前浏览器加载步骤。旧安全配对暂保留，不宣称无短码已完成。

验收：真实 bundle 含清单、background、popup、consent 与依赖许可；错误 channel/未知目录拒绝覆盖；首次与更新失败恢复；重跑及删除缓存不影响稳定文件；UI区分文件已准备与浏览器已安装、运行版本；Windows/macOS CI 从稳定目录实际加载打包扩展。卸载不擅自删除浏览器记录，保留目录边界须明确告知。

当前工作树基于 main `3a4f3efb656253e9271e80c847ee43ed320b1305`，实现与本地验证进行中，已整合 i18n main `d6d39786bdaa96c86ddc908abd1c35f1cc14df2f`，Web 引导使用统一资源键。本地完整 `pnpm check` 已通过（185测试、逐文件覆盖门禁、类型/格式/lint/依赖/重复/秘密检查与构建），生产模块专项覆盖通过，真实 bundle 安装/重跑/缓存删除及 API 目录核验通过，发行3项负测通过。audit high/critical门禁通过，保留既有1 moderate告警；最终集成回归、提交和 Windows/macOS CI 尚待完成，不是已发布版本。许可证补全来自 WXT 官方仓库固定提交 `abfdd7fe1c4faf0f72658f8a860d792dc9692a6c`，核对 wxt@0.21.5 与 @wxt-dev/browser@0.3.7 包清单及 MIT 正文；未绕过缺许可门禁。

最终本地集成验证（仍未发布）：在合入上述 i18n 后 `pnpm check` 通过，203 测试，覆盖 statements 98.98%、branches 97.69%、functions 98.92%、lines 99.41%，逐文件门禁通过。真实 bundle 安装/重跑/缓存删除与版本目录 API 测试及3项发行测试通过；扩展 en/zh_CN/zh_TW 清单资源纳入必需产物，缺失默认语言资源的负测通过。独立只读复核确认新 Install 页使用统一中英键、命名插值，失联清空目录，未发现该范围阻断问题。Linux 本地 Chromium 实测被宿主 `socket() failed: Operation not permitted` 阻止启动，未绕过；实际从稳定目录加载及完整 Web 流程仍待当前提交的 Windows/macOS CI，不把此失败说成浏览器验收成功。

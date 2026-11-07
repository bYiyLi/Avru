# 05 dev/prod 同机隔离

## 范围与输入

落实R-22和[环境合同](../../design/environments.md)，不扩展为发布npm、自动安装浏览器扩展或公网OAuth接入。保留OAuth阶段已实现能力。

## 交付与验收

- CLI：分环境根/marker、自启动、runtime身份；双根并发安装和目标卸载不触及另一根；旧非空根拒绝自动采用。
- daemon：分环境数据库与进程、Origin/channel/token/管理key负向隔离；OAuth配置channel绑定。
- extension：两个固定ID/名称、各自固定端口、channel凭据，旧凭据拒绝。
- 设计与指南：新根、旧安装恢复、未实现分发和真实OS登录限制。

## 当前证据

以main `1c4b0440477286810403e2e28775497d4761450e`整合OAuth。云端本次工作树34个测试文件171测试通过，逐生产文件覆盖门禁通过（statements98.98%、branches97.79%、functions98.79%、lines99.33%）。实际bundle安装/修复/缓存删除后启动/卸载1项、发行负向3项、门禁负向7项通过。格式、类型、ESLint、边界、重复、Secretlint与双扩展构建通过。

实现提交`c13cdece12cb2e7416e7a3332f36af2966709755`的[CI 42400609838](https://github.com/bYiyLi/Avru/actions/runs/42400609838)成功：macOS 171测试通过，Windows169通过、2个既有POSIX专属用例跳过；两平台均通过现有完整门禁、7类负向门禁、实际bundle生命周期、dev/prod扩展构建及3项真实Chromium E2E（含OAuth弹窗）。audit无high/critical，既有minimatch moderate风险保留，不称零漏洞。

云端Chromium因宿主`socket() failed: Operation not permitted`未能启动，本地3个E2E未通过；上述真实浏览器证据来自CI。首轮Windows新CLI测试路径写死、第二轮symlink跳过导致模块覆盖率89.65%均已修正：使用平台路径及Windows可执行junction反例，未降低门槛。独立审阅补了数据库/sidecar/runtime/log符号链接拒绝，CLI日志在打开前拒绝链接。

本轮隔离代码与设计切片通过上述验收，GitHub PR见[#3](https://github.com/bYiyLi/Avru/pull/3)。双环境负向测试是两个独立服务实例和双根安装，不冒充两个已发布包的真实OS生命周期验收。未发布npm、未操作用户电脑、未修改实际登录项；正式发行、双已发布包同机安装、OS注销登录、品牌浏览器全矩阵、外部issuer映射及随包扩展分发仍未验收或未实现。

## 完成门槛

完整check、installer/release、门禁负向样本、audit及E2E；GitHub变更回读和Win/Mac CI通过。OS登录和真正发布的双环境包并存另行验收，不在本轮伪造通过。

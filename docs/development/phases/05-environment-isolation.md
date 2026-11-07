# 05 dev/prod 同机隔离

## 范围与输入

落实R-22和[环境合同](../../design/environments.md)，不扩展为发布npm、自动安装浏览器扩展或公网OAuth接入。保留OAuth阶段已实现能力。

## 交付与验收

- CLI：分环境根/marker、自启动、runtime身份；双根并发安装和目标卸载不触及另一根；旧非空根拒绝自动采用。
- daemon：分环境数据库与进程、Origin/channel/token/管理key负向隔离；OAuth配置channel绑定。
- extension：两个固定ID/名称、各自固定端口、channel凭据，旧凭据拒绝。
- 设计与指南：新根、旧安装恢复、未实现分发和真实OS登录限制。

## 当前证据

以main `1c4b0440477286810403e2e28775497d4761450e`整合OAuth。云端本次工作树34个测试文件169测试通过，逐生产文件覆盖门禁通过（statements98.97%、branches97.78%、functions98.78%、lines99.33%）。实际bundle安装/修复/缓存删除后启动/卸载1项、发行负向3项、门禁负向7项通过。格式、类型、ESLint、边界、重复、Secretlint与双扩展构建通过。

云端Chromium因宿主`socket() failed: Operation not permitted`未能启动，3个E2E不能标为通过；转由当前提交Win/mac CI验收。提交与精确提交CI待补；audit尚待结果。没有发布npm、操作用户电脑或修改真实登录项。

## 完成门槛

完整check、installer/release、门禁负向样本、audit及E2E；GitHub变更回读和Win/Mac CI通过。OS登录和真正发布的双环境包并存另行验收，不在本轮伪造通过。

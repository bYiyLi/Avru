# 导入远程连接配置

此功能负责本机配置与连接管理。当前开发批次只通过替身进程和模拟服务验收，官方 FRPC 程序、公网 FRPS 与真实 ChatGPT 尚未联调。代理注册状态不等于公网或 ChatGPT 验收通过。

安装包已携带 Windows/macOS x64/ARM64 的 FRPC；用户无需安装、启动或维护它。由未来选定的入口运营者提供 JSON 连接文件，在本机管理页“远程连接”导入。Avru 自动保存、应用并维护连接，登录后随 Avru 恢复；移除配置后停止并清除本机保存的连接秘密。

文件格式为 `ConnectionBundleV1`，最大 256 KiB。以下仅描述字段，示例不能用于连接：

```json
{
  "schemaVersion": 1,
  "channel": "dev",
  "oauth": {
    "issuer": "https://your-device.example",
    "port": 43900,
    "clients": [
      {
        "id": "由目标客户端提供的精确 ID",
        "name": "客户端名称",
        "redirectUris": ["https://client.example/exact-callback"]
      }
    ]
  },
  "frp": {
    "serverAddr": "frps.example",
    "serverPort": 7000,
    "token": "由运营者写入文件的连接凭据",
    "serverCaPem": "CA 证书 PEM",
    "certificatePem": "与 issuer 域名匹配的证书 PEM",
    "privateKeyPem": "与证书匹配的私钥 PEM"
  }
}
```

文件中包含秘密，只应在目标电脑导入，不要发到聊天、公开仓库或日志中。界面不显示其秘密字段。dev/prod 使用独立文件、issuer、端口及权限，不接受任意命令、程序路径或 FRPC 配置。真实 ChatGPT 的客户端 ID 与回调必须来自当前官方配置界面，不能使用示例值。

“已随安装包准备”表示组件文件存在且摘要匹配；“正在连接”表示组件运行或等待连接；“代理已注册”来自本机组件的管理接口。公网可达性及 ChatGPT 验证单独显示。本轮不要求用户进行真实 FRPC 测试。

结果未知时保留原配置与进程描述符，不反复导入或修改 PID。先检查本机连接活动与系统状态；重新安装不会自动清除配置。卸载默认保留配置，明确删除数据时才清除 Avru 自有秘密文件；用户提供的原始文件由用户管理。

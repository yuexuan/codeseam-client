# 运行环境真机验证

日期：2026-11-12（Asia/Singapore）。

- 删除运行环境及 Hyper-V 的前端演示服务与只验证该演示服务的测试。运行环境固定使用 nativeRuntime；浏览器访问原运行环境预览链接显示桌面应用提示。
- npm run check、npm test、cargo test、npm run bindings:check 通过；运行环境检测、设置及 Hyper-V 的 PowerShell 回归测试通过。
- 构建 NSIS 成功，以 /S /UPDATE 更新当前用户安装，安装程序退出码 0。已从 C:\Users\Administrator\AppData\Local\CodeSeam\codeseam.exe 启动应用，本机 operations.jsonl 记录 read_startup、read_nodes、scan_environment 成功。
- installed_runtime_probe 调用生产 Rust 检测、已保存真实节点及 Windows PowerShell，真实出口地区为新加坡。时区、语言、时间服务、DNS、出口均匹配；2 个接口启用 IPv6，因此 IPv6 为 Pending、blocking=true，整体 ready=false、confirmed=false。
- Hyper-V 生产脚本返回真实系统状态：Professional 版本；CPU 虚拟化、SLAT、固件状态无法确认；当前权限无法读取 Hyper-V 功能；系统存在待重启标记。没有使用演示成功结果。
- 桌面截图首次返回 FrameArrived timed out，刷新窗口选择并重试后返回 window capture timed out，停止界面自动化。因此未完成桌面按钮点击及系统设置写入、UAC、恢复链路的真机验收；未修改 DNS、IPv6、时区或时间服务。

复测命令：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml installed_runtime_probe -- --ignored --nocapture
```


## 2026-11-15 · 自动 Guest 安装修复

- 按用户要求撤掉手动安装及刷新按钮，保留原双栏任务页和底部导航。任务百分比、行状态和目标列表读取真实 Guest 结果；初始化就绪后下一步可用。
- Windows 安装改为 DISM 离线部署独立 GPT/EFI VHDX、BCDBoot、无人值守 OOBE 与随机独立本地用户。凭据由 CurrentUser DPAPI 保护，通信使用 PowerShell Direct。原候选机不能正常关闭时保存其 RAM/磁盘状态并保留，未强制断电或覆盖旧磁盘。
- 后台任务由 Windows Task Scheduler 承载，读进度不占用全局操作锁；初始化请求等待锁。已修复后台脚本错误复用 initialize 请求、Windows 版本字符串误判、远程字符串附带元数据的问题。
- 真机：原 VM ee5486db-cad8-4762-8f1c-d2a79dbf46fd 已保存；新候选 VM 5a439035-572b-4b56-9d5d-477c03996bd2 完成无人值守 Windows 安装，Setup/OOBE 标志均为 0。生成候选基线及 CodeSeam-Initialized 检查点，guest-progress.json 于 13:34:48（Asia/Singapore）记录 ready=true、progress=100。
- Guest 内已实测 DNS 解析及第二步出口一致；Guest IPv6 绑定关闭，UDP 阻断规则在 ActiveStore 中启用。语言/时区保留镜像默认 en-US / Pacific Standard Time，未从国家推断语言或更改宿主机。
- 最终重复探测发现 api.ipify.org 间歇性 TLS 断连，不能把一次 100% 结果等同于持续网络稳定性。源码已改用节点检测既有的两个 Cloudflare trace 接口；该最后调整尚未重新真机验收。
- 进一步包含防火墙规则调整的命令被自动审批以 blocked by policy 拒绝；随后仅只读的提权复验也被同样拒绝。未绕过拒绝、未应用该防火墙调整。源码为后续安装保留 DHCP 端口，当前候选仍是原已验证规则。
- 新增 PowerShell 回归：保存状态失败不碰磁盘、中断磁盘禁止覆盖、已部署候选续接不重分区。npm run check、npm test、cargo check 和上述回归通过。ignored 原生初始化入口验证通过；它只证明启动了任务，任务实际完成证据来自进度、Guest 探针与候选基线。

## 2026-11-15 Virtual 专用 Profile 真实接通

移除 prepare_browser 的 Virtual 未实现拦截。复用受管 Hyper-V 提权控制器，核对 Guest 初始化记录及所选节点，通过 VM ID 定位目标；支持启动 Off / Saved VM、恢复 Paused VM，最多等待 120 秒建立 PowerShell Direct。会话内复检 OOBE 和受管代理任务，再以 CodeSeam Guest 用户执行浏览器检测及 Profile 创建。Runtime ID 使用真实 VM ID，目录位于 Guest 用户 LocalAppData，重建不删除登录数据。

真实验证：当前候选 Guest 检测到 Microsoft Edge 92.0.902.67；Profile 位于 C:\Users\CodeSeam\AppData\Local\CodeSeam\Browser\edge\User Data。PowerShell 连续创建 / 恢复通过；Rust guest_browser_prepare_live 集成测试通过，验证 Virtual 结果、Profile 路径及创建时间稳定。Native Profile 数据保留测试、npm run check、cargo check 通过。桌面 dev watcher 已重启应用使用新代码。

边界：未主动关闭现有 Guest 来测试冷启动；Guest 无浏览器时仍明确报安装提示，不静默下载。现有 Edge 版本较旧，后续需处理官方升级。浏览器级探针、受管快捷方式仍未完成，不能据此放行最终验收。

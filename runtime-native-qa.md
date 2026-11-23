# 运行环境真机验证

## 2026-11-16 · 初始化自动关闭专用浏览器与阻断重试

- 初始化和确认验证前按完整 user-data-dir 精确定位专用 Profile 的浏览器。先请求正常关闭以落盘，仍存活时结束该 Profile 的后台进程，再等待旧启动器释放 browser.lock 后继续验证。保留 Profile、登录文件及其他 Profile 的浏览器；普通打开/打开验证不触发初始化关闭。
- 页面发生准备失败、探针失败或操作失败时，底部主按钮及参数区操作显示可点击的“重试”。点击后清除旧操作错误，重新准备；执行期间禁用按钮，成功恢复“下一步”。关闭焦点/网络恢复导致的自动重新准备，避免用户切换到验证浏览器时触发自动关闭。
- 新增关闭回归覆盖正常退出、强制清理残留、带空格和非引号参数、相近路径排除、权限失败、锁延迟释放、锁未释放及登录文件保留。前端 check/build、npm test、浏览器关闭/生命周期/版本/启动回归通过。
- 实机 guest_browser_reprepare_live 通过：现有 Guest 先准备并验证，打开专用验证浏览器，再次初始化自动关闭浏览器并继续到实测成功基线；Profile 路径与创建时间保持一致。

## 2026-11-16 · Guest 与浏览器时区跟随代理出口

- 根因是 Guest 初始化只读取并保留镜像时区，且浏览器探针只记录 Intl 时区，没有核对代理目标时区。新增共享的 Windows / IANA 目标解析；Guest 初始化、已就绪环境复用、继续及浏览器准备均按所选节点和已测出口校验并同步系统时区，无法确定目标时区时阻止继续。浏览器继承真实系统时区，探针实测不一致时不生成成功基线；普通启动也复检系统时区。
- 复用流程校验节点 ID 和实际出口绑定，保留现有 Guest 和登录 Profile。界面分别显示代理目标时区、浏览器实际时区，参数任务与下一步要求时区匹配。PowerShell Direct 返回的时区字符串显式去除远程元数据后再持久化。
- 实机测试 guest_timezone_sync_live 通过：现有 Guest 同步为 Singapore Standard Time，临时独立 Edge 通过真实 Intl API 返回 Asia/Singapore。测试 Profile 在验证后清理，未关闭原有用户浏览器；旧浏览器窗口需关闭重开以更新缓存。
- 前端检查与规则测试通过；Guest 时区、初始化会话、控制台、控制器、浏览器生命周期及启动分流回归通过。Rust 库测试 28 项通过；新增显式真机时区测试另行运行通过。

## 2026-11-16 · IP 验证入口与浏览器版本门禁

- 浏览器页“打开验证”新增 inspect 操作，使用受管 Profile、代理及可见浏览器打开 https://ip.net.coffee/claude/，供用户自行查看 IP 质量；完成页和桌面快捷方式继续打开 Claude。正常打开与 inspect 均无远程调试参数。
- Native / Guest 共用初始化逻辑，在创建 Profile 和网络探针前查询官方稳定版。项目要求浏览器主版本至少达到当前稳定版；落后时下载官方 MSI、校验发布者签名，Edge 额外校验官方 SHA256，执行无自动重启安装并重新读取实际版本。联网失败、安装失败、需重启或仍为旧版均阻止放行，不删除登录数据。此策略不等同于 Claude 官方最低支持版本声明。
- 已通过 npm check、npm test、版本/安装失败回归、浏览器启动 URL 分流、Profile 保留及生命周期回归、Guest 控制台和控制器回归。Rust 库测试串行执行 27 通过、13 个真机测试默认跳过；默认并行执行曾触发现有测试共享环境变量导致的 Claude 备份测试失败，串行重跑通过。全目标 cargo test / 绑定检查受到正在运行的 target/debug/codeseam.exe 文件占用影响，未关闭用户应用。
- 只读调用实际版本查询函数，已取得 Edge 与 Chrome 官方稳定版和安装包地址。此次未运行真实 MSI 升级，未完成升级后 Claude 登录实机验收；升级行为目前由模拟安装器回归验证。

## 2026-11-16 · 浏览器 38% 固定阻塞修复

- 原浏览器页将后五项任务硬编码为未完成，验证与下一步按钮永久禁用；后端只创建 Profile。现已接通受管启动、浏览器探针、候选基线与确认页，八项任务读取实际结果。下一步重新执行探针，成功保存已确认浏览器基线后才进入完成页；失败保留 Profile 并显示具体错误。
- Guest 复检已选节点绑定、受管代理任务、TUN、DNS、IPv6 和 UDP 防护，再以 CodeSeam 桌面用户运行完整浏览器。Edge 92 的旧 headless 实测未应用完整 Profile 的 WebRTC 设置，已改为完整浏览器后台探针。WebRTC 设置仅写入专用 Profile，原 Preferences 首次备份；能力、语言、时区与检测页面权限均读取真实值。
- Native 使用独立 Mihomo HTTP 代理、远程域名解析及本地解析限制，显式排除代理监听地址；节点配置使用 CurrentUser DPAPI 保存。当前普通宿主进程不能在任务计划根目录注册任务，Native 改为通过现有 Windows 桌面 Shell 的 COM 对象启动，以脱离短期检测作业。Guest 使用限权桌面用户计划任务，控制器返回后保留正常浏览器窗口。
- 探针在动态本地调试端口读取真实 HTTPS 出口及 WebRTC ICE 结果，核对所选节点 IP 后保存浏览器基线；正常 Claude 启动不带调试端口。权限结果明确标注其观测页面，不能视为 Claude 域名的权限结果。此次没有改动宿主机网络设置，也没有重建 Guest。
- 最终四项 Rust 真机测试全部通过：现有 Guest Profile 连续准备/复用、确认时复验并保存基线、Guest 正常浏览器在控制器结束后继续运行且不保留调试端口、独立 Native 测试 Profile 的真实代理出口及正常启动存活。启动测试仅关闭各自创建的测试窗口。浏览器生命周期回归覆盖失败复验不得沿用旧成功结果、登录哨兵保留、确认持久化和节点变化拒绝；已接入 verify、CI 和 Release。
- 前端 check/build、npm test、Profile 保留及 Guest 安装/桌面/会话/控制台/控制器回归通过；Rust 库测试 27 通过、13 个显式真机测试默认跳过，其中本次四项浏览器真机测试已另行全部通过；生成绑定比对通过。实际桌面点击仍返回 `coordinate input geometry is unavailable`，重新选择窗口后的截图返回 `window capture timed out: timed out waiting on channel`，因此不声称已完成真实按钮点击验收。Guest 仍为 Edge 92，Claude 官方登录页面兼容性及账户可用性尚未验收。
- 最终 NSIS 安装包：`src-tauri/target/release/bundle/nsis/CodeSeam_0.5.1_x64-setup.exe`，2026-11-16 13:03:11（Asia/Singapore），20,908,134 字节，SHA256 `D290558C1118ED05245315A0FC56D1DADC7DEE29EC53590B84C1EDB5B3CB0073`。开发版已由 watcher 更新；未自动安装该包。

## 2026-11-16 · 虚拟机窗口打开后下一步阻塞修复

- 现场截图显示 Guest 八项检查全部完成，但按钮停留在打开窗口。提权包装脚本使用 `Start-Process -Wait`，等待的是控制器及全部后代进程，包含持续打开的 VMConnect；临时结果文件已经写出 `ready=true`，调用仍未返回。
- 改为有期限地等待控制器自身退出。虚拟机控制台由当前交互用户的临时计划任务启动，脱离检测进程的作业对象；窗口出现后注销任务定义，保留窗口。已存在的同一 VM 窗口直接复用。
- 明确下一步放行条件：候选初始化完成、VM Running、PowerShell Direct 可连接、OOBE 已结束且 CodeSeam 用户的 Explorer 桌面存在、受管代理任务 Running，并在当前登录会话检测到以目标 VM ID 启动的 VMConnect 可见主窗口。前端核对 `ready` 和 `consoleOpened` 后执行原有下一步回调。窗口在 20 秒内未出现或启动失败时返回可重试错误。
- `guest-console.test.ps1` 覆盖真实目标窗口判定、已有窗口复用、后台检查不弹窗、桌面未就绪、错误 VM / 登录会话、窗口超时、启动失败和任务尚未执行。`guest-controller.test.ps1` 使用真实父子进程验证控制器返回时长期子进程仍存活。两者已接入 verify、CI 与 Release。
- 显式真机脚本 `guest-console-live.test.ps1` 返回 `ready=true / consoleOpened=true / Running`，约 10.93 秒，控制台 PID 16336 在控制器返回后仍存活。Rust `guest_console_ready_live` 调用应用实际 `execute` 及受管进程链，约 6.86 秒通过，同一窗口在作业对象释放后继续运行。
- 前端 check / build、npm test、Guest 安装 / 桌面 / 会话 / 控制台 / 控制器回归通过。Rust 库测试 27 通过、9 个显式真机测试跳过（之后新增的控制台真机测试已单独通过）。
- 桌面辅助工具可读到应用无障碍树，但点击返回 `coordinate input geometry is unavailable`；刷新窗口选择后的截图依次返回 `FrameArrived timed out` 和 `window capture timed out`，停止 UI 自动化。未声称已经完成真实界面从第 3 步到第 4 步的点击验收。
- 修复安装包构建成功：`src-tauri/target/release/bundle/nsis/CodeSeam_0.5.1_x64-setup.exe`，生成时间 12:17:59（Asia/Singapore），SHA256 `CC6CB5C7B8C3757B0609E305364DFE28DE4C6C105930B2B2E7FF8F58946ACFC7`。构建时为子进程使用 Windows PowerShell 5.1 的系统模块路径，避免继承 PowerShell 7 模块路径导致 `Get-FileHash` 无法解析。

## 2026-11-16 · 重装后 Guest 会话返回值修复

- 现场 `guest-error.log` 确认初始化停在 12%：桌面检查已通过，但读取 Guest 时区时 `Invoke-Command -Session` 拒绝了包含 Null 的会话集合。
- 原因是 `Set-GuestDesktopAccount` 的远程 ADSI 调用会输出显式 Null；PowerShell 把这些输出与 `Install-GuestWindows` 返回的 PSSession 一并收集。已丢弃账户配置、启动 VM 和 OOBE 恢复的副作用输出，并在缺失会话时阻止报告 Windows 步骤完成。
- 新增 `guest-session.test.ps1`，修复前复现返回 3 个元素，修复后确认只返回单一会话、时区读取成功、异常时释放会话，以及缺失会话不能误报完成。已接入本地 verify、CI 与 Release 检查；Guest 安装、桌面和控制台回归通过。
- 直接用修复后的生产控制脚本续接现有 VM `abac1c2a-223f-4aeb-aa93-45bfefb9c562`，未重建或重装 Windows。2026-11-16 11:50:46（Asia/Singapore）进度为 `100 / ready=true`，8 项全部 satisfied，生成候选基线与恢复检查点；随后 `ensure_ready` 再次实际连接 Guest，返回 `ready=true / Running`。
- Guest 时区 / 语言为 `Pacific Standard Time / en-US`，受管代理、DNS UDP/TCP、出口一致性、IPv6 与 UDP 策略均通过初始化检查。该结果是本次检查的证据，不代表持续网络稳定性。
- `npm run check`、`npm test` 通过。Rust 库测试以 `--test-threads=1` 运行，27 通过、9 个显式真机测试跳过；默认并发运行暴露了现有测试共享进程环境变量的竞态，未在本次会话修复中扩展修改范围。
- NSIS 修复安装包构建成功：`src-tauri/target/release/bundle/nsis/CodeSeam_0.5.1_x64-setup.exe`，生成时间 11:53:26（Asia/Singapore），SHA256 为 `214A984040C4D817EB87852837023C22E7BD0CE0E22A46BC8EF8E080A30F03DE`。
- 绑定生成集成测试及与已提交 TypeScript 的比对通过；使用 `cargo test --release --test bindings export_bindings`，避免正在运行的开发版占用 `target/debug/codeseam.exe`。

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

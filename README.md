# CodeSeam

Windows 优先的独立本地桌面应用。当前已交付环境预检、节点与代理及本机运行环境选择确认：读取本机系统、Claude 应用、网络与可选运行能力，识别旧受管备份，按明确确认执行已有备份恢复。

不需要 CodeSeam 登录、业务服务端、激活或计费。Claude 官方登录由用户在官方应用完成。必要联网能力按产品后续阶段接入；纯本地不等于完全离线。

## 启动应用

从源码启动桌面应用需要 Windows 10/11 64 位、Node.js 22、Rust stable、Visual Studio C++ Build Tools 与 WebView2。

首次在本机运行时，在项目根目录安装依赖：

```powershell
npm ci
```

然后启动 Tauri 桌面开发版：

```powershell
npm run tauri dev
```

后续启动时直接运行 `npm run tauri dev` 即可。Tauri 会自动启动前端开发服务器；若当前项目已在 1420 端口运行 Vite，则验证项目路径后直接复用，不会重复占用端口。其他项目或程序占用该端口时仍会明确报错。如果 Mihomo 尚未准备好，也会自动下载并校验所需文件，因此首次启动需要联网。

只预览前端界面（不启动桌面应用）时运行 `npm run dev`，然后打开 `http://127.0.0.1:1420/?preview=default`。该地址仅在开发模式且显式携带 `preview` 参数时显示固定演示场景；普通浏览器无该参数时会提示需要桌面运行，正式包不会回退到模拟成功。

已有正式环境时，启动先进入准备页：恢复当前 Runtime → 复验节点出口、DNS 和专用浏览器配置 → 读取工作台最新状态。Virtual 按正式基线的 VM ID 启动关闭或保存的虚拟机、恢复暂停的虚拟机，已运行时直接复用；等待 Windows 桌面和受管网络就绪，不重建 Guest、不修改正式基线。未完成的节点修复和节点基线差异在连接检查阶段报告，不再阻止恢复虚拟机，也不会被标为虚拟机启动失败；节点修复记录仍须完成应用后才能解除。成功后自动进入工作台；失败保留当前步骤、错误和重试入口，Virtual 还可打开虚拟机窗口。首次使用和未完成的环境切换仍进入原有初始化流程。

启动失败页的“编辑节点与代理”使用独立弹窗，与初始化共享 NodeEditor。日常工作区侧栏的“节点与代理”进入独立管理页，复用公共外壳、页头和面板，提供 Clash 导入 / 通用代理 Tab、SOCKS5 / HTTP / HTTPS 及可选认证、单节点 / 全部测速和删除。日常切换只接受已通过真实出口检测的同国家节点，前后端均检查；当前节点不可直接删除。切换会备份历史记录，关闭专用浏览器，在当前 Runtime 应用节点并重新验证出口、时区及浏览器，通过后更新正式基线；失败保留错误和重试入口。Virtual 复用现有 Guest 和代理内核，替换节点提供文件，将代理出口绑定到真实默认网关的网卡，并恢复重建 TUN 的 DNS 与 IPv6 策略。出口失败恢复旧提供文件和代理配置；中断或后续验收失败保留修复标记，重开后仍可继续编辑和应用。提权控制器保留实际 Guest 错误，避免只显示退出码。内核栏读取当前版本，并按需查询 Mihomo 官方最新稳定版；内核目前随 CodeSeam 安装包升级，不支持独立热升级。日常界面演示：`?preview=nodes-final&step=workbench&page=nodes`；切换失败演示：`?preview=nodes-switch-error&step=workbench&page=nodes`。

打开 VMConnect 前，按主屏幕实际工作区自动计算窗口分辨率，保存该 VM 的增强会话显示设置；默认窗口化，保留已有全屏、多屏及设备共享偏好。已有同一 VM 的窗口会恢复显示并请求前置，保留窗口大小；检测到进程或窗口句柄不再直接视为打开成功，必须确认窗口已显示且未最小化。更新的显示配置从下次新建连接生效。启动检查页复用 WindowShell、WizardHeader、Surface、CheckRow、StatusLabel 和 Button，直接使用公共主题变量。

启动页开发演示：`?preview=startup-slow&step=workbench&virtual`；失败后重试成功：`?preview=startup-retry&step=workbench&virtual`；持续失败：`?preview=startup-error&step=workbench&virtual`。节点修复成功：`?preview=node-failure&step=workbench&virtual`；节点应用失败并保留编辑器：`?preview=node-repair-error&step=workbench&virtual`。这些场景只模拟界面，不代表真实虚拟机启动或持续 Guardian 已验收。

## 开发与验证

```powershell
npm run check
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run bindings:check
npm run tauri -- build --bundles nsis
```

运行环境检测仅在桌面应用中使用真实 Windows 接口，不再提供 mock 数据。原浏览器链接 `http://127.0.0.1:1420/?preview=default&step=runtime` 显示桌面运行提示。开发使用 `npm run tauri dev`；安装包测试使用 `npm run tauri -- build --bundles nsis` 生成的安装程序，安装后完成真实节点出口测试，再进入运行环境步骤。本机运行按当前节点目标自动检测；出口、时区、语言、DNS、IPv6 与时间服务全部匹配后自动解锁继续，继续时后端再次复检并保存所选 Runtime。时区与 DNS 在应用内选择方案后一键应用，IPv6 一键关闭全部可配置网卡，时间服务可一键开启；复用 UAC 辅助进程、DPAPI 原值备份与冲突恢复，完成后自动读取结果。系统语言仍使用 Windows 语言设置。未实测路径保持待验证。

已保存真实节点的本机只读复测：`cargo test --manifest-path src-tauri/Cargo.toml installed_runtime_probe -- --ignored --nocapture`。此测试调用生产运行环境检测和真实节点出口复测，不注入节点或 Windows 数据，不应用系统设置。没有已选择且测试成功的节点时会明确失败。常规自动化测试仍保留隔离的测试输入。

开发场景：default、partial、failure、refresh-failure、interrupted、recovery。生产 App 由原生接口读取真实 Windows 事实，读写检查点；不在预检中修改网络、安装或启动 Claude。

## 当前范围

- 单应用根目录：src、src-tauri、docs、scripts。旧云端与模型中转实现已退出活动源码与依赖。
- 六阶段导航已建立，环境预检、节点导入、运行环境选择、本机确认、Claude 配置清理与恢复、专用浏览器验证及确认页已实现。顺序为预检 → 节点与代理 → 运行环境 → Claude 应用 → 浏览器 → 确认完成。Claude 官方登录由用户完成。
- 浏览器步骤先查询 Edge / Chrome 官方稳定版；主版本落后时下载官方 MSI，验证发布者签名（Edge 同时校验官方 SHA256），升级后重新读取实际版本。CodeSeam 要求至少当前稳定版主版本，这是项目的版本新鲜度策略，不代表 Claude 官方最低版本承诺；联网校对或升级失败均不放行。复用当前 Native / Guest 的独立 Profile，生成桌面受管入口，使用完整浏览器验证 HTTPS 出口、WebRTC，并记录实际语言、时区和能力。Native 使用独立本地 HTTP 代理及远程解析；Guest 复检现有 TUN、DNS、IPv6 和 UDP 策略。“打开验证”使用专用浏览器访问 https://ip.net.coffee/claude/，由用户查看 IP 质量；完成页与桌面快捷方式打开 Claude。确认时重新验证并保存浏览器基线；失败显示具体原因，保留登录数据。初始化及确认时自动关闭占用专用 Profile 的浏览器，等待旧启动器释放锁后继续；无法恢复时主按钮显示“重试”。
- 支持 Clash YAML、Base64 URI 订阅和 SS/VMess/VLESS/Trojan；HTTP(S) 地址下载为订阅内容，Mihomo provider API 校验后导入，按连接配置去重。
- Mihomo v1.19.34 随包提供，按需启动并自动退出；四路并发检测通过 delay API 和节点独立监听端口读取 Cloudflare trace 的真实出口 IP、国家/地区。失败不生成位置。
- 节点面板固定高度，列表内部滚动；开发预览不获取订阅、不模拟订阅成功。
- 已安装、已检测、已验证、未知与可选分开；浏览器/应用存在不代表网络路径已验证。
- Guest 时区在初始化及复用时按所选代理的已测出口同步；浏览器继承真实系统时区，验证实际 IANA 时区与目标一致后才放行。无法解析目标、系统设置失败或浏览器仍缓存旧时区均阻止完成；保留登录 Profile，初始化会自动关闭专用浏览器以刷新时区；遇到阻断可点击重试。
- 旧 CLI、DNS、IPv6、时区、时间服务备份恢复有确认与冲突检查。缺少可信原值/归属的旧 Desktop 与插件配置明确要求人工核对，不猜测恢复，不删除用户登录或项目。
- 关闭初始化窗口即退出；重开重新读取事实，上次 scanning 记录识别为中断；不生成假的正式基线。

## 构建与打包

Windows CI 在检查、Rust 测试与绑定校验通过后构建 NSIS 安装包并上传 artifact；v* 标签触发 GitHub Release。Mihomo 下载固定版本并校验 SHA256，二进制与本地 docs 不进入 Git。Mihomo 为 GPL-3.0，发行包附带许可证及对应源码链接。

原桌面 Git 历史与远程保留。旧源码及服务端移出活动工程归档，位置见实施记录。第三方来源与许可保留；不为上游同步保留平行 UI。旧历史测试不代表当前网络保护或后续六步验收。

# CodeSeam

Windows 优先的独立本地桌面应用。当前交付为环境预检首稿：读取本机系统、Claude 应用、网络与可选运行能力，识别旧受管备份，按明确确认执行已有备份恢复。

不需要 CodeSeam 登录、业务服务端、激活或计费。Claude 官方登录由用户在官方应用完成。必要联网能力按产品后续阶段接入；纯本地不等于完全离线。

## 开发与验证

Windows 10/11 64 位，Node.js 22、Rust stable、Visual Studio C++ Build Tools 与 WebView2。

```powershell
npm ci
pwsh -File scripts/prepare-mihomo.ps1
npm run tauri dev
npm run check
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run bindings:check
npm run tauri -- build --bundles nsis
```

前端界面预览：`npm run dev`，打开 `http://127.0.0.1:1420/?preview=default`。仅开发模式且显式携带 preview 参数时使用固定演示场景。普通浏览器无该参数时说明需桌面运行；正式包不存在模拟成功回退。

开发场景：default、partial、failure、refresh-failure、interrupted、recovery。生产 App 由原生接口读取真实 Windows 事实，读写检查点；不在预检中修改网络、安装或启动 Claude。

## 当前范围

- 单应用根目录：src、src-tauri、docs、scripts。旧云端与模型中转实现已退出活动源码与依赖。
- 六阶段导航已建立，环境预检与节点导入已实现；后续阶段尚未交付。
- 支持 Clash YAML、Base64 URI 订阅和 SS/VMess/VLESS/Trojan；HTTP(S) 地址下载为订阅内容，Mihomo provider API 校验后导入，按连接配置去重。
- Mihomo v1.19.34 随包提供，按需启动并自动退出；四路并发检测通过 delay API 和节点独立监听端口读取 Cloudflare trace 的真实出口 IP、国家/地区。失败不生成位置。
- 节点面板固定高度，列表内部滚动；开发预览不获取订阅、不模拟订阅成功。
- 已安装、已检测、已验证、未知与可选分开；浏览器/应用存在不代表网络路径已验证。
- 旧 CLI、DNS、IPv6 备份恢复有确认与冲突检查。缺少可信原值/归属的旧 Desktop 与插件配置明确要求人工核对，不猜测恢复，不删除用户登录或项目。
- 关闭初始化窗口即退出；重开重新读取事实，上次 scanning 记录识别为中断；不生成假的正式基线。

## 构建与打包

Windows CI 在检查、Rust 测试与绑定校验通过后构建 NSIS 安装包并上传 artifact；v* 标签触发 GitHub Release。Mihomo 下载固定版本并校验 SHA256，二进制与本地 docs 不进入 Git。Mihomo 为 GPL-3.0，发行包附带许可证及对应源码链接。

原桌面 Git 历史与远程保留。旧源码及服务端移出活动工程归档，位置见实施记录。第三方来源与许可保留；不为上游同步保留平行 UI。旧历史测试不代表当前网络保护或后续六步验收。

# 日常节点与代理管理 · 2026-11-24

final result: passed

## 对照范围与证据

源视觉：G:/Project/CodeSeam/docs/设计稿/日常运行/CodeSeam节点与代理管理界面.png。
实现： http://127.0.0.1:1420/?preview=nodes-final&step=workbench&page=nodes。
证据目录：G:/Project/CodeSeam/docs/tasks/evidence/2026-11-24-daily-nodes/。

源图与主对照截图均为 1448 × 1086 像素；浏览器 CSS viewport 1448 × 1086，devicePixelRatio = 1，无缩放或拉伸。主对照为 Native、Clash 导入 Tab、6 个节点、SG Base 01 为正式当前节点、浅色主题。源码沿用公共 WorkspaceShell / WorkspaceHeader / WorkspacePanel / Button / Radio / DetailDialog 与现有图标库。按用户要求仅以设计稿指导内容区，公共导航及底栏沿用现有组件。

- clash-desktop.jpg：首轮实现。
- clash-final.jpg：字号修正后的最终 Clash 状态。
- clash-comparison.jpg：首轮源图和实现并排；已打开检查。
- final-comparison.jpg：源图与最终实现原尺寸并排；已打开检查。
- final-details.jpg：内核栏、导入区及节点表格的同坐标局部并排；已打开检查。
- general-desktop.jpg：首轮通用代理。
- general-final.jpg：修正后的通用代理，包含真实官方更新检查结果。
- general-1080.jpg / general-820.jpg：1080 × 720、820 × 560 窗口。
- switch-confirm.jpg：首轮切换确认。
- switch-success.jpg：切换完成，正式节点与出口同步更新。
- switch-error.jpg：切换失败，错误、重试及取消均保留。
- kernel-check.jpg：查询 Mihomo 官方稳定版成功。
- final-dom.txt / browser-log.json：最终 DOM 与空的 error/warn 日志。
- previous-design-qa.md：本轮前已有验收记录的完整备份。

## 发现、修复与复核

1. [P2，已修复] 列表字号偏小。
   首轮对照中节点名称、协议、地区小于源图，信息密度偏高。将表格字号从 1.2rem 调至 1.3rem。clash-final.jpg、final-comparison.jpg 与 final-details.jpg 已复核，6 行节点、列宽、行高及操作区均清晰，无横向溢出。
2. [P2，已修复] 通用代理协议单选框误用文本输入框尺寸。
   switch-confirm.jpg 背后的表单显示单选框过大。将表单文本输入样式限定为 input:not([type='radio'])，继续使用公共 Radio。general-final.jpg 与小窗口截图确认尺寸、标签和间距正常。
3. [P2，已修复] 公共外壳按钮文字规则覆盖确认主按钮。
   switch-confirm.jpg 中主按钮为黑字。给业务主操作绑定局部 primary 样式，使用公共 on-primary token；switch-error.jpg 和最终页面确认主按钮文字为白色。
4. [P2，已修复] 单节点测速原接口将 ID 列表仅用作排序，仍会测试全部节点。
   原生测试入口现在按指定 ID 筛选节点；初始化和全部测速继续传入完整列表。预览也只更新被测节点。前端进度按本次测试 ID 计数，避免单节点操作显示全部节点进度。自动测试覆盖其他节点的观测不被清除。

无剩余 P0/P1/P2 视觉问题。

## 五项保真检查

- 字体：复用 Segoe UI / Microsoft YaHei UI 字体栈及公共页头；内容标题约 27px，列表约 22px，名称加粗，数字等宽。节点长名称截断并保留 title，正文无异常换行。
- 布局：保留内核栏 → 添加节点 → 节点列表三段结构。源图添加区底部及列表顶部对应约 y=452 / y=469，实现对齐；列表独立滚动，页脚始终可见。1080 窗口无横向溢出；820 窗口输入区折行、主区纵向滚动，表格允许局部横向滚动，页面自身 scrollWidth 与 viewport 一致。
- 颜色：沿用公共暖粉背景、橙色品牌/按钮、语义成功与警告颜色。国家不一致的节点灰显并附锁定图标，当前节点选择态清晰。使用公共语义绿色，较源图亮绿更深，属于公共 token 的有意保留。
- 图像与图标：复用现有 CodeSeam 标志、SG/HK/US/JP 国旗以及现有 Lucide 图标。内核标识使用库内 Cat / CheckCircle2，未手绘 SVG 或用 CSS 图形替代图片。标准图标相对源图的轮廓差别为 P3。
- 文案：保留添加节点、Clash 导入、通用代理、节点列表、当前出口国家、仅可选择同国家节点、全部测速等内容。IP、协议及版本读取实际服务数据，未硬编码设计稿的最新版本或持续守护成功状态。

## 交互验证

浏览器中已执行：

- Clash / 通用代理点击切换及 ArrowRight 键盘切换。
- 代理地址为空、端口超过 65535 时给出具体错误。
- HTTPS、可选用户名与密码导入后自动测速；密码清空且不回显。
- 单节点测速、跨国家锁定、当前节点禁止删除。
- 同国家节点确认切换、忙碌期间锁定操作、成功后更新正式名称/IP。
- 切换失败保留原正式节点并显示错误，可再次应用或取消。
- 删除非当前节点前确认，完成后从列表移除。
- 检查更新真实请求官方稳定发布，得到 v1.19.34，与当前版本一致；升级按钮保持禁用。
- 1080 × 720、820 × 560 下布局与滚动可用。
- 最终浏览器 error/warn 日志为空。

## 实现与验证边界

- 日常切换通过 workbench 的 node_switch 操作验证真实测试状态、IP、当前正式国家以及测试互斥，再复用原有备份、应用、出口/浏览器复验路径。国家信息写入正式记录；不知道国家时禁止切换。
- 初始向导与启动故障修复弹窗继续使用原有 NodeEditor。
- Mihomo 仍随 CodeSeam 安装包提供。已实现官方版本检查及升级说明入口；未实现独立内核下载、替换或热升级，说明中明确告知需更新 CodeSeam。
- 浏览器测试使用明确标注的开发演示数据，不代表本轮执行了用户真实节点或 Guest 的在线切换。
- 未发布到 Sites，保留本地预览。

通过：npm run check；npm test（12 项）；cargo test --manifest-path src-tauri/Cargo.toml --lib（35 通过，16 项显式在线测试跳过）；npm run bindings:check；git diff --check。

## 实施检查清单

- [x] 公共外壳与内容区设计对齐。
- [x] Clash / 通用代理 Tab 与表单接通。
- [x] 单节点及全部测速、删除、同国家切换。
- [x] 前后端同国家校验与失败重试。
- [x] 同尺寸整页及局部对照、窄窗口检查。
- [x] 自动检查和浏览器验证通过。

## 后续精修

[P3] 若以后要求逐像素还原，可替换为经授权的原稿内核图标。公共背景、字体与状态色目前遵循现有产品 token。

## 全页面组件清单 · 2026-11-24

### 组件归属

| 目录 | 负责的内容 | 页面如何使用 |
| --- | --- | --- |
| `src/components/ui` | Button、TextInput、Select、Checkbox、Radio、Switch、Surface、Dialog、DetailDialog、TabList | 声明操作、原生字段属性、禁用状态和可访问名称。Dialog 管理模态和焦点恢复，TabList 管理方向键、Home 和 End。 |
| `src/components/layout` | WindowShell、WorkspaceShell、WindowActions、WizardHeader、WizardActions、BackButton、WorkspaceHeader、WorkspacePanel、PanelTitle、WorkspaceStatusBar、SettingGroup、SettingRow | 外壳负责窗口与导航，页头负责标题，面板负责内容编排。向导操作区通过 WizardActions 接入固定页脚。 |
| `src/components/business` | StatusLabel、DetectionSummary、CheckRow、RuntimeIdentity | 调用方传入检测状态、文案、运行环境和出口数据。组件统一展示，状态判定与数据读取归功能模块。 |
| `src/features` 与 `src/app` | NodeEditor、NodeEditorDialog、ProxyFields 及各页专用内容 | 节点功能复用编辑器和字段，应用层负责启动修复、切换环境与跨页流程。 |

### 逐页对照

| 页面或入口 | 复用的主要组件 | 由该功能负责 |
| --- | --- | --- |
| 环境预检 | WizardHeader、DetectionSummary、CheckRow | 分组、阻塞项、重新检测 |
| 向导节点与代理 | WizardHeader、NodeEditor、ProxyFields、TabList | 导入节点、协议选择、测试与删除确认 |
| Claude 应用 | WizardHeader、Checkbox、WizardActions | 应用选择、清理进度、备份结果 |
| 运行环境 | WizardHeader、CheckRow、Select、Radio | 模式选择、区域设置与匹配文案 |
| Hyper-V 检测 | WizardHeader、DetectionSummary、StatusLabel | 能力分组、检测来源及继续条件 |
| 虚拟环境配置 | WizardHeader、TextInput、Select、WizardActions | 资源配置、创建和初始化的阶段进度 |
| 浏览器准备 | WizardHeader、CheckRow、Select | 准备顺序、浏览器参数和验证结果 |
| 确认完成 | WizardHeader、CheckRow、TextInput、Select | 基线摘要、可选备注与确认动作 |
| 日常工作台 | WorkspaceHeader、WorkspacePanel、PanelTitle、RuntimeIdentity、DetailDialog | 应用入口、进程与事件记录 |
| 日常节点与代理 | WorkspaceHeader、WorkspacePanel、RuntimeIdentity、ProxyFields、TabList | 当前出口、批量测试和代理编辑 |
| 日常运行环境 | WorkspaceHeader、WorkspacePanel、RuntimeIdentity、CheckRow、DetailDialog | 读取检测结果、正式基线与切换确认 |
| 日常浏览器 | WorkspaceHeader、WorkspacePanel、RuntimeIdentity、TabList、DetailDialog | Profile、浏览器验证与参数分组 |
| 设置与重置 | WorkspaceHeader、SettingGroup、SettingRow、Switch、Checkbox、Radio、DetailDialog | 偏好分组、重置范围与备份选择 |
| 启动检查与节点修复 | WindowShell、WindowActions、WizardHeader、Surface、CheckRow、StatusLabel、Button、NodeEditorDialog、NodeEditor | 检查进度、失败原因与修复后重试；直接使用公共主题 token |
| 运行环境重配 | WindowShell、RuntimePage、BrowserPage、CompletionPage、DetailDialog | 候选环境、取消切换与正式基线交接 |

逐页组件归属按源代码核对。开发预览的对照截图位于 `docs/tasks/evidence/2026-11-24-component-audit/`。其中 08–10 记录节点编辑、键盘切换到代理表单和确认弹窗，11 记录最小窗口下的预检，12–13 记录从浏览器准备进入最终确认。系统检测、真实窗口控制和虚拟机操作需在桌面环境另行验证。

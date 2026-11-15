# 检测组件统一 · Design QA

日期：2026-11-12。视觉基准改为用户确认的第一页，覆盖上一轮原始 Hyper-V 图中的局部样式。

## Source and evidence

- Source visual truth：用户提供的第一页截图，已保存为 `docs/tasks/evidence/2026-11-12-hyperv/unified-reference.png`（1978 × 914，原始 CSS 视口与 density 未提供）。
- 实现截图：同目录 `unified-preflight.png`、`unified-native.png`、`unified-hyperv.png`，均为 1536 × 1024、CSS viewport 1536 × 1024、DPR 1。
- 全视图比较：`unified-reference-comparison.png`（上为用户截图按宽度归一到 1400px，下为第一页内容裁剪；原始视口未知，仅比较组件结构和视觉语言，不作像素等价声明）。
- 聚焦比较：`unified-summary-comparison.png`，同 CSS 视口下第一页面摘要与 Hyper-V 摘要并排次序上下排列，展示同一结构、字号、计数和完成标识。
- 状态：预检 3 待处理 / 1 未知 / 1 可选；Hyper-V 2 待处理 / 2 未知 / 1 可选；本机 3 待处理 / 0 未知 / 2 可选。不同数量来自各自检测结果。

## Findings and comparison history

- 初始 P2：Hyper-V 单独实现状态图标、成功填充、灰色 info、局部字号与文字颜色；和第一页的描边勾、问号、语义色、标准间距不同。
- 修复：所有检测行复用第一页现有 `StatusLabel`；节点页运行状态也接入。删掉 Hyper-V 私有状态渲染和本机遗留状态样式。
- 初始 P2：顶部检测摘要各页结构不同。
- 修复：完整抽取第一页的 DOM 结构与 CSS 成为 `DetectionSummary`，预检、本机和 Hyper-V 复用；各页仅提供计数与文案，刷新是可选右侧操作槽。
- 首轮复查 P2：引入统一摘要后 Hyper-V 面板过高，说明被挤出首屏。调整面板内边距、行高及行标签字号，最终 `unified-hyperv.png` 中说明及两个底部按钮完整可见。
- 本机页引入统一摘要后下方设置需在内容区域滚动查看；底部继续/返回仍固定可见。属于本次统一摘要带来的预期布局变化，未覆盖或移除设置。
- 最终无未解决 P0/P1/P2。统一样式的证据来自共同组件与截图对照。

## Required fidelity surfaces

- Fonts / typography：摘要字号、粗细、说明和计数直接继承第一页 CSS；行状态完全使用同一组件。保留业务文案，未把已支持改成通用已检测。
- Spacing / layout：同一个绿勾容器、竖分隔线、摘要内容内边距与计数间距；Hyper-V 的刷新图标在最右。第一页原有布局保留。
- Colors / tokens：行状态复用成功绿、警示橙、未知灰、不支持红；无填充药丸行状态。摘要浅橙计数保留第一页规则，沿用公共主题 tokens。
- Image / asset fidelity：继续使用现有 Logo 和 lucide-react，无新图像占位或自绘状态图标。绿色实心大勾仍为第一页原有摘要样式。
- Copy / content：移除 Virtual 1/4；待处理、未知、可选数各自独立；加载和错误不显示完成计数。检测完成不表示可立即创建 VM。

## Interaction and validation

- 浏览器已验证：第一页原有摘要与四模块；本机分支、返回；虚拟分支、刷新加载 → 已完成、禁用期间恢复、摘要刷新图标。
- 静态检查、CSS 检查、架构边界、TypeScript / Vite 构建通过（`npm run check`）。本轮仅公共 UI 重构，未改检测逻辑与 IPC 合同。
- 控制台存在编辑期间短暂缺少新文件引发的两条旧 Vite 热更新失败记录；之后页面重新载入、跨页导航和完整构建成功，无新的应用异常。
- 本轮未重新进行所有探针测试；真实只读探针及此前合同测试记录保留在 `qa-before-unification.md`。

## Implementation checklist

- [x] 第一页提取公共摘要，保持原有结构
- [x] 本机与 Hyper-V 复用
- [x] 所有检测行和节点运行状态统一
- [x] 移除右上进度，刷新移入摘要最右侧
- [x] 视觉对照和工程检查

## Follow-up polish

- 用户来源截图视口/density 未知，本轮验证统一视觉语言与代码共用，不声称和该截图逐像素一致。
- 2/4 后续启用流程仍未实现，保持原有明确提示。

final result: passed


## Claude 配置清理 · 2026-11-14

- 产品权威：docs/产品/README.md、01-初始化向导与依赖编排.md（2026-11-14）；六阶段顺序为环境预检 → 节点与代理 → Claude 应用 → 运行环境 → 浏览器 → 确认完成，Native/Virtual 共用顺序。
- source visual truth: docs/设计稿/初始化/Claude 配置清理界面.png（1672×942）。
- implementation screenshot: .local/claude-qa/final.png（1672×942）；viewport 1672×942 CSS px，按 1:1 比较。
- full-view comparison: .local/claude-qa/comparison.png；左源稿，右实现。重点检查左右栏、三条配置行、摘要、保护面板、固定底部导航；无须另裁切。
- 迭代：补回方框终端图标、流程状态图标，右侧底部与左面板对齐；小视口压缩面板内边距，保留滚动访问。
- 交互（IAB 开发演示数据）：未安装/无配置时可进入运行环境；勾选两项清理时导航禁用，完成后剩余一项可跳过；恢复期间导航禁用，完成后三项重新出现；全量清理后下一步恢复可用。
- 控制台检查：开发热更新曾因旧缓存缺少 warnings 字段报错，已加空值保护并重新载入验证页面可用。
- 原生隔离测试：DPAPI 加密备份、选择性清理、保留 history/permissions/MCP、原样恢复与冲突保护通过；npm run check 通过。
- 限制：UI 验证使用显式 preview；真实用户注册表修改和完整桌面 UI 往返未实测。扫描默认用户配置位置，系统通用代理不清理。
- P3：沿用现有应用 Logo、字体与背景 tokens；文案按真实能力及最新产品稿调整。
- final result: passed


## 顺序修正 · 2026-11-14 用户最终确认

用户最新指令优先于现有产品文档：环境预检 → 节点与代理 → 运行环境 → Claude 应用 → 浏览器 → 确认完成。已同步顶部导航、页面分支、预览入口和前进/返回跳转，Native/Virtual 不再单独调整导航顺序。上一节截图代表顺序修正之前的视觉证据。


## 2026-11-14 · Virtual Runtime 初始化

final result: blocked

已实现四个设计状态：系统组件准备、等待重启、VM 配置编辑、Guest 初始化等待页。延续现有组件与样式令牌。

浏览器验证：安装镜像为空及 CPU 超额均阻止创建；资源预览随输入更新；合法演示配置可进入 Guest 页；Guest 无证据时禁止下一步；稍后重启仍保持等待状态。

图像证据位于 docs/tasks/evidence/2026-11-14-virtual/，四张 *-comparison.png 为设计稿和实现并排对照。参考约 1672×942；实现当前浏览器为 1072×838，比例不同，尚未完成相同视口的严格视觉验收。当前实现保留双栏、单主面板、任务三列及平面目标列表。文档优先差异：Windows 10、合法自备 ISO、TPM 未验证、Guest 无真实进度时使用不确定进度条、初始化页禁止再次创建。

验证：npm run check、npm test 通过；Rust 已编译且绑定生成通过。cargo test --lib：15 passed，7 failed，7 ignored；首个错误在现有 Claude 加密备份测试读取备份路径时文件不存在，后续测试含共享锁污染，未修改无关测试。

原生只读复核：Windows 拒绝 Hyper-V 管理接口访问（没有完成此任务所需权限）。本次未实际启用系统功能、重启或创建 VM，不能声称原生创建已验证。

尚未完成：Guest 无人值守安装、Guest 凭据/通信、代理接入、DNS/IPv6/UDP 独立检测、连续任务进度与候选基线；重启后自动唤起和完整检查点恢复；内部交换机/NAT 自动编排。当前要求现有内部交换机，VM 创建成功才进入 Guest 页。创建中断保留文件和记录，不自动删除用户数据；需要后续恢复流程。

## 2026-11-15 浏览器初始化内容区

final result: blocked

已实现双栏任务 / 参数布局、自动检测与 Profile 创建或恢复、浏览器选择、保留数据的重新创建、真实任务计数进度、失败提示与下一步门禁。沿用现有设计系统与调整后的向导顺序。

验证：npm run check、npm test、npm run bindings 通过；tests/browser-profile.test.ps1 在临时目录验证真实浏览器检测、目录创建、重复恢复、会话哨兵数据保留、Profile 身份与创建时间稳定，以及未验证状态不误报成功。IAB 开发预览已检查布局和重新创建交互。

未完成：Guest 创建执行器、常驻受管代理绑定、受管启动 / 桌面快捷方式、浏览器实时探针与候选基线。下一步与打开验证保持禁用。尚未完成与原稿同尺寸同状态的组合图片比较，不能宣称视觉验收通过。

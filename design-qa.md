# Design QA · 最终确认 / 工作台 · 2026-11-16

final result: passed

验收范围为本次内容区、公共框架、最终确认流与首页交互。公共部分以产品文档及已有 tokens/组件为准；运行结论以真实能力为准。此结果不表示 Guardian 等尚未实现的产品能力通过了原生验收。

## 对照证据

- Source：`docs/设计稿/初始化/最终确认.png`，1648×928。
- Implementation：`docs/tasks/evidence/2026-11-16-workbench/confirmation-virtual-final.png`，CSS 1648×928 / DPR 1 / PNG 1648×928。
- Source：`docs/设计稿/日常运行/工作台.png`，1448×1086。
- Implementation：`docs/tasks/evidence/2026-11-16-workbench/workbench-final.png`，CSS 1448×1086 / DPR 1 / PNG 1448×1086。
- 同输入并排比较：同目录 `confirmation-comparison-final.png`、`workbench-comparison-final.png`。
- 局部比较：同目录 `confirmation-focus-0.png` / `confirmation-focus-1.png`、`workbench-focus-0.png` / `workbench-focus-1.png`；检查摘要行、表单、应用操作及进程/风险区域。
- 其他状态：`workbench-1080.png`、`environment-details.png`、`events-filter.png`、`save-error.png`。过渡截图仅为交互证据，不用于像素归一化比较。

## Findings / comparison history

1. [P2，已修复] 确认页早期公共顶部占用过高，面板及底部提示需要滚动。复用现有紧凑向导框架，调整内容标题行高、面板内边距、行高及右栏底部间距。Virtual 最终视口测量 main clientHeight=691 / scrollHeight=691，无水平溢出。
2. [P2，已修复] 默认 1080×760 下进程列表的 Claude Desktop 名称折行。扩大应用名列并限制名称换行；固定导航与底栏保留，主区无水平溢出。
3. [P2，已修复] 应用下拉的面板层叠可能被后续区域覆盖。应用容器使用独立层级，详情和重测入口可点击。
4. [P2，已修复] 开发热更新重建预览 service 后刷新丢失内存记录。预览操作从独立 sessionStorage 恢复；正式环境使用 Rust 加密记录。重开清除旧观测，再检测当前状态。
5. [P2，已修复] 应用最初使用通用图标替代设计稿品牌图标。已改为从用户源稿裁取的 PNG，并检查大图和进程行的小尺寸清晰度。

当前无未解决的 P0/P1/P2 视觉及本次核心流程问题。

## 五项保真检查

- 字体/排版：沿用 Segoe UI / Microsoft YaHei UI；标题、应用名、说明和时间形成稳定层级。小窗口保留完整操作和可读状态，重要名称不折行。
- 间距/布局：确认页保持 1.42:1 双栏、六行基线与三入口；首页保持窄侧栏、双状态横条、一行三应用、中部双栏、较高事件区、固定底栏。主视口无横向滚动，确认页无内容裁切。
- 色彩/tokens：沿用项目公共暖白背景、铜金强调、半透明 Surface、语义色图标和无底色状态。未照抄源稿的高饱和橙色或全绿结论，符合用户“公共部分以产品文档为准”。
- 图像/资产：CodeSeam 使用已有官方开口 C 资源；Claude 三图标为源稿原始区域裁图，不含重绘或 CSS 近似图案；普通 UI 图标使用既有 Lucide。
- 文案/内容：摘要反映实际检测及未清理项；服务地区明确为用户声明；首页不伪造 IP、Guardian、应用进程、保护路径或版本。事件由动作产生并限定七行，当前测试中可见七条。版本取 package.json。

## 浏览器验证

使用 Codex IAB。已验证 Native / Virtual 第五步到最终确认、确认成功跳转、保存失败留在确认页、备注/地区保存及详情读取、重新打开直接首页、刷新进行中、应用下拉/官方入口、环境详情、事件等级筛选。正式服务与演示场景分离；预览始终显示“开发预览”。两页控制台 error / warn 均为空。

## 可接受差异与后续

- 公共 Logo、窗口按钮、配色、按钮及 Surface 沿用项目现有实现；设计稿的示例版本 v1.6.0 改为实际 v0.5.1。
- 实际能力不具备持续 Guardian / Code 进程保护时展示待验证；示例中的运行中、全绿风险和保护计数不能作为实现数据。
- [P3] 小图标受源稿分辨率限制；以后若提供独立品牌高清资产，可原位替换。
- 尚未进行用户真实 Native / Guest 最终确认的 live E2E；本次通过浏览器流程、Rust 测试和受管浏览器 fixture 验证。完整 Guardian、托盘、Guest 日常检测等属于后续能力。

## Implementation checklist

- [x] 两张源稿及最终浏览器截图同输入比较。
- [x] 确认摘要、可选备注、正式记录持久化、成功跳转与失败反馈。
- [x] 首页信息结构、详情、事件、应用入口与真实未知状态。
- [x] 修正 P2 问题并复拍，完成默认窗口验证。
- [x] 前端检查、原生回归及浏览器控制台检查。

补充小窗口观察：[P3] 在 1080×760 且已有七条较长事件时，最后一条需要主内容区短距离滚动；导航、窗口按钮、刷新和固定底栏均保持可见。1448×1086 源稿尺寸下七条完整可见。此项作为后续密度微调，不阻断当前验收。

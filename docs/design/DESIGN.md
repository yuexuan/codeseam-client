# CodeSeam 桌面客户端设计说明

设计稿：本目录下五张 PNG（首页 / 环境诊断 / Claude Code 控制台 / 用量 / 设置）。
本文档记录从设计稿提炼的样式体系、公共组件与目录组织，对应实现位于 `src/codeseam/`。

## 样式体系（`styles/tokens.css`）

全部视觉变量集中在 `tokens.css`，页面与组件不得出现硬编码颜色。

| 令牌 | 浅色 | 用途 |
| --- | --- | --- |
| `--bg` | `#faf8f3` | 窗口底色（暖白纸感） |
| `--surface` | `#ffffff` | 卡片、表单控件底 |
| `--surface-2` | `#f4f0e8` | 内嵌区块、图标块、悬停底 |
| `--border` | `#ece6db` | 发丝边框、分隔线 |
| `--text` / `--text-2` / `--muted` | `#23252c` / `#5f636d` / `#8b8e97` | 主文 / 次文 / 弱化说明 |
| `--gold` / `--gold-strong` | `#b87324` / `#9c5e14` | 品牌铜金（链接、图标、强调） |
| `--gold-grad` | `135deg #d2832a → #a55d13` | 主按钮、Pro 徽章、头像 |
| `--gold-soft` / `--gold-pill` | `#fbf3e2` / `#f8ecd3` | 金色图标块 / 导航选中药丸 |
| `--green` / `--green-soft` | `#37a06c` / `#e8f5ed` | 成功态、运行中 |
| `--amber` / `--red` | `#c08a20` / `#c0524a` | 待验证 / 错误 |
| `--prog-grad` | `90deg #e89133 → #f9b75b` | 进度条填充渐变 |
| `--radius-s/m/l` | `8 / 12 / 16px` | 控件 / 图标块 / 卡片圆角 |

暗色主题通过 `:root[data-theme="dark"]` 覆盖同名变量；标题栏的月亮/太阳按钮切换，
偏好存 `localStorage("cs.theme")`。

字体：`13px "Segoe UI", "Microsoft YaHei"`；页面标题 21px/650，卡片标题 14px/650。

## 布局骨架（`App.tsx`）

```
┌─ titlebar（48px，无边框窗口：品牌区+拖拽区 | 主题切换 | – □ ✕）─┐
├─ sidebar（220px）┬─ content（滚动区，各页面自带 PageHeader）─┤
│  主导航 5 项      │                                           │
│  底部账号卡       ├─ statusbar（连接 · 代理 · 安全三组）───────┤
└──────────────────┴───────────────────────────────────────────┘
```

- 窗口无边框：`tauri.conf.json` `decorations:false`，标题栏组件带
  `data-tauri-drag-region`；关闭请求交给后端
  （`codeseam/shell.rs`）按“关闭时最小化到托盘”设置处理：开启且托盘图标创建成功则隐藏到托盘，
  否则直接退出（停止代理与受管终端）。托盘菜单：打开 / 退出。窗口权限已在 `capabilities/default.json` 授权。
- 导航顺序与设计稿一致：概览 → 环境诊断 → Claude Code → 用量管理 → 设置。
- 状态栏为常驻底部条，与内容区同步 `cs_status`。

## 公共组件

`components/ui/`（无业务语义的展示组件）：

- `Button`：`primary`（铜金渐变）/ `default`（白底描边）/ `ghost`，`sm` 尺寸，`icon` 插槽。
- `Card`：标题 + 副标题 + 右上动作 + 正文；16px 圆角、发丝边框、柔和投影。
- `Badge`：`gold/green/amber/red/pro`（pro 为渐变计划徽章）。
- `StatusDot`：连接状态与时间线节点圆点。
- `Progress`：金色渐变进度条，`used/total` 自动算百分比。
- `PageHeader`：页面标题 + 副标题 + 右侧动作区。

`components/`（外壳组件）：

- `Titlebar`：品牌 + 拖拽 + 主题切换 + 窗口控件（最小化/最大化-还原/托盘）。
- `Sidebar`：主导航 + 底部账号卡（头像首字母、服务计划徽章、到期时间）。
- `StatusBar`：连接状态、代理信息、安全状态三组。
- `ManagedConfig`：备份确认 + 配置/恢复操作块（Claude Code 页与诊断页共用）。

`lib/`（数据与逻辑）：

- `types.ts`：后端命令的数据结构与 `PageId`、`ActivityEvent`。
- `useCodeSeam.ts`：状态轮询（5s）、命令执行（忙态/错误/完成提示）、活动记录、
  主题与连接偏好的唯一数据源，页面只消费不自行 invoke。
- `activity.ts`：近期活动环形记录（本地 50 条），时间线数据来源。
- `format.ts`：数字/日期格式化、状态与诊断结论中文文案。

## 首页（概览）

按设计稿三段式：

1. **状态速览** 4 卡：服务状态（金）、本地代理（绿）、有效期（金）、安全状态（绿），
   图标块 + 标签 + 主值 + 说明。
2. **连接总览 + 快捷操作**（约 1.55:1）：连接总览为四行组件状态
   （本地代理 / Claude Code / 网络出口 / 环境保护），行尾“查看详情”跳转对应页面；
   快捷操作为 2×2 瓦片（环境诊断 / 编辑配置 / 打开配置目录 / 查看日志），
   绑定真实命令（`cs_open_path`）或页面跳转（“查看日志”跳设置 › 日志与记录）。
3. **用量速览 + 近期活动 + 帮助与文档**（约 1.5:1.35:1）：用量速览显示平台额度进度条
   与本月请求/Token 统计（登录后自动查询 `cs_usage`）；近期活动为时间线；
   帮助与文档为三行入口。

未登录时首页顶部显示登录卡片。

## 环境诊断

三张卡片（均 0 内边距，分区自带 padding）：

1. **诊断状况**：状态圆标 + 结论标题（可用/存在阻断/尚未检测）+ 上次检测时间、检测耗时 + “重新检测”。
2. **诊断项目 + 详情**（约 1.04:1 分栏）：左侧 9 个检测项（本地代理 / Claude Code 配置 / 出口 IP /
   DNS / IPv6 / UDP / WebRTC / Kill-Switch / 非 API 流量），选中行为金色浅底 + 左侧竖条，
   行尾为状态点 + 文案（正常/待验证/待处理/异常/不适用/未检测）；右侧为选中项详情：
   着色提示框（后端 `detail` + `remediation`）、键值行（含证据、保护范围）、“复制证据”。
   默认选中首个失败/待验证项。设计稿中的“时区与语言”后端暂无检测，不展示、不伪造。
3. **常用操作**：4 列（重新检测 / 导出报告 JSON / 网络修复建议=定位首个待处理项 / 打开日志）。

其后保留“修复与恢复”卡片（受管配置备份/恢复）。耗时由 `useCodeSeam` 在 `cs_diagnose` 前后计时。

## Claude Code 控制台

双栏（约 1.36:1），左栏 配置信息 + 运行终端，右栏 连接状态 + 常用操作 + 帮助与文档：

- **配置信息**：代理地址 / 认证方式 / Claude 版本 / 安装位置 / 配置文件 / 当前模型 / 超时 / 环境变量数。
  版本与配置概况来自后端只读命令 `cs_cli_info`（`claude --version` + 读 `settings.json`，
  只返回键名与数量，不返回任何密钥值）；“编辑配置”展开受管配置块（`ManagedConfig`），
  登录后若受管字段未配置则自动展开。
- **运行终端**：受管 Claude 在独立 PowerShell 窗口运行，无法回传输出，因此此处只展示版本命令与
  CodeSeam 会话事件（取自近期活动，“清空”仅隐藏当前已有条目，不删除首页活动记录）；“关闭终端”即 `cs_stop`。
- **连接状态**：头部为连接结论与上次检测时间；四行为 本地代理 / 认证状态 / 网络连接 / Claude 访问，
  后两项来自诊断报告，“测试连接”即 `cs_diagnose`。
- **常用操作**：启动、重启服务（断开后重新激活）、编辑配置、打开目录、测试连接、断开连接。
  设计稿中的“清理缓存”、延迟毫秒数、“已是最新”后端暂无数据，不展示、不伪造。

## 用量管理

页面自带二级导航（左侧窄栏，6 项）与右上日期区间（快捷：今天/近 7 天/近 30 天/本月 + 起止日期，变化即重新取数，默认近 7 天）。
设计稿只画了“用量概览”，其余五页依据产品规划 §4.4（真实计量语义）、§5.1（用量/额度）展开。

数据来源：后端只读命令 `cs_usage_report(start,end)` 一次取回 `/usage/stats`、
`/usage/dashboard/snapshot-v2`（每日趋势 + 模型分布）和 `/usage`（逐请求明细，每页 1000 条、最多 5 页）。
明细在 Rust 侧裁剪字段，不把 IP、UA、端点等带进 WebView；超出上限时 `truncated=true`，页面顶部提示，
汇总数字不受影响。会话 = 按明细里的 `session_id` 归并；无 `session_id` 的请求汇总为一条“未标记会话”。

| 二级页 | 内容 |
| --- | --- |
| 用量概览 | 4 张统计卡（使用时长 / Tokens / 会话次数 / 平均每会话）、使用趋势（折线=Tokens，柱=使用时长，双轴）、模型分布环形图、最近会话 / 用量明细（筛选 + 分页） |
| 会话记录 | 会话汇总卡 + 全量会话表，行内展开查看该会话每次请求 |
| 模型统计 | 使用模型数 / 最常用 / 总请求 / 缓存命中占比，模型明细表（Input/Output/Cache/费用）+ 占比环形图 |
| 成本统计 | 实际扣除、标准计费、计费倍率、日均；每日成本柱图；按模型、按会话（Top 5）的费用分布 |
| 配额管理 | 服务状态 / 剩余有效期 / 平台额度进度（来自 `cs_status` 的服务信息，“同步服务信息”即 `cs_refresh`），数据口径说明，续费入口（`cs_open_portal`） |
| 导出报表 | 会话汇总 / 请求明细 / 模型统计 / 每日趋势，CSV（带 BOM、防公式注入）或 JSON，在本机生成 |

诚实原则（与产品规划一致）：
- “使用时长”由请求区间合并而来（相邻请求间隔 > 30 分钟不计），并同时给出“模型响应耗时”占比；设计稿中的
  “总计 X 时”无对应配额，不伪造。
- “进行中”= 最近 5 分钟内仍有请求；设计稿中的“已完成”状态、会话名称服务端没有，故用“进行中/已结束”和短会话 ID。
- 5 小时 / 每周官方窗口接口未提供，配额页明确说明，不用平台用量去推算。

浏览器预览：`npx vite --port 1430`（`.claude/launch.json` 的 `vite-preview`）在非 Tauri 环境下会载入
`lib/devMock.ts`（仅 DEV），模拟后端命令以便查看页面；生产构建不包含。

## 设置

页面自带二级导航（左侧窄栏，三组 11 项，复用 `sub-layout/sub-nav` 骨架），设计稿只画了“应用设置”，
其余十页依据产品规划 §3.7（基础设置）、§3.5/3.6（网络与保护）、§3.4（Claude Code 配置）展开。
偏好即时生效，没有“保存”按钮（连接地址、工作目录除外）。

| 分组 | 二级页 | 内容 |
| --- | --- | --- |
| 基础设置 | 应用设置 | **主题与界面**：主题（浅/深/跟随系统）、主色调（5 预设，`data-accent` + `color-mix` 推导）、语言（仅简体中文）、缩放（WebView 缩放）；**启动与行为**：开机自动启动（`tauri-plugin-autostart`）、启动后最小化、启动时自动连接（决定 `cs_resume` 是否自动激活）、关闭时最小化到托盘；**通知**：连接状态 / 重要事件（应用内提示，错误始终显示） |
| | 代理设置 | 服务端 / Portal 地址、本地代理状态（监听地址、请求数、专属出口、连接/断开）、账号（退出登录并恢复配置） |
| | 网络与环境 | 固定保护策略（Kill-Switch、启动前检测、禁止直连降级，只读徽章）、最近检测结论、受确认的环境修复 |
| | Claude Code 配置 | 程序检测（版本 / 位置 / settings.json）、受管字段状态、备份与恢复（`ManagedConfig`） |
| | 模型管理 | 只读：Claude Code 当前模型与超时、服务端计量到的模型。首期不提供模型切换 |
| 工具与数据 | 工作目录 | 受管终端启动目录（`cs_prefs_set`，启动时校验）、打开 Claude 配置 / CodeSeam 数据目录 |
| | 日志与记录 | 活动记录（本机最近 200 条，筛选 / 导出 / 清空）、导出诊断报告 |
| | 快捷操作 | 常用动作按钮 + 应用内快捷键（`Ctrl+1..5` 切页、`Ctrl+,` 设置，见 `lib/shortcuts.ts`） |
| 关于 | 版本更新 | 当前版本；自有更新渠道未接入，如实显示“暂未启用”，新版经用户门户获取 |
| | 许可证 | 组件归属 + 构建时内嵌的 `LICENSE` / `PRODUCT-NOTICE.txt` |
| | 帮助与反馈 | FAQ、复制脱敏诊断信息、门户 / 环境诊断入口 |

存储分层：**界面偏好**（主题 / 主色调 / 语言 / 缩放 / 通知）在 `localStorage("cs.ui")`，由 `uiPrefs.ts` 管理；
**行为偏好**（自动连接 / 启动最小化 / 托盘 / 工作目录）由 Rust 持久化到数据目录的 `prefs.json`
（明文，不含任何密钥），命令 `cs_prefs_get` / `cs_prefs_set`；开机启动状态来自系统启动项。
`cs_open_path` 只接受固定的目录种类（`claude` / `data` / `work` / `license`），WebView 不能传任意路径。

诚实原则：Kill-Switch / 启动前检测 / 禁止直连不提供关闭开关；“非 API 流量”显示“未验证”；
没有自有更新渠道就不显示“已是最新”；语言、缩放以外未实现的选项（English）显示为不可选。

## 页面与文件组织

```
src/codeseam/
  App.tsx                外壳组合
  assets/codeseam-logo.svg
  components/
    Titlebar.tsx  Sidebar.tsx  StatusBar.tsx  ManagedConfig.tsx
    usage/ Charts.tsx  Tables.tsx  DateRange.tsx  UsageStat.tsx
    ui/ Button.tsx  Card.tsx  Badge.tsx  StatusDot.tsx  Progress.tsx  PageHeader.tsx
        Toggle.tsx  Segmented.tsx  SettingRow.tsx（设置页专用）
  pages/
    OverviewPage.tsx     概览（首页）
    DiagnosticsPage.tsx  环境诊断
    ClaudeCodePage.tsx   Claude Code
    UsagePage.tsx        用量管理（二级导航外壳）
    usage/               UsageOverview / Sessions / Models / Cost / Quota / Export
    SettingsPage.tsx     设置（二级导航外壳）
    settings/            App / Proxy / Network / Claude / Model / WorkDir / Log / Shortcut / Update / License / Help
  lib/
    types.ts  useCodeSeam.ts  activity.ts  format.ts  usage.ts（会话/每日归并、格式化、导出）  devMock.ts
    uiPrefs.ts（界面偏好）  shortcuts.ts（快捷键表）
  styles/
    tokens.css  app.css  usage.css  settings.css
```

新增页面时：在 `lib/types.ts` 的 `PageId` 与 `Sidebar.tsx` 的 `NAV` 增加一项，
在 `pages/` 下新建组件并在 `App.tsx` 挂载。
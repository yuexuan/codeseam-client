# Guardian 验证记录

GitHub Actions 打包故障回归：已确认 Desktop checks 第 6 次运行在 Tauri 的 `beforeBuildCommand` 中因 `Get-FileHash` 无法发现而失败。`prepare-mihomo.ps1` 显式恢复当前 PowerShell 宿主的系统模块目录；新增回归在 Windows PowerShell 子进程中注入 PowerShell 7 模块路径，确认修复后仍可校验并复用 Mihomo。相同条件下，原提交脚本可以复现线上错误。Desktop checks 和 Release 共用 `scripts/verify.ps1`，统一执行 Guardian、启动恢复与打包钩子回归。

日期：2026-11-25（Asia/Singapore）。使用当前用户既有正式 Hyper-V Guest，不重建虚拟机、不替换正式基线、不清理登录 Profile。

| 范围 | 结果 / 证据 |
| --- | --- |
| 前端 lint、CSS、分层、TypeScript 与生产构建 | `npm run check` 通过 |
| 既有前端规则与启动链路 | `npm test`：14 项通过 |
| Rust 单元 / 隔离集成 | 39 项通过；真实机器测试默认忽略，按下列命令单独运行 |
| 进程树、外部启动、发布者边界、PID 复用、规则复用与冲突、共享解释器、UTC 心跳 | `tests/guardian.test.ps1` 通过 |
| Off / Saved / Paused / Running 恢复、正常关机、VM ID 归属和失败清理 | `tests/runtime-startup.test.ps1` 通过 |
| 离线证据、偏移、控制台、Native 进程边界和入口锁 | `tests/runtime-environment.test.ps1` 通过 |
| 真 VM 关机 / 启动与 Guest 心跳 | `tests/guardian-live.test.ps1 -Scenario cycle`：离线清除旧进程，重新启动恢复实际心跳，正式记录不变 |
| Guest 守护任务意外退出 | `tests/guardian-live.test.ps1 -Scenario watchdog`：主动停止 Guest 任务后，宿主机立即撤销旧成功证据，自动重启任务并等待新的心跳恢复 |
| 代理故障、锁定及实际浏览器直接出口 | `tests/guardian-live.test.ps1 -Scenario network`：代理停止后锁定、专用浏览器退出；未被阻断的 TCP 对照可连通，真实浏览器无法直接访问测试端点 |
| Guest 环境恢复 | `tests/guardian-live.test.ps1 -Scenario health`：实际出口、DNS 和 Profile 与基线一致 |
| Guardian 原基线恢复、真实浏览器验证、打开 / 停止、安全退出和再启动 | `cargo test --manifest-path src-tauri/Cargo.toml installed_guardian_lifecycle_live -- --ignored --nocapture` 通过；基线保持不变 |
| 历史持久化 | 隔离测试验证 501 条事件完整保存，首页投影限制 500，200 条分页无丢失；重复归档不重复写入 |
| 主程序未运行时的历史 | 独立宿主机任务直接保存不可变的 CurrentUser DPAPI 事件文件；真实 `installed_guardian_live` 验证这些事件无需 UI 也可读取 |
| 真实桌面按钮与首页联动 | 实际点击「停止虚拟机」后显示 Off / Guest 未连接，三款 Claude 均为 Guest 离线；点击「启动虚拟机」后恢复 Running / Guest 在线，Web 回到已就绪且运行数为 0 |
| 正式安装版的外部关机 | 受管 Web 运行时，从应用外部执行 `tests/guardian-live.test.ps1 -Scenario offline` 正常关闭 VM；不点击页面刷新，首页自动清除运行 / 覆盖计数、禁用启动入口并显示 Guest 离线，运行环境页显示启动按钮 |
| 真实 Web 启动及覆盖 | 首页点击打开，Guest Web 运行数 1、已受守护 1；关机后这些旧计数与在线证据全部清除 |
| 真实关闭窗口与完整退出 | 点击窗口 X 后主窗口隐藏，进程和 Guardian 心跳继续；退出确认可取消，确认完整退出后主进程与宿主机任务均为 0，心跳置为过期 |

现场发现并修复：UTC ISO 心跳在 UTC+08 主机被作为本地时间比较；失败观测保留旧在线快照；TUN 重建继承默认 IPv6 / DNS；启动期网卡短暂 DNS 切换造成误锁；退出后短暂沿用已停止任务的旧心跳；只有连接窗口而没有 VM 启停控制。启动期等待连续稳定证据，稳定运行后停止代理仍会锁定。浏览器版本偏移会锁定，支持重新验证当前 Runtime 并显式确认新基线，不必强制切换到另一种 Runtime。

续验还发现 Guest 守护任务停止后没有自动恢复。宿主机现持续检查任务与心跳，按冷却时间恢复意外退出或无心跳的任务，重启期间先使旧成功证据失效。状态读者允许文件原子替换，发布者对短暂文件占用重试，并保存意外退出原因。只读出口检测在第一个 HTTPS trace 超时时尝试第二个端点，两个端点都失败仍明确返回未知，不沿用历史出口。

提权计划任务脚本位于受管理员保护的 ProgramData 目录，每个 Windows SID 使用独立任务；状态与事件仍由当前用户 DPAPI 保护。旧版本任务已按所属用户迁移，避免普通用户可替换的目录被作为长期提权脚本入口。

完整回归还修正了 Windows PowerShell 5 对无 BOM UTF-8 的解析兼容：控制台显示脚本以及 Guest Session / 节点修复测试采用明确的 UTF-8 BOM；Rust 组装脚本时剥离中间 BOM。没有删减对应断言或跳过回归。

`scripts/verify.ps1` 完整回归通过。NSIS 安装包构建通过；构建钩子显式使用当前 Windows PowerShell 的系统模块目录，避免继承 PowerShell 7 模块路径导致 `Get-FileHash` 无法发现。已将本机安装目录的旧可执行文件备份至 `.local/guardian-rollout/` 后更新为本次 release，并校验 SHA256 相同；Windows 登录启动项同步指向安装目录，避免继续启动调试构建。

当前已完成真实页面按钮、关机 / 启动、首页联动、隐藏后台运行和设置完整退出验收。系统托盘菜单未由自动化接口暴露，因此尚未自动实测托盘菜单恢复和菜单退出入口。当前 Guest 未安装 Claude Code / Desktop，其真实安装版本和外部入口启动没有现场验收证据。Native 明确显示覆盖受限，不声明完整进程网络隔离已经通过。

故障注入测试会正常关闭 / 启动正式 VM、暂停 / 恢复受管代理、关闭专用浏览器；手动运行前应保存当前工作。测试不应与另一个会修改相同基线的操作并行执行。

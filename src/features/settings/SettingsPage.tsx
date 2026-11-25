import { Checkbox } from '../../components/ui/Checkbox';
import { ResetEnvironment } from './ResetEnvironment';
import type { WorkbenchService } from '../../services/workbench';
import { useState } from 'react';
import {
  Activity,
  Archive,
  Bell,
  CircleAlert,
  Download,
  Info,
  LockKeyhole,
  Monitor,
  Power,
  Settings,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { WorkspaceHeader } from '../../components/layout/WorkspaceHeader';
import { SettingGroup, SettingRow } from '../../components/layout/SettingGroup';
import { Switch } from '../../components/ui/Switch';
import { Button } from '../../components/ui/Button';
import { DetailDialog } from '../../components/ui/DetailDialog';
import styles from './SettingsPage.module.css';

type Section =
  'overview' | 'general' | 'notifications' | 'backups' | 'updates' | 'about';
const titles: Record<Section, string> = {
  overview: '设置',
  general: '常规',
  notifications: '监控与通知',
  backups: '备份与恢复',
  updates: '更新',
  about: '关于 CodeSeam',
};

export function SettingsPage({
  service,
  virtualRuntime,
  preview,
  onReset,
  onBack,
  lastChecked,
}: {
  service: WorkbenchService;
  virtualRuntime: boolean;
  preview: boolean;
  onReset: () => void;
  onBack: () => void;
  lastChecked: string;
}) {
  const [section, setSection] = useState<Section>('overview');
  // 仅用于界面展示的偏好，不会写入真实 Windows 或 Guardian 状态。
  const [startup, setStartup] = useState(true);
  const [minorNotifications, setMinorNotifications] = useState(false);
  const [routineNotifications, setRoutineNotifications] = useState(true);
  const [exitPreview, setExitPreview] = useState(false);
  const [backupScope, setBackupScope] = useState([
    'preferences',
    'nodes',
    'runtime',
    'history',
  ]);
  const returnToOverview = () => setSection('overview');
  return (
    <>
      <WorkspaceHeader
        title={titles[section]}
        onBack={section === 'overview' ? onBack : returnToOverview}
        backLabel={section === 'overview' ? '返回工作台' : '返回设置'}
      >
        <span className={styles.headerNote}>CodeSeam 偏好与本地数据</span>
      </WorkspaceHeader>
      <div className={styles.page} key={section}>
        <p className={styles.preview}>
          <Info size={18} />
          <span>
            <strong>设置说明</strong> · 环境重置已接通；其余偏好仍为界面预览。
          </span>
        </p>
        {section === 'overview' && (
          <>
            <SettingGroup title="常规" icon={Settings}>
              <SettingRow
                title="登录 Windows 时启动 CodeSeam"
                description="日常启动偏好；实际启动状态将在接通后显示。"
              >
                <span>{startup ? '开启' : '关闭'}</span>
                <Switch
                  aria-label="登录 Windows 时启动 CodeSeam"
                  checked={startup}
                  onChange={setStartup}
                />
              </SettingRow>
              <SettingRow
                title="窗口与退出"
                description="关闭窗口行为、后台运行与完整退出。"
                onClick={() => setSection('general')}
              />
            </SettingGroup>
            <SettingGroup title="监控与通知" icon={Bell}>
              <SettingRow
                title="监控范围与通知偏好"
                description="查看守护状态，选择哪些日常信息需要提醒。"
                onClick={() => setSection('notifications')}
              >
                <span className={styles.pending}>
                  <CircleAlert size={17} />
                  守护待验证
                </span>
              </SettingRow>
            </SettingGroup>
            <SettingGroup title="备份与恢复" icon={Archive}>
              <SettingRow
                title="管理本地备份"
                description="自动恢复快照、加密导出与选择性恢复。"
                onClick={() => setSection('backups')}
              >
                仅保存在本机
              </SettingRow>
            </SettingGroup>
            <ResetEnvironment
              service={service}
              virtualRuntime={virtualRuntime}
              preview={preview}
              onReset={onReset}
            />
            <SettingGroup title="更新" icon={Download}>
              <SettingRow
                title={`CodeSeam v${__APP_VERSION__}`}
                description="查看版本与更新信息，选择合适的时间安装。"
                onClick={() => setSection('updates')}
              >
                尚未检查
              </SettingRow>
            </SettingGroup>
            <SettingGroup title="关于" icon={Info}>
              <SettingRow
                title="关于 CodeSeam"
                description="产品信息、开源组件与诊断支持。"
                onClick={() => setSection('about')}
              >
                本地独立应用
              </SettingRow>
            </SettingGroup>
          </>
        )}
        {section === 'general' && (
          <>
            <SettingGroup title="启动与后台运行" icon={Power}>
              <SettingRow
                title="登录 Windows 时启动 CodeSeam"
                description="关闭此偏好不会退出当前应用。"
              >
                <span>{startup ? '开启' : '关闭'}</span>
                <Switch
                  aria-label="登录 Windows 时启动 CodeSeam"
                  checked={startup}
                  onChange={setStartup}
                />
              </SettingRow>
              <SettingRow
                title="实际启动状态"
                description="启动项与最近后台启动结果尚未读取。"
              >
                待接通
              </SettingRow>
              <SettingRow title="最近一次环境检测">{lastChecked}</SettingRow>
            </SettingGroup>
            <SettingGroup title="窗口与系统托盘" icon={Monitor}>
              <SettingRow
                title="关闭窗口后"
                description="设计行为：隐藏到系统托盘，继续后台守护。"
              >
                待接通
              </SettingRow>
              <SettingRow
                title="当前版本行为"
                description="系统托盘尚未接通，点击窗口关闭仍会退出当前应用。"
              >
                关闭即退出
              </SettingRow>
            </SettingGroup>
            <SettingGroup title="完整退出" icon={Power}>
              <SettingRow
                title="退出 CodeSeam"
                description="退出前需确认关闭 Claude 相关应用，再停止后台守护。"
              >
                <Button onClick={() => setExitPreview(true)}>
                  预览退出确认
                </Button>
              </SettingRow>
            </SettingGroup>
          </>
        )}
        {section === 'notifications' && (
          <>
            <SettingGroup title="守护状态" icon={ShieldCheck}>
              <SettingRow
                title="Guardian"
                description="持续守护尚未接通，不能据此判断应用已受保护。"
              >
                <span className={styles.pending}>
                  <CircleAlert size={17} />
                  待验证
                </span>
              </SettingRow>
              <SettingRow
                title="计划监控范围"
                description="当前运行环境、节点与代理、专用浏览器、可识别的 Claude 应用。"
              >
                待验证
              </SettingRow>
              <SettingRow title="最近一次环境检测">{lastChecked}</SettingRow>
              <SettingRow
                title="立即深度扫描"
                description="只读取与验证环境，发现问题后由你决定下一步。"
              >
                <Button disabled title="深度扫描尚未接通">
                  开始扫描
                </Button>
              </SettingRow>
            </SettingGroup>
            <SettingGroup title="通知偏好" icon={Bell}>
              <SettingRow
                title="轻微变化提醒"
                description="L1 信息类桌面通知；关闭后仍保留事件记录。"
              >
                <Switch
                  aria-label="轻微变化提醒"
                  checked={minorNotifications}
                  onChange={setMinorNotifications}
                />
              </SettingRow>
              <SettingRow
                title="一般运行信息"
                description="例如更新可用、普通检测完成。"
              >
                <Switch
                  aria-label="一般运行信息"
                  checked={routineNotifications}
                  onChange={setRoutineNotifications}
                />
              </SettingRow>
              <SettingRow
                title="重要异常提醒"
                description="L2 / L3 事件始终保留待处理状态，不提供完全静默选项。"
              >
                <LockKeyhole size={17} />
                始终提醒
              </SettingRow>
            </SettingGroup>
            <p className={styles.note}>
              关键保护不受通知偏好影响。Windows
              通知不可用时，工作台仍需显示待处理事件。
            </p>
          </>
        )}
        {section === 'backups' && (
          <>
            <SettingGroup title="自动恢复快照" icon={Archive}>
              <SettingRow
                title="变更前保护"
                description="在修改 CodeSeam 管理的配置前创建并校验快照。"
              >
                待接通
              </SettingRow>
              <SettingRow
                title="备份列表"
                description="尚未读取本机备份；接通后展示创建时间、范围与可恢复状态。"
              >
                待读取
              </SettingRow>
            </SettingGroup>
            <SettingGroup title="导出加密备份" icon={Download}>
              <p className={styles.groupDescription}>
                选择要保存的内容。正式导出时需设置独立密码，并选择本地保存位置。
              </p>
              <fieldset className={styles.scope}>
                <legend>备份范围</legend>
                {[
                  { id: 'preferences', label: '常规与通知偏好' },
                  { id: 'nodes', label: '节点与代理配置' },
                  { id: 'runtime', label: '运行环境与受管配置记录' },
                  { id: 'history', label: '当前绑定、基线与事件记录' },
                ].map(({ id, label }) => (
                  <label key={id}>
                    <Checkbox
                      checked={backupScope.includes(id)}
                      onChange={(e) =>
                        setBackupScope(
                          e.target.checked
                            ? [...backupScope, id]
                            : backupScope.filter((item) => item !== id),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <SettingRow
                title="登录状态与个人文件不在此范围"
                description="不包含 Cookie、登录会话、项目源码、浏览器完整数据或虚拟机磁盘。"
              >
                <Button disabled title="加密备份尚未接通">
                  导出备份
                </Button>
              </SettingRow>
            </SettingGroup>
            <SettingGroup title="从备份恢复" icon={Upload}>
              <SettingRow
                title="选择备份文件"
                description="校验文件后预览恢复范围；恢复前创建快照并检查本机冲突。"
              >
                <Button disabled title="备份恢复尚未接通">
                  选择文件
                </Button>
              </SettingRow>
              <p className={styles.note}>
                恢复后需重新检测并确认环境，历史基线不会直接生效。
              </p>
            </SettingGroup>
          </>
        )}
        {section === 'updates' && (
          <>
            <SettingGroup title="软件版本" icon={Download}>
              <SettingRow title="当前版本">v{__APP_VERSION__}</SettingRow>
              <SettingRow
                title="更新状态"
                description="更新检查尚未接通，当前无法判断是否为最新版本。"
              >
                尚未检查
              </SettingRow>
              <SettingRow
                title="检查可用更新"
                description="有更新时展示版本、发布日期和变更说明。"
              >
                <Button disabled title="更新服务尚未接通">
                  检查更新
                </Button>
              </SettingRow>
            </SettingGroup>
            <SettingGroup title="安装与数据保留" icon={ShieldCheck}>
              <SettingRow
                title="由你决定安装时间"
                description="下载完成后选择立即安装或稍后安装；应用无法正常关闭时暂停安装。"
              />
              <SettingRow
                title="保留现有配置"
                description="安装包需通过签名与完整性校验，更新保留本地环境、事件与备份。"
              />
            </SettingGroup>
          </>
        )}
        {section === 'about' && (
          <>
            <SettingGroup title="CodeSeam" icon={Info}>
              <SettingRow title="产品版本">v{__APP_VERSION__}</SettingRow>
              <SettingRow
                title="本地独立应用"
                description="为 Claude 应用准备运行环境、管理网络配置与运行状态。"
              />
              <SettingRow
                title="数据归属"
                description="配置与记录保存在本机；无需 CodeSeam 账号，不提供云同步。"
              />
            </SettingGroup>
            <SettingGroup title="开源与许可" icon={Archive}>
              <SettingRow
                title="应用框架"
                description="React · Tauri · Vite · Lucide"
              />
              <SettingRow
                title="代理组件"
                description="Mihomo（Clash.Meta）· GPL-3.0；发行包附带许可证及源码来源。"
              />
            </SettingGroup>
            <SettingGroup title="诊断与支持" icon={Activity}>
              <SettingRow
                title="导出诊断报告"
                description="默认脱敏，不包含密码、登录凭据、对话内容或项目源码。"
              >
                <Button disabled title="诊断导出尚未接通">
                  导出报告
                </Button>
              </SettingRow>
              <SettingRow
                title="本地运行日志"
                description="普通日志与结构化事件分开保留。"
              >
                <Button disabled title="日志目录入口尚未接通">
                  打开日志目录
                </Button>
              </SettingRow>
              <SettingRow
                title="产品文档与支持"
                description="文档和支持入口将在发布时提供。"
              >
                待提供
              </SettingRow>
            </SettingGroup>
          </>
        )}
        <p className={styles.note}>
          节点、运行环境与专用浏览器的配置，请从左侧对应入口管理。
        </p>
      </div>
      {exitPreview && (
        <DetailDialog
          title="退出 CodeSeam？"
          closeLabel="返回设置"
          onClose={() => setExitPreview(false)}
        >
          <p>
            完整退出将先请求关闭可识别的 Claude
            相关应用，再停止后台守护。请先保存正在进行的工作。
          </p>
          <p>若有应用无法正常关闭，将暂停退出并提示你处理。</p>
          <p>当前仅预览确认样式，进程关闭与退出流程尚未接通。</p>
          <div className={styles.dialogActions}>
            <Button disabled>关闭相关应用并退出</Button>
          </div>
        </DetailDialog>
      )}
    </>
  );
}

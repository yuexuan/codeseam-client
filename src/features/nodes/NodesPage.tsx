import { WizardHeader } from '../../components/layout/WizardHeader';
import type { NodesService } from '../../services/nodes';
import { NodeEditor } from './NodeEditor';
import styles from './NodesPage.module.css';

export function NodesPage({ service }: { service: NodesService }) {
  return (
    <div className={styles.page}>
      <WizardHeader
        title="节点与代理"
        description={<> 添加代理节点，选择当前使用的节点。 </>}
      />
      <NodeEditor service={service} />
    </div>
  );
}

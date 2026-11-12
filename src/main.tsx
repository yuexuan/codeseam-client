import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/base.css';
const root = document.getElementById('root');
if (!root) throw new Error('应用挂载节点缺失');
createRoot(root).render(<App />);

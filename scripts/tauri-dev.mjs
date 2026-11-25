import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clearInterval, setInterval } from 'node:timers';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function canonicalRoot(root) {
  const path = realpathSync(root);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

export async function canReuseDevServer(url, root) {
  try {
    const response = await globalThis.fetch(new URL('/__codeseam_dev', url), {
      signal: globalThis.AbortSignal.timeout(2000),
      redirect: 'error',
    });
    if (!response.ok) return false;
    const identity = await response.json();
    return identity.app === 'codeseam' &&
      typeof identity.root === 'string' &&
      canonicalRoot(identity.root) === canonicalRoot(root);
  } catch {
    return false;
  }
}

async function main() {
  if (await canReuseDevServer('http://127.0.0.1:1420', projectRoot)) {
    console.log('Reusing CodeSeam dev server at http://127.0.0.1:1420');
    // 保持 Tauri 钩子运行，同时不接管已有开发服务器。
    const keepAlive = setInterval(() => {}, 60_000);
    const stop = () => { clearInterval(keepAlive); process.exit(0); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  const { createServer } = await import('vite');
  const server = await createServer({ root: projectRoot });
  await server.listen();
  server.printUrls();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

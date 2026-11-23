import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
export default defineConfig({
 define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
 plugins:[react()],
 resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
 clearScreen:false,
 server:{port:1420,strictPort:true,host:'127.0.0.1',watch:{ignored:['**/src-tauri/**']}},
});

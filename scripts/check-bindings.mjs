import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const temp=mkdtempSync(path.join(tmpdir(),'codeseam-bindings-')); const output=path.join(temp,'commands.ts');
try {
 const result=spawnSync('cargo',['test','--manifest-path','src-tauri/Cargo.toml','export_bindings','--','--nocapture'],{stdio:'inherit',env:{...process.env,CODESEAM_BINDINGS_PATH:output}});
 if(result.status!==0)process.exitCode=1;
 else if(readFileSync(output,'utf8').replaceAll('\r\n','\n')!==readFileSync('src/bindings/commands.ts','utf8').replaceAll('\r\n','\n')){console.error('Generated bindings drift. Run npm run bindings.');process.exitCode=1;}
 else console.log('PASS: generated bindings match Rust');
} finally {rmSync(temp,{recursive:true});}

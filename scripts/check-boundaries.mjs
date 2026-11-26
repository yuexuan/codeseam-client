import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const problems=[];
for(const file of walk('src')){
 const normalized=file.replaceAll('\\','/'); const text=readFileSync(file,'utf8');
 if(!normalized.startsWith('src/bindings/')&&/\binvoke\s*[(<]/.test(text))problems.push(`${file}: direct invoke`);
 if(normalized.startsWith('src/components/')&&/from ['"].*(?:services|features|app)\//.test(text))problems.push(`${file}: component depends on business`);
 if(normalized.startsWith('src/services/')&&/from ['"].*(?:features|components|app)\//.test(text))problems.push(`${file}: service depends on UI`);
 if(normalized.startsWith('src/features/')&&/from ['"]@tauri-apps/.test(text))problems.push(`${file}: feature depends on platform`);
 if(normalized.endsWith('.css')&&!normalized.startsWith('src/styles/')&&/#[a-f\d]{3,8}\b|rgba?\(/i.test(text))problems.push(`${file}: colors outside tokens`);
}
for (const file of walk('src-tauri/src')) {
  const relative = path.relative('src-tauri/src', file).split(path.sep).join('/');
  const [layer] = relative.split('/');
  if (relative.endsWith('.ps1') && layer !== 'platform') {
    problems.push(file + ': Windows scripts belong with their platform adapter');
  }
  if (!relative.endsWith('.rs')) continue;
  const source = readFileSync(file, 'utf8');
  if (layer !== 'desktop' && /\b(?:tauri|tauri_specta)::/.test(source)) {
    problems.push(file + ': Tauri API outside desktop');
  }
  if (layer === 'domain' && /\b(?:application|desktop|infrastructure|platform)::/.test(source)) {
    problems.push(file + ': domain depends on an outer layer');
  }
  if (['application', 'infrastructure'].includes(layer)) {
    const windowsApi = /\b(?:windows_sys::|std::os::windows|platform::windows\b)/;
    const powershellScript = /include_(?:str|bytes)!\([^)]*\.ps1"/;
    if (windowsApi.test(source) || powershellScript.test(source)) {
      problems.push(file + ': access Windows through a platform capability');
    }
  }
}
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
console.log('PASS: source layer and style boundaries');

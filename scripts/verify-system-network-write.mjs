// 必须显式选择加入：会实际修改 Windows 设置，并在每项修改后恢复原状。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
assert.equal(process.env.SYSTEM_NETWORK_MUTATE,'1','Set SYSTEM_NETWORK_MUTATE=1 only after approval for a real reversible test');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const output=path.resolve('../docs/tasks/evidence/2026-11-04-system-network');await fs.mkdir(output,{recursive:true});
const app=await chromium.connectOverCDP('http://127.0.0.1:9237');
const page=app.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost|localhost:1420/.test(p.url()));assert(page);
const invoke=(cmd,args={})=>page.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
const save=(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2));
const configuration=v=>({adapters:v.state.adapters.filter(a=>a.status!=='Not Present').map(a=>({id:a.id,ipv6:a.ipv6Enabled,dns4:a.dns4,dns6:a.dns6,static4:a.static4,static6:a.static6})).sort((a,b)=>a.id.localeCompare(b.id)),registry:[v.state.ipv6RegistryExists,v.state.ipv6RegistryValue]});
try{
  const before=await invoke('cs_system_network_inspect');await save('roundtrip-before.json',before);
  assert(!before.backups.ipv6.exists&&!before.backups.dns.exists,'An existing recovery snapshot must be restored first');
  const changes=[{action:'disable_ipv6',adapterIds:before.state.adapters.filter(a=>a.ipv6Enabled!==null&&a.status!=='Not Present').map(a=>a.id),preset:null,doh:false},{action:'set_dns',adapterIds:before.state.adapters.filter(a=>a.physical&&a.status==='Up'&&a.dnsAvailable).map(a=>a.id),preset:'quad9',doh:false}];
  const selectedActions=process.env.SYSTEM_NETWORK_ACTIONS?.split(',')||changes.map(c=>c.action);
  assert(selectedActions.every(a=>changes.some(c=>c.action===a)));
  for(const change of changes.filter(c=>selectedActions.includes(c.action))){
    const plan=await invoke('cs_system_network_plan',{change});await save(`${change.action}-plan.json`,plan);
    try{
      console.log(`UAC approval required: ${change.action}`);
      const applied=await invoke('cs_system_network_apply',{planId:plan.id});await save(`${change.action}-applied.json`,applied);assert.equal(applied.ok,true);
      const observed=await invoke('cs_system_network_inspect');await save(`${change.action}-observed.json`,observed);
      if(change.action==='disable_ipv6'){
        assert.equal(observed.state.ipv6RegistryValue,255);
        assert(observed.state.adapters.filter(a=>change.adapterIds.includes(a.id)).every(a=>a.ipv6Enabled===false));
        assert.equal(applied.rebootRequired,true);
      }else{
        assert(observed.state.adapters.filter(a=>change.adapterIds.includes(a.id)).every(a=>a.dns4.includes('9.9.9.9')&&a.dns6.includes('2620:fe::fe')));
        assert(observed.probe.answers.length);
      }
      console.log(`Verified actual Windows state: ${change.action}`);
    }catch(e){await save(`${change.action}-error.json`,{error:String(e)});throw e;}
    finally{
      const status=await invoke('cs_system_network_inspect');
      if((change.action==='disable_ipv6'?status.backups.ipv6:status.backups.dns).exists){
        console.log(`UAC approval required: restore ${change.action}`);
        const restored=await invoke('cs_system_network_restore',{action:change.action});await save(`${change.action}-restored.json`,restored);assert.equal(restored.ok,true);
        console.log(`Restored: ${change.action}`);
      }
    }
    const restored=await invoke('cs_system_network_inspect');assert.deepEqual(configuration(restored),configuration(before));
  }
  const after=await invoke('cs_system_network_inspect');await save('roundtrip-after.json',after);assert.deepEqual(configuration(after),configuration(before));assert(!after.backups.ipv6.exists&&!after.backups.dns.exists);
  await save(`roundtrip-results-${selectedActions.join('-')}.json`,{passed:true,realModificationVerified:true,restoredOriginalConfiguration:true,testedActions:selectedActions,noRebootPerformed:true});
  console.log('Real Windows IPv6 and DNS roundtrip passed; original configuration restored');
}finally{await app.close();}

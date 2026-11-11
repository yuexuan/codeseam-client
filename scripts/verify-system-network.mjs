import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { chromium }=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const output=path.resolve(process.env.SYSTEM_NETWORK_EVIDENCE||'../docs/tasks/evidence/2026-11-04-system-network');await fs.mkdir(output,{recursive:true});
const app=await chromium.connectOverCDP(process.env.CODESEAM_APP_CDP||'http://127.0.0.1:9237');
const page=app.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost|localhost:1420/.test(p.url()));assert(page,'Start the updated desktop app with a local CDP testing endpoint');
const invoke=(cmd,args={})=>page.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
const button=name=>page.getByRole('button',{name,exact:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const save=async(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2));
try{
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'环境诊断',exact:true}).click();
  await page.getByRole('tab',{name:'系统环境',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='检测系统 DNS 与 IPv6'&&!b.disabled),null,{timeout:90000});
  const before=await invoke('cs_system_network_inspect');await save('native-before.json',before);
  assert(before.state.adapters.length);assert(before.probe.source.includes('Windows'));
  assert.equal(before.backups.ipv6.exists,false,'Restore existing IPv6 changes before a verification run');
  assert.equal(before.backups.dns.exists,false,'Restore existing DNS changes before a verification run');
  const physical=before.state.adapters.filter(a=>a.physical&&a.status==='Up'&&a.dnsAvailable).map(a=>a.id);assert(physical.length);
  const dnsChange={action:'set_dns',adapterIds:physical,preset:'quad9',doh:false};
  const plan=await invoke('cs_system_network_plan',{change:dnsChange});assert(plan.requiresElevation);assert.equal(plan.profile.servers.length,4);
  if(!before.state.dohSupported){
    assert(await page.getByRole('checkbox',{name:/使用系统 DoH/}).isDisabled());
    await assert.rejects(invoke('cs_system_network_plan',{change:{...dnsChange,doh:true}}),/不支持原生 DoH/);
  }
  await assert.rejects(invoke('cs_system_network_plan',{change:{...dnsChange,preset:'arbitrary'}}),/受支持/);
  await button('预览关闭系统 IPv6').click();
  await page.getByText('即将关闭系统 IPv6',{exact:true}).waitFor({timeout:30000});
  assert.match(await page.getByRole('tabpanel',{name:'系统环境'}).innerText(),/不会自动重启/);
  await button('取消预览').click();
  await button('预览修改系统 DNS').click();
  await page.getByText('即将修改系统 DNS',{exact:true}).waitFor({timeout:30000});
  assert.match(await page.getByRole('tabpanel',{name:'系统环境'}).innerText(),/未启用加密/);
  await page.locator('.system-net-plan').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'dns-plan.png'),fullPage:true});
  await button('取消预览').click();
  if(!before.state.administrator){
    const token=BigInt(Date.now()).toString(16).padStart(32,'0');
    const dir=path.join(process.env.LOCALAPPDATA,'CodeSeam','network-ops');await fs.mkdir(dir,{recursive:true});
    const request=path.join(dir,`${token}.request.json`),result=path.join(dir,`${token}.result.json`);
    await fs.writeFile(request,JSON.stringify({op:'apply',plan:{id:plan.id,createdAt:plan.createdAt,change:dnsChange,before:plan.before}}),{flag:'wx'});
    try{
      await promisify(execFile)(path.resolve('src-tauri/target/debug/z-switch.exe'),['--codeseam-network-helper',token],{windowsHide:true});
      const denied=JSON.parse(await fs.readFile(result,'utf8'));assert.equal(denied.ok,false);assert.match(denied.error,/管理员权限/);await save('non-admin-rejection.json',denied);
    }finally{await fs.unlink(request).catch(()=>{});await fs.unlink(result).catch(()=>{});}
  }
  const after=await invoke('cs_system_network_inspect');
  const config=v=>({adapters:v.state.adapters.map(a=>({id:a.id,ipv6:a.ipv6Enabled,dns4:a.dns4,dns6:a.dns6,static4:a.static4,static6:a.static6})),registry:[v.state.ipv6RegistryExists,v.state.ipv6RegistryValue]});
  assert.deepEqual(config(after),config(before),'Read-only checks and previews must not alter system state');
  if(process.env.SYSTEM_NETWORK_MUTATE==='1'){
    const ipv6Change={action:'disable_ipv6',adapterIds:before.state.adapters.filter(a=>a.ipv6Enabled!==null&&a.status!=='Not Present').map(a=>a.id),preset:null,doh:false};
    for(const change of [ipv6Change,dnsChange]){
      const p=await invoke('cs_system_network_plan',{change});await save(`${change.action}-plan.json`,p);
      let applied=false;
      try{
        console.log(`Waiting for Windows UAC: ${change.action}`);
        const result=await invoke('cs_system_network_apply',{planId:p.id});applied=true;await save(`${change.action}-applied.json`,result);
        assert.equal(result.ok,true);
        const observed=await invoke('cs_system_network_inspect');await save(`${change.action}-observed.json`,observed);
        if(change.action==='disable_ipv6'){assert.equal(observed.state.ipv6RegistryValue,255);assert(observed.state.adapters.filter(a=>change.adapterIds.includes(a.id)).every(a=>a.ipv6Enabled===false));}
        else{assert(observed.state.adapters.filter(a=>change.adapterIds.includes(a.id)).every(a=>a.dns4.includes('9.9.9.9')));assert(observed.probe.answers.length);}
      }finally{
        const pending=await invoke('cs_system_network_inspect');
        if(applied||(change.action==='disable_ipv6'?pending.backups.ipv6.exists:pending.backups.dns.exists)){
          console.log(`Waiting for Windows UAC: restore ${change.action}`);
          await save(`${change.action}-restored.json`,await invoke('cs_system_network_restore',{action:change.action}));
        }
      }
    }
    const restored=await invoke('cs_system_network_inspect');await save('native-restored.json',restored);assert.deepEqual(config(restored),config(before));
  }
  await page.locator('main.content').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(output,'system-network.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const result={passed:true,realNativeIPC:true,readOnlyAndPreviewVerified:true,realModificationVerified:process.env.SYSTEM_NETWORK_MUTATE==='1',checks:['real adapter identities and DNS sources','actual system resolver observation','DNS and IPv6 preview without changes','unsupported DoH refuses downgrade','unknown presets rejected','non-admin helper cannot mutate','system settings unchanged after previews'],errors};
  await save('interaction-results.json',result);console.log(JSON.stringify(result,null,2));
}finally{await app.close();}

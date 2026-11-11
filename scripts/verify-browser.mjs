import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const output = path.resolve(process.env.BROWSER_EVIDENCE || '../docs/tasks/evidence/2026-11-04-browser');
await fs.mkdir(output, {recursive:true});
const app = await chromium.connectOverCDP(process.env.CODESEAM_APP_CDP || 'http://127.0.0.1:9237');
const page = app.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost|localhost:1420/.test(p.url()));
assert(page,'Run the newly built desktop client with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9237');
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const invoke = (cmd,args={}) => page.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
const button = name => page.getByRole('button',{name,exact:true});
const initial=await invoke('cs_browser_status');
assert(initial.config?.proxy, 'A real HTTP(S) proxy must be configured');
assert(!initial.running, 'Close the managed browser before starting this test');
try {
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'环境诊断',exact:true}).click();
  await page.getByRole('tab',{name:'浏览器与指纹',exact:true}).click();
  await button('启动受管浏览器并检测').click();
  await button('重新检测浏览器').waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='重新检测浏览器'&&!b.disabled),null,{timeout:45000});
  let report=await invoke('cs_browser_diagnose');
  assert.equal(report.checks.find(c=>c.id==='browser_fingerprint').status,'pass');
  assert.equal(report.checks.find(c=>c.id==='browser_egress').status,'pass');
  assert(report.checks.some(c=>c.id==='browser_region'));
  const all=await invoke('cs_diagnose');
  assert(all.checks.some(c=>c.id==='browser_region'),'Full diagnostics must include the real browser checks');
  await fs.writeFile(path.join(output,'native-live.json'),JSON.stringify(report,null,2));
  await page.locator('main.content').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.join(output,'native-live.png'),fullPage:true});
  if(!initial.config.blockWebrtc) {
    await button('一键阻止 WebRTC 直连 UDP').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='重新检测浏览器'&&!b.disabled),null,{timeout:45000});
  }
  report=await invoke('cs_browser_diagnose');
  assert.equal(report.config.blockWebrtc,true);
  assert.deepEqual(report.observed.webrtc.candidates,[]);
  await fs.writeFile(path.join(output,'native-blocked.json'),JSON.stringify(report,null,2));
  await page.getByLabel('CPU 核心数',{exact:true}).fill('6');
  assert(await button('重新检测浏览器').isDisabled());
  await page.getByRole('tab',{name:'系统环境',exact:true}).click();
  await page.getByRole('tab',{name:'浏览器与指纹',exact:true}).click();
  assert.equal(await page.getByLabel('CPU 核心数',{exact:true}).inputValue(),'6');
  await button('应用并重启、真实检测').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='重新检测浏览器'&&!b.disabled),null,{timeout:45000});
  report=await invoke('cs_browser_diagnose');
  assert.equal(report.observed.fingerprint.cores,6);
  await button('一键关闭受管浏览器').click();
  await page.getByText('受管浏览器及其子进程已关闭。',{exact:true}).waitFor();
  assert.equal((await invoke('cs_browser_status')).running,false);
  assert(await button('重新检测浏览器').isDisabled());
  await button('启动受管浏览器并检测').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='一键关闭受管浏览器'&&!b.disabled));
  const closingAt=Date.now();
  await button('一键关闭受管浏览器').click();
  await page.getByText('受管浏览器及其子进程已关闭。',{exact:true}).waitFor();
  assert(Date.now()-closingAt<4000,'Close must interrupt an in-flight probe');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='启动受管浏览器并检测'&&!b.disabled));
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'native-interaction-results.json'),JSON.stringify({passed:true,realNativeIPC:true,realBrowser:true,checks:['start and automatic probe','browser/proxy HTTPS equality','actual fingerprint','WebRTC UDP policy and empty candidates','draft persistence','edited cores applied and observed','one-click close and stopped status','close interrupts in-flight probe'],errors},null,2));
  console.log('Native browser UI and backend checks passed');
} finally {
  await invoke('cs_browser_stop');
  // 保留可用的配置档，并恢复原有指纹和 UDP 防护设置。
  await invoke('cs_browser_start',{config:{...initial.config,blockWebrtc:true}});
  await invoke('cs_browser_stop');
  await app.close().catch(()=>{});
}

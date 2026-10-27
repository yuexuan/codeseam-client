// QA harness for the installed release WebView. No production test IPC added.
// Enable WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=19222
// only in the verification process; ordinary product startup needs no tools.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.resolve(repo,'..');
const output=path.join(root,'docs/tasks/evidence/2026-10-26-P5');
await fs.mkdir(output,{recursive:true});
const pages=await(await fetch('http://127.0.0.1:19222/json/list')).json();
const page=pages.find(p=>p.url==='http://tauri.localhost/');if(!page)throw Error('Installed WebView unavailable');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let n=0;const pending=new Map();ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){pending.get(v.id)?.(v);pending.delete(v.id);}};
const cdp=(method,params={})=>new Promise(ok=>{const id=++n;pending.set(id,ok);ws.send(JSON.stringify({id,method,params}));});
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error('WebView expression failed');return r.result?.result?.value;}
const action=process.argv[2]||'status';let result;
if(action==='capture'){
 const name=process.argv[3]||'overview';
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,`${name}.png`),Buffer.from(shot.result.data,'base64'));result={screenshot:name};
}else if(action==='view'){
 const index=Number(process.argv[3]||0);
 result=await evaluate(`(async()=>{document.querySelectorAll('nav button')[${index}].click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {page:${index}};})()`);
}else if(action==='query'){
 result=await evaluate(`(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='查询用量').click();return true;})()`);
}else if(action==='close'){
 await cdp('Runtime.evaluate',{expression:`window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})`});result={closing:true};
}else if(action==='theme'){
 result=await evaluate(`(()=>{document.querySelector('[aria-label="切换明暗主题"]').click();return true;})()`);
}else{
 let args={};
 if(action==='login'){
  const f=JSON.parse(await fs.readFile(path.join(root,'codeseam-server/codeseam/deploy/.local/p2-fixture.json'),'utf8'));
  args={server:'http://127.0.0.1:18081',email:f.clients[0].email,password:f.clients[0].password};
 }
 if(action==='activate')args={id:2};
 if(action==='configure')args={confirmed:true};
 if(action==='usage')args={start:'2026-10-26',end:'2026-10-27'};
 if(action==='open_portal')args={url:'http://127.0.0.1:18081/portal/'};
 result=await evaluate(`(async()=>{try{return {ok:true,value:await window.__TAURI_INTERNALS__.invoke(${JSON.stringify('cs_'+action)},${JSON.stringify(args)})}}catch(e){return {ok:false,error:String(e)}}})()`);
 if(result?.value?.network)result.value.network.expected_egress='[redacted shared host egress]';
 if(action==='diagnose'&&result?.value){for(const c of result.value.checks){if(c.id==='egress_ipv4'){c.evidence='[redacted shared host egress]';c.detail=c.status==='pass'?'Real shared-host egress matched QA binding (not dedicated public proxy evidence)':c.detail;}}}
 await fs.writeFile(path.join(output,`${process.argv[3]||action}.json`),JSON.stringify({captured_at:new Date().toISOString(),action,...result},null,2)+'\n');
}
console.log(JSON.stringify(result,null,2));ws.close();if(result?.ok===false)process.exitCode=1;

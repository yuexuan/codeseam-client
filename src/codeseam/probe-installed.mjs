import fs from 'node:fs/promises';
const dest=new URL('../../../docs/tasks/evidence/2026-10-26-P5/',import.meta.url);
const label=process.argv[2]||'sse-final';
const started=performance.now();let result;
try{
 const r=await fetch('http://127.0.0.1:18899/claude/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':'codeseam-local-managed','anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:64,stream:true,thinking:{type:'disabled'},messages:[{role:'user',content:'Reply exactly CODESEAM_P5_INSTALLED_OK'}]}),signal:AbortSignal.timeout(30000)});
 let raw='',chunks=0,first;for await(const chunk of r.body){chunks++;first??=Math.round(performance.now()-started);raw+=new TextDecoder().decode(chunk);}
 const events=raw.split('\n').filter(l=>l.startsWith('data: ')).flatMap(l=>{try{return [JSON.parse(l.slice(6))];}catch{return [];}});
 result={http:r.status,content_type:r.headers.get('content-type'),request_id:r.headers.get('x-request-id'),chunks,first_chunk_ms:first,total_ms:Math.round(performance.now()-started),events:[...new Set(events.map(v=>v.type))],text:events.filter(v=>v.delta?.type==='text_delta').map(v=>v.delta.text).join(''),complete:events.some(v=>v.type==='message_stop')};
}catch(e){result={http:null,error:e.cause?.code||e.name,complete:false};}
await fs.mkdir(dest,{recursive:true});await fs.writeFile(new URL(label+'.json',dest),JSON.stringify({captured_at:new Date().toISOString(),...result},null,2));console.log(result);
if(process.argv.includes('--expect-blocked')){if(result.http===200||result.complete)process.exitCode=1;}else if(result.http!==200||!result.complete||result.text!=='CODESEAM_P5_INSTALLED_OK')process.exitCode=1;

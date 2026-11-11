import type { CheckItem } from "./types";
const now=()=>Math.floor(Date.now()/1000);
const config=(id:string)=>({browserId:id,proxy:"http://127.0.0.1:4651",expectedIp:"",language:"en-SG",timezone:"Asia/Singapore",width:1920,height:1080,cores:8,blockWebrtc:true});
const fixtures:Record<string,CheckItem>={};
function item(id:string,status:string,detail:string,evidence?:unknown){return {id,label:id,status,detail,evidence:evidence?JSON.stringify(evidence):undefined};}
for(const c of [item("timezone","pass","China Standard Time"),item("system_proxy","pass","127.0.0.1:4651"),item("tun","pass","Clash · 已连接"),item("local_ipv6","pass","已关闭"),item("system_dns","warning","尚未验证无直连泄漏",{queryPath:"尚未确认",resolverEgress:["10.0.0.1"]})])fixtures[c.id]=c;
const envs:Record<string,{created:boolean;config:ReturnType<typeof config>;report?:{generatedAt:number;checks:CheckItem[]}}>={chrome:{created:true,config:config("chrome")},edge:{created:false,config:config("edge")},firefox:{created:false,config:config("firefox")}};
const browserChecks=[item("browser_egress","pass","与目标出口一致"),item("browser_dns","pass","本地解析已阻断，域名请求经代理成功"),item("browser_ipv6","pass","已关闭"),item("browser_webrtc","pass","本次未发现直连候选"),item("browser_fingerprint","pass","与保存的基准一致",{observed:{language:"en-SG",timezone:"Asia/Singapore",width:1920,height:1080,cores:8}}),item("browser_region","pass","SG · 与环境一致")];
envs.chrome.report={generatedAt:now(),checks:browserChecks};
let running:string|undefined;
const adapters=[{id:"51a8d43c-d40d-489b-95cc-b047e784672f",index:1,name:"以太网",description:"示例网卡",status:"Up",physical:true,ipv6Enabled:false,dnsAvailable:true,dns4:["10.0.0.1"],dns6:[],static4:[],static6:[]}];
const state={build:26100,administrator:false,adapters,ipv6RegistryExists:true,ipv6RegistryValue:255,ipv6Routes:[],ipv6Addresses:[],dohSupported:true,bootTime:now()-3600,nrptRules:0};
const inspection=()=>({generatedAt:now(),ipv6RebootVerified:true,state,probe:{answers:["192.0.2.1"],resolverEgress:["10.0.0.1"],note:"仅用于视觉验证的示例数据"},ipv6Probe:{},backups:{ipv6:{exists:false},dns:{exists:false}}});
export async function diagnosticsPreview(cmd:string,args:Record<string,unknown>):Promise<unknown>{
 if(cmd==="cs_system_network_inspect")return inspection();
 if(cmd==="cs_system_network_plan")return {id:"fixture",before:state,change:args.change};
 if(cmd==="cs_system_network_apply"||cmd==="cs_system_network_restore")return {ok:true};
 if(cmd==="cs_diagnose_item"){
  await new Promise(resolve=>setTimeout(resolve,650));
  const id=String(args.id);return fixtures[id]??browserChecks.find(c=>c.id===id)??item(id,"not_applicable","未启用此项");
 }
 if(cmd==="cs_browser_status"){const id=String(args.browserId??"chrome");return {...envs[id],running:running===id,runningBrowserId:running,browsers:[{id:"chrome",installed:true},{id:"edge",installed:true},{id:"firefox",installed:false}]};}
 if(cmd==="cs_browser_start"){const c=args.config as ReturnType<typeof config>;running=c.browserId;envs[running]={created:true,config:c,report:{generatedAt:now(),checks:browserChecks}};return {...envs[running],running:true};}
 if(cmd==="cs_browser_stop"){running=undefined;return null;}
 if(cmd==="cs_browser_destroy"){const id=String(args.browserId);envs[id]={created:false,config:config(id)};if(running===id)running=undefined;return null;}
 return undefined;
}

(async () => {
  const request = async url => {
    try {
      const r = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(8000)});
      if (!r.ok) return {error:`HTTP ${r.status}`};
      return await r.json();
    } catch { return {error:'请求失败或超时（可能为代理、网络或 CORS 限制）'}; }
  };
  const rtc = async () => {
    if (typeof RTCPeerConnection === 'undefined') return {supported:false,candidates:[]};
    const candidates = [];
    let pc;
    try {
      pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
      pc.onicecandidate = e => {if(e.candidate) candidates.push(e.candidate.candidate);};
      pc.createDataChannel('codeseam-probe');
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(resolve => {
        const timer = setTimeout(resolve,6000);
        pc.onicegatheringstatechange = () => {if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}};
      });
      return {supported:true,candidates,gatheringState:pc.iceGatheringState};
    } catch {return {supported:true,candidates,error:'ICE 收集失败'};}
    finally {pc?.close();}
  };
  const only=globalThis.__csProbe;
  const needs=id=>!only||only===id;
  const ipv4=needs('browser_egress')||needs('browser_dns')||needs('browser_webrtc')||needs('browser_region')?await request('https://api4.ipify.org?format=json'):{};
  const ipv6=needs('browser_ipv6')?await request('https://api6.ipify.org?format=json'):{};
  const webrtc=needs('browser_webrtc')?await rtc():{};
  const geo = (needs('browser_region')||needs('browser_egress')) && typeof ipv4.ip === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4.ip) ? await request(`https://ipwho.is/${ipv4.ip}`) : {error:'未取得浏览器出口 IP'};
  const geolocation = geo.success === true ? {ip:geo.ip,success:true,country:geo.country,countryCode:geo.country_code,timezone:geo.timezone?.id,source:'ipwho.is'} : {success:false,error:geo.error || '地区查询未成功',source:'ipwho.is'};
  if (geolocation.timezone) {try {geolocation.timezone = new Intl.DateTimeFormat('en',{timeZone:geolocation.timezone}).resolvedOptions().timeZone;} catch {geolocation.timezone=null;}}
  return {ipv4,ipv6,webrtc,geolocation,fingerprint:(needs('browser_fingerprint')||needs('browser_region')||needs('browser_egress'))?{language:navigator.language,languages:navigator.languages,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,width:screen.width,height:screen.height,cores:navigator.hardwareConcurrency,canvas:(()=>{try{const c=document.createElement('canvas');c.width=240;c.height=48;const x=c.getContext('2d');x.font='16px Arial';x.fillText('CodeSeam browser baseline',3,24);let h=2166136261;for(const b of x.getImageData(0,0,240,48).data)h=Math.imul(h^b,16777619);return(h>>>0).toString(16);}catch{return null;}})(),fonts:['Arial','Segoe UI','Microsoft YaHei','Consolas'].filter(f=>document.fonts.check('12px "'+f+'"')),userAgent:navigator.userAgent,platform:navigator.platform,webgl:(()=>{try{const gl=document.createElement('canvas').getContext('webgl');return gl?.getParameter(gl.RENDERER);}catch{return null;}})()}:{}};
})()

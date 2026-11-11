//! Firefox 使用原生 WebDriver BiDi 端点，不使用 Chromium CDP。
use super::*;
pub(super) async fn launch_firefox(config: Config) -> Result<Session, String> {
    let profile = profile_dir(&config.browser_id)?;
    std::fs::create_dir_all(&profile).map_err(|_| "无法创建 Firefox 环境")?;
    let proxy = reqwest::Url::parse(&config.proxy).map_err(|_| "代理地址无效")?;
    if proxy.scheme() != "http" {
        return Err("Firefox 请使用代理与网络中的本机 HTTP 代理".into());
    }
    let host = proxy.host_str().ok_or("代理主机无效")?;
    let port = proxy.port_or_known_default().ok_or("代理端口无效")?;
    let prefs = json!({"network.proxy.type":1,"network.proxy.http":host,"network.proxy.http_port":port,"network.proxy.ssl":host,"network.proxy.ssl_port":port,"network.proxy.no_proxies_on":"","network.proxy.failover_direct":false,"network.trr.mode":5,"network.dns.disablePrefetch":true,"network.prefetch-next":false,"network.http.http3.enable":false,"network.dns.disableIPv6":true,"intl.accept_languages":config.language,"dom.maxHardwareConcurrency":config.cores,"media.peerconnection.ice.proxy_only":config.block_webrtc,"media.peerconnection.ice.no_host":config.block_webrtc,"browser.shell.checkDefaultBrowser":false,"browser.startup.page":0});
    let text = prefs
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| format!("user_pref({}, {});", serde_json::to_string(k).unwrap(), v))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(profile.join("user.js"), text).map_err(|_| "无法保存 Firefox 首选项")?;
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").map_err(|_| "无法分配 Firefox 连接端口")?;
    let port = listener
        .local_addr()
        .map_err(|_| "无法读取 Firefox 连接端口")?
        .port();
    drop(listener);
    let mut command = Command::new(executable_for("firefox")?);
    command
        .args(["--no-remote", "--profile"])
        .arg(&profile)
        .arg("--remote-debugging-port")
        .arg(port.to_string())
        .arg("about:blank")
        .env("TZ", &config.timezone)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|_| "无法启动 Firefox")?;
    let (tx, mut rx) = mpsc::channel::<Request>(32);
    let errors = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
    let mut session = Session {
        child,
        cdp: Cdp { tx },
        config: config.clone(),
        errors,
        task: tokio::spawn(async {}),
        _proxy: None,
        #[cfg(windows)]
        _job: None,
    };
    #[cfg(windows)]
    {
        session._job = Some(Job::new(&session.child)?);
    }
    let endpoint = format!("ws://127.0.0.1:{port}/session");
    let mut socket = None;
    for _ in 0..100 {
        if session
            .child
            .try_wait()
            .map_err(|_| "无法读取 Firefox 状态")?
            .is_some()
        {
            return Err("Firefox 提前退出，请关闭旧环境后重试".into());
        }
        if let Ok((ws, _)) = connect_async(&endpoint).await {
            socket = Some(ws);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let (mut sink, mut stream) = socket
        .ok_or("无法连接 Firefox，请使用支持 WebDriver BiDi 的版本")?
        .split();
    session.task = tokio::spawn(async move {
        let mut next = 0u64;
        let mut pending = HashMap::new();
        loop {
            tokio::select! {
                req=rx.recv()=>{let Some(r)=req else{break};next+=1;pending.insert(next,r.result);if sink.send(Message::Text(json!({"id":next,"method":r.method,"params":r.params}).to_string().into())).await.is_err(){break}},
                msg=stream.next()=>{
                    let raw=match msg{Some(Ok(Message::Text(v)))=>v,Some(Ok(Message::Ping(v)))=>{if sink.send(Message::Pong(v)).await.is_err(){break};continue},Some(Err(_))|None|Some(Ok(Message::Close(_)))=>break,_=>continue};
                    let Ok(v)=serde_json::from_str::<Value>(&raw)else{continue};
                    if let Some(id)=v["id"].as_u64(){if let Some(tx)=pending.remove(&id){let result=if v["type"]=="error"{Err(format!("Firefox：{}",v["message"].as_str().unwrap_or("命令未完成")))}else{Ok(v["result"].clone())};let _:Result<_,_>=tx.send(result);}}
                }
            }
        }
    });
    session
        .cdp
        .call("session.new", json!({"capabilities":{}}), None)
        .await?;
    session
        .cdp
        .call(
            "emulation.setTimezoneOverride",
            json!({"timezone":config.timezone}),
            None,
        )
        .await
        .map_err(|_| "此 Firefox 版本不支持时区配置，请升级到 Firefox 144 或更新版本")?;
    // 仅规范化屏幕指标。原生用户代理、Canvas、WebGL 和字体仍可被观察，并与已保存的基线比较。
    let preload=format!("() => {{for(const [key,value] of Object.entries({{width:{},height:{},availWidth:{},availHeight:{}}})) Object.defineProperty(screen,key,{{get:()=>value,configurable:true}});}}",config.width,config.height,config.width,config.height);
    session
        .cdp
        .call(
            "script.addPreloadScript",
            json!({"functionDeclaration":preload}),
            None,
        )
        .await?;
    session
        .cdp
        .call("browsingContext.create", json!({"type":"tab"}), None)
        .await?;
    Ok(session)
}
pub(super) async fn firefox_observe(s: &Probe, expression: &str) -> Result<Value, String> {
    let target = s
        .cdp
        .call(
            "browsingContext.create",
            json!({"type":"tab","background":true}),
            None,
        )
        .await?;
    let id = target["context"].as_str().ok_or("Firefox 未创建检测页面")?;
    let result:Result<Value,String>=async{
        s.cdp.call("browsingContext.navigate",json!({"context":id,"url":"data:text/html,<title>CodeSeam diagnostic</title>","wait":"complete"}),None).await?;
        let selector=expression.split_once("; ").map(|(v,_)|v).unwrap_or("globalThis.__csProbe=null");
        let script=format!("(async()=>{{{selector};return JSON.stringify(await ({PROBE}));}})()");
        let raw=s.cdp.call("script.evaluate",json!({"expression":script,"target":{"context":id},"awaitPromise":true}),None).await?;
        if raw["type"]=="exception"{return Err("Firefox 检测脚本执行失败".into())}
        serde_json::from_str(raw["result"]["value"].as_str().ok_or("Firefox 未返回检测数据")?).map_err(|_|"Firefox 检测数据无效".into())
    }.await;
    let _ = s
        .cdp
        .call("browsingContext.close", json!({"context":id}), None)
        .await;
    result
}

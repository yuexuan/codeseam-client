use super::vault;
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

pub const VERSION: &str = "v1.19.34";
pub struct Engine {
    child: Child,
    #[cfg(windows)]
    _job: super::managed_process::Job,
    dir: PathBuf,
    client: reqwest::blocking::Client,
    base: String,
    secret: String,
    pub ports: Vec<u16>,
}
fn port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|s| s.local_addr())
        .map(|a| a.port())
        .map_err(|_| "无法分配本地端口".into())
}
impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.dir);
    }
}
impl Engine {
    pub fn start(configs: &[Value]) -> Result<Self, String> {
        let root = vault::dir()?.join("mihomo");
        fs::create_dir_all(&root).map_err(|_| "无法创建内核目录")?;
        let binary = root.join("mihomo-v1.19.34.exe");
        if !binary.exists() {
            fs::write(&binary, include_bytes!("../../resources/mihomo.exe"))
                .map_err(|_| "无法释放 Mihomo 内核")?;
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = root.join(format!("session-{}-{nonce}", std::process::id()));
        fs::create_dir(&dir).map_err(|_| "无法创建检测会话")?;
        let result = Self::launch(configs, &binary, dir.clone());
        if result.is_err() {
            let _ = fs::remove_dir_all(dir);
        }
        result
    }
    fn launch(configs: &[Value], binary: &std::path::Path, dir: PathBuf) -> Result<Self, String> {
        let api = port()?;
        let secret = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let mut providers = serde_json::Map::new();
        let mut groups = Vec::new();
        let mut listeners = Vec::new();
        let mut ports = Vec::new();
        for (i, config) in configs.iter().enumerate() {
            let content = if let Some(uri) = config["uri"].as_str() {
                uri.to_owned()
            } else {
                serde_json::to_string(&json!({"proxies":[config]})).map_err(|_| "节点配置无效")?
            };
            fs::write(dir.join(format!("p{i}.yaml")), content).map_err(|_| "无法写入检测配置")?;
            providers.insert(format!("p{i}"), json!({"type":"file", "path":format!("p{i}.yaml"), "health-check":{"enable":false}}));
            groups.push(json!({"name":format!("g{i}"),"type":"select","use":[format!("p{i}")]}));
            let p = port()?;
            ports.push(p);
            listeners.push(json!({"name":format!("l{i}"),"type":"mixed","listen":"127.0.0.1","port":p,"proxy":format!("g{i}")}));
        }
        let config = json!({"external-controller":format!("127.0.0.1:{api}"),"secret":secret,"allow-lan":false,"mode":"rule","log-level":"silent","ipv6":false,"proxy-providers":providers,"proxy-groups":groups,"listeners":listeners,"rules":["MATCH,REJECT"],"profile":{"store-selected":false},"geoip":false});
        fs::write(
            dir.join("config.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .map_err(|_| "无法写入内核配置")?;
        let mut command = Command::new(binary);
        command
            .arg("-d")
            .arg(&dir)
            .arg("-f")
            .arg(dir.join("config.json"))
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|_| "Mihomo 启动失败")?;
        #[cfg(windows)]
        let job = match super::managed_process::Job::new(&child) {
            Ok(job) => job,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|_| "无法连接内核 API")?;
        let mut engine = Self {
            child,
            #[cfg(windows)]
            _job: job,
            dir,
            client,
            base: format!("http://127.0.0.1:{api}"),
            secret,
            ports,
        };
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(15) {
            if engine.get("/version").is_ok() {
                return Ok(engine);
            }
            if engine.child.try_wait().ok().flatten().is_some() {
                return Err("Mihomo 无法加载节点配置".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Mihomo API 启动超时".into())
    }
    pub fn get(&self, path: &str) -> Result<Value, String> {
        let response = self
            .client
            .get(format!("{}{path}", self.base))
            .bearer_auth(&self.secret)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| "Mihomo API 请求失败")?;
        let mut bytes = Vec::new();
        response
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "内核响应读取失败")?;
        serde_json::from_slice(&bytes).map_err(|_| "内核响应无效".into())
    }
    pub fn node(&self, i: usize) -> Result<Value, String> {
        let provider = self.get(&format!("/providers/proxies/p{i}"))?;
        let nodes = provider["proxies"].as_array().ok_or("内核未解析到节点")?;
        if nodes.len() != 1 {
            return Err("节点解析数量不匹配".into());
        }
        Ok(nodes[0].clone())
    }
    pub fn delay(&self, i: usize, name: &str) -> Result<u32, String> {
        let name: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
        self.get(&format!("/providers/proxies/p{i}/{name}/healthcheck?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=5000"))?["delay"].as_u64().map(|v| v.min(u32::MAX as u64) as u32).ok_or("测速失败".into())
    }
}

use std::{
    fs::{self, File},
    hash::{DefaultHasher, Hash, Hasher},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

static PROGRESS: Mutex<(u64, Option<u64>)> = Mutex::new((0, None));

pub fn status() -> serde_json::Value {
    let p = PROGRESS.lock().unwrap_or_else(|e| e.into_inner());
    serde_json::json!({"received": p.0, "total": p.1})
}

fn validate(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| format!("无法读取安装镜像：{e}"))?;
    let mut magic = [0; 5];
    file.seek(SeekFrom::Start(32769))
        .map_err(|e| e.to_string())?;
    file.read_exact(&mut magic)
        .map_err(|_| "安装镜像不完整".to_string())?;
    if &magic != b"CD001" {
        return Err("文件不是有效 ISO 镜像（可能下载到了错误页面）".into());
    }
    Ok(())
}

pub fn prepare(source: &str, cache: &Path) -> Result<PathBuf, String> {
    *PROGRESS.lock().unwrap_or_else(|e| e.into_inner()) = (0, None);
    let source = source.trim();
    if !source.starts_with("http://") && !source.starts_with("https://") {
        let path = PathBuf::from(source);
        if !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("iso"))
        {
            return Err("请提供 ISO 本地路径或 HTTP(S) 地址".into());
        }
        validate(&path)?;
        return path.canonicalize().map_err(|e| e.to_string());
    }
    let url = url::Url::parse(source).map_err(|e| e.to_string())?;
    if !url.path().to_ascii_lowercase().ends_with(".iso") || url.host_str().is_none() {
        return Err("下载地址必须指向 ISO 文件".into());
    }
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let mut hash = DefaultHasher::new();
    source.hash(&mut hash);
    let path = cache.join(format!("{:016x}.iso", hash.finish()));
    if path.exists() && validate(&path).is_ok() {
        return Ok(path);
    }
    let partial = path.with_extension("part");
    let result = (|| {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(6 * 60 * 60))
            .https_only(url.scheme() == "https")
            .build()
            .map_err(|e| e.to_string())?;
        let mut response = client
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("镜像下载失败：{e}"))?;
        let total = response.content_length();
        let mut file = File::create(&partial).map_err(|e| e.to_string())?;
        let mut received = 0u64;
        let mut buffer = vec![0; 256 * 1024];
        loop {
            let n = response
                .read(&mut buffer)
                .map_err(|e| format!("镜像下载中断，请重试：{e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buffer[..n])
                .map_err(|e| format!("保存镜像失败：{e}"))?;
            received += n as u64;
            *PROGRESS.lock().unwrap_or_else(|e| e.into_inner()) = (received, total);
        }
        if received == 0 || total.is_some_and(|n| n != received) {
            return Err("镜像下载不完整，请重试".into());
        }
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        validate(&partial)?;
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        fs::rename(&partial, &path).map_err(|e| e.to_string())?;
        Ok(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn rejects_error_pages_and_incomplete_downloads() {
        let root =
            std::env::temp_dir().join(format!("codeseam-image-errors-{}", std::process::id()));
        for (code, length, body) in [
            ("404 Not Found", 4, "oops"),
            ("200 OK", 4, "html"),
            ("200 OK", 100, "short"),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let source = format!("http://{}/system.iso", listener.local_addr().unwrap());
            let worker = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                stream.read(&mut request).unwrap();
                write!(stream, "HTTP/1.1 {code}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n{body}").unwrap();
            });
            assert!(prepare(&source, &root).is_err());
            worker.join().unwrap();
            assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn downloads_validates_and_reuses_cache() {
        let root = std::env::temp_dir().join(format!("codeseam-image-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let source = format!(
            "http://{}/system.iso?download=1",
            listener.local_addr().unwrap()
        );
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            let mut body = vec![0; 40000];
            body[32769..32774].copy_from_slice(b"CD001");
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        });
        let path = prepare(&source, &root).unwrap();
        worker.join().unwrap();
        assert_eq!(prepare(&source, &root).unwrap(), path);
        assert_eq!(
            prepare(path.to_str().unwrap(), &root).unwrap(),
            path.canonicalize().unwrap()
        );
        fs::write(root.join("bad.iso"), b"error page").unwrap();
        assert!(prepare(root.join("bad.iso").to_str().unwrap(), &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

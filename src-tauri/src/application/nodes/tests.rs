use super::import::{identity, parse_content, parse_link, validate_proxy};
use super::probe::{detect_exit, test, test_proxy, test_with_progress};
use super::*;
use crate::infrastructure::vault;
use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
    Engine,
};
use std::time::Duration;
#[test]
#[ignore = "requires explicitly supplied node URI; does not modify installed nodes"]
fn supplied_node_probe() {
    let uri = std::env::var("CODESEAM_PROBE_URI").expect("node URI required");
    let record = parse_link(&uri).unwrap();
    let engine = mihomo::Engine::start(&[native_config(&record)]).unwrap();
    let parsed = engine.node(0).unwrap();
    let node: serde_json::Value = serde_json::from_str(&identity(&record)).unwrap();
    println!(
        "parsed protocol={}, cipher={}, server={}, port={}",
        node["type"], node["cipher"], node["server"], node["port"]
    );
    let endpoint: std::net::SocketAddr = format!(
        "{}:{}",
        node["server"].as_str().unwrap(),
        node["port"].as_u64().unwrap()
    )
    .parse()
    .unwrap();
    let started = std::time::Instant::now();
    let tcp = std::net::TcpStream::connect_timeout(&endpoint, Duration::from_secs(5));
    println!(
        "TCP result={:?}, elapsed={}ms",
        tcp.as_ref().map(|_| ()).map_err(|e| e.kind()),
        started.elapsed().as_millis()
    );
    let delay = engine.delay(0, parsed["name"].as_str().unwrap());
    let exit = test_proxy(&GeneralProxy {
        protocol: "http".into(),
        server: "127.0.0.1".into(),
        port: engine.ports[0],
        username: String::new(),
        password: String::new(),
    });
    println!(
        "delay={delay:?}; exit={:?}",
        exit.map(|(ms, _, country)| (ms, country))
    );
}
#[test]
#[ignore = "read-only probe of explicitly authorized installed nodes"]
fn installed_nodes_probe() {
    let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
    let store = load().unwrap();
    let configs = store.nodes.iter().map(native_config).collect::<Vec<_>>();
    let engine = mihomo::Engine::start(&configs).unwrap();
    std::thread::scope(|scope| {
        for i in (0..store.nodes.len()).step_by(12) {
            let engine = &engine;
            scope.spawn(move || {
                let node = engine.node(i).unwrap();
                let delay = engine.delay(i, node["name"].as_str().unwrap());
                let exit = test_proxy(&GeneralProxy {
                    protocol: "http".into(),
                    server: "127.0.0.1".into(),
                    port: engine.ports[i],
                    username: String::new(),
                    password: String::new(),
                });
                println!(
                    "node {i}: delay={delay:?}, exit={:?}",
                    exit.map(|(_, _, country)| country)
                );
            });
        }
    });
}
#[test]
fn exit_detection_falls_back_and_rejects_invalid_ip() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let worker = std::thread::spawn(move || {
        for body in ["ip=not-an-ip\nloc=JP\n", "ip=203.0.113.7\nloc=JP\n"] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
    });
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let first = format!("http://{address}/first");
    let second = format!("http://{address}/second");
    let (_, ip, country) = detect_exit(&client, &[&first, &second]).unwrap();
    assert_eq!(ip, "203.0.113.7");
    assert_eq!(country.as_deref(), Some("jp"));
    worker.join().unwrap();
}
#[cfg(windows)]
#[test]
fn encrypted_store_preserves_selection_and_never_returns_credentials() {
    let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("codeseam-nodes-test-{}", std::process::id()));
    let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
    std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
    let result = std::panic::catch_unwind(|| {
        import_proxy(GeneralProxy {
            protocol: "socks5".into(),
            server: "localhost".into(),
            port: 1080,
            username: "fixture-user".into(),
            password: "fixture-secret".into(),
        })
        .unwrap();
        assert!(has_nodes().unwrap());
        let snapshot = read().unwrap();
        assert!(snapshot.selected_id.is_none());
        let id = snapshot.nodes[0].id.clone();
        select(id.clone()).unwrap();
        assert_eq!(read().unwrap().selected_id, Some(id.clone()));
        let public = serde_json::to_string(&read().unwrap()).unwrap();
        assert!(!public.contains("fixture-user") && !public.contains("fixture-secret"));
        let encrypted = std::fs::read(vault::dir().unwrap().join("proxy-nodes-v1.dpapi")).unwrap();
        assert!(!encrypted.windows(14).any(|w| w == b"fixture-secret"));
        clear().unwrap();
        assert!(read().unwrap().nodes.is_empty());
        assert!(read().unwrap().selected_id.is_none());
        remove(id).unwrap();
        assert!(read().unwrap().selected_id.is_none());
        assert!(!has_nodes().unwrap());
    });
    match prior {
        Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
        None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
    };
    std::fs::remove_dir_all(root).unwrap();
    if let Err(error) = result {
        std::panic::resume_unwind(error);
    }
}
#[test]
fn imports_are_atomic_and_do_not_invent_exit_facts() {
    let nodes =
        parse_content("vless://user@example.com:443#SG\n trojan://secret@example.org:443#HK")
            .unwrap();
    assert_eq!(nodes.len(), 2);
    assert!(nodes.iter().all(|n| n.summary.region.is_none()
        && n.summary.latency.is_none()
        && n.summary.status == "untested"));
    assert!(parse_content("vless://user@example.com:443#ok\ninvalid").is_err());
    assert!(parse_content("proxies:\n- name: broken\n  type: ss").is_err());
    assert!(parse_content("proxies: []").is_err());
}
#[test]
#[ignore = "explicit live local proxy check"]
fn live_proxy_exit_via_mihomo() {
    let proxy =
        serde_json::json!({"name":"live-local","type":"http","server":"127.0.0.1","port":4651});
    let engine = mihomo::Engine::start(&[proxy]).unwrap();
    let name = engine.node(0).unwrap()["name"].as_str().unwrap().to_owned();
    let delay = engine.delay(0, &name).unwrap();
    let (_, ip, country) = test_proxy(&GeneralProxy {
        protocol: "http".into(),
        server: "127.0.0.1".into(),
        port: engine.ports[0],
        username: String::new(),
        password: String::new(),
    })
    .unwrap();
    assert!(ip.parse::<std::net::IpAddr>().is_ok());
    assert!(country.is_some());
    println!("Live exit IP verified through Mihomo; country={country:?}; delay={delay}ms");
}
#[test]
fn mihomo_parses_uri_and_yaml_via_provider_api() {
    let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
    let configs = vec![
        serde_json::json!({"uri":"trojan://fixture-password@127.0.0.1:9#fixture"}),
        serde_json::json!({"name":"香港 node + / #","type":"http","server":"127.0.0.1","port":9}),
    ];
    let engine = mihomo::Engine::start(&configs).unwrap();
    assert_eq!(engine.node(0).unwrap()["name"], "fixture");
    assert_eq!(engine.node(1).unwrap()["name"], "香港 node + / #");
    assert!(engine
        .delay(1, "香港 node + / #")
        .unwrap_err()
        .contains("503"));
    assert!(engine.delay(0, "fixture").is_err());
}
#[test]
fn http_subscription_imports_all_nodes_and_deduplicates_retry() {
    use std::io::{Read, Write};
    let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("codeseam-http-test-{}", std::process::id()));
    let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
    std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let worker = std::thread::spawn(move || {
        let body = STANDARD.encode(
            (0..10)
                .map(|i| format!("trojan://fixture-{i}@127.0.0.1:9#node-{i}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        for _ in 0..4 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let length = stream.read(&mut request).unwrap();
            if String::from_utf8_lossy(&request[..length]).contains("mihomo/1.19.34") {
                write!(
                    stream,
                    "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
                continue;
            }
            assert!(String::from_utf8_lossy(&request[..length]).contains("ClashforWindows/0.20.39"));
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
    });
    let result = std::panic::catch_unwind(|| {
        let first = import_links(format!("http://{address}/subscription")).unwrap();
        assert_eq!(first.added, 10);
        let retry = import_links(format!("http://{address}/subscription")).unwrap();
        assert_eq!((retry.added, retry.duplicates), (0, 10));
        assert_eq!(read().unwrap().nodes.len(), 10);
        let updates = std::cell::RefCell::new(Vec::new());
        test_with_progress(|snapshot| {
            if updates.borrow().is_empty() {
                select(snapshot.nodes[1].id.clone()).unwrap();
            }
            updates.borrow_mut().push(snapshot);
        })
        .unwrap();
        let current = read().unwrap();
        assert_eq!(current.selected_id.as_ref(), Some(&current.nodes[1].id));
        let updates = updates.into_inner();
        assert_eq!(updates.len(), 22); // 包含排队、十次开始、十次结果和停止事件。
        assert!(updates
            .iter()
            .all(|s| s.nodes.iter().filter(|n| n.status == "testing").count() <= 8));
        assert!(updates
            .iter()
            .any(|s| s.nodes.iter().any(|n| n.status == "queued")
                && s.nodes.iter().any(|n| n.status == "testing")));
        assert!(updates
            .iter()
            .any(|s| s.nodes.iter().any(|n| n.status == "testing")));
        assert!(updates
            .iter()
            .any(|s| s.nodes.iter().filter(|n| n.status == "failed").count() == 1));
        assert_eq!(updates.last().unwrap().runtime.running, Some(false));
        assert!(updates
            .first()
            .unwrap()
            .nodes
            .iter()
            .all(|n| n.status == "queued"));
        assert!(updates
            .last()
            .unwrap()
            .nodes
            .iter()
            .all(|n| n.status == "failed" && n.exit_ip.is_none()));
    });
    worker.join().unwrap();
    match prior {
        Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
        None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
    }
    std::fs::remove_dir_all(root).unwrap();
    result.unwrap();
}
#[test]
fn identity_ignores_names_but_preserves_authentication() {
    let a = parse_link("trojan://secret@example.com:443#first").unwrap();
    let b = parse_link("trojan://secret@example.com:443#renamed").unwrap();
    let c = parse_link("trojan://different@example.com:443#first").unwrap();
    assert_eq!(identity(&a), identity(&b));
    assert_ne!(identity(&a), identity(&c));
    let plain = parse_link("ss://aes-128-gcm:secret@example.com:1234#one").unwrap();
    let encoded = parse_link(&format!(
        "ss://{}@example.com:1234#two",
        STANDARD_NO_PAD.encode("aes-128-gcm:secret")
    ))
    .unwrap();
    assert_eq!(identity(&plain), identity(&encoded));
    assert_eq!(
        parse_content(
            &STANDARD.encode("vless://user@example.com:443#a\nvless://other@example.com:443#b")
        )
        .unwrap()
        .len(),
        2
    );
    assert!(parse_content("YQ==").is_err());
}
#[test]
#[ignore = "requires local Mihomo and an explicitly supplied subscription"]
fn real_subscription_roundtrip() {
    let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("codeseam-live-{}", std::process::id()));
    std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
    let url = std::env::var("CODESEAM_SUBSCRIPTION_URL").expect("subscription required");
    let first = import_links(url.clone()).unwrap();
    assert!(first.added > 1);
    let second = import_links(url).unwrap();
    assert_eq!(second.added, 0);
    assert_eq!(second.duplicates, first.added + first.duplicates);
    test().unwrap();
    let snapshot = read().unwrap();
    let connected = snapshot
        .nodes
        .iter()
        .filter(|n| n.status == "connected")
        .count();
    println!(
        "Imported {}, duplicate retry skipped {}, real exits detected {}",
        first.added, second.duplicates, connected
    );
    assert!(connected > 0);
    std::env::remove_var("CODESEAM_TEST_DATA_DIR");
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn validates_ports_hosts_and_protocols() {
    let mut proxy = GeneralProxy {
        protocol: "socks5".into(),
        server: "localhost".into(),
        port: 1080,
        username: "".into(),
        password: "".into(),
    };
    assert!(validate_proxy(&proxy).is_ok());
    proxy.port = 0;
    assert!(validate_proxy(&proxy).is_err());
    proxy.port = 1080;
    proxy.server = "host/path".into();
    assert!(validate_proxy(&proxy).is_err());
    proxy.server = "localhost".into();
    proxy.protocol = "ftp".into();
    assert!(validate_proxy(&proxy).is_err());
}

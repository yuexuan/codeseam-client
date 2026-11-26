use crate::application::{guardian, nodes, runtime, runtime::virtual_runtime, workbench};
use crate::platform::browser;

pub fn prepare(virtual_runtime: bool, browser: String) -> Result<String, String> {
    execute(virtual_runtime, browser, "prepare".into())
}

pub fn execute(virtual_runtime: bool, browser: String, action: String) -> Result<String, String> {
    if ![
        "prepare",
        "open",
        "inspect",
        "confirm",
        "install_code",
        "install_desktop",
        "verify",
        "recreate",
    ]
    .contains(&action.as_str())
    {
        return Err("未知浏览器操作".into());
    }
    if !["", "edge", "chrome"].contains(&browser.as_str()) {
        return Err("不支持的浏览器".into());
    }
    let runtime_locked = workbench::load()?.is_some_and(|record| {
        record["reconfiguration"].is_object()
            || record["nodeRepair"].is_object()
            || record["virtualRuntime"] != virtual_runtime
            || guardian::allows_launch(&record).is_err()
    });
    if runtime_locked && ["open", "install_code", "install_desktop"].contains(&action.as_str()) {
        return Err("该运行环境尚未成为正式 Runtime，请完成或取消重新配置后再打开 Claude".into());
    }
    if virtual_runtime {
        let snapshot = nodes::read()?;
        let node = snapshot
            .nodes
            .into_iter()
            .find(|n| {
                Some(&n.id) == snapshot.selected_id.as_ref()
                    && n.status == "connected"
                    && n.exit_ip.is_some()
            })
            .ok_or("请先选择并测试当前节点")?;
        return virtual_runtime::execute(
            "browser_prepare".into(),
            browser::guest_request(&browser, &action, &node, runtime_locked).to_string(),
        );
    }
    let runtime = runtime::read()?;
    if !runtime.confirmed {
        return Err("请先在第四步确认当前运行环境".into());
    }
    let timezone = runtime::timezone_target(&runtime.node)
        .ok_or("无法确定所选出口的目标时区，请返回第二步重新测试节点")?;
    let config = nodes::virtual_node_config()?;
    // 复用捆绑引擎的提供商验证和二进制提取逻辑。
    let engine = crate::infrastructure::mihomo::Engine::start(&[config.clone()])?;
    engine.node(0)?;
    drop(engine);
    browser::run_native(
        &browser,
        &action,
        &runtime.node,
        &timezone,
        config,
        runtime_locked,
    )
}

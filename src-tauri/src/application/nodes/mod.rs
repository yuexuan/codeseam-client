mod import;
mod probe;
pub(crate) mod recovery;
mod store;
#[cfg(test)]
mod tests;

use crate::{domain::nodes::*, infrastructure::mihomo};
use import::native_config;
pub(crate) use import::{import_links, import_proxy};
use probe::TEST_RUNNING;
pub(crate) use probe::{test_all_in_background, test_ordered_with_progress, verify_runtime_exit};
use store::{load, save, store_lock, Store};

pub fn has_nodes() -> Result<bool, String> {
    let _guard = store_lock()?;
    Ok(!load()?.nodes.is_empty())
}
pub fn read() -> Result<NodeSnapshot, String> {
    let _guard = store_lock()?;
    let store = load()?;
    Ok(NodeSnapshot {
        nodes: store.nodes.into_iter().map(|r| r.summary).collect(),
        selected_id: store.selected_id,
        runtime: ProxyRuntime {
            running: Some(TEST_RUNNING.load(std::sync::atomic::Ordering::Acquire)),
            version: Some(mihomo::VERSION.into()),
        },
    })
}
pub(crate) fn virtual_node_config() -> Result<serde_json::Value, String> {
    let _guard = store_lock()?;
    let store = load()?;
    let item = store
        .nodes
        .iter()
        .find(|n| Some(&n.summary.id) == store.selected_id.as_ref())
        .ok_or("请先选择节点")?;
    if item.summary.status != "connected" {
        return Err("请先测试所选节点".into());
    }
    Ok(native_config(item))
}
pub(crate) fn with_selected<T>(
    expected: &NodeSummary,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = store_lock()?;
    let store = load()?;
    let actual = store
        .nodes
        .iter()
        .find(|n| Some(&n.summary.id) == store.selected_id.as_ref())
        .map(|n| &n.summary);
    if actual
        .map(serde_json::to_value)
        .transpose()
        .map_err(|e| e.to_string())?
        != Some(serde_json::to_value(expected).map_err(|e| e.to_string())?)
    {
        return Err("所选出口已变化，请重新检测后确认".into());
    }
    action()
}
pub fn select(id: String) -> Result<(), String> {
    let _guard = store_lock()?;
    let mut store = load()?;
    if !store.nodes.iter().any(|r| r.summary.id == id) {
        return Err("节点已不存在，请重新选择".into());
    }
    store.selected_id = Some(id);
    save(&store)
}
pub fn remove(id: String) -> Result<(), String> {
    let _guard = store_lock()?;
    let mut store = load()?;
    store.nodes.retain(|r| r.summary.id != id);
    if store.selected_id.as_ref() == Some(&id) {
        store.selected_id = None;
    }
    save(&store)
}
pub fn clear() -> Result<(), String> {
    let _guard = store_lock()?;
    save(&Store::default())
}

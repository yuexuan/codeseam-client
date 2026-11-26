use crate::{domain::nodes::NodeSummary, infrastructure::vault};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct Store {
    pub(super) nodes: Vec<Record>,
    pub(super) selected_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub(super) struct Record {
    pub(super) summary: NodeSummary,
    pub(super) config: serde_json::Value,
}
// 保护短时读写事务，不锁定网络请求。
static STORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub(super) fn store_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK.lock().map_err(|_| "节点记录正忙，请重试".into())
}
pub(super) fn load() -> Result<Store, String> {
    match vault::read("proxy-nodes-v1.dpapi")? {
        Some(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "节点记录无法读取，原文件已保留".into())
        }
        None => Ok(Store::default()),
    }
}
pub(super) fn save(store: &Store) -> Result<(), String> {
    vault::save(
        "proxy-nodes-v1.dpapi",
        &serde_json::to_vec(store).map_err(|_| "节点保存失败")?,
    )
}

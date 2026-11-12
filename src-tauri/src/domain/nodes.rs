use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub region: Option<String>,
    pub country_code: Option<String>,
    pub latency: Option<u32>,
    pub exit_ip: Option<String>,
    pub status: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NodeSnapshot {
    pub nodes: Vec<NodeSummary>,
    pub selected_id: Option<String>,
    pub runtime: ProxyRuntime,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProxyRuntime {
    pub running: Option<bool>,
    pub version: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GeneralProxy {
    pub protocol: String,
    pub server: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportResult {
    pub added: u32,
    pub duplicates: u32,
}

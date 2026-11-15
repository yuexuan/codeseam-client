use super::{nodes::NodeSummary, Check};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReport {
    pub checks: Vec<Check>,
    pub node: NodeSummary,
    pub observed_at: String,
    pub revision: String,
    pub confirmed: bool,
    pub ready: bool,
    pub target_timezone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSetting {
    Timezone,
    TimeSync,
    Language,
    Dns,
    #[serde(rename = "ipv6")]
    Ipv6,
}

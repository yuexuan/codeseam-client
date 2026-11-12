use serde::{Deserialize, Serialize};
use specta::Type;
pub mod nodes;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Satisfied,
    Pending,
    Unknown,
    Optional,
    Unsupported,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Group {
    System,
    Apps,
    Network,
    Runtime,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub group: Group,
    pub label: String,
    pub value: String,
    pub status: Status,
    pub detail: String,
    pub source: String,
    pub blocking: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub checks: Vec<Check>,
    pub observed_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Startup {
    pub schema: u32,
    pub scan_phase: ScanPhase,
    pub last_observed_at: Option<String>,
    pub recovery: Vec<RecoveryItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ScanPhase {
    NotStarted,
    Scanning,
    Completed,
    Interrupted,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub operation: String,
    pub message: String,
}
impl AppError {
    pub fn new(operation: &str, message: String) -> Self {
        Self {
            operation: operation.into(),
            message,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    Cli,
    #[serde(rename = "ipv6")]
    Ipv6,
    Dns,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RecoveryItem {
    pub message: String,
    pub action: Option<RecoveryAction>,
}

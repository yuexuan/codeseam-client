use crate::{domain::AppError, infrastructure::operation_log};
use std::time::Instant;

#[derive(Default)]
pub(crate) struct Operations {
    pub environment: tokio::sync::Mutex<()>,
    pub node_tests: tokio::sync::Mutex<()>,
}
impl Operations {
    pub(super) async fn wait(
        &self,
        operation: &str,
    ) -> Result<tokio::sync::MutexGuard<'_, ()>, AppError> {
        tokio::time::timeout(std::time::Duration::from_secs(660), self.environment.lock())
            .await
            .map_err(|_| {
                AppError::new(
                    operation,
                    "等待前一个操作完成超时，请检查运行环境后重试".into(),
                )
            })
    }
}

#[cfg(test)]
mod operation_tests {
    use super::Operations;

    #[test]
    fn browser_waits_for_guest_scan_to_release_lock() {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                let operations = std::sync::Arc::new(Operations::default());
                let scan = operations.environment.lock().await;
                let queued = operations.clone();
                let browser = tokio::spawn(async move {
                    let _guard = queued.wait("prepare_browser").await.unwrap();
                });
                tokio::task::yield_now().await;
                assert!(!browser.is_finished());
                drop(scan);
                browser.await.unwrap();
                assert!(operations.environment.try_lock().is_ok());
            });
    }
}
pub(super) fn finish<T>(
    operation: &str,
    started: Instant,
    result: Result<T, String>,
) -> Result<T, AppError> {
    let logged = operation_log::record(operation, started.elapsed(), result.is_ok());
    match (result, logged) {
        (Ok(value), Ok(_)) => Ok(value),
        (Err(error), Ok(id)) => Err(AppError::new(operation, format!("{error} [记录 {id}]"))),
        (Ok(_), Err(error)) => Err(AppError::new(
            operation,
            format!("操作已执行，但本地诊断记录保存失败：{error}；请复验当前状态"),
        )),
        (Err(error), Err(log_error)) => Err(AppError::new(
            operation,
            format!("{error}；本地诊断记录也未能保存：{log_error}"),
        )),
    }
}

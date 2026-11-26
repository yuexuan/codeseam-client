use super::operations::{finish, Operations};
use crate::application;
use std::time::Instant;
use tauri::{Emitter, Manager};

/// 桌面服务负责维护此计时器，包括 WebView 最小化期间。
fn daily_check_timer() -> tokio::time::Interval {
    let period = std::time::Duration::from_secs(2 * 60 * 60);
    let mut timer = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    timer
}

pub(crate) fn start_daily_checks(app: tauri::AppHandle) {
    let observer = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(3));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let state = observer.state::<Operations>();
            let Ok(_guard) = state.environment.try_lock() else {
                continue;
            };
            match tokio::task::spawn_blocking(application::workbench::guardian_poll).await {
                Ok(Ok(Some(record))) => {
                    let _ = observer.emit("daily-observed", record);
                }
                Ok(Err(error)) => {
                    let _ = observer.emit("daily-observation-error", error);
                }
                Err(error) => {
                    let _ = observer.emit("daily-observation-error", error.to_string());
                }
                _ => {}
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut timer = daily_check_timer();
        loop {
            timer.tick().await;
            let state = app.state::<Operations>();
            let _guard = state.environment.lock().await;
            let _nodes_guard = state.node_tests.lock().await;
            let started = Instant::now();
            let result = tokio::task::spawn_blocking(application::workbench::scheduled_refresh)
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| r);
            if matches!(result, Ok(None)) {
                continue;
            }
            match finish("workbench_scheduled_refresh", started, result) {
                Ok(Some(record)) => {
                    let _ = app.emit("daily-observed", record);
                }
                Err(error) => {
                    let _ = app.emit("daily-observation-error", error.message);
                }
                Ok(None) => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn first_tick_is_two_hours_after_start_and_resume_does_not_replay_missed_checks() {
        use tokio::time::{advance, Duration, Instant};
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .unwrap()
            .block_on(async {
                let start = Instant::now();
                let hour = Duration::from_secs(3600);
                let mut timer = super::daily_check_timer();
                assert_eq!(timer.tick().await, start + 2 * hour);
                advance(7 * hour).await;
                assert_eq!(timer.tick().await, start + 4 * hour);
                assert_eq!(timer.tick().await, start + 10 * hour);
            });
    }
}

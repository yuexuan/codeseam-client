//! 系统能力入口。调用方按功能使用接口，系统实现集中在此选择。
mod windows;

pub(crate) use windows::{
    autostart, browser, claude, credentials, environment, guardian, hyperv, mihomo_process,
    network, runtime,
};

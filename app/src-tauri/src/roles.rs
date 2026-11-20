//! What this device is doing: one role at a time (Idle, Worker or Host, with Loading on
//! the way to Host). Pure state rules plus the memory guard; `commands.rs` runs the
//! engine and reports each change as a `role-changed` event.
//!
//! A worker can't be stopped (llama.cpp's RPC server has no stop call; Task 1.1), so a
//! device that became a worker stays one until the app is closed.

use dl_engine::{DeviceShare, WorkerStatus};
use serde::Serialize;

use crate::discovery::DeviceRole;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum RoleState {
    Idle,
    Worker { status: WorkerStatus },
    Loading { model_id: String, frac: f32 },
    Host { model_id: String, shares: Vec<DeviceShare> },
}

pub const WORKER_STAYS: &str = "this device is a worker until the app is closed; reopen the app to change role";

#[derive(Debug)]
pub struct Roles {
    state: RoleState,
}

impl Default for Roles {
    fn default() -> Self {
        Roles { state: RoleState::Idle }
    }
}

impl Roles {
    pub fn state(&self) -> &RoleState {
        &self.state
    }

    /// The role this device announces, and its RPC port if it is a worker.
    pub fn announced(&self) -> (DeviceRole, Option<u16>) {
        match &self.state {
            RoleState::Idle => (DeviceRole::Idle, None),
            RoleState::Loading { .. } | RoleState::Host { .. } => (DeviceRole::Host, None),
            RoleState::Worker { status } => {
                let port = status.endpoint.rsplit_once(':').and_then(|(_, p)| p.parse().ok());
                (DeviceRole::Worker, port)
            }
        }
    }

    /// May this device start a worker now? Already being one is fine.
    pub fn can_become_worker(&self) -> Result<(), String> {
        match &self.state {
            RoleState::Idle | RoleState::Worker { .. } => Ok(()),
            RoleState::Loading { model_id, .. } => Err(format!("still loading {model_id}")),
            RoleState::Host { .. } => Err("unload the model before becoming a worker".into()),
        }
    }

    pub fn set_worker(&mut self, status: WorkerStatus) {
        self.state = RoleState::Worker { status };
    }

    /// Enter Loading. From Idle, or from Host (the old model is unloaded first).
    pub fn begin_loading(&mut self, model_id: &str) -> Result<(), String> {
        match &self.state {
            RoleState::Idle | RoleState::Host { .. } => {
                self.state = RoleState::Loading { model_id: model_id.into(), frac: 0.0 };
                Ok(())
            }
            RoleState::Loading { model_id, .. } => Err(format!("already loading {model_id}")),
            RoleState::Worker { .. } => Err(WORKER_STAYS.into()),
        }
    }

    /// Update load progress. Returns true if it moved by at least 1% (worth reporting).
    pub fn set_progress(&mut self, new: f32) -> bool {
        match &mut self.state {
            RoleState::Loading { frac, .. } if (new - *frac).abs() >= 0.01 || (new >= 1.0 && *frac < 1.0) => {
                *frac = new;
                true
            }
            _ => false,
        }
    }

    /// Loading ends: Host on success, Idle on failure.
    pub fn finish_loading(&mut self, result: Result<Vec<DeviceShare>, ()>) {
        let RoleState::Loading { model_id, .. } = &self.state else { return };
        self.state = match result {
            Ok(shares) => RoleState::Host { model_id: model_id.clone(), shares },
            Err(()) => RoleState::Idle,
        };
    }

    /// Back to Idle: unload the model. Refused while loading or as a worker.
    pub fn leave(&mut self) -> Result<(), String> {
        match &self.state {
            RoleState::Idle | RoleState::Host { .. } => {
                self.state = RoleState::Idle;
                Ok(())
            }
            RoleState::Loading { model_id, .. } => Err(format!("still loading {model_id}")),
            RoleState::Worker { .. } => Err(WORKER_STAYS.into()),
        }
    }

    /// The model became unusable (a worker was lost): back to Idle.
    pub fn host_lost(&mut self) {
        if matches!(self.state, RoleState::Host { .. }) {
            self.state = RoleState::Idle;
        }
    }
}

/// Refuse a load that can't fit, before any memory is used. `need_mb` is the model's
/// measured single-device peak; `have` adds up this device and the chosen peers, with
/// unknown free memory counted as 0.
pub fn memory_guard(need_mb: u64, local_free_mb: Option<u64>, peers_free_mb: &[Option<u64>]) -> Result<(), String> {
    let have: u64 = local_free_mb.unwrap_or(0) + peers_free_mb.iter().map(|m| m.unwrap_or(0)).sum::<u64>();
    if have < need_mb {
        return Err(format!("not enough memory: need {need_mb} MB, have {have} MB"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status() -> WorkerStatus {
        WorkerStatus { running: true, endpoint: "0.0.0.0:50052".into(), device: "Apple M5".into(), free_mb: Some(12000) }
    }

    fn share() -> DeviceShare {
        DeviceShare { name: "Apple M5".into(), endpoint: None, is_remote: false, layers: Some((0, 24)), buffer_mib: Some(794.5) }
    }

    #[test]
    fn role_transitions_follow_the_worker_stop_rule() {
        let mut r = Roles::default();
        assert_eq!(*r.state(), RoleState::Idle);
        assert_eq!(r.leave(), Ok(()), "leaving Idle is a no-op");

        // Idle → Worker; starting again is fine; but a worker can't be stopped.
        assert_eq!(r.can_become_worker(), Ok(()));
        r.set_worker(status());
        assert_eq!(r.can_become_worker(), Ok(()));
        assert_eq!(r.leave(), Err(WORKER_STAYS.into()));
        assert_eq!(r.begin_loading("lfm3-1.7b"), Err(WORKER_STAYS.into()));
        assert!(matches!(r.state(), RoleState::Worker { .. }));

        // Idle → Loading → Host → Idle.
        let mut r = Roles::default();
        r.begin_loading("lfm3-1.7b").unwrap();
        assert!(r.set_progress(0.5));
        assert!(!r.set_progress(0.505), "less than 1% is not worth an event");
        r.finish_loading(Ok(vec![share()]));
        assert_eq!(*r.state(), RoleState::Host { model_id: "lfm3-1.7b".into(), shares: vec![share()] });
        assert!(r.can_become_worker().is_err(), "unload the model before becoming a worker");
        // Host → Loading another model is allowed (the old one is unloaded).
        r.begin_loading("qwen3.5-2b").unwrap();
        r.finish_loading(Err(()));
        assert_eq!(*r.state(), RoleState::Idle, "a failed load ends Idle");

        r.begin_loading("lfm3-1.7b").unwrap();
        r.finish_loading(Ok(vec![share()]));
        r.host_lost();
        assert_eq!(*r.state(), RoleState::Idle);
        r.begin_loading("lfm3-1.7b").unwrap();
        r.finish_loading(Ok(vec![share()]));
        assert_eq!(r.leave(), Ok(()));
        assert_eq!(*r.state(), RoleState::Idle);
    }

    #[test]
    fn cannot_host_while_loading() {
        let mut r = Roles::default();
        r.begin_loading("lfm3-1.7b").unwrap();
        assert_eq!(r.begin_loading("qwen3.5-2b"), Err("already loading lfm3-1.7b".into()));
        assert!(r.leave().is_err(), "can't unload half-way through a load");
        assert!(r.can_become_worker().is_err());
        assert_eq!(*r.state(), RoleState::Loading { model_id: "lfm3-1.7b".into(), frac: 0.0 });
    }

    #[test]
    fn guard_refuses_when_memory_insufficient() {
        // Alone: the device must hold the whole model.
        assert_eq!(memory_guard(1300, Some(4095), &[]), Ok(()));
        assert_eq!(memory_guard(1600, Some(1200), &[]), Err("not enough memory: need 1600 MB, have 1200 MB".into()));
        // Split: the devices together.
        assert_eq!(memory_guard(1600, Some(1200), &[Some(600)]), Ok(()));
        assert_eq!(memory_guard(1600, Some(800), &[Some(500), Some(200)]), Err("not enough memory: need 1600 MB, have 1500 MB".into()));
    }

    #[test]
    fn guard_counts_unknown_memory_as_zero() {
        assert_eq!(memory_guard(1300, None, &[]), Err("not enough memory: need 1300 MB, have 0 MB".into()));
        assert_eq!(memory_guard(1300, Some(1000), &[None]), Err("not enough memory: need 1300 MB, have 1000 MB".into()));
        assert_eq!(memory_guard(1300, Some(1000), &[None, Some(300)]), Ok(()));
    }

    #[test]
    fn every_role_is_announced() {
        let mut r = Roles::default();
        assert_eq!(r.announced(), (DeviceRole::Idle, None));
        r.begin_loading("m").unwrap();
        assert_eq!(r.announced(), (DeviceRole::Host, None));
        r.finish_loading(Ok(vec![share()]));
        assert_eq!(r.announced(), (DeviceRole::Host, None));
        r.leave().unwrap();
        r.set_worker(WorkerStatus { endpoint: "0.0.0.0:6000".into(), ..status() });
        assert_eq!(r.announced(), (DeviceRole::Worker, Some(6000)));
    }
}

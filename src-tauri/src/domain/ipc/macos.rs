use tauri::AppHandle;

use super::IpcPacket;

pub struct IpcServer;

impl IpcServer {
    pub fn new() -> Self {
        Self
    }

    pub fn start(&self, _app_handle: AppHandle) {}

    pub fn send(&self, _packet: &IpcPacket) {}
}

pub fn vrcipc_send(_message: &str) -> bool {
    false
}

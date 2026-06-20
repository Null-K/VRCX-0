mod adapters;
mod app;
pub mod bindings_export;
mod bootstrap;
mod commands;
mod error;
#[cfg(target_os = "macos")]
mod macos_menu;
mod state;

pub use app::run;

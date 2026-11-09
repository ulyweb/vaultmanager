//! VaultManager native shell.
//!
//! The shell is deliberately tiny: it hosts the web app (all crypto, storage and UI live in `js/`) in the
//! system WebView and adds exactly one native capability — the "Save as…" dialog, so backups, exports and
//! attachment downloads work reliably on phones. There is no custom command surface, no shell or network
//! access from Rust, and the capability file grants only what that dialog needs.
//!
//! Roadmap: move the security core (key derivation, vault, merge) into this crate (Argon2id, zeroize).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running VaultManager");
}

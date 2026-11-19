// No commands are exposed to the webview: only the app's Rust code calls this plugin.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}

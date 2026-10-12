// Materin desktop shell: spawns the bundled materin-server child process and
// points the webview at its GUI (http://127.0.0.1:<port>/ui/).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent, State};

/// Holds the spawned server child so it can be killed when the app exits.
struct ServerChild(Mutex<Option<Child>>);

const READY_ATTEMPTS: usize = 10;
const READY_INTERVAL_MS: u64 = 500;
const PORT_FILE_NAME: &str = "materin-desktop.port";

/// Grab an OS-assigned free port on loopback (small race window, acceptable here).
fn find_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind 127.0.0.1:0");
    let port = listener.local_addr().expect("local_addr").port();
    drop(listener);
    port
}

/// The server binary sits next to the app binary (inside a .app bundle this is
/// Contents/MacOS/materin-server). Dev fallback: ../dist/materin-server.
fn server_binary_path() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .expect("current_exe")
        .parent()
        .expect("exe parent")
        .to_path_buf();
    let sibling = exe_dir.join("materin-server");
    if sibling.is_file() {
        return sibling;
    }
    let dev = exe_dir.join("../dist/materin-server");
    if dev.is_file() {
        return dev;
    }
    eprintln!(
        "materin: materin-server binary not found (tried {:?} and {:?})",
        sibling, dev
    );
    std::process::exit(1);
}

/// Test hook: the chosen port is written to /tmp/materin-desktop.port so the
/// running app can be probed without guessing the port.
/// Note: a literal /tmp path is used on unix because std::env::temp_dir()
/// returns the per-user $TMPDIR on macOS, not /tmp.
#[cfg(not(target_os = "windows"))]
fn port_file_path() -> PathBuf {
    PathBuf::from("/tmp").join(PORT_FILE_NAME)
}

#[cfg(target_os = "windows")]
fn port_file_path() -> PathBuf {
    std::env::temp_dir().join(PORT_FILE_NAME)
}

fn write_port_file(port: u16) {
    let path = port_file_path();
    if let Err(e) = std::fs::write(&path, port.to_string()) {
        eprintln!("materin: failed to write {:?}: {}", path, e);
    }
}

/// Poll the server root with a minimal HTTP/1.0 request until it answers 200.
fn wait_until_ready(port: u16) -> bool {
    let request = format!("GET / HTTP/1.0\r\nHost: 127.0.0.1:{}\r\n\r\n", port);
    for _ in 0..READY_ATTEMPTS {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
            if stream.write_all(request.as_bytes()).is_ok() {
                let mut buf = [0u8; 128];
                if let Ok(n) = stream.read(&mut buf) {
                    if n > 0 && String::from_utf8_lossy(&buf[..n]).contains(" 200 ") {
                        return true;
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(READY_INTERVAL_MS));
    }
    false
}

fn kill_server(state: &State<ServerChild>) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    let server_path = server_binary_path();
    let server_dir = server_path.parent().expect("server dir").to_path_buf();
    let port = find_free_port();

    let mut command = Command::new(&server_path);
    command
        .env("MATERIN_PORT", port.to_string())
        .env("MATERIN_WEB_ROOT", server_dir.join("web"))
        .env(
            "ANTHROPIC_API_KEY",
            std::env::var("ANTHROPIC_API_KEY").unwrap_or_default(),
        );

    let child = command.spawn().unwrap_or_else(|e| {
        eprintln!("materin: failed to spawn {:?}: {}", server_path, e);
        std::process::exit(1);
    });

    write_port_file(port);

    if !wait_until_ready(port) {
        eprintln!(
            "materin: materin-server did not become ready on port {} within {}ms",
            port,
            READY_ATTEMPTS * READY_INTERVAL_MS as usize
        );
        std::process::exit(1);
    }

    tauri::Builder::default()
        .manage(ServerChild(Mutex::new(Some(child))))
        .setup(move |app| {
            let url = format!("http://127.0.0.1:{}/ui/", port);
            if let Some(window) = app.get_webview_window("main") {
                if window.navigate(url.parse().expect("valid url")).is_err() {
                    let _ = window.eval(&format!("location.href = '{}'", url));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                kill_server(&app.state::<ServerChild>());
            }
        });
}

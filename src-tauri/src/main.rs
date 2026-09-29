#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::io::{Read as _, Write as _};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
#[allow(unused_imports)]
use tauri::{AppHandle, Manager, PhysicalPosition, RunEvent, WebviewUrl, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

const DAEMON_ADDR: &str = "127.0.0.1:23799";
const LAIR_URL: &str = "http://127.0.0.1:23799/lair/";
const LAIR_APP_URL: &str = "http://127.0.0.1:23799/lair/?app=desktop";

fn splash_url() -> tauri::Url {
    #[cfg(windows)]
    let url = "http://tauri.localhost/index.html";
    #[cfg(not(windows))]
    let url = "tauri://localhost/index.html";
    url.parse().unwrap()
}

fn daemon_up() -> bool {
    DAEMON_ADDR
        .parse()
        .ok()
        .and_then(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(2)).ok())
        .is_some()
}

#[cfg(windows)]
fn post(path: &str) {
    let path = path.to_string();
    std::thread::spawn(move || {
        if let Ok(mut s) = TcpStream::connect(DAEMON_ADDR) {
            let _ = write!(
                s,
                "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
            );
        }
    });
}

fn daemon_status() -> Option<serde_json::Value> {
    let mut s = TcpStream::connect_timeout(&DAEMON_ADDR.parse().ok()?, Duration::from_secs(2)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(4))).ok()?;
    s.write_all(b"GET /status HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").ok()?;
    let mut raw = String::new();
    s.read_to_string(&mut raw).ok()?;
    serde_json::from_str(raw.split_once("\r\n\r\n")?.1).ok()
}

fn install_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("AERYX_DIR") {
        return dir.into();
    }
    #[cfg(windows)]
    let base = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("Aeryx").join("runtime");
    #[cfg(not(windows))]
    let base = PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".aeryx");
    base
}

fn node_bin(dir: &Path) -> PathBuf {
    #[cfg(windows)]
    return dir.join("node").join("node.exe");
    #[cfg(not(windows))]
    return dir.join("node").join("bin").join("node");
}

fn cli(dir: &Path) -> PathBuf {
    dir.join("app").join("scripts").join("aeryx-cli.mjs")
}

const FEEDBACK_URL: &str = "https://github.com/dracoder/aery-ai/discussions/new?category=ideas";
const ISSUES_URL: &str = "https://github.com/dracoder/aery-ai/issues/new?template=bug.yml&where=Desktop%20app%20(beta)";

fn open_url(url: &str) {
    #[cfg(windows)]
    let _ = command("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let _ = command("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = command("xdg-open").arg(url).spawn();
}

fn internal_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" => (url.host_str() == Some("127.0.0.1") && url.port() == Some(23799)) || url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

fn keep_inside(url: &tauri::Url) -> bool {
    if internal_url(url) {
        return true;
    }
    open_outside(url);
    false
}

fn open_outside(url: &tauri::Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let u = url.to_string();
        std::thread::spawn(move || open_url(&u));
    }
}

fn report_bug() {
    if !(cli(&install_dir()).exists() && run_cli(&["report", "--from-app"])) {
        open_url(ISSUES_URL);
    }
}

fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

fn run_cli(args: &[&str]) -> bool {
    let dir = install_dir();
    command(node_bin(&dir))
        .arg(cli(&dir))
        .args(args)
        .env("AERYX_NO_OPEN", "1")
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn run_bundled_installer(app: &AppHandle) -> Result<(), String> {
    let res = app.path().resource_dir().map_err(|e| e.to_string())?.join("installer");
    #[cfg(windows)]
    let mut c = {
        let mut c = command("powershell.exe");
        c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(res.join("install.ps1"));
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = command("/bin/sh");
        c.arg(res.join("install.sh"));
        c
    };
    let log = std::fs::File::create(std::env::temp_dir().join("aeryx-install.log")).map_err(|e| e.to_string())?;
    let status = c
        .env("AERYX_DIR", install_dir())
        .env("AERYX_NO_OPEN", "1")
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("the installer did not finish".into()) }
}

const BG: tauri::webview::Color = tauri::webview::Color(5, 8, 15, 255);

fn set_status(app: &AppHandle, text: &str, is_error: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("window.setStatus && window.setStatus({text:?}, {is_error})"));
    }
}

static BRINGING_UP: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
fn record_app_path() {
    let dir = install_dir();
    if !dir.join(".aeryx-install").exists() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(bundle) = exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")) else { return };
    let s = bundle.to_string_lossy();
    if s.starts_with("/Volumes/") || s.contains("/AppTranslocation/") {
        return;
    }
    let file = dir.join(".aeryx-app");
    let line = format!("{s}\n");
    if std::fs::read_to_string(&file).ok().as_deref() != Some(line.as_str()) {
        let _ = std::fs::write(&file, line);
    }
}

fn bring_up(app: AppHandle) {
    if BRINGING_UP.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let outcome = (|| -> Result<(), String> {
            if daemon_up() {
                return Ok(());
            }
            let dir = install_dir();
            if !cli(&dir).exists() {
                set_status(&app, "First launch: setting Aeryx up. This downloads Aeryx and Node (checked against the signed release) and builds it on this computer — a few minutes.", false);
                run_bundled_installer(&app)?;
            } else if !dir.join("app").join("dist").join("aeryxd.mjs").exists() {
                set_status(&app, "Finishing the setup that was interrupted last time — a few minutes.", false);
                if !run_cli(&["setup"]) || !run_cli(&["start", "--no-open"]) {
                    return Err("Aeryx could not finish setting up".into());
                }
            } else {
                set_status(&app, "Starting Aeryx…", false);
                if !run_cli(&["start", "--no-open"]) {
                    return Err("Aeryx did not start".into());
                }
            }
            for _ in 0..30 {
                if daemon_up() {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_secs(1));
            }
            Err("Aeryx did not answer".into())
        })();
        match outcome {
            Ok(()) => {
                #[cfg(target_os = "macos")]
                record_app_path();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.navigate(LAIR_APP_URL.parse().unwrap());
                }
                if app.state::<Orb>().lock().unwrap().on {
                    show_orb(&app);
                }
            }
            Err(e) => {
                let dir = install_dir();
                set_status(&app, &format!("{e}. Details: {} and {}", std::env::temp_dir().join("aeryx-install.log").display(), dir.join("app").join("data").join("aeryxd.log").display()), true);
            }
        }
        BRINGING_UP.store(false, Ordering::SeqCst);
    });
}

fn build_main(app: &AppHandle) -> tauri::Result<()> {
    let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("Aeryx")
        .inner_size(1360.0, 880.0)
        .min_inner_size(380.0, 560.0)
        .background_color(BG)
        .on_navigation(keep_inside)
        .on_new_window(|url, _| {
            open_outside(&url);
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    let w = window.clone();
    #[allow(unused_variables)]
    let h = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w.hide();
            #[cfg(target_os = "macos")]
            let _ = h.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    });
    Ok(())
}

fn show_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn toggle_main(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        let _ = w.hide();
    } else {
        show_main(app);
    }
}

fn stop_daemon(app: &AppHandle) {
    let _ = run_cli(&["stop"]);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(splash_url());
    }
    std::thread::sleep(Duration::from_millis(600));
    set_status(app, "Aeryx is stopped. Choose Start Aeryx from the tray to wake it.", true);
}


const ORB_URL: &str = "http://127.0.0.1:23799/orb";
const ORB_SIZE: f64 = 160.0;

const DEFAULT_SUMMON: &str = "Control+Shift+Space";

struct OrbState {
    on: bool,
    pos: Option<(i32, i32)>,
    notify: bool,
    summon: String,
    toggle: Option<CheckMenuItem<tauri::Wry>>,
    notify_toggle: Option<CheckMenuItem<tauri::Wry>>,
}
type Orb = Mutex<OrbState>;

static ORB_MOVES: AtomicUsize = AtomicUsize::new(0);

fn orb_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("desktop.txt"))
}

fn load_orb(app: &AppHandle) -> OrbState {
    let text = orb_file(app).and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default();
    let field = |k: &str| text.lines().find_map(|l| l.strip_prefix(k)).map(str::trim);
    let pos = match (field("x=").and_then(|v| v.parse().ok()), field("y=").and_then(|v| v.parse().ok())) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    OrbState {
        on: field("on=") != Some("0"),
        pos,
        notify: field("notify=") != Some("0"),
        summon: field("summon=").filter(|v| !v.is_empty()).unwrap_or(DEFAULT_SUMMON).to_string(),
        toggle: None,
        notify_toggle: None,
    }
}

fn save_orb(app: &AppHandle, s: &OrbState) {
    let Some(f) = orb_file(app) else { return };
    if let Some(dir) = f.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut text = format!("on={}\nnotify={}\nsummon={}\n", s.on as u8, s.notify as u8, s.summon);
    if let Some((x, y)) = s.pos {
        text.push_str(&format!("x={x}\ny={y}\n"));
    }
    let _ = std::fs::write(f, text);
}

fn orb_position(app: &AppHandle, saved: Option<(i32, i32)>) -> Option<PhysicalPosition<i32>> {
    let monitors = app.available_monitors().unwrap_or_default();
    if let Some((x, y)) = saved {
        let on_screen = monitors.iter().any(|m| {
            let (p, s) = (m.position(), m.size());
            x >= p.x - 40 && y >= p.y - 40 && x < p.x + s.width as i32 - 40 && y < p.y + s.height as i32 - 40
        });
        if on_screen {
            return Some(PhysicalPosition::new(x, y));
        }
    }
    let m = app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())?;
    let (p, s, k) = (m.position(), m.size(), m.scale_factor());
    Some(PhysicalPosition::new(p.x + s.width as i32 - ((ORB_SIZE + 24.0) * k) as i32, p.y + (72.0 * k) as i32))
}

fn show_orb(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("orb") {
        let _ = w.show();
        return;
    }
    let h = app.clone();
    let built = tauri::WebviewWindowBuilder::new(app, "orb", WebviewUrl::External(ORB_URL.parse().unwrap()))
        .title("Aeryx orb")
        .inner_size(ORB_SIZE, ORB_SIZE)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_navigation(move |url| {
            if url.host_str() != Some("127.0.0.1") || url.port() != Some(23799) {
                return false;
            }
            match url.path() {
                "/orb" => true,
                "/orb/menu" => {
                    let h2 = h.clone();
                    let _ = h.run_on_main_thread(move || orb_menu(&h2));
                    false
                }
                "/orb/ask" => {
                    let h2 = h.clone();
                    std::thread::spawn(move || show_quick(&h2));
                    false
                }
                p if p.starts_with("/lair") => {
                    let h2 = h.clone();
                    let _ = h.run_on_main_thread(move || show_main(&h2));
                    false
                }
                _ => false,
            }
        })
        .build();
    let Ok(w) = built else { return };
    let saved = app.state::<Orb>().lock().unwrap().pos;
    if let Some(p) = orb_position(app, saved) {
        let _ = w.set_position(p);
    }
    let _ = w.show();
    let h = app.clone();
    w.on_window_event(move |event| {
        if let WindowEvent::Moved(p) = event {
            h.state::<Orb>().lock().unwrap().pos = Some((p.x, p.y));
            let gen = ORB_MOVES.fetch_add(1, Ordering::SeqCst) + 1;
            let h2 = h.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(600));
                if ORB_MOVES.load(Ordering::SeqCst) == gen {
                    save_orb(&h2, &h2.state::<Orb>().lock().unwrap());
                }
            });
        }
    });
}

fn set_orb(app: &AppHandle, on: bool) {
    if on {
        show_orb(app);
    } else if let Some(w) = app.get_webview_window("orb") {
        let _ = w.hide();
    }
    let state = app.state::<Orb>();
    let mut s = state.lock().unwrap();
    s.on = on;
    if let Some(t) = &s.toggle {
        let _ = t.set_checked(on);
    }
    save_orb(app, &s);
}

fn toggle_orb(app: &AppHandle) {
    let on = !app.state::<Orb>().lock().unwrap().on;
    let h = app.clone();
    std::thread::spawn(move || set_orb(&h, on));
}

fn orb_menu(app: &AppHandle) {
    let Some(w) = app.get_webview_window("orb") else { return };
    let menu = (|| -> tauri::Result<_> {
        let open = MenuItemBuilder::with_id("open", "Open Aeryx").build(app)?;
        let quick = MenuItemBuilder::with_id("quick", "Quick ask…  (double-click)").build(app)?;
        let hide = MenuItemBuilder::with_id("orb-hide", "Hide the orb").build(app)?;
        let report = MenuItemBuilder::with_id("report", "Report a bug…").build(app)?;
        let feedback = MenuItemBuilder::with_id("feedback", "Send feedback…").build(app)?;
        let quit = MenuItemBuilder::with_id("quit", "Quit (stops Aeryx)").build(app)?;
        #[allow(unused_mut)]
        let mut m = MenuBuilder::new(app).items(&[&open, &quick]);
        #[cfg(windows)]
        {
            let listen = MenuItemBuilder::with_id("listen", "Listen  (F8)").build(app)?;
            m = m.items(&[&listen]);
        }
        m.separator().items(&[&hide]).separator().items(&[&feedback, &report]).separator().items(&[&quit]).build()
    })();
    if let Ok(menu) = menu {
        let _ = w.popup_menu(&menu);
    }
}

const QUICK_URL: &str = "http://127.0.0.1:23799/quick";

fn show_quick(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.navigate(QUICK_URL.parse().unwrap());
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let h = app.clone();
    let _ = tauri::WebviewWindowBuilder::new(app, "quick", WebviewUrl::External(QUICK_URL.parse().unwrap()))
        .title("Ask Aeryx")
        .inner_size(560.0, 76.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .background_color(BG)
        .center()
        .focused(true)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_navigation(move |url| {
            if !internal_url(url) {
                return keep_inside(url);
            }
            match url.path() {
                "/quick" => true,
                "/quick/done" => {
                    if let Some(w) = h.get_webview_window("quick") {
                        let _ = w.hide();
                    }
                    false
                }
                _ => false,
            }
        })
        .build();
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn watch_for_notifications(app: AppHandle) {
    std::thread::spawn(move || {
        let mut seen: HashSet<String> = HashSet::new();
        let mut busy_since: Option<Instant> = None;
        let mut user_turn = false;
        let mut first = true;
        loop {
            std::thread::sleep(Duration::from_secs(3));
            let Some(st) = daemon_status() else { continue };
            let enabled = app.state::<Orb>().lock().unwrap().notify;
            let in_front = app
                .get_webview_window("main")
                .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
                .unwrap_or(false);
            let pending = st["pendingConfirms"].as_array().cloned().unwrap_or_default();
            let ids: HashSet<String> = pending.iter().filter_map(|p| p["id"].as_str().map(String::from)).collect();
            for p in &pending {
                let Some(id) = p["id"].as_str() else { continue };
                if !seen.contains(id) && !first && enabled && !in_front {
                    let class = p["riskClass"].as_i64().unwrap_or(2);
                    let lane: String = p["laneId"].as_str().filter(|l| !l.is_empty()).unwrap_or("an action").chars().take(60).collect();
                    notify(&app, "Aeryx needs your OK", &format!("Class {class} · {lane}. Open Aeryx to review."));
                }
            }
            seen = ids;
            let busy = matches!(st["brain"].as_str(), Some("thinking") | Some("executing"));
            if busy {
                user_turn |= matches!(st["brainVia"].as_str(), Some("typed") | Some("voice"));
            }
            match (busy, busy_since) {
                (true, None) => busy_since = Some(Instant::now()),
                (false, Some(t)) => {
                    if t.elapsed() >= Duration::from_secs(15) && enabled && !in_front && seen.is_empty() && user_turn {
                        notify(&app, "Aeryx is done", "Open Aeryx to see the answer.");
                    }
                    busy_since = None;
                    user_turn = false;
                }
                _ => {}
            }
            first = false;
        }
    });
}

fn toggle_notify(app: &AppHandle) {
    let state = app.state::<Orb>();
    let mut s = state.lock().unwrap();
    s.notify = !s.notify;
    if let Some(t) = &s.notify_toggle {
        let _ = t.set_checked(s.notify);
    }
    save_orb(app, &s);
}

static SUMMON: OnceLock<Shortcut> = OnceLock::new();

#[cfg(windows)]
mod hud {
    use super::*;
    use std::sync::atomic::AtomicIsize;
    use tauri::WebviewWindow;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, SendMessageTimeoutW, SetParent, SMTO_NORMAL,
    };

    static WORKER: AtomicIsize = AtomicIsize::new(0);
    pub static WALLPAPER_ON: AtomicBool = AtomicBool::new(false);

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn find_worker(hwnd: HWND, _l: LPARAM) -> i32 {
        let defview = FindWindowExW(hwnd, std::ptr::null_mut(), wide("SHELLDLL_DefView").as_ptr(), std::ptr::null());
        if !defview.is_null() {
            let worker = FindWindowExW(std::ptr::null_mut(), hwnd, wide("WorkerW").as_ptr(), std::ptr::null());
            WORKER.store(worker as isize, Ordering::SeqCst);
        }
        1
    }

    fn hwnd_of(window: &WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|h| h.0 as HWND)
    }

    pub fn show(app: &AppHandle) {
        if let Some(w) = app.get_webview_window("hud") {
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let h = app.clone();
        let _ = tauri::WebviewWindowBuilder::new(
            app, "hud",
            tauri::WebviewUrl::External(format!("http://{DAEMON_ADDR}/hud").parse().unwrap()),
        )
        .title("Aeryx — HUD")
        .maximized(true)
        .background_color(BG)
        .on_navigation(move |url| {
            if internal_url(url) && url.path().starts_with("/lair") {
                let h2 = h.clone();
                let _ = h.run_on_main_thread(move || show_main(&h2));
                return false;
            }
            keep_inside(url)
        })
        .on_new_window(|url, _| {
            open_outside(&url);
            tauri::webview::NewWindowResponse::Deny
        })
        .build();
    }

    pub fn set_wallpaper(app: &AppHandle, on: bool) {
        show(app);
        let Some(window) = app.get_webview_window("hud") else { return };
        unsafe {
            if on {
                let progman = FindWindowW(wide("Progman").as_ptr(), std::ptr::null());
                let mut _out = 0usize;
                SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, &mut _out as *mut usize as *mut _);
                let inner = FindWindowExW(progman, std::ptr::null_mut(), wide("WorkerW").as_ptr(), std::ptr::null());
                let target = if !inner.is_null() {
                    inner
                } else {
                    WORKER.store(0, Ordering::SeqCst);
                    EnumWindows(Some(find_worker), 0);
                    match WORKER.load(Ordering::SeqCst) {
                        0 => progman,
                        w => w as HWND,
                    }
                };
                let _ = window.set_decorations(false);
                let _ = window.set_skip_taskbar(true);
                if let Some(monitor) = window.current_monitor().ok().flatten() {
                    let _ = window.set_position(tauri::PhysicalPosition::new(0, 0));
                    let _ = window.set_size(*monitor.size());
                }
                if let Some(hwnd) = hwnd_of(&window) {
                    SetParent(hwnd, target);
                }
            } else {
                if let Some(hwnd) = hwnd_of(&window) {
                    SetParent(hwnd, std::ptr::null_mut());
                }
                let _ = window.set_skip_taskbar(false);
                let _ = window.set_decorations(true);
                let _ = window.maximize();
            }
        }
        let _ = window.show();
        WALLPAPER_ON.store(on, Ordering::SeqCst);
    }
}

fn main() {
    #[cfg(windows)]
    let ptt = Shortcut::new(None, tauri_plugin_global_shortcut::Code::F8);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if Some(shortcut) == SUMMON.get() {
                        toggle_main(app);
                    }
                    #[cfg(windows)]
                    if shortcut == &ptt {
                        post("/listen");
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();
            app.manage::<Orb>(Mutex::new(load_orb(&handle)));
            build_main(&handle)?;
            let wanted = app.state::<Orb>().lock().unwrap().summon.clone();
            let summon: Shortcut = wanted.parse().unwrap_or_else(|_| DEFAULT_SUMMON.parse().unwrap());
            let _ = SUMMON.set(summon);
            if app.global_shortcut().register(summon).is_err() {
                notify(&handle, "Shortcut unavailable", &format!("{wanted} is taken by another app. Set summon= in desktop.txt in Aeryx's config folder."));
            }
            #[cfg(windows)]
            let _ = app.global_shortcut().register(ptt);

            let about = MenuItemBuilder::with_id("about", format!("Aeryx {} · desktop beta", app.package_info().version)).enabled(false).build(app)?;
            let summon_label = app.state::<Orb>().lock().unwrap().summon.replace("Control", "Ctrl");
            let open = MenuItemBuilder::with_id("open", format!("Open Aeryx  ({summon_label})")).build(app)?;
            let quick = MenuItemBuilder::with_id("quick", "Quick ask…").build(app)?;
            let feedback = MenuItemBuilder::with_id("feedback", "Send feedback…").build(app)?;
            let notify_on = app.state::<Orb>().lock().unwrap().notify;
            let notify_item = CheckMenuItemBuilder::with_id("notify", "Notifications").checked(notify_on).build(app)?;
            app.state::<Orb>().lock().unwrap().notify_toggle = Some(notify_item.clone());
            let report = MenuItemBuilder::with_id("report", "Report a bug…").build(app)?;
            let start = MenuItemBuilder::with_id("start", "Start Aeryx").build(app)?;
            let stop = MenuItemBuilder::with_id("stop", "Stop Aeryx").build(app)?;
            let browser = MenuItemBuilder::with_id("browser", "Open in browser").build(app)?;
            let orb_on = app.state::<Orb>().lock().unwrap().on;
            let orb = CheckMenuItemBuilder::with_id("orb", "Floating orb").checked(orb_on).build(app)?;
            app.state::<Orb>().lock().unwrap().toggle = Some(orb.clone());
            let quit = MenuItemBuilder::with_id("quit", "Quit (stops Aeryx)").build(app)?;
            #[allow(unused_mut)]
            let mut menu = MenuBuilder::new(app).items(&[&about]).separator().items(&[&open, &quick, &browser]).separator().items(&[&orb, &notify_item]).separator().items(&[&start, &stop]);
            #[cfg(windows)]
            {
                let hud = MenuItemBuilder::with_id("hud", "Show HUD").build(app)?;
                let listen = MenuItemBuilder::with_id("listen", "Listen  (F8)").build(app)?;
                let wall = MenuItemBuilder::with_id("wallpaper", "Toggle wallpaper mode").build(app)?;
                menu = menu.separator().items(&[&hud, &listen, &wall]);
            }
            let menu = menu.separator().items(&[&feedback, &report]).separator().items(&[&quit]).build()?;

            #[cfg(target_os = "macos")]
            let tray = TrayIconBuilder::with_id("aeryx")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?)
                .icon_as_template(true);
            #[cfg(not(target_os = "macos"))]
            let tray = TrayIconBuilder::with_id("aeryx").icon(app.default_window_icon().unwrap().clone());
            tray.tooltip("Aeryx (desktop beta)").menu(&menu).build(app)?;

            app.on_menu_event(move |app, e| match e.id().as_ref() {
                    "open" => show_main(app),
                    "orb" => toggle_orb(app),
                    "report" => {
                        std::thread::spawn(report_bug);
                    }
                    "feedback" => open_url(FEEDBACK_URL),
                    "notify" => toggle_notify(app),
                    "quick" => {
                        let h = app.clone();
                        std::thread::spawn(move || show_quick(&h));
                    }
                    "orb-hide" => {
                        let h = app.clone();
                        std::thread::spawn(move || set_orb(&h, false));
                    }
                    "browser" => open_url(LAIR_URL),
                    "start" => {
                        show_main(app);
                        if let Some(w) = app.get_webview_window("main") {
                            if !daemon_up() {
                                let _ = w.navigate(splash_url());
                            }
                        }
                        bring_up(app.clone());
                    }
                    "stop" => {
                        let h = app.clone();
                        std::thread::spawn(move || stop_daemon(&h));
                    }
                    #[cfg(windows)]
                    "hud" => {
                        let h = app.clone();
                        std::thread::spawn(move || hud::show(&h));
                    }
                    #[cfg(windows)]
                    "listen" => post("/listen"),
                    #[cfg(windows)]
                    "wallpaper" => {
                        let on = !hud::WALLPAPER_ON.load(Ordering::SeqCst);
                        let h = app.clone();
                        std::thread::spawn(move || hud::set_wallpaper(&h, on));
                    }
                    "quit" => {
                        let _ = run_cli(&["stop"]);
                        app.exit(0);
                    }
                    _ => {}
                });

            watch_for_notifications(handle.clone());
            bring_up(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Aeryx app");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        let _ = (app, &event);
    });
}

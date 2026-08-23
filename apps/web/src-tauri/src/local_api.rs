//! Spawn / stop the local FastAPI sidecar for the desktop-local flavor.
//! Prefer a bundled `recombyn-api` binary; fall back to Python + apps/api in dev.

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

pub struct ApiSidecarState(pub Mutex<Option<Child>>);

fn desktop_mode() -> String {
  std::env::var("RECOMBYN_DESKTOP_MODE")
    .unwrap_or_else(|_| "local".into())
    .trim()
    .to_lowercase()
}

fn port_open(host: &str, port: u16) -> bool {
  TcpStream::connect_timeout(
    &format!("{host}:{port}").parse().unwrap(),
    Duration::from_millis(350),
  )
  .is_ok()
}

fn sidecar_exe_name() -> &'static str {
  if cfg!(windows) {
    "recombyn-api.exe"
  } else {
    "recombyn-api"
  }
}

fn resolve_bundled_sidecar(app: &AppHandle) -> Option<PathBuf> {
  if let Ok(raw) = std::env::var("RECOMBYN_API_SIDECAR") {
    let p = PathBuf::from(raw.trim());
    if p.is_file() {
      return Some(p);
    }
  }

  let name = sidecar_exe_name();
  let mut candidates: Vec<PathBuf> = Vec::new();

  if let Ok(rd) = app.path().resource_dir() {
    candidates.push(rd.join("recombyn-api").join(name));
    candidates.push(rd.join("sidecars").join("recombyn-api").join(name));
    candidates.push(rd.join(name));
  }

  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      candidates.push(dir.join("recombyn-api").join(name));
      candidates.push(dir.join(name));
      // Dev tree: src-tauri/sidecars/recombyn-api/…
      candidates.push(dir.join("sidecars").join("recombyn-api").join(name));
      if let Some(src_tauri) = dir.parent() {
        candidates.push(
          src_tauri
            .join("sidecars")
            .join("recombyn-api")
            .join(name),
        );
      }
    }
  }

  // Cargo / tauri dev cwd is often apps/web/src-tauri
  candidates.push(PathBuf::from("sidecars").join("recombyn-api").join(name));

  for c in candidates {
    if c.is_file() {
      return Some(c);
    }
  }
  None
}

fn resolve_python(api_root: &Path) -> PathBuf {
  let venv = if cfg!(windows) {
    api_root.join(".venv").join("Scripts").join("python.exe")
  } else {
    api_root.join(".venv").join("bin").join("python")
  };
  if venv.is_file() {
    return venv;
  }
  PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
}

fn resolve_api_root() -> Option<PathBuf> {
  if let Ok(raw) = std::env::var("RECOMBYN_API_ROOT") {
    let p = PathBuf::from(raw);
    if p.join("app").join("main.py").is_file() {
      return Some(p);
    }
  }
  let candidates = [
    PathBuf::from("../api"),
    PathBuf::from("../../api"),
    PathBuf::from("../../../apps/api"),
  ];
  for c in candidates {
    if c.join("app").join("main.py").is_file() {
      return Some(c.canonicalize().unwrap_or(c));
    }
  }
  None
}

fn apply_local_env(cmd: &mut Command, data_dir: &Path) {
  let storage = data_dir.join("storage");
  let _ = std::fs::create_dir_all(storage.join("uploads"));
  let _ = std::fs::create_dir_all(storage.join("results"));

  let db_path = storage.join("recombyn.db");
  let upload_dir = storage.join("uploads");
  let result_dir = storage.join("results");
  // Explicit sqlite URL — empty DATABASE_URL can be dropped on Windows spawn and
  // then apps/api/.env MySQL would be used by mistake.
  let db_url = format!("sqlite:///{}", db_path.to_string_lossy().replace('\\', "/"));

  cmd.env("DATABASE_URL", db_url)
    .env("SQLITE_DB_PATH", db_path.to_string_lossy().as_ref())
    .env("UPLOAD_DIR", upload_dir.to_string_lossy().as_ref())
    .env("RESULT_DIR", result_dir.to_string_lossy().as_ref())
    .env("S3_ENABLED", "false")
    .env("DESKTOP_LOCAL_AUTO_LOGIN", "true")
    .env("RECOMBYN_API_HOST", "127.0.0.1")
    .env("RECOMBYN_API_PORT", "8000");
}

fn wait_ready(child: &mut Child) -> Result<(), String> {
  let deadline = Instant::now() + Duration::from_secs(90);
  while Instant::now() < deadline {
    if let Ok(Some(status)) = child.try_wait() {
      return Err(format!("local API exited early: {status}"));
    }
    if port_open("127.0.0.1", 8000) {
      log::info!("local API ready");
      return Ok(());
    }
    std::thread::sleep(Duration::from_millis(400));
  }
  let _ = child.kill();
  Err("timed out waiting for local API on 127.0.0.1:8000".into())
}

fn spawn_windows_flags(cmd: &mut Command) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
}

/// Start bundled sidecar or Python uvicorn when mode=local and :8000 is free.
pub fn ensure_local_api(app: &AppHandle, data_dir: &Path) -> Result<Option<Child>, String> {
  if desktop_mode() != "local" {
    log::info!("desktop mode is not local — skip API sidecar");
    return Ok(None);
  }

  if port_open("127.0.0.1", 8000) {
    log::info!("local API already listening on 127.0.0.1:8000");
    return Ok(None);
  }

  if let Some(sidecar) = resolve_bundled_sidecar(app) {
    log::info!("starting bundled API sidecar: {:?}", sidecar);
    let mut cmd = Command::new(&sidecar);
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(dir) = sidecar.parent() {
      // cwd = onedir folder (exe + _internal). Do not set RECOMBYN_API_ROOT —
      // frozen app resolves seeds via sys._MEIPASS.
      cmd.current_dir(dir);
    }
    apply_local_env(&mut cmd, data_dir);
    spawn_windows_flags(&mut cmd);
    let mut child = cmd
      .spawn()
      .map_err(|e| format!("failed to spawn bundled API ({sidecar:?}): {e}"))?;
    wait_ready(&mut child)?;
    return Ok(Some(child));
  }

  let api_root = resolve_api_root().ok_or_else(|| {
    "No bundled recombyn-api sidecar and apps/api not found. \
     Run: npm run build:desktop:sidecar (or use apps/api .venv in dev)."
      .to_string()
  })?;
  let py = resolve_python(&api_root);
  log::info!(
    "starting local API via Python: py={:?} cwd={:?}",
    py,
    api_root
  );

  let mut cmd = Command::new(&py);
  cmd.args([
    "-m",
    "uvicorn",
    "app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ])
  .current_dir(&api_root)
  .stdout(Stdio::null())
  .stderr(Stdio::null())
  .env("RECOMBYN_API_ROOT", api_root.to_string_lossy().as_ref());
  apply_local_env(&mut cmd, data_dir);
  spawn_windows_flags(&mut cmd);

  let mut child = cmd
    .spawn()
    .map_err(|e| format!("failed to spawn local API ({py:?}): {e}"))?;
  wait_ready(&mut child)?;
  Ok(Some(child))
}

pub fn stop_child(child: &mut Option<Child>) {
  if let Some(mut c) = child.take() {
    let _ = c.kill();
    let _ = c.wait();
  }
}

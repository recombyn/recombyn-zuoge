//! Detect / spawn local coding-agent CLIs (Claude Code, Codex, …).
//! Mutually exclusive with the Design Agent path — FE never calls both.
//! Workspace: `{app_data}/cli-workspaces/{projectId}/` with scene + ops contract files.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct CodingCliState(pub Mutex<Option<Child>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingCliInfo {
  pub id: String,
  pub name: String,
  pub bin: String,
  pub available: bool,
  pub version: Option<String>,
}

#[derive(Clone, Serialize)]
struct CodingCliChunk {
  text: String,
}

#[derive(Clone, Serialize)]
struct CodingCliDone {
  code: i32,
}

#[derive(Clone, Serialize)]
struct CodingCliErr {
  message: String,
}

struct Candidate {
  id: &'static str,
  name: &'static str,
  bin: &'static str,
}

const CANDIDATES: &[Candidate] = &[
  Candidate {
    id: "claude",
    name: "Claude Code",
    bin: "claude",
  },
  Candidate {
    id: "codex",
    name: "Codex CLI",
    bin: "codex",
  },
  Candidate {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
  },
  Candidate {
    id: "cursor-agent",
    name: "Cursor Agent",
    bin: "agent",
  },
];

fn spawn_windows_flags(cmd: &mut Command) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
}

fn resolve_bin(bin: &str) -> Option<String> {
  #[cfg(windows)]
  {
    let mut cmd = Command::new("where.exe");
    cmd.arg(bin);
    spawn_windows_flags(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
      return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
  }
  #[cfg(not(windows))]
  {
    let mut cmd = Command::new("which");
    cmd.arg(bin);
    let out = cmd.output().ok()?;
    if !out.status.success() {
      return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
  }
}

fn probe_version(bin_path: &str) -> Option<String> {
  let mut cmd = Command::new(bin_path);
  cmd.arg("--version").stdout(Stdio::piped()).stderr(Stdio::piped());
  spawn_windows_flags(&mut cmd);
  let out = cmd.output().ok()?;
  let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
  if text.is_empty() {
    text = String::from_utf8_lossy(&out.stderr).trim().to_string();
  }
  if text.is_empty() {
    None
  } else {
    Some(text.lines().next().unwrap_or(&text).trim().to_string())
  }
}

fn build_cli_command(cli_id: &str, bin_path: &str) -> Result<Command, String> {
  let mut cmd = Command::new(bin_path);
  match cli_id {
    // Prompt on stdin (`-p` with no prompt arg) — avoids Windows argv length limits.
    "claude" => {
      cmd.args(["-p", "--output-format", "text"]);
    }
    "codex" => {
      cmd.args(["exec", "-"]);
    }
    "opencode" => {
      cmd.args(["run"]);
    }
    "cursor-agent" => {
      cmd.args(["-p"]);
    }
    _ => return Err(format!("unsupported coding CLI: {cli_id}")),
  }
  Ok(cmd)
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
  app
    .path()
    .app_data_dir()
    .unwrap_or_else(|_| std::env::temp_dir().join("recombyn"))
}

fn sanitize_project_id(raw: &str) -> String {
  let s: String = raw
    .chars()
    .map(|c| {
      if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
        c
      } else {
        '_'
      }
    })
    .collect();
  let trimmed = s.trim_matches('_');
  if trimmed.is_empty() {
    "default".into()
  } else {
    trimmed.chars().take(80).collect()
  }
}

fn resolve_workspace_rel_path(root: &Path, rel: &str) -> Result<PathBuf, String> {
  let rel = rel.trim().replace('\\', "/");
  if rel.is_empty() {
    return Err("empty workspace file path".into());
  }
  if Path::new(&rel).is_absolute() {
    return Err(format!("workspace path must be relative: {rel}"));
  }
  let mut out = root.to_path_buf();
  for comp in Path::new(&rel).components() {
    match comp {
      Component::Normal(seg) => out.push(seg),
      Component::CurDir => {}
      _ => return Err(format!("invalid workspace path segment in: {rel}")),
    }
  }
  if !out.starts_with(root) {
    return Err(format!("workspace path escapes root: {rel}"));
  }
  Ok(out)
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingCliWorkspaceFile {
  pub path: String,
  pub content: String,
}

/// Create/refresh `{app_data}/cli-workspaces/{projectId}` and write relative files.
#[tauri::command]
pub fn prepare_coding_cli_workspace(
  app: AppHandle,
  project_id: String,
  files: Vec<CodingCliWorkspaceFile>,
) -> Result<String, String> {
  let root = app_data_dir(&app)
    .join("cli-workspaces")
    .join(sanitize_project_id(&project_id));
  std::fs::create_dir_all(&root).map_err(|e| format!("create workspace failed: {e}"))?;

  for file in files {
    let dest = resolve_workspace_rel_path(&root, &file.path)?;
    if let Some(parent) = dest.parent() {
      std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    std::fs::write(&dest, file.content.as_bytes())
      .map_err(|e| format!("write {} failed: {e}", file.path))?;
  }

  root
    .to_str()
    .map(|s| s.to_string())
    .ok_or_else(|| "workspace path is not valid UTF-8".into())
}

pub fn stop_coding_cli(child: &mut Option<Child>) {
  if let Some(mut c) = child.take() {
    let _ = c.kill();
    let _ = c.wait();
  }
}

#[tauri::command]
pub fn list_coding_clis() -> Vec<CodingCliInfo> {
  CANDIDATES
    .iter()
    .map(|c| {
      let path = resolve_bin(c.bin);
      let available = path.is_some();
      let version = path.as_ref().and_then(|p| probe_version(p));
      CodingCliInfo {
        id: c.id.to_string(),
        name: c.name.to_string(),
        bin: c.bin.to_string(),
        available,
        version,
      }
    })
    .collect()
}

#[tauri::command]
pub fn kill_coding_cli(state: State<CodingCliState>) -> Result<(), String> {
  let mut guard = state
    .0
    .lock()
    .map_err(|_| "coding CLI state lock poisoned".to_string())?;
  stop_coding_cli(&mut guard);
  Ok(())
}

#[tauri::command]
pub fn run_coding_cli(
  app: AppHandle,
  state: State<CodingCliState>,
  cli_id: String,
  prompt: String,
  cwd: Option<String>,
) -> Result<(), String> {
  let id = cli_id.trim().to_string();
  let prompt = prompt.trim().to_string();
  if id.is_empty() {
    return Err("cliId required".into());
  }
  if prompt.is_empty() {
    return Err("prompt required".into());
  }
  let work_dir = cwd
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
  if let Some(ref dir) = work_dir {
    let path = Path::new(dir);
    if !path.is_dir() {
      return Err(format!("cwd is not a directory: {dir}"));
    }
  }
  let cand = CANDIDATES
    .iter()
    .find(|c| c.id == id)
    .ok_or_else(|| format!("unknown coding CLI: {id}"))?;
  let bin_path = resolve_bin(cand.bin).ok_or_else(|| {
    format!(
      "{} ({}) not found on PATH — install the CLI or pick another engine",
      cand.name, cand.bin
    )
  })?;

  {
    let mut guard = state
      .0
      .lock()
      .map_err(|_| "coding CLI state lock poisoned".to_string())?;
    stop_coding_cli(&mut guard);
  }

  let mut cmd = build_cli_command(&id, &bin_path)?;
  if let Some(ref dir) = work_dir {
    cmd.current_dir(dir);
  }
  cmd
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
  spawn_windows_flags(&mut cmd);

  let mut child = cmd
    .spawn()
    .map_err(|e| format!("failed to spawn {}: {e}", cand.bin))?;

  if let Some(mut stdin) = child.stdin.take() {
    let body = format!("{prompt}\n");
    let _ = stdin.write_all(body.as_bytes());
    let _ = stdin.flush();
  }

  let stdout = child
    .stdout
    .take()
    .ok_or_else(|| "missing CLI stdout".to_string())?;
  let stderr = child
    .stderr
    .take()
    .ok_or_else(|| "missing CLI stderr".to_string())?;

  {
    let mut guard = state
      .0
      .lock()
      .map_err(|_| "coding CLI state lock poisoned".to_string())?;
    *guard = Some(child);
  }

  let app_out = app.clone();
  thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
      match line {
        Ok(text) => {
          let chunk = if text.ends_with('\n') {
            text
          } else {
            format!("{text}\n")
          };
          let _ = app_out.emit("coding-cli-chunk", CodingCliChunk { text: chunk });
        }
        Err(_) => break,
      }
    }
  });

  let app_err = app.clone();
  thread::spawn(move || {
    let reader = BufReader::new(stderr);
    for line in reader.lines() {
      if let Ok(text) = line {
        if text.trim().is_empty() {
          continue;
        }
        let _ = app_err.emit(
          "coding-cli-chunk",
          CodingCliChunk {
            text: format!("{text}\n"),
          },
        );
      }
    }
  });

  let app_done = app.clone();
  thread::spawn(move || {
    let Some(cli_state) = app_done.try_state::<CodingCliState>() else {
      let _ = app_done.emit(
        "coding-cli-error",
        CodingCliErr {
          message: "coding CLI state missing".into(),
        },
      );
      return;
    };
    let code = {
      let mut guard = match cli_state.0.lock() {
        Ok(g) => g,
        Err(_) => {
          let _ = app_done.emit(
            "coding-cli-error",
            CodingCliErr {
              message: "coding CLI state lock poisoned".into(),
            },
          );
          return;
        }
      };
      match guard.as_mut() {
        Some(child) => match child.wait() {
          Ok(status) => {
            *guard = None;
            status.code().unwrap_or(1)
          }
          Err(e) => {
            *guard = None;
            let _ = app_done.emit(
              "coding-cli-error",
              CodingCliErr {
                message: format!("CLI wait failed: {e}"),
              },
            );
            return;
          }
        },
        None => 0,
      }
    };
    if code == 0 {
      let _ = app_done.emit("coding-cli-done", CodingCliDone { code });
    } else {
      let _ = app_done.emit(
        "coding-cli-error",
        CodingCliErr {
          message: format!("CLI exited with code {code}"),
        },
      );
    }
  });

  Ok(())
}

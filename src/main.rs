#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]
use tauri::api::process::Command;
use tauri::api::process::CommandEvent;
use std::path::Path;
use std::process::exit;

/* Modifiable settings */

const REPO_PATH: &str = ".discochat";

/* -- Settings end  -- */

#[tokio::main]
async fn main() {
  if !Path::new(".discochat").is_dir() {
    let mut init = Command::new_sidecar("kubo").unwrap();
    init = init.args(["init",
      "--repo-dir", REPO_PATH]);
    init.output().unwrap();

    init = Command::new_sidecar("kubo").unwrap();
    init = init.args(["config", "--json",
      "--repo-dir", REPO_PATH,
      "API.HTTPHeaders.Access-Control-Allow-Origin", "[\"tauri://localhost\"]"]);
    init.output().unwrap();

    init = Command::new_sidecar("kubo").unwrap();
    init = init.args(["config", "--json",
      "--repo-dir", REPO_PATH,
      "Ipns.UsePubsub", "true"]);
    init.output().unwrap();

    init = Command::new_sidecar("kubo").unwrap();
    init = init.args(["config", "--json",
      "--repo-dir", REPO_PATH,
      "Addresses.Gateway", "null"]);
    init.output().unwrap();
  }
  let mut daemon = Command::new_sidecar("kubo").unwrap();
  daemon = daemon.args(["daemon",
    "--repo-dir", REPO_PATH,
    "--enable-gc",
    "--enable-pubsub-experiment"]);
  let (mut rx, kubo) = daemon.spawn().unwrap();

  tokio::spawn(async move {
    loop {
    	let cmd_event = rx.recv().await.unwrap();
	match cmd_event {
		CommandEvent::Stderr(s) => println!("{}", s),
		CommandEvent::Stdout(s) => println!("{}", s),
		CommandEvent::Error(s) => println!("{}", s),
		_ => {
			println!("The kubo node unexpectedly terminated.");
			exit(1);
		},
	}
    }
  });
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");

  _ = kubo.kill();
}

#![cfg_attr(
	all(not(debug_assertions), target_os = "windows"),
	windows_subsystem = "windows"
)]
use rand::Rng;
use std::path::Path;
use std::process::exit;
use tauri::api::process::Command;
use tauri::api::process::CommandEvent;

/* Modifiable settings */

const REPO_PATH: &str = ".discochat";

/* -- Settings end  -- */

static mut API_PORT: u32 = 0;
static mut SWARM_PORT: u32 = 0;

#[tauri::command]
fn get_api_port() -> u32 {
	unsafe { return API_PORT };
}

#[tauri::command]
fn get_swarm_port() -> u32 {
	unsafe { return SWARM_PORT };
}

#[tokio::main]
async fn main() {
	// Generate our API & SWARM port numbers...
	let mut rng = rand::thread_rng();
	unsafe {
		API_PORT = rng.gen_range(49152..65535);
		SWARM_PORT = rng.gen_range(49152..65535);

		if API_PORT == SWARM_PORT {
			println!(
				"API & SWARM ports generated the same number! Try running the application again..."
			);
			exit(1);
		}
	}

	// Repo not found? Make a new one!
	if !Path::new(REPO_PATH).is_dir() {
		// Initialise the repo
		// ipfs init --repo-dir REPO_PATH
		let mut init = Command::new_sidecar("kubo").unwrap();
		init = init.args(["init", "--repo-dir", REPO_PATH]);
		init.output().unwrap();

		// Allow tauri://localhost to control our daemon
		// ipfs config --json --repo-dir REPO_PATH API.HTTPHeaders.Access-Control-Allow-Origin ["tauri://localhost"]
		init = Command::new_sidecar("kubo").unwrap();
		init = init.args([
			"config",
			"--json",
			"--repo-dir",
			REPO_PATH,
			"API.HTTPHeaders.Access-Control-Allow-Origin",
			"[\"tauri://localhost\"]",
		]);
		init.output().unwrap();

		// Enable IPNS Pubsub (https://github.com/ipfs/kubo/blob/master/docs/experimental-features.md#ipns-pubsub)
		// ipfs config --json --repo-dir REPO_PATH Ipns.UsePubsub true
		init = Command::new_sidecar("kubo").unwrap();
		init = init.args([
			"config",
			"--json",
			"--repo-dir",
			REPO_PATH,
			"Ipns.UsePubsub",
			"true",
		]);
		init.output().unwrap();

		// Disable local gateway
		// ipfs config --json --repo-dir REPO_PATH Addresses.Gateway null
		init = Command::new_sidecar("kubo").unwrap();
		init = init.args([
			"config",
			"--json",
			"--repo-dir",
			REPO_PATH,
			"Addresses.Gateway",
			"null",
		]);
		init.output().unwrap();
	}

	// Configure the API port
	let mut daemon = Command::new_sidecar("kubo").unwrap();
	daemon = daemon.args([
		"config",
		"--json",
		"--repo-dir",
		REPO_PATH,
		"Addresses.API",
		&("[\"/ip4/127.0.0.1/tcp/".to_owned() + &get_api_port().to_string() + "\"]"),
	]);
	daemon.output().unwrap();

	// Configure the swarm port
	let swarm_port_str = &get_swarm_port().to_string();
	daemon = Command::new_sidecar("kubo").unwrap();
	daemon =
		daemon.args([
			"config",
			"--json",
			"--repo-dir",
			REPO_PATH,
			"Addresses.Swarm",
			&("[\"/ip4/0.0.0.0/tcp/".to_owned()
				+ swarm_port_str + "\",\"/ip6/::/tcp/"
				+ swarm_port_str + "\",\"/ip4/0.0.0.0/udp/"
				+ swarm_port_str + "/quic\", \"/ip6/::/udp/"
				+ swarm_port_str + "/quic\"]"),
		]);
	daemon.output().unwrap();

	// Run the daemon
	// ipfs daemon --repo-dir REPO_PATH --enable-gc --enable-pubsub-experiment
	daemon = Command::new_sidecar("kubo").unwrap();
	daemon = daemon.args([
		"daemon",
		"--repo-dir",
		REPO_PATH,
		"--enable-gc",
		"--enable-pubsub-experiment",
	]);
	let (mut rx, kubo) = daemon.spawn().unwrap();

	// Spawn a thread to monitor the kubo daemon, outputting anything it does as well.
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
				}
			}
		}
	});

	// Run Tauri application (this blocks until webview is closed)
	tauri::Builder::default()
		.invoke_handler(tauri::generate_handler![get_api_port, get_swarm_port])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");

	// Webview was closed, so let's tell kubo it's time to rest...
	_ = kubo.kill();
}

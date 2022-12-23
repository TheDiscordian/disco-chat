#![cfg_attr(
	all(not(debug_assertions), target_os = "windows"),
	windows_subsystem = "windows"
)]
extern crate base64;
extern crate serde;
extern crate serde_json;

use libp2p::identity;
use rand::Rng;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::exit;
use tauri::api::process::Command;
use tauri::api::process::CommandEvent;

/* Modifiable settings */

const REPO_PATH: &str = ".discochat";

/* -- Settings end  -- */

static mut API_PORT: u32 = 0;
static mut SWARM_PORT: u32 = 0;
static mut PRIV_KEY: String = String::new(); // These are both always assumed to be Ed25519
static mut PUB_KEY: String = String::new();

// get_api_port returns the port that the API is listening on.
#[tauri::command]
fn get_api_port() -> u32 {
	unsafe { return API_PORT };
}

// get_swarm_port returns the port that the swarm is listening on.
#[tauri::command]
fn get_swarm_port() -> u32 {
	unsafe { return SWARM_PORT };
}

// get_priv_key returns the private key of the node.
#[tauri::command]
fn get_priv_key() -> &'static str {
	unsafe { return &PRIV_KEY };
}

// get_pub_key returns the public key of the node.
#[tauri::command]
fn get_pub_key() -> &'static str {
	unsafe { return &PUB_KEY };
}

// config_kubo is a function that configures the kubo node, `args` is a list of arguments.
// Example usage: `config_kubo(["Ipns.UsePubsub", "true"])`
fn config_kubo<I>(args: I)
where
	I: IntoIterator,
	<I as IntoIterator>::Item: AsRef<str>,
{
	let mut init = Command::new_sidecar("kubo").unwrap();
	init = init.args(["config", "--json", "--repo-dir", REPO_PATH]);
	init = init.args(args);
	init.output().unwrap();
}

// set_keys gets the private and public keys of the node and sets them in the global variables.
fn set_keys() {
	// Get our Public and Private keys
	let config_file_contents =
		fs::read_to_string(REPO_PATH.to_owned() + "/config").expect("Error reading file");
	// Deserialize the JSON string into a HashMap.
	let map: HashMap<String, serde_json::Value> =
		serde_json::from_str(&config_file_contents).expect("Error parsing JSON");

	// Get the value associated with the key "Identity.PrivKey" as a string.
	let identity = map.get("Identity").expect("Key not found");

	let priv_key_b64 = identity["PrivKey"].as_str().expect("Value is not a string");

	let decoded = base64::decode(priv_key_b64).unwrap();
	// TODO consider decoding this on the js side so we know what kind of key we're working with on the frontend.
	let keypair = identity::Keypair::from_protobuf_encoding(&decoded).unwrap();

	let keypair_bytes: [u8; 64];
	#[allow(irrefutable_let_patterns)]
	if let identity::Keypair::Ed25519(ed25519) = keypair {
		keypair_bytes = ed25519.encode();
	} else {
		println!("DiscoChat only works with Ed25519 keys...");
		exit(1);
	}
	let (private_key, public_key) = keypair_bytes.split_at(32);

	unsafe {
		PRIV_KEY = base64::encode(private_key).to_owned();
		PUB_KEY = base64::encode(public_key).to_owned();
	}
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

		// Enable IPNS Pubsub (https://github.com/ipfs/kubo/blob/master/docs/experimental-features.md#ipns-pubsub)
		// ipfs config --json --repo-dir REPO_PATH Ipns.UsePubsub true
		config_kubo(["Ipns.UsePubsub", "true"]);

		// Disable local gateway
		// ipfs config --json --repo-dir REPO_PATH Addresses.Gateway null
		config_kubo(["Addresses.Gateway", "null"]);
	}

	// Configure the API port
	config_kubo([
		"Addresses.API",
		&("[\"/ip4/127.0.0.1/tcp/".to_owned() + &get_api_port().to_string() + "\"]"),
	]);

	// Configure the swarm port
	let swarm_port_str = &get_swarm_port().to_string();
	config_kubo([
		"Addresses.Swarm",
		&("[\"/ip4/0.0.0.0/tcp/".to_owned()
			+ swarm_port_str
			+ "\",\"/ip6/::/tcp/"
			+ swarm_port_str
			+ "\",\"/ip4/0.0.0.0/udp/"
			+ swarm_port_str
			+ "/quic\", \"/ip6/::/udp/"
			+ swarm_port_str
			+ "/quic\"]"),
	]);

	set_keys();

	// Allow tauri://localhost to control our daemon
	// ipfs config --json --repo-dir REPO_PATH API.HTTPHeaders.Access-Control-Allow-Origin ["tauri://localhost"]
	config_kubo([
		"API.HTTPHeaders.Access-Control-Allow-Origin",
		"[\"tauri://localhost\",\"http://127.0.0.1:1430\"]",
	]);

	// Run the daemon
	// ipfs daemon --repo-dir REPO_PATH --enable-gc --enable-pubsub-experiment
	let mut daemon = Command::new_sidecar("kubo").unwrap();
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
		.invoke_handler(tauri::generate_handler![
			get_api_port,
			get_swarm_port,
			get_priv_key,
			get_pub_key
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");

	// Webview was closed, so let's tell kubo it's time to rest...
	_ = kubo.kill();
}

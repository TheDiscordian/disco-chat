var ipfs = undefined;
var IPFS_API_PORT = -1;
var IPFS_SWARM_PORT = -1;

// get_private_key returns the private key of the node
async function get_private_key() {
	return __TAURI__.invoke('get_priv_key');
}

// get_public_key returns the public key of the node
async function get_public_key() {
	return __TAURI__.invoke('get_pub_key');
}

// INIT_IPFS initializes the IPFS node
async function INIT_IPFS() {
	IPFS_API_PORT = await __TAURI__.invoke('get_api_port');
	IPFS_SWARM_PORT = await __TAURI__.invoke('get_swarm_port');

	ipfs = await IpfsHttpClient.create({url: "http://127.0.0.1:"+IPFS_API_PORT.toString(), timeout: "5m"});
}
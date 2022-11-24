var ipfs = undefined;
var IPFS_API_PORT = -1;
var IPFS_SWARM_PORT = -1;

async function INIT_IPFS() {
	IPFS_API_PORT = await __TAURI__.invoke('get_api_port');
	IPFS_SWARM_PORT = await __TAURI__.invoke('get_swarm_port');

	ipfs = await IpfsHttpClient.create({url: "http://127.0.0.1:"+IPFS_API_PORT.toString(), timeout: "5m"});
}
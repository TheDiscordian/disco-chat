// fetchPeerInfo will try to resolve a PeerID over IPNS to get their profile information, returning it as an object
async function fetchPeerInfo(id, timeout) {
	if (timeout == undefined) {
		timeout = 5000;
	}
	let peer = undefined;
	for await (const name of ipfs.name.resolve(id, {timeout: timeout})) {
		peer = name;
	}
	if (peer == undefined) {
		return;
	}
	const content = [];
	try {
		for await (const chunk of ipfs.cat(peer, {timeout: timeout, length: 1024})) {
			content.push(chunk);
		}
	} catch {
		return;
	}
	if (content.length == 0) {
		return;
	}
	try {
		peer = JSON.parse(new TextDecoder().decode(content[0]));
	} catch {
		return;
	}
	return peer;
}

// publishProfile publishes our profile information to IPNS
async function publishProfile() {
	let cid = await ipfs.add(JSON.stringify({nick: currentNick, img: currentImg}));
	await ipfs.name.publish(cid.cid);
}
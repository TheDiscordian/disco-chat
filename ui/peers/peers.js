// updatePeer is the function that helps keep certain peer data like nick and img updated. If nick
// or img are empty, they are unchanged. topics can be used to also update certain rooms with data,
// which will be reflected in only those rooms (and in peerMap).
async function updatePeer(id, topic) {
	let peer = await fetchPeerInfo(id);
	let nick = "Anonymous";
	let img = "";
	if (peer != undefined && !isEmpty(peer.nick) && !isEmpty(peer.img)) {
		nick = peer.nick;
		img = peer.img;
	}
	if (nick.length > maxNickLength) {
		nick = nick.slice(0, maxNickLength)
	}

	peer = {};
	trusted = trustedPeerMap.has(id);
	inMap = peerMap.has(id);

	if (trusted && !inMap) {
		peerMap.set(id, trustedPeerMap.get(id));
		if (!isEmpty(peerMap.get(id).nick)) {
			inMap = true;
		}
		let _msgs = await getStoredMsgs(prefix+currentRoom);
		if (_msgs == null || _msgs.length == 0) {
			_msgs = [{"timestamp": new Date(new Date().getTime()/10)}];
		}
		await askForBacklog(currentRoom, lastMsgTimestampNotMe(_msgs), "");
		_msgs = null;
	}

	if (inMap) {
		peer = peerMap.get(id);
		peer.lastSeen = new Date().getTime();
		if (nick != "") {
			peer.nick = nick;
		}
		if (img != "" || (peer.img != "" && peer.imgURL == "")) {
			if (peer.img != img || peer.imgURL == "") {
				if (peer.imgURL != "" && peer.imgURL != undefined) {
					URL.revokeObjectURL(peer.imgURL);
				}
				if (img != "") {
					peer.img = img;
				} else {
					img = peer.img;
				}
				// FIXME remove await, increase timeout
				try {
					peer.imgURL = await loadImgURL(img);
				} catch {
					peer.imgURL = defaultAvatar;
				}
			}
		}
	} else {
		if (isEmpty(nick)) {
			nick = "Anonymous"
		}
		peer = { lastSeen: new Date().getTime(), img: img, nick: nick };
		if (!isEmpty(img)) {
			// FIXME remove await, increase timeout
			try {
				peer.imgURL = await loadImgURL(img);
			} catch {
				peer.imgURL = defaultAvatar;
			}
		} else {
			peer.imgURL = defaultAvatar;
		}
		console.log(id);
	}
	peerMap.set(id, peer);

	if (topic != "") {
		room = getRoom(topic);
		room.set(id, peer);
	}
	
	await updateUserList();

	if (trusted) {
		let tpeer = {}
		Object.assign(tpeer, peer);
		tpeer.imgURL = "";
		trustedPeerMap.set(id, tpeer);
		await localforage.setItem("trustedPeerMap", trustedPeerMap);
	}
	return peer;
}

// getPeerAvatarURL returns the avatar URL of a peer. If the peer is not in peerMap, it will be
// fetched.
async function getPeerAvatarURL(peer) {
	let p = peerMap.get(peer);
	if (p == undefined) {
		p = await fetchUser(peer);
		if (p == undefined) {
			return getAvatarURL("");
		}
	}
	return getAvatarURL(p.imgURL);
}

// getPeerNick returns the nick of a peer. If the peer is not in peerMap, it will be fetched.
async function getPeerNick(peer) {
	let p = peerMap.get(peer);
	if (p == undefined) {
		p = await fetchUser(peer);
		if (p == undefined) {
			return "Anonymous";
		}
	}
	return p.nick;
}

// fetchUser fetches a user from the network if it isn't in the userMap already, and returns the
// peer object. If it fails to fetch the user, it returns a default "Anonymous" profile (and sets it
// to the userMap).
async function fetchUser(id) {
	if (id == undefined) {
		return undefined;
	}
	let p = userMap.get(id);
	if (p == undefined) {
		p = await fetchPeerInfo(id, 2500);
		if (p != undefined) {
			p.imgURL = await loadImgURL(p.img);
		} else {
			p = {id:id,nick:"Anonymous",imgURL:getAvatarURL(""),img:""};
		}
		userMap.set(id, p);
	}
	return p;
}

// purgeInactiveUsers will remove users who haven't pinged in over 20 seconds from peerMap, which will omit peers from
// room lists (but not purge them).
function purgeInactiveUsers() {
	now = new Date().getTime();
	for (let [id, peer] of peerMap) {
		if (now - peer.lastSeen >= 20000) {
			if (peer.imgURL != "" && peer.imgURL != undefined) {
				URL.revokeObjectURL(peer.imgURL);
			}
			peerMap.delete(id);
		}
	}
	pcDisplay = document.getElementById("peerCount");
	pcDisplay.innerHTML = peerMap.size.toString();
}

// processes peeralives over pubsub
async function processPulse(msg) {
	let msgObj = await processMsg(msg);
	if (msgObj == null) {
		return;
	}
	lastPeer = new Date().getTime();
	updatePeer(msgObj.id, "");
	// ignore our own pulses, purge inactive users
	if (msgObj.id == me) {
		purgeInactiveUsers();
		return;
	}

	lastAlive = new Date().getTime();
}
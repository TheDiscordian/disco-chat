var maxBacklogToSend = 500; // max messages to transmit back for backlog
var backlogLock = 0;

// joinBacklogChan is called when a user joins a channel, subscribing to the backlog channel if not
// already subscribed.
async function joinBacklogChan(where) {
	if (roomSubscriptions.indexOf("BL_"+prefix+where) == -1) {
		roomSubscriptions.push("BL_"+prefix+where);
	}
	await ipfs.pubsub.subscribe("BL_"+prefix+where, processBacklogSignal);
}

// leaveBacklogChan is called when a user leaves a channel, unsubscribing from the backlog channel
// if subscribed.
async function leaveBacklogChan(where) {
	let roomIndex = roomSubscriptions.indexOf("BL_"+prefix+where);
	if (roomIndex != -1) {
		roomSubscriptions.pop(roomIndex);
	}
	await ipfs.pubsub.unsubscribe("BL_"+prefix+where);
}

// lastTime = msgs[msgs.length-1].timestamp;
// askForBacklog sends a request for backlog to a channel. `where` is the channel to request from, `lastTime` is the
// last message timestamp the user has, and `lastCID` is the last message CID the user has.
async function askForBacklog(where, lastTime, lastCID) {
	if (lastTime == undefined) {
		return;
	}
	await ipfs.pubsub.publish("BL_"+prefix+where, JSON.stringify({"type": "req", "lastTime": Math.floor(lastTime.getTime()/10), "lastCID": lastCID, "timestamp": new Date().getTime()/10}));
}

// processBacklogSignal is called when a backlog signal is received. It will process the signal and
// either send the user backlog or inject the backlog into the user's messages.
async function processBacklogSignal(msg) {
	// Don't process backlog from ourselves, only process backlog for peers we trust
	if (msg.id == me || !trustedPeerMap.has(msg.id)) {
		return
	}
	let where = msg.topic.split("+").splice(1).join("+");
	let json = await processMsg(msg, true);
	if (json == null) {
		return;
	}
	if (json.type == "req") {
		let msgs = await getStoredMsgs(prefix+where);
		msgs.splice(maxBacklogToSend);
		let lastTime = new Date(json.lastTime*10);
		let outMsgs = [];
		for (var i = 0; i < msgs.length;i++) {
			if (msgs[i].timestamp > lastTime) {
				outMsgs.push(msgs[i]);
			}
		}
		if (outMsgs.length > 0) {
			await ipfs.pubsub.publish("BL_"+prefix+where, JSON.stringify({"type": "rep", "msgs": JSON.stringify(outMsgs), "timestamp": new Date().getTime()/10}));
		}
	} else if (json.type == "rep") {
		// inject msgs into store
		console.log("Injecting backlog...");
		console.log(JSON.parse(json.msgs));
		await injectFromBacklog(where, JSON.parse(json.msgs));
	}
}

// wondering why backlog randomly broke while you were devving something? Likely this function crashed so the locks
// never resolve...this is obviously a terrible way to make anything. There are also several reasons for why it might
// have crashed.
// injectFromBacklog injects messages from backlog into the user's message store. `where` is the
// channel to inject into, and `msgs` is the array of messages to inject.
async function injectFromBacklog(where, msgs) {
	if (backlogLock > 0) {
		backlogLock += 1;
		setTimeout(function(){backlogLock -= 1;injectFromBacklog(where, msgs)}, 50*backlogLock);
		return;
	}
	backlogLock += 1;
	let _msgs = await getStoredMsgs(prefix+where);
	if (_msgs == null || _msgs.length == 0) {
		for (var i = 0; i < msgs.length; i++) {
			msgs[i].timestamp = new Date(msgs[i].timestamp);
		}
		await storeMsgs(prefix+where, msgs);
		if (where == currentRoom) {
			await changeChan(currentRoom, true);
		}
		backlogLock -= 1;
		return;
		
	}
	let newMsgs = [];
	for (var i = _msgs.length-1; i > 0; i--) {
		for (var ii = 0; ii < msgs.length; ii++) {
			if (_msgs[i].timestamp.toISOString() == msgs[ii].timestamp) {
				msgs[ii].timestamp = null;
			} else if (msgs[ii].timestamp != null && new Date(msgs[ii].timestamp) > _msgs[i].timestamp) {
				let oldMsgs = _msgs.splice(i+1);
				for (var iii = ii; iii < msgs.length; iii++) {
					if (msgs[iii].timestamp != null) {
						msgs[iii].timestamp = new Date(msgs[iii].timestamp);
						_msgs.push(msgs[iii]);
					}
				}
				_msgs.push(...oldMsgs);
				await storeMsgs(prefix+where, _msgs);
				if (where == currentRoom && msgs.length > 0) {
					await changeChan(currentRoom, true);
				}
				backlogLock -= 1;
				return;
			}
		}
	}
	backlogLock -= 1;
}
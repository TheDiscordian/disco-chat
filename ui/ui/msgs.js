// scrollMsgs is attached to the message area. It's used for grabbing local backlog and loading it if available when
// scrolled up.
async function scrollMsgs(ev) {
	if (ev.path == undefined) {
		target = ev.target;
	} else {
		target = ev.path[0];
	}
	let scrolled = target.scrollTop/target.scrollHeight;
	if (scrolling || maxMsgsToLoad == -1 || (scrolled > 0.02 && !mobile || scrolled > 0.05 && mobile)) {
		return;
	}
	scrolling = true;
	let msgs = await getStoredMsgs(prefix+currentRoom);
	if (msgs != null) {
		let initialMax = target.scrollHeight;
		let newHTML = "";
		if (msgs.length == msgsLoaded) {
			scrolling = false;
			return;
		}
		let remaining = msgs.length-msgsLoaded;
		let i = Math.max(0, remaining-maxMsgsToLoad);
		msgs = msgs.slice(i, remaining);
		msgsLoaded += msgs.length;
		let lastMsg = "";
		for (let i = 0; i < msgs.length; i++) {
			let monologue = false;
			if (lastMsg == msgs[i].from) {
				monologue = true;
			}
			newHTML += await addMsg(msgs[i], monologue, false);
			lastMsg = msgs[i].id;
		}
		target.innerHTML = newHTML + target.innerHTML;
		target.scrollTop += target.scrollHeight - initialMax;
	}
	scrolling = false;
}

// addMsg will either return the HTML that would be used to append a message to the message area, or if outputLive is
// truthy, it will update the live message area and scroll down the message window. Monologue should be true if the
// last message was from the same person.
async function addMsg(msg, monologue, outputLive) {

	if (msg.id == undefined) {
		msg.id = "";
	}
	msg.nick = await getPeerNick(msg.id);

	let peerMd5 = md51(msg.id);
	let peerIdentifier = btoa(String.fromCharCode.apply(null, Int32ArrayToUInt8Array(peerMd5)));
	if (typeof(msg.inlineImg) == "string" && typeof(msg.inlineVid) == "string" && msg.inlineImg != "" && msg.inlineVid != "") {
		console.log("Someone tried to get you to load in too much memory:");
		console.log(msg);
	}

	let innerHTML = "";
	if (outputLive != false) {
		c = document.getElementById("chat");
		innerHTML = c.innerHTML;
	}

	let peerAvatarURL = await getPeerAvatarURL(msg.id);

	if (!monologue) {
		innerHTML += "<a href='#' onclick='showUserInfoBox(event, \""+msg.id+"\");'><img src='"+
			peerAvatarURL+"' class='msgPfp'/>"+getNickHTML(msg.id, msg.nick, false, 115)+"</a>";
	}
	if (msg.timestamp == undefined) {
		msg.timestamp = new Date();
	} else if (typeof(msg.timestamp) == "string") {
		msg.timestamp = new Date(msg.timestamp);
	}
	let timestamp = msg.timestamp.getHours().toString().padStart(2, "0")+":"+
		msg.timestamp.getMinutes().toString().padStart(2, "0")+":"+
		msg.timestamp.getSeconds().toString().padStart(2, "0")+" ";
	let extraClass = "";
	if (msg.notified) {
		extraClass = " notified";
	}
	innerHTML += "<div class='chatMsg"+extraClass+"'><span class='timestamp' title='"+msg.timestamp.toString()+"'>"+timestamp+"</span>";

	if (msg.msg != undefined && msg.msg != "") {
		if (outputLive) {
			console.log("<"+msg.nick+"@"+peerIdentifier.slice(0, peerIdentifier.length/2)+"> "+msg.msg);
		}
		innerHTML += cleanString(msg.msg, true);
	} else if (msg.inlineImg != "" && msg.inlineImg != undefined) {
		innerHTML += "<img onload='injectImage(event, \""+msg.inlineImg+"\", \""+msg.mime+"\");' onclick='showBigImage(\""+msg.inlineImg+"\", \""+msg.mime+"\");' class='inlineImg' src='./media/loading.gif' />";
	} else if (msg.inlineVid != "" && msg.inlineVid != undefined) {
		let vidSize = await getVidSize(msg.inlineVid);
		if (vidSize > 0) {
			vidSize = (vidSize/1024**2).toFixed(2);
		}
		innerHTML += "<span onclick='showFloatingVideo(\""+msg.inlineVid+"\", \""+msg.mime+"\");' class='videoMsg'>Click here to play a video ("+vidSize+"MiB).</span>";
	}

	innerHTML += "</div>";
	
	if (outputLive != false) {
		c.innerHTML = innerHTML;
		c.scrollTop = c.scrollHeight;
	} else {
		return innerHTML;
	}
}

// out is used for processing recieved messages and outputting them both to console and the message box.
async function out(msg) {
	let msgObj = await processMsg(msg);
	if (msgObj == null || (isEmpty(msgObj.msg) && isEmpty(msgObj.inlineImg) && isEmpty(msgObj.inlineVid))) {
		return;
	}
	// NOTE: This used to be "let peer = await [...]"
	updatePeer(msgObj.id, msg.topic);

	if (msgObj.id != me && typeof(msgObj.msg) == "string" && msgObj.msg.toLowerCase().includes(currentNick.toLowerCase())) {
		document.getElementById("notificationSound").play();
		msgObj.notified = true;
	}

	let room = getRoom(msg.topic);
	let msgs = await getStoredMsgs(msg.topic);
	if (msgs == null) {
		msgs = [];
	}

	msgs.push(msgObj);

	await storeMsgs(msg.topic, msgs);

	if (msg.topic == prefix+currentRoom) {
		let monologue = false;
		if (room.get("_lastMsg") == msgObj.id) {
			monologue = true;
		}
		await addMsg(msgObj, monologue);
		msgsLoaded += 1;
		room.set("_unread", 0);
	} else {
		unread = 0;
		if (room.has("_unread")) {
			unread = room.get("_unread");
		}
		unread += 1;
		room.set("_unread", unread);
	}
	room.set("_lastMsg", msgObj.id);
	roomMap.set(msg.topic, room);
	updateRoomList();
}
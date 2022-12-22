/*
type Message struct {
	Nick string
	Msg string
	Img string // cid of profile picture
	inlineImg string // cid of inline image
	inlineVid string // cid of inline video
	mime string // mimetype if inlineImg or inlineVid set

	for string // peerID of recipient (encrypted)
	n uint16 // nonce for encryption
}
*/

// processMsg takes a msg, and returns the json inside if it's valid (not repeated or expired). Returns null if invalid.
async function processMsg(msg, backlog) {
	msg.id = msg.from.string;
	if (msg.id == undefined) {
		msg.id = msg.from.toString();
	}
	let msgid = msg.id + msg.sequenceNumber.toString();
	if (msgIds.has(msgid)) {
		console.log("!REPEATED MESSAGE FOUND " + msg.id);
		console.log(msg);
		console.log(msgid);
		return null;
	}
	msgIds.set(msgid);

	if ((backlog != true && msg.data.length > messageSizeLimit) || (backlog == true && msg.data.length > maxBacklogToSend * messageSizeLimit)) {
		console.log("!!!LONG MESSAGE FOUND FROM " + msg.id);
		return null;
	}

	let json = "";
	try {
		json = new TextDecoder().decode(msg.data);
	} catch (e) {
		json = msg.data;
	}
	let msgObj = JSON.parse(json);
	msgObj.id = msg.from.string;
	if (typeof(msgObj.timestamp) != "number") {
		console.log("Timestamp not a number");
		return null;
	}
	msgObj.timestamp = new Date(msgObj.timestamp*10);
	since = (new Date() - msgObj.timestamp)/1000; // time elapsed in seconds
	if (since > messageExpiry || since*-1 > messageExpiry) {
		console.log("!!EXPIRED MESSAGE FOUND " + msg.id);
		console.log(msg);
		return null;
	}

	// is this an encrypted message for us?
	if (msgObj.for != undefined) {
		if (msgObj.id != me && msgObj.for != me) {
			return null;
		}
		msgObj.msg = await decryptMsg(msgObj);
	}
	
	return msgObj;
}

// usage: await sendmsg("Hello", "example_channel");
async function sendmsg(msg, chan) {
	if (msg.nick != undefined) {
		await localforage.setItem('nick', msg.nick);
	}
	await ipfs.pubsub.publish(prefix+chan, JSON.stringify(msg));
}

// used for triggering a sendmsg from user input
async function sendMsg() {
	let chatInput = document.getElementById("chatInput");
	let msg = chatInput.value;
	if (currentNick == "" || msg == "") {
		return true;
	}
	textPosition = 0;
	let vs = document.getElementById("visibility-selector");

	if (vs.value == "Everyone") {
		sendmsg({"msg":msg, "timestamp":Math.floor(new Date().getTime()/10)}, currentRoom);
	} else {
		let [encryptedMsg, uniqueN] = await encryptMsg(msg, vs.value);
		sendmsg({"msg":aesjs.utils.hex.fromBytes(encryptedMsg), "for":vs.value, "n":uniqueN, "timestamp":Math.floor(new Date().getTime()/10)}, currentRoom);
	}
	chatInput.value = "";
	chatInput.rows = 1;
	toggleEmojiPicker(false);
}

// sendImage is called when the user clicks the "Send Image" button from the image sharing menu. It adds the image to IPFS and sends a message with the CID.
async function sendImage(ev) {
	ev.target.disabled = true;
	imageSelection = document.getElementById("imageSelection");
	if (currentNick == "" || imageSelection.value == "") {
		return;
	}
	if (imageSelection.files[0].size > inlineImageFileSizeLimit) {
		console.log("Img too large");
		showError("Image must be less than " + (inlineImageFileSizeLimit / 1024 ** 2).toFixed(2) + "MiB.");
	} else {
		let cid = await ipfs.add(imageSelection.files[0]);
		let msg = {"nick":currentNick, "inlineImg": cid.path, "img": currentImg, "mime": imageSelection.files[0].type, "timestamp":Math.floor(new Date().getTime()/10)};
		sendmsg(msg, currentRoom);
		imageSelection.value = "";
		$('#shareImageMenu').modal("hide");
	}
	ev.target.disabled = false;
}

// sendVideo is called when the user clicks the "Send Video" button from the video sharing menu. It adds the video to IPFS and sends a message with the CID to the current room.
async function sendVideo(ev) {
	ev.target.disabled = true;
	videoSelection = document.getElementById("videoSelection");
	if (currentNick == "" || videoSelection.value == "") {
		return;
	}
	if (videoSelection.files[0].size > inlineVideoFileSizeLimit) {
		console.log("Vid too large");
		showError("Video must be less than " + (inlineVideoFileSizeLimit / 1024 ** 2).toFixed(2) + "MiB.");
	} else {
		let cid = await ipfs.add(videoSelection.files[0]);
		sendmsg({"nick":currentNick, "inlineVid": cid.path, "img": currentImg, "mime": videoSelection.files[0].type, "timestamp":Math.floor(new Date().getTime()/10)}, currentRoom);
		videoSelection.value = "";
		$('#shareVideoMenu').modal("hide");
	}
	ev.target.disabled = false;
}

// getStoredMsgs is used to get messages from local storage
async function getStoredMsgs(room) {
	let stored = await loadLocalItem("chan_"+room);
	if (stored == null) {
		return null
	}
	return stored; 
}

// storeMsgs should be called immediately after a message is received and appended to the message total.
// It enforces `maxMsgstoStore`.
async function storeMsgs(room, msgs) {
	if (maxMsgsToStore == -1 || msgs.length <= maxMsgsToStore) {
		await localforage.setItem("chan_"+room, msgs);
	} else {
		await localforage.setItem("chan_"+room, msgs.split(msgs.length-maxMsgsToStore));
	}
}

// returns the timestamp of the last message not by the current peer or some time in the past if none
function lastMsgTimestampNotMe(msgs) {
	if (me == null) { return; }
	for (var i = msgs.length-1; i > 0;i--) {
		if (msgs[i].id != me) {
			return msgs[i].timestamp;
		}
	}
	return new Date(new Date().getTime()/10);
}
const version = "v0.0.0";
const messageSizeLimit = 20480; // limit for length of message
const userIconFileSizeLimit = 2097152; // limit for user icons
const inlineImageFileSizeLimit = 10485760; // limit for inline images
const inlineVideoFileSizeLimit = 134217728; // limit for inline videos
const maxNickLength = 100; // limit for user nicks (truncated if over) TODO move info like this into "metadata" and set a limit of like 100KB on that, ignore or drop peers that go over
const prefix = "discochat+"; // unique identifier for protocol. Called prefix because it's *usually* at the beginning, not because it's required to be. Changing this just makes it really easy to roll your own protocol.
const messageExpiry = 300; // time in seconds to consider message valid
const maxMsgsToSend = 300; // max number of messages to send in one burst upon a request for backlog
const defaultAvatar = "./media/AvatarDefault.png";

var lastAlive = 0;	// last keep-alive we saw from a relay
var lastPeer = 0; 	// last keep-alive we saw from another peer
var me; // our peerID
var peerMap = new Map(); // track total peer count
var userMap = new Map(); // track users / data
var trustedPeerMap = new Map(); // track trusted peers
var roomMap = new Map(); // track peer stats per room
var currentRoom = "global";
var lastRoom = "";
var roomSubscriptions = [];
var currentNick = "Anonymous";
var currentImg = ""; // CID of image
var textPosition = 0;
var inMemory = []; // media objects that are in memory loaded through URL.createObjectURL
var previewVideoObj = ""; // the preview for a video
var floatingVideoObj = ""; //
var floatingVideoCid = "";
var msgsLoaded = 0; // used for tracking index of messages loaded
var scrolling = false;
var updatingUserList = false; // used as a lock so userlist doesn't update multiple times at once (causes glitches)

var maxMsgsToStore = 2000; // max messages to store per room
var maxMsgsToLoad = 100; // number of messages to load at once

var _priv_key = null;
var _pub_key = null;

var msgIds = new Map();

// loadLocalItem is for migrating old nodes over to localforage. If the data has been stored by localforage already, this function is the equiv of `localforage.getItem.
async function loadLocalItem(item) {
	let lfItem = await localforage.getItem(item);
	if (lfItem != null) {
		return lfItem;
	}

	let lsItem = localStorage.getItem(item); // migrate data to new API if it resides on the old API
	if (lsItem != null) {
		try {
			lsItem = JSON.parse(lsItem);
		} catch {}
		await localforage.setItem(item, lsItem);
		return lsItem;
	}
	
	return null;
}

// toggleEmojiPicker will show or hide the emoji picker
function toggleEmojiPicker(show) {
	let ep = document.querySelector('emoji-picker');
	if (!ep.hidden) {
		ep.shadowRoot.getElementById("search").value = "";
		ep.$$.ctx[45](); // update emoji search
	}
	if (typeof(show) != "boolean") {
		ep.hidden = !ep.hidden
	} else if (show) {
		ep.hidden = false;
	} else {
		ep.hidden = true;
	}
	
	if (!ep.hidden) {
		ep.shadowRoot.getElementById("search").focus();
	}
}

// returns true if the text only contains whitespace and emoji (ignores line breaks too)
function allEmoji(t) {
	t = t.replaceAll("<br />", "");
	for (i = 0; i < t.length;i++) {
		code = t.charCodeAt(i);
		if (code < 128 && !(code == 32 || code == 10 || code == 13)) {
			return false;
		}
	}
	return true;
}

// cleanString removes any characters that could be used to break out of a string. This is used for
// cleaning user input.
function cleanString(s, markDown) {
	if (markDown) {
		output = new showdown.Converter({simplifiedAutoLink: true, strikethrough: true, tables: true,
			simpleLineBreaks: true,
			emoji: true, openLinksInNewWindow: true}).makeHtml(s);
		if (output.length > 7) {
			single = output.slice(3,output.length-4);
			if (allEmoji(single)) {
				output = "<p class='bigMsg'>"+single+"</p>";
			}
		}
		return output;
	}
	return s.replaceAll(/>/g, "&gt;").replaceAll(/</g, "&lt;");
}

// Int32ArrayToUInt8Array converts an Int32Array to a UInt8Array
function Int32ArrayToUInt8Array(a) {
	let _out = new Uint8Array(16);
	for (i = 0;i < 4;i++) {
		_out[i*4] = a[i] >> 24;
		_out[i*4+1] = a[i] >> 16 & 0xff;
		_out[i*4+2] = a[i] >> 8 & 0xff;
		_out[i*4+3] = a[i] & 0xff;
	}
	return _out;
}

// returns safe representation of nick in HTML, complete with colour encoding.
function getNickHTML(id, nick, full, limit) {
	if (limit == undefined) {
		limit = maxNickLength+16;
	}
	nameColours = ["#ff0000", "#f66", "#ff8000", "#ffff00", "#00ff00", "#80ff60", "#00ff77", "#00ffff", "#0000ff", "#77f",
		"#8000ff", "#ff00ff", "#eee", "#666", "#8E4904", "#F2B809", "#FF7FFF", "#00662F"];
	peerMd5 = md51(id);
	peerIdentifier = btoa(String.fromCharCode.apply(null, Int32ArrayToUInt8Array(peerMd5)));

	identifier = "";
	if ((me != id && !trustedPeerMap.has(id)) || full) {
		identifier = "@"+peerIdentifier.slice(0, peerIdentifier.length/2);
	}
	if (nick.length > limit-16) {
		nick = nick.slice(0, limit-16) + "...";
	}
	return "<span style='color:"+nameColours[Math.abs(peerMd5[0]+peerMd5[1]+peerMd5[2]+peerMd5[3])%nameColours.length]+";font-weight:bold;'>"+
		cleanString(nick)+identifier+"</span>";
}

// leaveChan will unsubscibe from and leave a channel. Executing changeChan into "global" if the currentRoom is left.
async function leaveChan(chan) {
 	leaveBacklogChan(chan);
	let roomIndex = roomSubscriptions.indexOf(prefix+chan);
	if (roomIndex != -1) {
		roomSubscriptions.pop(roomIndex);
	}
	ipfs.pubsub.unsubscribe(prefix+chan);
	roomMap.delete(prefix+chan);
	lastRoom = chan;
	if (currentRoom == chan) {
		currentRoom = "global";
		await changeChan(currentRoom);
	}
	updateRoomList();
}

// isEmpty returns true if an object that'd typically contain a string, is realistically empty or not a string.
function isEmpty(str) {
	return (typeof(str) != "string" || !str.replace(/\s/g, '').length || str.replaceAll("\0", "") == "")
}

// usage: await joinchan("example_channel");
async function joinchan(chan) {
	await joinBacklogChan(chan);
	if (roomSubscriptions.indexOf(prefix+chan) == -1) {
		roomSubscriptions.push(prefix+chan);
	}
	await ipfs.pubsub.subscribe(prefix+chan, out);
}

// check if we still see other peers.
async function checkalive() {
	now = new Date().getTime();
	let subs = await ipfs.pubsub.ls();

	// Check if we're still subscribed to what we should be.
	if (subs.indexOf(prefix+"pulse-circuit") == -1) {
		await ipfs.pubsub.subscribe(prefix+"pulse-circuit", processPulse);
	}
	for (let i = 0;i < roomSubscriptions.length;i++) {
		if (subs.indexOf(roomSubscriptions[i]) == -1) {
			// re-join channel
			await ipfs.pubsub.subscribe(roomSubscriptions[i], out);
		}
	}

	if (now-lastAlive >= 35000) {
		if (now-lastPeer >= 35000) {
			document.getElementById("status-ball").style.color = "red";
		} else {
			document.getElementById("status-ball").style.color = "yellow";
		}
	} else {
		document.getElementById("status-ball").style.color = "lime";
	}
}

// returns room, creating it if non existant
function getRoom(topic) {
	if (!roomMap.has(topic)) {
			roomMap.set(topic, new Map());
	}
	return roomMap.get(topic);
}

// lines2rows counts the lines in the message box, and sets the height of the message box to fit the text
function lines2rows(ev) {
	if (ev == undefined) {
		return
	} else {
		msgBox = ev.target;
	}
	msgBox.rows = countLines(msgBox);
}

// set this to body's onload function
async function onload() {
	storedMap = await loadLocalItem("trustedPeerMap");
	if (storedMap != null && storedMap != undefined && storedMap != "") {
		if (storedMap.has == undefined) {
			console.log(storedMap);
			storedMap = new Map(storedMap);
		}
		trustedPeerMap = storedMap;
	}
	
	let _maxMsgsToStore = await localforage.getItem("maxMsgsToStore");
	if (_maxMsgsToStore != null) { maxMsgsToStore = _maxMsgsToStore; }
	let _maxMsgsToLoad = await localforage.getItem("maxMsgsToLoad");
	if (_maxMsgsToLoad != null) { maxMsgsToLoad = _maxMsgsToLoad; }

	await INIT_IPFS();

	// retrieve our keys
	let priv = await get_private_key();
	let pub = await get_public_key();
	// convert our keys into something nobleEd25519 likes
	_priv_key = Uint8Array.from(atob(priv), c => c.charCodeAt(0));
	_pub_key = Uint8Array.from(atob(pub), c => c.charCodeAt(0));

	// get our peerid
	try {	
		me = await ipfs.id();
	} catch {
		setTimeout(function(){onload()}, 1000);
		return;
	}
	me = me.id.toString();	

	storedNick = await loadLocalItem('nick');
	if (storedNick != null) {
		console.log(storedNick);
		currentNick = storedNick;
	} else {
		await publishProfile();
	}

	storedImg =  await loadLocalItem('currentImg');
	if (storedImg != null) {
		currentImg =  storedImg;
	}

	let myProfile = await fetchPeerInfo(me);
	if (myProfile == undefined) {
		await publishProfile();
	}

	document.getElementById("personalNickDisplay").onclick = function(event){showUserInfoBox(event, me)};

	// join the rooms we were in on last run
	storedRooms = await loadLocalItem('rooms');
	if (storedRooms == null || storedRooms == "") {
		await joinchan(currentRoom);
		getRoom(prefix+currentRoom);
	} else {
		if (typeof(storedRooms) == "string") { storedRooms = storedRooms.split(","); }
		for (i = 0; i < storedRooms.length; i++) {
			await joinchan(storedRooms[i]);
			getRoom(prefix+storedRooms[i]);
		}
	}

	await changeChan(currentRoom, true);
	await updateRoomList();
	document.getElementById("roomJoinBtn").disabled = false;

	updatePersonalNickDisplay();

	setInterval(checkalive, 1000);
	// personal keep-alives
	let pulse = function(){ipfs.pubsub.publish(prefix+"pulse-circuit", JSON.stringify({"timestamp":Math.floor(new Date().getTime()/10)}));}
	setInterval(pulse, 15000);
	await ipfs.pubsub.subscribe(prefix+"pulse-circuit", processPulse);
	pulse();

	let chatInput = document.getElementById("chatInput");

	// block for translating an enter keypress while in the chat input as a message submission
	chatInput.addEventListener("keydown", async function(e) {
		if (!e) { var e = window.event; }

		let shift = !e.shiftKey;
		if (mobile) { shift = !shift; }
		// Enter is pressed
		if (e.keyCode == 13 && shift) { 
			e.preventDefault();
			await sendMsg();
		}
		setTimeout(function(){textPosition = e.target.selectionStart;}, 1);
	}, false);
	
	chatInput.addEventListener("click", async function(e) {
		if (!e) { var e = window.event; }
		setTimeout(function(){textPosition = e.target.selectionStart;}, 1);
	}, false);
	
	chatInput.disabled = false;
	
	// block for translating an enter keypress while in the chat input as a message submission
	roomInput = document.getElementById("roomInput");
	roomInput.addEventListener("keydown", async function(e) {
		if (!e) { var e = window.event; }

		// Enter is pressed
		if (e.keyCode == 13) { 
			e.preventDefault();
			if (roomInput.value.replaceAll(" ", "") != "") {
				await changeChan(roomInput.value);
				roomInput.value = "";
			}
		}
	}, false);

	document.querySelector('emoji-picker').addEventListener('emoji-click', event => function(ev){
		chatInput = document.getElementById("chatInput");
		v = chatInput.value;
		v = v.slice(0, textPosition) + ev.detail.unicode + v.slice(textPosition);
		textPosition += ev.detail.unicode.length;
		chatInput.value = v;
	}(event));
	
	$('#roomJoinMenu').on('shown.bs.modal', function(e) {
		document.getElementById("roomInput").focus();
	});
	
	$('.modal').on('hidden.bs.modal', function(e) {
		document.getElementById("chatInput").focus();
		if (previewVideoObj != "") {
			URL.revokeObjectURL(previewVideoObj);
			previewVideoObj = "";
		}
	});
	
	document.getElementById("version-display").innerHTML = version;
}

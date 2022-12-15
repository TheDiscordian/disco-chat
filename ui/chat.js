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

/* BACKLOG STUFF BEGIN */

var maxBacklogToSend = 500; // max messages to transmit back for backlog
var backlogLock = 0;

async function joinBacklogChan(where) {
	if (roomSubscriptions.indexOf("BL_"+prefix+where) == -1) {
		roomSubscriptions.push("BL_"+prefix+where);
	}
	await ipfs.pubsub.subscribe("BL_"+prefix+where, processBacklogSignal);
}

async function leaveBacklogChan(where) {
	let roomIndex = roomSubscriptions.indexOf("BL_"+prefix+where);
	if (roomIndex != -1) {
		roomSubscriptions.pop(roomIndex);
	}
	await ipfs.pubsub.unsubscribe("BL_"+prefix+where);
}

// lastTime = msgs[msgs.length-1].timestamp;
async function askForBacklog(where, lastTime, lastCID) {
	if (lastTime == undefined) {
		return;
	}
	await ipfs.pubsub.publish("BL_"+prefix+where, JSON.stringify({"type": "req", "lastTime": Math.floor(lastTime.getTime()/10), "lastCID": lastCID, "timestamp": new Date().getTime()/10}));
}

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

/* BACKLOG STUFF END */

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

function updatePersonalNickDisplay() { // getNickHTML(id, nick, full, limit)
	document.getElementById("personalNickDisplay").innerHTML = getNickHTML(me, currentNick, true, 116);
}

async function showBigImage(imgCID, mime) {
	bigObj = document.getElementById("bigImage");
	if (bigObj.src != "") {
		URL.revokeObjectURL(bigObj.src);
	}
	imgURL = await loadImgURL(imgCID, mime, inlineImageFileSizeLimit);
	bigObj.src = imgURL;
	$("#imageViewerModal").modal();
}

function hideFloatingVideo() {
	document.getElementById("floating-video").hidden = true;
	player = document.getElementById("floating-player");
	player.pause();
	player.src = "";
	URL.revokeObjectURL(floatingVideoObj);
	floatingVideoObj = "";
	floatingVideoCid = "";
}

async function showFloatingVideo(cid, mime, limit) {
	if (floatingVideoObj != "") {
		URL.revokeObjectURL(floatingVideoObj);
		floatingVideoObj = "";
	}
	document.getElementById("floating-video").hidden = false;
	floatingVideoCid = cid;
	floatingVideoObj = await loadVidURL(cid, mime, limit);
	if (floatingVideoObj == "") {
		return;
	}
	if (floatingVideoCid != cid) {
		URL.revokeObjectURL(floatingVideoObj);
		return;
	}
	player = document.getElementById("floating-player");
	player.src = floatingVideoObj;
	player.addEventListener('loadeddata', function() { player.play(); }, false);
}

function hideBigImage() {
	bigObj = document.getElementById("bigImage");
	if (bigObj.src != "") {
		URL.revokeObjectURL(bigObj.src);
		bigObj.src = "";
	}
	$("#imageViewerModal").modal("hide");
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

function showError(err) {
	document.getElementById("errorMsg").innerHTML = err;
	$("#errorModal").modal();
}

function freeAllLooseMedia() {
	for (let i = 0; i < inMemory.length; i++) {
		URL.revokeObjectURL(inMemory[i]);
		inMemory.pop(i);
	}
}

/** Uses `URL.createObjectURL` free returned ObjectURL with `URL.RevokeObjectURL` when done with it.
 * 
 * @param {string} url CID you want to retrieve
 * @param {string} mime mimetype of image
 * @param {number} limit size limit of image in bytes
 * @returns ObjectURL
 */
async function loadImgURL(url, mime, limit, timeout) {
	if (limit == undefined) {
		limit = userIconFileSizeLimit;
		timeout = '5s';
	} else {
		if (timeout == undefined) {
			timeout = '5m';
		}
	}
	// Use this to createObjectURL. Free objects when users leave.
	if (url == "" || url == null || url == undefined) {
		return;
	}
	const content = [];
	for await (const chunk of ipfs.cat(url, {length:limit,timeout:timeout})) {
		content.push(chunk);
	}
	return URL.createObjectURL(new Blob(content, {type: mime}));
}

async function getVidSize(cid) {
	if (cid == "" || cid == null || cid == undefined) {
		return;
	}
	let total = -1;
	for await (const file of ipfs.ls(cid)) {
		if (file.size > 0) {
			if (total < 0) {
				total = file.size;
			} else {
				total += file.size;
			}
		}
	}
	return total;
}

async function loadVidURL(url, mime, limit) {
	if (limit == undefined) {
		limit = await getVidSize(url);
	}
	if (limit > inlineVideoFileSizeLimit) {
		limit = inlineVideoFileSizeLimit;
	}
	// Use this to createObjectURL. Free objects when users leave.
	if (url == "" || url == null || url == undefined) {
		return;
	}
	
	let loading = document.getElementById("videoLoading");
	let progress = document.getElementById("videoProgress");
	
	loading.hidden = false;
	progress.innerHTML = "0";
	let total = 0;
	
	const content = [];
	
	for await (const chunk of ipfs.cat(url, {length:limit})) {
		if (floatingVideoCid != url) {
			return "";
		}
		total += chunk.length;
		progress.innerHTML = (total / limit * 100).toFixed(0);
		content.push(chunk);
	}
	loading.hidden = true;
	return URL.createObjectURL(new Blob(content, {type: mime}));
}

function getAvatarURL(imgURL) {
	if (imgURL != undefined && imgURL != "") {
		return imgURL;
	}
	return defaultAvatar;
}

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

async function showUserUpdateMenu() {
	$('#userUpdateMenu').modal();
	document.getElementById("displayInput").value = currentNick;
	if (currentImg != "") {
		myData = peerMap.get(me);
		if (myData == undefined || myData.imgURL == "" || myData.imgURL == undefined) {
			myData = await updatePeer(me, "");
		}
		document.getElementById('userIconPreview').src = myData.imgURL;
	} else {
		document.getElementById('userIconPreview').src = defaultAvatar;
	}
}

async function showSettingsMenu() {
	$('#settingsMenu').modal();
	document.getElementById("maxMsgsToStoreInput").value = maxMsgsToStore.toString();
	document.getElementById("maxMsgsToLoadInput").value = maxMsgsToLoad.toString();
}

async function saveSettings() {
	maxMsgsToStore = parseInt(document.getElementById("maxMsgsToStoreInput").value);
	maxMsgsToLoad = parseInt(document.getElementById("maxMsgsToLoadInput").value);
	localforage.setItem("maxMsgsToStore", maxMsgsToStore);
	localforage.setItem("maxMsgsToLoad", maxMsgsToLoad);
	
	$('#settingsMenu').modal('hide');
}

/* room join menu */
async function showJoinRoomMenu() {
	if (roomMap.size >= 2) {
		showError("Joining more than 2 rooms is not currently supported, sorry.<br><br>For more information see <a href='https://github.com/TheDiscordian/native-ipfs-building-blox/issues/3' target='_blank'>TheDiscordian/native-ipfs-building-blox#3</a>.")
		return;
	}
	document.getElementById("roomInput").value = "";
	$('#roomJoinMenu').modal();
}

async function showShareImageMenu() {
	document.getElementById('imagePreview').src = "";
	$('#shareImageMenu').modal();
	toggleEmojiPicker(false);
}

async function showShareVideoMenu() {
	document.getElementById('videoPreview').src = "";
	$('#shareVideoMenu').modal();
	toggleEmojiPicker(false);
}

async function saveUserInfo() {
	newNick = document.getElementById("displayInput").value;
	if (newNick.replaceAll(" ", "") != "") {
		currentNick = newNick
	}
	selectionObj = document.getElementById("userIconSelection");
	if (selectionObj.value != "") {
		if (selectionObj.files[0].size > userIconFileSizeLimit) {
			console.log("Img too large");
			showError("Image must be less than " + (userIconFileSizeLimit / 1024 ** 2).toFixed(2) + "MiB.");
		} else {
			cid = await ipfs.add(selectionObj.files[0]);
			currentImg = cid.path;
			await localforage.setItem("currentImg", currentImg);
		}
	}

	publishProfile();
	updatePersonalNickDisplay();
	$('#userUpdateMenu').modal('hide');
}

$(window).on('click', function(event){
	toggleOptionsMenu(false);
	toggleActionsMenu(false);
	hideBigImage();
});

function toggleOptionsMenu(show) {
	oMObj = document.getElementById('optionsMenu');
	if (show == undefined) {
		setTimeout(function(){oMObj.hidden = !oMObj.hidden;}, 1);
	} else if (!show) {
		oMObj.hidden = true;
	} else {
		oMObj.hidden = false;
	}
}

function toggleActionsMenu(show) {
	aMObj = document.getElementById('actionsMenu');
	if (aMObj == undefined) {
		return
	}
	if (show == undefined) {
		setTimeout(function(){aMObj.hidden = !aMObj.hidden;}, 1);
		toggleEmojiPicker(false);
	} else if (!show) {
		aMObj.hidden = true;
	} else {
		aMObj.hidden = false;
	}
}

/*
type Message struct {
	Nick string
	Msg string
	Img string // cid of profile picture
	inlineImg string // cid of inline image
	inlineVid string // cid of inline video
	mime string // mimetype if inlineImg or inlineVid set
}
*/

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

function hideUserInfoBox() {
	document.getElementById("userInfoBox").hidden = true;
}

async function trustPeer(event, id, nick, img) {
	trustedPeerMap.set(id, {"nick": nick, "img": img});
	showUserInfoBox(event, id);
	await localforage.setItem("trustedPeerMap", trustedPeerMap);
}

async function untrustPeer(event, id) {
	trustedPeerMap.delete(id);
	showUserInfoBox(event, id);
	await localforage.setItem("trustedPeerMap", trustedPeerMap);
}

async function showUserInfoBox(event, id) {
	let room = getRoom(prefix+currentRoom);
	let user = room.get(id);
	if (user == undefined) {
		user = await fetchUser(id);
	}
	trustBtn = document.getElementById("userInfoBoxTrustBtn");
	trusted = false;
	if (id == me) {
		trusted = true;
		trustBtn.classList.add("disabled");
		trustBtn.onclick = null;
	} else {
		trustBtn.classList.remove("disabled");
	}
	if (trustedPeerMap.has(id)) {
		trusted = true;
	}

	document.getElementById("userInfoBoxDisplayName").innerHTML = getNickHTML(id, user.nick, true, 66);
	trustedObj = document.getElementById("userInfoBoxTrusted");
	if (trusted) {
		trustedObj.innerHTML = "Trusted";
		trustedObj.style = "color:#0f0;";
		trustBtn.innerHTML = "Untrust";
		trustBtn.onclick = function(){untrustPeer(event, id);};
	} else {
		trustedObj.innerHTML = "Untrusted";
		trustedObj.style = "color:#f00;";
		trustBtn.innerHTML = "Trust";
		trustBtn.onclick = function(){trustPeer(event, id, user.nick, user.img);};
	}
	userInfoBoxObj = document.getElementById("userInfoBox");
	document.getElementById("userInfoBox").hidden = false;
	userInfoBoxObj.style.top = event.clientY.toString()+"px";
	userInfoBoxObj.style.left = Math.min(event.clientX, window.innerWidth-userInfoBoxObj.clientWidth).toString()+"px";
	if (!isEmpty(user.img)) {
		document.getElementById("userIcon").src = await getPeerAvatarURL(id);
	} else {
		document.getElementById("userIcon").src = defaultAvatar;
	}
}

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

async function updateRoomList() {
	rl = document.getElementById("roomList");
	rl.innerHTML = "";
	roomArray = [];
	for (let [room, roomData] of roomMap) {
		roomName = room.slice(prefix.length);
		roomArray.push(roomName);
		safeName = roomName.replaceAll('"', '\\"').replaceAll("'", "\\'");
		
		extraClass = "";
		pill = "";
		if (roomName == currentRoom) {
			extraClass = " active";
		} else if (roomData.get("_unread") > 0) {
			pill = "<span class='badge badge-primary badge-pill' style='float:right;'>"+roomData.get("_unread")+"</span>";
		}
		
		rl.innerHTML += '<li class="list-group-item'+extraClass+'" id="room-'+safeName+
			'" onclick=\'changeChan("'+safeName+'");\'><a href="#">'+roomName+
			"</a><a style='float:right;padding-left:1em;z-index:5;' href='#' onclick=\"leaveChan('"+safeName+
			"');\">×</a>"+pill+"</li>";
	}
	await localforage.setItem('rooms', roomArray);
}

async function updateUserList() {
	if (updatingUserList) return;
	updatingUserList = true;
	let ul = document.getElementById("userList");
	let vs = document.getElementById("visibility-selector");
	ul.innerHTML = "";
	let curSelect = vs.value;
	vs.innerHTML = "";

	let option = document.createElement("option");
	option.innerText = "Everyone";
	vs.appendChild(option);

	let localPeerMap = getRoom(prefix+currentRoom);

	let connectedPeers = await ipfs.pubsub.peers(prefix+currentRoom);
	let updated = false;
	for (let i = 0; i < connectedPeers.length; i++) {
		if (!localPeerMap.has(connectedPeers[i]) && peerMap.has(connectedPeers[i])) {
			localPeerMap.set(connectedPeers[i], peerMap.get(connectedPeers[i]));
			updated = true;
		}
	}
	if (updated) {
		roomMap.set(prefix+currentRoom, localPeerMap);
	}

	for (let [id, peer] of localPeerMap) {
		if (id[0] == "_" || !peerMap.has(id)) {
			continue
		}
		if (peer.nick != undefined && peer.nick != "") {
			let avatar = await getPeerAvatarURL(id);
			ul.innerHTML += "<li class='list-group-item' onclick='showUserInfoBox(event, \""+id+
				"\");'><img class='userListAvatar' src='"+avatar+"'/>"+
				getNickHTML(id, peer.nick, false, 50)+"</li>";

			if (id != me) {
				option = document.createElement("option");
				option.innerText = peer.nick;
				option.value = id;
				vs.appendChild(option);
			}
		}
	}
	vs.value = curSelect;
	updatingUserList = false;
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

// Load image in async, put this in onload along with cid and mime type to load an image over IPFS (image should be set
// to a loading gif by default, is checked).
async function injectImage(ev, cid, mime) {
	let target = undefined;
	if (ev.path == undefined) {
		target = ev.target;
	} else {
		target = ev.path[0];
	}
	let src = target.src.slice(target.src.length-4);
	if (src != ".gif") { return }
	try {
		inlineImg = await loadImgURL(cid, mime, inlineImageFileSizeLimit);
		inMemory.push(inlineImg);
		target.src = inlineImg;
	} catch (e) {
		console.log("Failed to load image: ", e);
	}
}

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
	innerHTML += "<div class='chatMsg"+extraClass+"'><span class='timestamp' title='"+msg.timestamp.toString()+"'>"+timestamp+"</span>"

	if (msg.msg != undefined && msg.msg != "") {
		if (outputLive) {
			console.log("<"+msg.nick+"@"+peerIdentifier.slice(0, peerIdentifier.length/2)+"> "+msg.msg);
		}
		innerHTML += cleanString(msg.msg, true);
	} else if (msg.inlineImg != "" && msg.inlineImg != undefined) {
		innerHTML += "<img onload='injectImage(event, \""+msg.inlineImg+"\", \""+msg.mime+"\");' onclick='showBigImage(\""+msg.inlineImg+"\", \""+msg.mime+"\");' class='inlineImg' src='./media/loading.gif' />"
	} else if (msg.inlineVid != "" && msg.inlineVid != undefined) {
		innerHTML += "<span onclick='showFloatingVideo(\""+msg.inlineVid+"\", \""+msg.mime+"\");' class='videoMsg'>Click here to play a video ("+(await getVidSize(msg.inlineVid)/1024**2).toFixed(2)+"MiB).</span>"
	}

	innerHTML += "</div>";
	
	if (outputLive != false) {
		c.innerHTML = innerHTML;
		c.scrollTop = c.scrollHeight;
	} else {
		return innerHTML;
	}
}

// isEmpty returns true if an object that'd typically contain a string, is realistically empty or not a string.
function isEmpty(str) {
	return (typeof(str) != "string" || !str.replace(/\s/g, '').length || str.replaceAll("\0", "") == "")
}

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
		let other_pub = null;
		if (msgObj.id != me) {
			other_pub = bs58.decode(msg.id).subarray(6);
		} else {
			other_pub = bs58.decode(msgObj.for).subarray(6);
		}
		let secret = await nobleEd25519.getSharedSecret(_priv_key, other_pub);
		let encryptedBytes = aesjs.utils.hex.toBytes(msgObj.msg);
		let aesCtr = new aesjs.ModeOfOperation.ctr(secret, new aesjs.Counter(parseInt(msgObj.n)));
		msgObj.msg = aesjs.utils.utf8.fromBytes(aesCtr.decrypt(encryptedBytes));
	}
	
	return msgObj;
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
		let other_pub = bs58.decode(vs.value).subarray(6);
		let secret = await nobleEd25519.getSharedSecret(_priv_key, other_pub);
		let uniqueN = window.crypto.getRandomValues(new Uint16Array(1))[0];
		let aesCtr = new aesjs.ModeOfOperation.ctr(secret, new aesjs.Counter(uniqueN));
		let encryptedBytes = aesCtr.encrypt(aesjs.utils.utf8.toBytes(msg));
		sendmsg({"msg":aesjs.utils.hex.fromBytes(encryptedBytes), "for":vs.value, "n":uniqueN, "timestamp":Math.floor(new Date().getTime()/10)}, currentRoom);
	}
	chatInput.value = "";
	chatInput.rows = 1;
	toggleEmojiPicker(false);
}

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

// usage: await joinchan("example_channel");
async function joinchan(chan) {
	await joinBacklogChan(chan);
	if (roomSubscriptions.indexOf(prefix+chan) == -1) {
		roomSubscriptions.push(prefix+chan);
	}
	await ipfs.pubsub.subscribe(prefix+chan, out);
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

// changeChan is used to change a channel, updating the ui as needed, even joining the room if it's not already joined.
async function changeChan(to, first) {
	if (to == lastRoom) {
		lastRoom = "";
		return;
	}
	let roomJoinBtn = document.getElementById("roomJoinModalBtn");
	roomJoinBtn.disabled = true;
	scrolling = true;
	freeAllLooseMedia();
	if (!roomMap.has(prefix+to)) {
		await joinchan(to);
	}
	currentRoom = to;
	room = getRoom(prefix+to);
	c = document.getElementById("chat");
	c.innerHTML = "";
	let innerHTML = "";
	let msgs = await getStoredMsgs(prefix+to);
	if (msgs != null && msgs.length > 0) {
		if (maxMsgsToLoad != -1) {
			if (msgs.length > maxMsgsToLoad) {
				msgs = msgs.slice(msgs.length-maxMsgsToLoad);
				msgsLoaded = maxMsgsToLoad;
			} else {
				msgsLoaded = msgs.length;
			}
		} else {
			msgsLoaded = msgs.length;
		}
		let lastMsg = "";
		for (let i = 0; i < msgs.length; i++) {
			let monologue = false;
			if (lastMsg == msgs[i].id) {
				monologue = true;
			}
			innerHTML += await addMsg(msgs[i], monologue, false);
			lastMsg = msgs[i].id;
		}
		if (backlogLock == 0) {
			await askForBacklog(to, lastMsgTimestampNotMe(msgs), "");
		}
	} else {
		if (backlogLock == 0) {
			await askForBacklog(to, new Date(new Date().getTime()/10), "");
		}
	}
	c.innerHTML = innerHTML + c.innerHTML;
	room.set("_unread", 0);
	roomMap.set(prefix+to, room);
	c.scrollTop = c.scrollHeight;
	setTimeout(function(){c.scrollTop = c.scrollHeight;}, 250);
	room.set(me, await updatePeer(me, ""));
	updateRoomList();
	updateUserList();
	document.getElementById("chatInput").focus();
	$('#roomJoinMenu').modal('hide');
	roomJoinBtn.disabled = false;

	if (mobile && first != true) {
		toggleRoomList();
	}
	scrolling = false;
}

// check if we're still connected to the circuit relay (not required, but let's us know if we can see peers who may be stuck behind NAT)
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

// returns room, creating it if non existant
function getRoom(topic) {
	if (!roomMap.has(topic)) {
			roomMap.set(topic, new Map());
	}
	return roomMap.get(topic);
}

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

// updatePeer is the function that helps keep certain peer data like nick and img updated. If nick or img are empty,
// they are unchanged. topics can be used to also update certain rooms with data, which will be reflected in only those
// rooms (and in peerMap).
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

function lines2rows(ev) {
	if (ev == undefined) {
		return
	} else {
		msgBox = ev.target;
	}
	msgBox.rows = countLines(msgBox);
}

async function publishProfile() {
	let cid = await ipfs.add(JSON.stringify({nick: currentNick, img: currentImg}));
	await ipfs.name.publish(cid.cid);
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

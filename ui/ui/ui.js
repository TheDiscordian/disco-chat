// updatePersonalNickDisplay updates the personal nick display.
function updatePersonalNickDisplay() { // getNickHTML(id, nick, full, limit)
	document.getElementById("personalNickDisplay").innerHTML = getNickHTML(me, currentNick, true, 116);
}

// showError shows an error message in the error box.
function showError(err) {
	document.getElementById("errorMsg").innerHTML = err;
	$("#errorModal").modal();
}

// showUserUpdateMenu shows the user update menu.
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

// showSettingsMenu shows the settings menu.
async function showSettingsMenu() {
	$('#settingsMenu').modal();
	document.getElementById("maxMsgsToStoreInput").value = maxMsgsToStore.toString();
	document.getElementById("maxMsgsToLoadInput").value = maxMsgsToLoad.toString();
}

// saveSettings saves the settings to the local database.
async function saveSettings() {
	maxMsgsToStore = parseInt(document.getElementById("maxMsgsToStoreInput").value);
	maxMsgsToLoad = parseInt(document.getElementById("maxMsgsToLoadInput").value);
	localforage.setItem("maxMsgsToStore", maxMsgsToStore);
	localforage.setItem("maxMsgsToLoad", maxMsgsToLoad);
	
	$('#settingsMenu').modal('hide');
}

// showJoinRoomMenu shows the join room menu.
async function showJoinRoomMenu() {
	if (roomMap.size >= 2) {
		showError("Joining more than 2 rooms is not currently supported, sorry.<br><br>For more information see <a href='https://github.com/TheDiscordian/native-ipfs-building-blox/issues/3' target='_blank'>TheDiscordian/native-ipfs-building-blox#3</a>.")
		return;
	}
	document.getElementById("roomInput").value = "";
	$('#roomJoinMenu').modal();
}

// saveUserInfo saves the user info to the local database, adding their profile picture to their
// local IPFS node. This is called when the user clicks the save button in the user info box.
async function saveUserInfo() {
	newNick = document.getElementById("displayInput").value;
	if (newNick.replaceAll(" ", "") != "") {
		currentNick = newNick;
	}
	selectionObj = document.getElementById("userIconSelection");
	if (selectionObj.value != "") {
		if (selectionObj.files[0].size > userIconFileSizeLimit) {
			console.log("Img too large");
			showError("Image must be less than " + (userIconFileSizeLimit / 1024 ** 2).toFixed(2) + "MiB.");
			return;
		} else {
			cid = await ipfs.add(selectionObj.files[0]);
			currentImg = cid.path;
			await localforage.setItem("currentImg", currentImg);
		}
	}
	await localforage.setItem('nick', currentNick);

	publishProfile();
	updatePersonalNickDisplay();
	$('#userUpdateMenu').modal('hide');
}

// Everything to hide on window click
$(window).on('click', function(event){
	toggleOptionsMenu(false);
	toggleActionsMenu(false);
	hideBigImage();
});

// toggleOptionsMenu shows or hides the options menu.
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

// toggleActionsMenu shows or hides the actions menu.
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

// trustPeer adds a peer to the trustedPeerMap
async function trustPeer(event, id, nick, img) {
	trustedPeerMap.set(id, {"nick": nick, "img": img});
	showUserInfoBox(event, id);
	await localforage.setItem("trustedPeerMap", trustedPeerMap);
}

// untrustPeer removes a peer from the trustedPeerMap
async function untrustPeer(event, id) {
	trustedPeerMap.delete(id);
	showUserInfoBox(event, id);
	await localforage.setItem("trustedPeerMap", trustedPeerMap);
}

// showUserInfoBox is called when there's a click on a user's nick/profile picture
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

// updateRoomList is called when the room list needs to be updated, it will go through all the rooms
// in the roomMap and update the room list accordingly.
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


// hideUserInfoBox hides the user info box.
function hideUserInfoBox() {
	document.getElementById("userInfoBox").hidden = true;
}

// updateUserList is called when the user list needs to be updated, it will go through all the users
// in the current room and update the user list ui accordingly.
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

	// localPeerMap contains all the peers that are currently in the room.
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

// changeChan is used to change a channel, updating the ui as needed, even joining the room if it's
// not already joined.
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
// hideFloatingVideo hides the floating video player.
function hideFloatingVideo() {
	document.getElementById("floating-video").hidden = true;
	player = document.getElementById("floating-player");
	player.pause();
	player.src = "";
	URL.revokeObjectURL(floatingVideoObj);
	floatingVideoObj = "";
	floatingVideoCid = "";
}

// showFloatingVideo shows the floating video player. Loading the video from `cid` with mime type
// `mime`, `limit` sets the maximum size of the video to load.
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

// showBigImage shows the big image viewer. Loading the image from `imgCID` with mime type `mime`.
async function showBigImage(imgCID, mime) {
	bigObj = document.getElementById("bigImage");
	if (bigObj.src != "") {
		URL.revokeObjectURL(bigObj.src);
	}
	imgURL = await loadImgURL(imgCID, mime, inlineImageFileSizeLimit);
	bigObj.src = imgURL;
	$("#imageViewerModal").modal();
}

// hideBigImage hides the big image viewer.
function hideBigImage() {
	bigObj = document.getElementById("bigImage");
	if (bigObj.src != "") {
		URL.revokeObjectURL(bigObj.src);
		bigObj.src = "";
	}
	$("#imageViewerModal").modal("hide");
}

// showShareImageMenu shows the share image menu.
async function showShareImageMenu() {
	document.getElementById('imagePreview').src = "";
	$('#shareImageMenu').modal();
	toggleEmojiPicker(false);
}

// showShareVideoMenu shows the share video menu.
async function showShareVideoMenu() {
	document.getElementById('videoPreview').src = "";
	$('#shareVideoMenu').modal();
	toggleEmojiPicker(false);
}

// Load image in async, put this in onload along with cid and mime type to load an image over IPFS 
// (image should be set to a loading gif by default, is checked).
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
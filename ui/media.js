// freeAllLooseMedia frees all media that has been loaded with loadImgURL and loadVidURL.
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

// getVidSize returns the size of a video in bytes.
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

// loadVidURL is used to load a video from IPFS and return an ObjectURL to it (which must be freed).
// `url` is the CID of the video, `mime` is the mime type of the video, and `limit` is the size
// limit of the video in bytes.
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

// getAvatarURL returns the URL of the avatar for a given PeerID.
function getAvatarURL(imgURL) {
	if (imgURL != undefined && imgURL != "") {
		return imgURL;
	}
	return defaultAvatar;
}
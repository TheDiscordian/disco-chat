// decryptMsg is called by the receiver to decrypt the message. It takes the encrypted message
// (msgObj.msg), the sender's public key (msgObj.id), and the unique nonce used to encrypt the
// message (msgObj.n). If this message is from ourselves (me), it will use the msgObj.for key to
// decrypt it.
// 
// This function can only decrypt messages meant for us, or messages sent by us.
async function decryptMsg(msgObj) {
	let other_pub = null;
	if (msgObj.id != me) {
		other_pub = bs58.decode(msgObj.id).subarray(6);
	} else {
		other_pub = bs58.decode(msgObj.for).subarray(6);
	}
	let secret = await nobleEd25519.getSharedSecret(_priv_key, other_pub);
	let encryptedBytes = aesjs.utils.hex.toBytes(msgObj.msg);
	let aesCtr = new aesjs.ModeOfOperation.ctr(secret, new aesjs.Counter(parseInt(msgObj.n)));
	return aesjs.utils.utf8.fromBytes(aesCtr.decrypt(encryptedBytes));
}

// encryptMsg is called by the sender to encrypt a message. It takes the message (msg) and the
// receiver's public key (to). It returns an array containing the unique nonce and the encrypted
// message.
async function encryptMsg(msg, to) {
	let other_pub = bs58.decode(to).subarray(6);
	let secret = await nobleEd25519.getSharedSecret(_priv_key, other_pub);
	let uniqueN = window.crypto.getRandomValues(new Uint16Array(1))[0];
	let aesCtr = new aesjs.ModeOfOperation.ctr(secret, new aesjs.Counter(uniqueN));
	let encryptedBytes = aesCtr.encrypt(aesjs.utils.utf8.toBytes(msg));
	return [encryptedBytes, uniqueN];
}
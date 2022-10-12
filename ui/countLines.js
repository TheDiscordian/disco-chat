/** @type {HTMLTextAreaElement} */
var _buffer;

/**
 * Returns the number of lines in a textarea, including wrapped lines.
 *
 * __NOTE__:
 * [textarea] should have an integer line height to avoid rounding errors.
 */
// Thanks to Kin for this: https://stackoverflow.com/users/715857/kin
function countLines(textarea) {
	if (_buffer == null) {
		_buffer = document.createElement('textarea');
		_buffer.style.border = 'none';
		_buffer.style.height = '0';
		_buffer.style.overflow = 'hidden';
		_buffer.style.padding = '0';
		_buffer.style.position = 'absolute';
		_buffer.style.left = '0';
		_buffer.style.top = '0';
		_buffer.style.zIndex = '-1';
		document.body.appendChild(_buffer);
	}
	
	var cs = window.getComputedStyle(textarea);
	var pl = parseInt(cs.paddingLeft);
	var pr = parseInt(cs.paddingRight);
	var lh = parseInt(cs.lineHeight);
	
	// [cs.lineHeight] may return 'normal', which means line height = font size.
	if (isNaN(lh)) lh = parseInt(cs.fontSize);
	
	// Copy content width.
	_buffer.style.width = (textarea.clientWidth - pl - pr) + 'px';
	
	// Copy text properties.
	_buffer.style.font = cs.font;
	_buffer.style.letterSpacing = cs.letterSpacing;
	_buffer.style.whiteSpace = cs.whiteSpace;
	_buffer.style.wordBreak = cs.wordBreak;
	_buffer.style.wordSpacing = cs.wordSpacing;
	_buffer.style.wordWrap = cs.wordWrap;
	
	// Copy value.
	_buffer.value = textarea.value;
	
	var result = Math.floor(_buffer.scrollHeight / lh);
	if (result == 0) result = 1;
	return result;
}

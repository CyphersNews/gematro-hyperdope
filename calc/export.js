// ============================= Export =============================

// ---- Right-click export menu ----------------------------------------
//
// Everything in the Export tab, reachable without opening the menu. Each entry
// points at the existing Export button so there is one implementation of each
// action; `need` is a selector that must exist for the item to be usable,
// which keeps handlers that assume a panel is open from throwing.

var ctxExportItems = [
	{ label: "Print Cyphers Chart",    btn: "#btn-print-cipher-png",            need: "#ChartTable" },
	{ label: "Print History Table",    btn: "#btn-print-history-png",           need: ".HistoryTable" },
	{ label: "Print Word Breakdown",   btn: "#btn-print-word-break-png",        need: "#BreakTableContainer" },
	{ label: "Print Cyphers Card",     btn: "#btn-print-breakdown-details-png", need: "#BreakdownDetails" },
	{ label: "Print Number Properties",btn: "#btn-num-props-png",               need: ".numPropTooltip" },
	{ label: "Print Date Durations",   btn: "#btn-date-calc-png",               need: ".dateCalcTable2" },
	{ sep: true },
	{ label: "Export History (CSV)",   btn: "#btn-export-history-png",          need: ".HistoryTable" },
	{ label: "Export Matches (TXT)",   btn: "#btn-export-matches-txt",          need: ".HistoryTable" },
	{ label: "Export DB Query (CSV)",  btn: "#btn-export-db-query",             need: "#QueryTable" },
	{ sep: true },
	{ label: "Edit Table Caption",     action: "editTableCaption",              need: ".HistoryTable" },
	{ label: "Clear History Table",    action: "clearHistoryTable",             need: ".HistoryTable", danger: true },
	{ label: "Reset Settings to Default", action: "resetDefaults",              need: "#calcOptionsPanel", danger: true,
	  confirm: "Sure? Code rain is kept" }
]

function closeExportContextMenu() {
	$("#ctxExportMenu").remove()
}

// hovering anything else cancels the arming, so a second click always lands on
// the item the pointer is actually over
function ctxExportDisarmOthers(idx) {
	$("#ctxExportMenu .ctxExportArmed").each(function () {
		if (Number($(this).attr("data-idx")) === idx) return
		var item = ctxExportItems[Number($(this).attr("data-idx"))]
		$(this).removeClass("ctxExportArmed").text(item ? item.label : "")
	})
}

// puts an armed item back to its own label, so moving to another entry does not
// leave "Sure?" sitting there ready to fire
function ctxExportDisarm() {
	$("#ctxExportMenu .ctxExportArmed").each(function () {
		var item = ctxExportItems[Number($(this).attr("data-idx"))]
		$(this).removeClass("ctxExportArmed").text(item ? item.label : "")
	})
}

function runExportContextItem(idx, el) {
	var item = ctxExportItems[idx]
	if (!item || item.sep) return
	if (item.need && $(item.need).length === 0) return

	// Throwing away every cypher, colour and option is too much to do on a
	// mis-click, so an item carrying `confirm` asks first and stays open to be
	// clicked a second time. Nothing else in this menu loses anything that
	// cannot be got back, which is why they still fire straight away.
	if (item.confirm && el) {
		var $el = $(el)
		if (!$el.hasClass("ctxExportArmed")) {
			ctxExportDisarm()
			$el.addClass("ctxExportArmed").text(item.confirm)
			return
		}
	}

	closeExportContextMenu()
	if (item.action === "resetDefaults") {
		if (typeof resetCalcToDefaults === "function") resetCalcToDefaults(false)
		return
	}
	if (item.action === "clearHistoryTable") {
		phraseBoxKeypress(36) // "Home" keystroke, the app's own clear-history path
		return
	}
	if (item.action === "editTableCaption") {
		conf_HTC()
		return
	}
	$(item.btn).click() // reuse the Export tab's own handler
}

function showExportContextMenu(px, py) {
	closeExportContextMenu()

	var o = '<div id="ctxExportMenu">'
	o += '<div class="ctxExportTitle">Export</div>'
	for (var i = 0; i < ctxExportItems.length; i++) {
		var item = ctxExportItems[i]
		if (item.sep) { o += '<div class="ctxExportSep"></div>'; continue }
		var avail = $(item.need).length > 0
		o += '<div class="ctxExportItem'+(avail ? '' : ' ctxExportDisabled')+(item.danger ? ' ctxExportDanger' : '')+'" data-idx="'+i+'"'
		o += avail ? ' onclick="runExportContextItem('+i+', this)" onmouseenter="ctxExportDisarmOthers('+i+')"' : ' title="Not available right now"'
		o += '>'+item.label+'</div>'
	}
	o += '</div>'

	$(o).appendTo("body")

	// keep the menu on screen when opened near an edge
	var $m = $("#ctxExportMenu")
	var mw = $m.outerWidth(), mh = $m.outerHeight()
	var vw = $(window).width(), vh = $(window).height()
	var left = px, top = py
	if (left + mw > vw - 4) left = Math.max(4, vw - mw - 4)
	if (top + mh > vh + $(window).scrollTop() - 4) top = Math.max(4, py - mh)
	$m.css({ left: left + "px", top: top + "px" })
}

$(document).ready(function () {
	$("body").on("contextmenu", function (e) {
		var $t = $(e.target)
		// leave the native menu alone in text fields, and don't fight the
		// date-duration line handler which uses right-click to delete a line
		if ($t.is("input, textarea, select")) return
		if ($t.closest(".dateDurLine").length) return
		if ($t.closest("#ctxExportMenu").length) return
		e.preventDefault()
		showExportContextMenu(e.pageX, e.pageY)
	})
	$(document).on("click", function (e) {
		if ($(e.target).closest("#ctxExportMenu").length === 0) closeExportContextMenu()
	})
	$(document).on("keydown", function (e) {
		if (e.key === "Escape" || e.keyCode === 27) closeExportContextMenu()
	})
	$(window).on("scroll resize", closeExportContextMenu)
})

// ---- Word Breakdown export prep -------------------------------------
//
// The exported breakdown used to capture only #BreakTableContainer, which is
// the letter grid alone. Long phrases wrap across grid rows, so the image read
// as a sentence chopped into pieces with no way to tell what the phrase was,
// which cipher produced it, or what it totalled. We now capture #BreakdownSpot
// and stamp a header on it so the image is self-describing.

function breakdownExportHeader() {
	var i, curCipher = null
	for (i = 0; i < cipherList.length; i++) {
		if (cipherList[i].cipherName == breakCipher) { curCipher = cipherList[i]; break }
	}
	if (curCipher === null) return ""

	var phrase = breakPhraseText
	var total = breakPhraseTotal
	if (phrase === "") { // fall back to the input box if the breakdown never ran
		phrase = (optAllowPhraseComments) ? sValNoComments() : sVal()
		total = curCipher.calcGematria(sVal())
	}
	var col = (optColoredCiphers) ? 'color: hsl('+curCipher.H+' '+curCipher.S+'% '+curCipher.L+'% / 1);' : ''

	var o = '<div class="breakExportHeader">'
	o += '<div class="breakExportPhrase">'+phrase+'</div>'
	o += '<div class="breakExportMeta">'
	o += '<span class="breakExportTotal">'+total+'</span>'
	o += '<span class="breakExportCiph" style="'+col+'">'+curCipher.cipherName+gemCalcModeLabel(curCipher)+'</span>'
	o += '</div>'
	o += '</div>'
	return o
}

function prepBreakdownExport() {
	// hide the app's own compact line, the header replaces it
	$('#SimpleBreak').addClass('hideValue')
	$('#BreakdownSpot').prepend(breakdownExportHeader())
	$('#BreakdownSpot').addClass('breakExportMode') // solid bg + higher contrast values
}

function restoreBreakdownExport() {
	$('.breakExportHeader').remove()
	$('#BreakdownSpot').removeClass('breakExportMode')
	$('#SimpleBreak').removeClass('hideValue')
}

function openImageWindow(element, imgName = "", sRatio = window.devicePixelRatio, refresh = false) { // sRatio is scaling, refresh - update the image only
	var imageDataURL, wnd, scl
	if ( $(element).length ) { // if specified element exists
		// if browser zoom level is more than passed value, use current zoom level
		if (isNaN(sRatio)) { sRatio = window.devicePixelRatio }
		if (element == '#ChartSpot') { // remove space and backspace labels from Cipher Chart
			$('#spaceChartBtn').text('');$('#backspaceChartBtn').text('');
		}
		// html2canvas($(element)[0], {allowTaint: false, backgroundColor: window.getComputedStyle(document.querySelector('body')).getPropertyValue('background-color'), width: $(element).outerWidth()+2, height: $(element).outerHeight()+2, scale: sRatio} ).then((canvas) => { // e.g. html2canvas($("#ChartTable")[0]).then ...
		html2canvas($(element)[0], {allowTaint: false, backgroundColor: "rgba(0,0,0,0)", width: $(element).outerWidth()+10, height: $(element).outerHeight()+10, scale: sRatio} ).then((canvas) => { // e.g. html2canvas($("#ChartTable")[0]).then ...
			//allowTaint: true, backgroundColor: "rgba(22,26,34,1.0)" - render white bg as transparent
			//backgroundColor: calcBGhtml2canvas()
			//width: $(element).width(), height: $(element).height() - get proper element dimensions
			//console.log("done ... ");
			//$("#previewImage").append(canvas);
			
			// imageDataURL = canvas.toDataURL("image/png"); // canvas to "data:image/png;base64, ..."
			imageDataURL = trimCanvas(canvas); // canvas to "data:image/png;base64, ..."

			if (element == '.dateCalcTable2') { // restore date labels as input
				$('#dateDesc1Area').html('<input class="dateDescription" id="dateDesc1" value="'+dateDesc1Saved+'">')
				$('#dateDesc2Area').html('<input class="dateDescription" id="dateDesc2" value="'+dateDesc2Saved+'">')
				$('.dateCalcTable2').removeClass('elemBorderScr') // add outline
			}

			if (element == '#BreakdownDetails') { // restore chart style, remove outline
				$('#BreakdownDetails').removeClass('elemBorderScr') // remove outline for breakdown area
				updateWordBreakdown() // redraw cipher chart
			}

			if (element == '#BreakdownSpot') restoreBreakdownExport() // strip the export-only header

			imgName = imgName.replace(/'/g, '')
			if (imgName == "" || imgName.length >= 200) imgName = getTimestamp()+".png"; // filename for download button (200 char limit)

			// add download button and image data inside centered <div>
			//wnd = window.open(""); // open new window
			//wnd.document.body.innerHTML = "<div style='max-height: 100%; max-width: 100%; position: absolute; top: 50%; left: 50%; -webkit-transform: translate(-50%,-50%); transform: translate(-50%,-50%);'><center><br><a href='"+imageDataURL+"' download='"+imgName+"' style='font-family: arial, sans-serif; color: #dedede' >Download</a></center><br><img src="+canvas.toDataURL("image/png")+"></div>";
			//wnd.document.body.style.backgroundColor = "#000000"; // black background
			if (!refresh) {
				showPrintImagePreview(imageDataURL, imgName, element, sRatio) // show preview panel
			} else {
				$('#imgData').attr("src", imageDataURL) // update image only
				$('#downImgBtn').attr("onclick", "download('"+imgName+"', '"+imageDataURL+"')")
			}
		});
	}
}

function trimCanvas(c) { // remove transparent pixels
	var ctx = c.getContext('2d'),
		copy = document.createElement('canvas'),
		copyCtx = copy.getContext('2d'),
		pixels = ctx.getImageData(0, 0, c.width, c.height),
		l = pixels.data.length,
		i,
		bound = {
			top: null,
			left: null,
			right: null,
			bottom: null
		},
		x, y;

	for (i = 0; i < l; i += 4) {
		if (pixels.data[i+3] !== 0) {
			x = (i / 4) % c.width;
			y = ~~((i / 4) / c.width);
	
			if (bound.top === null) {
				bound.top = y;
			}
			
			if (bound.left === null) {
				bound.left = x; 
			} else if (x < bound.left) {
				bound.left = x;
			}
			
			if (bound.right === null) {
				bound.right = x; 
			} else if (bound.right < x) {
				bound.right = x;
			}
			
			if (bound.bottom === null) {
				bound.bottom = y;
			} else if (bound.bottom < y) {
				bound.bottom = y;
			}
		}
	}
		
	var trimHeight = bound.bottom - bound.top,
			trimWidth = bound.right - bound.left,
			trimmed = ctx.getImageData(bound.left, bound.top, trimWidth, trimHeight);
	
	copyCtx.canvas.width = trimWidth;
	copyCtx.canvas.height = trimHeight;
	copyCtx.putImageData(trimmed, 0, 0);
	
	// open new window with trimmed image:
	// return copyCtx.canvas;
	return copy.toDataURL("image/png");
}

function showPrintImagePreview(imageDataURL, imgName, element, sRatio) {
	$('<div id="darkOverlay" onclick="closePrintImagePreview()"></div>').appendTo('body'); // overlay

	var o = '<div class="printImageContainer">'
	o += '<center><div class="prevBtnArea">'
	o += '<input id="downImgBtn" type="button" value="Save Image" onclick="download(&#39;'+imgName+'&#39;, &#39;'+imageDataURL+'&#39;)">' // &#39; - single quote
	o += '<input class="refreshImgBtn" type="button" value="Refresh" onclick="openImageWindow(&#39;'+element+'&#39;, &#39;'+imgName+'&#39;, +&#39;'+sRatio+'&#39;, true);">'
	o += '</div></center>'
	o += '<div class="imgDataArea"><img id="imgData" src="'+imageDataURL+'"></div>'
	o += '</div>'

	$(o).appendTo('body'); // preview image
	$('body').addClass('noScroll') // prevent scrolling

	btnH = Math.ceil( $('.prevBtnArea').outerHeight() )
	o = 'height: calc(100% - '+btnH+'px);'
	$('.imgDataArea').attr("style", o)
}

function closePrintImagePreview() {
	$('#darkOverlay').remove();
	$('.printImageContainer').remove();
	$('body').removeClass('noScroll') // restore scrolling
	$('#ChartSpotScroll').removeClass('ChartSpotScrollStop'); // reset chart table for mobile devices
}

function getTimestamp() { // 2022-05-03_16-37-11
	var d = new Date()
	var ts = d.getFullYear()+'-'+pad((d.getMonth()+1))+'-'+pad(d.getDate())+'_'+
		pad(d.getHours())+'-'+pad(d.getMinutes())+'-'+pad(d.getSeconds())
	return ts
}

function pad(str, len = 2) { // add leading zeroes
	str = str.toString()
	while (str.length < len) str = "0" + str
	return str
}

function listAllCiphers() { // print cipher names/index to console
	for (i = 0; i < cipherList.length; i++) {
		console.log(i+": "+cipherList[i].cipherName)
	}
}

function exportCiphers() {
	var out =
		'// ciphers.js\n'+
		'\n'+
		'/*\n'+
		'new cipher(\n'+
			'\t"English Ordinal", // cipher name\n'+
			'\t"English", // category\n'+
			'\t120, 57, 36, // hue, saturation, lightness\n'+
			'\t[97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122], // lowercase characters\n'+
			'\t[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26], // values\n'+
			'\ttrue, // characters with diacritic marks have the same value as regular ones, default is "true"\n'+
			'\ttrue // enabled state, default is "false"\n'+
			'\tfalse // case sensitive cipher, default is "false"\n'+
		')\n'+
		'*/\n\n'

	out += exportCalcOptions()
	out += "cipherList = [\n"
	for (i = 0; i < cipherList.length; i++) {
		
		var cArr_ = []
		var vArr_ = []
		
		// Read list of characters
		for (m = 0; m < cipherList[i].cArr.length; m++) {
			// cArr_.push(String.fromCharCode(cipherList[i].cArr[m])) // character
			cArr_.push(cipherList[i].cArr[m]) // charcode
		}
		
		// Read values for each character
		for (m = 0; m < cipherList[i].vArr.length; m++) {
			vArr_.push(cipherList[i].vArr[m])
		}
		
		out +=
			'\tnew cipher(\n'+
			'\t\t"'+cipherList[i].cipherName+'",\n'+
			'\t\t"'+cipherList[i].cipherCategory+'",\n'+
			'\t\t'+cipherList[i].H+', '+cipherList[i].S+', '+cipherList[i].L+',\n'+
			'\t\t'+JSON.stringify(cArr_)+',\n'+
			'\t\t'+JSON.stringify(vArr_)+',\n'+
			'\t\t'+cipherList[i].diacriticsAsRegular+',\n'+
			'\t\t'+cipherList[i].enabled+',\n'+
			'\t\t'+cipherList[i].caseSensitive+'\n'+
			'\t),\n'
	}
	out = out.substring(0, out.length-2) + '\n]' // remove last comma and new line, close array
	console.log(out)

	out = 'data:text/js;charset=utf-8,'+encodeURIComponent(out) // format as text file
	// ciphers_2021-03-26_10-23-52.js
	download("ciphers_"+getTimestamp()+".js", out); // download file
}

function exportCiphersDB(expAllCiph = false) {
	var out = '// ciphers.js\n'
	out += exportCalcOptions()
	out += "cipherList = [\n"
	for (i = 0; i < cipherList.length; i++) {
		if (cipherList[i].enabled || expAllCiph) { // export only enabled ciphers
			var cArr_ = []
			var vArr_ = []
			
			// Read list of characters
			for (m = 0; m < cipherList[i].cArr.length; m++) {
				// cArr_.push(String.fromCharCode(cipherList[i].cArr[m])) // character
				cArr_.push(cipherList[i].cArr[m]) // charcode
			}
			
			// Read values for each character
			for (m = 0; m < cipherList[i].vArr.length; m++) {
				vArr_.push(cipherList[i].vArr[m])
			}
			
			out +=
				'\tnew cipher(\n'+
				'\t\t"'+cipherList[i].cipherName+'",\n'+
				'\t\t"'+cipherList[i].cipherCategory+'",\n'+
				'\t\t'+cipherList[i].H+', '+cipherList[i].S+', '+cipherList[i].L+',\n'+
				'\t\t'+JSON.stringify(cArr_)+',\n'+
				'\t\t'+JSON.stringify(vArr_)+',\n'+
				'\t\t'+cipherList[i].diacriticsAsRegular+',\n'+
				'\t\t'+cipherList[i].enabled+',\n'+
				'\t\t'+cipherList[i].caseSensitive+'\n'+
				'\t),\n'
		}
	}
	out = out.substring(0, out.length-2) + '\n]' // remove last comma and new line, close array
	return out
}

// The options block is parsed back with JSON.parse on restore, so each entry
// has to be a valid JSON string.
//
// Wrapping the line in bare quote characters is not enough: options whose
// value is itself a quoted string - coderainStyle ("new"), optHistTableCaption
// - produced "coderainStyle = "new"", which breaks the array. isJsonString()
// then failed for the whole block and importCalcOptions() was skipped without
// a word, so no option restored at all, from localStorage, a synced workspace
// or a preset. Only the cipher list came back.
//
// JSON.stringify escapes the inner quotes, so the entry survives the round
// trip and eval() still sees a plain assignment.
function exportCalcOptions() {
	var o = "calcOptions = [\n\t"
	for (var i = 0; i < calcOptionsArr.length; i++) {
		o += JSON.stringify(String(eval(calcOptionsArr[i])))+",\n\t"
	}
	o = o.slice(0,-3) + "\n]\n" // remove comma, new line, tab; new line, close array, new line
	return o
}

function exportHighlighterMatches(histArr) { // highlighter mode controls export mode
	if (histArr.length == 0) return
	if (optFiltCrossCipherMatch) {
		exportCrossCipherMatches(histArr)
	} else if (optFiltSameCipherMatch) {
		exportSameCipherMatches(histArr)
	}
}

function exportSameCipherMatches(histArr) {
	var pVal = [] // 2d array, all phrase values in one cipher for each existing cipher (use index to get cipher name, use index to get phrase)
	var tmp = [] // gematria values for one phrase (all ciphers)
	var g

	for (n = 0; n < cipherList.length; n++) { // for each enabled cipher
		tmp = [] // reset array
		for (i = 0; i < histArr.length; i++) { // for each phrase
			if (cipherList[n].enabled) {
				g = gemForMatching(cipherList[n], histArr[i]) // gematria for current phrase in one cipher
			} else {
				g = 0 // value for disabled ciphers
			}
			tmp.push(g) // separate phrase array
		}
		pVal.push(tmp) // add cipher with gematria, pVal[0][1] is cipherList[0], histArr[1]
	}

	var searchArr = [] // list of numbers that occur twice or more
	var matchArr = [] // array with matches within one cipher
	var o = '======= Same Cipher Match =======\n\n\n' // build string for output

	for (p = 0; p < pVal.length; p++) { // for each cipher
		searchArr = [] // reset
		matchArr = countMatches(pVal[p]) // 2d array, number/amount of matches in one cipher

		for (i = 0; i < matchArr.length; i++) { // for all available matches
			if (matchArr[i][1] >= 2) searchArr.push(matchArr[i][0]) // add those that occur twice or more
		}

		searchArr.sort(function(a, b) { // sort ascending order
			return a - b; //  b - a, for descending sort
		});
		if (searchArr[0] == 0) searchArr.splice(0,1) // remove zero (value for disabled ciphers)

		for (i = 0; i < searchArr.length; i++) { // for each valid match
			o += searchArr[i] + ' (' + cipherList[p].cipherName + ')' // 30 (English Ordinal)
			o += '\n================================='
			for (n = 0; n < pVal[p].length; n++) { // for each value in current cipher
				if (pVal[p][n] == searchArr[i]) { // if gematria equals current searched number
					o += '\n"' + histArr[n] + '"' // add "phrase"
				}
			}
			o += '\n\n\n' // number added, new lines
		}
	}

	o = o.substring(0, o.length-3) // remove last new lines

	o = 'data:text/plain;charset=utf-8,'+encodeURIComponent(o) // format as text file
	download(getTimestamp()+"_Same_Cipher_Match_gematria.txt", o); // download file
}

function exportCrossCipherMatches(histArr) { // maybe use highlighter mode to control behavior
	var allVal = [] // all gematria in one array
	var pVal = [] // 2d array, phrase [0], gematria value in cipher
	var tmp = [] // gematria values for one phrase (all ciphers)
	var g

	for (i = 0; i < histArr.length; i++) { // for each phrase
		tmp = [histArr[i]] // reset array, add phrase at index 0
		for (n = 0; n < cipherList.length; n++) { // for each existing cipher
			if (cipherList[n].enabled) {
				g = gemForMatching(cipherList[n], histArr[i]) // gematria for current cipher
			} else {
				g = 0 // zero value for disabled ciphers
			}
			tmp.push(g) // separate phrase array
			allVal.push(g) // all gematria array
		}
		pVal.push(tmp) // add phrase with gematria, cipher indices are offset +1
	}

	var matchArr = countMatches(allVal) // 2d array, number/amount of matches
	var searchArr = [] // list of numbers that occur twice or more

	for (i = 0; i < matchArr.length; i++) { // for all available matches
		if (matchArr[i][1] >= 2) searchArr.push(matchArr[i][0]) // add those that occur twice or more
	}
	
	searchArr.sort(function(a, b) { // sort ascending order
		return a - b; //  b - a, for descending sort
	});
	if (searchArr[0] == 0) searchArr.splice(0,1) // remove zero (value for disabled ciphers)

	var nP = true // new phrase flag (used to add cipher names to existing matches)
	var o = '============ Cross Cipher Match ============\n\n\n' // build string for output
	for (i = 0; i < searchArr.length; i++) { // for each valid match
		o += searchArr[i] // number
		o += '\n============================================'
		for (n = 0; n < pVal.length; n++) { // for each phrase
			nP = true // new phrase
			for (m = 0; m < pVal[n].length; m++) { // for each gematria value
				if (pVal[n][m] == searchArr[i] && nP) { // if gematria equals searched number
					o += '\n"' + pVal[n][0] + '" (' + cipherList[m-1].cipherName + ')' // "phrase" (English Ordinal)
					nP = false // current phrase was added
				} else if (pVal[n][m] == searchArr[i] && !nP) { // same phrase, different cipher match
					o += ', (' + cipherList[m-1].cipherName + ')' // , (Reverse Ordinal)
				}
			}
		}
		o += '\n\n\n' // number added, new lines
	}
	o = o.substring(0, o.length-3) // remove last new lines

	o = 'data:text/plain;charset=utf-8,'+encodeURIComponent(o) // format as text file
	download(getTimestamp()+"_Cross_Cipher_Match_gematria.txt", o); // download file
}

// ======================== Color Conversion ========================
// ------------ html2canvas has no support of HSL values ------------

function calcBGhtml2canvas() { // not used
	var element = document.querySelector('body')
	var compStyles = window.getComputedStyle(element)
	var bodyBg = compStyles.getPropertyValue('--body-bg-accent') // ' hsl(222 22% 16%)'
	var colArr = bodyBg.trim().split(" ") // remove leading/trailing spaces, split to array, space as delimiter
	for (i = 0; i < colArr.length; i++) {
		colArr[i] = Number( colArr[i].replace(/[^\d|^\.]/g, '') ) // remove anything that is not a digit or a literal dot, parse as number
	}
	return HSLtoRGB(colArr[0], colArr[1], colArr[2]) // rgb(32,37,50)
}

function HSLtoRGB(h, s, l) {
	var hsv = HSLtoHSV(h, s, l)
	return HSVtoRGB(hsv.h, hsv.s, hsv.v)
}

function HSLtoHSV(h, s, l) {
	h = h / 360, s = s / 100, l = l / 100;
	var _h = h,
		_s,
		_v;

	l *= 2;
	s *= (l <= 1) ? l : 2 - l;
	_v = (l + s) / 2;
	_s = (2 * s) / (l + s);

	return {
		h: _h * 360,
		s: _s * 100,
		v: _v * 100
	};
}

function HSVtoRGB(h, s, v) {
	var r, g, b, i, f, p, q, t;
	h = h / 360, s = s / 100, v = v / 100;

	i = Math.floor(h * 6);
	f = h * 6 - i;
	p = v * (1 - s);
	q = v * (1 - f * s);
	t = v * (1 - (1 - f) * s);
	switch (i % 6) {
		case 0: r = v, g = t, b = p; break;
		case 1: r = q, g = v, b = p; break;
		case 2: r = p, g = v, b = t; break;
		case 3: r = p, g = q, b = v; break;
		case 4: r = t, g = p, b = v; break;
		case 5: r = v, g = p, b = q; break;
	}
	return 'rgb('+Math.round(r * 255)+','+Math.round(g * 255)+','+Math.round(b * 255)+')'
}
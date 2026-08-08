// ========================== Cipher Class ==========================

class cipher { // cipher constructor class
	constructor(ciphName, ciphCategory, col_H, col_S, col_L, ciphCharacterSet, ciphValues, diacriticsAsRegular = true, ciphEnabled = false, caseSensitive = false) {
		this.cipherName = ciphName // cipher name
		this.cipherCategory = ciphCategory // cipher category
		this.H = col_H // hue
		this.S = col_S // saturation
		this.L = col_L // lightness
		this.cArr = ciphCharacterSet // character array
		this.vArr = ciphValues // value array
		this.diacriticsAsRegular = diacriticsAsRegular // if true, characters with diactritic marks have the same value as regular ones
		this.caseSensitive = caseSensitive // capital letters have different values
		this.enabled = ciphEnabled // cipher state on/off
		this.cp = []; this.cv = []; this.sumArr = [] // cp - character position, cv - character value, sumArr - phrase gematria value

		// A "wheel" cipher substitutes symbols rather than adding numbers, so its
		// values are strings: "12.", "E", "☉". Detected rather than declared,
		// so imported ciphers work without an extra constructor argument.
		this.wheelCipher = false
		for (var wi = 0; wi < ciphValues.length; wi++) {
			if (typeof ciphValues[wi] !== "number") { this.wheelCipher = true; break }
		}
		if (this.wheelCipher) this.buildWheelSequences()
	}

	// Wheel ciphers can map multi-character units ("ch", "sch", "qu"), which a
	// flat cArr cannot express. Those are encoded as a leading sequence length
	// followed by fixed-width groups of codepoints padded with 0, so
	// [2, 99,104, 100,0] means "ch" then "d". A plain one-codepoint-per-value
	// array is left as it is.
	buildWheelSequences() {
		var seqLen = this.cArr[0]
		var body = this.cArr.slice(1)
		this.wheelSeq = []

		if (seqLen >= 1 && seqLen <= 6 && body.length === seqLen * this.vArr.length) {
			for (var i = 0; i < this.vArr.length; i++) {
				var unit = ""
				for (var j = 0; j < seqLen; j++) {
					var cp = body[i * seqLen + j]
					if (cp > 0) unit += String.fromCodePoint(cp) // 0 is padding
				}
				this.wheelSeq.push(unit)
			}
		} else { // not sequence-encoded, one codepoint per value
			for (var k = 0; k < this.cArr.length; k++) {
				this.wheelSeq.push(String.fromCodePoint(this.cArr[k]))
			}
		}

		this.wheelMaxLen = 1
		for (var m = 0; m < this.wheelSeq.length; m++) {
			if (this.wheelSeq[m].length > this.wheelMaxLen) this.wheelMaxLen = this.wheelSeq[m].length
		}
	}

	// The cipher chart draws one column per unit, which is not the same as one
	// column per cArr entry: a sequence-encoded cipher stores a length header
	// and NUL padding that must never be drawn, and its multi-character units
	// ("ch", "sch") span several codepoints. wheelSeq already holds the real
	// units, so charts pair up with vArr the way they always did.
	chartChars() {
		if (this.wheelCipher && this.wheelSeq) return this.wheelSeq
		var out = []
		for (var i = 0; i < this.cArr.length; i++) out.push(String.fromCodePoint(this.cArr[i]))
		return out
	}

	// Greedy longest-match substitution. Longest first so "ch" wins over "c"
	// when both are defined.
	calcWheel(gemPhrase) {
		var out = ""
		var i = 0
		while (i < gemPhrase.length) {
			var hit = -1, len = 0
			for (var L = this.wheelMaxLen; L >= 1; L--) {
				var idx = this.wheelSeq.indexOf(gemPhrase.substr(i, L))
				if (idx > -1) { hit = idx; len = L; break }
			}
            if (hit > -1) {
				out += this.vArr[hit]
				i += len
			} else {
				if (gemPhrase.charAt(i) === " ") out += " " // keep word breaks
				i++
			}
		}
		return out
	}

	calcGematria(gemPhrase) { // calculate gematria of a phrase
		var i, ch_pos, cur_char
		var gemValue = 0
		var n = 0
		
		if (optAllowPhraseComments == true) { gemPhrase = gemPhrase.replace(/\[.+\]/g, '').trim() } // remove [...], leading/trailing spaces
		if (this.diacriticsAsRegular) gemPhrase = gemPhrase.normalize('NFD').replace(/[\u0300-\u036f]/g, "")
		if (this.caseSensitive == false) gemPhrase = gemPhrase.toLowerCase()

		// substitution ciphers return text, so they bypass every numeric path
		// below, including the digit handling at the end
		if (this.wheelCipher) return this.calcWheel(gemPhrase)

		if (optGemSubstitutionMode) { // each character is substituted with a correspondent value
			for (i = 0; i < gemPhrase.length; i++) {
				cur_char = gemPhrase.charCodeAt(i)
				ch_pos = this.cArr.indexOf(cur_char)
				if (ch_pos > -1) { // append value for each found character
					gemValue += this.vArr[ch_pos]
				}
			}
		} else if (optGemMultCharPos) { // multiply each charater value based on character index
			for (i = 0; i < gemPhrase.length; i++) {
				cur_char = gemPhrase.charCodeAt(i)
				ch_pos = this.cArr.indexOf(cur_char)
				if (ch_pos > -1) { // append value for each found character
					n++
					gemValue += this.vArr[ch_pos] * n
				}
			}
		} else if (optGemMultCharPosReverse) { // multiply each charater value (reverse index)
			for (i = gemPhrase.length; i >= 0; i--) {
				cur_char = gemPhrase.charCodeAt(i)
				ch_pos = this.cArr.indexOf(cur_char)
				if (ch_pos > -1) { // append value for each found character
					n++
					gemValue += this.vArr[ch_pos] * n
				}
			}
		}

		if (this.cArr.indexOf(49) == -1) { // if cipher doesn't contain "1"
			if (optNumCalcMethod == 1) { // Full, treat consecutive digits as one number
				var cur_num = ""
				var digitArr = [48,49,50,51,52,53,54,55,56,57] // 0-9
				var nArr = [0,1,2,3,4,5,6,7,8,9]
				for (i = 0; i < gemPhrase.length; i++) {
					cur_char = gemPhrase.charCodeAt(i)
					if (digitArr.indexOf(cur_char) > -1) {
						cur_num += String(nArr[digitArr.indexOf(cur_char)]) // append consecutive digits
					} else if (cur_num.length > 0 && cur_char !== 44) { // exclude comma as number separator
						gemValue += Number(cur_num) // add value of the number
						cur_num = "" // reset
					}
				}
				if (cur_num.length > 0) {
					gemValue += Number(cur_num) // add last number if present
				}
			} else if (optNumCalcMethod == 2) { // Reduced, add each digit separately
				for (i = 0; i < gemPhrase.length; i++) {
					cur_char = gemPhrase.charCodeAt(i)
					if (cur_char > 47 && cur_char < 58) { // 48 to 57, 0-9
						gemValue += cur_char - 48
					}
				}
			}
		}

		return gemValue
	}

	calcBreakdown(gemPhrase) { // character breakdown table
		var i, cIndex, wordSum //
		var lastSpace = true
		var n, nv // n - character for display, nv - charcode for calculation

		 // remove [...], separate brackets, leading/trailing spaces
		if (optAllowPhraseComments == true) { gemPhrase = gemPhrase.replace(/\[.+\]/g, '').replace(/\[/g, '').replace(/\]/g, '').trim() }

		// character positions, character values, current number (if char is a digit)
		this.cp = []; this.cv = []; this.curNum = ""; this.LetterCount = 0

		if (this.wheelCipher) {
			// No per-character grid for a substitution cipher: wordSum starts at 0
			// and would concatenate onto the symbols. The compact line shows the
			// substituted phrase instead, which is the useful readout.
			var src = (this.caseSensitive === false) ? gemPhrase.toLowerCase() : gemPhrase
			if (this.diacriticsAsRegular) src = src.normalize('NFD').replace(/[̀-ͯ]/g, "")
			this.LetterCount = src.replace(/\s/g, "").length
			this.WordCount = src.trim().length ? src.trim().split(/\s+/).length : 0
			this.sumArr = [this.calcWheel(src)]
			return
		}

		this.sumArr = []; wordSum = 0
		for (i = 0; i < gemPhrase.length; i++) {

			n = gemPhrase.charCodeAt(i); // get charcode for each character in phrase

			if (this.diacriticsAsRegular) { // if characters with diacritic marks are treated as regular characters
				nv = gemPhrase.substring(i,i+1).normalize('NFD').replace(/[\u0300-\u036f]/g, "")
				// console.log(gemPhrase.substring(i,i+1)+" ("+gemPhrase.substring(i,i+1).charCodeAt(0)+
				// 	") -> "+String.fromCharCode(n).normalize('NFD').replace(/[\u0300-\u036f]/g, "")+" ("+String.fromCharCode(n).normalize('NFD').replace(/[\u0300-\u036f]/g, "").charCodeAt(0)+
				// 	") -> "+String.fromCharCode(n).normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase()+" -> "+String.fromCharCode(n).normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase().charCodeAt(0) )
			} else {
				nv = gemPhrase.substring(i,i+1) // formatted charcode (lowercase) - for calculation
				// console.log(gemPhrase.substring(i,i+1)+" ("+gemPhrase.substring(i,i+1).charCodeAt(0)+
				// 	") -> "+String.fromCharCode(n).toLowerCase()+" -> "+String.fromCharCode(n).toLowerCase().charCodeAt(0) )
			}
			if (this.caseSensitive == false) nv = nv.toLowerCase()
			nv = nv.charCodeAt(0)

			if (n > 47 && n < 58 && this.cArr.indexOf(49) == -1) { // 0-9 digits, cipher doesn't contain "1"
				if (optNumCalcMethod == 1) { // Full
					this.curNum = String(this.curNum) + String(n - 48) // append digits
					if (lastSpace == false) {
						this.cp.push(" ")
						this.cv.push(" ")
						this.sumArr.push(wordSum)
						wordSum = 0
						lastSpace = true
					}
				} else if (optNumCalcMethod == 2) { // Reduced
					this.cp.push("num" + String(n - 48))
					this.cv.push(n - 48)
					this.curNum = String(n - 48)
					wordSum += n - 48
					lastSpace = false
				}
				
			} else {
				if (optNumCalcMethod == 1) { // Full
					if (this.curNum.length > 0 & n !== 44) { // character is not "44" comma (digit separator)
						this.cp.push("num" + String(this.curNum), " ")
						this.cv.push(Number(this.curNum), " ")
						this.sumArr.push(Number(this.curNum))
						this.curNum = ""
					}
				}
				
				cIndex = this.cArr.indexOf(nv) // index of current character in phrase inside all character arrays available for current cipher
				if (cIndex > -1) {
					lastSpace = false
					wordSum += this.vArr[cIndex]
					this.cp.push(n)
					this.LetterCount++
					this.cv.push(this.vArr[cIndex])
				} else if (n !== 39 && lastSpace == false) {
					this.sumArr.push(wordSum)
					wordSum = 0
					this.cp.push(" ")
					this.cv.push(" ")
					lastSpace = true
				}
			}
		}
		if (lastSpace == false) {this.sumArr.push(wordSum)} // add number value to phrase gematria
		if (this.curNum !== "") {
			if (optNumCalcMethod == 1) { // Full
				this.cp.push("num" + String(this.curNum))
				this.cv.push(Number(this.curNum))
				this.sumArr.push(Number(this.curNum)) // value of full number
				if (this.sumArr.length > 1) {
					this.cp.push(" ")
					this.cv.push(" ")
				}
			}
		}
		if (this.sumArr.length > 1 && lastSpace == false) {
			this.cp.push(" ")
			this.cv.push(" ")
		}

		this.WordCount = this.sumArr.length // word count

		if (optGemMultCharPos) { // multiply each charater value based on character index
			this.sumArr = [] // clear word sums
			wordSum = 0
			n = 0 // vaild character index (defined in cipher)
			for (i = 0; i < this.cp.length; i++) {
				if (typeof(this.cp[i]) == "number") { // character value, not "numXX"
					n++
					this.cv[i] *= n // multiply character value by position
					wordSum += this.cv[i]
				} else if (this.cp[i] == " ") { // space
					this.sumArr.push(wordSum)
					wordSum = 0 // reset
				} else if (typeof(this.cp[i]) == "string") { // numerical value "numXX"
					this.sumArr.push(this.cv[i]) // push number itself
					wordSum = 0 // reset
				}
			}
			if (wordSum !== 0) this.sumArr.push(wordSum) // last word value
		} else if (optGemMultCharPosReverse) { // multiply each charater value (reverse index)
			this.sumArr = [] // clear word sums
			wordSum = 0
			n = 0 // vaild character index (defined in cipher)
			var count = this.cp.length-1 // array index is one less
			if (this.cp[this.cp.length - 1] == " ") count = this.cp.length-2 // exclude last character if a space

			for (i = count; i >= 0; i--) {
				if (typeof(this.cp[i]) == "number") { // character value, not "numXX"
					n++
					this.cv[i] *= n // multiply character value by position
					wordSum += this.cv[i]
				} else if (this.cp[i] == " ") { // space
					this.sumArr.unshift(wordSum) // insert in the beginning of array
					wordSum = 0 // reset
				} else if (typeof(this.cp[i]) == "string") { // numerical value "numXX"
					this.sumArr.unshift(this.cv[i]) // number itself
					wordSum = 0 // reset
				}
			}
			if (wordSum !== 0) this.sumArr.unshift(wordSum) // last word value
		}
	}

}

// Value used wherever gematria is compared numerically: Find Matches, the
// database query, the encoder. Wheel ciphers return text, so they yield NaN,
// which never equals anything, including another NaN. That keeps their column
// present and aligned with enabledCiphCount while making it unmatchable,
// rather than skipping them and desynchronising every column index.
function gemForMatching(ciph, phrase) {
	if (ciph.wheelCipher) return NaN
	return ciph.calcGematria(phrase)
}

// ================ Safe cipher deserialisation ================
//
// SECURITY. Every import path used to build ciphers with
//
//     eval("new cipher(" + argumentText + ")")
//
// which executes the imported text as JavaScript. That is the only path in the
// application where data becomes code, and it is reachable three ways: a
// settings file the member opens, their own localStorage, and their own synced
// workspace row.
//
// None of those is remotely attacker-controlled - RLS pins the workspace row to
// auth.uid() - but the file import is socially deliverable. Someone posts "my
// cypher setup" in the chat, a member imports it, and arbitrary JavaScript runs
// in their origin with access to their Supabase session in localStorage. That
// is account takeover, delivered by a text file.
//
// It was worse than a plain import risk, because exportCiphersDB() wrote cipher
// NAMES into the file without escaping them. A cipher named with an embedded
// quote closed the string and continued as code, so the round trip through
// export and import was itself an injection channel.
//
// The cipher arguments were never code. They are a string, a string, three
// numbers, two arrays and three booleans - all of which JSON expresses exactly.
// So they are parsed as JSON and type-checked, and nothing is executed.

var CIPHER_ARG_COUNT = 10 // name, category, H, S, L, cArr, vArr, diacritics, enabled, caseSensitive

// Parses one serialised argument list into a real cipher, or returns null.
//
// Returning null rather than throwing is deliberate: a single unreadable cipher
// must not take the whole workspace with it. The caller skips it and carries on,
// which is the behaviour a member wants when one entry in a long list is stale.
function cipherFromArgString(argText) {
	if (typeof argText !== "string") return null

	var args
	try {
		// The exporter emits exactly JSON for every field, so wrapping the
		// argument list in brackets makes the whole thing a JSON array. Anything
		// that is not valid JSON - a function, a getter, an expression - fails
		// here rather than running.
		args = JSON.parse("[" + argText + "]")
	} catch (e) {
		console.warn("Cipher skipped: its definition did not parse.")
		return null
	}

	if (!Array.isArray(args) || args.length < 7) return null
	while (args.length < CIPHER_ARG_COUNT) args.push(undefined) // trailing optionals

	// Shape check. JSON cannot express code, but it can express the wrong types,
	// and the wrong types reach the drawing and matching code as NaN or
	// undefined rather than as an error anybody sees.
	if (typeof args[0] !== "string" || typeof args[1] !== "string") return null
	if (!isFinite(args[2]) || !isFinite(args[3]) || !isFinite(args[4])) return null
	if (!Array.isArray(args[5]) || !Array.isArray(args[6])) return null

	// cArr is codepoints. vArr is numbers, or strings for a wheel cipher.
	for (var i = 0; i < args[5].length; i++) {
		if (typeof args[5][i] !== "number" || !isFinite(args[5][i])) return null
	}
	for (var j = 0; j < args[6].length; j++) {
		var v = args[6][j]
		if (typeof v === "number") { if (!isFinite(v)) return null }
		else if (typeof v !== "string") return null
	}

	// A cipher with no characters divides by zero in the chart renderer
	if (args[5].length === 0 || args[6].length === 0) return null

	return new cipher(
		String(args[0]).slice(0, 120),   // the name is drawn into the DOM; bound it
		String(args[1]).slice(0, 120),
		Number(args[2]), Number(args[3]), Number(args[4]),
		args[5], args[6],
		args[7] === undefined ? true  : !!args[7],   // diacriticsAsRegular
		args[8] === undefined ? false : !!args[8],   // enabled
		args[9] === undefined ? false : !!args[9]    // caseSensitive
	)
}

// Turns the body of a "cipherList = [ ... ]" block into cipher objects.
// Replaces the loop that used to eval() each entry.
function ciphersFromListBody(listBody) {
	var out = []
	if (typeof listBody !== "string") return out

	var parts = listBody.split(",new cipher")
	var skipped = 0
	for (var n = 0; n < parts.length; n++) {
		// each part arrives as "( ...args... )" - drop the brackets
		var built = cipherFromArgString(parts[n].slice(1, -1))
		if (built === null) { skipped++; continue }
		out.push(built)
	}
	if (skipped > 0) {
		console.warn("Import: " + skipped + " cipher definition(s) skipped as unreadable.")
	}
	return out
}

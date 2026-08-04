// ========================== Highlighter ===========================

function removeZeroHlt(arr) {
	for (p = 0; p < arr.length; p++) {
		if (arr[p] == 0) arr.splice(p,1) // remove zero
	}
	return arr
}

function removeNotMatchingPhrases() {
	// highlight box values to array
	highlt = document.getElementById("highlightBox").value.replace(/ +/g," ") // get value, remove double spaces
	highlt_num = highlt.split(" ") // create array from string, space as delimiter
	highlt_num = highlt_num.map(function (x) { return parseInt(x, 10); }) // parse string array as integer array to exclude quotes
	highlt_num = removeZeroHlt(highlt_num)
	
	// create a copy of history, since matching is destructive
	if (userHistory.length == 0) userHistory = [...sHistory] // don't make new copies until filter is reset
	
	var phr_values = []
	var match = false
	var x = 0

	// remove not matching phrases first
	while (x < sHistory.length) { // for each phrase in history
	
		phr_values = [] // reinit
		match = false
		
		for (i = 0; i < cipherList.length; i++) { // for each enabled cipher
			if (cipherList[i].enabled) {
				gemVal = gemForMatching(cipherList[i], sHistory[x]) // value only
				phr_values.push(gemVal) // build an array of all gematria values of current phrase
			}
		}
		//console.log(phr_values)
		for (z = 0; z < highlt_num.length; z++) { // for each value to be highlighted
			if (phr_values.indexOf(highlt_num[z]) > -1 && !match) { // if value is present in any gematria cipher
				match = true // if match is found
			}
		}
		//console.log(match)
		if (!match) { // if no match is found, don't do x++ as array indices shift
			//console.log("removed: '"+sHistory[x]+"'")
			sHistory.splice(x,1) // remove phrase
		} else {
			x++ // check next item if match is found
		}
	}
	
	if (optFiltCrossCipherMatch) {
		// make a copy of user's choice of ciphers
		if (userOpenCiphers.length == 0) { // don't make new copies until filter is reset
			//userOpenCiphers = [...openCiphers]
			// tmp
			for (i = 0; i < cipherList.length; i++) {
				//tmp = Object.assign({}, cipherList[i]);
				userOpenCiphers.push(cipherList[i].enabled); // save state for each cipher
			}
		}
		
		for (i = 0; i < cipherList.length; i++) { // for each enabled cipher
			if (cipherList[i].enabled) {
				var ciph_values = [] // init
				match = false
				
				for (x = 0; x < sHistory.length; x++) { // for each phrase
					ciph_values.push(gemForMatching(cipherList[i], sHistory[x]))
				}
				
				for (z = 0; z < highlt_num.length; z++) { // for each value to be highlighted
					if (ciph_values.indexOf(highlt_num[z]) > -1 && !match) { // if any value is found for that cipher
						match = true // match is found
					}
				}
			
				if (!match) { // if no match is found
					//console.log("    disabled: '"+ciphersOn[i].Nickname+"'")
					valueToRemove = cipherList[i].cipherName
					//openCiphers = openCiphers.filter(function(item) { // list of active ciphers
					//	return item !== valueToRemove // remove current cipher
					//})
					for (n = 0; n < cipherList.length; n++) {
						if (cipherList[n].enabled) {
							//console.log(cipherList[n].cipherName+" == "+valueToRemove)
							if (cipherList[n].cipherName == valueToRemove) {
								cipherList[n].enabled = false // disable cipher
								cur_chkbox = document.getElementById("cipher_chkbox"+n)
								if (cur_chkbox !== null) { cur_chkbox.checked = !cur_chkbox.checked; } // update checkbox if visible
							}
						}
					}
				}
			}
		}		

		updateEnabledCipherTable() // update ciphers
	}
	
	if (optFiltSameCipherMatch) {
		
		// mark all phrases to false
		// search each column for unique
		// for each unique, if more than 1 match mark phrases as true, if none are found remove cipher
		// build new history with phrases marked as true
		
		// check each entered value for each cipher column (all phrases)
		// if number matches in that column twice or more mark XY coordinates for highlighter
		// if number is found only once ignore it in that column, repeat for all columns
		// openHistory table and adjust alpha channel color for each cell based on XY
		// it will be a 2D array of true/false, true are bright, false are darkened
		
		// make a copy of user's choice of ciphers
		if (userOpenCiphers.length == 0) { // don't make new copies until filter is reset
			for (i = 0; i < cipherList.length; i++) {
				userOpenCiphers.push(cipherList[i].enabled); // save state for each cipher
			}
		}
		
		var phrase_match = Array(sHistory.length).fill(false); // mark phrases that match in same cipher, same value
		//console.log("phrase_match:"+JSON.stringify(phrase_match))
		
		for (var i = 0; i < cipherList.length; i++) { // for each enabled cipher, var i - so it can be referenced later
			if (cipherList[i].enabled) {
			
				var ciph_values = [] // values for each phrase in one cipher
				var ciph_matches = [] // frequency of matches in one cipher
				
				for (x = 0; x < sHistory.length; x++) { // for each phrase
					ciph_values.push(gemForMatching(cipherList[i], sHistory[x])) // add value for that phrase
				}
				
				ciph_matches = countMatches(ciph_values) // number of occurrences of values
				//console.log("ciph_values:"+JSON.stringify(ciph_values))
				//console.log("ciph_matches:"+JSON.stringify(ciph_matches))
				
				var cipher_has_no_matches = true
				for (n = 0; n < ciph_matches.length; n++) { // for each value in cipher column
					if (ciph_matches[n][1] > 1) { // if 2 or more matches are available
						for (x = 0; x < sHistory.length; x++) { // for each phrase
							if (gemForMatching(cipherList[i], sHistory[x]) == ciph_matches[n][0] &&
							highlt_num.indexOf(gemForMatching(cipherList[i], sHistory[x])) > -1) { // if gematria for phrase matches given number and number is in highlight box
								phrase_match[x] = true // mark phrase as matching
								cipher_has_no_matches = false // cipher doesn't need to be disabled
								//console.log(sHistory[x]+" ("+ciphersOn[i].Nickname+") = "+ciphersOn[i].Gematria(sHistory[x], 2, false, true)+" - marked as 'true'")
							}
						}
					}
				}
				
				if (cipher_has_no_matches) { // remove current cipher if no phrases match with same value
					valueToRemove = cipherList[i].cipherName
					for (n = 0; n < cipherList.length; n++) {
						if (cipherList[n].cipherName == valueToRemove) {
							cipherList[n].enabled = false // disable cipher
							cur_chkbox = document.getElementById("cipher_chkbox"+n)
							if (cur_chkbox !== null) cur_chkbox.checked = !cur_chkbox.checked // update checkbox if visible
						}
					}
					//console.log("'"+cipherList[i].cipherName+"' was disabled")
				}
				
			}
		}
		
		var matchingPhrases = []
		for (m = 0; m < phrase_match.length; m++) { // for each phrase checked
			if (phrase_match[m] == true) { // add if matching
				matchingPhrases.push(sHistory[m])
			}
		}
		
		sHistory = matchingPhrases // switch sHistory to set of phrases that match
		// console.log("sHistory:")
		// console.log(sHistory)

		// columns of cipher values
		v_grid_col = [] // 2D array, columns of gematria values for enabled ciphers for all matching phrases
		tmp_arr = [] // all gematria values for one phrase
		for (n = 0; n < cipherList.length; n++) { // for each enabled cipher
			if (cipherList[n].enabled) {
				tmp_arr = [] // reset
				for (z = 0; z < sHistory.length; z++) { // for each phrase
					tmp_arr.push(gemForMatching(cipherList[n], sHistory[z])) // add each gematria value for that phrase
				}
				v_grid_col.push(tmp_arr) // add row with all values for current phrase
			}
		}
		// console.log("v_grid_col:")
		// console.log(v_grid_col)

		updateEnabledCipherCount() // get number of enabled ciphers

		hltBoolArr = [] // highlight boolean array [phrase][cipher]
		tmpArr = []
		for (n = 0; n < sHistory.length; n++) { // for each phrase
			tmpArr = new Array(enabledCiphCount).fill(false) // for each cipher
			hltBoolArr.push(tmpArr) // add to array
		}

		// n - cipher, m/z - phrase
		for (n = 0; n < v_grid_col.length; n++) { // for each column (cipher)
			for (m = 0; m < v_grid_col[n].length; m++) { // for each value in column (phrase)
				if (highlt_num.indexOf(v_grid_col[n][m]) > -1) { // if value is in highlight box
					for (z = m+1; z < v_grid_col[n].length; z++) { // compare vs other values in same column
						if (v_grid_col[n][m] == v_grid_col[n][z]) { // if value matches another value
							hltBoolArr[m][n] = true // mark both as values to be highlighted
							hltBoolArr[z][n] = true // [phrase][cipher]
						}
					}
				}
			}
		}
		// console.log("hltBoolArr:")
		// console.log(hltBoolArr)

		updateEnabledCipherTable() // update ciphers
	}
	
	var o = '<input id="btn-clear-active-filter" type="button" value="X" onclick="removeActiveFilter();displayCipherCatDetailed(cCat[0]);"/>'
	$("#clearFilterButton").html(o) // clear active filter button
	
	autoHistoryTableLayout()
	if (optFiltSameCipherMatch) {
		updateHistoryTable(hltBoolArr) // rebuild table, pass boolean array for highlighting
	} else if (optFiltCrossCipherMatch) {
		updateHistoryTable()
	}
}

function updateHistoryTableSameCiphMatch() {

	highlt = document.getElementById("highlightBox").value.replace(/ +/g," ") // get value of Highlight textbox, remove double spaces

	highlt_num = highlt.split(" "); // create array, space delimited numbers
	highlt_num = highlt_num.map(function (e) { return parseInt(e, 10); }) // parse string array as integer array to exclude quotes
	highlt_num = removeZeroHlt(highlt_num)
	// console.log("highlt_num:")
	// console.log(highlt_num)

	// columns of cipher values
	v_grid_col = [] // 2D array, columns of gematria values for enabled ciphers for all matching phrases
	tmp_arr = [] // all gematria values for one phrase
	for (n = 0; n < cipherList.length; n++) { // for each enabled cipher
		if (cipherList[n].enabled) {
			tmp_arr = [] // reset
			for (z = 0; z < sHistory.length; z++) { // for each phrase
				tmp_arr.push(gemForMatching(cipherList[n], sHistory[z])) // add each gematria value for that phrase
			}
			v_grid_col.push(tmp_arr) // add row with all values for current phrase
		}
	}
	// console.log("v_grid_col:")
	// console.log(v_grid_col)

	hltBoolArr = [] // highlight boolean array [phrase][cipher]
	tmpArr = []
	for (n = 0; n < sHistory.length; n++) { // for each phrase
		tmpArr = new Array(enabledCiphCount).fill(false) // for each cipher
		hltBoolArr.push(tmpArr) // add to array
	}

	// n - cipher, m/z - phrase
	for (n = 0; n < v_grid_col.length; n++) { // for each column (cipher)
		for (m = 0; m < v_grid_col[n].length; m++) { // for each value in column (phrase)
			if (highlt_num.indexOf(v_grid_col[n][m]) > -1) { // if value is in highlight box
				for (z = m+1; z < v_grid_col[n].length; z++) { // compare vs other values in same column
					// if value matches another value in the same column and is present in highlight box
					if (v_grid_col[n][m] == v_grid_col[n][z]) { 
						hltBoolArr[m][n] = true // mark both as values to be highlighted
						hltBoolArr[z][n] = true // [phrase][cipher]
					}
				}
			}
		}
	}
	// console.log("hltBoolArr:")
	// console.log(hltBoolArr)

	updateHistoryTable(hltBoolArr) // rebuild table, same cipher match
}

function removeActiveFilter() {
	$("#clearFilterButton").html("") // remove clear button
	$("#highlightBox").val("") // clear highlightBox box

	for (i = 0; i < userOpenCiphers.length; i++) {
		cipherList[i].enabled = userOpenCiphers[i];
	}
	
	sHistory = [...userHistory] // restore user history table
	userHistory = [] // clear snapshot of user history
	userOpenCiphers = [] // clear snapshot of user ciphers
	
	updateEnabledCipherTable() // update ciphers
	autoHistoryTableLayout()
	updateHistoryTable() // update history
}

// number of items in array
function countMatches(arr) {
	var values = []
	var counts = []
	var index = 0
	
	for (i = 0; i < arr.length; i++) {
		index = values.indexOf(arr[i])
		if (index == -1) { // new value
			values.push(arr[i]) // add entry
			counts.push(1) // first occurrence
		} else { // if same value found again
			counts[index] += 1 // increment number of matches
		}
	}
	
	var result = [] // frequency of matches
	var tmp = []

	for (i = 0; i < values.length; i++) { // join values and counts
		tmp = new Array(values[i], counts[i])
		result.push(tmp)
	}
	
	return result // 2D array [number, frequency]
}

function updateHistoryTableAutoHlt() {
	var x, y, aCipher, gemVal

	var rows_arr = [] // array of arrays, each array (row) has gematria values for a single phrase
	var phrase_values = [] // array of gematria values for a single phrase
	avail_match = [] // reinit (var declared in highlighter.js)
	avail_match_freq = [] // var declared in highlighter.js
	
	if (sHistory.length == 0) {return}
	
	if (optFiltSameCipherMatch) { // phrases that have the same value in the same cipher
	
		var cols_arr = [] // array of arrays, each array (COLUMN) has gematria values for a each phrase in one cipher
		var cipher_values = [] // values for each phrase in one cipher
		
		for (y = 0; y < cipherList.length; y++) {
			if (cipherList[y].enabled) { // for each enabled cipher
				for (x = 0; x < sHistory.length; x++) { // calculate gematria for all phrases
					gemVal = gemForMatching(cipherList[y], sHistory[x]) // value only
					cipher_values.push(gemVal) // append all values of this phrase
				}
			cols_arr.push(cipher_values) // append all values of each phrase
			cipher_values = [] // reinit	
			}
		}
		// console.log("cols_arr:")
		// console.log(cols_arr)
		
		var col_matches = [] // frequency of values within one cipher for all phrases
		for (q = 0; q < cols_arr.length; q++) { // for each enabled cipher (column), using "i" created some impossible infinte loop bug
			col_matches = []
			col_matches = countMatches(cols_arr[q]) // find matches within the same cipher
			// console.log(col_matches)
			for (n = 0; n < col_matches.length; n++) { // for each value in match array
				if (col_matches[n][1] > 1) { // if 2 or more matches are available
					if (avail_match.indexOf(col_matches[n][0]) == -1) avail_match.push(col_matches[n][0]) // add new value to list of valid matches
				}
			}
		}
		// console.log("avail_match:")
		// console.log(avail_match)
		
		avail_match.sort(function(a, b) { // sort ascending order
			return a - b; //  b - a, for descending sort
		});
		if (avail_match[0] == 0) avail_match.splice(0,1) // remove zero
		
		console.log(JSON.stringify(avail_match).replace(/,/g, " ").slice(1, -1)) // print available matches
		//console.log(JSON.stringify(freq).replace(/\],\[/g, "\n").slice(2, -2)) // print frequency of available matches
		
		// paste available values inside Highlight textbox
		str = JSON.stringify(avail_match).replace(/,/g, " ") // replace comma with space
		substr = str.substring(1, str.length - 1) // remove brackets
	    
		document.getElementById("highlightBox").value = substr // populate highlight box

		applyHistMatchOrder() // stack matches at the top, hide phrases with none
		updateHistoryTableSameCiphMatch() // update table
		
		//freq = [] // frequency of matches found with auto highlighter
		// freq needs different logic for same cipher match
		return

	}
	
	for (x = 0; x < sHistory.length; x++) { // calculate gematria for all phrases
		for (y = 0; y < cipherList.length; y++) {
			if (cipherList[y].enabled) {
				aCipher = cipherList[y]
				gemVal = gemForMatching(aCipher, sHistory[x]) // value only
				phrase_values.push(gemVal) // append all values of this phrase
			}
		}
		rows_arr.push(phrase_values) // append all values of each phrase
		phrase_values = [] // reinit	
	}
		
	//auto highlighter, all available values
	var this_row = [] // match this row
	var against_row = [] // against another row
	var val = 0 // value that is checked (try "")
	
	var p = 0 // position (column) in against_row
	var index = 0 // index of val in array of previously found matches
	
	var n_rows = rows_arr.length // number of phrases
	var n_cols = rows_arr[0].length // number of values (ciphers) for each phrase (same value)
	
	var steps = 0 // number of steps taken
	
	for (i = 0; i < n_rows; i++) { // loop array
		this_row = rows_arr[i] // select row with phrase values
		for (n = 0; n < n_cols; n++) {
			val = this_row[n] // take the first value of the first phrase
			if (val > 0 && avail_match.indexOf(val) == -1) { // ignore zero, take value that hasn't been checked
				//console.log("# row:"+(i+1)+" column:"+(n+1)+" value:"+val)
				for (m = i+1; m < n_rows; m++) { // loop array again to find matches, start check from the next row
					against_row = rows_arr[m] // select another row
					p = 0 // reset position in row
					while (p < n_cols) { // loop values in that row
						steps++
						if (val == against_row[p]) { // if matching value is found in other rows (phrases)
							index = avail_match.indexOf(val) // save index
							//console.log("    matches with:"+against_row[p]+" at "+(m+1)+":"+(p+1)) // at row/column
							if (index == -1) { // if value is not in array of available matches yet
								avail_match.push(val) // push to array, so number is not selected again during the first (selection) loop of the array
								avail_match_freq.push(2) // first match means 2 values were found
								//console.log("        new value found, making a new array to count "+against_row[p])
								//console.log("            "+against_row[p]+" has position "+avail_match.indexOf(val)+" in "+JSON.stringify(avail_match))
							} else { // if value already exists in array of matches
								avail_match_freq[index] += 1 // increment number of occurrencies found at correspondent index
								//console.log("        found match at "+(m+1)+":"+(p+1)+" incrementing "+against_row[p]+" to "+avail_match_freq[index])
							}
							if (m+1 < n_rows) { // switch to next row (if possible) after match is found
								m++
								against_row = rows_arr[m] // against_row = rows_arr[m+1] - gets stuck in an infinite increment loop
								p = 0 // switch to first value in next row
							} else {
								break // break infinite loop on the last row check
							}
						} else {
							p++ // if no match is found, check next value of the same row
						}
					}
				}
			}
		}
	}
	console.log("rows:"+n_rows+" columns:"+n_cols+" values:"+(n_rows*n_cols)+" steps_taken:"+steps)
	
	freq = [] // frequency of matches found with auto highlighter (var declared in ijavaNGG.js)
	var tmp = []
	for (i = 0; i < avail_match.length; i++) { // join values and frequency
		tmp = new Array(avail_match[i],avail_match_freq[i])
		freq.push(tmp)
	}
	
	freq.sort(function(a, b) {
		return a[1] - b[1]; // sort based on index 1 values ("freq" is array of arrays), (b-a) descending order, (a-b) ascending
	});
	
	avail_match.sort(function(a, b) { // sort ascending order
		return a - b; //  b - a, for descending sort
	});
	
	console.log(JSON.stringify(avail_match).replace(/,/g, " ").slice(1, -1)) // print available matches
	console.log(JSON.stringify(freq).replace(/\],\[/g, "\n").slice(2, -2)) // print frequency of available matches
	
	// paste available values inside Highlight textbox
	str = JSON.stringify(avail_match).replace(/,/g, " ") // replace comma with space
	substr = str.substring(1, str.length - 1) // remove brackets
	document.getElementById("highlightBox").value = substr

	applyHistMatchOrder() // stack matches at the top, hide phrases with none
	updateHistoryTable() // update table
}

// ==================================================================
// Match-weighted ordering of the History Table
//
// Called after "Find Matches" has filled avail_match. Groups phrases by the
// matched value they share, then floats the biggest groups to the top so the
// most-matched phrases sit stacked together instead of scattered down the list.
// Returns an array of sHistory indices, or null when there is nothing to sort.

function buildHistMatchOrder() {

	if (typeof sHistory === "undefined" || sHistory.length == 0) return null
	if (typeof avail_match === "undefined" || avail_match.length == 0) return null

	var i, y, v

	// gematria values per phrase, enabled ciphers only
	var rows = []
	for (i = 0; i < sHistory.length; i++) {
		var vals = []
		for (y = 0; y < cipherList.length; y++) {
			if (cipherList[y].enabled) vals.push(gemForMatching(cipherList[y], sHistory[i]))
		}
		rows.push(vals)
	}
	if (rows[0].length == 0) return null // no enabled ciphers, nothing to weigh

	var matchSet = {} // fast lookup for "is this a matched value"
	for (i = 0; i < avail_match.length; i++) matchSet[avail_match[i]] = true

	// how many phrases carry each matched value (distinct phrases, not cells)
	var valPhrases = {}
	var phraseVals = [] // distinct matched values per phrase
	for (i = 0; i < rows.length; i++) {
		var seen = {}
		var mine = []
		for (y = 0; y < rows[i].length; y++) {
			v = rows[i][y]
			if (v > 0 && matchSet[v] === true && seen[v] !== true) {
				seen[v] = true
				mine.push(v)
				valPhrases[v] = (valPhrases[v] || 0) + 1
			}
		}
		phraseVals.push(mine)
	}

	// score each phrase, and pick the value that best represents it
	var scored = []
	var unmatched = []
	for (i = 0; i < phraseVals.length; i++) {
		if (phraseVals[i].length == 0) { unmatched.push(i); continue }

		var score = 0
		var primary = phraseVals[i][0]
		var primaryCount = 0
		for (y = 0; y < phraseVals[i].length; y++) {
			v = phraseVals[i][y]
			var c = valPhrases[v]
			if (c < 2) continue // a value only this phrase holds is not a match
			score += c
			if (c > primaryCount || (c == primaryCount && v < primary)) { primary = v; primaryCount = c }
		}

		if (primaryCount < 2) { unmatched.push(i); continue }
		scored.push({ idx: i, score: score, hits: phraseVals[i].length, primary: primary, primaryCount: primaryCount })
	}

	if (scored.length == 0) return null

	// bucket by shared value so those rows end up adjacent
	var groups = {}
	for (i = 0; i < scored.length; i++) {
		if (groups[scored[i].primary] === undefined) groups[scored[i].primary] = []
		groups[scored[i].primary].push(scored[i])
	}

	var groupList = []
	for (var key in groups) {
		if (!groups.hasOwnProperty(key)) continue
		var members = groups[key]
		members.sort(function(a, b) {
			if (b.score !== a.score) return b.score - a.score
			if (b.hits !== a.hits) return b.hits - a.hits
			return a.idx - b.idx // stable: keep original order for genuine ties
		})
		var top = 0
		for (i = 0; i < members.length; i++) if (members[i].score > top) top = members[i].score
		groupList.push({ value: Number(key), members: members, size: members.length, top: top })
	}

	groupList.sort(function(a, b) {
		if (b.size !== a.size) return b.size - a.size // biggest stack first
		if (b.top !== a.top) return b.top - a.top     // then strongest phrase
		return a.value - b.value
	})

	var order = []
	for (i = 0; i < groupList.length; i++) {
		for (y = 0; y < groupList[i].members.length; y++) order.push(groupList[i].members[y].idx)
	}

	// A cipher that contributed no matched value among the surviving phrases is
	// dead weight in the result: its column is all misses. Work out which of
	// the enabled ciphers actually carried a match, so the table can drop the
	// rest of the columns the same way it drops unmatched rows.
	var ciphKeep = []
	var ciphNames = []
	for (y = 0; y < cipherList.length; y++) {
		if (cipherList[y].enabled) { ciphKeep.push(false); ciphNames.push(cipherList[y].cipherName) }
	}
	for (i = 0; i < order.length; i++) {
		var r = rows[order[i]]
		for (y = 0; y < r.length; y++) {
			v = r[y]
			if (v > 0 && matchSet[v] === true && valPhrases[v] >= 2) ciphKeep[y] = true
		}
	}

	var hiddenCiph = []
	for (y = 0; y < ciphKeep.length; y++) if (!ciphKeep[y]) hiddenCiph.push(ciphNames[y])
	// never blank the table entirely: if nothing qualified, keep every column
	if (hiddenCiph.length === ciphKeep.length) hiddenCiph = []

	// Phrases with no matches at all are left out of the display order entirely,
	// so the table shows only what matched. They are still in sHistory and come
	// back on Reset Order; nothing is deleted.
	return {
		order: order,
		snapshot: sHistory.slice(),
		hidden: unmatched.length,
		hiddenCiphers: hiddenCiph
	}
}

// Cipher names the current match result has nothing to show for. Empty unless
// Find Matches is active, so the table is unaffected the rest of the time.
function histHiddenCipherSet() {
	if (histDisplayOrder === null) return null
	if (typeof getHistDisplayOrder === "function" && getHistDisplayOrder() === null) return null
	var list = histDisplayOrder.hiddenCiphers
	if (!list || !list.length) return null
	var set = {}
	for (var i = 0; i < list.length; i++) set[list[i]] = true
	return set
}

// Flashes the Find Matches tab itself, so a click registers even when the
// table is offscreen or the search turns up nothing.
function findMatchesFlash(btn) {
	if (!btn) return
	btn.classList.remove("findMatchesFlash")
	void btn.offsetWidth // restart the animation rather than letting it no-op
	btn.classList.add("findMatchesFlash")
	setTimeout(function () { btn.classList.remove("findMatchesFlash") }, 700)
}

// A green sweep across the History Table when matches land, so the reorder
// reads as something that just happened rather than the table silently
// rearranging itself. Purely decorative and self-removing.
function findMatchesFx(found) {
	var host = document.getElementById("HistoryTableArea")
	if (host === null) return
	if (found === undefined) found = true

	$("#findMatchesFx").remove()
	var fx = document.createElement("div")
	fx.id = "findMatchesFx"
	fx.className = "findMatchesFx" + (found ? "" : " findMatchesFxNone")
	host.style.position = "relative"
	host.appendChild(fx)

	// matched rows pulse once as the sweep passes over them; with nothing to
	// show for it the sweep passes alone
	$(".HistoryTable tr").removeClass("fxMatchPulse fxMatchPulseNone")
	if (found) {
		setTimeout(function () { $(".HistoryTable tr").addClass("fxMatchPulse") }, 90)
	} else {
		setTimeout(function () { $(".HistoryTable tr").addClass("fxMatchPulseNone") }, 90)
	}

	setTimeout(function () {
		$("#findMatchesFx").remove()
		$(".HistoryTable tr").removeClass("fxMatchPulse fxMatchPulseNone")
	}, 1100)
}

// Applies the match ordering and tells the user how many phrases dropped out,
// so a suddenly shorter table is never mistaken for lost data.
function applyHistMatchOrder() {
	histDisplayOrder = buildHistMatchOrder()
	// green when something matched, red when nothing did - the sweep is the
	// answer to the question, so it should not look the same either way
	var found = (histDisplayOrder !== null && histDisplayOrder.order.length > 0)
	setTimeout(function () { findMatchesFx(found) }, 0) // after the table has been rebuilt
	if (!found) displayCalcNotification("No matches found", 2000)
	if (histDisplayOrder !== null && histDisplayOrder.hidden > 0) {
		var n = histDisplayOrder.hidden
		displayCalcNotification(n + (n === 1 ? " phrase hidden" : " phrases hidden") + " with no matches", 2200)
	}
}

// Returns the match order only while it still describes the current history.
// sHistory is mutated from a dozen places (adding, deleting, reordering,
// importing), so instead of hooking each one the order carries a snapshot of
// the phrases it was built from and retires itself as soon as they differ.
function getHistDisplayOrder() {
	if (histDisplayOrder === null) return null
	var snap = histDisplayOrder.snapshot
	if (snap.length !== sHistory.length) { histDisplayOrder = null; return null }
	for (var i = 0; i < snap.length; i++) {
		if (snap[i] !== sHistory[i]) { histDisplayOrder = null; return null }
	}
	return histDisplayOrder.order
}

// restore the History Table to the order phrases were entered in
function clearHistMatchSort() {
	histDisplayOrder = null
	if (typeof sHistory !== "undefined" && sHistory.length > 0) updateHistoryTable()
}

// add number to Highlight box (history table is rebuilt)
function tdToggleHighlight(val){ // click on value in history table to toggle highlighter
    //console.log('Clicked on: '+val)
	highlt = document.getElementById("highlightBox").value.replace(/ +/g," ") // get value, remove double spaces
	lastchar = highlt.substring(highlt.length-1,highlt.length)
	
	highlt_num = highlt.split(" ") // create array, space delimited numbers
	highlt_num = highlt_num.map(function (x) { return parseInt(x, 10); }) // parse string array as integer array to exclude quotes
	highlt_num = removeZeroHlt(highlt_num)
	
	var ind = highlt_num.indexOf(val) // val needs to be an integer
	//console.log("val:"+val+" ind:"+ind+" highlt_num:"+JSON.stringify(highlt_num))
	
	// disable
	var hlt_val
	if (ind > -1) { // if value is present
		highlt_num.splice(ind,1) // remove value
		hlt_val = JSON.stringify(highlt_num).replace(/,/g, " ") // to string
		hlt_val = hlt_val.substring(1, hlt_val.length-1) // remove brackets
		document.getElementById("highlightBox").value = hlt_val // update values inside textbox
		if (optFiltCrossCipherMatch) { updateHistoryTable(); } else { updateHistoryTableSameCiphMatch(); }
		return
	}
	
	// enable
	if (lastchar !== " " && highlt.length > 0) {
		document.getElementById("highlightBox").value += " " // append space if necessary
	}
	document.getElementById("highlightBox").value += val // append clicked value to Highlight textbox
	if (optFiltCrossCipherMatch) { updateHistoryTable(); } else { updateHistoryTableSameCiphMatch(); }
};
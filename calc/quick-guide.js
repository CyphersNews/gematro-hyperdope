// ======================== Quickstart Guide ========================
//
// One topic at a time rather than one long scroll: the guide had grown to
// cover the whole calculator, and finding anything meant hunting through
// several screens of text. Topics are data, so adding a section is a new
// entry in quickGuideTopics rather than another string concatenated into the
// middle of a function.
//
// Special Thanks is deliberately not a topic. It sits under the topic buttons
// and stays on screen whichever topic is open, so the credits are always
// visible instead of being buried behind a tab nobody opens.

function closePanel(el) {
	$('#darkOverlay').remove();
	$(el).remove();
	$('body').removeClass('noScroll') // restore scrolling
}

var quickGuideTopic = "basics" // currently open topic

var quickGuideTopics = [

{ id: "basics", label: "🎯 Basics", html:
	'<p class="qgMedium">Phrase Box - word, phrase or numbers</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">Enter</span> - add phrase to history table.<br><span class="qgBold">Query</span> - search the loaded database.</li>'
	+ '<li><span class="qgBold">Up</span> &amp; <span class="qgBold">Down</span> arrow keys - scroll history table.<br>Press <span class="qgBold">Down</span> to select the previous phrase.</li>'
	+ '<li><span class="qgBold">Delete</span> - delete the current phrase in the history table.</li>'
	+ '<li><span class="qgBold">Home</span> - clear the history table.<br><span class="qgBold">End</span> - shortcut for <span class="qgBold">Enter As Words</span>.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">History Table</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">"Left Click"</span> on value - toggle blinking effect (temporary)</li>'
	+ '<li><span class="qgBold">"Right Click"</span> on value - toggle cell visibility (temporary)</li>'
	+ '<li><span class="qgBold">"Shift + Left Click"</span> on cipher name - disable cipher</li>'
	+ '<li><span class="qgBold">"Shift + Left Click"</span> on phrase - delete phrase from history</li>'
	+ '<li><span class="qgBold">"Ctrl + Left Click"</span> on phrase - load phrase into the <span class="qgBold">Phrase Box</span></li>'
	+ '<li><span class="qgBold">"Ctrl + Right Click"</span> on phrase - reorder phrases, pick the same phrase again to cancel</li>'
	+ '<li><span class="qgBold">"Ctrl + Left Click"</span> on a value cell - toggle highlighting for that number'
	+ '<br><span class="qgNote">Note: click the cell, not the number itself, or you will open number properties instead</span></li>'
	+ '</ul>'

	+ '<p class="qgMedium">Right Click Anywhere</p>'
	+ '<ul>'
	+ '<li>Right clicking the page opens a shortcut menu for the export actions, plus'
	+ ' <span class="qgBold">"Edit Table Caption"</span> to name the history table (the name is used in exports)'
	+ ' and <span class="qgBold">"Clear History Table"</span>.</li>'
	+ '</ul>'
},

{ id: "ciphers", label: "🔤 Cyphers", html:
	'<p class="qgMedium">Choosing Cyphers</p>'
	+ '<ul>'
	+ '<li>The <span class="qgBold">Cyphers</span> tab groups every cypher by category. Hover a category to list it, then tick the ones you want.</li>'
	+ '<li><span class="qgBold">Empty</span>, <span class="qgBold">Default</span>, <span class="qgBold">All (EN)</span> and <span class="qgBold">All</span> set the selection in one click.</li>'
	+ '<li><span class="qgBold">"Left Click"</span> a cypher name in the Enabled Cyphers table to make it current and show its breakdown.'
	+ '<br><span class="qgBold">"Right Click"</span> to disable it. <span class="qgBold">"Ctrl + Right Click"</span> to reorder.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">English - Modern, Archaic, Base 4</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">English</span> - modern 26 letter 1650s+ alphabet.</li>'
	+ '<li><span class="qgBold">Archaic</span> - 24 letter English used 1300 - 1650 AD, also called the <span class="qgBold">Elizabethan</span> or <span class="qgBold">Baconian</span> cyphers.</li>'
	+ '<li><span class="qgBold">Standard</span> - previously known as Extended, based on the <span class="qgBold">Hebrew Gematria</span> chart.</li>'
	+ '<li><span class="qgBold">Base 4</span> - the four most common modern cyphers.</li>'
	+ '<li><span class="qgBold">Ordinal</span> - originating as Phoenician gematria. Each value counts up by 1.</li>'
	+ '<li><span class="qgBold">Reduction</span> - Pythagorean numerology; digits are summed repeatedly down to one digit.</li>'
	+ '<li><span class="qgBold">Reverse</span> - Z to A instead of A to Z.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Languages</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">Phoenician</span> - the first phonetic alphabet and number substitution system.</li>'
	+ '<li><span class="qgBold">Hebrew</span> - from Phoenician, 500+ BC.</li>'
	+ '<li><span class="qgBold">Greek</span> - isopsephy from gematria, 500+ BC.</li>'
	+ '<li><span class="qgBold">Latin</span> - 23 letters, excluding J, U and W.</li>'
	+ '<li><span class="qgBold">Arabic</span> - the Abjad numeral system, 600+ AD.</li>'
	+ '<li><span class="qgBold">Russian</span> - the Cyrillic alphabet, 800+ AD.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Cryptography (wheel cyphers)</p>'
	+ '<ul>'
	+ '<li>These do not add up to a number. Each letter is <span class="qgBold">swapped for a symbol</span>, so the result is a string'
	+ ' such as <span class="qgBold">HAANA NHUUS</span> rather than a total.</li>'
	+ '<li>Includes <span class="qgBold">Franz Bardon</span>, <span class="qgBold">Rydumy</span>, <span class="qgBold">Alfabeto Carbonaro</span>,'
	+ ' <span class="qgBold">Cryptographic AQ</span>, <span class="qgBold">Heximal AQ</span>, <span class="qgBold">English Trigon</span>,'
	+ ' <span class="qgBold">AQ Astrology</span> and <span class="qgBold">Illuminati Novice Wheel</span>.</li>'
	+ '<li>Some map whole groups of letters, not just single ones - Bardon reads <span class="qgBold">ch</span>, <span class="qgBold">sch</span>'
	+ ' and <span class="qgBold">tz</span> as one unit, and the longest match always wins.</li>'
	+ '<li><span class="qgNote">Because there is no number, wheel cyphers are skipped by the highlighter, Find Matches,'
	+ ' Numerology Mode, number properties and database queries. They still export normally.</span></li>'
	+ '</ul>'

	+ '<p class="qgMedium">Edit Cyphers</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">"Left Click"</span> a cypher name inside <span class="qgBold">Edit Cyphers</span> to change it or base a new one on it.</li>'
	+ '<li>Give each cypher a unique name. Two cyphers sharing a name makes the second one unreachable, since every lookup finds the first.</li>'
	+ '<li>Custom cyphers are saved with your settings, and sync to your account if you are signed in.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Color Controls</p>'
	+ '<ul>'
	+ '<li>Change interface, font or cypher colours (<span class="qgBold">HSL</span> - hue, saturation, lightness).</li>'
	+ '<li>Every cypher has its own swatch - click it to pick an exact colour.</li>'
	+ '<li>Save your settings afterwards, or the changes are lost on reload.</li>'
	+ '</ul>'
},

{ id: "highlighter", label: "🔎 Matching", html:
	'<p class="qgMedium">Highlight Box - space delimited numbers</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">"Enter"</span> - activate the filter (removes non-matching phrases and cyphers)</li>'
	+ '<li><span class="qgBold">"Delete"</span> - clear the box (does not reset the filter)'
	+ '<br><span class="qgNote">Note: reset the filter with the "X" button beside the box</span></li>'
	+ '<li><span class="qgBold">"Insert"</span> - find all available matches</li>'
	+ '<li><span class="qgBold">"Ctrl + Delete"</span> - reset the filter and revert to the initial history state</li>'
	+ '<li><span class="qgNote">Type "0 0", or "Ctrl + Left Click" a "0" cell twice, to highlight zero.'
	+ ' The history table recalculates on every keystroke.</span></li>'
	+ '</ul>'

	+ '<p class="qgMedium">Find Matches</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">Find Matches</span> has its own tab in the top menu. It fills the'
	+ ' <span class="qgBold">Highlight Box</span> with every number that appears at least twice in the history table.</li>'
	+ '<li>The button sweeps green as it runs, so you can see it worked even when nothing matched.</li>'
	+ '<li><span class="qgBold">"Show Only Matching"</span> hides everything that did not match instead of dimming it.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Highlighter Modes</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">"Cross Cipher Match"</span> - a value counts if it appears under any cypher.</li>'
	+ '<li><span class="qgBold">"Same Cipher Match"</span> - a value only counts within its own cypher column.'
	+ '<br><span class="qgNote">Note: with a single value, only "Cross Cipher Match" will pick it up</span></li>'
	+ '</ul>'
},

{ id: "breakdown", label: "🧮 Breakdown", html:
	'<p class="qgMedium">Cypher &amp; Breakdown Chart</p>'
	+ '<ul>'
	+ '<li>The <span class="qgBold">Cypher Chart</span> doubles as a virtual keyboard.</li>'
	+ '<li><span class="qgBold">"Left Click"</span> the top left corner for <span class="qgBold">Space</span>, the top right for <span class="qgBold">Backspace</span>.</li>'
	+ '<li><span class="qgBold">"Left Click"</span> the cypher name to switch to uppercase.</li>'
	+ '<li><span class="qgBold">"Left Click"</span> letters to type them.</li>'
	+ '<li><span class="qgBold">"Left Click"</span> numbers or letters to highlight cells in the <span class="qgBold">Breakdown Chart</span>.</li>'
	+ '<li>Charts scale down to fit rather than overflowing, so wide cyphers stay readable on small screens.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Number Properties</p>'
	+ '<ul>'
	+ '<li>Hold <span class="qgBold">"Ctrl"</span> and hover a number to see its properties.</li>'
	+ '<li>Hold <span class="qgBold">"Shift"</span> and hover for the extended set.</li>'
	+ '<li>Supported for values up to 10 million.</li>'
	+ '<li>Drag the cursor across the tooltip to close it. On mobile, tap the tooltip first, then tap outside.'
	+ '<br><span class="qgNote">Note: available in the Enabled Cyphers Table, History Table and Query Table</span></li>'
	+ '</ul>'

	+ '<p class="qgMedium">Numerology Mode</p>'
	+ '<ul>'
	+ '<li>Shows the reduction chain beside each value - <span class="qgBold">79 &#10148; 16 &#10148; 7</span> - instead of the raw number.</li>'
	+ '<li>Stops at a single digit, or at the master numbers <span class="qgBold">11</span>, <span class="qgBold">22</span> and <span class="qgBold">33</span>.</li>'
	+ '<li>Found under <span class="qgBold">"Show Only Matching"</span> in the Options tab.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Letter &amp; Word Count</p>'
	+ '<ul>'
	+ '<li>Counts only the letters and words the current cypher actually recognises, so an unmapped character is not counted.</li>'
	+ '</ul>'
},

{ id: "datecalc", label: "📅 Dates", html:
	'<p class="qgMedium">Date Calculator</p>'
	+ '<ul>'
	+ '<li>Has its own tab in the top menu.</li>'
	+ '<li>Calculates the interval between two dates on the Gregorian calendar.</li>'
	+ '<li>Supports <span class="qgBold">Add/Subtract</span> mode for stepping forward or back from a date.</li>'
	+ '<li>Results are broken down into years, months, weeks and days, so any of them can be fed straight into the phrase box.</li>'
	+ '</ul>'
},

{ id: "astrology", label: "🔮 Astrology", html:
	'<p class="qgMedium">Astrology</p>'
	+ '<ul>'
	+ '<li>Has its own tab in the top menu. Enter a birth date, time and place to build a chart.</li>'
	+ '<li><span class="qgBold">Birth location</span> - type a place name and pick it from the lookup; latitude, longitude'
	+ ' and time zone are filled in for you.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">The Charts</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">2D natal wheel</span> - planets, signs, houses and aspects drawn on a traditional wheel.</li>'
	+ '<li><span class="qgBold">3D solar system</span> - the same moment shown as orbits. Drag to rotate, scroll to zoom.</li>'
	+ '<li>Houses are calculated from your birth location, so the Ascendant reflects the exact horizon at that time.</li>'
	+ '</ul>'

	+ '<p class="qgNote">Positions are computed from orbital elements rather than a lookup table, including the'
	+ ' main perturbations for the Sun and Moon.</p>'
},

{ id: "coderain", label: "🌊 Code Rain", html:
	'<p class="qgMedium">Background Styles</p>'
	+ '<ul>'
	+ '<li>The toggle at the far right of the top menu cycles'
	+ ' <span class="qgBold">Off</span> &#10148; <span class="qgBold">On</span> &#10148;'
	+ ' <span class="qgBold">Retro</span> &#10148; <span class="qgBold">CCRU</span>.</li>'
	+ '<li>The rain mixes Latin letters and digits with katakana, Hebrew, Greek and Cyrillic glyphs.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Tuning It</p>'
	+ '<ul>'
	+ '<li>Hover the toggle to open the panel.</li>'
	+ '<li><span class="qgBold">Density</span> - how many columns fall at once.</li>'
	+ '<li><span class="qgBold">Speed</span> - how fast they fall.</li>'
	+ '<li><span class="qgBold">Colour</span> - drag the spectrum for a quick hue, or use the swatch to pick an exact colour.</li>'
	+ '<li><span class="qgBold">Follow cipher</span> - the rain borrows the colour of whichever cypher is selected. Picking a colour by hand turns this off.</li>'
	+ '<li><span class="qgBold">Reset</span> - back to the defaults.</li>'
	+ '</ul>'

	+ '<p class="qgNote">A colour you pick also tints the page background, so turning the rain off or running it'
	+ ' thin still leaves the scheme you chose rather than snapping back to the default.</p>'
},

{ id: "profile", label: "✅ Profile", html:
	'<p class="qgMedium">Why make a FREE account?</p>'
	+ '<p>The calculator works fully without one. An account is for keeping your work between visits and'
	+ ' across devices. There is no cost, no card and no limit on the free features.</p>'

	+ '<p class="qgMedium">Membership perks</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">&#128190; Your history is saved.</span> Phrases survive a refresh instead of vanishing,'
	+ ' and follow you to every device you sign in on.</li>'
	+ '<li><span class="qgBold">&#9881; Your workspace is default.</span> Enabled cyphers, colours, custom cyphers and'
	+ ' code rain settings load exactly as you left them.</li>'
	+ '<li><span class="qgBold">&#128269; Search what you decoded.</span> Saved entries are searchable, so you can look'
	+ ' back through every term you have run instead of typing it out again.</li>'
	+ '<li><span class="qgBold">&#127942; Climb the leaderboard.</span> Publish the phrases you choose and see the top'
	+ ' contributors ranked. Only usernames are ever shown, never email addresses.</li>'
	+ '<li><span class="qgBold">&#127912; Custom avatar.</span> Upload your own picture for your profile and the leaderboard.</li>'
	+ '<li><span class="qgBold">&#128451; Presets.</span> Save named sessions - a set of enabled cyphers, colours, custom'
	+ ' cyphers and code rain settings - and switch between them in one click.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">The Profile tab</p>'
	+ '<ul>'
	+ '<li><span class="qgBold">Saved Entries</span> - everything you have looked up, searchable, and the place you'
	+ ' publish a phrase from.</li>'
	+ '<li><span class="qgBold">Presets</span> - create, load, overwrite and delete named sessions.</li>'
	+ '<li><span class="qgBold">My Submissions</span> - what you have published, and a withdraw button for each.</li>'
	+ '<li><span class="qgBold">Leaderboard</span> - the ranked contributors.</li>'
	+ '<li><span class="qgBold">Account</span> - display name, avatar and sign out.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Publishing rules</p>'
	+ '<ul>'
	+ '<li>Nothing is published automatically. You opt in per phrase.</li>'
	+ '<li>A phrase already in the <span class="qgBold">database</span> cannot be published - capitalisation is ignored,'
	+ ' so a different case is still the same phrase.</li>'
	+ '<li>A phrase someone else has already published cannot be published again.</li>'
	+ '<li>Either way the entry turns <span class="qgBold">red</span> and tells you why.</li>'
	+ '<li>You can withdraw anything you published at any time.</li>'
	+ '</ul>'
},

{ id: "options", label: "⚙ Options", html:
	'<ul>'
	+ '<li><span class="qgBold">"Number Calculation"</span>'
	+ '<ul><li>Full (123 = 123) - <span class="qgBold">default</span></li><li>Reduced (123 = 1+2+3 = 6)</li><li>Off</li></ul></li>'
	+ '<li><span class="qgBold">"Show Only Matching"</span> - with the highlighter active, hides non-matching values instead of dimming them</li>'
	+ '<li><span class="qgBold">"Enter As Words"</span> - reads the phrase box one word at a time up to a set length, then moves on</li>'
	+ '<li><span class="qgBold">"Numerology Mode"</span> - show reduction chains instead of plain values</li>'
	+ '<li><span class="qgBold">"Ignore Comments [...]"</span> - exclude text in square brackets from the calculation'
	+ '<br><span class="qgNote">Note: comments are preserved on export and import</span></li>'
	+ '<li><span class="qgBold">"Live Database Mode"</span> - turn off to generate a precalculated database on import</li>'
	+ '<li><span class="qgBold">"New Phrases Go First"</span> - insert new phrases at the top of the history table</li>'
	+ '<li><span class="qgBold">"Phrases on DB page"</span> - how many phrases appear on one page of query results</li>'
	+ '<li><span class="qgBold">"Scroll DB by lines"</span> - scrolling speed inside query results</li>'
	+ '<li><span class="qgBold">"Letter/Word Count"</span> - show how many letters and words the current cypher recognises</li>'
	+ '<li><span class="qgBold">"Word Breakdown"</span> - show the detailed breakdown for the current phrase</li>'
	+ '<li><span class="qgBold">"Compact Breakdown"</span> - leave the plain text phrase out of the breakdown table</li>'
	+ '<li><span class="qgBold">"Cipher Chart"</span> - show the letter-to-value chart for the current cypher</li>'
	+ '<li><span class="qgBold">"Gradient Charts"</span> - fill style for the breakdown and cypher charts</li>'
	+ '<li><span class="qgBold">"Switch Ciphers (CSV)"</span> - re-enable the saved cypher selection when importing history</li>'
	+ '</ul>'
},

{ id: "export", label: "📤 Export", html:
	'<ul>'
	+ '<li><span class="qgBold">"Print Cipher Chart"</span> and friends - render that element as a PNG. A preview opens first.</li>'
	+ '<li><span class="qgBold">"Image Scale"</span> - scaling factor for screenshots (1.0, 1.5, 2.0).</li>'
	+ '<li><span class="qgBold">"Import File"</span> - import a <span class="qgBold">.txt</span> file (one phrase per line),'
	+ ' a previously exported CSV history, exported matches, or a settings file.</li>'
	+ '<li><span class="qgBold">"Create Database (TXT)"</span> - convert a <span class="qgBold">.txt</span> file into'
	+ ' <span class="qgBold">Live Database</span> format.</li>'
	+ '<li><span class="qgBold">"Export History (CSV)"</span> - export the current history table. Semicolon separated,'
	+ ' with cypher names in the first row.</li>'
	+ '<li><span class="qgBold">"Export Matches (TXT)"</span> - export every available match from the current history table,'
	+ ' using the active highlighter mode.</li>'
	+ '<li><span class="qgBold">"Save/Load/Reset"</span> - store the current calculator and cypher settings in this browser.</li>'
	+ '<li><span class="qgBold">"Export Settings (JS)"</span> - export the settings and cyphers as a file you can share or keep.</li>'
	+ '</ul>'
	+ '<p class="qgNote">All of these are also on the right click menu, wherever you are on the page.</p>'
},

{ id: "databases", label: "🗃 Databases", html:
	'<ul>'
	+ '<li>Import a properly formatted TXT file to turn on database query mode.</li>'
	+ '<li><span class="qgBold">Live Database Mode</span> is used by default; a precalculated database only holds values'
	+ ' for the cyphers selected when it was built.</li>'
	+ '<li>The <span class="qgBold">"Ignore Comments [...]"</span> flag affects database generation, so the calculator'
	+ ' should use the same setting the database was built with.</li>'
	+ '<li><span class="qgBold">"Cipher Edit"</span> and reordering are unavailable while a precalculated database is loaded.</li>'
	+ '<li>The active highlighter mode controls how a query matches.</li>'
	+ '<li>Queries follow the current cypher selection, with no limit on how many are enabled.</li>'
	+ '<li>Type a phrase into the <span class="qgBold">Phrase Box</span> and press <span class="qgBold">Query</span> to match it.</li>'
	+ '</ul>'

	+ '<p class="qgMedium">Query Table</p>'
	+ '<ul>'
	+ '<li>Use the <span class="qgBold">Search Bar</span> to filter results. <span class="qgBold">"Enter"</span> applies the filter.</li>'
	+ '<li><span class="qgBold">"Up"</span> and <span class="qgBold">"Down"</span> scroll a page at a time, as does the mouse wheel.</li>'
	+ '<li>Drag the bottom-right corner to resize the table - useful when long phrases do not fit.</li>'
	+ '<li><span class="qgBold">"Ctrl + Left Click"</span> a phrase to load it into the <span class="qgBold">Phrase Box</span>.</li>'
	+ '<li><span class="qgBold">"Left Click"</span> the button in the top right corner to minimise the table, and again to bring it back.</li>'
	+ '</ul>'
}

]

function quickGuideTopicBtn(t) {
	var on = (quickGuideTopic === t.id) ? " qgTopicOn" : ""
	return '<input class="intBtn3 qgTopicBtn'+on+'" type="button" value="'+t.label+'" onclick="quickGuideShow(&quot;'+t.id+'&quot;)">'
}

function quickGuideBody() {
	for (var i = 0; i < quickGuideTopics.length; i++) {
		if (quickGuideTopics[i].id === quickGuideTopic) return quickGuideTopics[i].html
	}
	return ""
}

// Repaints the buttons and the body only, so the credits underneath are left
// alone and switching topics does not rebuild the whole panel.
function quickGuideShow(id) {
	quickGuideTopic = id
	var btns = document.getElementById("qgTopicBar")
	var body = document.getElementById("qgBody")
	if (btns === null || body === null) return
	var b = ""
	for (var i = 0; i < quickGuideTopics.length; i++) b += quickGuideTopicBtn(quickGuideTopics[i])
	btns.innerHTML = b
	body.innerHTML = quickGuideBody()
	body.scrollTop = 0
}

// Credits, shown under every topic rather than hidden behind one.
function quickGuideThanks() {
	return '<p><span class="qgBold2">Special Thanks</p>\n<ul><li><span class="qgBold"> Spawn From</span> - <span class="qgBold"><a href="https://gematrinator.com/calculator" target="_blank">@Gematrinator</a></span> & <span class="qgBold"><a href="https://gematro.github.io/" target="_blank">@Gematro</a></span>.</li> Cyphers is possible due to their original code. <br> Gematro is considered a Cyphers co-founder.<br> His username was @Saun_Virroco back then. <br> Cyphers News = [155 Ordinal] = Saun_Virroco. <br><br> <li><span class="qgBold">Extra Cyphers</span> - list by <span class="qgBold"><a href="https://gematriaresearch.blogspot.com/" target="_blank">@GematriaResearch.</a> <br> Known as Alektryon and our third co-founder. </span></li><br><li><span class="qgBold">Cyphers News</span> - by Net Void. Calculator by: <br> Gematro. Contributors: Gematria Research, <br> Lake Onyx, Truth Audit, and Hyperdope. <br><br><li> <span class="qgBold"><a href="https://x.com/GematriaClub" target="_blank">@GematriaClub</a></span> - beginner to expert category.</li><br><li><span class="qgBold">The CCRU</span> - Cybernetic Culture Research Unit.<br>Thanks to legend <span class="qgBold"><a href="https://x.com/xenocosmography" target="_blank">@Xenocosmography</a></span> and <br> scholar Gematria Research for the list:<br> Alphanumeric Qabbala & QWERTY cyphers. <br> Spawned since computer era - 1990s & Y2K. <br><br></li><li><span class="qgBold">[Disclaimer]</span> - <span class="qgBold">Synx</span> was discovered in 2024 <br>by <span class="qgBold"><a href="https://gematriaresearch.blogspot.com/" target="_blank">@GematriaResearch.</a></span> It is used in tandem.</li><br><li><span class="qgBold">Contact Us</span> - <span class="qgBold"><a href="https://x.com/CyphersNews" target="_blank">@CyphersNews</a></span> for more. </a></li></ul>'
}

function displayQuickstartGuide() {
	$('<div id="darkOverlay" onclick="closePanel(&quot;.quickGuide&quot;)"></div>').appendTo('body'); // overlay

	quickGuideTopic = "basics" // always open on the first topic

	var o = '<div class="quickGuide">'
	o += '<p><span class="qgBold2">Quickstart Guide</p>'
	o += '<p class="qgIntro">Pick a topic.</p>'

	o += '<div id="qgTopicBar" class="qgTopicBar">'
	for (var i = 0; i < quickGuideTopics.length; i++) o += quickGuideTopicBtn(quickGuideTopics[i])
	o += '</div>'

	o += '<div id="qgBody" class="qgBody">'
	o += quickGuideBody()
	o += '</div>'

	o += '<hr class="numPropSeparator">'
	o += quickGuideThanks()

	o += '</div>'

	$(o).appendTo('body'); // guide
	$('body').addClass('noScroll') // prevent scrolling
}

// ========================== Contact panel =========================
//
// Opens the visitor's own mail app with the subject already set, rather than
// posting anywhere: there is no server here to receive a form, and a mailto
// keeps a copy in their sent items so they have a record of what they asked.

var CONTACT_EMAIL = "cypherstvuk@gmail.com"

var contactTopics = [
	"Add a phrase to the database",
	"Correction to a cypher",
	"Delete my account",
	"Feature request",
	"Leaderboard or submissions",
	"Membership or account help",
	"Partnership or press",
	"Report a bug",
	"Something else",
	"Suggest a cypher to add"
]

function displayContactPanel() {
	$('<div id="darkOverlay" onclick="closePanel(&quot;.quickGuide&quot;)"></div>').appendTo('body');

	var signedIn = (typeof authUser !== "undefined" && authUser !== null)

	var o = '<div class="quickGuide contactPanel">'
	o += '<p><span class="qgBold2">Contact Us</span></p>'

	if (!signedIn) {
		o += '<p class="qgIntro">Messages are sent from your account, so we know who to reply to and the form cannot be used for spam. Sign in and the box below will send.</p>'
		o += '<div class="contactActions">'
		o += '<a class="intBtn3" href="login.html">Sign in</a>'
		o += '<a class="intBtn3" href="register.html">Create a free account</a>'
		o += '</div>'
		o += '<p class="qgNote contactFoot">Rather not sign in? Email us at <span class="qgBold">' + CONTACT_EMAIL + '</span></p>'
		o += '</div>'
		$(o).appendTo('body'); $('body').addClass('noScroll')
		return
	}

	o += '<p class="qgIntro">Pick a topic and write your message. It is sent straight to us from here, so there is nothing else to do.</p>'

	o += '<div class="contactField">'
	o += '<label class="contactLabel" for="contactTopic">Topic</label>'
	o += '<select id="contactTopic" class="contactSelect">'
	for (var i = 0; i < contactTopics.length; i++) {
		o += '<option value="' + escHtml(contactTopics[i]) + '">' + escHtml(contactTopics[i]) + '</option>'
	}
	o += '</select></div>'

	o += '<div class="contactField">'
	o += '<label class="contactLabel" for="contactBody">Message</label>'
	o += '<textarea id="contactBody" class="contactTextarea" rows="6" maxlength="4000" placeholder="Anything that helps us understand&hellip;"></textarea>'
	o += '</div>'

	o += '<div class="contactField">'
	o += '<label class="contactLabel" for="contactReply">Reply to</label>'
	o += '<input type="email" id="contactReply" class="contactSelect" value="' + escHtml(authUser.email || "") + '" placeholder="Where should we reply?">'
	o += '</div>'

	o += '<div class="contactActions">'
	o += '<input class="intBtn3" id="contactSendBtn" type="button" value="Send message" onclick="contactSend()">'
	o += '</div>'

	o += '<div id="contactMsg" class="qgNote contactFoot hideValue"></div>'
	o += '</div>'

	$(o).appendTo('body');
	$('body').addClass('noScroll')
}

function contactSend() {
	var topicEl = document.getElementById("contactTopic")
	var bodyEl = document.getElementById("contactBody")
	var replyEl = document.getElementById("contactReply")
	var btn = document.getElementById("contactSendBtn")
	var msg = document.getElementById("contactMsg")

	var show = function (t, warn) {
		msg.className = "qgNote contactFoot" + (warn ? " profileWarn" : " profileOk")
		msg.textContent = t
		msg.classList.remove("hideValue")
	}

	var body = bodyEl ? bodyEl.value.trim() : ""
	if (body === "") { show("Write a message first.", true); return }

	btn.disabled = true
	btn.value = "Sending…"
	contactSubmit(topicEl ? topicEl.value : "", body, replyEl ? replyEl.value : "").then(function () {
		bodyEl.value = ""
		btn.value = "Sent"
		show("Thanks — we have it, and will reply to " + (replyEl && replyEl.value ? replyEl.value : "your account email") + ".", false)
	}).catch(function (err) {
		btn.disabled = false
		btn.value = "Send message"
		show((err && err.message) ? err.message : "Could not send. Try again shortly.", true)
	})
}

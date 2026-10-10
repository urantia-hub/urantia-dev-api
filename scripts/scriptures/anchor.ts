// The words that take a browser to ONE passage on the public page of a work. A browser goes to the
// first place that has the words of a text fragment, so the words must be in one place of the page only.

const BLOCK =
	/<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|pre|hr|section|article|dd|dt|dl)\b[^>]*>/gi;
const MARK = " ¶ ";

/** The text of a page as a browser shows it: one space between words, and a mark between blocks. */
export function pageText(html: string): string {
	return html
		.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, MARK)
		.replace(BLOCK, MARK)
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/\s+/g, " ")
		.toLowerCase();
}

// Words with a quote mark, a dash of another form, or a letter with a sign can differ between our record
// and the page. The anchor uses plain words only.
const PLAIN = /^[A-Za-z0-9,.;:!?()-]+$/;
const MIN = 4;
const MAX = 14;

function places(page: string, phrase: string): number {
	let count = 0;
	for (let at = page.indexOf(phrase); at !== -1 && count < 2; at = page.indexOf(phrase, at + 1))
		count += 1;
	return count;
}

/**
 * The first run of 4 to 14 plain words of the passage that is in one place of the page. Null when
 * the passage has none: the link is then the page only.
 */
export function findAnchor(page: string, passage: string): string | null {
	const words = passage.trim().split(/\s+/);
	for (let start = 0; start + MIN <= words.length && start < 80; start += 1) {
		for (let n = MIN; n <= MAX && start + n <= words.length; n += 1) {
			const run = words.slice(start, start + n);
			if (!run.every((word) => PLAIN.test(word))) break;
			const phrase = run.join(" ");
			const found = places(page, phrase.toLowerCase());
			// More words cannot be on the page when these are not.
			if (found === 0) break;
			if (found === 1) return phrase;
		}
	}
	return null;
}

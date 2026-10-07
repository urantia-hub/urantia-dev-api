// The texts of the world religions layer. Each one is in the US public domain.

export type Corpus = {
	id: string;
	religion: string;
	title: string;
	translator: string;
	year: number;
	source: string;
	license: string;
	// The Paper 131 section headed with this religion. Null when Paper 131 has no such heading.
	urantiaSection: string | null;
	refPrefix: string;
	slug: string; // the corpus name in URLs
	divisionLabel: string;
	unitLabel: string;
	chunkBy: "size" | "division"; // "division": one chunk per chapter
	refLevels: 1 | 2 | 3; // numbers in a full ref: "Dhp 183" 1, "BG 2.47" 2, "Epictetus 3.22.5" 3
	notes: string | null; // how the text is numbered or selected, shown with the corpus
};

// Ordered by Paper 131 section, then the texts with no Paper 131 heading.
export const CORPORA: Corpus[] = [
	{
		id: "diogenes-laertius-6-hicks-1925",
		religion: "Cynicism",
		title: "Lives of Eminent Philosophers, Book 6: The Cynics",
		translator: "R. D. Hicks",
		year: 1925,
		source: "https://en.wikisource.org/wiki/Lives_of_the_Eminent_Philosophers/Book_VI",
		license: "Public domain in the United States",
		urantiaSection: "131:1",
		refPrefix: "DL",
		slug: "diogenes-laertius-6",
		divisionLabel: "book",
		unitLabel: "section",
		chunkBy: "size",
		refLevels: 2,
		notes:
			"Book 6 only: the lives and sayings of Antisthenes, Diogenes, Crates, Hipparchia, and the other Cynics. A biography, not scripture.",
	},
	{
		id: "epictetus-3-22-oldfather-1928",
		religion: "Cynicism",
		title: "Discourses 3.22: On the Calling of a Cynic",
		translator: "W. A. Oldfather",
		year: 1928,
		source:
			"https://en.wikisource.org/wiki/Epictetus,_the_Discourses_as_reported_by_Arrian,_the_Manual,_and_Fragments/Book_3/Chapter_22",
		license: "Public domain in the United States",
		urantiaSection: "131:1",
		refPrefix: "Epictetus",
		slug: "epictetus-cynic",
		divisionLabel: "book",
		unitLabel: "section",
		chunkBy: "size",
		refLevels: 3,
		notes:
			"One chapter of the Discourses, as reported by Arrian. Oldfather marks every fifth section, so each passage covers up to five sections, such as 3.22.5-9.",
	},
	{
		id: "dhammapada-muller-1881",
		religion: "Buddhism",
		title: "The Dhammapada",
		translator: "F. Max Muller",
		year: 1881,
		source: "https://www.gutenberg.org/ebooks/2017",
		license: "Public domain in the United States",
		urantiaSection: "131:3",
		refPrefix: "Dhp",
		slug: "dhammapada",
		divisionLabel: "chapter",
		unitLabel: "verse",
		chunkBy: "size",
		refLevels: 1,
		notes: null,
	},
	{
		id: "bhagavad-gita-besant-1922",
		religion: "Hinduism",
		title: "The Bhagavad Gita",
		translator: "Annie Besant (4th edition)",
		year: 1922,
		source: "https://en.wikisource.org/wiki/Bhagavad-Gita_(Besant_4th)",
		license: "Public domain in the United States",
		urantiaSection: "131:4",
		refPrefix: "BG",
		slug: "bhagavad-gita",
		divisionLabel: "chapter",
		unitLabel: "verse",
		chunkBy: "size",
		refLevels: 2,
		notes: null,
	},
	{
		id: "shinto-oracles-aston-1905",
		religion: "Shinto",
		title: "Shinto Oracles",
		translator: "W. G. Aston",
		year: 1905,
		source: "https://en.wikisource.org/wiki/Shinto:_The_Way_of_the_Gods/Chapter_14",
		license: "Public domain in the United States",
		urantiaSection: "131:7",
		refPrefix: "Oracle",
		slug: "shinto-oracles",
		divisionLabel: "collection",
		unitLabel: "oracle",
		chunkBy: "size",
		refLevels: 1,
		notes:
			"Oracles of Shinto shrines from the Wa Rongo (1669), as Aston quotes them in Shinto: The Way of the Gods, chapter 14. Aston does not number them, so the numbers follow his order. His summaries of other oracles are not included.",
	},
	{
		id: "tao-te-ching-legge-1891",
		religion: "Taoism",
		title: "The Tao Te Ching",
		translator: "James Legge",
		year: 1891,
		source: "https://www.gutenberg.org/ebooks/216",
		license: "Public domain in the United States",
		urantiaSection: "131:8",
		refPrefix: "TTC",
		slug: "tao-te-ching",
		divisionLabel: "chapter",
		unitLabel: "paragraph",
		chunkBy: "division",
		refLevels: 2,
		notes: null,
	},
	{
		id: "analects-legge-1861",
		religion: "Confucianism",
		title: "The Analects of Confucius",
		translator: "James Legge",
		year: 1861,
		source: "https://www.gutenberg.org/ebooks/4094",
		license: "Public domain in the United States",
		urantiaSection: "131:9",
		refPrefix: "Analects",
		slug: "analects",
		divisionLabel: "book",
		unitLabel: "chapter",
		chunkBy: "size",
		refLevels: 2,
		notes: null,
	},
	{
		id: "koran-pickthall-1930",
		religion: "Islam",
		title: "The Meaning of the Glorious Koran",
		translator: "Marmaduke Pickthall",
		year: 1930,
		source: "https://www.gutenberg.org/ebooks/16955",
		license: "Public domain in the United States",
		urantiaSection: null,
		refPrefix: "Quran",
		slug: "quran",
		divisionLabel: "surah",
		unitLabel: "verse",
		chunkBy: "size",
		refLevels: 2,
		notes:
			"Verse numbers follow the standard count of 6,236 verses. Project Gutenberg 16955 prints three translations side by side; only Pickthall's is used.",
	},
	{
		id: "japji-macauliffe-1909",
		religion: "Sikhism",
		title: "The Japji",
		translator: "Max Arthur Macauliffe",
		year: 1909,
		source: "https://en.wikisource.org/wiki/The_Sikh_Religion/Volume_1/Japji",
		license: "Public domain in the United States",
		urantiaSection: null,
		refPrefix: "Japji",
		slug: "japji",
		divisionLabel: "composition",
		unitLabel: "pauri",
		chunkBy: "size",
		refLevels: 1,
		notes:
			"From The Sikh Religion, volume 1. Japji 0 is the opening (the Mul Mantar), Japji 1 to 38 are the pauris, and Japji 39 is the closing slok.",
	},
];

// The texts of the world religions layer. Each one is in the US public domain.

export type Corpus = {
	id: string;
	religion: string;
	title: string;
	translator: string;
	year: number;
	source: string;
	license: string;
	urantiaSection: string; // the Paper 131 section on this religion
	refPrefix: string;
	slug: string; // the corpus name in URLs
	divisionLabel: string;
	unitLabel: string;
	chunkBy: "size" | "division"; // "division": one chunk per chapter
};

export const CORPORA: Corpus[] = [
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
	},
];

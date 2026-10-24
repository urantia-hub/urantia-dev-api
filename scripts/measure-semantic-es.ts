// Run: bun scripts/measure-semantic-es.ts (read-only calls to production). Sets ES_STRENGTH_OFFSET.
// Compares /search/semantic for each question in English and in Spanish: top-10 overlap, top-1 match, mean similarity.
// A control row compares two English wordings of the same question, the ceiling for "another wording".
const API = "https://api.urantia.dev/search/semantic";
const PAIRS: [string, string][] = [
	["Why is the world in such turmoil?", "¿Por qué hay tanto desorden en el mundo?"],
	["Where is civilization going?", "¿Hacia dónde va la civilización?"],
	["How do I live without fear?", "¿Cómo puedo vivir sin miedo?"],
	["What happens after death?", "¿Qué pasa después de la muerte?"],
	["What is the soul?", "¿Qué es el alma?"],
	["How do I find peace of mind?", "¿Cómo encuentro la paz interior?"],
	["How big is the universe?", "¿Qué tan grande es el universo?"],
	["What are angels?", "¿Qué son los ángeles?"],
	["Is there life on other worlds?", "¿Hay vida en otros mundos?"],
	["When did humans come to the Americas?", "¿Cuándo llegaron los seres humanos a América?"],
	["How did life begin on earth?", "¿Cómo empezó la vida en la Tierra?"],
	["Where did marriage come from?", "¿De dónde viene el matrimonio?"],
	["Why do people fear ghosts?", "¿Por qué la gente les tiene miedo a los fantasmas?"],
	[
		"Where did Jesus travel before his public ministry?",
		"¿Adónde viajó Jesús antes de su ministerio público?",
	],
	["What was Jesus like as a child?", "¿Cómo era Jesús de niño?"],
	["What did Jesus teach about prayer?", "¿Qué enseñó Jesús sobre la oración?"],
	["What is a Thought Adjuster?", "¿Qué es un Ajustador del Pensamiento?"],
	["What is morontia?", "¿Qué es la morontia?"],
	["Who is the Universal Father?", "¿Quién es el Padre Universal?"],
	["What is the Paradise Trinity?", "¿Qué es la Trinidad del Paraíso?"],
	["What happened in the Lucifer rebellion?", "¿Qué pasó en la rebelión de Lucifer?"],
	["Who were Adam and Eve?", "¿Quiénes fueron Adán y Eva?"],
	["What are the mansion worlds?", "¿Qué son los mundos de las mansiones?"],
	["How should I forgive others?", "¿Cómo debo perdonar a los demás?"],
	["What is the meaning of faith?", "¿Qué significa la fe?"],
	["Why does God allow evil?", "¿Por qué Dios permite el mal?"],
	["What is the Supreme Being?", "¿Qué es el Ser Supremo?"],
	[
		"How did the apostles react to the crucifixion?",
		"¿Cómo reaccionaron los apóstoles ante la crucifixión?",
	],
	["What is true religion?", "¿Qué es la verdadera religión?"],
	["How should parents raise children?", "¿Cómo deben los padres criar a sus hijos?"],
];
const CONTROL: [string, string][] = [
	["What happens after death?", "Where do we go when we die?"],
	["What is the soul?", "What is the human soul made of?"],
	["How do I live without fear?", "How can I stop being afraid?"],
	["What are angels?", "Tell me about angels."],
	["What did Jesus teach about prayer?", "How did Jesus say we should pray?"],
	["Why does God allow evil?", "If God is good, why is there evil?"],
	["Where did marriage come from?", "What is the origin of marriage?"],
	["What is true religion?", "What makes religion genuine?"],
	["How big is the universe?", "What is the size of the universe?"],
	["Is there life on other worlds?", "Are other planets inhabited?"],
];
type Row = { standardReferenceId: string; similarity: string | number; strength?: string };
async function top(q: string): Promise<Row[]> {
	const r = await fetch(API, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ q, limit: 10 }),
	});
	if (!r.ok) throw new Error(`${r.status} for ${q}`);
	return ((await r.json()) as { data: Row[] }).data;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2;
};
async function compare(pairs: [string, string][], label: string) {
	const gaps: number[] = [];
	const overlaps: number[] = [],
		tops: number[] = [],
		simA: number[] = [],
		simB: number[] = [];
	for (const [a, b] of pairs) {
		const [ra, rb] = await Promise.all([top(a), top(b)]);
		const ids = new Set(ra.map((x) => x.standardReferenceId));
		const ov = rb.filter((x) => ids.has(x.standardReferenceId)).length;
		const t1 = ra[0]?.standardReferenceId === rb[0]?.standardReferenceId ? 1 : 0;
		const top3 = ids.has(rb[0]?.standardReferenceId ?? "") ? "in top10" : "";
		overlaps.push(ov);
		tops.push(t1);
		ra.forEach((x, i) => {
			if (rb[i]) gaps.push(Number(x.similarity) - Number(rb[i]!.similarity));
		});
		simA.push(Number(ra[0]?.similarity));
		simB.push(Number(rb[0]?.similarity));
		const strong = rb.filter((x) => x.strength === "strong").length;
		console.log(
			`${String(ov).padStart(2)}/10 top1=${t1} ${top3.padEnd(8)} sim ${Number(ra[0]?.similarity).toFixed(3)} vs ${Number(rb[0]?.similarity).toFixed(3)} strong ${rb.filter((x) => x.strength === "strong").length}/${ra.filter((x) => x.strength === "strong").length}  ${b}`,
		);
		void strong;
	}
	console.log(
		`${label}: median rank-by-rank similarity gap ${median(gaps).toFixed(3)}, mean ${mean(gaps).toFixed(3)}`,
	);
	console.log(
		`${label}: median overlap ${median(overlaps)}/10, mean ${mean(overlaps).toFixed(1)}; same top result ${tops.reduce((a, b) => a + b, 0)}/${pairs.length}; mean top similarity ${mean(simA).toFixed(3)} vs ${mean(simB).toFixed(3)}\n`,
	);
}
await compare(PAIRS, "English vs Spanish");
await compare(CONTROL, "English vs another English wording (control)");

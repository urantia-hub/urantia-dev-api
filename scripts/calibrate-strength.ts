// Measures the similarity that the live semantic search gives a right answer, to set the
// cut points of `strength` in src/lib/search-strength.ts. Read-only calls to the API.
// Usage: bun scripts/calibrate-strength.ts [base URL]
// Each query is a paraphrase of one paragraph, written for this test (no words of a search log).
const BASE = process.argv[2] ?? "https://api.urantia.dev";

const SET: [query: string, target: string][] = [
	["God is first a creator, then a controller, and last one who holds up all things", "1:0.1"],
	["divine love is wise and looks ahead like a parent, not mere sentiment", "2:5.10"],
	["the Father does not withdraw because he was offended by our wrongdoing", "3:1.12"],
	["God wants every creature to have personal fellowship with him", "5:1.8"],
	["mercy is the love of the Father put into action through the Son", "6:3.5"],
	["accepting spirit guidance slowly gives the mind an awareness of contact with God", "34:6.12"],
	["weak people make resolutions while strong people act; life is one day of work", "48:7.13"],
	["love means wanting to do good for other people", "56:10.21"],
	["institutions that stand still decay; only those that keep evolving survive", "71:4.1"],
	["the answer to prayer is more truth, more beauty, and a better idea of goodness", "91:8.11"],
	["religion should keep out of secular affairs but must not block social progress", "99:7.1"],
	[
		"spiritual growth needs a living link with spirit forces and bearing spiritual fruit",
		"100:2.1",
	],
	[
		"every believer can grow a strong unified personality even without the perfection of Jesus",
		"100:7.1",
	],
	["true religion is neither a provable philosophy nor a mystical ecstasy", "101:1.1"],
	["we recognize religion in the lives of other people; it needs no definition", "102:2.1"],
	[
		"religion works in the mind before it shows up in consciousness, like a child before birth",
		"103:2.1",
	],
	["the Adjusters are the love of the Father living in human souls", "107:0.2"],
	["the Adjuster arrives when a child makes its first moral decision", "108:2.1"],
	["the Adjuster does not live in the physical brain", "110:1.1"],
	["the mind is the soil in which the spirit grows the soul", "111:1.1"],
	["truth cannot be put into words, only lived; it is more than knowledge", "132:3.2"],
	["blessed are the humble, for the treasures of the kingdom belong to them", "140:3.3"],
	["prayer reminds the self while worship forgets the self", "143:7.7"],
	["genuine religion is the experience of the individual with spiritual realities", "160:5.1"],
	["the Spirit of Truth is not a law or a form but a living guide in the heart", "180:5.1"],
	["the cross shows the devotion of the shepherd even for the unworthy sheep", "188:5.1"],
	[
		"the world does not need more Christianity, it needs to see Jesus living again in people",
		"195:10.1",
	],
	["the life of Jesus shows a religion of personal relation with the Father", "196:0.4"],
	["personal religious experience helps solve most of the troubles of mortals", "196:3.1"],
	["all real love comes from God, and we receive it as we give it to others", "117:6.10"],
];

type Hit = { standardReferenceId: string; similarity: number };
const firsts: number[] = [];
const inTop: number[] = [];
const wrongFirsts: number[] = [];
let missed = 0;
for (const [q, target] of SET) {
	const res = await fetch(`${BASE}/search/semantic?q=${encodeURIComponent(q)}&limit=10`);
	const { data } = (await res.json()) as { data: Hit[] };
	const i = data.findIndex((h) => h.standardReferenceId === target);
	const hit = data[i];
	if (hit) inTop.push(hit.similarity);
	else missed++;
	if (i === 0 && hit) firsts.push(hit.similarity);
	else if (data[0]) wrongFirsts.push(data[0].similarity);
	console.log(
		`${target.padEnd(9)} rank ${i < 0 ? "-" : i + 1}  ${hit ? hit.similarity.toFixed(3) : "     "}  top ${data[0]?.similarity.toFixed(3)}  ${q}`,
	);
}
const pct = (xs: number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.max(0, Math.floor((p / 100) * (s.length - 1)))] ?? Number.NaN;
};
console.log(
	`\nrank 1: ${firsts.length}/${SET.length}, in top 10: ${inTop.length}, missed: ${missed}`,
);
console.log(`strong  = 25th percentile of rank-1 right answers: ${pct(firsts, 25).toFixed(3)}`);
console.log(
	`related = 10th percentile of right answers in the top 10: ${pct(inTop, 10).toFixed(3)}`,
);
console.log(
	`(top similarity when rank 1 was wrong: ${wrongFirsts.map((x) => x.toFixed(3)).join(" ")})`,
);

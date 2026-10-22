# Agent translation workflow

An agent (Claude Code, or any other model) translates one paper at a time from a packet. The scripts here prepare the packet and check the result. They make no model calls and cost nothing.

The English text is public domain and our translations are CC0. Existing translations are copyrighted, so this is a clean-room process:

1. **A translator sees only its packet**: the English, the style guide, the clean glossary, and `clean-room.md`. No existing translation goes into a packet.
2. **Each translator is a fresh agent.** Never a fork of a session that has seen an existing translation. No web search. The urantia.dev MCP server in English only, with no `lang` value: the Spanish entity data on the API today is not clean.
3. **The copy check is a script, not a model.** `checks.ts` compares the output with the editions on disk and prints only a number. A paper that matches too much goes back to a fresh agent. A model can remember a published translation, so this check stays even when the process is clean.
4. **A comparison with an existing edition comes after, and it stays separate.** A judge can read it to score quality (`export-review.ts --reference`). A judge never edits our text. A weak paragraph goes back to a fresh agent with the English only.
5. **Review packets stay in `.work/`**, which git ignores. They are never committed or published.

### Not clean, do not use for translation

- `data/translations/<lang>/entity-translations.json` and `term-glossary.json` were made with the Foundation text as context. The API serves these entity names and descriptions with `lang=<lang>`. Rebuild them from the clean glossary before we promote a language.
- `translate-paragraphs.ts`, `translate-titles.ts`, and `translate-entities.ts` read those files. Use the scripts in this folder instead.

## Files

| Path | What it holds | In git |
|---|---|---|
| `clean-room.md`, `style-guides/common.md`, `style-guides/<lang>.md` | The rules for every translator | yes |
| `data/translations/<lang>/glossary.json` | The clean glossary: entity id to the target name and its short forms | yes |
| `data/translations/<lang>/paragraphs/paper-NNN.json` | Finished paragraphs, read by `seed-paragraph-translations.ts` | yes |
| `data/translations/<lang>/titles.json` | Paper and section titles | yes |
| `data/translations/<lang>/term-decisions.json` | Term forms chosen during translation | yes |
| `.work/translate/<lang>/glossary/` | Glossary packets and drafts | no |
| `.work/translate/<lang>/<candidate>/paper-NNN.packet.md` | The input for one paper | no |
| `.work/translate/<lang>/<candidate>/paper-NNN.draft.json` | The translator's output | no |
| `.work/translate/<lang>/review/` | Blind review packets, the key, and the judges' answers | no |

The `candidate` is `main` for the real translation. Use another name, such as `gpt-6` or `gemini-flash`, for a bake-off.

The source texts live outside the repo, in `../misc/` (the English JSON, and the existing editions for the copy check). In a worktree, set `URANTIA_MISC` to that folder.

## Build the clean glossary (once for each language)

The glossary has 2,256 terms: beings, places, orders, races, religions, capitalized concepts, and 106 key concepts from `data/translations/key-concepts.json`. Key concepts are common words that the papers use in a special sense (personality, mind, soul, morontia), plus coined words that are not entities (absonite, superconscious). The list also groups terms into word families and names the Foreword section that defines a term.

Every translator follows `meaning-first.md`: find the meaning in the papers (the Foreword first, then other uses), state it with a reference, rate the confidence in the meaning and in the form separately, test the candidates for meanings the authors did not intend, then choose. `glossary.json` keeps all of it.

1. First translation. A word family always stays in one batch, so its root is chosen once. Run the first batch alone, because it holds the most-used families:

   ```sh
   bun scripts/translate/agent/prepare-glossary.ts --lang=es --limit=1
   bun scripts/translate/agent/assemble-glossary.ts --lang=es
   bun scripts/translate/agent/prepare-glossary.ts --lang=es      # the other batches, in parallel
   ```

2. Second opinions on every key concept and every term below high confidence. A fresh agent does the full method again and never sees the first choice. A different form puts the term on the human list:

   ```sh
   bun scripts/translate/agent/prepare-glossary.ts --lang=es --second
   ```

3. Back-check from the reader's side. A blind reader sees only the target-language forms (numbered, no English) and says what each one suggests. Then a judge compares each reading with the English meaning:

   ```sh
   bun scripts/translate/agent/prepare-backcheck.ts --lang=es
   bun scripts/translate/agent/prepare-backcheck.ts --lang=es --judge
   ```

   Run `assemble-glossary.ts` after each step.

4. Human review. This writes every flagged term with its evidence (meaning, rejected forms, second opinion, blind reading):

   ```sh
   bun scripts/translate/agent/review-glossary.ts --lang=es
   bun scripts/translate/agent/decide-glossary.ts --lang=es --id=<id> --name="<form>" --by=<name> --note="<why>"
   ```

   A decision locks the entry. No later step changes it.

5. Consistency. Batches run in parallel, so related terms can disagree: one English word with two roots ("staff" as "cuerpo" and "personal"), or two different things with one form. Run this after a wave, and before the next wave:

   ```sh
   bun scripts/translate/agent/check-consistency.ts --lang=es     # findings + a packet for a fresh agent
   bun scripts/translate/agent/assemble-consistency.ts --lang=es  # merge its draft
   bun scripts/translate/agent/decide-glossary.ts --lang=es --root=staff --forms="personal" --by=<name> --requeue
   ```

   The reviewer sorts each shared form into "same thing" or "conflict", and proposes one root for each real split. Proposed roots go to `roots.json`, and every later packet shows them at the top. A human decides each root. `--requeue` removes the terms that break it, so the next batch translates them again with the root.

Use a fresh agent for each packet. For the second opinions, a different model gives more independence.

## Translate a paper

1. Prepare the packet:

   ```sh
   bun scripts/translate/agent/prepare-paper.ts --lang=es --paper=1
   ```

2. Give the packet to the translator. For a Claude Code agent, use this prompt:

   > Read `.work/translate/es/main/paper-001.packet.md` and follow it, including its clean-room rules. Translate every paragraph and title. Write the draft JSON to the path that the packet gives.

   Use a fresh agent (not a fork) for each paper.

3. Check the draft and write the seed files:

   ```sh
   bun scripts/translate/agent/assemble-paper.ts --lang=es --paper=1
   ```

   - An error (a missing paragraph, changed span tags, English text, a copy) stops the paper. Fix the draft and run it again.
   - A warning (a term, a number, the length) marks the paragraph `needs_review`. Other paragraphs get `auto_checked`.

4. See the progress and the next papers:

   ```sh
   bun scripts/translate/agent/status.ts --lang=es
   ```

Papers are independent, so agents can work on several papers at the same time. `term-decisions.json` changes when a paper is assembled, so assemble one paper at a time.

## Compare models (bake-off)

1. Prepare a packet for each candidate. The packets are the same, except for the output path:

   ```sh
   bun scripts/translate/agent/prepare-paper.ts --lang=es --papers=1,100,196 --candidate=claude-opus
   bun scripts/translate/agent/prepare-paper.ts --lang=es --papers=1,100,196 --candidate=gpt-6
   ```

2. Each model translates its packets. For a model outside this machine, paste the packet and save the JSON answer at the draft path.
3. Check each candidate with no write: `assemble-paper.ts --lang=es --papers=1,100,196 --candidate=gpt-6`.
4. Write the blind review packets:

   ```sh
   bun scripts/translate/agent/export-review.ts --lang=es --papers=1,100,196 \
     --candidates=claude-opus,claude-sonnet,gpt-6,gemini-flash --reference=book-es --sample=30
   ```

   `--reference` adds an existing edition as one more blind candidate, so the panel compares our text with it. The review shows plain text for every version, so the markup does not show which one is which.

5. Give each `paper-NNN.review.md` to judges from different model families. Each judge writes its JSON answer to `review/judges/<judge-name>/`.
6. Rank the candidates:

   ```sh
   bun scripts/translate/agent/tally-review.ts --lang=es
   ```

   The tally shows each candidate's mean rank with and without judges from its own family, because a model tends to prefer its own family's text. It also writes `disagreements.md` for a human tiebreak.

## Add a language

1. Write `style-guides/<lang>.md`. Decide the variety, the form of address, the pronouns for God, the quotation marks, and the number format.
2. Build the clean glossary for the language (see above).
3. Add a length range for the language in `checks.ts`.

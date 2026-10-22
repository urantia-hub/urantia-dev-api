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

The glossary has 2,162 terms: beings, places, orders, races, religions, and capitalized concepts. Agents translate each one from its English name and description only.

1. Prepare the first batch. It has the 150 terms that the most paragraphs use, so the main choices come first:

   ```sh
   bun scripts/translate/agent/prepare-glossary.ts --lang=es --limit=1
   ```

2. A fresh agent translates the batch. Use this prompt:

   > Read the packet at `<path>` and follow it. Write the JSON to the path that the packet gives. Use only the packet and the urantia.dev MCP server in English.

3. Check and merge it. A Spanish speaker can look at this first batch, because all papers use these terms:

   ```sh
   bun scripts/translate/agent/assemble-glossary.ts --lang=es
   ```

4. Prepare the other batches. Each packet lists the terms already done, so the batches can run at the same time:

   ```sh
   bun scripts/translate/agent/prepare-glossary.ts --lang=es
   ```

5. When all the drafts are in, assemble again. The script lists one-word terms with two forms, for a check.

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

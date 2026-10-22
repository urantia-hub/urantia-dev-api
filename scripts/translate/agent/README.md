# Agent translation workflow

An agent (Claude Code, or any other model) translates one paper at a time from a packet. The scripts here prepare the packet and check the result. They make no model calls and cost nothing.

The English text is public domain and our translations are CC0. A translation must come only from the English. No existing translation goes into a packet. `checks.ts` compares the output with the existing editions on disk only to catch copying.

## Files

| Path | What it holds | In git |
|---|---|---|
| `style-guides/common.md`, `style-guides/<lang>.md` | The rules for every translator | yes |
| `data/translations/<lang>/paragraphs/paper-NNN.json` | Finished paragraphs, read by `seed-paragraph-translations.ts` | yes |
| `data/translations/<lang>/titles.json` | Paper and section titles | yes |
| `data/translations/<lang>/term-decisions.json` | Term forms chosen during translation | yes |
| `.work/translate/<lang>/<candidate>/paper-NNN.packet.md` | The input for one paper | no |
| `.work/translate/<lang>/<candidate>/paper-NNN.draft.json` | The translator's output | no |
| `.work/translate/<lang>/review/` | Blind review packets, the key, and the judges' answers | no |

The `candidate` is `main` for the real translation. Use another name, such as `gpt-6` or `gemini-flash`, for a bake-off.

The source texts live outside the repo, in `../misc/` (the English JSON, and the existing editions for the copy check). In a worktree, set `URANTIA_MISC` to that folder.

## Translate a paper

1. Prepare the packet:

   ```sh
   bun scripts/translate/agent/prepare-paper.ts --lang=es --paper=1
   ```

2. Give the packet to the translator. For a Claude Code agent, use this prompt:

   > Read `.work/translate/es/main/paper-001.packet.md` and follow it. Translate every paragraph and title. Write the draft JSON to the path that the packet gives. Use the urantia.dev MCP server to check the meaning of a term or the context of a paragraph. Do not read any existing Spanish translation of the book.

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
     --candidates=claude-opus,claude-sonnet,gpt-6,gemini-flash --sample=30
   ```

5. Give each `paper-NNN.review.md` to judges from different model families. Each judge writes its JSON answer to `review/judges/<judge-name>/`.
6. Rank the candidates:

   ```sh
   bun scripts/translate/agent/tally-review.ts --lang=es
   ```

   The tally shows each candidate's mean rank with and without judges from its own family, because a model tends to prefer its own family's text. It also writes `disagreements.md` for a human tiebreak.

## Add a language

1. Write `style-guides/<lang>.md`. Decide the variety, the form of address, the pronouns for God, the quotation marks, and the number format.
2. Check that `data/translations/<lang>/entity-translations.json` exists. The glossary comes from it.
3. Add a length range for the language in `checks.ts`.

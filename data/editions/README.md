# Editions of the English text

`variants.json` has one row for each correction that Urantia Foundation adopted to the 1955 text. The
API stores the newest edition (`srt-2024`, the Foundation download 1.22). `src/lib/editions.ts` makes
an older edition from it: it undoes the `text` rows with a year after that edition, newest first.

## Sources (Urantia Foundation only)

| File | SHA-256 |
|---|---|
| https://urantia.org/study/adopted-corrections-1955-text (HTML, read 2026-11-10) | `e799eafa700fcca858cbbefd92c92e35c7f285d309e6fa90bdc30055452160a1` |
| `standardized-reference-text-committee-summary-report-v8.01.pdf` (2009) | `556094bec588dfaff1f38d8637ba81db935d52b9ace64f40e94e57ff7ace0885` |
| `standardized-reference-text-committee-approved-2015.pdf` | `60667b1188098cb4e7858da9d52fbec6f976f1bc152834d3542f392c25ee2cb6` |
| `standardized-reference-text-committee-approved-2018.pdf` | `fe32ae9e7259b36e22ae8a5c71672c2bb8226d23e0913dccfb2092dad0c90080` |
| `standardized-reference-text-committee-approved-2021.pdf` | `776bd651800255201e894532ca79082830a622c9ec49190e550d6355e989ff70` |
| `standardized-reference-text-committee-approved-2024.pdf` | `97dd0ec077669f125e565ea477cd0d37701de68287e23046def5eb9cf53fb22d` |
| `uf-eng-001-1955-1.22-md.zip` (the stored text) | `d12768cd052e4a66699503a866135d81692accbbee51ce10704d96288e3a9b09` |
| `uf-eng-001-1955-21-txt.zip` (Wayback Machine, 2024-07-09) | `45ab8afcb177499e9c14dc18a4a09d38ffcd49aeec267af0456ba4322a7a249b` |

The reports are on https://www.urantia.org/urantia-book/text-standardization-detail.

## A row

- `year`: the report that adopted it. 2009 is the summary report v8.01. `null`: the adopted list has
  it, but no report does (4 rows).
- `kind`: `text` (words or punctuation), `format` (italics only, so the plain text is the same), or
  `printing` (a fault of the printed 1955 book that no electronic text had: 101:3.5, 117:7.4).
- `inStoredText`: false when the Foundation lists the change but download 1.22 still has the 1955
  wording: 58:1.7 (a comma, adopted in 2015) and 119:8.9 (the brackets). The API serves the download.
- `before` and `after` are in the form of the stored text: a space on each side of an em dash.

Two hand fixes are in the generator, each with a `note` in its row: the Badonan row is at 86:5.17
(the page links 84:7.7), and the 119:8.9 row names the opening bracket only.

## Make and check

```
python3 -I scripts/editions/build_variants.py <reports dir> <seed json dir> data/editions/variants.json
bun scripts/editions/check-editions.ts <seed json dir> <January 2024 json dir>
```

`<reports dir>` holds `adopted.html` and each report as text (`pdftotext -layout`). The check on
2026-11-10: each of the 170 `text` rows that the download has is in one place of its paragraph, each
edition builds, and `srt-2021` equals the January 2024 download in all 14,593 paragraphs (26 table
rows differ in white space only, from our seed). The Foundation download 21 (`UF-202303081751`)
also equals `srt-2021` in its words; it differs in format only (small caps, a table, a quote block).

## Not checked yet

- The 1955 wording of each row against the page photos of the first printing (phase 2).
- The editions before 2021 against a download of their time: the Wayback Machine has no older
  English download.

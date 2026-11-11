# Editions of the English text

`variants.json` has one row for each correction that Urantia Foundation adopted to the 1955 text, and
1 row that the full-book check found (27:6.4, `foundBy: "scan"`). The
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
  it, but no report does (4 rows), or no list has it (the 27:6.4 row). Only the 1955 edition undoes a
  `null` row.
- `source`: the list and the report. Both are `null` for the 27:6.4 row.
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
Since 2026-11-11 the check also builds the `htmlText` of each edition and compares it, without its
tags, with the text of that edition (171 text rows, all pass). Only the changed part of a row is
replaced in the HTML, so the markup stays. A `format` row does not change the HTML of an older edition.

## The scan check (phase 2, 2026-11-10)

`scan-check.json` has one result for each row: the 1955 wording against the page photos of the first
printing on archive.org (`TheUrantiaBook1955FirstEdition`, 600 dpi). `scripts/editions/scan_check.py`
gets each page photo, reads it with tesseract, and looks for `before` and `after`. Each row that it
did not settle was read by hand, in the OCR text or in the photo (`crop.py` cuts out the lines).

- 178 rows match the photos: 141 by OCR, 22 by OCR read by hand, 15 by the photo.
- 162:7.2 is not settled: 1955 breaks "bond- / servant" at a line end.
- 196:3.35 is not checked: the scan has no pages 2092 to 2097.

The photos corrected 10 rows. On 8, the Foundation's review line shows wrong 1955 words (an insert
outside its mark, or a dropped apostrophe or space); its quote line and the photo agree. On 2, the
1955 page shows more change than the list records:

- 90:2.9: 1955 reads "Teuskwatowa"; the list quotes "Teuskwatawa" and records one changed letter.
- 167:4.3: 1955 reads "the second, or even the third, day such"; the SRT reads "the second or even
  the third day, such". The list records only the comma after "second".

## The full-book check (2026-11-11)

`full-check.json` has the result of a check of the whole 1955 build against the same scan. The item
has an OCR text of each of its 2 photo sets (600 and 1600 dpi). `scripts/editions/full_compare.py`
aligns the build with each OCR text, and `full_agree.py` keeps the differences that both show.

- 3,415 differences are in both OCR texts. Both texts come from the same photos, so they share
  most misreads. Nearly all are layout (headings, page numbers, list numbers, line-end hyphens) or
  misread letters. 96 punctuation, capital, and word differences were read in the photo.
- The OCR reads the first lines of each paper out of order. Those lines were read again as one
  block with tesseract, and the rest in the photo. All 197 match.
- 1 difference is real: 27:6.4 has no comma after "instruction" in 1955. No list records it. Since
  2026-11-11 it is a row of `variants.json` (from `EXTRA` in `build_variants.py`), so the 1955 edition
  has no comma there.
- 5 marks are not clear: a dot or a tail on a comma or a period. They can be specks.

## Not checked yet

- The editions before 2021 against a download of their time: the Wayback Machine has no older
  English download.

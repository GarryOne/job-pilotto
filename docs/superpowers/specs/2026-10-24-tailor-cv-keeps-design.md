# Tailor CV keeps the original design (24 Oct 2026)

Owner: "Tailor CV is not working well currently. it strips different formats of CV ... the template we build out of this should be 1:1 as the
original in terms of design/style/paging/fonts/spacing... or as close as possible". Sketch approved 24 Oct 2026:
https://claude.ai/artifact/RSrNo4yNof9q9czXX1981p (decisions: edit in place with the template as fallback; reorder + reword, no drops;
full font fallback chain incl. a one-time download of free fonts; DOCX as the next step).

## Why it strips today
The CV is transcribed into cv.json and printed with `desktop/cv/template.js` (Inter, A4, one column, English headings); `lib/cv-look.js`
cuts only the photo, icons, logos and a banner out of the original. Measured on 8 sample PDFs: 13–61/100 (fonts 0% everywhere).

## The design
The tailored CV is the person's own PDF with only the changed text re-set:
1. **Read** (`lib/pdf-edit/read.js`): pdf.js lists every text-show operator of each page with its glyphs (unicode, code, advance), font,
   size, colour and position; small filled shapes (vector bullet markers) too.
2. **Map** (`lib/cv-inplace.js`): each cv.json string (summary, bullets, a role's skills line) is found on the page by its letters (spaces
   ignored), giving its lines; a role's bullets form one block with their markers.
3. **Tailor** (`lib/cv.js`): the same single AI call; in place it gets each item's room in characters and may not drop bullets.
4. **Set** (`lib/pdf-edit/layout.js` + `write.js`): the old show operators are replaced by bare advances (`[-n] TJ`, so anything after
   them on a line stays put) and the new wording is set on the same lines: same left edges, leading, right edge, word gap and letter
   tightness measured from the original, justified when the original is (gap signature), each word keeping its original style (bold,
   colour). A role's bullets are re-stacked in the new order inside the block's lines; markers (text or vector) move with them.
5. **Fit**: an item longer than its lines keeps its original wording (warning in the review). Nothing else moves; page count is fixed.
6. **Letters the subset lacks** (`lib/pdf-edit/fonts.js`): another subset of the same face in the file → the same font installed →
   the same free font downloaded once → a same-width free twin (downloaded once) → keep the original sentence.
7. **Fallback**: a PDF that can't be read this way (no text layer, text in forms, operator counts that don't match) uses the template.
8. **Review**: the tailored pages with the changed lines boxed; the panel keeps every feature of today's review page.

Invariants: never add or remove a page; never change a byte outside the edited show operators and the appended text; the old wording
leaves the file (ATS reads only the new text); no AI call is added.

## Tests (fictional look-alikes, `desktop/test/fixtures/cv-shapes/`)
sidebar (CID TrueType), band (dark header + photo, two columns), french (Type 3 fonts), table (Letter, 2 pages, grey bands),
word-like (simple fonts, justified, 2 pages), latex-like (no space glyphs). Each with a cv.json and a tailoring. Gate per shape:
same page count and size, fonts and sizes 100% of the original's, pixel drift ≤ 3% (≤ 9% LaTeX-like), old text gone, new text present.

## Progress
- [x] Spec + fixtures (fictional look-alikes, cv.json, tailorings) (proof: desktop/test/fixtures/cv-shapes/shapes.json)
- [x] Tests on the six shapes (proof: desktop/test/cv-inplace.test.js)
- [x] Read + lexer + layout + write (pdf-lib), reword in place (proof: desktop/test/pdf-edit.test.js)
- [x] Map cv.json → page lines; bullet blocks re-stacked with markers (proof: desktop/test/cv-inplace.test.js)
- [x] Tailor prompt: room per item, no drops in place (proof: desktop/test/cv-inplace-run.test.js)
- [x] Font fallback chain (installed, download once, same-width twin downloaded once) (proof: desktop/test/pdf-edit-fonts.test.js)
- [x] Wire into Tailor CV with the template fallback; review page on the real pages (proof: desktop/test/cv-inplace-run.test.js)
- [x] Re-measure the 9 real samples on the Mac (local only), before/after to the owner: 8 readable PDFs, real tailoring, 90–100 where texts changed (today's template 13–61); two scored 100 with nothing changed, which led to summaries read per paragraph and the template when nothing is found (proof: desktop/test/cv-inplace.test.js)
- [ ] Next step (separate PR): DOCX in place (owner 24 Oct 2026: edit the .docx in place, its PDF from our own renderer; picking the .docx on form upload is a later PR)
  - [x] lib/docx: read paragraphs, find items, rewrite in each word's own style, reorder bullet paragraphs; made-up Word CVs (proof: desktop/test/docx-edit.test.js)
  - [x] Renderer: a .docx drawn to PDF in the hidden window (docx-preview), office fonts from the same-width twins (proof: desktop/test/docx-render.test.js)
  - [x] LibreOffice add-on (owner 24 Oct 2026: "are we reinventing the wheel?" → LibreOffice, never in the installer, downloaded on use, Mac + Windows): pinned build, SHA-256 checked, unpacked into the data folder; real Mac run 24 s + 10 s per CV; on the real Word sample 2 pages like Word (ours 3) (proof: desktop/test/office.test.js)
  - [x] Download bar on Profile → CV, look approved by the owner (side-by-side, 24 Oct 2026): share, MB, time left, steps, Cancel / Try again (proof: desktop/test/office-progress.test.js)
  - [x] Windows: the real download + msiexec /a (no admin) + conversion, 26 s on a Windows runner, 23 s on Mac (#1760) (proof: .github/workflows/office-addon.yml @0dcd019)
  - [x] Picking a .docx: saved as cv.docx, drawn to cv.pdf, imported as today; accept list in renderer/cv-files.js "PDF or Word" (#1760) (proof: desktop/test/cv-docx.test.js @0dcd019)
  - [x] Tailor: the .docx path (prepare's room from the drawn PDF, edit, draw, review boxes on the drawn pages); PDF in place, then template as fallback; real run on a made-up CV: 18 s, 1 page, boxes on the right lines (proof: desktop/test/cv-docx-tailor.test.js)
  - [ ] Real Word sample re-measured locally (numbers only)

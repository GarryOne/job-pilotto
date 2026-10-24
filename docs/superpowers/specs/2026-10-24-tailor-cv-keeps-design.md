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
   the same free font downloaded once → a bundled same-width twin → keep the original sentence.
7. **Fallback**: a PDF that can't be read this way (no text layer, text in forms, operator counts that don't match) uses the template.
8. **Review**: the tailored pages with the changed lines boxed; the panel keeps every feature of today's review page.

Invariants: never add or remove a page; never change a byte outside the edited show operators and the appended text; the old wording
leaves the file (ATS reads only the new text); no AI call is added.

## Tests (fictional look-alikes, `desktop/test/fixtures/cv-shapes/`)
sidebar (CID TrueType), band (dark header + photo, two columns), french (Type 3 fonts), table (Letter, 2 pages, grey bands),
word-like (simple fonts, justified, 2 pages), latex-like (no space glyphs). Each with a cv.json and a tailoring. Gate per shape:
same page count and size, fonts and sizes 100% of the original's, pixel drift ≤ 3% (≤ 9% LaTeX-like), old text gone, new text present.

## Progress
- [ ] Spec + fixtures (fictional look-alikes, cv.json, tailorings) (proof: none: this commit)
- [ ] Failing tests on today's build (shape gate)
- [ ] Read + lexer + layout + write (pdf-lib), reword in place
- [ ] Map cv.json → page lines; bullet blocks re-stacked with markers
- [ ] Tailor prompt: room per item, no drops in place
- [ ] Font fallback chain (installed, download once, bundled twins)
- [ ] Wire into Tailor CV with the template fallback; review page on the real pages
- [ ] Re-measure the 9 real samples on the Mac (local only), before/after to the owner
- [ ] Next step (separate PR): DOCX in place

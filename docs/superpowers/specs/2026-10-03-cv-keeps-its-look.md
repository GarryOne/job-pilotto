# Tailored CV keeps the look of the person's own CV

**Verdict:** the tailored PDF is rebuilt from text in a generic template, so it loses the photo, contact icons,
employer logos and spacing of the CV the person sent. Settings says "ready · default design". Part 1 (a named final PDF,
the diff marked as a preview) shipped 3 Oct 2026. This is part 2.

## What exists
- `desktop/cv/template.js` already draws `cv.photo`, `link.icon`, `job.logo`, `page.banner` from `cv/assets/`, and reads `cv/style.css`.
- The owner's own design (rebuilt from Figma) lives only in the test profile ("Job Pilotto 2"): `style.css`, `assets/` (photo, logos, icons), and `cv.json` fields `photo`, `links[].icon`, `jobs[].logo`, `layout`.
- `importPdf` (`desktop/lib/cv.js`) sends the PDF to Claude and keeps only text: no images, no layout.

## Build
1. **Extract the images at import.** `pdfjs-dist` (pure JS): walk the page operator list, track the transform, keep each
   painted image with its box on the page; encode PNG with Electron's `nativeImage`. Write to `cv/assets/`.
   No poppler: users do not have it.
2. **Place them by position.** Top right of page 1 = `photo`. A small image left of a job title and level with it = that
   job's `logo` (match by order and y). A small image left of a link text = `links[].icon`. Anything unplaced is dropped, not guessed.
3. **Template.** Use the existing hooks; add a default stylesheet for "photo + icon links + logos" close to the owner's `style.css`
   (sizes in pt, underlined dates, link colour). A CV with no images keeps today's look.
4. **Check.** Render the base CV to PDF, compare page 1 to the original (page count, text positions within a tolerance);
   say "close to your CV" or "different: check the preview" in Settings next to "Read my CV PDF again".
5. **Tests.** Unit: operator list → boxes → placement, on a small fixture PDF with a photo, two logos and two icons. E2E: import the
   fixture, tailor, and check the PDF holds the same images (`pdfimages -list` on the Mac only).

## Data ownership
Images and `cv.json` are caches of the person's PDF (the PDF is on Profile → "📎 CV" in Notion): rebuilt by "Read my CV PDF
again". The tailored PDF goes to Notion as today. No new Notion column.

## Not in scope
Pixel-perfect copies of any design; editing the design in the app; the owner's Figma file.

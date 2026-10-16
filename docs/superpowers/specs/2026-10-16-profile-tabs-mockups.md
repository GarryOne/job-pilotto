# Settings → Profile tabs from the owner's mockups (16 Oct 2026)

**Owner, 16 Oct 2026** (3 mockups: Standard answers, Preferences, Form knowledge; 2 screenshots of today's Notion textareas):
"improve also other tabs UI, by using these mockups. I don't want to see plain textarea anymore. I don't want to see this sign: ❓.
Make sure to support both stores (SQLite and Notion). To be consistent across them. To be consistent with UI across other screens/tabs."

## Decisions
- **One edit path for both stores: block edits, never a whole-page write.** The store page API already has the same calls on both
  (`outline()`, `setText`, `setCell`, `remove`, `insertAfter`, `append`: lib/store/markdown-page.js, lib/store/notion.js). New IPC
  `textOutline(name)` / `textEdit(name, changes)` (lib/text-outline-handlers.js) reads a fresh outline and applies each change only to a
  block it still finds with the text the window read. So Notion is editable in the app too (until now: read-only + "Edit in Notion"),
  and its 📎 CV file, embeds and other blocks are never touched.
- **❓ is data, never shown.** A value starting with ❓ means "not set": the tab says "Not set" (warn pill / "Needs review"), the field is empty,
  the words after ❓ become the field's hint. Saving a value replaces the cell; untouched rows are not written.
- **No textarea.** Values are inputs (one line), selects, segmented buttons or chips; a long free text is a multi-line input only inside an
  expanded row. "Edit as text" is removed from these tabs (the store's page link stays: "Open in Notion" on Notion).
- **One sticky save bar** (the existing `.save-bar`, as "Unsaved changes to your details"): Discard / Save changes, per tab.
- Reused: `.data-table`, `.segmented`, `.chip.removable`, `.switch`, `pill`, `moreButton`, `.select-search`, `.save-bar`, `.summary-head`.
- Not built (no data behind it yet, said in the PR): Form knowledge "Enabled" switch (a disabled note has no format consumers read),
  Standard answers' per-question widgets (country select, authorisation radios): every answer is one value field.

## Progress
- [x] 1. `textOutline` / `textEdit` IPC for the three texts, both stores, demo; tests on markdown-page and a fake Notion page
- [ ] 2. Form knowledge: table (Field / Saved value or rule / Website), expandable row editor, filters (search, websites, types), Add rule, Delete
- [ ] 3. Standard answers: sections with icon + "Some answers are missing", rows (question, value or Not set, Add answer / Edit), filters (search, Needs attention, categories); replaces the read-only "Reusable answers" panel
- [ ] 4. Preferences: section cards (Location & work style, Languages, Roles & employment, Compensation, Other preferences) on the Profile's rows; chips, segmented work modes, selects; both stores through the outline
- [ ] 5. No ❓ and no textarea on any of the three tabs (a test over the rendered tabs), screenshots per tab per store, PR

# Non-form outcomes: when a posting is not applied to through a form (10 Oct 2026)

**Verdict:** one new AI answer, `apply_by`, says how a posting is applied to. Step 1 builds `email` only: the app tells the person "send it to <address>". Nothing is ever sent or opened for them.

## Today (measured 10 Oct 2026)
- The page-kind AI sees title, headings, controls, short button texts. No body text, no hrefs.
- On three email postings (de text, fr mailto, en footer) it answered `posting`, no Apply button, no route. The app showed "The extension can't reach the form"; the address was lost.

## The answer (`desktop/lib/page-kind.js`)
| Field | Values | Meaning |
|---|---|---|
| `apply_by` | `form` · `email` · `other` · `""` | how this page is applied to; `""` = not a posting or not said |
| `apply_email` | an address | only with `email` |

**Later values** (same field, no new mechanism): `phone`, `link` (an external page that is not the form), `login_wall`, `expired`, `in_person`. Each gets its own fixed card text and its own floor; none is built now.

## Who decides what (CLAUDE.md "Judgments about a page")
- **AI:** that the page asks to apply by email, and which address.
- **Structure (finding only):** the extension adds `mails` to the sketch: the sentences (<= 160 characters, at most 3) and link hrefs (`mailto:`) that contain an email address; at most 5 entries. Privacy: the AI now also sees those few sentences, never the body.
- **Floors:** the named address must literally appear in `mails`, else it is dropped, `apply_by` becomes `other` and the drop is logged; no AI = nothing reported; we never send, open a mail app or press Submit; one report per tab and page.

## How it combines with the Apply button and `apply_route`
One decision path, no new one: the extension acts as before (press the Apply button, then the manual route of a start dialog). `apply_by` changes nothing about that.
Only when the page is STILL without a form after those presses does the stuck report say `email` (with the address) instead of `no-form`. So no page that reaches a form today
behaves differently; a page with an address but no way into a form says where to send it. The email answer is about one posting: never kept for the page shape.

## What the app shows
- `application-journey.js`: `STUCK` gets `'email'`; the address is the need (<= 80 characters). The card (session card, sibling style) says **"Send your application to <address>"**.
- `other` (and any value the code does not know) is reported with the page's fingerprint (`shape|build`) and shown as "needs your attention", never dropped silently.
- **Step 2, not built now:** the draft from the application kit (subject, cover letter), the CV named, "Open in my mail app" (mailto), "Copy address", "I sent it".

## Data ownership
Nothing new is stored beyond the application's state (`stuck` + the need on the session). The AI answer is cached per page shape like the other kinds, except an email answer (it names one posting's address). The address lives on the posting page, not in our data.

## Tests
`desktop/test/page-kind.test.js` (answer, floor, caps), `desktop/test/journeys.test.js` (scenario), a recorded page under `desktop/e2e/recorded/`, `npm run real-extension`.

# Read sites: who waits for whom, per-site rows, closed tabs

Owner decision, 7 Oct 2026. Status: to build (the Read sites owner session).

## Verdict
- Every site in a Read sites run has **one visible state**, shown in **the run's detail in Recent activity** (one row per site, like a search's steps)
  and summed up in **the Actions banner**. No new screen, no popup.
- **Applying is not touched** (owner: "critical and much used"). Read sites only *reads* the tab reports the extension already sends.
- A wait on the person is **always said, with the button to press**. A wait on the machine has a short timeout and says what was silent.

## States of one site
| State | Who waits | Row (run detail) | Banner (summary) | Ends when |
|---|---|---|---|---|
| next | nobody | `○ LinkedIn  Next` | — | its turn comes |
| opened | app → extension, ≤ 20 s | `● Indeed  Opening in Chrome…` | `1 of 3 · opening Indeed` | extension reports it saw the tab; else **stopped: "Chrome did not answer: is the extension on? [Check the extension]"** |
| waiting for you | **app + extension → person**, no timeout | `⏸ Indeed  Waiting for you  [Go to Chrome and allow]` | `1 of 3 · waiting for you on Indeed  [Go to Chrome and allow]` | Allow granted, or the person closes the tab / stops the run |
| reading | person → nothing | `● Glassdoor  Reading · page 2 · 14 jobs  [Show tab]` | `2 of 3 · reading Glassdoor · page 2` | done or stopped |
| done | — | `✓ Glassdoor  14 jobs (8 new)` | — | — |
| closed by you | — | `✗ LinkedIn  You closed the tab  [Open again]` | — | at once (no timeout) |
| stopped | — | `✗ Indeed  <what happened, in words>` | — | — |

## Mechanics (reuse, don't duplicate)
- **Tab reports**: the extension already reports its tabs on open, page change, close (`chrome.tabs.onRemoved`) and every 30 s
  (`extension/background.js` reportTabs → `desktop/lib/form-tab.js`). Read sites tabs carry `#jp-read` / `#jp-read-filter`: the app maps a reported tab to
  its site; a site's tab missing from a report → **closed by you**, the next site starts.
- **States from the extension**: one event per change (`/extension/event` type `visit-state`: `{url, state, page, jobs, why}`), next to the
  existing `visit-waiting`. The task tees each change as one plain line (Technical log) and as the `⏳ … N of M` step (banner, `stepWords`).
- **Buttons**: *Go to Chrome and allow* = bring Chrome forward on `allow.html` (open it again if closed). *Show tab* = focus that tab.
  *Open again* = reopen that site's marked URL. *Check the extension* = Settings → Connections → Chrome extension.
- **Words, not data**: rows and banner use words; JSON answers are never shown (`pipeline.isDataLine`, 77b21c8).

## Tests
- A unit test per state transition (opened → waiting → reading → done; opened → silent → stopped; reading → tab closed → closed by you).
- A renderer test that the run detail draws one row per site with its button, and the banner shows the button only while a site waits on the person.
- The `visitsauto` e2e: a waiting site shows the button; closing the tab ends the site at once.

## Data ownership
Nothing new is stored: states live in the running task (`pipeline.running()`), and its kept log and history row (runs.json, ⏱️ Search runs).

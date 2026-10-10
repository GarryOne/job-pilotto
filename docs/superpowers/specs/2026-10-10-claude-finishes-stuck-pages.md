# Claude finishes a stuck page: ask once, where you are (10 Oct 2026)

> **Verdict:** when the extension is stuck, the stuck page's panel offers "Let Claude finish this page" (with "I'll do it myself" and
> "Always let Claude finish when I'm stuck"). The first press is the consent; "always" starts Claude after a visible 5 s countdown. Only
> shown when Claude Code is installed and working. Each takeover teaches the extension a recipe for that page shape. Owner approved 1–5 on 10 Oct 2026.

## The five parts
1. **Asked on the stuck page itself** (the extension's panel), the same three choices on the session card in the app and in the notification:
   `[Let Claude finish this page]` · `I'll do it myself` · `☐ Always let Claude finish when I'm stuck`, and the line "Claude works in this tab and stops before Submit".
2. **The first press is the consent:** one line opens, "Claude will click and type in this tab without asking each step. It never presses Submit. [Continue]";
   Continue stores `settings.claudeConsent` (a timestamp, as today) and starts the takeover.
3. **"Always" = a gentle auto-start:** with `settings.claudeAuto` on, the next stuck page shows "Claude takes over in 5 s · Cancel"; Cancel keeps it manual for this
   page. Settings shows the same switch ("Always let Claude finish when I'm stuck"); it replaces "Show Claude help".
4. **Only when Claude is ready:** the offer exists only when Claude Code is installed and logged in and the AI engine is Claude (`claudeFamily`); otherwise the
   stuck panel offers "Tell me what's needed" and highlights the field (what everyone has). Non-technical users never see Claude (9 Oct concern kept).
5. **Claude teaches the extension:** when a takeover leaves the page filled further, the controls Claude set on that page shape (labels and fixed meanings, never
   values) become recipe candidates through the existing recipe reporter (`lib/recipes`, proposer, 5% canary), so the next install meeting that shape fills it alone.

## Floors (every case)
Never Submit (the apply-to-job skill's floor and the twin's submit guard); never a captcha or bot check; never an SMS code; at most ONE takeover per application
(a session flag); the takeover is visible in the session's terminal; "Let me check each step" mode never auto-starts (only the button).

## What exists and is reused
- Panel button "Take over with Claude": `extension/review.js` (~287 markup, ~385 visibility, ~438 click) → `extension/messages-panel.js` `take-over` event →
  `desktop/lib/server.js` → `takeOverHandler` set in `desktop/lib/apply-handlers.js` (~42). **review.js is frozen at 663 lines** (`tools/file-size.mjs` EXCEPTIONS):
  the new offer goes into its own classic panel script sharing the panel's window object (the `extension/page/*` pattern), and review.js only loses lines.
- Consent: `settings.claudeConsent` (`renderer/claude-help.js` `claudeHelp`, `desktop/main.js` `claudeAllowed`).
- Stuck reports: `desktop/lib/session-flow.js` `stuck()`; its invariant 2 "Claude is offered, never started by itself" changes to: "started by itself only with
  `claudeAuto`, after the panel's visible 5 s countdown" (the owner's call, 10 Oct 2026), with its test.
- Engine family: `renderer/ai-name.js` `claudeFeatures`, `lib/ai/names.js`.

## Data ownership
`settings.claudeConsent` (timestamp) and `settings.claudeAuto` (boolean) are local settings (settings.json), like the assistant mode. Part 5's recipes go through
the existing token-gated pack (labels and fixed meanings only; never a value of the person's).

## Landing order (one push each)
1. Settings + availability + the invariant change: `claudeAuto` (the Settings switch replaces "Show Claude help"), the one "Claude ready" check used everywhere.
2. The panel offer (new classic script, review.js shrinks): three choices, the consent line on first press, the 5 s countdown with Cancel; real-extension check.
3. The app: session card + notification show the same choices; the one-takeover-per-application flag.
4. Teach: a finished takeover's page controls → recipe candidates (proposer), with a test that a second visit of that shape fills without Claude.
5. Docs: CLAUDE.md, the Intelligence page (if the AI's role changes), Decision Log (replaces 9 Oct "hidden, off by default" and 8 Oct "never started by itself").

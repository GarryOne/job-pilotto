# Offline app workflow scenarios

Exercise user journeys across the real preload, checked session IPC registrations, launcher, terminal
backend, persistence, lifecycle callbacks and renderer state/cache helpers. External terminals, dialog
choices, browser replies and Notion responses are controlled; no AI spending or live services.

Session registration is moved unchanged from main.js to lib/session-handlers.js with injected services.
The production app calls this same registration function. Input and output still use session contracts.

Coverage: start/question/answer/review without submission, working and waiting restart/resume, consent
denial, duplicate resume, startup reconciliation, cancelled and confirmed cancellation, failed Notion reset,
review-close decisions, and quit now/when done/cancel plus session-only keep/stop.

Data ownership: no new product storage or Notion fields. Temporary fictional sessions and transcripts are
removed on teardown. The suite is included in desktop npm test, CI and the shared fast checker;
npm run test:scenarios stages dependencies and runs it alone.

Limits: these are offline integration tests. They do not launch a graphical Electron window or Chrome,
exercise renderer DOM click handlers, make real network requests, or assert live provider compatibility.
Demo smoke rendering remains required for screen changes.

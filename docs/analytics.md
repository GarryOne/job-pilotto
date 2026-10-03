# Crash reports and usage steps

**Verdict:** errors go to Sentry, steps go to PostHog, both only from an installed build with Technical reports on. No SDKs: the app builds
each event itself, so only the fields below leave the computer.

| | Sentry (crashes) | PostHog (steps) |
|---|---|---|
| Code | `desktop/lib/sentry.js`, engine: `src/crash_reporting.py` | `desktop/lib/analytics.js` |
| Where | `config/analytics.json` → `sentry_dsn` (EU region, `de.sentry.io`) | `posthog_key`, `posthog_host` (EU) |
| Sends | error type, scrubbed message, frames (file, function, line), version, platform, install id, run id; native crashes as minidumps | event name from a fixed list + flags/numbers/short words; install id; no person profile, no IP location |
| Never | local variables, request data, breadcrumbs, CV, answers, mail, jobs, companies, paths | text a person wrote, screen, keystrokes, autocapture |
| Off when | dev copy (`npm start`), demo, CI, Technical reports off, no DSN/key | same |

- DSN and project key are public by design (they only let a client send events): they live in the public repo's config.
- Env overrides: `JOB_PILOTTO_SENTRY_DSN`, `JOB_PILOTTO_POSTHOG_KEY`, `JOB_PILOTTO_POSTHOG_HOST`.
- What the app records for itself (`telemetry.record`: crash, run_failed, run_warning, stuck) is also sent to Sentry, deduplicated (one per problem per 10 min, 30 an hour).
- The engine gets `JOB_PILOTTO_SENTRY_DSN` only when reports are on, and reports unhandled exceptions.
- Events (PostHog): app_start, page_view, setup_step, search_done, first_search_done, kit_prepared, apply_started, applied, feedback_sent.
- Our own telemetry (`site/src/telemetry.js`) stays: health, the setup funnel, form and control learning data, GitHub triage.

## Beta-tester extras (2 Oct 2026; tied to the beta since 0.5, 3 Oct)
- **Trail:** every Sentry report carries the last 25 step names (the PostHog event names and page names), so "what was the user doing" is on the report.
- **Run log, beta testers only:** Settings → Technical reports shows "Beta tester…" only when the beta is on (Settings → Diagnostics → Beta); off until switched on (setting `testerLogs`; an earlier `alphaLogs` choice still counts).
  A failed or hung run then attaches the last 200 lines of `logs/engine.log` (scrubbed per line, 40 KB max) to its Sentry report. Never to our own telemetry store.
- **Everyone else:** a person on stable never sees the switch, so their app has no way to send logs.

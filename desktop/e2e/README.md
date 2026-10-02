# End-to-end journey

A new user goes through the **real** Job Pilotto app: the setup wizard, then a jobs check and the scores. Playwright
drives the Electron app on a throwaway profile (`JOB_PILOTTO_USER_DATA` = a fresh temp folder; nothing of yours is touched).

```
cd desktop/e2e && npm install
node journey.mjs                      # offline steps only
E2E_ANTHROPIC_KEY=sk-ant-… E2E_NOTION_TOKEN=ntn_… node journey.mjs   # the whole journey
```

## What is real, what is faked
| Part | How |
|---|---|
| Wizard, settings, CV upload | the real UI; the native file dialog is replaced (`pickFile`) |
| Notion | real, in a **dedicated test workspace**: an empty page "Job Pilotto E2E" and a connection that sees only it |
| AI | real, Haiku for every step (cheap: about $0.25–0.40 a run) |
| Jobs and employers | local fixture feeds (live feeds change daily and would make the test flaky) |
| Gmail | skipped (a mock of the Google endpoints may come later) |
| Apply | the real extension on a local fixture form; Submit must never be clicked |

## Secrets
- `E2E_ANTHROPIC_KEY`: a dedicated Anthropic key with a small monthly spend limit.
- `E2E_NOTION_TOKEN`: the test connection's token. Never use your own Notion.
Both live in GitHub (Settings → Secrets → Actions) and, for local runs, in the macOS Keychain
(`job-pilotto.e2e.anthropic_key`, `job-pilotto.e2e.notion_token`). Never in code.

## Files
`journey.mjs` the steps · `lib/app.mjs` launch, close, file picker · `fixtures/cv.pdf` a fictional CV (`make-cv.py` rewrites it)

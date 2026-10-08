# A closer look when the text sketch is not enough (spec, for the owner's yes or no)

**Verdict:** build it small and opt-in. The AI judges (page kind, account step, "ready?", "what became of it?") read a **text sketch** and cover most pages.
When the AI is unsure twice, or a flow stalls, ask **once more with a picture**, get **one action from a fixed list**, validate it, and **remember the result per page shape**
so the next visit costs nothing. Off by default until the owner turns it on. (Owner, 8 Oct 2026: "universal: any website, any form, any language, AI decides".)

## When it triggers (never otherwise)
| Trigger | Example |
|---|---|
| A judge says `unsure` twice on the same page state | a custom widget the sketch cannot describe |
| A flow stalls: nothing changed for 20 s although a step is expected (the live observer's stall rule) | a page that loads its form late, in a frame |
| The extension was told to press a control it cannot find | the AI named "Anmelden", the page redraws it |

## What is sent
- A **screenshot of the visible part of the page, typed values hidden** (before the capture the extension makes every input's text transparent, so labels and layout stay and the person's name, email and answers do not). JPEG, at most 1280 px wide.
- The **text sketch** we already send (controls and their state, buttons, the page's short texts, frame hosts), and the question.
- Nothing else: no cookies, no URL query, no Notion data.

## What comes back: one action from a fixed list
`click <control>` · `fill <control> with <detail key>` · `choose <option> in <control>` · `wait` · `ask the person`.
The control must be one the page lists (same validation as today: a control the page does not show is dropped). One action, then the page is looked at again; at most 3 actions per page.

## Floors (the AI cannot lift them)
- Never an application's **Submit**; never a consent on an application; never a payment page; a bot check is the person's.
- Account steps keep the `accountAutomation` setting (full or assist).
- Built 9 Oct 2026: `fill` (a listed, empty text box + one of email/first_name/last_name/full_name/phone; the value comes from Your details in the app and goes only to the extension, never to the model or the log; never a password) and `choose` (a listed native dropdown + one of its own options; custom dropdowns are not operated, the person is asked). Both only under `full`; `assist` asks the person. One action per look (2 looks per page shape); `extension/account-act.js`, guards `escalate.test.js`, `escalation-value.test.js`, `account-act.test.js`.
- One press per control per tab, remembered by the extension (a reload must not repeat it). Page text and picture text are **untrusted**: only the fixed answers are read.

## Learning (so it is paid once)
The action list that worked is kept per page shape (`host/path shape`) like the page kind and the recipes: local first; shared only as counts or public form wording through the existing token-gated pack
(k>=3, validators on both ends, no second delivery path: "public skeleton, private learned layer"). The next visit uses the remembered recipe with **no picture and no AI call**.

## Cost and limits
- One picture is about 1.5k tokens: roughly 1 cent on the API with a strong model; on a Claude Code subscription it costs plan usage, not money.
- Caps: 2 escalations per page shape per day, 10 per day in total (a setting), then "ask the person".
- Latency: 5-25 s per escalation (the `claude` command starts cold); a remembered recipe is instant.

## Where it lives
| Piece | File |
|---|---|
| Capture + value hiding (injected) | `extension/page-picture.js` (new) |
| The escalation call, caps, action execution | `extension/escalate.js` (new) |
| The model question + validation | `desktop/lib/escalate.js`, route `/extension/escalate` (new) |
| Remembered recipe per page shape | `desktop/lib/page-kind.js` cache (a `recipe` field) |
| Switch | Settings > Profile > Application assistant, next to the account switch |

## Data ownership
The picture is never stored (kept in memory for the call). The recipe is a cache of what worked (rebuildable, no user data). The switch and the caps are settings (Mac), as `accountAutomation` is.

## Decisions needed from the owner
1. **Default:** off until you turn it on (recommended), or on?
2. **Where first:** account pages only, or account pages and application forms?
3. **Model:** the strongest available for the picture call (recommended; rare, so cost is small) or the same fast model as the judges?
4. **Caps:** 2 per page shape per day and 10 per day: right?

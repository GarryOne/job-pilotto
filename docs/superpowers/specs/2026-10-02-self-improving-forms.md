# Self-improving form filling

The design lives in Notion ("Self-improving form filling: design & plan", under Technical Reference). In short: stop adding
a special case per website; read any form as a neutral list of questions, operate controls by behaviour with a verified
result, and turn every miss into a reusable recipe keyed by the control's structural fingerprint.

## Step 1 (this change): capture and fingerprint
- `extension/page/skeleton.js`: a control's skeleton (tags, roles, aria flags, class words; no text, values or ids) and its
  fingerprint; finds widgets that are not native inputs (switch, radio group, custom select, pressable groups).
- `extension/review.js`: widgets the panel's field list does not contain are sent once per page (`misses`).
- `desktop/lib/misses.js`: one entry per fingerprint on this Mac (`misses.json`): kind, skeleton, questions, hosts, count.
  Capped at 200 entries and 30 days. Nothing is sent anywhere. No behaviour for the user changes.

## Data ownership
- Notion: the user's answers and details (unchanged).
- This Mac: `misses.json`, a cache that can be deleted and is rebuilt as forms are visited.
- Nothing about users is stored on our servers by this step.

## Next steps
Neutral form model and generic operators; meaning-based label matching; recipe store with a live-tested AI step; shared
recipe library with replay checks; weekly improvement loop.

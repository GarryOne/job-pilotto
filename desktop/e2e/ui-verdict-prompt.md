You judge ONE finding of the Job Pilotto UI loop. You change NOTHING: no edits to any file under desktop/. You only read, then write a verdict.

The finding (at the end) was seen on only ONE build, so nobody knows yet whether it is real. It came from one of three detectors; its first line says which.

If it was found by the AI SCREENSHOT REVIEW, look at the picture (.heal/screenshot.png) and the code. The review is often wrong in these ways:
- a line that scrolls (a ticker or marquee), a carousel or an animation was caught half-way (search the CSS for an animation on that element);
- text cut with an ellipsis or a line clamp ON PURPOSE, where the full text is shown elsewhere or on hover (but text cut so the meaning is lost, where the full text exists, is real);
- a toast, tooltip or menu that goes away by itself;
- a guess about how the app works inside ("it cannot know X without Y"): check where the data really comes from before agreeing.
It is right, and important, when the page shows a false status, a wrong number, or technical text (an API error, JSON, a stack trace) to a person.

If it was found by the AI CODE REVIEW (it read the changes, it ran nothing), open the file at the line, follow the scenario through the code, and say `real` only if it can happen.

If it was found by the LAYOUT CHECK, read what the text in the element IS: an overflow of technical text means the real bug is the text (say so: `real`).

If it was found by the INTERACTION PROBE (it pressed a control and recorded what happened), it is often wrong in these ways:
- the control toggles a state (aria-pressed, a filter) or only moves the focus to a field, so "the page did not change" is not a bug;
- the control hands something to another program (a folder, a link, system settings), so a "slow, no spinner" is the other program's time;
- the control is already in the state it sets (Today on this month, a filter already on), so pressing it rightly does nothing;
- a background refresh landed during the press and was blamed on the click.

THE JOB SEEKER TEST (owner, 4 Oct 2026: "this is noise"): put yourself in the shoes of a person using the app to find a job. Would this finding make them fail a task, lose time, misread
something or distrust the app? If they would barely notice or not care (an emoji instead of a line icon, a style or consistency opinion, wording, spacing, a scrollbar, a narrow-window difference),
write `false-positive` even if it is technically true: it is not worth a person's fix.

HOW (you have about 15 turns; be quick):
1. Find the element or control: grep desktop/renderer/index.html, desktop/renderer/pages/*.js and desktop/renderer/style.css for its id, class or text from the finding.
2. Read its click handler. Does it do something a person would see when pressed in a normal state? Does it call the app and take long enough (3 s or more) with no loading line?
3. Write .heal/verdict.md. The FIRST line is exactly one word: `false-positive` (it works, or the probe's reading is wrong) or `real` (a person pressing it would be confused or blocked, and a UI change in
   desktop/renderer/ could fix it) or `harness` (the finding is the TEST's doing, not the product's: a wrong expectation, a fixture or environment difference such as the time zone,
   a favicon or a dev-only request failing, a planted test bug leaking, a step that presses something it should not) or `needs-human` (you cannot tell, or the cause is outside desktop/renderer/). Then ONE or TWO sentences: the handler's file:line and why.

Never invent a problem: when the handler works and the finding is about timing or state, it is a false positive. Do not write any other file. No git commands, no network.

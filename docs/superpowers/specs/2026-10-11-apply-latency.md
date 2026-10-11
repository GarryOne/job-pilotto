# Apply latency: from pressing Apply to a filled form

Owner's go 11 Oct 2026 ("Do 1-5"): cut a real user's wait from Apply to a filled form (~42 s live on a Recruitee one-page form) to ~15-20 s, same answers.
Extended by the owner in this window (11 Oct 2026, ~06:35): A journey headline, E known fields first, D parallel questions, C faster model per question type, B change 3 per question type. Measure each landing before -> after; the ladder score guards answer quality.

## Progress

### 1. Page questions jump the AI queue
- [x] page lane in the CLI slots, one slot kept for it; every extension AI route uses it (72e6105)
- [x] measured: page ask behind 2 side asks 13.6/17.2 s -> 3.2/3.6 s (72e6105)

### 2. Pre-started claude processes
- [x] one pre-started process per question (stream-json), never reused, capped, idle-killed (c8b77fd)
- [x] measured: a page's 3 questions on pages 2-3 20.9/25.5 s -> 15.3/14.4 s (c8b77fd)
- [x] ladder score shows the stream-json path answers like the plain path (live, 132 fixtures: real 53/61 vs 54/61, wrong-confident 4 vs 4; c8b77fd)

### 3. Leaner call
- [x] measured: --json-schema costs ~2.3 s per page-kind ask (5.8 -> 3.5 s with the schema in the prompt; measured, not landed)
- [x] ladder score: the schema in the prompt is no worse than the native schema, or the change is dropped (DROPPED: wrong-confident 7 vs 4, rebuilt dialogs 10/13 vs 13/13, 3 account-ready judges exact -> miss)

### 4. Fewer questions in a row
- [x] the digest's "which button" answer is ready when the page-kind answer is unsure (built, measured, DROPPED: on the live Recruitee runs the unsure answer named the Apply button and the extension pressed it without a digest, so the early digest was a wasted call competing with the real ones)
- [x] fill while the "is it ready?" judge runs (not needed: the judge already runs beside the fill, live log 11 Oct 2026; nothing on the path to save)
- [x] measured before -> after on the replay (see 4a: no early digest is used on the measured rows)

### 5. Event-driven waits in the extension
- [x] consider/formAfterPress and the account step wait for a still page (0.5 s), never past the old fixed wait; late-form look unchanged (this commit)
- [x] measured before -> after on the replay: the first page ask goes out at 0.8 s instead of 1.8 s in every run (this commit)

### 6. The result
- [x] Apply -> fill reported, before and after, on the saved page (offline replay, real binary, 3 runs each): median 11.6 s -> 8.6 s (this commit)
- [x] live journey on the same row (posting -> Apply -> form, side work on, real binary, 3 runs each): median 20.2 s -> 20.9 s, within noise; the ~20 s are 3 serial AI questions (~6.5 + ~5.5 + ~4.5 s) and the page load (this commit)

### 7. Known fields first (E)
- [x] the fields the profile knows (name, email, phone, address) are filled before any AI answer; "first field filled" reported beside "fill done" (this commit)
- [x] measured before -> after (first field, fill done): offline, saved Recruitee form, 3 runs each: fill done median 5.6 s -> 5.6 s; first fields = fill done, because D already brings the answers (4.3 s) before page kind (6.8 s); E pays when the answers take longer than page kind (long forms) (this commit)

### 8. Independent questions in parallel (D)
- [x] questions that do not need each other's answer are asked together (flow core claimed, invariants kept): the form's answers beside its page-kind ask (this commit)
- [x] measured before -> after: offline replay, saved Recruitee form, real binary, 3 runs each: fill done median 10.1 s -> 6.1 s (this commit)

### 9. A faster model per question type (C)
- [x] per question type, the faster model on the plan path scored on the 132 fixtures (nothing to score: page kind and the judges already run on the smallest model, Haiku 5.5, low effort)
- [x] landed only for the types that pass; measured before -> after (no faster model exists for these types; the form answers use Sonnet 5.5, outside C, raised with the owner)

### 10. Leaner call per question type (B)
- [x] the change 3 result broken down per question type: account ready 4/0 and account result 1/0 (misses / wrong-confident) vs 0/0 native: they stay strict; form step even; page kind 4/7 vs 11/3-4 (this commit)
- [x] the faster format only for types with no loss (tuned prompt, strict re-ask on unsure or invalid); scored and measured: page kind fast-first (strict re-ask below 0.85 or invalid), 132 fixtures live: misses 6, wrong-confident 4 vs native 9-12 / 3-4; page kind 5.6 s -> 3.2 s mean on the recorded Recruitee asks (this commit)

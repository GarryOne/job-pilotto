# A fix round: how the coordinator runs one (owner, 11 Oct 2026)

A round = several sessions fixing the applying flow's failing pool rows. Judged by ONE number: **rows "Confirmed" on `/admin/applying`** (a pool run
cleared them), per hour. 11 Oct 2026: ~3 h, 6+ sessions, 2 rows confirmed; 75 of 131 commits were tooling, and the coordinator had told the owner
the wrong cause for the waiting ([why.md](why.md)).

## Start of a round (the coordinator, in this order, a few minutes)
1. **The Mac first:** `uptime`, `sysctl vm.swapusage`. Swap over ~70% or load far above the core count: it is memory, not CPU (11 Oct: UTM 3 GB + 8
   sessions ~2.5 GB, load 31). Ask the owner to quit the VM; list the finished sessions they can close (each ~400 MB). Do not add parallel runs on a swapping Mac.
2. **Read the By cause tab** (`/admin/applying`, or `node tools/needs-fix-causes.mjs --rows`). Rows in **Run first** (never run, or no run since their fix)
   go to the pool owner for a run BEFORE any fixer starts: 10 of 29 rows were never-run shapes, not failures.
3. **Weigh by real demand before choosing a cause** (owner, 11 Oct 2026): `/admin/applying`'s scorecard gives each platform's share of users' matched jobs
   ("Of matched jobs"; 11 Oct: Greenhouse 55%, Ashby 34%, everything else 0-3%). A cause on a 0-3% platform waits unless its fix is generic and cheap; a
   platform with a high share and a low real fill ("Blind spot": Ashby real forms filled 57%) comes first even when no pool row is red. Success of the round
   is also the real-use fill share of the big platforms, not only pool rows confirmed.
3. **One session per cause** (the biggest unclaimed), not per row. The brief says its target: "rows of this cause confirmed by a pool run", and the
   owner pastes it into a NEW session (the paste is the owner's approval; a message to a running session waits for the owner in that window).
4. **Fixers do not queue for runs.** They hand the pool owner "run shape X on build Y" and go idle; the pool owner runs, then sends reached + filled/left.
5. **No new tooling during the round.** A gap goes on a list for after, unless it blocks the fix itself (then say so to the owner).

## During
- **Before telling the owner why something is slow or broken, measure it** (swap, load, the lock's holder, one log). 11 Oct: "the shared Notion test page"
  was asserted without opening one run log; 59 of 59 logs said sqlite. A wrong cause cost a brief and an hour of belief.
- **A worktree name is not an owner:** before telling a session to cancel, change or wait because of a run, a lock waiter or a claim, name the session that owns that pid
  (parent pids -> `~/.claude/sessions/<pid>.json`; `node tools/round-status.mjs` prints it). 11 Oct: a run in worktree `fix-combobox-state` was blamed on the wrong session.
- Report confirmed rows per hour, and what each waiting session waits for (one line each).
- A finished session says "done" and the coordinator tells the owner it can be closed.

## End of a round
Confirmed rows before -> after; the lessons, each in its strongest form ([knowledge.md](knowledge.md)); the list of gaps for the next tooling slot.

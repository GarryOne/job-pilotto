# Rename the repos and folders to jobadabra (rebrand step 5)

Owner, 24 Oct 2026: "Let's rename local projects and github repos from job-pilotto to jobadabra. Also, "jobpilotto-site" should be "jobpilotto-web"."
Later: internal → **jobadabra-lab**; "the `job-pilotto-internal` should be `jobadabra-personal-always-on`" (meant: `job-pilotto-private`, confirmed).
Sketch the owner approved: https://claude.ai/artifact/ALtX7YbTmBskKK4ZP585Ny

## Facts proved (24 Oct 2026, throwaway repos rename-proof-a/b)
- A renamed repo's workflow `uses:` is **refused** by its old name ("workflow was not found"); the new name works.
- Through the old name: checkout, git, API GET (301), API POST/PUT (307, followed by Node fetch and gh), release download: all work.
- A GitHub App installation token by a repo's **old** name answers 422; the installation keeps the repo by id.
- Users' Always-on repos call `GarryOne/job-pilotto/.github/workflows/*.yml@desktop-vX`, rewritten by the app at each start.

## Decisions (owner, 24 Oct 2026)
- Engine repo in two phases: an app release that follows the engine's real name, then the rename once installs run it.
- Starter template keeps its name. The user's repo: new ones are `jobadabra-personal-always-on`, old ones are still found.
- Old local paths stay as symlinks for 2 weeks.
- Internal names stay (data folder, appId, Keychain `job-pilotto.*`, `JOB_PILOTTO_*`, packages, Workers, API hosts).

## Progress
- [x] Proof on throwaway repos (proof: none: rename-proof-b run 40041146809 green before, dispatch refused after, 40041277106 green on the new name)
- [ ] Delete the throwaway repos (owner said yes; `gh` needs the delete_repo scope)
- [x] GitHub: job-pilotto-site → jobadabra-web, job-pilotto-internal → jobadabra-lab, job-pilotto-bakeoff → jobadabra-bakeoff (proof: none: `gh api repos/GarryOne/job-pilotto-site` answers GarryOne/jobadabra-web, same for the other two)
- [x] GitHub: owner's job-pilotto-private → jobadabra-personal-always-on (proof: none: App token by the old name 422, by the new name 201)
- [x] CI App `repositories:` lines on the new lab name (proof: none: public #1726 and jobadabra-web#41 merged)
- [x] Engine phase 1: `lib/engine-repo.js` follows the real name (start + every 6 h), both user-repo names found, CI checks by owner (proof: none: #1732 merged, in desktop-v0.8.17+)
- [ ] Phase 1 released and promoted to stable
- [x] Local move window (all sessions closed): folders, worktrees, .venv, hooks, jpc, auto-pull, Claude project key, symlinks (proof: none: move-local.sh --go ran 24 Oct 02:21Z; ~/jobadabra clean on main, 583 worktrees, 0 prunable, .venv ok)
- [ ] Follow-up name PRs: public (tools/docs → jobadabra-lab/-web), jobadabra-web, jobadabra-lab
- [x] Gate: SKIPPED by the owner ("Rename now"): 6 active installs, none on 0.8.17+; stable promotion closes the gap (proof: none: telemetry query 24 Oct)
- [x] Rename GarryOne/job-pilotto → GarryOne/jobadabra (owner yes 24 Oct), templates/updater/tools on the new name in this PR (proof: none: API by the old name 301 → GarryOne/jobadabra; website Mac/Windows downloads 200 with the release sizes)
- [ ] Verify: an app update, a private repo's daily run, CI green on all repos, `jpc` in ~/jobadabra with its memory
- [ ] Remove the old-path symlinks (2 weeks after the move)

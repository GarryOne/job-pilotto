# Help the pool grow: opt-in employer contributions (30 Sep 2026)

**Verdict:** an install may, only if its user switches it on, tell the central pool which employer career pages it
uses, tagged with coarse categories, so the pool grows and can later recommend feeds to newcomers like them.

## What is sent (exactly; Settings → "See what would be sent" prints it)
`POST /api/contribute`, at most once a day per install:
`{v, install, roles[], regions[], feeds[{ats, slug, company, matched, own}]}`
- `install`: the random id already used by technical reports (no name, e-mail, Notion or GitHub identity).
- `roles`, `regions`: from fixed lists (below), derived from the user's own search settings. Never free text.
- `feeds`: public facts only. `matched` = this crawl found a job for the user there; `own` = the user added it themselves.

## What is never sent
Jobs, applications, CV, profile, answers, salaries, Notion content, keys, e-mail, company *of the user*, search text.

## Tags (fixed enums)
- roles: `software`, `sre_devops`, `data`, `security`, `mobile`, `qa`, `management`, `other`
- regions: `europe`, `north_america`, `latin_america`, `asia_pacific`, `middle_east_africa`, `remote`
- No seniority in v1 (no field for it that isn't free text).

## Server
- D1 table `contributions` (install hashed with `STATS_SALT`, feed, flags, roles, regions, day); 90 days, then dropped.
- One accepted submission per install per 12 h; ≤ 500 feeds; unknown ATS / bad slugs refused.
- `GET /api/contributions` (Bearer `INDEX_PUBLISH_KEY`): per feed, distinct installs, matched installs, own installs and
  counts of roles / regions among matched installs. Nobody else can read it.

## Central scout
- A feed is a *candidate* when ≥ 2 different installs sent it. It is **re-fetched by the scout itself**; a feed that doesn't
  answer or isn't a real career page never enters the pool. A submission alone proves nothing.
- A `fits` tag (role / region) is published in the index only when **≥ 5 different installs** matched that feed for it.

## Data ownership
- Notion stays the source of truth for everything of the user's. Contributions are **product data on our server**, derived
  from public facts plus two coarse tags, kept 90 days; the app keeps only the on/off switch (`settings.shareEmployers`,
  default **off**) and the date of the last send (a cache).
- The opt-in is the only way anything is sent; off = nothing leaves the Mac or the user's GitHub runs.
- Always-on runs read the same choice from repository variables the app sets (`JOB_PILOTTO_SHARE_EMPLOYERS`, `JOB_PILOTTO_INSTALL_ID`).

## Words
Settings card: "Help the pool grow". Privacy page: one plain paragraph. Landing: the pool line says nothing goes up unless the user opts in.

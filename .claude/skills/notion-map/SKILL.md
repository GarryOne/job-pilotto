---
name: notion-map
description: Map of the SRE Watch Notion workspace (page and database IDs, what lives where). Use at the start of a fresh session, or whenever you need to find or link a specific Notion page/database without searching from scratch. Structural reference only — for the project's current state, open the Session Handoff page listed below first.
---

# SRE Watch — Notion structure

IDs below are stable (Notion page/database IDs don't change on rename or move); titles can drift.
If a fetch 404s or the title looks wrong, `notion-search` for the title and update this file.

**First move in a fresh session:** fetch **Session Handoff** below — it has current state, open
threads and gotchas that this file doesn't try to duplicate. This file is the map; that page is
the state.

## Hierarchy

```
Switzerland Job Search — Project Hub (3e462be8fd86816ebef1c94a62a56c20)
├── 1 · Job Search (3e562be8fd8681439762d07ec7042f7b)
│   ├── Applications — Job Tracker [database] (f56b68942d3b43cbb85a7b1ebfe2df1b)
│   ├── Job Matches — AI Scored [database] (2d8077c592fd45db8d6d5c8e2eea75cb)
│   ├── Employers & Sources [database] (c7fe8570c2ff414086ae9bb1ee2dbf64)
│   ├── Profile — CV and Preferences (3e562be8fd8681579078d09829921b8c)
│   ├── Application Answers — Standard Form Fields (3e562be8fd868108ae38d1f47d52a811)
│   └── Application Strategy — Decision and Automation Map (3e562be8fd8681e68244d641a0a200e1)
├── 2 · System & Architecture (3e562be8fd8681d89bd9e618ff7ea048)
│   ├── Technical Reference — Implementation (3e562be8fd868124a28ee7c044dc83dc)
│   ├── Decision Log [database] (e4d099e66ee84f728d640d225f253210)
│   ├── AI Roadmap — Stages 1 to 5 (3e562be8fd86819d882cd6e7b94bef9b)
│   └── Archive (old Source Registry [database], 319f2372dd8649699415b672d3111d4c — not read by code)
├── 3 · Progress (3e562be8fd86814baa1bd914ae8f8c69)
│   ├── Rollout — 1% to 100% [database] (6051151f0cc34c00b02007d467d92ba6)
│   ├── Rollout Guide — Acceptance Gates and Next Sprint (3e462be8fd8681eb914ee988de2c8e5a)
│   ├── Run Log (3e462be8fd868196b353cd0f0886ce57)
│   └── Costs — Spending and Free-Tier Limits (3e562be8fd868106bb17d4bea0723fce)
├── 4 · Productization — Setup Guide, User Guide (IDs not yet captured here; notion-search
│   "Productization" or fetch the Hub, which links its children)
└── Session Handoff — Start Here (for Claude) (3e562be8fd8681af9a4dd8732964fd94)
```

## Quick lookup — which page for which need

| Need | Page/database |
|---|---|
| Resuming a session, current state, open threads, gotchas | Session Handoff (`...8fd94`) |
| How the pipeline works (modules, modes, AI stages, kit, feeds) | Technical Reference (`...dc83dc`) |
| Why a decision was made, alternatives rejected | Decision Log database (`e4d099e6...`) |
| Dated history of every change, commit references | Run Log (`...86ce57`) |
| Milestone status, what's Done vs In progress, key numbers | 3 · Progress (`...ae8f8c69`) + Rollout database |
| Candidate's real facts the scorer/kit drafts against | Profile — CV and Preferences (`...9921b8c`) — editing it re-scores every open job |
| Standard form answers (permit, notice, sponsorship, style) | Application Answers (`...868108`) — editing it does NOT re-score |
| Why/how much to automate applying, what's built vs planned | Application Strategy — Decision and Automation Map (`...a0a200e1`) |
| One applied/saved/dismissed job's record + its kit | Applications — Job Tracker database, query by Job URL |
| A scored job's fit/tier/reason for browsing | Job Matches — AI Scored database |
| Which employer feeds are crawled, ATS, quality | Employers & Sources database |
| AI Roadmap (stage 3/4/5 plans: drafts, follow-ups, chat) | AI Roadmap (`...4bef9b`) |
| Spend so far, free-tier headroom | Costs (`...23fce`) |

## Databases — data source IDs (for `notion-query-data-sources`)

| Database | Page/database ID | Data source (`collection://...`) |
|---|---|---|
| Applications — Job Tracker | `f56b68942d3b43cbb85a7b1ebfe2df1b` | `346d7756-bafc-4dff-881f-2710819d90da` |
| Decision Log | `e4d099e66ee84f728d640d225f253210` | `6a43dcab-8e47-4d5c-99cc-a6c3ac59c4ee` |

Other databases (Job Matches, Employers & Sources, Rollout) haven't had their data-source ID
captured here yet — fetch the database URL once and add it when you need to SQL-query one.

## Conventions worth knowing before editing

- Notion tables in page content render as HTML (`<table><tr><td>`) in `update_content`;
  `replace_content` is simpler for a full-page rewrite but must keep any child `<page>`/`<database>`
  tags or they're deleted from the page.
- Write real Unicode in `content`/`new_str` (not `\uXXXX` escapes) — JSON-typed parameters
  (`content_updates`, `properties`) decode escapes fine, string parameters don't always.
- The application kit lives inside a **toggle heading** (`📝 Application kit`) on each Applications
  row, with a JSON code block nested one level deeper — `page_text()` won't see it (it only reads
  top-level children); use `Tracker.read_kit(page_id, heading_text)` instead.

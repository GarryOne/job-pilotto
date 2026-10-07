# Job Pilotto website

Static pages in `public/` (no build step), served by Cloudflare Workers static assets (free, `*.workers.dev`):

- `index.html`: the landing page (how it works, every feature, screenshots, setup, pricing, FAQ)
- `compare.html`: Job Pilotto side by side with Simplify, Teal, Huntr, JobCopilot and LazyApply, from
  each product's own website (dated on the page; re-check before changing a row)
- `styles.css`: shared by both pages

`src/index.js` adds one endpoint, `POST /api/waitlist`, which keeps Pro early-access sign-ups in Cloudflare KV.

- Deploy by hand: `cd site && npx wrangler@4 deploy`
- Automatic: `.github/workflows/site.yml` deploys on every push to `main` that changes `site/`.

## Reading the owner pages from a script (/admin/*)

Every `/admin/*` page (overview, ai-cost, self-healing, …) answers **404** without the owner's credentials (`src/auth.js`).
From a terminal or an agent session on the owner's Mac:

```sh
curl -s -H "Authorization: Bearer $(security find-generic-password -s job-pilotto.site.api_key -w)" \
  https://www.jobpilotto.workers.dev/admin/ai-cost
```

- The Bearer token is the Worker secret `STATS_API_KEY`, kept in the Keychain as `job-pilotto.site.api_key`.
- `STATS_KEY` (`job-pilotto.site.stats_key`) is **not** accepted as a Bearer token: it is the browser login (`?key=` once, then the session cookie).
- The pages are HTML; strip the tags to read the tables (`/admin/ai-cost`: By group, By day, By API key, By job).

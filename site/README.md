# Job Pilotto website

Static pages in `public/` (no build step), served by Cloudflare Workers static assets (free, `*.workers.dev`):

- `index.html`: the landing page (how it works, every feature, screenshots, setup, pricing, FAQ)
- `compare.html`: Job Pilotto side by side with Simplify, Teal, Huntr, JobCopilot and LazyApply, from
  each product's own website (dated on the page; re-check before changing a row)
- `styles.css`: shared by both pages

`src/index.js` adds one endpoint, `POST /api/waitlist`, which keeps Pro early-access sign-ups in Cloudflare KV.

- Deploy by hand: `cd site && npx wrangler@4 deploy`
- Automatic: `.github/workflows/site.yml` deploys on every push to `main` that changes `site/`.

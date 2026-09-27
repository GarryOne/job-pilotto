# Job Pilotto website

`public/index.html` is the one-page landing site (no build step). It's served by Cloudflare as static
files (Workers static assets, free, `*.workers.dev`).

- Deploy by hand: `cd site && npx wrangler@4 deploy`
- Automatic: `.github/workflows/site.yml` deploys on every push to `main` that changes `site/`.

The waitlist form doesn't send anything yet; it needs an endpoint before the page is shared widely.

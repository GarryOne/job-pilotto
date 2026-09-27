# Job Pilotto website

`index.html` is the one-page landing site (no build step, no JavaScript framework). Deploy the
folder as a static site, for example Cloudflare Pages:
`npx wrangler@4 pages deploy site --project-name job-pilotto`.

The waitlist form doesn't send anything yet; it needs a Worker endpoint before the page goes live.

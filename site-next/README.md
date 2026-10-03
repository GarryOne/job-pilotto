# Website preview (next)

A copy of the website for trying bigger changes before they go live: **https://next.jobpilotto.workers.dev**.

- `public/`: the pages, edited here. The live site is `../site/public` and is not touched by anything in this folder.
- `src/index.js`: downloads, the install script and the APIs go to the live site; page views are not counted.
- Not indexed by search engines (`_headers`, `robots.txt`).
- Deploy by hand: `cd site-next && npx wrangler@4 deploy`. Automatic: `.github/workflows/site-next.yml` on every push to
  `main` that changes `site-next/`.
- **Going live:** copy the reviewed files to `../site/public` in a commit of their own.

Now in preview: the 5-second hero (headline, proof chips, Terminal install folded away) and Research as the second section.

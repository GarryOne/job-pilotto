# The extension moves to a private repo and is delivered by the website

**Decided 2 Oct 2026.** The app stays public; the Chrome extension (the paid intelligence) does not. Free = Apply with Claude;
licensed users and the trial get the extension, downloaded by the app.

## Flow
1. `GarryOne/job-pilotto-extension` (private): the extension's source, its history, its tests. CI builds a `.tar.gz` and
   `POST`s it to the site (`/api/extension/publish`, Worker secret `EXTENSION_PUBLISH_TOKEN`).
2. The site stores it (KV `extpack:*`) and serves it to an install with a valid JP1 license or a trial still running
   (`EXTENSION_TRIAL_DAYS`, 60, counted on the server from the install's first ask).
3. The app (`desktop/lib/extension-pack.js`) checks at start and every 6 h, verifies the sha256, installs into
   `<data folder>/extension/`, and Chrome's loaded copy reloads itself on the new version.
4. Public repo: `extension/` removed from the tree and from history; the plain Apply button needs the extension, else
   Apply with Claude is the main button.

## Data ownership
- **Notion:** nothing new.
- **Our website's KV:** the published package (product data, not user data) and each install's first-ask time (trial clock).
- **The Mac:** the downloaded extension folder, a cache that is rebuilt by the next sync; `settings.extensionPack`
  ({version, gate, checkedAt}); the license key already kept in settings.

## Limits, honestly
A technical user can read the extension's JavaScript once it is in their browser, and can mint install ids (a few per
address per day) to extend a trial. The aim is to make the extension and its server-side learning (recipes, lab, canary)
a service worth paying for, not to make copying impossible.

## Order (each step is pushed and leaves `main` working)
1. Site endpoints + app download (additive; the bundled extension still works). ✔ this change
2. Private repo with the extension's history and tests; its CI publishes; the first package goes up.
3. Public repo: remove `extension/` (tree), the Free UI without it, workflows, tests, docs, website.
4. Rewrite the public history without `extension/` (backup first; explicit go-ahead at that moment).

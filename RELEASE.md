# Releasing Job Pilotto

> **In short:** every push builds a **pre-release**. When one is good, run **`tools/release-stable.sh`**:
> friends' apps offer it, the website serves it, and their Notion and GitHub runs follow by themselves.

## 1 · Channels

| Channel | Who gets it | How it's made |
|---|---|---|
| 🧪 **Pre-release** (alpha) | you | automatically, by every push to `main` that touches the app (`.github/workflows/desktop.yml`) |
| ✅ **Stable** ("Latest" on GitHub) | friends' apps + the website's Download buttons | you promote one pre-release: `tools/release-stable.sh` |

Version numbers: `desktop/package.json` holds the target (e.g. `0.4.0-alpha`); each build gets the next number
(`0.4.0-alpha.42`, tag `desktop-v0.4.0-alpha.42`). To start a new version, change the target there.

## 2 · Release a stable build

1. Push to `main`. The build takes ~20–30 min: Mac `.dmg` + `.zip`, then the Windows installer; it's published as a pre-release.
2. Try it yourself: download it from GitHub Releases (or wait for your own app to offer it once it's stable).
3. Promote it:
   ```sh
   tools/release-stable.sh                              # the newest build
   tools/release-stable.sh desktop-v0.4.0-alpha.42      # a specific one
   ```
   It refuses a build whose Windows installer isn't there yet.
4. Done. Friends see **"Update to 0.4 Alpha 42"** in the menu at their next start or within 6 hours.

## 3 · What updates on a friend's side

| Part | When | How |
|---|---|---|
| **App** (Mac/Windows) | they click "Update to …" | `desktop/lib/updater.js`: Mac swaps the `.app` and reopens; Windows runs the installer |
| **Python pipeline, Chrome extension** | with the app | bundled in it; the extension reloads itself when the app is newer |
| **Notion schema** | next app start | `desktop/lib/schema.js` adds missing columns and choices, removes `retired` columns |
| **Always on** (their GitHub repo) | next app start | the app writes its own tag into their workflows (`@desktop-v…` + `code_ref`) |
| **Telegram bot** on their Cloudflare | ⚠️ not yet | deployed once; not redeployed on updates |

The app, its Notion schema and the GitHub runs always move together, so a run never writes a column the workspace
doesn't have. Code that adds a column still survives an older workspace (`cron_runs._without_missing`).

## 4 · Checklist before promoting

- [ ] You used this build (or the code it was built from) for a while: no errors in Recent activity.
- [ ] A schema change? The new columns are in `config/notion_schema.json`; removed ones are in `retired`, and nothing reads them.
- [ ] A workflow change? Old tags still work: the app pins friends' repos to *their* version, not yours.
- [ ] Release notes read well for a user (they're generated from the commit messages).

## 5 · If a release is bad

- **Stop it spreading:** promote the previous good build again: `tools/release-stable.sh desktop-v0.4.0-alpha.41`.
  Apps only offer *newer* versions, so friends who already updated stay on the bad one until a fixed build is promoted.
- **Release list:** stable releases stay; only the newest 3 test builds keep a release page (`tools/prune-releases.sh`, run after each build). Tags are never deleted.
- **Fix forward:** push the fix, let it build, promote it.
- **Notion:** retired columns are deleted with their values, so retire only columns nothing reads (the run's page
  keeps the details).

## 6 · First install for a friend

1. Send the stable download: **Mac** `…/releases/latest/download/Job-Pilotto-mac-arm64.dmg`,
   **Windows** `…/releases/latest/download/Job-Pilotto-windows-x64.exe`
   (`https://github.com/GarryOne/job-pilotto/…`).
2. Mac: drag it to **Applications** (updates need it there). The first open shows **"Job Pilotto" Not Opened** (the app
   isn't notarized yet): click **Done** (never Move to Bin), then **System Settings → Privacy & Security** → scroll to
   *"Job Pilotto" was blocked* → **Open Anyway** → confirm. Once only. (Right-click → Open no longer works on recent macOS.)
   Opened from the disk image by mistake? The app offers **Move to Applications** itself.
   Keychain prompt: **Always Allow** (login password). It comes back **once after each update** until the app has an
   Apple Developer ID: macOS ties keychain access of apps without an Apple team ID to the exact build. Builds still share
   one self-made signature (`MAC_SIGN_P12` secret, Keychain `job-pilotto.mac-sign.*`).
3. The setup wizard does the rest: keys, Notion, CV, Profile; Always on is optional.

<details><summary>Not done yet</summary>

- Redeploy a friend's Cloudflare Telegram bot when its code changes.
- Apple Developer ID ($99/year, the owner's call): notarized, so no "Open Anyway" on first install.
</details>

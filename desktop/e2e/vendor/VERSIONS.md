# Vendored widget libraries (widget zoo, real-library pages)

Real open-source libraries job forms use, pinned, served inline into a zoo page by the replay (`desktop/e2e/lib/page-replay.mjs` inlineVendor:
a page writes `<script src="vendor:<file>"></script>`), so CI needs no network. Spec: docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 6.
Which library first comes from data: the count of each library's signatures per host in the pool's saved pages (react-dropzone: Ashby's upload input carries its exact hidden-input style).

| File | Package | Version | License | sha256 |
|---|---|---|---|---|
| `prop-types.min.js` | prop-types (prop-types.min.js) | 15.8.1 | MIT | `e653471aba824786aee5dce1bcb5a86ed30c8518d346d2ace0460a5633a9cbdb` |
| `react-dom.production.min.js` | react-dom (umd/react-dom.production.min.js) | 18.3.1 | MIT | `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d` |
| `react-dropzone.min.js` | react-dropzone (dist/index.js, UMD with attr-accept and file-selector inside) | 14.2.3 | MIT | `a93687ee8a9b7b9a682c99d3974346936f8334aac3a6bfa4e5d2929a5b767591` |
| `react.production.min.js` | react (umd/react.production.min.js) | 18.3.1 | MIT | `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd` |

Update: `npm pack <package>@<version>`, copy the file, update its row (a test checks every file's sha256 against this table).

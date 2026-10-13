# Vendored widget libraries (widget zoo, real-library pages)

Real open-source libraries job forms use, pinned, served inline into a zoo page by the replay (`desktop/e2e/lib/page-replay.mjs` inlineVendor:
a page writes `<script src="vendor:<file>"></script>`), so CI needs no network. Spec: docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 6.
Which library first comes from data: the count of each library's signatures per host in the pool's saved pages (react-dropzone: Ashby's upload input carries its exact hidden-input style).

| File | Package | Version | License | sha256 |
|---|---|---|---|---|
| `flatpickr.min.css` | flatpickr (dist/flatpickr.min.css) | 4.6.13 | MIT | `1b34a42552c96f10e4dfaaa4a367276b03868aacff63c1ac42ffe331352bc754` |
| `flatpickr.min.js` | flatpickr (dist/flatpickr.min.js) | 4.6.13 | MIT | `1eeab1cb779471a0b0aaa93dd91c2eb1aa537d696f01ab05ea9dabc55e8525a1` |
| `intlTelInput-utils.js` | intl-tel-input (build/js/utils.js) | 19.5.6 | MIT | `c0932da778a5f2967da3348d2fff6ba4170803f9b99b04dab15c050a0a3535fb` |
| `intlTelInput.min.css` | intl-tel-input (build/css/intlTelInput.min.css) | 19.5.6 | MIT | `921eb14801bb75da1ab18e840de31346fe69baf573d7ca616a98d0b06170c1f2` |
| `intlTelInput.min.js` | intl-tel-input (build/js/intlTelInput.min.js) | 19.5.6 | MIT | `16cc2e71779e9a2ec1950695a016796fb95af5ea75abcd9be7dbb99d2dbeefb5` |
| `prop-types.min.js` | prop-types (prop-types.min.js) | 15.8.1 | MIT | `e653471aba824786aee5dce1bcb5a86ed30c8518d346d2ace0460a5633a9cbdb` |
| `react-dom.production.min.js` | react-dom (umd/react-dom.production.min.js) | 18.3.1 | MIT | `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d` |
| `react-dropzone.min.js` | react-dropzone (dist/index.js, UMD with attr-accept and file-selector inside) | 14.2.3 | MIT | `a93687ee8a9b7b9a682c99d3974346936f8334aac3a6bfa4e5d2929a5b767591` |
| `react.production.min.js` | react (umd/react.production.min.js) | 18.3.1 | MIT | `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd` |
| `jquery.min.js` | jquery (dist/jquery.min.js) | 3.7.1 | MIT | `fc9a93dd241f6b045cbff0481cf4e1901becd0e12fb45166a8f17f95823f0b1a` |
| `select2.min.js` | select2 (dist/js/select2.min.js) | 4.0.13 | MIT | `00501810e93307a8882a74d864e7547fd1458deea539361dc1124ac133799a4b` |
| `select2.min.css` | select2 (dist/css/select2.min.css) | 4.0.13 | MIT | `15d6ad4dfdb43d0affad683e70029f97a8f8fc8637a28845009ee0542dccdf81` |
| `react-select.min.js` | react-select 5.8.0 with its emotion dependencies, bundled by esbuild (IIFE `window.ReactSelect`; react and react-dom are the vendored globals) | 5.8.0 | MIT | `4c3cd94d4e80d035d3ea6f78409f4b78049cc9b2695043fa45a43458fc563829` |

Update: `npm pack <package>@<version>`, copy the file, update its row (a test checks every file's sha256 against this table).

The two bundled files are built from the npm packages with esbuild (`--bundle --minify --format=iife`, `react`, `react-dom` and `react/jsx-runtime` aliased to the vendored `window.React` / `window.ReactDOM`, `process.env.NODE_ENV` = production); to rebuild, install the package version in a scratch folder and run the same bundle, then update the row.

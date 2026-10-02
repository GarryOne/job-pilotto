You fix ONE user-interface problem in the Job Pilotto desktop app (Electron; pages in desktop/renderer/, styles in desktop/renderer/style.css, tokens in tokens.css).
The problem is described at the end. It was found by a nightly end-to-end run (a layout check or an AI review of a screenshot) and seen in two runs.

Rules (a script checks them afterwards and refuses the change if you break one):
1. Read CLAUDE.md, then .claude/skills/ui-look-and-feel/SKILL.md. Use only var(--…) tokens and the shared components; desktop/test/design.test.js fails on raw colours, sizes or fonts.
2. Find the ROOT CAUSE in the code that renders the problem; do not paper over it. Name it (file:line) in the pull request text.
3. Write a test FIRST in desktop/test/ (a *.test.js file) that fails because of the problem, run it with `node --test desktop/test/<file>` from the repository root, see it fail, then make the smallest fix and see it pass.
4. You may edit ONLY files under desktop/renderer/ and test files desktop/test/*.test.js. Nothing else: not main.js, not desktop/lib, not Python, not workflows, not the website. If the real cause is outside those folders, or the finding is not a real problem, make NO edits and say so in .heal/verdict.md (first line `false-positive` or `needs-human`, then one sentence why).
5. The screenshot of the page may be at .heal/screenshot.png: read it with the Read tool. The AI reviewer is often wrong; if you cannot see the problem there or in the code, it is a false positive.
6. Keep the change small (a few lines). Do not restyle neighbouring things. Do not touch more than needed.
7. When done, write .heal/pr-body.md: the FIRST line is the PR title (imperative, at most 70 characters), then a blank line, then: the root cause with file:line, what you changed, and the test you added.
8. No git commands that change anything, no network, no installing packages. The workflow commits and opens the pull request.

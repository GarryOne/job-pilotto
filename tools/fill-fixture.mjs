// Turns a fill-failure issue's snapshot into a replay test fixture (worker/test/fixtures/fill/<site>--<label>.html + .json).
//   node tools/fill-fixture.mjs <issue> [--answer "Master's"] [--expect-picked "Master's Degree" | --expect-checked Yes | --expect-value …]
//   node tools/fill-fixture.mjs --body-file issue.md --issue 16 …    (offline: the issue's text saved in a file)
// Then run `cd worker && node --test test/fill-replay.test.js`: the new fixture should fail until the fix lands.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARK = '<!-- job-pilotto:snapshot v1 -->';
export const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../worker/test/fixtures/fill');
const slug = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');

// The fixture from an issue: {name, html, spec}; the latest snapshot in the body or its comments wins. Null without one.
export function fromIssue({ number, body = '', comments = [] }, { answer = null, expect = {} } = {}) {
  const texts = [body, ...comments.map((c) => c.body || '')];
  const withSnapshot = texts.filter((text) => text.includes(MARK)).pop();
  if (!withSnapshot) return null;
  const html = withSnapshot.slice(withSnapshot.lastIndexOf(MARK)).match(/```html\n([\s\S]*?)```/)?.[1];
  if (!html) return null;
  const site = body.match(/- Site: `([a-z0-9.-]+)`/)?.[1] || '';
  const reason = body.match(/- Reason: (.+)/)?.[1]?.trim() || '';
  let label = '';
  try { label = JSON.parse(body.match(/```json\n([\s\S]*?)```/)?.[1] || '{}').label || ''; } catch {}
  if (!site || !label) return null;
  return { name: `${site}--${slug(label)}`, html,
    spec: { source: `issue #${number}`, site, label, reason, note: `From issue #${number}'s snapshot.`, answer, expect } };
}

export function write(fixture, { dir = DIR, force = false } = {}) {
  const base = path.join(dir, fixture.name);
  if (!force && fs.existsSync(`${base}.json`)) throw new Error(`${base}.json exists (--force replaces it)`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${base}.html`, fixture.html);
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(fixture.spec, null, 1)}\n`);
  return base;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const bodyFile = option('--body-file');
  const number = option('--issue') || args.find((a) => /^\d+$/.test(a));
  if (!number) {
    console.error('usage: node tools/fill-fixture.mjs <issue> [--answer …] [--expect-picked|--expect-checked|--expect-value …] [--force]');
    process.exit(2);
  }
  const issue = bodyFile ? { number, body: fs.readFileSync(bodyFile, 'utf8'), comments: [] }
    : JSON.parse(execFileSync('gh', ['issue', 'view', number, '--json', 'number,body,comments'], { encoding: 'utf8' }));
  const expect = Object.fromEntries(['picked', 'checked', 'value'].map((key) => [key, option(`--expect-${key}`)]).filter(([, v]) => v !== undefined));
  const fixture = fromIssue(issue, { answer: option('--answer') ?? null, expect });
  if (!fixture) {
    console.error(`Issue #${number} has no snapshot (only reports sent since snapshots were added carry one). Build the fixture by hand from the ` +
      'public form (mark it "source": "synthetic"), see .claude/skills/improve-filling/SKILL.md.');
    process.exit(1);
  }
  const base = write(fixture, { force: args.includes('--force') });
  console.log(`Wrote ${base}.html and .json.`);
  if (fixture.spec.answer === null || !Object.keys(expect).length) {
    console.log('Fill in "answer" (a representative value, never the user\'s real one) and "expect" ({picked|checked|value}) in the .json.');
  }
  console.log('Then: cd worker && node --test test/fill-replay.test.js  (it should fail before the fix, pass after)');
}

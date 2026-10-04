// The activity panel's text links must use the AA-contrast orange (--signal-ink), not --signal (4.0:1 on white).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(dir, '..', 'renderer', 'style.css'), 'utf8');

for (const selector of ['.activity-notion', '.activity-panel .run-github']) {
  test(`${selector} text uses --signal-ink`, () => {
    const rule = css.split('\n').find(line => line.startsWith(`${selector} {`));
    assert.ok(rule, `rule for ${selector}`);
    assert.match(rule, /[^-]color: var\(--signal-ink\)/);
  });
}

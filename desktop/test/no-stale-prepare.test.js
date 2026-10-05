// A button, a step or a message was renamed or removed, and a sentence elsewhere still sends the person to it (5 Oct 2026: "Press Prepare first" stayed in the batch
// errors and a Claude session's notice after the row's Prepare button became Apply). Words aimed at the person must not name a control that is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GONE = /press Prepare\b|Prepare first|then Prepare\b|Prepare it again|Prepare on the jobs/i;   // the Prepare button (the engine task is still named Prepare top matches: scheduled and command runs)
const files = dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

test('no sentence points the person to a Prepare button or card that no longer exists', () => {
  const found = [];
  for (const file of [...files('lib'), ...files('renderer'), 'main.js']) {
    if (!/\.(js|html)$/.test(file)) continue;
    fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
      if (GONE.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) found.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(found, []);
});

// "Mac" in the window's words on Windows (owner, 9 Oct 2026: "Not installed on this Mac" on a PC). Every piece of text the window or the app shows is passed through
// renderer/os.js on Windows, so the test runs each line of the renderer and lib through the same swap: a "Mac" that survives it would be shown to a PC user.
// A line may keep one on purpose (listed below, with why); a tip that only the Mac has is marked data-mac-only and hidden on Windows.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {osText} from '../renderer/os.js';

const root = fileURLToPath(new URL('..', import.meta.url));   // not .pathname: on Windows that is /D:/… (CI red, 9 Oct 2026)
const walk = dir => readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const KEPT = [
  'Mac schedule', 'Mac (you)',                  // the Trigger value written to the Notion Runs database: data, not display (a schema change of its own)
  'can only be asked of a Mac',                 // the Windows branch says why this PC does it by hand
];

test('after the Windows swap no line of the renderer or lib still says Mac', () => {
  const left = ['renderer', 'lib'].flatMap(walk).filter(file => /\.(js|html)$/.test(file) && !file.replace(/\\/g, '/').endsWith('renderer/os.js'))   // \ on Windows (CI red, 9 Oct 2026)
    .flatMap(file => readFileSync(join(root, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line.trim()])
      .filter(([, , line]) => !/^(\/\/|\*|<!--)/.test(line) && !line.includes('data-mac-only') && !KEPT.some(text => line.includes(text))
        && /\bMac\b/.test(osText(line.replace(/\bplatform\b.*|darwin.*/, ''), 'win32')) && !/(['"])mac\1|\.mac\b|mac:|process\.platform|navigator\.platform/.test(line))
      .map(([f, n, line]) => `${f}:${n}: ${line.slice(0, 90)}`));
  assert.deepEqual(left, []);
});

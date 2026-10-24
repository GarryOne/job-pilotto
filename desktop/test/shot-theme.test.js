// npm run shot --theme writes the app's theme setting: a data-theme attribute does nothing (the CSS follows Electron's theme source), so a "light" shot was dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const shot = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'shot.mjs'), 'utf8');

test('shot.mjs takes --theme as a valued option and merges it into the demo settings', () => {
  assert.match(shot, /VALUED = \[[^\]]*'theme'/);
  assert.match(shot, /option\('theme'\)\s*\?\s*\{theme: option\('theme'\)\}/);
  assert.match(shot, /--theme <light\|dark>/, 'documented in the header');
});

// "Resume Claude" is never the main (orange) action (owner, 9 Oct 2026, three session screens: Question for you, Ended, Form closed): every place that builds it
// makes it secondary, and a session row with no other main action promotes the way to its form. Source checks (the session page needs a window); the rendered look: npm run shot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('Resume Claude is secondary everywhere it is built, and the way to the form becomes the main action when nothing else is', () => {
  const sessions = read('../renderer/pages/sessions.js');
  const builders = sessions.match(/sessionButton\('Resume Claude', ('[a-z]+'|kind)/g) || [];
  assert.deepEqual(builders, ["sessionButton('Resume Claude', 'secondary'"]);   // one builder, one kind
  assert.doesNotMatch(sessions, /resume\((?!\))/);                               // no call site passes a kind any more
  assert.match(sessions, /if \(!actions\.some\(button => button\.classList\.contains\('primary'\)\)\)/);
  assert.match(sessions, /toIt\.classList\.replace\('secondary', 'primary'\)/);
  // The banner shown when Claude is not running (session log): its Resume button is secondary too.
  assert.match(read('../renderer/index.html'), /<button class="secondary with-icon" id="ss-offline-resume">/);
  for (const file of ['../renderer/pages/sessions.js', '../renderer/pages/session-log.js', '../renderer/pages/session-actions.js'])
    assert.doesNotMatch(read(file), /Resume Claude['"`][^\n]*['"`]primary['"`]/, `${file}: a primary Resume Claude`);
});

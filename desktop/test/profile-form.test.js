// Settings → Profile → Profile text as a form (renderer/pages/profile-form.js): the tab opens it, it saves through the plain editor's IPC, the plain
// editor stays one click away, and a read-only store keeps its read-only view. The model is guarded by profile-model.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const profile = read('../renderer/pages/profile.js'), form = read('../renderer/pages/profile-form.js');

test('the Profile text tab opens the form, and the form keeps the plain editor and the read-only view', () => {
  assert.match(profile, /name === 'profiletext'\) loadProfileForm\(\)/);
  assert.match(form, /textSave\('profile'/);
  assert.match(form, /if \(!result\.editable\) return loadTextEditor\('profile'\)/);
  assert.match(form, /'Edit as text'/);
  assert.match(form, /'Save changes'/);
  assert.match(form, /Saved ✓ The next kits and form fills use it\./);
});

test('suggestions fill an input and never limit it: a datalist on a text input', () => {
  assert.match(form, /input\.setAttribute\('list'/);
  assert.doesNotMatch(form, /createElement\('select'\)|el\('select'/);
});

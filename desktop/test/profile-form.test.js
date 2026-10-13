// Settings → Profile → Profile text as a form (renderer/pages/profile-form.js): the tab opens it, it saves through the plain editor's IPC, the plain
// editor stays one click away, and a read-only store keeps its read-only view. The model is guarded by profile-model.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const profile = read('../renderer/pages/profile.js'), form = read('../renderer/pages/profile-form.js');

test('the Preferences tab opens the form: this Mac saves the text, Notion saves one cell or bullet, and the plain editor stays', () => {
  assert.match(read('../renderer/index.html'), /data-profile-tab="profiletext">Preferences</);
  assert.match(profile, /name === 'profiletext'\) loadProfileForm\(\)/);
  assert.match(form, /textSave\('profile'/);
  assert.match(form, /profileFormSave\(changes\(\)\)/);
  assert.match(form, /if \(!notion\.ok\) return loadTextEditor\('profile'\)/, 'no form data: the plain read-only view');
  assert.match(read('../preload.cjs'), /profileForm: call\('profileForm'\), profileFormSave: call\('profileFormSave'\)/);
  assert.match(form, /'Edit as text'/);
  assert.match(form, /'Save changes'/);
  assert.match(form, /Saved ✓ The next kits and form fills use it\./);
});

test('suggestions fill an input and never limit it: a datalist on a text input', () => {
  assert.match(form, /input\.setAttribute\('list'/);
  assert.doesNotMatch(form, /createElement\('select'\)|el\('select'/);
});

// Menus with no blank first option (easytemp, twin, 9 Oct 2026): "Monsieur" set on a menu whose first option IS Monsieur read as empty
// ("empty again at the end of the fill"), and a blank "Région" (value 0, no text) read as filled by the audit and the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const FORM = `<form>
  <label for="anrede">Titre*</label><select id="anrede"><option value="1">Monsieur</option><option value="2">Madame</option></select>
  <label for="zivil">Etat civil*</label><select id="zivil"><option value="10">Célibataire</option><option value="20">Marié(e)</option></select>
  <label for="region">Région souhaitée</label><select id="region"><option value="0"></option><option value="5">Genève</option></select>
  <label for="pays">Pays</label><select id="pays"><option value="">-- choose --</option><option value="CH">Suisse</option></select>
</form>`;

test('a real choice is an answer, a blank one is not, in every reader; before a fill a preselected first option is still asked', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM, { url: 'https://api.easytemp.ch/live/bew/1-FR.php' });
  const chosen = id => window.__jobPilottoChosen(window.document.getElementById(id));
  assert.deepEqual(['anrede', 'zivil', 'region', 'pays'].map(chosen), [true, true, false, false]);
  const audit = Object.fromEntries(window.__jobPilottoAuditVisibleFields().map(row => [row.field, row.filled]));
  assert.deepEqual([audit.anrede, audit.region, audit.pays], [true, false, false], 'the audit');
  const before = Object.fromEntries((await window.__jobPilottoDescribeForm()).map(row => [row.field, row.filled]));
  assert.deepEqual([before.anrede, before.zivil, before.region], [false, false, false], 'before a fill the AI is asked about preselected choices');
  const settled = Object.fromEntries((await window.__jobPilottoDescribeForm(true)).map(row => [row.field, row.filled]));
  assert.deepEqual([settled.anrede, settled.zivil, settled.region, settled.pays], [true, true, false, false], 'at the end a real choice counts');
  window.close();
});

test('the panel and flow.js read menus by the same rule', () => {
  const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const rule = read('extension/page/browser-form-fastpath.js').match(/window\.__jobPilottoChosen = el => (.+);\n/)[1];
  assert.ok(read('extension/review.js').includes(`el.tagName === 'SELECT' ? ${rule} :`), 'review.js carries the same expression');
  assert.match(read('extension/flow.js'), /window\.__jobPilottoDescribeForm\?\.\(true\)/, 'the end of a fill reads settled');
  assert.match(read('extension/page/coverage.js'), /window\.__jobPilottoChosen\(el\)/);
});

// easytemp (twin, 9 Oct 2026): Nationalité preselected "Suisse" (an option marked selected, not the first) was read as answered and never asked.
test('a menu on the page\'s own preselected choice is asked before the fill and flagged after it when nobody answered it', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, `<form>
    <label for="staat">Nationalité*</label><select id="staat"><option value="AF">Afghanistan</option><option value="CH" selected>Suisse</option><option value="RO">Roumanie</option></select>
    <label for="lang">Langue</label><select id="lang"><option value="FR">Français</option><option value="DE">Deutsch</option></select>
  </form>`, { url: 'https://api.easytemp.ch/live/bew/2-FR.php' });
  const staat = window.document.getElementById('staat');
  assert.equal(window.__jobPilottoAtPageDefault(staat), true);
  const before = Object.fromEntries((await window.__jobPilottoDescribeForm()).map(row => [row.field, row.filled]));
  assert.deepEqual([before.staat, before.lang], [false, false], 'both still asked');
  const summary = await window.__jobPilottoExtensionFill([{field: 'lang', value: 'Deutsch'}], {}, null, '', false);
  const rows = Object.fromEntries(Array.from(summary.trace, row => [row.label, [row.outcome, row.reason]]));
  assert.deepEqual(rows['Nationalité'], ['filled', 'preselected by the page: check it']);
  assert.deepEqual(rows.Langue, ['filled', ''], 'one we set is a plain answer');
  window.close();
});

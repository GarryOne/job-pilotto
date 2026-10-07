// Rebuild from CV keeps what the user already chose: a CV that names no permit must not delete it, a language missing from the CV must not
// start hiding jobs, a photographer is not asked for GitHub, and the review shows "photograph" for "photograph(e|er)?" (7 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import * as strategy from '../lib/strategy.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {available: () => true, encrypt: text => Buffer.from(text), decrypt: buffer => buffer.toString()};
function rebuilt() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  storage.writeText('config/search.json', JSON.stringify({locations: {top_tier: ['geneva'], country_wide: ['switzerland'], abroad: []}}));
  storage.writeText('config/preferences.json', JSON.stringify({work_rights: ['swiss b permit \\(authorized to work in switzerland\\)\\.', 'eu'],
    disqualifying_languages: ['german']}));
  storage.saveSettings({setupDone: true});
  return storage;
}
const reply = draft => ({stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify(draft)}]});

test('a rebuild is told the current places, work rights and languages, and keeps the work rights the draft dropped', async () => {
  const storage = rebuilt(), seen = [];
  const client = {messages: {create: async request => { seen.push(request); return reply({
    preferences: {work_rights: [], disqualifying_languages: ['german', 'english', 'italian'], excluded_companies: []},
    profile_markdown: '# Links\n- LinkedIn: ❓\n- GitHub: ❓\n- Website: me.example', answers_markdown: '| GitHub | ❓ |\n| Website | me.example |',
    contact: {github: ''}}); }}};
  const result = await strategy.draft(storage, {}, 'sk-ant-x', client);
  const prompt = seen[0].messages[0].content[1].text;
  assert.match(prompt, /<current_settings>/);
  assert.match(prompt, /Places: geneva, switzerland/);
  assert.match(prompt, /Work rights \(no visa needed\): swiss b permit authorized to work in switzerland, eu/);
  assert.deepEqual(result.preferences.work_rights, ['swiss b permit \\(authorized to work in switzerland\\)\\.', 'eu']);   // never dropped by a rebuild
  assert.deepEqual(result.preferences.disqualifying_languages, ['german']);   // english and italian were guesses: not added
  assert.doesNotMatch(result.profile_markdown, /GitHub/);
  assert.match(result.profile_markdown, /LinkedIn: ❓/);                        // only GitHub is dropped
  assert.equal(result.answers_markdown, '| Website | me.example |');
});

test('a first setup gets no current settings, and the rules say a missing language is unknown, not disqualifying', async () => {
  const storage = rebuilt(), seen = [];
  storage.saveSettings({setupDone: false});
  const client = {messages: {create: async request => { seen.push(request); return reply({preferences: {work_rights: [], disqualifying_languages: [], excluded_companies: []}}); }}};
  await strategy.draft(storage, {}, 'sk-ant-x', client);
  assert.doesNotMatch(seen[0].messages[0].content[1].text, /<current_settings>/);
  assert.doesNotMatch(seen[0].system, /Jobs requiring any other language well are disqualifying/);
  assert.match(seen[0].system, /never rule jobs out for it/);
  assert.match(seen[0].system, /Leave out template rows and links that don't fit their kind of work/);
});

test('a GitHub the CV shows stays', () => {
  assert.equal(strategy.withoutUnknownGithub('- GitHub: ❓', {github: 'https://github.com/me'}), '- GitHub: ❓');
  assert.equal(strategy.withoutUnknownGithub('- GitHub: https://github.com/me', {}), '- GitHub: https://github.com/me');
});

test('the review names a search pattern by its words', () => {
  assert.deepEqual(['photograph(e|er)?', 'vendeu(r|se)', 'conseill(er|ère) de vente', 'responsable de (magasin|boutique)', '\\bsales associate\\b', 'z[uü]rich']
    .map(strategy.wordsOf), ['photograph', 'vendeur', 'conseiller de vente', 'responsable de magasin', 'sales associate', 'zürich']);
});

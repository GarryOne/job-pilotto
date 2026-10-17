// Preferences review (lib/preferences-parse.js, renderer/preferences-review-model.js): messy profile text -> clean field values through ONE AI call whose
// answer is validated (a fixed fake answer here, never a live call); an answer outside the shape is rejected and asked again; asked once per text.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ask, cleanAnswer, forFields, inputKey} from '../lib/preferences-parse.js';
import {proposedTexts, reviewOf} from '../renderer/preferences-review-model.js';

const memoryStorage = () => { const files = {}; return {files, readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}; };
const reply = answers => { const calls = []; return {calls, messages: {create: async request => { calls.push(request); const answer = answers[Math.min(calls.length, answers.length) - 1];
  return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}]}; }}}; };
const base = {countries: [], cities: [], remote: 'unknown', languages: [], relocation: {answer: 'unknown', where: ''}, roles: [], seniority: 'unknown', employment: [], unparsed: []};
const fieldsOf = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {value}]));

// Each profile: [what the person typed, the model's (fixed) answer, the clean text per field it must give].
const PROFILES = {
  'the owner (anonymised)': [
    {countries: 'Switzerland (anywhere), plus Berlin, London, Dubai, or remote roles', cities: 'Most preferred: Zurich and surroundings. Anywhere else in Switzerland is fine. Abroad: Berlin',
      languages: 'English B2, Romanian native, Russian B1. No French, German or Italian.', roles: '❓ DevOps, Cloud Engineer?', relocation: '', home: 'Geneva today; open to relocating (Zurich preferred)',
      seniority: 'Senior. Confirmed 26 Sep 2026.', employment: 'Permanent or contract. Confirmed 26 Sep 2026.'},
    {...base, countries: ['CH', 'DE', 'GB', 'AE'], cities: [{name: 'Zurich', country: 'CH'}, {name: 'Berlin', country: 'DE'}], remote: 'yes',
      languages: [{name: 'English', level: 'B2'}, {name: 'Romanian', level: 'native'}, {name: 'Russian', level: 'B1'}], relocation: {answer: 'yes', where: 'Zurich'},
      roles: [{title: 'DevOps', certainty: 'maybe'}, {title: 'Cloud Engineer', certainty: 'maybe'}], seniority: 'senior', employment: ['permanent', 'contract'],
      unparsed: ['countries', 'cities', 'languages', 'relocation', 'roles', 'seniority', 'employment']},
    {countries: 'Switzerland, Germany, United Kingdom, United Arab Emirates', cities: 'Zurich (Switzerland), Berlin (Germany)', languages: 'English (Upper intermediate (B2)), Romanian (Native), Russian (Intermediate (B1))',
      relocation: 'Yes (Zurich)', roles: 'DevOps, Cloud Engineer', seniority: 'Senior', employment: 'Permanent or contract'}],
  'a nurse': [
    {countries: 'Ireland and maybe Australia, not the US', cities: 'Dublin or Cork', languages: 'English (mother tongue), Tagalog fluent', roles: 'Staff nurse, ward sister?', seniority: 'a few years in', employment: 'Permanent, part-time ok'},
    {...base, countries: ['IE', 'AU'], cities: [{name: 'Dublin', country: 'IE'}, {name: 'Cork', country: 'IE'}], languages: [{name: 'English', level: 'native'}, {name: 'Tagalog', level: 'C2'}],
      roles: [{title: 'Staff nurse', certainty: 'sure'}, {title: 'Ward sister', certainty: 'maybe'}], seniority: 'mid', employment: ['permanent', 'part_time'], unparsed: ['countries', 'cities', 'languages', 'roles', 'seniority', 'employment']},
    {countries: 'Ireland, Australia', cities: 'Dublin, Cork', languages: 'English (Native), Tagalog (Fluent)', roles: 'Staff nurse, Ward sister', seniority: 'Mid-level', employment: 'Permanent, Part-time'}],
  'a teacher': [
    {countries: 'Spain, anywhere in the EU really', cities: 'Madrid; Valencia (not Barcelona)', languages: 'Spanish C1, English native', roles: 'Primary teacher, or secondary maths', relocation: 'Happy to move for the right school'},
    {...base, countries: ['ES'], cities: [{name: 'Madrid', country: 'ES'}, {name: 'Valencia', country: 'ES'}], languages: [{name: 'Spanish', level: 'C1'}, {name: 'English', level: 'native'}],
      relocation: {answer: 'yes', where: ''}, roles: [{title: 'Primary teacher', certainty: 'sure'}, {title: 'Secondary maths teacher', certainty: 'sure'}], unparsed: ['countries', 'cities', 'roles', 'relocation']},
    {countries: 'Spain', cities: 'Madrid, Valencia', languages: 'Spanish (Advanced (C1)), English (Native)', relocation: 'Yes', roles: 'Primary teacher, Secondary maths teacher'}],
  'a sales rep': [
    {countries: 'DACH', cities: 'Munich, Vienna or Zurich, hybrid', mode: 'Hybrid, 2 days remote', languages: 'German native; English fluent', roles: 'Account executive / SDR', seniority: 'senior if possible', employment: 'Permanent only, with commission'},
    {...base, countries: ['DE', 'AT', 'CH'], cities: [{name: 'Munich', country: 'DE'}, {name: 'Vienna', country: 'AT'}, {name: 'Zurich', country: 'CH'}], remote: 'unknown', languages: [{name: 'German', level: 'native'}, {name: 'English', level: 'C2'}],
      roles: [{title: 'Account executive', certainty: 'sure'}, {title: 'SDR', certainty: 'sure'}], seniority: 'senior', employment: ['permanent'], unparsed: ['countries', 'cities', 'mode', 'languages', 'roles', 'seniority', 'employment']},
    {countries: 'Germany, Austria, Switzerland', cities: 'Munich (Germany), Vienna (Austria), Zurich (Switzerland)', languages: 'German (Native), English (Fluent)', roles: 'Account executive, SDR', seniority: 'Senior', employment: 'Permanent only'}],
};

for (const [who, [typed, answer, expected]] of Object.entries(PROFILES)) {
  test(`messy text of ${who} becomes clean field values; the original wording is what the card compares against`, () => {
    const parse = cleanAnswer(answer);
    const texts = proposedTexts(parse, {mode: typed.mode || ''});
    for (const [key, text] of Object.entries(expected)) assert.equal(texts[key], text, key);
    const rows = reviewOf(fieldsOf(typed), parse, ['countries', 'cities', 'mode', 'relocation', 'languages', 'roles', 'employment', 'seniority']);
    const flagged = parse.unparsed.filter(key => texts[key]);
    assert.deepEqual(rows.map(row => row.key).filter(key => typed[key]).sort(), flagged.filter(key => typed[key]).sort(), 'every typed field proposed is one the AI flagged');
    assert.ok(rows.filter(row => !flagged.includes(row.key)).every(row => !row.old), 'an unflagged field is proposed only where the page has nothing');
    for (const row of rows) assert.equal(row.old, typed[row.key] || '');
  });
}

test('a field the AI did not flag, or already equal, is never proposed over; an empty one is filled', () => {
  const parse = cleanAnswer({...base, countries: ['CH'], languages: [{name: 'English', level: 'B2'}], relocation: {answer: 'yes', where: ''}, unparsed: []});
  const rows = reviewOf(fieldsOf({countries: 'Switzerland', languages: 'English (fluent)', relocation: ''}), parse, ['countries', 'languages', 'relocation']);
  assert.deepEqual(rows, [{key: 'relocation', old: '', proposed: 'Yes'}], 'clean countries equal; languages unflagged; the empty relocation filled');
});

test('an answer outside the shape is rejected', () => {
  for (const bad of [null, {...base, countries: ['Switzerland']}, {...base, countries: 'CH'}, {...base, languages: [{name: 'English', level: 'working language'}]},
    {...base, seniority: 'principal'}, {...base, unparsed: ['salary']}, {...base, employment: ['gig']}, {...base, roles: [{title: '', certainty: 'sure'}]}, {...base, remote: true}]) {
    assert.throws(() => cleanAnswer(bad), undefined, JSON.stringify(bad));
  }
  assert.deepEqual(cleanAnswer({...base, roles: [{title: 'DevOps?', certainty: 'maybe'}, {title: 'devops', certainty: 'sure'}]}).roles, [{title: 'DevOps', certainty: 'maybe'}], 'marks stripped, duplicates dropped');
});

test('a rejected answer is asked again once with the reason; two misses are an error, never kept as sure', async () => {
  const good = {...base, countries: ['CH']};
  const client = reply([{...base, countries: ['Switzerland']}, good]);
  assert.deepEqual((await ask(client, {countries: 'Switzerland'})).parse.countries, ['CH']);
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[1].messages[0].content[0].text, /rejected: "Switzerland" is not an ISO country code/);
  const broken = reply([{...base, seniority: 'x'}, {...base, seniority: 'y'}]);
  await assert.rejects(ask(broken, {seniority: 'Senior'}), /outside the expected shape/);
  assert.equal(broken.calls.length, 2);
});

test('asked once per text: the same text reads from the kept answer, a change asks again, a failure is kept and not paid twice', async () => {
  const storage = memoryStorage(), logged = [];
  const client = reply([{...base, countries: ['CH'], unparsed: ['countries']}]);
  const fields = {countries: 'Switzerland (anywhere), or remote roles'};
  const first = await forFields(storage, {fields, client, log: (...line) => logged.push(line)});
  assert.deepEqual([first.fresh, first.parse.countries], [true, ['CH']]);
  assert.ok(!JSON.stringify(logged).includes('Switzerland'), 'the log names fields, never their text');
  const again = await forFields(storage, {fields, client});
  assert.deepEqual([again.fresh, client.calls.length], [false, 1]);
  await forFields(storage, {fields: {countries: 'Germany'}, client});
  assert.equal(client.calls.length, 2);
  assert.notEqual(inputKey(fields), inputKey({...fields, home: 'Geneva'}));
  const broken = reply([{...base, seniority: 'x'}]);
  const failed = await forFields(storage, {fields: {seniority: 'Senior'}, client: broken});
  assert.match(failed.error, /outside the expected shape/);
  await forFields(storage, {fields: {seniority: 'Senior'}, client: broken});
  assert.equal(broken.calls.length, 2, 'the failure is kept for this text');
  assert.equal((await forFields(storage, {fields: {}, client})).parse, null, 'nothing typed: nothing asked');
  assert.equal((await forFields(memoryStorage(), {fields, client: null})).error, 'no AI');
});

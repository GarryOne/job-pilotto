// The one list of target roles in the app (lib/target-roles.js), the twin of src/target_roles.py: the same shared cases, then the edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {SEARCHED, derive, editTitles, moveTitle, titlesOf, view, withDerived} from '../lib/target-roles.js';

const cases = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/target_roles_cases.json', import.meta.url), 'utf8'));

test('the shared cases give the same list, keywords and searches as the engine', () => {
  for (const c of cases) {
    const roles = view(c.search), out = derive(roles);
    assert.deepEqual([roles.map(role => role.title), out.role_keywords, out.jobs_board_search_queries], [c.titles, c.role_keywords, c.queries], c.name);
  }
});

test('adding and removing a title keeps the variants of the others and rewrites both keys', () => {
  const search = withDerived({target_roles: [{title: 'Registered Nurse', also: ['rn']}, {title: 'Staff Nurse', also: []}]});
  const next = editTitles(search, {add: ['Nurse Practitioner', 'registered nurse'], remove: ['Staff Nurse']});
  assert.deepEqual(titlesOf(next), ['Registered Nurse', 'Nurse Practitioner']);
  assert.deepEqual(next.role_keywords, ['registered nurse', 'rn', 'nurse practitioner']);
  assert.deepEqual(next.jobs_board_search_queries, ['Registered Nurse', 'Nurse Practitioner']);
});

test('only the first five titles are searched on job boards, and moving a title up searches it', () => {
  const search = withDerived({target_roles: ['A', 'B', 'C', 'D', 'E', 'F'].map(title => ({title: `Nurse ${title}`, also: []}))});
  assert.equal(search.jobs_board_search_queries.length, SEARCHED);
  const moved = moveTitle(search, 'Nurse F', 0);
  assert.equal(moved.jobs_board_search_queries[0], 'Nurse F');
  assert.ok(!moved.jobs_board_search_queries.includes('Nurse E'));
  assert.ok(moved.role_keywords.includes('nurse e'), 'a title that is no longer searched still matches job titles');
});

test('settings with no roles are left as they are', () => {
  assert.deepEqual(withDerived({locations: {}}), {locations: {}});
});

test('the app merges an old two-list file once and republishes the page; no AI means it is asked again later', async () => {
  const {oneRolesList} = await import('../lib/strategy-settings.js');
  const make = answer => {
    const files = {'config/search.json': JSON.stringify({role_keywords: ['registered nurse', 'rn'], jobs_board_search_queries: ['Registered Nurse']})}, calls = [];
    const storage = {readText: name => files[name] || '', writeText() {}, secret: () => '', settings: () => ({})};
    const deps = {run: async (_, args) => { calls.push(args.join(' ')); return {code: 0, stdout: answer}; }};
    return {storage, deps, calls, files};
  };
  const none = make('unchanged');
  assert.equal(await oneRolesList(none.storage, none.deps), false);
  assert.deepEqual(none.calls, ['src.target_roles migrate']);
  const done = make('merged');
  assert.equal(await oneRolesList(done.storage, done.deps), true);
  done.files['config/search.json'] = JSON.stringify({target_roles: [{title: 'Registered Nurse', also: ['rn']}]});
  done.calls.length = 0;
  assert.equal(await oneRolesList(done.storage, done.deps), false);
  assert.deepEqual(done.calls, [], 'a merged file is never asked again');
});

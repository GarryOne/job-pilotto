// The one-time Locations move (owner, 17 Oct 2026: "Compare existing values during migration. When they conflict, ask the user to resolve the difference once;
// don't silently discard or combine them"): matching values move by themselves, a side that is genuinely unset yields to the other, "No relocation" and
// "Anywhere" are values, a conflict is queued with no preselected winner, and both originals are kept until the person confirms.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classify, resolveConflict, applyLocations, judgeProfile, CHOICES} from '../lib/locations-move.js';

const SEARCH = (top = [], country = [], abroad = []) => ({locations: {top_tier: top, country_wide: country, abroad}});
const PROFILE = (preferred = [], acceptable = [], relocation = 'unspecified', destinations = []) => ({preferred, acceptable, relocation, destinations});

test('matching values (any case, any accent) move by themselves, no question', () => {
  const plan = classify(SEARCH(['zürich'], ['switzerland']), PROFILE(['Zurich'], ['Switzerland']));
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.resolved.preferred, ['zürich']);   // the existing wording stays
  assert.deepEqual(plan.resolved.acceptable, ['switzerland']);
});

test('a genuinely unset side yields to the populated one, either way round', () => {
  const a = classify(SEARCH([], ['netherlands']), PROFILE());
  assert.deepEqual(a.resolved.acceptable, ['netherlands']);
  const b = classify(SEARCH(), PROFILE(['Zurich']));
  assert.deepEqual(b.resolved.preferred, ['Zurich']);
  assert.equal(a.conflicts.length + b.conflicts.length, 0);
});

test('two different populated values are a conflict: both shown, nothing picked, nothing written', () => {
  const plan = classify(SEARCH(['amsterdam', 'berlin'], ['netherlands', 'germany']), PROFILE([], ['Switzerland']));
  assert.equal(plan.conflicts.length, 1);
  const [conflict] = plan.conflicts;
  assert.equal(conflict.kind, 'acceptable');
  assert.deepEqual(conflict.strategy, ['netherlands', 'germany']);
  assert.deepEqual(conflict.profile, ['Switzerland']);
  assert.equal(conflict.picked, undefined);
  assert.equal(plan.resolved.acceptable, undefined);   // nothing decided for the person
  assert.deepEqual(plan.resolved.preferred, ['amsterdam', 'berlin']);   // the other kind had one side only
  assert.deepEqual(CHOICES, ['profile', 'strategy', 'choose', 'separate']);   // "separate" is the explicit advanced option
});

test('"No relocation" and "Anywhere" are values, not missing data', () => {
  const no = classify(SEARCH(), PROFILE([], [], 'no'));
  assert.equal(no.resolved.relocation.mode, 'no');
  const yesVsNo = classify(SEARCH([], [], ['berlin']), PROFILE([], [], 'no'));
  assert.equal(yesVsNo.conflicts[0].kind, 'relocation');
  const anywhere = classify(SEARCH(), PROFILE([], ['Anywhere']));
  assert.deepEqual(anywhere.resolved.acceptable, ['Anywhere']);
  const anywhereVsCountry = classify(SEARCH([], ['germany']), PROFILE([], ['Anywhere']));
  assert.equal(anywhereVsCountry.conflicts[0].kind, 'acceptable');
});

test('relocation keeps Yes / No / Not specified apart', () => {
  assert.equal(classify(SEARCH(), PROFILE()).resolved.relocation.mode, 'unspecified');
  assert.equal(classify(SEARCH([], [], ['berlin']), PROFILE()).resolved.relocation.mode, 'yes');
  assert.equal(classify(SEARCH([], [], ['berlin']), PROFILE([], [], 'yes', ['Berlin'])).resolved.relocation.mode, 'yes');
});

test('resolving a conflict: each choice, "choose" takes the person\'s own list, "separate" keeps the old list as a search-only override', () => {
  const plan = classify(SEARCH([], ['netherlands']), PROFILE([], ['Switzerland']));
  const [conflict] = plan.conflicts;
  assert.deepEqual(resolveConflict(plan, conflict.kind, 'profile').resolved.acceptable, ['Switzerland']);
  assert.deepEqual(resolveConflict(plan, conflict.kind, 'strategy').resolved.acceptable, ['netherlands']);
  assert.deepEqual(resolveConflict(plan, conflict.kind, 'choose', {places: ['Switzerland', 'Germany']}).resolved.acceptable, ['Switzerland', 'Germany']);
  const sep = resolveConflict(plan, conflict.kind, 'separate');
  assert.deepEqual(sep.resolved.acceptable, ['Switzerland']);
  assert.deepEqual(sep.resolved.searchOverride, ['netherlands']);
  assert.throws(() => resolveConflict(plan, conflict.kind, 'nonsense'));
  assert.equal(resolveConflict(plan, conflict.kind, 'profile').conflicts.length, 0);
  assert.equal(plan.conflicts.length, 1);   // the plan itself is not changed
});

test('applyLocations writes the resolved values and keeps every other search setting', () => {
  const search = {role_keywords: ['sre'], remote_excluded_regions: ['canada'], locations: {top_tier: ['berlin'], country_wide: ['germany'], abroad: []}};
  const next = applyLocations(search, {preferred: ['Zurich'], acceptable: ['Switzerland'], relocation: {mode: 'yes', places: ['Berlin']}, searchOverride: ['germany']});
  assert.deepEqual(next.locations.top_tier, ['Zurich']);
  assert.deepEqual(next.locations.country_wide, ['Switzerland']);
  assert.deepEqual(next.locations.abroad, ['Berlin']);
  assert.equal(next.locations.relocation, 'yes');
  assert.deepEqual(next.locations.search_override, ['germany']);
  assert.deepEqual(next.role_keywords, ['sre']);
  assert.deepEqual(next.remote_excluded_regions, ['canada']);
  assert.deepEqual(search.locations.top_tier, ['berlin']);   // input untouched
  const partial = applyLocations(search, {acceptable: ['Switzerland']});   // an undecided kind is left as it was
  assert.deepEqual(partial.locations.top_tier, ['berlin']);
});

test('the AI reads the Profile rows into a fixed answer; a mangled one is "nothing read", never invented', async () => {
  const rows = [{label: 'Countries', value: 'Switzerland (anywhere), remote within Europe'}, {label: 'Home base', value: 'Zurich'},
    {label: 'Relocation', value: 'Within my country'}];
  const calls = [];
  const good = {messages: {create: async request => { calls.push(request); return {content: [{type: 'text', text: JSON.stringify({preferred: [], acceptable: ['Switzerland'], relocation: 'unspecified', destinations: []})}]}; }}};
  assert.deepEqual(await judgeProfile(rows, {client: good}), PROFILE([], ['Switzerland']));
  assert.equal(calls.length, 1);
  const bad = {messages: {create: async () => ({content: [{type: 'text', text: '{"relocation":"maybe","acceptable":"x"}'}]})}};
  assert.equal(await judgeProfile(rows, {client: bad}), null);
  assert.equal(await judgeProfile(rows, {}), null);   // no AI: nothing moves
  assert.equal(await judgeProfile([], {client: good}), null);   // no rows: no call
  assert.equal(calls.length, 1);
});

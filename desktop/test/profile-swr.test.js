// Profile tabs show what they read last time at once, refresh behind it, and draw the skeleton card only when nothing is kept (renderer/swr.js).
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {forgetKept, swr} from '../renderer/swr.js';

test('a second open paints the kept answer before the read returns, then the fresh one', async () => {
  forgetKept();
  const painted = [];
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const calls = {loading: 0, read: 0};
  const opts = {loading: () => calls.loading++, paint: (answer, kept) => painted.push([answer.v, kept])};
  await swr('tab', async () => ({ok: true, v: 1}), opts);
  const second = swr('tab', async () => { calls.read++; await slow; return {ok: true, v: 2}; }, opts);
  assert.deepEqual(painted, [[1, false], [1, true]], 'kept copy painted at once, read still pending');
  release();
  await second;
  assert.deepEqual(painted.at(-1), [2, false]);
  assert.equal(calls.loading, 1, 'the skeleton card only the first time');
});

test('a failed refresh leaves the kept copy; a failed first read says so', async () => {
  forgetKept();
  const fails = [];
  const opts = {paint() {}, fail: answer => fails.push(answer.error)};
  await swr('a', async () => ({ok: false, error: 'offline'}), opts);
  assert.deepEqual(fails, ['offline']);
  await swr('b', async () => ({ok: true}), opts);
  await swr('b', async () => { throw new Error('boom'); }, opts);
  assert.deepEqual(fails, ['offline'], 'kept copy stays, no error card over it');
});

test('every Profile tab loader reads through swr (a new one must too)', () => {
  for (const file of ['outline-tab.js', 'experience-profile.js', 'details-facts.js', 'experience.js']) {
    assert.match(readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8'), /\bswr\(/, `${file} shows kept data first`);
  }
});

// One shape per cache key (17 Oct 2026: Experience kept {items, ok} under `outline:profile`, Strategy read {results} from it and threw at outline-tab.js:57).
test('every cache key is written and read by one file only', () => {
  const dir = new URL('../renderer/pages/', import.meta.url);
  const users = new Map();   // key (template parts folded to *) → files using it
  for (const file of readdirSync(dir).filter(name => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const [, key] of source.matchAll(/\b(?:swr|keep)\(\s*[`'"]((?:\$\{[^}]*\}|[^`'"])+)[`'"]/g)) {
      const folded = key.replace(/\$\{[^}]*\}/g, '*');
      users.set(folded, new Set([...(users.get(folded) || []), file]));
    }
  }
  assert.ok(users.size >= 4, 'the scan finds the keys');
  const pattern = key => new RegExp(`^${key.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
  for (const [key, files] of users) {
    const sharing = new Set(files);
    for (const [other, otherFiles] of users) if (pattern(key).test(other) || pattern(other).test(key)) otherFiles.forEach(file => sharing.add(file));
    assert.equal(sharing.size, 1, `cache key ${key} is used by ${[...sharing].join(', ')}: one shape per key means one owner file`);
  }
});

test('Experience then Strategy: the kept Experience read is not what Strategy paints from', () => {
  const experience = readFileSync(new URL('../renderer/pages/experience-profile.js', import.meta.url), 'utf8');
  const outline = readFileSync(new URL('../renderer/pages/outline-tab.js', import.meta.url), 'utf8');
  assert.doesNotMatch(experience, /outline:/, 'Experience does not share the Strategy outline keys');
  assert.match(outline, /outline:\$\{names\.join/);
});

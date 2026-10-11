// lib/row-case-run.mjs: a row case passes when its replay shows its expect, asks no model call the case did not keep, and reaches no unrecorded address. The replay itself is injected.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isRowCase, runRowCase} from '../lib/row-case-run.mjs';

const item = {name: 'x-1', dir: '/x', replay: 'row', expect: {kinds: ['posting', 'form']}};
const result = (kinds, extra = {}) => ({appLog: kinds.map(kind => `12:00:00Z [extension] page kind: ${kind} {}`).join('\n'), requests: [], misses: 0, unrecorded: [], seconds: 4, ...extra});

test('a row case is told by its replay marker; it passes when the replay shows its expect', async () => {
  assert.ok(isRowCase(item) && !isRowCase({name: 'y'}));
  assert.deepEqual((await runRowCase(item, {replay: async () => result(['posting', 'form'])})).failures, []);
});

test('it fails on the old shape, on a cold ask, on an unrecorded address, and on a case with no expect', async () => {
  assert.match((await runRowCase(item, {replay: async () => result(['posting'])})).failures[0], /page kinds: posting, expected posting, form/);
  assert.match((await runRowCase(item, {replay: async () => result(['posting', 'form'], {misses: 2})})).failures[0], /2 model ask\(s\) not in the case's kept answers/);
  assert.match((await runRowCase(item, {replay: async () => result(['posting', 'form'], {unrecorded: ['https://a.example/x']})})).failures[0], /address not recorded/);
  assert.match((await runRowCase({...item, expect: {}}, {replay: async () => result(['posting'])})).failures[0], /no expect/);
});

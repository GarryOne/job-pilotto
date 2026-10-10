// When the AI is asked whether an application form is ready (extension/form-ready.js): only when the panel's own count claims it, never on an account page.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {claimsReady} from '../../extension/form-ready.js';

test('the AI is asked only when the count says every required field is filled on an application page', () => {
  assert.equal(claimsReady({total: 8, left: 0, account: false}), true);
  assert.equal(claimsReady({total: 8, left: 2, account: false}), false);   // not ready by the count: nothing to veto
  assert.equal(claimsReady({total: 0, left: 0, account: false}), false);   // no required field seen
  assert.equal(claimsReady({total: 8, left: 0, account: true}), false);   // an account page has its own judge
  assert.equal(claimsReady(undefined), false);
});

// 9 Oct 2026, Deloitte's CV step: the CV was attached, the step was done, and nothing asked the AI what comes next, since the panel's HTML count was not "ready".
test('after a fill the AI is asked what the page needs next, whatever the count says, once per page state', async () => {
  const {formNext} = await import('../../extension/form-ready.js');
  const asked = [], decided = [];
  const keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  globalThis.chrome = {
    storage: {local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    scripting: {executeScript: async () => [{result: {url: 'https://apply.example/m', title: 'My CV', headings: [], controls: [], buttons: ['Continue'], texts: ['CV attached'], frames: []}}]},
    runtime: {getManifest: () => ({version: '0'})}};
  globalThis.fetch = async (url, init) => { asked.push([String(url), JSON.parse(init?.body || '{}')]); return {ok: true, status: 200, json: async () => ({answer: 'ready', step: 'middle', nextControl: ''}), text: async () => '{}'}; };
  try {
    await formNext({id: 71, url: 'https://apply.example/m'}, 0);
    await formNext({id: 71, url: 'https://apply.example/m'}, 0);   // the same page state: not asked again
  } finally { Object.assign(globalThis, keep); }
  const judge = asked.filter(([url]) => /account-judge/.test(url));
  assert.equal(judge.length, 1, `asked ${judge.length} times: ${JSON.stringify(asked.map(([url]) => url))}`);
  assert.equal(judge[0][1].phase, 'form');
});

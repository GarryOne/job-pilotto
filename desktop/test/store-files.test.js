// A job's files through the engine's `applications files` read: base64 → data: URLs, a file over the cap listed without its bytes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as engine from '../lib/store/engine.js';
import {isImage, jobFiles} from '../lib/store/files.js';

test('a job\'s files come as data: URLs; one over the cap is listed without its bytes', async () => {
  const calls = [];
  const call = async (_, entity, method, kwargs) => {
    calls.push([entity, method, kwargs]);
    return [{name: 'reply.png', content_type: 'image/png', size: 3, data: 'AAEC', too_large: false},
      {name: 'call.m4a', content_type: 'audio/mp4', size: 9e7, data: null, too_large: true}];
  };
  const [shot, big] = await jobFiles({}, 'app-1', {call});
  assert.deepEqual(calls, [['applications', 'files', {app_id: 'app-1'}]]);
  assert.deepEqual(shot, {name: 'reply.png', type: 'image/png', size: 3, tooLarge: false, url: 'data:image/png;base64,AAEC'});
  assert.deepEqual([big.tooLarge, big.url, isImage(shot), isImage(big)], [true, null, true, false]);
  assert.deepEqual(await jobFiles({}, '', {call}), []);
});

test('the engine answer is read as the store CLI prints it', async () => {
  const run = async (_, args) => {
    assert.deepEqual(args.slice(0, 4), ['src.stores', 'call', 'applications', 'files']);
    return {code: 0, stdout: '{"result": [{"name": "a.png", "content_type": "image/png", "size": 1, "data": "AA==", "too_large": false}]}'};
  };
  const [file] = await jobFiles({}, 'x', {call: (storage, entity, method, kwargs) => engine.call(storage, entity, method, kwargs, {run})});
  assert.equal(file.url, 'data:image/png;base64,AA==');
});

test('a file the app made goes on the job in the store, by its path; no application yet: nothing written', async () => {
  const calls = [];
  const call = async (_, entity, method, kwargs) => { calls.push([entity, method, kwargs]); return method === 'get' ? (kwargs.url === 'https://x/1' ? {id: 'a1'} : null) : 'kept'; };
  const {attachToJob} = await import('../lib/store/files.js');
  assert.equal(await attachToJob({}, 'https://x/1', '/app/cv/tailored/abc.pdf', {name: 'CV · Acme · SRE.pdf', call}), true);
  assert.deepEqual(calls.at(-1), ['applications', 'attach', {app_id: 'a1', name: 'CV · Acme · SRE.pdf', content_type: 'application/pdf', path: '/app/cv/tailored/abc.pdf'}]);
  assert.equal(await attachToJob({}, 'https://x/2', '/app/cv/tailored/def.pdf', {call}), false);
  assert.equal(calls.filter(([, method]) => method === 'attach').length, 1);
});

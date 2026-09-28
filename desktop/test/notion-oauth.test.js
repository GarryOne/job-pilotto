import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as oauth from '../lib/notion-oauth.js';

test('Connect with Notion: opens the website with a random session, waits for approval, collects the token once', async () => {
  const opened = [], asked = [];
  let polls = 0;
  const fetcher = async (url, init) => {
    asked.push(JSON.parse(init.body).session);
    polls += 1;
    const body = polls < 3 ? {ok: false, pending: true} : {ok: true, access_token: 'ntn_user', workspace_name: 'Igor Mardari\'s Space'};
    return {status: 200, json: async () => body};
  };
  const result = await oauth.connect(url => opened.push(url), {fetcher, sleep: async () => {}, site: 'https://site.test'});
  assert.equal(result.access_token, 'ntn_user');
  const session = new URL(opened[0]).searchParams.get('session');
  assert.match(opened[0], /^https:\/\/site\.test\/api\/notion\/start\?session=/);
  assert.ok(session.length >= 43);
  assert.ok(asked.every(s => s === session));  // only this app's session can collect it
});

test('not set up on the website, or no answer: a clear message', async () => {
  const unavailable = async () => ({status: 503, json: async () => ({ok: false})});
  assert.match((await oauth.connect(() => {}, {fetcher: unavailable, sleep: async () => {}})).error, /Paste a token instead/);
  const pending = async () => ({status: 200, json: async () => ({ok: false, pending: true})});
  assert.match((await oauth.connect(() => {}, {fetcher: pending, sleep: async () => {}, every: 1000, timeout: 3000})).error, /5 minutes/);
});

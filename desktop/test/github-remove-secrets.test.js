// Gmail disconnected on the Mac (7 Oct 2026): with Always on, the repo's Google secrets go too, or the cloud check would go on reading the mail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {removeRepoSecrets} from '../lib/github.js';
import {GOOGLE_KEYCHAIN} from '../lib/google-keys.js';

const storage = (cloud, token = 't') => ({settings: () => ({cloud}), secret: name => (name === 'GITHUB_TOKEN' ? token : '')});

test('each Google secret is deleted from the repo; one already gone is fine', async () => {
  const asked = [];
  const fetcher = async (url, options) => {
    asked.push(`${options.method} ${new URL(url).pathname}`);
    return url.endsWith('GOOGLE_CLIENT_ID') ? new Response('{}', {status: 404}) : new Response(null, {status: 204});
  };
  assert.equal(await removeRepoSecrets(storage({repo: 'me/jp'}), Object.keys(GOOGLE_KEYCHAIN), {fetcher}), true);
  assert.deepEqual(asked, Object.keys(GOOGLE_KEYCHAIN).map(name => `DELETE /repos/me/jp/actions/secrets/${name}`));
});

test('without Always on nothing is asked', async () => {
  assert.equal(await removeRepoSecrets(storage(null), ['GOOGLE_REFRESH_TOKEN'], {fetcher: () => assert.fail('asked GitHub')}), false);
});

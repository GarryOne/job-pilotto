// The product media's checks (desktop/scripts/media/check.mjs): an address that may be real, a real key in a persona folder, a light window or a
// form the extension did not fill each stop the run.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {missingFills, pieceProblems, realEmails, realSecrets} from '../scripts/media/check.mjs';
import {missingEncoders} from '../scripts/media/encode.mjs';

test('only e-mail addresses on reserved test domains pass', () => {
  assert.deepEqual(realEmails('alex.morgan@example.com · ada@tester.example · x@y.test · hr@northwind.example.org'), []);
  assert.deepEqual(realEmails('write to someone@gmail.com or jobs@acme.ch'), ['someone@gmail.com', 'jobs@acme.ch']);
});

test('a persona folder with a real-looking key is refused; the demo placeholders pass', () => {
  assert.deepEqual(realSecrets({ANTHROPIC_API_KEY: 'demo-key-not-real-0000000000', NOTION_TOKEN: 'demo'}), []);
  assert.deepEqual(realSecrets({NOTION_TOKEN: 'ntn_5f8a2c9d1e3b4a6f7c8d9e0a1b2c3d4e'}), ['NOTION_TOKEN']);
});

test('the clip must show the extension filling the required fields and the questions', () => {
  assert.deepEqual(missingFills(['first_name', 'last_name', 'email', 'resume', 'permit', 'privacy', 'notice']), []);
  assert.deepEqual(missingFills(['first_name', 'last_name', 'email', 'resume', 'privacy']), ['permit']);
});

test('a piece is refused for a light window, a stalled capture or a real address', () => {
  const frames = Array.from({length: 100}, (_, i) => ({t: i / 10}));
  assert.deepEqual(pieceProblems({name: 'hero', source: 'app', log: {frames, text: 'Alex Morgan'}, posterBrightness: 0.12}), []);
  const problems = pieceProblems({name: 'hero', source: 'app', log: {frames: frames.slice(0, 3).concat([{t: 10}]), text: 'me@gmail.com'}, posterBrightness: 0.8});
  assert.equal(problems.length, 3);
});

test('a run stops before recording when ffmpeg lacks an encoder the pieces need', () => {
  const list = ' V..... libx264  H.264\n V..... libvpx-vp9  VP9\n V..... libwebp  WebP\n';
  assert.deepEqual(missingEncoders(list), []);
  assert.deepEqual(missingEncoders(list.replace('libwebp', 'png')), ['libwebp']);
  assert.deepEqual(missingEncoders(list.replace(' libwebp ', ' libwebp_anim ')), ['libwebp'], 'the animated-only encoder is not enough');
});

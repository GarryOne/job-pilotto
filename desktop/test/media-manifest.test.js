// The product media's manifest (desktop/scripts/media/manifest.mjs), the shape the site redesign reads, and the scenes it describes: every
// piece the site places has its words and sizes; captions stay short and in the manifest, never in the video.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {manifest, stillEntry, VERSION, videoEntry} from '../scripts/media/manifest.mjs';
import {SNIPS, STILLS, VIDEOS} from '../scripts/media/scenes.mjs';

test('a video entry carries the agreed fields; a partial run keeps the other entries', () => {
  const hero = videoEntry({name: 'hero', piece: VIDEOS.hero, files: {mp4: 'hero.mp4', webm: 'hero.webm', poster: 'hero-poster.jpg', phone: 'hero-720.mp4'}, bytes: {mp4: 1}, seconds: 14.44});
  assert.deepEqual(Object.keys(hero), ['name', 'kind', 'theme', 'shows', 'caption', 'alt', 'files', 'width', 'height', 'duration_s', 'bytes']);
  assert.equal(hero.duration_s, 14.4);
  assert.equal(hero.theme, 'dark');
  const still = stillEntry({name: 'jobs', kind: 'still', file: 'still-jobs.webp', bytes: 9, width: 1600, height: 1000, shows: 'Jobs'});
  const first = manifest({entries: [hero, still], made: {sha: 'abc', at: 'now', persona: 'demo'}});
  assert.equal(first.version, VERSION);
  const again = manifest({entries: [{...hero, caption: 'New'}], previous: first, made: {sha: 'def', at: 'later', persona: 'demo'}});
  assert.equal(again.items.length, 2, 'the still is kept');
  assert.equal(again.items.find(item => item.name === 'hero').caption, 'New');
  assert.equal(again.made_from, 'def');
});

test('every piece has the words the site needs; video captions are 6 words at most; the hero fits 2.5 MB and has a phone copy', () => {
  for (const [name, piece] of Object.entries(VIDEOS)) {
    for (const key of ['shows', 'caption', 'alt']) assert.ok(piece[key], `${name}.${key}`);
    assert.ok(piece.caption.split(/\s+/).length <= 6, `${name}: caption over 6 words`);
    assert.equal(piece.width / piece.height, 1.6, `${name}: 16:10`);
    assert.ok(piece.budget > 0 && piece.steps.length, name);
  }
  assert.ok(VIDEOS.hero.budget <= 2.5e6 && VIDEOS.hero.phone === 720);
  for (const [name, item] of [...Object.entries(STILLS), ...Object.entries(SNIPS)]) assert.ok(item.shows && item.steps.length, name);
});

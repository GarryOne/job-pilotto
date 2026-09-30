// A pasted screenshot goes to Notion as a small JPEG, not the full-size file (desktop/lib/shots.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import {smallCopy, SMALL_WIDTH} from '../lib/shots.js';

// Electron's nativeImage, reduced to what the helper calls.
const fakeImages = (width, height) => ({
  createFromBuffer: () => ({
    isEmpty: () => width === 0,
    getSize: () => ({width, height}),
    resize: ({width: w}) => ({toJPEG: quality => Buffer.from(`jpeg ${w} q${quality}`)}),
    toJPEG: quality => Buffer.from(`jpeg ${width} q${quality}`),
  }),
});

test('a wide screenshot is shrunk to the small width as a JPEG', () => {
  assert.equal(smallCopy(fakeImages(1600, 3000), Buffer.from('png')).toString(), `jpeg ${SMALL_WIDTH} q70`);
});

test('one already narrow is only re-encoded, never enlarged', () => {
  assert.equal(smallCopy(fakeImages(500, 900), Buffer.from('png')).toString(), 'jpeg 500 q70');
});

test('what cannot be read as an image gives no copy (the original is uploaded)', () => {
  assert.equal(smallCopy(fakeImages(0, 0), Buffer.from('not an image')), null);
  assert.equal(smallCopy({createFromBuffer: () => { throw new Error('bad'); }}, Buffer.from('x')), null);
});

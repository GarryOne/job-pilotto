import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rank} from '../renderer/palette.js';
import {osText} from '../renderer/os.js';

const commands = [
  {label: 'Open Jobs', keywords: 'page view'},
  {label: 'Search now', hint: 'Look for new jobs', keywords: 'search jobs find refresh'},
  {label: 'Check Gmail', hint: 'Confirmations, replies, interviews (if connected)', keywords: 'email inbox replies'},
  {label: 'Open Settings', keywords: 'page view'},
  {label: 'Record interview', keywords: 'start call audio'},
];
const labels = list => list.map(command => command.label);

test('the palette finds a command by the words you type, filler words ignored', () => {
  assert.equal(rank(commands, 'Check for gmail')[0].label, 'Check Gmail');
  assert.equal(rank(commands, 'gmail')[0].label, 'Check Gmail');
  assert.equal(rank(commands, 'email')[0].label, 'Check Gmail');     // a keyword
  assert.equal(rank(commands, 'sett')[0].label, 'Open Settings');    // a word's start
  assert.equal(rank(commands, 'record')[0].label, 'Record interview');
  assert.deepEqual(labels(rank(commands, 'gmail calendar zebra')), []);  // every meaningful word must match
});

test('the label counts more than keywords, and an empty query lists everything in order', () => {
  assert.deepEqual(labels(rank(commands, 'jobs')), ['Open Jobs', 'Search now']);
  assert.deepEqual(labels(rank(commands, '')), labels(commands));
  assert.deepEqual(labels(rank(commands, 'the')), []);  // only filler: taken literally
});

test('Windows reads Ctrl+K', () => {
  assert.equal(osText('⌘K  Commands', 'win32'), 'Ctrl+K  Commands');
});

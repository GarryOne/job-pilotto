// Recorded pages (e2e/recorded) go into this PUBLIC repo: no personal data may be in them (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md).
// Everywhere: only example.* emails, no phone numbers, no typed values (value="…"), no URL query strings (sign-in states, tokens).
// On a Mac with the app: none of the person's own values either (emails, phones and names from profile.md / answers.md). A failure names the kind, never the value.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const REPLAY = new URL('../e2e/recorded/', import.meta.url);
const files = () => (fs.existsSync(REPLAY) ? fs.readdirSync(REPLAY).flatMap(dir => {
  const folder = new URL(`${dir}/`, REPLAY);
  return fs.statSync(folder).isDirectory() ? fs.readdirSync(folder).map(name => ({name: `${dir}/${name}`, text: fs.readFileSync(new URL(name, folder), 'utf8')})) : [];
}) : []);
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, PHONE = /(\+\d[\d\s().-]{8,}\d)|(\b0\d{2}[\s.]\d{3}[\s.]\d{2}[\s.]\d{2}\b)/;

test('recorded pages hold no email but example.*, no phone, no typed value, no URL query', () => {
  const found = [];
  for (const {name, text} of files()) {
    for (const email of text.match(EMAIL) || []) if (!/@example\.(com|org|net)$/i.test(email)) found.push(`${name}: an email`);
    if (PHONE.test(text)) found.push(`${name}: a phone number`);
    if (/<(input|option)\b[^>]*\bvalue="[^"]+"[^>]*>/i.test(text) && !/type="(submit|button|hidden)"/i.test(text.match(/<input\b[^>]*\bvalue="[^"]+"[^>]*>/i)?.[0] || 'type="button"')) found.push(`${name}: a typed value`);
    if (/https?:\/\/[^"'\s]+\?[^"'\s]+/i.test(text)) found.push(`${name}: a URL query string`);
  }
  assert.deepEqual(found, []);
});

test('on this Mac: none of the person\'s own values (from the app\'s profile) is in a recorded page', {skip: !fs.existsSync(path.join(os.homedir(), 'Library/Application Support/Job Pilotto/profile.md')) && 'no app profile on this computer'}, () => {
  const folder = path.join(os.homedir(), 'Library/Application Support/Job Pilotto');
  const own = ['profile.md', 'answers.md'].map(name => { try { return fs.readFileSync(path.join(folder, name), 'utf8'); } catch { return ''; } }).join('\n');
  const values = new Map();
  for (const email of own.match(EMAIL) || []) values.set(email.toLowerCase(), 'an email of yours');
  for (const phone of own.match(/\+?\d[\d\s().-]{8,}\d/g) || []) values.set(phone.replace(/\D/g, ''), 'a phone number of yours');
  for (const [, value] of own.matchAll(/^\W*(?:full\s*)?(?:first\s*|last\s*|family\s*)?name\W*:\s*(.+)$/gim)) for (const word of value.split(/\s+/)) if (word.length >= 3) values.set(word.toLowerCase(), 'your name');
  const found = [];
  for (const {name, text} of files()) {
    const lower = text.toLowerCase(), digits = text.replace(/\D/g, '');
    for (const [value, kind] of values) if (/^\d+$/.test(value) ? value.length >= 9 && digits.includes(value) : new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) found.push(`${name}: ${kind}`);
  }
  assert.deepEqual([...new Set(found)], []);
});

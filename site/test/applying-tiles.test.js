// The Lab Form Filling tiles' colours: every coloured tile x (good, middle, bad) value, and the regressions split (a posting gone is never counted).
import test from 'node:test';
import assert from 'node:assert/strict';
import {COUNT, SHARE, TILE_RULE, tileTones} from '../src/applying-tiles.js';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {needsFixOrder} from '../src/applying-order.js';
import {data, ingest} from '../src/applying.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}

const CASES = {   // tile -> how to feed its value, and the values for each tone
  resolved: {feed: v => tileTones({}, v).resolved, good: [100, 74, SHARE.target], warn: [SHARE.target - 1, 60, SHARE.floor], bad: [SHARE.floor - 1, 0]},
  reached: {feed: v => tileTones({reachedForm: v}).reached, good: [100, SHARE.target], warn: [63, SHARE.floor], bad: [49, 0]},
  regressions: {feed: v => tileTones({regressions: v}).regressions, good: [0], warn: [1, COUNT.small], bad: [COUNT.small + 1, 40]},
  needFix: {feed: v => tileTones({needFix: v}).needFix, good: [0], warn: [1, COUNT.small], bad: [COUNT.small + 1, 16]},
  dropped: {feed: v => tileTones({dropped: v}).dropped, good: [0], warn: [2], bad: [9]},
};

test('every tile: its tone for a good, a middle and a bad value, and a rule in its tooltip', () => {
  for (const [tile, {feed, ...tones}] of Object.entries(CASES)) {
    for (const [tone, values] of Object.entries(tones)) for (const value of values) assert.equal(feed(value), tone, tile + ' at ' + value);
    assert.match(TILE_RULE[tile], /Green at/, tile + ' says its thresholds');
  }
  assert.deepEqual(Object.keys(TILE_RULE).sort(), Object.keys(CASES).sort(), 'a new coloured tile needs its cases here');
  assert.equal(tileTones({reachedForm: null}, null).resolved + tileTones({reachedForm: null}).reached, '', 'nothing measured: no colour');
});

test('open regressions count our build only; a regression on a posting that is gone is the grey note; the fix tile equals the Needs a fix list', async () => {
  const db = d1(), now = new Date('2026-10-12T12:00:00Z');
  await ingest(db, {kind: 'smoke', day: '2026-10-11', rows: [{name: 'Ours', host: 'a.example.com', reached: 'posting', regression: true}, {name: 'Closed', host: 'b.example.com', reached: 'none', regression: true, note: 'posting gone'}]}, now);
  const d = await data(db, now), {regressions, regressionsApart, needFix} = d.tiles;
  assert.deepEqual([regressions, regressionsApart], [1, 1]);
  assert.equal(needFix, needsFixOrder(d.pool, d.scorecard, d.steps).rows.length, 'one count for the tile and the list');
  assert.deepEqual(d.tileTones, {resolved: '', reached: tileTones(d.tiles).reached, regressions: 'warn', needFix: 'warn', dropped: 'good'});
});

// The setup prompt's rule for job-board searches (lib/strategy.js INSTRUCTIONS): each is the role title alone, as job ads in the user's places
// write it, with no level, town or contract words. 18 Oct 2026: StepStone gave 5 jobs for "LKW Fahrer CE" and 148 for "lkw-fahrer"; jobscout24
// answered "senior site reliability engineer" with every job it had (nurses, heating technicians). The board's place field and the crawler's
// own role, level and place filters do the narrowing.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {INSTRUCTIONS} from '../lib/strategy.js';

test('board searches are the role title alone: no level, town or contract words', () => {
  const rule = INSTRUCTIONS.slice(INSTRUCTIONS.indexOf('jobs_board_search_queries'));
  assert.match(rule, /role title alone/);
  assert.match(rule, /no seniority level, no town, no contract or hours words/);
  assert.match(rule, /in the language job ads in their places use/);
});

test('Google Jobs queries keep their own rule', () => {
  assert.match(INSTRUCTIONS, /google_jobs\.queries are plain search phrases \(3 to 6\)/);
});

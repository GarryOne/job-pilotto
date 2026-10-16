// An owner-seen bug is proven on the owner's own page (tools/owner-report.mjs): the trailer, a captured case with the report id, never a hand-cut one.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NAMES_A_FAILURE, LABEL_KEYS} from '../../tools/recorded-cases.mjs';
import {ownerReportProblem, reportOf} from '../../tools/owner-report.mjs';

const commit = (message, files = []) => ({message, files});
const cases = {mine: {origin: 'captured', report: 'a1b2c3'}, cut: {origin: 'hand-cut', report: 'a1b2c3'}, other: {origin: 'captured', report: 'ffffff'}};
const look = name => cases[name] || null;

test('every way of saying the owner saw the bug needs the trailer, the same for each', () => {
  for (const text of ['Fix the select the owner saw', 'Fix what the owner reported', 'Fix the form reported by the owner', 'Fix ⚑ report', 'Fix a Report this form miss', 'owner-seen select bug']) {
    assert.match(ownerReportProblem([commit(text)], look), /Owner-report: <report id>/, text);
  }
  assert.equal(ownerReportProblem([commit('Fix a log line')], look), '', 'no claim, no trailer needed');
});

test('a captured case carrying the report id proves it; hand-cut, missing or another report does not', () => {
  const ok = commit('Fix the select the owner saw\n\nOwner-report: a1b2c3', ['desktop/e2e/recorded/mine/case.json']);
  assert.equal(ownerReportProblem([ok], look), '');
  assert.match(ownerReportProblem([commit('Fix X\n\nOwner-report: a1b2c3', ['desktop/e2e/recorded/cut/case.json'])], look), /hand-cut/);
  assert.match(ownerReportProblem([commit('Fix X\n\nOwner-report: a1b2c3', ['desktop/e2e/recorded/other/case.json'])], look), /no recorded case/);
  assert.match(ownerReportProblem([commit('Fix X\n\nOwner-report: a1b2c3')], look), /no recorded case/);
});

test('"Owner-report: none" needs a reason; with one it is the way out; the trailer alone is a claim', () => {
  assert.equal(ownerReportProblem([commit('Fix the owner saw\n\nOwner-report: none a rule, no page shows it')], look), '');
  assert.match(ownerReportProblem([commit('Fix the owner saw\n\nOwner-report: none')], look), /needs a reason/);
  assert.equal(reportOf('x\n\nOwner-report: a1b2c3').claims, true);
});

test('an owner report names a failure (no "Recorded-pins"), and report is a label of the case, not part of the replay', () => {
  assert.ok(NAMES_A_FAILURE.test('Fix X\n\nOwner-report: a1b2c3'));
  assert.ok(!NAMES_A_FAILURE.test('Pin X\n\nOwner-report: none a rule'));
  assert.ok(LABEL_KEYS.includes('report'));
});

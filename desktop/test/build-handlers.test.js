// The two IPC handlers behind "Restart to get N fixes" (lib/build-handlers.js): the state a window asks for, and the restart.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerBuildHandlers} from '../lib/build-handlers.js';

const make = (options = {}) => {
  const handlers = {}, calls = [];
  registerBuildHandlers({app: {relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit')}, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, FROM_SOURCE: true, repo: '/r', packaged: null,
    head: () => ({commit: 'abc1234', time: '2026-10-16T14:02:00+02:00'}), count: ({running}) => ({label: `label ${running.commit}`, commit: running.commit, ahead: 2}), ...options});
  return {handlers, calls};
};

test('a source run reports the commit it started on and the fixes waiting in the checkout', async () => {
  const state = await make().handlers.buildState();
  assert.deepEqual({label: state.label, ahead: state.ahead, restart: state.restart, fromSource: state.fromSource}, {label: 'label abc1234', ahead: 2, restart: 'Restart to get 2 fixes', fromSource: true});
});

test('a package is never "ahead" here: its fixes come through the Update button; it says its version and links the changelog', async () => {
  const state = await make({FROM_SOURCE: false, packaged: {commit: 'def5678', time: ''}, app: {getVersion: () => '0.7.0'}}).handlers.buildState();
  assert.deepEqual({label: state.label, ahead: state.ahead, whatsNew: state.whatsNew}, {label: 'v0.7.0', ahead: 0, whatsNew: 'https://www.jobpilotto.top/changelog'});
  assert.equal(state.restart, '');
});

test('a source run keeps the commit and time and has no changelog link, even with a version', async () => {
  const state = await make({app: {getVersion: () => '0.7.0', relaunch() {}, quit() {}}}).handlers.buildState();
  assert.deepEqual({label: state.label, whatsNew: state.whatsNew}, {label: 'label abc1234', whatsNew: undefined});
});

test('restart relaunches and quits (the quit guard still asks when a job runs)', async () => {
  const {handlers, calls} = make();
  assert.deepEqual(await handlers.restartApp(), {ok: true});
  assert.deepEqual(calls, ['relaunch', 'quit']);
});

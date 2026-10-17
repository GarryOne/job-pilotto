// Ready to send, the app's calls to the site (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): is this install the owner's, send tonight's batch, start it now, read the morning's rows, mark a job Done.
// The install's own key (the one Free AI uses) is the only credential; the site answers 404 or 401 to anyone but the owner, so the card is shown only when `owner` says yes. Guard: test/ready-site.test.js.
import {call} from './hosted-search.js';

const words = result => (result.ok ? result : {ok: false, status: result.status, error: result.status === 401 || result.status === 404 ? 'Ready to send is not on for this install.' : result.error});

export const owner = async (storage, options) => (await call(storage, '/api/ready/state', options)).ok === true;
export const rows = async (storage, options) => words(await call(storage, '/api/ready/state', options));   // -> {ok, batch: {night, state, costUsd, expiresAt}, jobs: [...]}
export const send = async (storage, batch, options) => words(await call(storage, '/api/ready/batch', {method: 'POST', body: batch, ...options}));
export const runNow = async (storage, options) => words(await call(storage, '/api/ready/run', {method: 'POST', body: {}, ...options}));
export const done = async (storage, job, options) => words(await call(storage, '/api/ready/done', {method: 'POST', body: {job}, ...options}));
export const deleteAll = async (storage, options) => words(await call(storage, '/api/ready/data', {method: 'DELETE', ...options}));

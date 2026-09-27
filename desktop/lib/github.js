// "Keep searching while my Mac is off": the user's own private GitHub repo runs the searches on a
// schedule. The app signs in to GitHub (device flow: the user approves a code in the browser), creates
// <user>/job-pilotto-private, commits the scheduled workflows (templates/github-actions) and the user's
// search settings, and stores their keys as encrypted repository secrets. Each run executes the public
// engine (GarryOne/job-pilotto) with those secrets, so logs and data stay in the user's private repo.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

import {MODELS, REPO} from './pipeline.js';

// Public identifier of the Job Pilotto GitHub OAuth app (device flow needs no client secret).
export const CLIENT_ID = process.env.JOB_PILOTTO_GITHUB_CLIENT_ID || 'Ov23liJobPilottoPending';
export const SCOPES = 'repo workflow';
export const REPO_NAME = 'job-pilotto-private';
const API = 'https://api.github.com';

// Keys the cloud runs need (secrets), and what the app's own runs set (variables): same values as pipelineEnv.
export const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY'];
const MODEL_VARIABLES = {
  JOB_PILOTTO_ENRICH_MODEL: 'enrich', JOB_PILOTTO_SCORE_MODEL: 'score', JOB_PILOTTO_KIT_MODEL: 'kit',
  JOB_PILOTTO_INSIGHT_MODEL: 'insight', JOB_PILOTTO_MAIL_MODEL: 'enrich',
};
const CONFIG_FILES = ['search.json', 'preferences.json'];

// libsodium's ESM build is broken; its CommonJS build works everywhere.
const sodium = createRequire(import.meta.url)('libsodium-wrappers');

async function form(url, body, fetcher) {
  const response = await fetcher(url, {method: 'POST', headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
    body: JSON.stringify(body)});
  return response.json();
}

// Step 1 of the sign-in: a code for the user to enter at github.com/login/device.
export async function startSignIn(fetcher = globalThis.fetch) {
  const data = await form('https://github.com/login/device/code', {client_id: CLIENT_ID, scope: SCOPES}, fetcher);
  if (!data.device_code) throw new Error(data.error_description || 'GitHub did not start the sign-in');
  return {deviceCode: data.device_code, userCode: data.user_code, url: data.verification_uri,
    interval: data.interval || 5, expiresIn: data.expires_in || 900};
}

// Step 2: wait until the user approves; returns the access token.
export async function finishSignIn(start, {fetcher = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  let interval = start.interval;
  const until = Date.now() + start.expiresIn * 1000;
  while (Date.now() < until) {
    await sleep(interval * 1000);
    const data = await form('https://github.com/login/oauth/access_token', {client_id: CLIENT_ID, device_code: start.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'}, fetcher);
    if (data.access_token) return data.access_token;
    if (data.error === 'slow_down') interval = data.interval || interval + 5;
    else if (data.error !== 'authorization_pending') throw new Error(data.error_description || data.error || 'GitHub sign-in failed');
  }
  throw new Error('The GitHub code expired. Start again.');
}

export function client(token, fetcher = globalThis.fetch) {
  return async function api(method, route, body) {
    const response = await fetcher(`${API}${route}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'job-pilotto-desktop', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.message || `GitHub ${response.status}`), {status: response.status});
    return data;
  };
}

// The user's private repo: reused if it exists, else created (private, with a first commit).
export async function ensureRepo(api) {
  const {login} = await api('GET', '/user');
  const full = `${login}/${REPO_NAME}`;
  try {
    const repo = await api('GET', `/repos/${full}`);
    if (!repo.private) throw new Error(`${full} exists and is public. Make it private (or rename it) and try again.`);
    return {login, repo: full, created: false};
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  await api('POST', '/user/repos', {name: REPO_NAME, private: true, auto_init: true,
    description: 'My Job Pilotto: scheduled job searches (secrets and settings stay private)'});
  return {login, repo: full, created: true};
}

// Create or update one file on the default branch; unchanged content is left alone.
export async function putFile(api, repo, file, content, message) {
  let sha;
  try {
    const current = await api('GET', `/repos/${repo}/contents/${file}`);
    if (Buffer.from(current.content || '', 'base64').toString() === content) return false;
    sha = current.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  await api('PUT', `/repos/${repo}/contents/${file}`, {message, content: Buffer.from(content).toString('base64'), ...(sha ? {sha} : {})});
  return true;
}

export async function setSecrets(api, repo, secrets) {
  await sodium.ready;
  const {key, key_id} = await api('GET', `/repos/${repo}/actions/secrets/public-key`);
  const publicKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  for (const [name, value] of Object.entries(secrets)) {
    const sealed = sodium.to_base64(sodium.crypto_box_seal(value, publicKey), sodium.base64_variants.ORIGINAL);
    await api('PUT', `/repos/${repo}/actions/secrets/${name}`, {encrypted_value: sealed, key_id});
  }
}

export async function setVariables(api, repo, variables) {
  for (const [name, value] of Object.entries(variables)) {
    try {
      await api('POST', `/repos/${repo}/actions/variables`, {name, value});
    } catch (error) {
      if (error.status !== 409) throw error;
      await api('PATCH', `/repos/${repo}/actions/variables/${name}`, {name, value});
    }
  }
}

// What goes to the repo: the scheduled workflows, the user's search settings, keys and Notion IDs.
export function payload(storage, templatesDir = path.join(REPO, 'templates', 'github-actions')) {
  const files = {};
  for (const name of fs.readdirSync(templatesDir).filter(name => name.endsWith('.yml'))) {
    files[`.github/workflows/${name}`] = fs.readFileSync(path.join(templatesDir, name), 'utf8');
  }
  files['README.md'] = fs.readFileSync(path.join(templatesDir, 'README.md'), 'utf8');
  for (const name of CONFIG_FILES) {
    const text = storage.readText(`config/${name}`);
    if (text) files[`config/${name}`] = text;
  }
  const settings = storage.settings();
  const secrets = Object.fromEntries(SECRET_NAMES.map(name => [name, storage.secret(name)]).filter(([, value]) => value));
  if (settings.telegramChatId) secrets.TELEGRAM_CHAT_ID = String(settings.telegramChatId);
  const variables = Object.fromEntries(Object.entries(settings.notionIds || {}).filter(([, value]) => value));
  if (secrets.ANTHROPIC_API_KEY) {
    for (const [name, stage] of Object.entries(MODEL_VARIABLES)) variables[name] = MODELS[stage];
  }
  return {files, secrets, variables};
}


// Everything in one go; safe to run again (after a key or setting changes).
export async function connect(storage, token, {fetcher, onStep = () => {}} = {}) {
  const api = client(token, fetcher);
  onStep('Creating your private repository…');
  const {login, repo, created} = await ensureRepo(api);
  const {files, secrets, variables} = payload(storage);
  onStep('Adding the schedules and your search settings…');
  for (const [file, content] of Object.entries(files)) await putFile(api, repo, file, content, `Job Pilotto: ${file}`);
  onStep('Storing your keys as encrypted secrets…');
  await setSecrets(api, repo, secrets);
  await setVariables(api, repo, variables);
  storage.saveSettings({cloud: {repo, login, since: storage.settings().cloud?.since || new Date().toISOString(), updatedAt: new Date().toISOString()}});
  return {repo, created, secrets: Object.keys(secrets), variables: Object.keys(variables)};
}

// Telegram buttons and the app's Actions start a run in the user's repo instead of on this Mac.
export function cloudDispatch(storage, onLine = () => {}, fetcher) {
  return async (inputs, workflow = 'daily.yml') => {
    const {repo} = storage.settings().cloud;
    const clean = Object.fromEntries(Object.entries(inputs || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]));
    try {
      await client(storage.secret('GITHUB_TOKEN'), fetcher)('POST', `/repos/${repo}/actions/workflows/${workflow}/dispatches`,
        {ref: 'main', inputs: clean});
      onLine(`Started ${workflow.replace('.yml', '')}${clean.mode ? ` (${clean.mode})` : ''} in ${repo}.`);
    } catch (error) {
      onLine(`Could not start the run in ${repo}: ${error.message}`);
    }
  };
}

// The job list shown in the app comes from the latest cloud run's database (its jobs-db artifact).
export async function syncDatabase(storage, {fetcher = globalThis.fetch, unzip} = {}) {
  const {repo} = storage.settings().cloud || {};
  if (!repo) return false;
  const api = client(storage.secret('GITHUB_TOKEN'), fetcher);
  const {artifacts} = await api('GET', `/repos/${repo}/actions/artifacts?name=job-pilotto-jobs-db&per_page=1`);
  const latest = artifacts?.find(artifact => !artifact.expired);
  if (!latest || latest.id === storage.settings().cloud.artifactId) return false;
  const response = await fetcher(latest.archive_download_url, {headers: {Authorization: `Bearer ${storage.secret('GITHUB_TOKEN')}`}});
  if (!response.ok) throw new Error(`Could not download the job database (${response.status})`);
  const zip = storage.path('data/jobs-db.zip');
  fs.mkdirSync(path.dirname(zip), {recursive: true});
  fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  await (unzip || unzipFile)(zip, storage.path('data'));
  fs.rmSync(zip, {force: true});
  storage.saveSettings({cloud: {...storage.settings().cloud, artifactId: latest.id, syncedAt: new Date().toISOString()}});
  return true;
}

async function unzipFile(zip, dir) {
  const {execFile} = await import('node:child_process');
  await new Promise((resolve, reject) => execFile('/usr/bin/unzip', ['-o', zip, '-d', dir], error => error ? reject(error) : resolve()));
}

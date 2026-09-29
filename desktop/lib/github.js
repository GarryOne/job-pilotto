// Always on: the user's own private GitHub repo runs the searches on a
// schedule. Least privilege: Job Pilotto is a GitHub App the user installs on that one repository
// ("Only select repositories"), so the app can't see or touch any other repo. The user creates the repo
// from the public starter template, installs the app on it, and approves a sign-in code; the app then
// commits the schedule and search settings, and stores their keys as encrypted repository secrets. Each run executes the public
// engine (GarryOne/job-pilotto) with those secrets, so logs and data stay in the user's private repo.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

import {cadence, crons, withSchedule} from './cadence.js';
import {MODELS, REPO} from './pipeline.js';
import {tar} from './tar.js';

// The Job Pilotto GitHub App (public identifiers; device flow needs no client secret). Its permissions,
// on the one repository it's installed on: Actions, Contents, Secrets, Variables and Workflows (write).
export const CLIENT_ID = process.env.JOB_PILOTTO_GITHUB_CLIENT_ID || 'Iv23liEIBvK1hG0oejDr';
export const APP_SLUG = process.env.JOB_PILOTTO_GITHUB_APP || 'job-pilotto';
export const REPO_NAME = 'job-pilotto-private';
export const STARTER = 'GarryOne/job-pilotto-starter';
// Step 1: a new private repo from the starter template. Step 2: install the app on it only.
export const CREATE_URL = `https://github.com/new?template_name=${STARTER.split('/')[1]}&template_owner=${STARTER.split('/')[0]}&name=${REPO_NAME}&visibility=private`;
export const INSTALL_URL = `https://github.com/apps/${APP_SLUG}/installations/new`;
const API = 'https://api.github.com';

// Keys the cloud runs need (secrets), and what the app's own runs set (variables): same values as pipelineEnv.
export const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY'];
// Secrets kept outside the app's own store, e.g. the Google sign-in (the Python side keeps it in the Keychain):
// main.js sets the reader; they go to the repo with the rest, so a Gmail check on GitHub can sign in.
let extraSecrets = () => ({});
export const setExtraSecrets = read => { extraSecrets = read; };
// Which Job Pilotto code the user's repo runs: an installed app sets its own release tag (desktop-v<version>), so
// the GitHub runs match the app and its Notion schema, and move on together when the app updates (the files are
// rewritten at each start). A source checkout (the owner's) keeps "main".
let engineRef = 'main';
export const setEngineRef = ref => { engineRef = ref || 'main'; };
const pinned = yaml => (engineRef === 'main' ? yaml
  : yaml.replace(/(GarryOne\/job-pilotto\/\.github\/workflows\/[\w.-]+\.yml)@main/g, `$1@${engineRef}`).replace(/code_ref: main\b/g, `code_ref: ${engineRef}`));
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
  const data = await form('https://github.com/login/device/code', {client_id: CLIENT_ID}, fetcher);
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

// The repo the user installed the app on: the one called job-pilotto-private, else the only one.
// Throws needsRepo when there's none yet, so the app can show the two setup steps.
export async function findRepo(api, chosen = '') {
  const {login} = await api('GET', '/user');
  const {installations = []} = await api('GET', '/user/installations?per_page=100');
  const repos = [];
  for (const installation of installations) {
    const {repositories = []} = await api('GET', `/user/installations/${installation.id}/repositories?per_page=100`);
    repos.push(...repositories);
  }
  const repo = repos.find(r => r.full_name === chosen) || repos.find(r => r.name === REPO_NAME) || (repos.length === 1 ? repos[0] : null);
  if (!repo && repos.length > 1) {
    throw Object.assign(new Error('Choose which repository Job Pilotto should use.'),
      {needsChoice: true, repos: repos.filter(r => r.private).map(r => r.full_name)});
  }
  if (!repo) throw Object.assign(new Error(installations.length
    ? `Job Pilotto can't see a repository called ${REPO_NAME}. Add it to the app's repositories, then check again.`
    : 'Create your private repository and install Job Pilotto on it, then check again.'), {needsRepo: true});
  if (!repo.private) throw new Error(`${repo.full_name} is public. Make it private in its Settings, then check again.`);
  return {login, repo: repo.full_name, created: false, createdAt: repo.created_at || ''};
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

export async function removeVariables(api, repo, names) {
  for (const name of names) {
    try { await api('DELETE', `/repos/${repo}/actions/variables/${name}`); } catch (error) { if (error.status !== 404) throw error; }
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
  const schedule = crons(storage.settings());  // how often, as the user chose (Settings → How often)
  for (const name of fs.readdirSync(templatesDir).filter(name => name.endsWith('.yml'))) {
    files[`.github/workflows/${name}`] = pinned(withSchedule(fs.readFileSync(path.join(templatesDir, name), 'utf8'), schedule[name]));
  }
  files['README.md'] = fs.readFileSync(path.join(templatesDir, 'README.md'), 'utf8');
  for (const name of CONFIG_FILES) {
    const text = storage.readText(`config/${name}`);
    if (text) files[`config/${name}`] = text;
  }
  const settings = storage.settings();
  const secrets = Object.fromEntries(SECRET_NAMES.map(name => [name, storage.secret(name)]).filter(([, value]) => value));
  for (const [name, value] of Object.entries(extraSecrets() || {})) if (value) secrets[name] = value;
  if (settings.telegramChatId) secrets.TELEGRAM_CHAT_ID = String(settings.telegramChatId);
  const variables = Object.fromEntries(Object.entries(settings.notionIds || {}).filter(([, value]) => value));
  const removed = [];
  if (secrets.ANTHROPIC_API_KEY) {
    for (const [name, stage] of Object.entries(MODEL_VARIABLES)) variables[name] = MODELS[stage];
    const {insights, kits} = cadence(settings);
    if (insights === 'off') { delete variables.JOB_PILOTTO_INSIGHT_MODEL; removed.push('JOB_PILOTTO_INSIGHT_MODEL'); }
    if (kits > 0) variables.JOB_PILOTTO_AUTO_KIT_MAX = String(kits); else removed.push('JOB_PILOTTO_AUTO_KIT_MAX');
  }
  return {files, secrets, variables, removed};
}


// A repo older than this wasn't made in the setup that is running now.
const REUSED_AFTER = 30 * 60 * 1000;

// Everything in one go; safe to run again (after a key or setting changes).
export async function connect(storage, token, {fetcher, onStep = () => {}, repo: chosen = ''} = {}) {
  const api = client(token, fetcher);
  onStep('Finding your private repository…');
  const {login, repo, created, createdAt} = await findRepo(api, chosen);
  // A repository from an earlier setup (not the one just made, not the one already in use): say it's being reused.
  const existing = storage.settings().cloud?.repo !== repo && createdAt && Date.now() - Date.parse(createdAt) > REUSED_AFTER
    ? {createdAt} : null;
  if (existing) onStep(`Found your repository ${repo} (created ${new Date(createdAt).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'})}): using it…`);
  const {files, secrets, variables, removed} = payload(storage);
  onStep('Adding the schedules and your search settings…');
  for (const [file, content] of Object.entries(files)) await putFile(api, repo, file, content, `Job Pilotto: ${file}`);
  onStep('Storing your keys as encrypted secrets…');
  await setSecrets(api, repo, secrets);
  await setVariables(api, repo, variables);
  await removeVariables(api, repo, removed);
  storage.saveSettings({cloud: {repo, login, since: storage.settings().cloud?.since || new Date().toISOString(), updatedAt: new Date().toISOString()}});
  return {repo, created, existing, secrets: Object.keys(secrets), variables: Object.keys(variables)};
}

// Who wants to know a run was just started there (the app shows "Starting on GitHub…" until its row appears).
const dispatched = new Set();
export const onDispatch = listener => dispatched.add(listener);

// The repo's workflow files and search settings, brought up to date (at start: new inputs reach existing repos).
export async function updateRepo(storage, {fetcher} = {}) {
  const {repo} = storage.settings().cloud || {};
  if (!repo || !storage.secret('GITHUB_TOKEN')) return [];
  const api = client(storage.secret('GITHUB_TOKEN'), fetcher);
  const changed = [];
  for (const [file, content] of Object.entries(payload(storage).files)) {
    if (await putFile(api, repo, file, content, `Job Pilotto: ${file}`)) changed.push(file);
  }
  // Keys added since Always on was turned on (e.g. Google connected later) reach the repo too.
  const extra = Object.fromEntries(Object.entries(extraSecrets() || {}).filter(([, value]) => value));
  if (Object.keys(extra).length) { await setSecrets(api, repo, extra); changed.push(...Object.keys(extra).map(name => `secret ${name}`)); }
  return changed;
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
      dispatched.forEach(listener => listener({workflow, inputs: clean}));
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
  // Windows 10+ ships bsdtar, which also reads zip files.
  const [command, args] = process.platform === 'win32' ? [tar(), ['-xf', zip, '-C', dir]] : ['/usr/bin/unzip', ['-o', zip, '-d', dir]];
  await new Promise((resolve, reject) => execFile(command, args, error => error ? reject(error) : resolve()));
}

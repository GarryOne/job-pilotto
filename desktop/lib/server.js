// The Chrome extension talks to the app on this computer (127.0.0.1) instead of a Cloudflare Worker.
// Same endpoints and code as the Worker (worker/src/extension.js), with the user's local Profile,
// keys from the Keychain-backed store, and the local job list. Only this computer can connect, and
// every call still needs the extension token.
import crypto from 'node:crypto';
import http from 'node:http';
import {handleExtension, jobKey} from '../../worker/src/extension.js';
import * as pipeline from './pipeline.js';

export const PORT = 47111;

export function extensionToken(storage) {
  let token = storage.secret('EXTENSION_TOKEN');
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    storage.setSecret('EXTENSION_TOKEN', token);
  }
  return token;
}

export function localEnv(storage) {
  const settings = storage.settings();
  const summary = job => ({title: job.title, company: job.company, stage: job.status, url: job.url, notion_url: ''});
  const find = async url => {
    const {jobs} = await pipeline.jobs(storage);
    const key = jobKey(url);
    return jobs.find(job => job.url === url || (key && job.url.includes(key)));
  };
  return {
    EXTENSION_TOKEN: extensionToken(storage),
    ANTHROPIC_API_KEY: storage.secret('ANTHROPIC_API_KEY'),
    NOTION_TOKEN: storage.secret('NOTION_TOKEN'),
    NOTION_APPLICATIONS_DB: settings.notionIds?.NOTION_APPLICATIONS_DB || '',
    PROFILE_TEXT: storage.readText('profile.md'),
    ANSWERS_TEXT: storage.readText('answers.md'),
    JOB_PILOTTO_KIT_MODEL: pipeline.MODELS.kit,
    queue: async () => (await pipeline.jobs(storage)).jobs.filter(j => ['unreviewed', 'saved'].includes(j.status)).slice(0, 25).map(summary),
    markApplied: async url => {
      const job = await find(url);
      if (!job) return {ok: false, error: 'This job isn\'t in your list'};
      await pipeline.setStatus(storage, job.url, 'applied');
      return {ok: true, message: 'Marked Applied in Job Pilotto.'};
    },
    localJob: async url => { const job = await find(url); return job ? summary(job) : null; },
  };
}

export function start(storage) {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
        method: req.method, headers: req.headers, ...(body && !['GET', 'HEAD'].includes(req.method) ? {body} : {}),
      });
      const response = await handleExtension(request, localEnv(storage));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: error.message}));
    }
  });
  server.listen(PORT, '127.0.0.1');
  return server;
}

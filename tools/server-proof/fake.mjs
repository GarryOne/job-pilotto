// Our own fake application pages for the server proof: a one-page form with a checkbox-style human check, and a 3-step flow with a server-side session. Nothing here is a real employer.
// The check wants what a person's click has: trusted events, some pointer movement, a moment on the page. It records navigator.webdriver but does not fail on it (the proof reports it).
const FORM = `<!doctype html><meta charset=utf-8><title>Fake application</title>
<style>body{font:15px system-ui;margin:24px;max-width:520px}label{display:block;margin:10px 0 2px}input,textarea{width:100%;padding:6px;box-sizing:border-box}
#human{display:flex;gap:8px;align-items:center;border:1px solid #bbb;padding:12px;margin:14px 0;width:260px;cursor:pointer}#box{width:22px;height:22px;border:2px solid #555;display:inline-block;text-align:center;line-height:20px}
button{padding:10px 18px;font-size:16px;margin-top:8px}</style>
<h2>Platform SRE (fake)</h2><form id=f method=post action=/fake/submit>
<label>Full name</label><input id=name name=name><label>E-mail</label><input id=email name=email><label>Notice period</label><input id=notice name=notice>
<label>Why this role?</label><textarea id=why name=why rows=3></textarea>
<div id=human><span id=box></span><span>I am not a robot</span></div><input type=hidden id=token name=token>
<button id=submit type=submit>Submit application</button></form><p id=msg></p>
<script>
const seen={moves:0,trusted:0,untrusted:0,t0:performance.now(),clickAt:0,webdriver:navigator.webdriver===true,headlessUA:/HeadlessChrome/.test(navigator.userAgent)};
addEventListener('mousemove',e=>{seen.moves++;e.isTrusted?seen.trusted++:seen.untrusted++});
document.getElementById('human').addEventListener('click',e=>{seen.clickAt=performance.now();seen.clickTrusted=e.isTrusted;
  if(e.isTrusted&&seen.moves>=3&&seen.clickAt-seen.t0>800){document.getElementById('box').textContent='✓';document.getElementById('token').value=btoa(JSON.stringify({moves:seen.moves,dwell:Math.round(seen.clickAt-seen.t0),webdriver:seen.webdriver,headlessUA:seen.headlessUA}));}
  else document.getElementById('msg').textContent='Try again';});
</script>`;
import {handleApply} from './apply.mjs';
export const submissions = [];
const sessions = new Map();
const page = (title, body) => `<!doctype html><meta charset=utf-8><title>${title}</title><body style="font:15px system-ui;margin:24px;max-width:520px"><h2>${title}</h2>${body}`;

export function handle(req, res, url, body) {
  const send = (code, text, type = 'text/html', headers = {}) => { res.writeHead(code, {'content-type': type, ...headers}); res.end(text); return true; };
  if (url.pathname.startsWith('/apply/') && handleApply(req, res, url, body)) return true;
  if (url.pathname === '/fake/form') return send(200, FORM);
  if (url.pathname === '/fake/submit' && req.method === 'POST') {
    const form = Object.fromEntries(new URLSearchParams(body));
    let evidence = null;
    try { evidence = JSON.parse(Buffer.from(form.token || '', 'base64').toString()); } catch { /* none */ }
    const accepted = !!evidence;
    submissions.push({at: Date.now(), accepted, evidence, fields: Object.keys(form).filter(k => form[k] && k !== 'token')});
    return send(accepted ? 200 : 403, page(accepted ? 'Received (fake)' : 'Human check failed', `<p>${accepted ? 'Accepted.' : 'No valid check token.'}</p>`));
  }
  if (url.pathname === '/fake/state') return send(200, JSON.stringify(submissions), 'application/json');
  const cookie = /sid=([a-z0-9]+)/.exec(req.headers.cookie || '')?.[1];
  if (url.pathname === '/flow/1') {
    const sid = Math.random().toString(36).slice(2, 12); sessions.set(sid, {step: 1, data: {}});
    return send(200, page('Step 1 of 3: about you', '<form method=post action=/flow/next><input id=name name=name placeholder="Full name"><button id=go>Next</button></form>'), 'text/html', {'set-cookie': `sid=${sid}; Path=/; HttpOnly`});
  }
  if (url.pathname === '/flow/next' && req.method === 'POST') {
    const s = sessions.get(cookie); if (!s) return send(302, '', 'text/html', {location: '/flow/expired'});
    s.step += 1; Object.assign(s.data, Object.fromEntries(new URLSearchParams(body)));
    return send(302, '', 'text/html', {location: `/flow/${s.step}`});
  }
  if (url.pathname === '/flow/2' || url.pathname === '/flow/3') {
    const s = sessions.get(cookie); if (!s) return send(200, page('Session expired', '<p>Please sign in again.</p>'));
    return send(200, page(`Step ${s.step} of 3: ${s.step === 2 ? 'experience' : 'review'}`, `<p id=progress>Your answers so far: ${Object.keys(s.data).length}</p><form method=post action=/flow/next><input id=more${s.step} name=more${s.step}><button id=go>Next</button></form>`));
  }
  if (url.pathname === '/flow/expired') return send(200, page('Session expired', '<p>Please sign in again.</p>'));
  return false;
}

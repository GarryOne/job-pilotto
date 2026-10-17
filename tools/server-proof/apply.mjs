// Our own fake multi-step application for the hand-off test: account, experience, then a last step with a controlled field (its state ignores a plain .value), a country select, a CV slot,
// the human check, and a CSRF token. Variants: plain (cookie only), ip (the session is bound to the address that made the account), ss (the CSRF token lives in sessionStorage, which a cookie copy does not carry).
const sessions = new Map();
const ipOf = req => req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.socket.remoteAddress || '';
const shell = (title, body) => `<!doctype html><meta charset=utf-8><title>${title}</title><body style="font:15px system-ui;margin:24px;max-width:520px"><h2>${title}</h2>${body}`;
export const applyResults = [];

const LAST = (variant, csrf) => shell('Step 3 of 3: your details', `<form id=f onsubmit="return false">
<label>Full name</label><input id=name name=name><label>E-mail</label><input id=email name=email>
<label>Phone (controlled field)</label><input id=phone name=phone><label>Country</label><select id=country name=country><option value="">Choose</option><option>Switzerland</option><option>Germany</option><option>Spain</option></select>
<label>CV</label><input id=cv name=cv type=file><label><input id=consent type=checkbox> I confirm this is true</label>
<div id=human style="border:1px solid #bbb;padding:12px;margin:14px 0;width:260px;cursor:pointer"><span id=box>☐</span> I am not a robot</div>
<button id=submit>Submit application</button></form><p id=msg></p>
<script>
const variant=${JSON.stringify(variant)}; const csrf=variant==='ss'?sessionStorage.getItem('csrf'):${JSON.stringify(csrf)};
const state={phone:''}; document.getElementById('phone').addEventListener('input',e=>{state.phone=e.target.value});   // a plain .value = ... never reaches state
const seen={moves:0,t0:performance.now(),ok:false}; addEventListener('mousemove',e=>{if(e.isTrusted)seen.moves++});
document.getElementById('human').addEventListener('click',e=>{if(e.isTrusted&&seen.moves>=3&&performance.now()-seen.t0>800){seen.ok=true;document.getElementById('box').textContent='✓'}});
document.getElementById('submit').addEventListener('click',async()=>{
  const files=document.getElementById('cv').files; const body={csrf,human:seen.ok,phone:state.phone,country:document.getElementById('country').value,name:document.getElementById('name').value,email:document.getElementById('email').value,cv:files[0]?files[0].name:'',consent:document.getElementById('consent').checked};
  const r=await fetch('/apply/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); document.getElementById('msg').textContent=await r.text();});
</script>`);

export function handleApply(req, res, url, body) {
  const send = (code, text, headers = {}) => { res.writeHead(code, {'content-type': 'text/html', ...headers}); res.end(text); return true; };
  const sid = /asid=([a-z0-9]+)/.exec(req.headers.cookie || '')?.[1];
  const s = sessions.get(sid);
  if (url.pathname === '/apply/1') return send(200, shell('Step 1 of 3: create your account', `<form method=post action="/apply/account?v=${url.searchParams.get('v') || 'plain'}"><input id=acc-email name=email placeholder=E-mail><input id=acc-pass name=password type=password placeholder=Password><button id=go>Create account</button></form>`));
  if (url.pathname === '/apply/account' && req.method === 'POST') {
    const v = url.searchParams.get('v') || 'plain'; const id = Math.random().toString(36).slice(2, 12);
    sessions.set(id, {step: 2, variant: v, ip: v === 'ip' ? ipOf(req) : null, csrf: Math.random().toString(36).slice(2, 12)});   // the password is read to make the account and kept nowhere
    return send(302, '', {location: '/apply/2', 'set-cookie': `asid=${id}; Path=/; HttpOnly`});
  }
  const gate = () => !s ? 'no session' : (s.ip !== null && s.ip !== ipOf(req) ? 'session bound to another address' : '');
  if (url.pathname === '/apply/2' || url.pathname === '/apply/3') {
    const bad = gate(); if (bad) return send(200, shell('Please sign in again', `<p id=expired>${bad}</p>`));
    if (url.pathname === '/apply/2') return send(200, shell('Step 2 of 3: experience', `<form method=post action=/apply/next><input id=years name=years placeholder=Years><button id=go>Next</button></form>${s.variant === 'ss' ? `<script>sessionStorage.setItem('csrf',${JSON.stringify(s.csrf)})</script>` : ''}`));
    return send(200, LAST(s.variant, s.csrf));
  }
  if (url.pathname === '/apply/next' && req.method === 'POST') { if (s) s.step = 3; return send(302, '', {location: '/apply/3'}); }
  if (url.pathname === '/apply/submit' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(body); } catch { /* none */ }
    const why = gate() || (b.csrf !== s?.csrf ? 'csrf token wrong' : !b.human ? 'human check failed' : !b.phone ? 'phone empty (controlled field)' : !b.name || !b.email || !b.country ? 'a field is empty' : !b.cv ? 'cv slot empty' : !b.consent ? 'consent not ticked' : '');
    applyResults.push({at: Date.now(), variant: s?.variant || '', accepted: !why, why});
    return send(why ? 403 : 200, why ? `Refused: ${why}` : 'Accepted (fake)');
  }
  if (url.pathname === '/apply/results') return send(200, JSON.stringify(applyResults));
  return false;
}

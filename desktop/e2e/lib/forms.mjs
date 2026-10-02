// Fixture application forms for the apply suite, served over HTTPS from this machine. Chromium maps the real job-site host names the extension is allowed on
// (boards.greenhouse.io, jobs.lever.co, e2e.recruitee.com) to this server, and every other host name is unresolvable, so no employer site is ever contacted.
// The forms are written like the real boards' (labels, required stars, a late-rendered field, a multi-step flow) and each records what happened to it:
// a Submit that is clicked or submitted is logged, so a test can prove it was never touched.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

export const HOSTS = ['boards.greenhouse.io', 'jobs.lever.co', 'e2e.recruitee.com'];
const LEVER_ID = '5e2e5e2e-0000-4000-8000-00000000a001';

// One entry per form. `kit` is what the job's drafted kit holds for it (field ids of the form); `legal` the ids the extension must leave to the person even
// though the kit says "checked"; `late` the ids that only appear after the page has loaded.
export const FORMS = {
  greenhouse: {
    title: 'Senior Site Reliability Engineer', company: 'E2E Greenhouse Labs', host: 'boards.greenhouse.io', path: '/e2e/jobs/4001001',
    kit: [
      {field: 'question_1001', question: 'Years of experience with Kubernetes', answer: '8', needs_review: false},
      {field: 'question_1002', question: 'Are you legally authorized to work in Switzerland?', answer: 'Yes', needs_review: false},
      {field: 'question_1003', question: 'Notice period', answer: '3 months', needs_review: false},
      {field: 'question_1004', question: 'Describe a production incident you led and what you changed afterwards.',
        answer: 'I led the response to a cascading failure in our payments cluster, wrote the post-mortem and added load-shedding and SLO alerts afterwards.', needs_review: false},
      {field: 'consent_privacy', question: 'I agree to the privacy policy and the processing of my data', answer: 'checked', needs_review: false},
    ],
    legal: ['consent_privacy'],
  },
  lever: {
    title: 'Platform Engineer', company: 'E2E Lever Systems', host: 'jobs.lever.co', path: `/e2e/${LEVER_ID}`, formPath: `/e2e/${LEVER_ID}/apply`,
    kit: [
      {field: 'org', question: 'Current company', answer: 'Acme Infrastructure AG', needs_review: false},
      {field: 'urls[LinkedIn]', question: 'LinkedIn URL', answer: 'https://www.linkedin.com/in/ada-tester', needs_review: false},
      {field: 'heard', question: 'How did you hear about us?', answer: 'Job board', needs_review: false},
    ],
    // Not in the kit, so the app asks its AI (canned in the test): the open question below.
    open: {field: 'why', question: 'Why do you want to work at E2E Lever Systems?'},
    late: ['org'], legal: [],
  },
  multistep: {
    title: 'DevOps Engineer', company: 'E2E Recruitee GmbH', host: 'e2e.recruitee.com', path: '/o/devops-engineer',
    kit: [
      {field: 'salary', question: 'Salary expectation (CHF per year)', answer: '140000', needs_review: false},
      {field: 'start_date', question: 'Earliest start date', answer: '1 December 2026', needs_review: false},
      {field: 'consent_data', question: 'I agree to the processing of my personal data (privacy policy)', answer: 'checked', needs_review: false},
    ],
    legal: ['consent_data'],
  },
  unknown: {
    title: 'Infrastructure Engineer', company: 'E2E Unknown Widget Inc', host: 'boards.greenhouse.io', path: '/e2e/jobs/4001004',
    kit: [{field: 'question_2001', question: 'Years of experience with Terraform', answer: '6', needs_review: false}],
    widget: 'How would you rate your Terraform skill?', legal: [],
  },
};
// A journey over three pages and two tabs, like a job board posting that leads to an agency's own site (jobs.ch -> consultandpepper.com): the posting has
// only an Apply link that opens a NEW tab, that page has only a "To apply" link (same tab), and the form is behind it. `kit` is for the posting's job.
export const CHAIN = {
  title: 'Fullstack Engineer with DevOps Mindset', company: 'E2E Chain Recruiting', host: 'boards.greenhouse.io', path: '/e2e/jobs/4001005',
  stepHost: 'e2e.recruitee.com', stepPath: '/o/chain-step', formPath: '/o/chain-form',
  kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '7', needs_review: false}],
};
CHAIN.url = `https://${CHAIN.host}${CHAIN.path}`;
CHAIN.stepUrl = `https://${CHAIN.stepHost}${CHAIN.stepPath}`;
CHAIN.formUrl = `https://${CHAIN.stepHost}${CHAIN.formPath}`;
for (const form of Object.values(FORMS)) form.url = `https://${form.host}${form.path}`;

const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const field = (id, label, {type = 'text', required = false, name = id, extra = ''} = {}) =>
  `<div class="field"><label for="${id}">${esc(label)}${required ? ' *' : ''}</label><input id="${id}" name="${esc(name)}" type="${type}"${required ? ' required' : ''} ${extra}></div>`;
const select = (id, label, options, {required = false} = {}) =>
  `<div class="field"><label for="${id}">${esc(label)}${required ? ' *' : ''}</label><select id="${id}" name="${id}"${required ? ' required' : ''}><option value="">Select…</option>${options.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>`;
const area = (id, label, {required = false} = {}) =>
  `<div class="field"><label for="${id}">${esc(label)}${required ? ' *' : ''}</label><textarea id="${id}" name="${id}" rows="4"${required ? ' required' : ''}></textarea></div>`;
const resume = `<div class="field"><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required></div>`;
const consent = (id, text) => `<div class="field"><label><input id="${id}" name="${id}" type="checkbox" required> ${esc(text)} *</label></div>`;

// Every form reports a click on Submit and a submit event to the server (which keeps them for the test), and never really submits.
const page = (form, body, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(form.title)} at ${esc(form.company)}</title>
<style>body{font:15px/1.4 system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px}.field{margin:14px 0}label{display:block;margin-bottom:4px}input[type=text],input[type=email],input[type=tel],input[type=url],select,textarea{width:100%;padding:6px;box-sizing:border-box}</style></head>
<body><h1>${esc(form.title)}</h1><p>${esc(form.company)} · Zurich, Switzerland</p>
${body}
<script>
const fired = kind => fetch('/__fired?kind=' + kind + '&form=' + encodeURIComponent(location.pathname), {method: 'POST', keepalive: true});
document.addEventListener('click', event => { if (event.target.closest('[type=submit]')) fired('click'); }, true);
document.addEventListener('submit', event => { event.preventDefault(); fired('submit'); }, true);
${script}
</script></body></html>`;

const CHAIN_PAGES = {
  posting: () => page(CHAIN, `<p>Join the team. <a id="apply_link" href="${CHAIN.stepUrl}" target="_blank" style="display:inline-block;padding:12px 28px;background:#222;color:#fff;font-size:18px;text-decoration:none">Apply</a></p>`),
  step: () => page(CHAIN, `<p>Contact: a consultant looks forward to your application.</p><p><a id="to_apply" href="${CHAIN.formUrl}" style="display:inline-block;padding:12px 28px;background:#f5d98b;font-size:18px;text-decoration:none">To apply</a></p>`),
  // The agency's form has FLOATING labels: the label sits inside the field and moves up only when the field is left with a value (a blur, like a person's tab
  // away), so a value written without focus and blur sits on top of its label (3 Oct 2026, consultandpepper.com).
  form: () => page(CHAIN, `<style>.field label.up{font-size:11px;color:#667}</style><form id="application_form">${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${resume}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}${submit}</form>`,
  `document.querySelectorAll('input[type=text],input[type=email]').forEach(input => input.addEventListener('blur', () => document.querySelector('label[for=' + input.id + ']').classList.toggle('up', !!input.value)));`),
};

const submit = `<div class="field"><button type="submit" id="submit_app">Submit Application</button></div>`;

const PAGES = {
  greenhouse: form => page(form, `<form id="application_form">
  ${field('first_name', 'First Name', {required: true})}${field('last_name', 'Last Name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${field('phone', 'Phone', {type: 'tel'})}
  ${resume}
  ${field('question_1001', 'Years of experience with Kubernetes', {required: true})}
  ${select('question_1002', 'Are you legally authorized to work in Switzerland?', ['Yes', 'No'], {required: true})}
  ${field('question_1003', 'Notice period', {required: true})}
  ${area('question_1004', 'Describe a production incident you led and what you changed afterwards.', {required: true})}
  ${consent('consent_privacy', 'I agree to the privacy policy and the processing of my data')}
  ${submit}</form>`),
  // Lever: the posting's page has the form under /apply; "Current company" is rendered by script a moment after the page has loaded (E2E_LATE_MS moves it: a
  // value past the extension's 1.5 s wait proves the suite notices a field that is filled too late).
  lever: form => page(form, `<form id="application_form">
  ${field('name', 'Full name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${field('phone', 'Phone')}
  ${resume}
  <div id="late-slot"></div>
  ${field('urls[LinkedIn]', 'LinkedIn URL', {type: 'url'})}
  ${select('heard', 'How did you hear about us?', ['Job board', 'Referral', 'Company website', 'Other'], {required: true})}
  ${area('why', 'Why do you want to work at E2E Lever Systems?', {required: true})}
  ${submit}</form>`,
  `setTimeout(() => { document.getElementById('late-slot').innerHTML = ${JSON.stringify(field('org', 'Current company', {required: true}))}; }, ${Number(process.env.E2E_LATE_MS) || 600});`),
  // Two steps on one page: step 2 (salary, consent, Submit) is hidden until the person presses Next.
  multistep: form => page(form, `<form id="application_form">
  <section id="step1"><h2>Step 1 of 2: about you</h2>
  ${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${resume}
  <div class="field"><button type="button" id="next_step">Next</button></div></section>
  <section id="step2" hidden><h2>Step 2 of 2: your terms</h2>
  ${field('salary', 'Salary expectation (CHF per year)', {required: true})}${field('start_date', 'Earliest start date', {required: true})}
  ${consent('consent_data', 'I agree to the processing of my personal data (privacy policy)')}
  ${submit}</section></form>`,
  `document.getElementById('next_step').addEventListener('click', () => { document.getElementById('step1').hidden = true; document.getElementById('step2').hidden = false; });`),
  // A required control the form reader has no operator for: a custom slider (a div with role=slider).
  unknown: form => page(form, `<form id="application_form">
  ${field('first_name', 'First Name', {required: true})}${field('last_name', 'Last Name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${resume}
  ${field('question_2001', 'Years of experience with Terraform', {required: true})}
  <div class="field"><div id="skill-label">${esc(form.widget)} *</div>
  <div role="slider" id="skill" aria-labelledby="skill-label" aria-required="true" aria-valuemin="1" aria-valuemax="5" aria-valuenow="1" tabindex="0" style="width:240px;height:24px;background:#ddd;border-radius:12px"></div></div>
  ${submit}</form>`),
};

// -> {url, host, port, close(), fired: [{kind, form}] (what happened to a Submit), forms: {name: form}}. https, a self-made certificate.
export async function startForms() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=jp-e2e', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], {stdio: 'ignore'});
  const fired = [];
  const hits = [];
  const server = https.createServer({key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem'))}, (req, res) => {
    const url = new URL(req.url, 'https://x');
    const host = String(req.headers.host || '').split(':')[0];
    hits.push(`${host}${url.pathname}`);
    if (req.method === 'POST' && url.pathname === '/__fired') { fired.push({kind: url.searchParams.get('kind'), form: url.searchParams.get('form')}); res.writeHead(204).end(); return; }
    const chain = host === CHAIN.host && url.pathname.replace(/(.)\/$/, '$1') === CHAIN.path ? 'posting' : host === CHAIN.stepHost && url.pathname.replace(/(.)\/$/, '$1') === CHAIN.stepPath ? 'step'
      : host === CHAIN.stepHost && url.pathname.replace(/(.)\/$/, '$1') === CHAIN.formPath ? 'form' : '';
    if (chain) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(CHAIN_PAGES[chain]()); return; }
    const name = Object.keys(FORMS).find(key => FORMS[key].host === host && [FORMS[key].path, FORMS[key].formPath].includes(url.pathname.replace(/(.)\/$/, '$1')));
    if (!name) { res.writeHead(404, {'content-type': 'text/plain'}).end('not a fixture form'); return; }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(PAGES[name](FORMS[name]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {port, fired, hits, forms: FORMS, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }), html: name => PAGES[name](FORMS[name])};
}

// Chromium flags that send the job-site host names to the fixture server and make every other name unresolvable (no employer is ever contacted).
export const hostRules = port => [...HOSTS.map(host => `MAP ${host} 127.0.0.1:${port}`), 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'].join(', ');

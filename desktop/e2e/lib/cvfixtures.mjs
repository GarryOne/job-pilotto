// Small CVs as HTML, printed to PDF inside the app, to check what the CV check really reads out of a PDF (settings suite): the extraction itself,
// which the unit tests (made-up pages) do not touch. Each has the checks it must fail and the ones it must pass.
const BULLETS = ['Led the migration of forty services to Kubernetes and cut the monthly infrastructure bill by a third.', 'Ran the on-call rota for a payments platform with a 99.95 percent availability target.',
  'Wrote the incident reviews and the runbooks that three teams still use, and mentored four engineers.'];
const page = body => `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:18mm} body{font:11pt Arial,sans-serif;color:#111} h1{font-size:22pt;margin:0} h2{font-size:13pt;margin:16pt 0 4pt;border-bottom:1px solid #999} li{margin:3pt 0}
.cols{display:flex;gap:24pt}.cols>div{flex:1}</style>${body}`;
const job = (title, when) => `<b>${title}</b><br>${when}<ul>${BULLETS.map(item => `<li>${item}</li>`).join('')}</ul>`;
const head = (email = true, phone = true) => `<h1>Ada Tester</h1><p>Zurich${email ? ' · ada.tester@example.test' : ''}${phone ? ' · +41 79 555 01 23' : ''}</p>`;
const sections = (dates = 'Mar 2022 – Present') => `<h2>Experience</h2>${job('Platform Engineer, Acme', dates)}${job('Site Reliability Engineer, Beta', 'Jan 2019 – Feb 2022')}
  <h2>Education</h2><p>BSc Computer Science</p><h2>Skills</h2><p>Kubernetes, Terraform, AWS, Prometheus</p>`;

export const FIXTURES = {
  good: {html: page(head() + sections()), pass: ['text', 'columns', 'email', 'phone', 'experience', 'education', 'skills', 'dates', 'name'], fail: []},
  twoColumns: {html: page(head() + `<div class="cols"><div>${job('Platform Engineer, Acme', 'Mar 2022 – Present')}</div><div>${job('Site Reliability Engineer, Beta', 'Jan 2019 – Feb 2022')}</div></div>
    <h2>Education</h2><p>BSc</p><h2>Skills</h2><p>Kubernetes</p><h2>Experience</h2>`), pass: ['text', 'email'], fail: ['columns']},
  noEmail: {html: page(head(false, true) + sections()), pass: ['text', 'phone', 'experience'], fail: ['email']},
  mixedDates: {html: page(head() + sections('03/2022 – Present')), pass: ['text', 'email'], fail: ['dates']},
  picture: {html: page(`<div style="height:900px;width:100%;background:#cde"></div>`), pass: [], fail: ['text']},   // no text at all: a picture of a CV
};

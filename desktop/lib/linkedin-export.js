// LinkedIn's own data export (Settings → Data privacy → Get a copy of your data) turned into a CV in the app's schema, so the experience bank
// (lib/experience.js) can compare it with the main CV like any other version. Read by STRUCTURE only: the export's CSV files and their column
// headers; what a position means (which CV role it is) is decided later by the AI match, never here. A file or column that is missing is
// reported, not guessed. Nothing is sent anywhere; the ZIP itself is not kept, only this parsed data. Guarded by test/linkedin-export.test.js.
import path from 'node:path';
import {listZip, readEntry} from './zip-read.js';

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks. A BOM and \r\n are tolerated.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const input = String(text).replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && input[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

// Records by header name. LinkedIn sometimes puts notes above the header row: the header is the first row that has all the wanted columns.
export function records(text, wanted) {
  const rows = parseCsv(text);
  const at = rows.findIndex(r => wanted.every(name => r.map(c => c.trim()).includes(name)));
  if (at < 0) return null;
  const header = rows[at].map(c => c.trim());
  return rows.slice(at + 1).map(r => Object.fromEntries(header.map((name, i) => [name, (r[i] || '').trim()])));
}

const BULLET = /^[\s•·▪●◦\-*–]+/;
// A description is free text: one bullet per line (or per bullet mark); a single paragraph stays one bullet.
export const bulletsOf = text => String(text || '').split(/\r?\n|\s[•·▪●◦]\s/).map(line => line.replace(BULLET, '').trim()).filter(Boolean);
const period = (from, to) => [from, to || (from ? 'Present' : '')].filter(Boolean).join(' – ');

// {Positions.csv, Education.csv, …} text by file name -> a CV, or an error naming what is missing.
export function toCv(files) {
  const positions = files['Positions.csv'] ? records(files['Positions.csv'], ['Company Name', 'Title']) : null;
  if (!positions) throw new Error('No Positions.csv found in this export. In LinkedIn choose "Positions" (or the whole profile) when you ask for your data.');
  const jobs = [];
  for (const p of positions) {
    if (!p['Company Name'] && !p['Title']) continue;
    const role = {title: p['Title'], period: period(p['Started On'], p['Finished On']), place: p['Location'] || '', bullets: bulletsOf(p['Description'])};
    const last = jobs[jobs.length - 1];
    if (last && last.company.toLowerCase() === p['Company Name'].toLowerCase()) last.roles.push(role); else jobs.push({company: p['Company Name'], roles: [role]});
  }
  const cv = {jobs};
  const profile = files['Profile.csv'] ? records(files['Profile.csv'], ['First Name', 'Last Name'])?.[0] : null;
  if (profile) {
    cv.name = [profile['First Name'], profile['Last Name']].filter(Boolean).join(' ');
    if (profile['Summary']) cv.summary = profile['Summary'];
    if (profile['Geo Location']) cv.location = profile['Geo Location'];
  }
  const skills = files['Skills.csv'] ? records(files['Skills.csv'], ['Name']) : null;
  if (skills?.length) cv.skills = skills.map(s => s['Name']).filter(Boolean).join(', ');
  const education = files['Education.csv'] ? records(files['Education.csv'], ['School Name']) : null;
  if (education?.length) cv.education = education.map(e => ({school: e['School Name'], degree: e['Degree Name'] || '', period: period(e['Start Date'], e['End Date'])}));
  const languages = files['Languages.csv'] ? records(files['Languages.csv'], ['Name']) : null;
  if (languages?.length) cv.languages = languages.map(l => l['Proficiency'] ? `${l['Name']} (${l['Proficiency']})` : l['Name']).join(', ');
  return cv;
}

const WANTED = ['Positions.csv', 'Profile.csv', 'Skills.csv', 'Education.csv', 'Languages.csv'];
// The export file (a .zip, or one of its CSVs) -> a CV.
export function readExport(file) {
  const files = {};
  if (/\.zip$/i.test(file)) {
    for (const entry of listZip(file)) {
      const name = path.posix.basename(entry.name);
      if (WANTED.includes(name) && !(name in files)) files[name] = readEntry(file, entry).toString('utf8');
    }
  } else throw new Error('Choose the .zip file LinkedIn sent you.');
  return toCv(files);
}

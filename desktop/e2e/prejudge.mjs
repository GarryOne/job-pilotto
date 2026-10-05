// Judge before filing (lib/prejudge.mjs), the CLI around Claude's one session in ui-findings.yml:
//   node prejudge.mjs --pending .heal/pending.json --out .heal      -> .heal/prejudge-prompt.md, the pictures in .heal/shots/
//   node prejudge.mjs --parse .heal/verdicts.md --pending .heal/pending.json --out .heal/verdicts.json
import fs from 'node:fs';
import path from 'node:path';
import {parseVerdicts, prejudgePrompt} from './lib/prejudge.mjs';

const args = process.argv.slice(2), at = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const pending = JSON.parse(fs.readFileSync(at('--pending'), 'utf8'));
if (at('--parse')) {
  const text = fs.existsSync(at('--parse')) ? fs.readFileSync(at('--parse'), 'utf8') : '';
  const lineCount = file => { try { return fs.readFileSync(file, 'utf8').split('\n').length; } catch { return 0; } };
  const verdicts = parseVerdicts(text, pending.map(item => item.id), lineCount);
  fs.writeFileSync(at('--out'), JSON.stringify(verdicts, null, 2));
  console.log(`${Object.keys(verdicts).length} of ${pending.length} finding(s) judged`);
} else {
  const out = at('--out');
  fs.mkdirSync(path.join(out, 'shots'), {recursive: true});
  for (const item of pending) if (item.screenshot && fs.existsSync(item.screenshot)) { const to = path.join(out, 'shots', `${item.id}.png`); fs.copyFileSync(item.screenshot, to); item.screenshot = to; } else item.screenshot = '';
  const base = fs.readFileSync(new URL('./ui-verdict-prompt.md', import.meta.url), 'utf8').replace(/\n3\. Write \.heal\/verdict\.md\./, '\n3. Write the verdict (see THIS RUN below for the file).');
  const lessons = fs.existsSync(path.join(out, 'lessons.md')) ? fs.readFileSync(path.join(out, 'lessons.md'), 'utf8') : '';   // the owner's corrections (reversals.mjs)
  fs.writeFileSync(path.join(out, 'prejudge-prompt.md'), prejudgePrompt(pending, base) + lessons);
  console.log(`${pending.length} finding(s) to judge: ${path.join(out, 'prejudge-prompt.md')}`);
}

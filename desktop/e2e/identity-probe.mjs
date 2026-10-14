// A $0 probe on the plan (never a key): which of the owner's own kinds (name, e-mail, phone, place, account) a test-side model call can say about "the person running
// you", through lib/model.mjs, the path every judge and recording uses. Prints kinds only, never a value. Run: node identity-probe.mjs. Guard: test/model.test.mjs (flags).
import {modelFetch} from './lib/model.mjs';
import {matchesOwner, ownerValues} from './lib/privacy-tripwire.mjs';

const schema = {type: 'object', additionalProperties: false, required: ['city', 'country', 'first_name', 'last_name', 'email'], properties: Object.fromEntries(['city', 'country', 'first_name', 'last_name', 'email'].map(key => [key, {type: 'string'}]))};
const body = {model: 'claude-haiku-5-5', max_tokens: 300, system: 'Answer from your context only. Never guess: write "UNKNOWN" for what your context does not state.',
  messages: [{role: 'user', content: 'Which city, country, first name, last name and e-mail do you know for the person running you?'}], output_config: {format: {type: 'json_schema', schema}}};
const response = await modelFetch('https://api.anthropic.com/v1/messages', {method: 'POST', body: JSON.stringify(body)});
const data = await response.json();
if (!response.ok) { console.log(`probe failed: ${data?.error?.message || response.status}`); process.exit(1); }
let said = {};
try { const text = data.content[0].text; said = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* an unreadable answer says nothing */ }
const known = Object.entries(said).filter(([, value]) => value && !/^unknown$/i.test(String(value).trim()));
const hits = matchesOwner(known.map(([label, value]) => ({label, value})), ownerValues());
console.log(`identity probe (model.mjs path): says it knows ${known.map(([key]) => key).join(', ') || 'nothing'}; of those, the owner's own values: ${hits.map(hit => `${hit.label} (${hit.kind})`).join(', ') || 'none'}`);

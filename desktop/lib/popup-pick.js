// Which button of a popup closes it without agreeing to anything (owner, 9 Oct 2026: "it should close/handle any popup, no matter what flow or scenario").
// The page's structure finds the popup (extension/popup-page.js); Claude sees its text and its own buttons and answers with one of them, or none:
// none for a popup that is part of the task (a form, a choice that must be made, a sign-in) or when no button just closes it. The answer is kept per
// popup text and set of buttons. No AI, or none: nothing is pressed. Guarded by test/popup-pick.test.js.
export const MODEL = 'claude-haiku-5-5';
export const FILE = 'popup-picks.json';
const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

const INSTRUCTIONS = `A popup is in the way of a web page the applicant is using to apply for a job. You see its text and its buttons. Return the one button that
gets rid of it WITHOUT agreeing to, accepting, subscribing to, signing in to, submitting or sending anything: a close or dismiss button ("No thanks",
"Not now", "x", "Close"), or, on a cookie notice, the button that refuses optional cookies or keeps only the necessary ones; only when the notice offers
neither, the one that merely accepts cookies. Copy the button exactly. Return "" when the popup is part of the task (an application form or question that
needs the person's answer, a sign-in, a robot check) or when no button simply closes it. Never pick a button that agrees to terms, a privacy policy or the
processing of application data.`;

// → {button, how: 'ai' | 'kept' | 'none'}; button '' when none is right (or no AI to ask).
export async function pickDismiss(storage, {text = '', buttons = []}, {client, log = () => {}} = {}) {
  const choices = (buttons || []).map(String).map(item => item.trim()).filter(Boolean).slice(0, 20);
  if (!choices.length) return {button: '', how: 'none'};
  let kept = {};
  try { kept = JSON.parse(storage.readText(FILE) || '{}') || {}; } catch {}
  const key = `${norm(text).slice(0, 120)}|${choices.map(norm).sort().join('|')}`;
  if (key in kept) return {button: choices.includes(kept[key]) ? kept[key] : '', how: 'kept'};
  if (!client) return {button: '', how: 'none'};
  const started = Date.now();
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: 8000, system: INSTRUCTIONS,
      messages: [{role: 'user', content: JSON.stringify({popup: String(text).slice(0, 600), buttons: choices})}],
      output_config: {format: {type: 'json_schema', schema: {type: 'object', additionalProperties: false, required: ['button'],
        properties: {button: {type: 'string', enum: [...choices, '']}}}}}});
    if (response.stop_reason === 'max_tokens') throw new Error('answer cut short');
    const button = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').button;
    kept[key] = choices.includes(button) ? button : '';
    storage.writeText(FILE, JSON.stringify(kept));
    log('extension', kept[key] ? 'popup: a button closes it' : 'popup: left alone', {buttons: choices.length, ms: Date.now() - started});
    return {button: kept[key], how: 'ai'};
  } catch (error) {
    log('extension', `popup button not picked: ${String(error?.message || error).slice(0, 160)}`, {buttons: choices.length});
    return {button: '', how: 'none'};
  }
}

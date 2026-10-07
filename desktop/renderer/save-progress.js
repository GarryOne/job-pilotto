// Saves that rewrite ⚙️ Search settings in Notion (main.js settingsDeps) take tens of seconds: the page is read, then rewritten a block at a time,
// queued behind any search that is using Notion. While one runs, the thing pressed says how far it is, in words (7 Oct 2026: Save sat on "Saving…"
// 71 s with nothing said). One save at a time: the newest press listens.
let listener = null;
export const progressWords = ({stage, done, total} = {}) => stage === 'read' ? 'Reading your settings from Notion…'
  : stage === 'write' && total ? `Saving to Notion · ${Math.min(99, Math.round(done / total * 100))}%` : 'Saving to Notion…';
export function startListening(pilot = globalThis.window?.pilot) {
  pilot?.onSettingsProgress?.(progress => listener?.(progressWords(progress)));
}
export async function withSaveProgress(say, work) {
  const mine = words => say(words);
  listener = mine;
  say('Saving to Notion…');
  try { return await work(); } finally { if (listener === mine) listener = null; }
}

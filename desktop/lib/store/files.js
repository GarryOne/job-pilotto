// A job's files (screenshots of messages, a tailored CV) from the active store through the engine (`applications files`,
// src/stores/__main__.py: base64 with a size cap), as data: URLs a screen can show in an <img> or offer to save. A file over the
// cap comes with url null and tooLarge true, so the screen can still list it. Guarded by test/store-files.test.js.
import * as engine from './engine.js';

export async function jobFiles(storage, appId, {call = engine.call} = {}) {
  if (!appId) return [];
  const found = await call(storage, 'applications', 'files', {app_id: String(appId)});
  return (Array.isArray(found) ? found : []).map(file => ({
    name: String(file.name || 'file'),
    type: String(file.content_type || 'application/octet-stream'),
    size: Number(file.size) || 0,
    tooLarge: !!file.too_large || typeof file.data !== 'string',
    url: typeof file.data === 'string' && !file.too_large ? `data:${file.content_type || 'application/octet-stream'};base64,${file.data}` : null,
  }));
}

export const isImage = file => /^image\//.test(file?.type || '');

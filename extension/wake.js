// Review in form woke this page: inject the panel into the open form tab, then close. Never reloads that tab.
import {api, settings} from './flow.js';

const me = await chrome.tabs.getCurrent();
try {
  const tabs = await chrome.tabs.query({});
  const list = tabs.filter(tab => tab.id != null && /^https?:/.test(tab.url || ''));
  const config = await settings();
  const answer = await api(config, '/extension/join', {method: 'POST', body: JSON.stringify({
    tabs: list.map(tab => ({url: String(tab.url).slice(0, 500), title: String(tab.title || '').slice(0, 200)})),
  })});
  const wanted = new Set((answer?.arm || []).map(url => String(url).split('#')[0].replace(/\/+$/, '')));
  for (const tab of list) {
    if (wanted.has(String(tab.url).split('#')[0].replace(/\/+$/, ''))) await chrome.runtime.sendMessage({type: 'armTab', tabId: tab.id});
  }
} catch { /* the app is closed, or this page cannot reach it */ }
if (me?.id != null) chrome.tabs.remove(me.id);

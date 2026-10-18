// The Lab's "▶ Watch" (owner, 18 Oct 2026): a pool row's fill video, shown by every list that draws a pool row (Sites, Needs a fix) through ONE helper, so a new list gets it the same way.
// Owns WATCH_CSS and WATCH_SCRIPT, the client code that sits after the page's tabs inside the fetch callback (needs el). Videos come from src/lab-video.js (GET ?index, ?name=); a row
// without one shows no button and a muted line in its opened details. Plain quotes only: it sits in a template literal. Guard: test/applying-watch.test.js.
export const WATCH_URL = '/admin/lab-form-filling/video';

export const WATCH_CSS = `.watchbtn{border:1px solid var(--amber);color:var(--amber);background:none;border-radius:7px;padding:3px 10px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.watchbtn:hover{background:#f2b13422}.watchbox video{display:block;width:min(560px,100%);border:1px solid var(--line);border-radius:8px;background:#000;margin-top:6px}`;

export const WATCH_SCRIPT = `
  const WATCH_URL = ${JSON.stringify(WATCH_URL)};
  const videos = {};   // row name -> {at, secs, bytes}, from the owner-only index; empty until it answers or when the bucket is not there
  const mmss = secs => Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  const loadVideos = then => fetch(WATCH_URL + '?index').then(r => r.json()).then(found => { Object.assign(videos, found && found.videos); then(); }).catch(() => {});
  // The button of a row that has a video: it opens the row's details (show), where the player is.
  const watchButton = (name, show) => videos[name] ? el('button', {className: 'watchbtn', type: 'button', title: 'Watch this row\\'s last fill', textContent: '▶ Watch ' + mmss(videos[name].secs), onclick: event => { event.stopPropagation(); show(); }}) : null;
  const watchPlayer = name => el('div', {className: 'watchbox'}, el('h4', {textContent: videos[name] ? 'Fill video · ' + mmss(videos[name].secs) + ' · ' + String(videos[name].at).slice(0, 16).replace('T', ' ') + ' UTC' : 'Fill video'}),
    videos[name] ? el('video', {controls: true, preload: 'metadata', src: WATCH_URL + '?name=' + encodeURIComponent(name)}) : el('div', {className: 'muted', textContent: 'No video yet: this row has not run since videos began, or it was not recorded.'}));
`;

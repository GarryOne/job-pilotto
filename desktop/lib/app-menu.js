// The app's menu bar: Electron's standard menus, plus "Check for Updates…" where Mac users look for it
// (Job Pilotto menu, under About); on Windows it sits in Help. Only stable releases are offered.
// Help → Send Feedback… on both platforms (lib/app-feedback.js). Edit → Find… (⌘F), Find Next (⌘G), Find Previous
// (⇧⌘G): find(what) tells the window ('open' | 'next' | 'previous'; renderer/pages/find.js).
export function template({name, mac, checkForUpdates, sendFeedback = () => {}, find = () => {}}) {
  const feedback = {label: 'Send Feedback…', click: sendFeedback};
  const check = [{label: 'Check for Updates…', click: checkForUpdates}];
  return [
    ...(mac ? [{label: name, submenu: [{role: 'about'}, ...check, {type: 'separator'}, {role: 'services'}, {type: 'separator'},
      {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]}] : []),
    {role: 'fileMenu'},
    {label: 'Edit', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'},
      ...(mac ? [{role: 'pasteAndMatchStyle'}] : []), {role: 'delete'}, {role: 'selectAll'}, {type: 'separator'},
      {label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => find('open')},
      {label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => find('next')},
      {label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: () => find('previous')}]},
    {role: 'viewMenu'}, {role: 'windowMenu'},
    {role: 'help', submenu: mac ? [feedback] : [feedback, ...check]},
  ];
}

// What "Check for Updates…" answers: {message, detail, buttons, install?}.
export function answer(result, current) {
  if (result?.fromSource) return {type: 'info', message: 'Running from source (npm start)', detail: 'Updates are for the installed app. Here, update with git pull and restart.', buttons: ['OK']};
  if (!result?.ok) return {type: 'warning', message: 'Couldn\'t check for updates', detail: result?.text || 'Try again later.', buttons: ['OK']};
  if (!result.offer) return {type: 'info', message: 'You\'re up to date', buttons: ['OK'],
    detail: `Job Pilotto ${current} is the latest version.`};
  return {type: 'info', message: `Job Pilotto ${result.offer.version} is available`, install: true,
    detail: `You have ${current}. Updating takes about 30 seconds: the app closes, updates and opens again.`,
    buttons: ['Update now', 'Later']};
}

// The app's menu bar: Electron's standard menus, plus "Check for Updates…" where Mac users look for it
// (Job Pilotto menu, under About); on Windows it sits in Help.
export function template({name, mac, checkForUpdates}) {
  const check = {label: 'Check for Updates…', click: checkForUpdates};
  return [
    ...(mac ? [{label: name, submenu: [{role: 'about'}, check, {type: 'separator'}, {role: 'services'}, {type: 'separator'},
      {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]}] : []),
    {role: 'fileMenu'}, {role: 'editMenu'}, {role: 'viewMenu'}, {role: 'windowMenu'},
    {role: 'help', submenu: mac ? [] : [check]},
  ];
}

// What "Check for Updates…" answers: {message, detail, buttons, install?}.
export function answer(result, current) {
  if (!result?.ok) return {type: 'warning', message: 'Couldn\'t check for updates', detail: result?.text || 'Try again later.', buttons: ['OK']};
  if (!result.offer) return {type: 'info', message: 'You\'re up to date', detail: `Job Pilotto ${current} is the latest version.`, buttons: ['OK']};
  return {type: 'info', message: `Job Pilotto ${result.offer.version} is available`, install: true,
    detail: `You have ${current}. Updating takes about 30 seconds: the app closes, updates and opens again.`,
    buttons: ['Update now', 'Later']};
}

// The app's menu bar: Electron's standard menus, plus "Check for Updates…" where Mac users look for it
// (Job Pilotto menu, under About); on Windows it sits in Help. Under it, once settings are loaded (testBuilds not
// undefined): "Get Test Builds" (pre-releases, trialled one canary build at a time: lib/canary.js) and, when on, the
// escape hatch "Update to the Newest Test Build Now".
export function template({name, mac, checkForUpdates, testBuilds, setTestBuilds, updateToNewest}) {
  const check = [{label: 'Check for Updates…', click: checkForUpdates},
    ...(testBuilds === undefined ? [] : [
      {label: 'Get Test Builds', type: 'checkbox', checked: !!testBuilds, click: item => setTestBuilds(item.checked)},
      ...(testBuilds ? [{label: 'Update to the Newest Test Build Now…', click: updateToNewest}] : [])])];
  return [
    ...(mac ? [{label: name, submenu: [{role: 'about'}, ...check, {type: 'separator'}, {role: 'services'}, {type: 'separator'},
      {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]}] : []),
    {role: 'fileMenu'}, {role: 'editMenu'}, {role: 'viewMenu'}, {role: 'windowMenu'},
    {role: 'help', submenu: mac ? [] : check},
  ];
}

// What "Check for Updates…" answers: {message, detail, buttons, install?}.
export function answer(result, current) {
  if (!result?.ok) return {type: 'warning', message: 'Couldn\'t check for updates', detail: result?.text || 'Try again later.', buttons: ['OK']};
  if (!result.offer) return {type: 'info', message: 'You\'re up to date', buttons: ['OK'],
    detail: result.trial ? `${result.trial}. Newer test builds wait until this trial ends.` : `Job Pilotto ${current} is the latest version.`};
  return {type: 'info', message: `Job Pilotto ${result.offer.version} is available`, install: true,
    detail: `You have ${current}. Updating takes about 30 seconds: the app closes, updates and opens again.`,
    buttons: ['Update now', 'Later']};
}

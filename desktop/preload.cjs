// The window's only bridge to the app: named actions, no Node access, no secret values.
const {contextBridge, ipcRenderer} = require('electron');

const call = name => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('pilot', {
  state: call('state'), saveSettings: call('saveSettings'), saveSecret: call('saveSecret'),
  checkAnthropic: call('checkAnthropic'), chooseCv: call('chooseCv'),
  draftStrategy: call('draftStrategy'), saveStrategy: call('saveStrategy'),
  profileText: call('profileText'), saveProfileText: call('saveProfileText'),
  jobs: call('jobs'), refresh: call('refresh'), setStatus: call('setStatus'), apply: call('apply'),
  notionConnect: call('notionConnect'), telegramConnect: call('telegramConnect'), setAutomation: call('setAutomation'),
  onTelegramWaiting: callback => ipcRenderer.on('telegramWaiting', (_, username) => callback(username)),
  openExternal: call('openExternal'), showFolder: call('showFolder'), extensionInfo: call('extensionInfo'),
  onLog: callback => ipcRenderer.on('log', (_, line) => callback(line)),
});

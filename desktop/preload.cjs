// The window's only bridge to the app: named actions, no Node access, no secret values.
const {contextBridge, ipcRenderer} = require('electron');

const call = name => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('pilot', {
  state: call('state'), saveSettings: call('saveSettings'), saveSecret: call('saveSecret'),
  checkAnthropic: call('checkAnthropic'), chooseCv: call('chooseCv'),
  draftStrategy: call('draftStrategy'), cachedDraft: call('cachedDraft'), cacheDraftEdits: call('cacheDraftEdits'), saveStrategy: call('saveStrategy'),
  profileText: call('profileText'), saveProfileText: call('saveProfileText'),
  jobs: call('jobs'), runs: call('runs'), firstSearch: call('firstSearch'), refresh: call('refresh'), setStatus: call('setStatus'), apply: call('apply'), applyOne: call('applyOne'), openTabs: call('openTabs'), prepareKit: call('prepareKit'),
  notionConnect: call('notionConnect'), telegramConnect: call('telegramConnect'), setAutomation: call('setAutomation'),
  onCloudStep: callback => ipcRenderer.on('cloudStep', (_, step) => callback(step)),
  onNotionProgress: callback => ipcRenderer.on('notionProgress', (_, progress) => callback(progress)),
  onDraftProgress: callback => ipcRenderer.on('draftProgress', (_, progress) => callback(progress)),
  onSaveProgress: callback => ipcRenderer.on('saveProgress', (_, progress) => callback(progress)),
  onTelegramWaiting: callback => ipcRenderer.on('telegramWaiting', (_, username) => callback(username)),
  command: call('command'), chooseTranscript: call('chooseTranscript'), reviewInterview: call('reviewInterview'),
  cloudConnect: call('cloudConnect'), cloudOff: call('cloudOff'),
  openExternal: call('openExternal'), openNotion: call('openNotion'), showFolder: call('showFolder'), extensionInfo: call('extensionInfo'),
  onLog: callback => ipcRenderer.on('log', (_, line) => callback(line)),
});

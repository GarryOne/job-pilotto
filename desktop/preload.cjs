// The window's only bridge to the app: named actions, no Node access, no secret values.
const {contextBridge, ipcRenderer} = require('electron');

// A window newer than the app behind it (code updated while the app ran, then the window reloaded) calls
// actions the running app doesn't have yet: the window is told once, so it can offer a restart.
const call = name => (...args) => ipcRenderer.invoke(name, ...args).catch(error => {
  if (/No handler registered/.test(String(error?.message))) window.dispatchEvent(new Event('pilot-outdated'));
  throw error;
});
contextBridge.exposeInMainWorld('pilot', {
  platform: process.platform,
  state: call('state'), saveSettings: call('saveSettings'), saveSecret: call('saveSecret'),
  checkAnthropic: call('checkAnthropic'), chooseCv: call('chooseCv'),
  draftStrategy: call('draftStrategy'), cachedDraft: call('cachedDraft'), cacheDraftEdits: call('cacheDraftEdits'), saveStrategy: call('saveStrategy'),
  jobs: call('jobs'), runs: call('runs'), runDetail: call('runDetail'), notionOAuth: call('notionOAuth'), notionOAuthCancel: call('notionOAuthCancel'), cvChange: call('cvChange'), cvReview: call('cvReview'), cvApply: call('cvApply'), cvChangeDone: call('cvChangeDone'), backupNow: call('backupNow'), showBackups: call('showBackups'), backupStatus: call('backupStatus'), resetProfile: call('resetProfile'), exportProfile: call('exportProfile'), importProfile: call('importProfile'), lastReset: call('lastReset'), contact: call('contact'), saveContact: call('saveContact'), checkMail: call('checkMail'), firstSearch: call('firstSearch'), refresh: call('refresh'), setStatus: call('setStatus'), focus: call('focus'), sessions: call('sessions'), sessionOutput: call('sessionOutput'), sessionWrite: call('sessionWrite'), sessionResize: call('sessionResize'), sessionStop: call('sessionStop'), sessionRemove: call('sessionRemove'), focusDone: call('focusDone'), dailyTarget: call('dailyTarget'), setDailyTarget: call('setDailyTarget'), reviewRejection: call('reviewRejection'), apply: call('apply'), applyOne: call('applyOne'), applyWithClaude: call('applyWithClaude'), claudeReady: call('claudeReady'), claudePrereqs: call('claudePrereqs'), googleStatus: call('googleStatus'), googleConnect: call('googleConnect'), openTabs: call('openTabs'), extensionSeen: call('extensionSeen'), openQuestions: call('openQuestions'), addApplied: call('addApplied'), addLead: call('addLead'), clipboardImage: call('clipboardImage'), standardAnswers: call('standardAnswers'), rebuildImpact: call('rebuildImpact'), rescorePrevious: call('rescorePrevious'), cached: call('cached'), strategyData: call('strategyData'), answerQuestion: call('answerQuestion'), rememberAnswer: call('rememberAnswer'), secretHints: call('secretHints'), prepareKit: call('prepareKit'),
  tailorCv: call('tailorCv'), openTailoredCv: call('openTailoredCv'), cvStatus: call('cvStatus'), importCv: call('importCv'), viewBaseCv: call('viewBaseCv'), showCvFolder: call('showCvFolder'),
  notionConnect: call('notionConnect'), telegramConnect: call('telegramConnect'), setAutomation: call('setAutomation'),
  onCloudStep: callback => ipcRenderer.on('cloudStep', (_, step) => callback(step)),
  onNotionProgress: callback => ipcRenderer.on('notionProgress', (_, progress) => callback(progress)),
  onDraftProgress: callback => ipcRenderer.on('draftProgress', (_, progress) => callback(progress)),
  onExportProgress: callback => ipcRenderer.on('exportProgress', (_, count) => callback(count)),
  onSaveProgress: callback => ipcRenderer.on('saveProgress', (_, progress) => callback(progress)),
  onToast: callback => ipcRenderer.on('toast', (_, toast) => callback(toast)),
  onSession: callback => ipcRenderer.on('session', (_, event, payload) => callback(event, payload)),
  onTelegramWaiting: callback => ipcRenderer.on('telegramWaiting', (_, username) => callback(username)),
  command: call('command'),
  interviews: {drafts: call('ivDrafts'), transcript: call('ivTranscript'), add: call('ivAdd'), recordStart: call('ivRecordStart'),
    recordChunk: call('ivRecordChunk'), recordStop: call('ivRecordStop'), transcribe: call('ivTranscribe'), saveDraft: call('ivSaveDraft'),
    discard: call('ivDiscard'), save: call('ivSave'), saved: call('ivSaved'), link: call('ivLink'), review: call('ivReview'), remove: call('ivDelete'),
    recordings: call('ivRecordings'), access: call('mediaAccess'), tapAvailable: call('ivTapAvailable'), tapStart: call('ivTapStart'), openPrivacy: call('openPrivacy'), relaunch: call('relaunch')},
  onInterviewProgress: callback => ipcRenderer.on('ivProgress', (_, step) => callback(step)),
  onCallLevel: callback => ipcRenderer.on('ivLevel', (_, level) => callback(level)),
  cloudConnect: call('cloudConnect'), cloudOff: call('cloudOff'), telegramCloudOn: call('telegramCloudOn'), telegramCloudOff: call('telegramCloudOff'),
  openExternal: call('openExternal'), showBrowser: call('showBrowser'), openNotion: call('openNotion'), showFolder: call('showFolder'), extensionInfo: call('extensionInfo'),
  onLog: callback => ipcRenderer.on('log', (_, line) => callback(line)),
  onMoved: callback => ipcRenderer.on('moved', (_, steps) => callback(steps)),
});

// The window's only bridge to the app: named actions, no Node access, no secret values.
const {contextBridge, ipcRenderer} = require('electron');

// A window newer than the app behind it (code updated while the app ran, then the window reloaded) calls
// actions the running app doesn't have yet: the window is told once, so it can offer a restart.
// Notion later: an action that needs Notion answers {needsNotion, reason} (lib/notion-gate.js). The window is told once
// (pilot-needs-notion), opens the connect prompt, and after a connect runs the same action again (retryNotionNeed).
let need = null;
const call = name => (...args) => ipcRenderer.invoke(name, ...args).then(result => {
  if (result && result.needsNotion) { need = {name, args, reason: result.reason}; window.dispatchEvent(new Event('pilot-needs-notion')); }
  return result;
}, error => {
  if (/No handler registered/.test(String(error?.message))) window.dispatchEvent(new Event('pilot-outdated'));
  throw error;
});
contextBridge.exposeInMainWorld('pilot', {
  platform: process.platform,
  takeNotionNeed: () => (need ? {name: need.name, reason: need.reason} : null),
  retryNotionNeed: () => (need ? ipcRenderer.invoke(need.name, ...need.args) : Promise.resolve(null)),
  state: call('state'), saveSettings: call('saveSettings'), saveSecret: call('saveSecret'),
  lookAround: call('lookAround'), leaveDemo: call('leaveDemo'),
  checkAnthropic: call('checkAnthropic'), chooseCv: call('chooseCv'),
  draftStrategy: call('draftStrategy'), cachedDraft: call('cachedDraft'), cacheDraftEdits: call('cacheDraftEdits'), saveStrategy: call('saveStrategy'),
  jobs: call('jobs'), calendarJobs: call('calendarJobs'), calendarRecordings: call('calendarRecordings'), audience: call('audience'), runs: call('runs'), runDetail: call('runDetail'), notionOAuth: call('notionOAuth'), notionGateEvent: call('notionGateEvent'), notionOAuthCancel: call('notionOAuthCancel'), cvChange: call('cvChange'), cvReview: call('cvReview'), cvApply: call('cvApply'), cvChangeDone: call('cvChangeDone'), backupNow: call('backupNow'), showBackups: call('showBackups'), backupStatus: call('backupStatus'), resetProfile: call('resetProfile'), exportProfile: call('exportProfile'), exportCancel: call('exportCancel'), importProfile: call('importProfile'), lastReset: call('lastReset'), contact: call('contact'), saveContact: call('saveContact'), checkMail: call('checkMail'), firstSearch: call('firstSearch'), refresh: call('refresh'), setStatus: call('setStatus'), focus: call('focus'), sessions: call('sessions'), sessionOutput: call('sessionOutput'), sessionSnapshot: call('sessionSnapshot'), sessionTranscript: call('sessionTranscript'), sessionWrite: call('sessionWrite'), sessionResize: call('sessionResize'), sessionStop: call('sessionStop'), sessionResume: call('sessionResume'), sessionRemove: call('sessionRemove'), sessionSubmitted: call('sessionSubmitted'), sessionFinish: call('sessionFinish'), sessionRestart: call('sessionRestart'), sessionCancel: call('sessionCancel'), sessionSkip: call('sessionSkip'), sessionsLeftOpen: call('sessionsLeftOpen'), unapplyJob: call('unapplyJob'), notSubmitted: call('notSubmitted'), focusDone: call('focusDone'), interviewHappened: call('interviewHappened'), focusHistory: call('focusHistory'), reassignEmail: call('reassignEmail'), interviewPrep: call('interviewPrep'), describeJob: call('describeJob'), feedbackAction: call('feedbackAction'), dailyTarget: call('dailyTarget'), setDailyTarget: call('setDailyTarget'), reviewRejection: call('reviewRejection'), apply: call('apply'), applyOne: call('applyOne'), applyWithClaude: call('applyWithClaude'), claudeReady: call('claudeReady'), pageView: call('pageView'), claudePrereqs: call('claudePrereqs'), googleStatus: call('googleStatus'), googleConnect: call('googleConnect'), openTabs: call('openTabs'), formsOpen: call('formsOpen'), extensionSeen: call('extensionSeen'), extensionInstall: call('extensionInstall'), extensionPage: call('extensionPage'), strayChrome: call('strayChrome'), quitStrayChrome: call('quitStrayChrome'), extensionShow: call('extensionShow'), extensionOptions: call('extensionOptions'), openQuestions: call('openQuestions'), addApplied: call('addApplied'), importJob: call('importJob'), addLead: call('addLead'), proposeLead: call('proposeLead'), clipboardImage: call('clipboardImage'), standardAnswers: call('standardAnswers'), rebuildImpact: call('rebuildImpact'), rescorePrevious: call('rescorePrevious'), cached: call('cached'), strategyData: call('strategyData'), answerQuestion: call('answerQuestion'), rememberAnswer: call('rememberAnswer'), secretHints: call('secretHints'), prepareKit: call('prepareKit'),
  tailorCv: call('tailorCv'), tailorTop: call('tailorTop'), openTailoredCv: call('openTailoredCv'), cvStatus: call('cvStatus'), cvOf: call('cvOf'), matchCheck: call('matchCheck'), tuneProposals: call('tuneProposals'), tuneApply: call('tuneApply'), matchSaved: call('matchSaved'), cvCheckStatus: call('cvCheckStatus'), cvCheckRun: call('cvCheckRun'), cvCheckAi: call('cvCheckAi'), importCv: call('importCv'), viewBaseCv: call('viewBaseCv'), showCvFolder: call('showCvFolder'),
  coverLetter: call('coverLetter'), coverLetterDraft: call('coverLetterDraft'), coverLetterSave: call('coverLetterSave'), coverLetterApprove: call('coverLetterApprove'), coverLetterOpen: call('coverLetterOpen'),
  notionConnect: call('notionConnect'), telegramConnect: call('telegramConnect'), setAutomation: call('setAutomation'), setTheme: call('setTheme'),
  onCloudStep: callback => ipcRenderer.on('cloudStep', (_, step) => callback(step)),
  onLeadStep: callback => ipcRenderer.on('leadStep', (_, step) => callback(step)),
  onPrepStep: callback => ipcRenderer.on('prepStep', (_, step) => callback(step)),
  markOutcome: call('markOutcome'),
  searchCoverage: call('searchCoverage'), addRoles: call('addRoles'), loosenSearch: call('loosenSearch'), addPlaces: call('addPlaces'),
  dismissReason: call('dismissReason'), intelSnapshot: call('intelSnapshot'), benchmarkLines: call('benchmarkLines'),
  license: call('license'), licenseSet: call('licenseSet'), licenseRemove: call('licenseRemove'),
  onAllowance: callback => ipcRenderer.on('allowance', (_, state) => callback(state)),
  telemetryRecord: call('telemetryRecord'), telemetryShown: call('telemetryShown'), telemetrySet: call('telemetrySet'), testerLogsSet: call('testerLogsSet'),
  poolShareGet: call('poolShareGet'), poolShareSet: call('poolShareSet'), poolShareShown: call('poolShareShown'),
  updateState: call('updateState'), updateStatus: call('updateStatus'), updateCheck: call('updateCheck'), updateInstall: call('updateInstall'), betaState: call('betaState'), betaSet: call('betaSet'), betaRollback: call('betaRollback'),
  onUpdate: callback => ipcRenderer.on('update', (_, offer) => callback(offer)),
  sendFeedback: call('sendFeedback'), leaveReason: call('leaveReason'),
  onAskWhyLeaving: callback => ipcRenderer.on('askWhyLeaving', () => callback()),
  startTrialCredit: call('startTrialCredit'), trialCredit: call('trialCredit'),
  claudeCodeStatus: call('claudeCodeStatus'), verifyClaudeCode: call('verifyClaudeCode'), setAiEngine: call('setAiEngine'),
  setAiFallback: call('setAiFallback'), dismissEngineOffer: call('dismissEngineOffer'),
  onOpenFeedback: callback => ipcRenderer.on('openFeedback', () => callback()),
  onFind: callback => ipcRenderer.on('find', (_, what) => callback(what)),
  onOpenInterviews: callback => ipcRenderer.on('openInterviews', () => callback()),
  onUpdateStep: callback => ipcRenderer.on('updateStep', (_, step) => callback(step)),
  onNotionProgress: callback => ipcRenderer.on('notionProgress', (_, progress) => callback(progress)),
  onDraftProgress: callback => ipcRenderer.on('draftProgress', (_, progress) => callback(progress)),
  onExportProgress: callback => ipcRenderer.on('exportProgress', (_, count) => callback(count)),
  onSaveProgress: callback => ipcRenderer.on('saveProgress', (_, progress) => callback(progress)),
  onApplyProgress: callback => ipcRenderer.on('applyProgress', (_, text) => callback(text)),
  onToast: callback => ipcRenderer.on('toast', (_, toast) => callback(toast)),
  onOpenTarget: callback => ipcRenderer.on('openTarget', (_, target) => callback(target)),   // a clicked notification (lib/targets.js)
  onReview: callback => ipcRenderer.on('review', (_, state) => callback(state)),
  reviewWatch: call('reviewWatch'), reviewStates: call('reviewStates'), reviewFocus: call('reviewFocus'), reviewReload: call('reviewReload'),
  onSession: callback => ipcRenderer.on('session', (_, event, payload) => callback(event, payload)),
  onTelegramWaiting: callback => ipcRenderer.on('telegramWaiting', (_, username) => callback(username)),
  command: call('command'),
  interviews: {drafts: call('ivDrafts'), transcript: call('ivTranscript'), add: call('ivAdd'), recordStart: call('ivRecordStart'),
    recordChunk: call('ivRecordChunk'), recordStop: call('ivRecordStop'), transcribe: call('ivTranscribe'), prefetch: call('ivPrefetch'), saveDraft: call('ivSaveDraft'),
    discard: call('ivDiscard'), save: call('ivSave'), saved: call('ivSaved'), link: call('ivLink'), review: call('ivReview'), insights: call('ivInsights'), insightStep: call('ivInsightStep'), remove: call('ivDelete'),
    remindGet: call('ivRemindGet'), remindSet: call('ivRemindSet'), recordings: call('ivRecordings'), access: call('mediaAccess'), tapAvailable: call('ivTapAvailable'), tapStart: call('ivTapStart'), openPrivacy: call('openPrivacy'), relaunch: call('relaunch')},
  onInterviewProgress: callback => ipcRenderer.on('ivProgress', (_, step) => callback(step)),
  onCallLevel: callback => ipcRenderer.on('ivLevel', (_, level) => callback(level)),
  cloudConnect: call('cloudConnect'), cloudOff: call('cloudOff'), cloudTurnOffConfirmed: call('cloudTurnOffConfirmed'), telegramCloudOn: call('telegramCloudOn'), telegramCloudOff: call('telegramCloudOff'),
  openExternal: call('openExternal'), showBrowser: call('showBrowser'), openNotion: call('openNotion'), showFolder: call('showFolder'), extensionInfo: call('extensionInfo'),
  onLog: callback => ipcRenderer.on('log', (_, line) => callback(line)),
  onMoved: callback => ipcRenderer.on('moved', (_, steps) => callback(steps)),
});

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  saveTimeline: (data, filename, options) => ipcRenderer.invoke('save-timeline', { data, filename, create: options?.create === true }),
  saveTimelineThumbnail: (payload) => ipcRenderer.invoke('save-timeline-thumbnail', payload),
  listTimelines: () => ipcRenderer.invoke('list-timelines'),
  loadTimeline: (filename) => ipcRenderer.invoke('load-timeline', filename),
  exportTimeline: (data, suggestedName) => ipcRenderer.invoke('export-timeline', { data, suggestedName }),
  exportTimelinePackage: (data, suggestedName) => ipcRenderer.invoke('export-timeline-package', { data, suggestedName }),
  importTimeline: (payload) => ipcRenderer.invoke('import-timeline', payload),
  deleteTimeline: (payload) => ipcRenderer.invoke('delete-timeline', payload),
  createNote: (payload) => ipcRenderer.invoke('create-note', payload),
  addExistingNote: (payload) => ipcRenderer.invoke('add-existing-note', payload),
  readNote: (payload) => ipcRenderer.invoke('read-note', payload),
  writeNote: (payload) => ipcRenderer.invoke('write-note', payload),
  deleteNote: (payload) => ipcRenderer.invoke('delete-note', payload),
  renameNote: (payload) => ipcRenderer.invoke('rename-note', payload),
  renameTimeline: (payload) => ipcRenderer.invoke('rename-timeline', payload),
  createFolder: (payload) => ipcRenderer.invoke('create-folder', payload),
  listFolders: () => ipcRenderer.invoke('list-folders'),
  moveTimeline: (payload) => ipcRenderer.invoke('move-timeline', payload),
  renameFolder: (payload) => ipcRenderer.invoke('rename-folder', payload),
  updateTimelineTitle: (payload) => ipcRenderer.invoke('update-timeline-title', payload),
  setTimelineNeverSync: (payload) => ipcRenderer.invoke('set-timeline-never-sync', payload),
  deleteFolder: (payload) => ipcRenderer.invoke('delete-folder', payload),
  moveFolder: (payload) => ipcRenderer.invoke('move-folder', payload),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings) => ipcRenderer.invoke('set-app-settings', settings),
  chooseTimelinesDir: () => ipcRenderer.invoke('choose-timelines-dir'),
  chooseNotesDir: () => ipcRenderer.invoke('choose-notes-dir'),
  chooseNotesSubfolder: () => ipcRenderer.invoke('choose-notes-subfolder'),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  openTimelinesFolder: () => ipcRenderer.invoke('open-timelines-folder'),
  openNotesFolder: () => ipcRenderer.invoke('open-notes-folder'),
  openThemesFolder: () => ipcRenderer.invoke('open-themes-folder'),
  openFontsFolder: () => ipcRenderer.invoke('open-fonts-folder'),
  getNotesBaseDir: () => ipcRenderer.invoke('get-notes-base-dir'),
  getAssetsBaseDir: () => ipcRenderer.invoke('get-assets-base-dir'),
  pickAndImportImage: (payload) => ipcRenderer.invoke('pick-and-import-image', payload),
  importImageFromPath: (payload) => ipcRenderer.invoke('import-image-from-path', payload),
  copyTimelineStorage: (payload) => ipcRenderer.invoke('copy-timeline-storage', payload),
  deleteAsset: (payload) => ipcRenderer.invoke('delete-asset', payload),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  chooseAssetsDir: () => ipcRenderer.invoke('choose-assets-dir'),
  openAssetsFolder: () => ipcRenderer.invoke('open-assets-folder'),
  listThemes: () => ipcRenderer.invoke('list-themes'),
  listFonts: () => ipcRenderer.invoke('list-fonts'),
  saveUserTheme: (payload) => ipcRenderer.invoke('save-user-theme', payload),
  deleteUserTheme: (payload) => ipcRenderer.invoke('delete-user-theme', payload),
  importThemeDialog: () => ipcRenderer.invoke('import-theme-dialog'),
  fetchWikipedia: (payload) => ipcRenderer.invoke('fetch-wikipedia', payload),
  openExternal: (payload) => ipcRenderer.invoke('open-external', payload),
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  gitSyncConnect: (payload) => ipcRenderer.invoke('git-sync-connect', payload),
  gitSyncUpdateCredentials: (payload) => ipcRenderer.invoke('git-sync-update-credentials', payload),
  gitSyncNow: () => ipcRenderer.invoke('git-sync-now'),
  gitSyncStatus: () => ipcRenderer.invoke('git-sync-status'),
  gitSyncUpdateSettings: (payload) => ipcRenderer.invoke('git-sync-update-settings', payload),
  gitSyncDisconnect: (payload) => ipcRenderer.invoke('git-sync-disconnect', payload),
  gitSyncRebuild: () => ipcRenderer.invoke('git-sync-rebuild'),
  gitSyncMirrorSize: () => ipcRenderer.invoke('git-sync-mirror-size'),
  gitSyncShareInfo: (payload) => ipcRenderer.invoke('git-sync-share-info', payload),
  gitSyncFileHistory: (payload) => ipcRenderer.invoke('git-sync-file-history', payload),
  gitSyncRestoreVersion: (payload) => ipcRenderer.invoke('git-sync-restore-version', payload),
  onGitSyncState: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('git-sync-state-changed', listener);
    return () => ipcRenderer.removeListener('git-sync-state-changed', listener);
  },
  onGitSyncApplied: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('git-sync-applied', listener);
    return () => ipcRenderer.removeListener('git-sync-applied', listener);
  },
  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdaterStatus: (callback) => {
    ipcRenderer.on('updater-status', (_event, data) => callback(data));
  },
  offUpdaterStatus: () => {
    ipcRenderer.removeAllListeners('updater-status');
  },
  platform: process.platform,
});

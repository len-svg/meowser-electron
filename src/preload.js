const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Profile
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfiles: (ps) => ipcRenderer.invoke('profiles:save', ps),
  upsertProfile: (p) => ipcRenderer.invoke('profiles:upsert', p),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  onProfilesChanged: (cb) => ipcRenderer.on('profiles:changed', cb),

  // 启动
  launch: (profile, opts) => ipcRenderer.invoke('launch', profile, opts),

  // 编辑窗
  openEdit: (profile) => ipcRenderer.invoke('edit:open', profile),
  closeEdit: () => ipcRenderer.invoke('edit:close'),

  // 书签管理窗
  openBookmarkManager: (profileId) => ipcRenderer.invoke('bm:openManager', profileId),
  onBookmarkSwitchProfile: (cb) => ipcRenderer.on('bm:switchProfile', (_, pid) => cb(pid)),

  // 书签
  listBookmarks: (profileId) => ipcRenderer.invoke('bm:list', profileId),
  addBookmark: (profileId, item) => ipcRenderer.invoke('bm:add', profileId, item),
  removeBookmark: (profileId, url) => ipcRenderer.invoke('bm:remove', profileId, url),
  reorderBookmarks: (profileId, urls) => ipcRenderer.invoke('bm:reorder', profileId, urls),
  setBookmarkFolder: (profileId, url, folder) => ipcRenderer.invoke('bm:setFolder', profileId, url, folder),
  listBookmarkFolders: (profileId) => ipcRenderer.invoke('bm:folders', profileId),
  renameBookmarkFolder: (profileId, oldName, newName) => ipcRenderer.invoke('bm:renameFolder', profileId, oldName, newName),
  importBookmarksFromChrome: (profileId) => ipcRenderer.invoke('bm:importChrome', profileId),
  exportBookmarksHtml: (profileId) => ipcRenderer.invoke('bm:exportHtml', profileId),
  importBookmarksHtml: (profileId) => ipcRenderer.invoke('bm:importHtml', profileId),
  onBookmarksChanged: (cb) => ipcRenderer.on('bm:changed', (_, profileId) => cb(profileId)),

  // 窗口
  resize: (w, h) => ipcRenderer.invoke('window:resize', { w, h }),
  toggleSize: () => ipcRenderer.invoke('window:toggleSize'),
  setOpacity: (a) => ipcRenderer.invoke('window:setOpacity', a),
  togglePin: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
  setAutoShrink: (v) => ipcRenderer.invoke('window:setAutoShrink', v),
  openExternal: (url, app) => ipcRenderer.invoke('window:openExternal', url, app),
  relaunchIncognito: () => ipcRenderer.invoke('window:relaunchIncognito'),
  onResized: (cb) => ipcRenderer.on('window:resized', (_, d) => cb(d)),

  // 摆放
  arrange: (edge, style) => ipcRenderer.invoke('layout:arrange', edge, style),

  // 扩展
  installLocalExtension: (profileId) => ipcRenderer.invoke('extension:installLocal', profileId),
  installExtensionFromStore: (urlOrId, profileId) => ipcRenderer.invoke('extension:installFromStore', urlOrId, profileId),
  listExtensions: (profileId) => ipcRenderer.invoke('extension:list', profileId),
  removeExtension: (profileId, dirName) => ipcRenderer.invoke('extension:remove', profileId, dirName),
  openExtensionsDir: (profileId) => ipcRenderer.invoke('extension:openDir', profileId),
  reloadExtensions: (profileId) => ipcRenderer.invoke('extension:reload', profileId),
  registerWebviewTab: () => ipcRenderer.invoke('extension:registerWebviewTab'),

  // 日志
  openLogFile: () => ipcRenderer.invoke('log:openFile'),
  openLogDir:  () => ipcRenderer.invoke('log:openDir'),
  logPath:     () => ipcRenderer.invoke('log:path'),

  // 新建窗口（链接打开）
  openInNewWindow: (url) => ipcRenderer.invoke('window:openInNewWindow', url),

  // 文本输入框
  askText: (opts) => ipcRenderer.invoke('ui:askText', opts || {}),

  // 配置导出/导入
  exportConfig: () => ipcRenderer.invoke('migrate:export'),
  importConfig: () => ipcRenderer.invoke('migrate:import'),

  // 首页
  homeUrl: (profile) => ipcRenderer.invoke('home:url', profile),

  // 剪贴板
  copyText: (text) => ipcRenderer.invoke('clipboard:writeText', text),

  // 内存监控（每 5 秒一推）
  onMemUpdate: (cb) => ipcRenderer.on('mem:update', (_, d) => cb(d)),

  // app 版本
  appVersion: () => ipcRenderer.invoke('app:version'),

  // 历史 (v0.6.0)
  openHistoryManager: (profileId)       => ipcRenderer.invoke('history:openManager', profileId),
  historyList:   (profileId)            => ipcRenderer.invoke('history:list', profileId),
  historySearch: (profileId, q, n)      => ipcRenderer.invoke('history:search', profileId, q, n),
  historyRemove: (profileId, url)       => ipcRenderer.invoke('history:remove', profileId, url),
  historyClear:  (profileId)            => ipcRenderer.invoke('history:clear', profileId),

  // 会话恢复 (v0.6.0)
  sessionPeek:    (profileId) => ipcRenderer.invoke('session:peek', profileId),
  sessionRestore: (profileId) => ipcRenderer.invoke('session:restore', profileId),
  sessionClear:   (profileId) => ipcRenderer.invoke('session:clear', profileId),

  // 偏好（per-profile prefs）
  prefsGet: (profileId) => ipcRenderer.invoke('prefs:get', profileId),

  // 自动更新
  updaterCheck:         () => ipcRenderer.invoke('updater:check'),
  updaterStatus:        () => ipcRenderer.invoke('updater:status'),
  updaterOpenReleases:  () => ipcRenderer.invoke('updater:openReleases'),
  onUpdaterStatus:      (cb) => ipcRenderer.on('updater:status', (_, p) => cb(p)),

  // 窗口管理 (v0.5.0)
  windowsList:               () => ipcRenderer.invoke('windows:list'),
  windowsFocus:              (id) => ipcRenderer.invoke('windows:focus', id),
  windowsClose:              (id, force) => ipcRenderer.invoke('windows:close', id, force),
  windowsCloseBatch:         (ids, force) => ipcRenderer.invoke('windows:closeBatch', { window_ids: ids, force }),
  windowsCloseByProfile:     (pid, keep_focused, force) => ipcRenderer.invoke('windows:closeByProfile', { profile_id: pid, keep_focused, force }),
  windowsCloseAllIncognito:  () => ipcRenderer.invoke('windows:closeAllIncognito'),
  windowsKeepFocusedCloseOthers: () => ipcRenderer.invoke('windows:keepFocusedCloseOthers'),
  onWindowsChanged:          (cb) => ipcRenderer.on('windows:changed', cb),
  openWindowManager:         () => ipcRenderer.invoke('windowManager:open'),

  electronVersion: process.versions.electron,
});

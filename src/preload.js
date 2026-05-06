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
  installLocalExtension: () => ipcRenderer.invoke('extension:installLocal'),
  installExtensionFromStore: (urlOrId) => ipcRenderer.invoke('extension:installFromStore', urlOrId),

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

  electronVersion: process.versions.electron,
});

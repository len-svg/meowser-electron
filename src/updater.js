// 自动更新 — 通过 electron-updater + GitHub Releases
//
// ⚠️ 重要限制：当前 app 是 ad-hoc 签名（package.json build.mac.identity=null）。
//   electron-updater 能下载新版 zip，但试图自动替换 .app 时 macOS Gatekeeper
//   会拦截"未签名 app 被未签名进程替换"的行为。所以这里采取"软更新"策略：
//   - 检测到新版 → 通知用户
//   - 用户点"下载"→ 用 shell.openExternal 打开 GitHub Releases 下载 dmg
//   - 用户手动拖装新 dmg
//
// 真无感更新需要：申请 Apple Developer ID → build.mac.identity = "XXXXX" →
// hardenedRuntime: true → notarize。这是另一回事，要钱要时间。
//
// IPC 接口:
//   updater:check          renderer → main，主动查更新
//   updater:status         main → renderer，状态推送：checking/found/none/error
//   updater:openReleases   renderer → main，shell 打开 release 页

const { app, ipcMain, shell, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;       // 我们不自动下载，先弹通知
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = console;

const RELEASES_PAGE = 'https://github.com/len-svg/meowser-electron/releases/latest';

let lastStatus = { state: 'idle' };

function broadcast(payload) {
  lastStatus = payload;
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('updater:status', payload);
  });
}

autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
autoUpdater.on('update-available', (info) => broadcast({
  state: 'found',
  version: info.version,
  releaseNotes: info.releaseNotes || '',
  current: app.getVersion(),
  releasePage: RELEASES_PAGE,
}));
autoUpdater.on('update-not-available', (info) => broadcast({
  state: 'none', current: app.getVersion(), latest: info && info.version,
}));
autoUpdater.on('error', (err) => broadcast({
  state: 'error', msg: (err && err.message) || String(err),
}));

function init() {
  // 启动 5 秒后第一次查
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => {
      console.error('checkForUpdates initial:', e.message);
      broadcast({ state: 'error', msg: e.message });
    });
  }, 5000);
  // 每 6 小时查一次
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(e => console.error('checkForUpdates interval:', e.message));
  }, 6 * 60 * 60 * 1000);
}

ipcMain.handle('updater:check', async () => {
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo && r.updateInfo.version };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
});
ipcMain.handle('updater:status', () => lastStatus);
ipcMain.handle('updater:openReleases', () => shell.openExternal(RELEASES_PAGE));

module.exports = { init };

// Meowser — Chromium 版主进程
const logger = require('./logger');  // 必须最早 require，以 hook 全局 console
const { app, BrowserWindow, ipcMain, screen, session,
        Menu, Tray, nativeImage, globalShortcut, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { renderWorkHome } = require('./bookmarks');
const slackHome = require('./slack_home');
const bm = require('./bookmarks_store');
const crx = require('./crx');
const migrate = require('./migrate');

// 第三方扩展运行时（提供 chrome.* API + 商店原生安装支持）
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, installExtension, uninstallExtension } = require('electron-chrome-web-store');

// ─── 数据目录 ───
const DATA_DIR = path.join(os.homedir(), '.meowser');
const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

const DEFAULT_PROFILES = [
  { id: 'p_default', name: '默认', note: '本地直连 · 默认工作区',
    emoji: '🐱', mode: 'work', theme: 'yellow',
    proxy: { type: 'direct' }, show_bookmarks: false },
  { id: 'p_work',    name: '工作', note: '公司 V2Ray',
    emoji: '💻', mode: 'work', theme: 'green',
    proxy: { type: 'http', host: '127.0.0.1', port: 1087 }, show_bookmarks: true },
  { id: 'p_fun',     name: '娱乐', note: '摸鱼 · 直连不卡顿',
    emoji: '🎮', mode: 'slack', theme: 'red',
    proxy: { type: 'direct' }, show_bookmarks: false },
];

function loadProfiles() {
  try {
    if (!fs.existsSync(PROFILES_PATH)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PROFILES_PATH, JSON.stringify(DEFAULT_PROFILES, null, 2), 'utf8');
      return [...DEFAULT_PROFILES];
    }
    return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
  } catch (e) { console.error('loadProfiles', e); return [...DEFAULT_PROFILES]; }
}
function saveProfiles(ps) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(ps, null, 2), 'utf8');
}

// ─── 首页 cache ───
function workHomeUrl(profile) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const fp = path.join(CACHE_DIR, `home_${profile.id}.html`);
  fs.writeFileSync(fp, renderWorkHome(profile, bm.load(profile.id)), 'utf8');
  return `file://${fp}`;
}
function slackHomeUrl(profile) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const fp = path.join(CACHE_DIR, `home_slack_${profile.id}.html`);
  fs.writeFileSync(fp, slackHome.render(profile), 'utf8');
  return `file://${fp}`;
}
function homeUrlFor(profile) {
  if (profile.mode === 'slack') return slackHomeUrl(profile);
  return workHomeUrl(profile);  // work 模式始终走自定义首页（profile 书签）
}

// ─── Session ───
const extLoaded = new Set();
// key=`${profileId}|${dirName}` → { state:'loading'|'loaded'|'failed', error?, id?, manifestVersion? }
const extStatus = new Map();
// session → ElectronChromeExtensions 实例（每个 profile session 一个）
const extensionsBySession = new WeakMap();
// 已经初始化过 web store 的 session 记忆
const webStoreInstalled = new WeakSet();

// 解析 chrome i18n 占位 __MSG_xxx__
function resolveMsg(extDir, manifest, value) {
  if (!value) return value;
  const m = String(value).match(/^__MSG_(\w+)__$/);
  if (!m) return value;
  const key = m[1];
  const tries = [manifest.default_locale, 'en', 'en_US', 'zh_CN', 'zh'].filter(Boolean);
  for (const loc of tries) {
    const fp = path.join(extDir, '_locales', loc, 'messages.json');
    if (!fs.existsSync(fp)) continue;
    try {
      const msgs = JSON.parse(fs.readFileSync(fp, 'utf8'));
      // chrome i18n 大小写不敏感
      const k = Object.keys(msgs).find(x => x.toLowerCase() === key.toLowerCase());
      if (k && msgs[k] && msgs[k].message) return msgs[k].message;
    } catch {}
  }
  return value;
}

function readManifest(extDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
    return {
      raw: m,
      name: resolveMsg(extDir, m, m.name) || path.basename(extDir),
      shortName: resolveMsg(extDir, m, m.short_name) || '',
      description: resolveMsg(extDir, m, m.description) || '',
      version: m.version || '?',
      manifestVersion: m.manifest_version || 0,
    };
  } catch (e) {
    return { raw: {}, name: path.basename(extDir), version: '?', manifestVersion: 0, parseError: e.message };
  }
}

// 用 electron-chrome-web-store 接管扩展加载与商店安装；保留 extStatus 跟踪以便 UI 显示真实错误
async function setupExtensionRuntime(profileId, ses) {
  const extDir = path.join(DATA_DIR, 'extensions', profileId);
  fs.mkdirSync(extDir, { recursive: true });

  // 1) chrome.* API 注入（chrome.tabs / chrome.action / popup / contextMenus 等）
  if (!extensionsBySession.has(ses)) {
    const ext = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: ses,
      createTab: async (details) => {
        // 扩展请求开新 tab → 我们没 tab，转开新窗口
        const profile = loadProfiles().find(p => p.id === profileId);
        if (!profile) throw new Error('profile not found');
        const win = createBrowserWindow(profile, { url: details.url || 'about:blank' });
        // 等 dom-ready 后取 webContents
        await new Promise(r => win.once('ready-to-show', r));
        return [win.webContents, win];
      },
      selectTab: () => {},
      removeTab: (tab, win) => { try { win.close(); } catch {} },
    });
    extensionsBySession.set(ses, ext);

    // session.extensions 加载/卸载事件 → 同步 UI 状态
    ses.on && ses.on('extension-loaded', (_e, extObj) => {
      console.log(`✓ extension-loaded: ${extObj.name} (${extObj.id})`);
      const dirName = path.basename(extObj.path || '');
      if (dirName) extStatus.set(`${profileId}|${dirName}`, { state: 'loaded', id: extObj.id });
    });
    ses.on && ses.on('extension-unloaded', (_e, extObj) => {
      console.log(`× extension-unloaded: ${extObj.name} (${extObj.id})`);
    });
  }

  // 2) Chrome 商店原生支持 — chromewebstore.google.com 上的"添加至 Chrome"按钮直接可用
  if (!webStoreInstalled.has(ses)) {
    webStoreInstalled.add(ses);
    try {
      await installChromeWebStore({
        session: ses,
        extensionsPath: extDir,
        autoUpdate: true,
        loadExtensions: true,
        allowUnpackedExtensions: true,
        beforeInstall: async (details) => {
          console.log(`商店安装请求: ${details.localizedName} (${details.id})`);
          return { action: 'allow' };
        },
      });
      console.log(`✓ chrome web store 已挂到 session (profile=${profileId}, dir=${extDir})`);
    } catch (err) {
      console.error(`✗ installChromeWebStore 失败:`, err);
    }
  }
}

// 把窗口的 webview webContents 注册成扩展系统认识的 "tab"
function registerWebviewAsTab(ses, webviewWebContents, browserWindow) {
  const ext = extensionsBySession.get(ses);
  if (!ext) return;
  try {
    ext.addTab(webviewWebContents, browserWindow);
  } catch (e) {
    console.error('addTab 失败:', e.message);
  }
}

function sessionForProfile(profile, { incognito = false } = {}) {
  const partition = incognito
    ? `meowser-incognito-${profile.id}-${Date.now()}`         // 无 persist: 前缀 → 内存
    : `persist:meowser-${profile.id}`;
  const ses = session.fromPartition(partition);

  const px = profile.proxy || { type: 'direct' };
  if (px.type === 'http' || px.type === 'https') {
    ses.setProxy({ proxyRules: `http=${px.host}:${px.port};https=${px.host}:${px.port}` });
  } else if (px.type === 'socks5') {
    ses.setProxy({ proxyRules: `socks5://${px.host}:${px.port}` });
  } else if (px.type === 'system') {
    ses.setProxy({ mode: 'system' });
  } else {
    ses.setProxy({ mode: 'direct' });
  }

  if (!incognito && !extLoaded.has(profile.id)) {
    extLoaded.add(profile.id);
    // 异步：扩展运行时 + Chrome 商店挂载（不阻塞窗口创建）
    setupExtensionRuntime(profile.id, ses).catch(err => console.error('setupExtensionRuntime', err));
  }
  return ses;
}

// ─── 启动器 ───
let launcherWindow = null;
function createLauncher() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.show(); launcherWindow.focus(); return;
  }
  const display = screen.getPrimaryDisplay();
  const w = 720, h = 580;
  launcherWindow = new BrowserWindow({
    width: w, height: h,
    x: Math.round(display.workArea.x + (display.workArea.width - w) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - h) / 2),
    show: false, backgroundColor: '#161618',
    titleBarStyle: 'hiddenInset', title: 'Meowser',
    vibrancy: 'under-window', visualEffectState: 'active',
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  launcherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  launcherWindow.loadFile(path.join(__dirname, 'launcher.html'));
  launcherWindow.once('ready-to-show', () => {
    launcherWindow.show(); launcherWindow.focus();
    setTimeout(() => {
      if (launcherWindow && !launcherWindow.isDestroyed())
        launcherWindow.setAlwaysOnTop(false);
    }, 1500);
  });
  launcherWindow.on('closed', () => { launcherWindow = null; });
}

// ─── 书签管理窗 ───
let bmManagerWindow = null;
function openBookmarkManager(profileId) {
  if (bmManagerWindow && !bmManagerWindow.isDestroyed()) {
    bmManagerWindow.focus();
    if (profileId) bmManagerWindow.webContents.send('bm:switchProfile', profileId);
    return;
  }
  bmManagerWindow = new BrowserWindow({
    width: 920, height: 580, show: false,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    title: '书签管理',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  bmManagerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const q = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
  bmManagerWindow.loadURL(`file://${path.join(__dirname, 'bookmark_manager.html')}${q}`);
  bmManagerWindow.once('ready-to-show', () => bmManagerWindow.show());
  bmManagerWindow.on('closed', () => { bmManagerWindow = null; });
}

// ─── 编辑窗 ───
let editWindow = null;
function openEditWindow(profileOrNull) {
  if (editWindow && !editWindow.isDestroyed()) { editWindow.focus(); return; }
  editWindow = new BrowserWindow({
    width: 480, height: 580, show: false,
    backgroundColor: '#161618', titleBarStyle: 'hiddenInset',
    title: profileOrNull ? '编辑工作区' : '新建工作区',
    vibrancy: 'under-window',
    parent: (launcherWindow && launcherWindow.isVisible()) ? launcherWindow : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  editWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const q = encodeURIComponent(JSON.stringify(profileOrNull || {}));
  editWindow.loadURL(`file://${path.join(__dirname, 'edit.html')}?profile=${q}`);
  editWindow.once('ready-to-show', () => editWindow.show());
  editWindow.on('closed', () => { editWindow = null; });
}

// ─── 浏览器窗 ───
const SMALL_W = 320, SMALL_H = 240;
const LARGE_W = 1200, LARGE_H = 800;

function createBrowserWindow(profile, opts = {}) {
  const display = screen.getPrimaryDisplay();
  const isSmall = !!opts.small;
  const incognito = !!opts.incognito;
  const w = isSmall ? SMALL_W : LARGE_W;
  const h = isSmall ? SMALL_H : LARGE_H;

  const win = new BrowserWindow({
    width: w, height: h,
    x: display.workArea.x + display.workArea.width - w - 20,
    y: display.workArea.y + 20,
    show: false, frame: true, titleBarStyle: 'hiddenInset',
    title: `${profile.emoji} ${profile.name}${incognito ? ' · 无痕' : ''}`,
    backgroundColor: '#ffffff', alwaysOnTop: true,
    webPreferences: {
      session: sessionForProfile(profile, { incognito }),
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true,
    },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const initialUrl = opts.url || homeUrlFor(profile);
  const params = new URLSearchParams({
    profile: JSON.stringify(profile),
    initialUrl, small: isSmall ? '1' : '0',
    incognito: incognito ? '1' : '0',
  });
  win.loadURL(`file://${path.join(__dirname, 'chrome.html')}?${params.toString()}`);
  win.once('ready-to-show', () => { win.show(); win.focus(); });

  win.profile = profile;
  win.__incognito = incognito;
  win.on('blur', () => {
    if (win.isDestroyed() || !win.__autoShrink) return;
    const [cw] = win.getSize();
    if (cw > SMALL_W + 20) {
      win.setSize(SMALL_W, SMALL_H, true);
      win.webContents.send('window:resized', { w: SMALL_W, h: SMALL_H, small: true });
    }
  });
  return win;
}

// ─── Tray ───
let tray = null;
function buildTrayMenu() {
  const profiles = loadProfiles();
  const items = profiles.map(p => ({
    label: `${p.emoji}  ${p.name}`,
    submenu: [
      { label: '正常打开', click: () => createBrowserWindow(p, {}) },
      { label: '🕶 无痕打开', click: () => createBrowserWindow(p, { incognito: true }) },
      { label: '小窗打开', click: () => createBrowserWindow(p, { small: true }) },
    ],
  }));
  return Menu.buildFromTemplate([
    { label: `Meowser  v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    ...items,
    { type: 'separator' },
    { label: '🕶 临时无痕窗口', click: () => {
      const p = loadProfiles()[0];
      if (p) createBrowserWindow(p, { incognito: true });
    }},
    { type: 'separator' },
    { label: '启动器…', accelerator: 'Cmd+Alt+L', click: () => createLauncher() },
    { label: '显示/隐藏所有窗口', accelerator: 'Alt+`', click: toggleAllWindows },
    { type: 'separator' },
    { label: '退出 Meowser', role: 'quit' },
  ]);
}
function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🐱');
  tray.setToolTip('Meowser');
  tray.setContextMenu(buildTrayMenu());
}
function refreshTray() { if (tray) tray.setContextMenu(buildTrayMenu()); }

function toggleAllWindows() {
  const all = BrowserWindow.getAllWindows().filter(w => w.profile);
  if (all.length === 0) { createLauncher(); return; }
  const anyVisible = all.some(w => w.isVisible());
  all.forEach(w => anyVisible ? w.hide() : w.show());
}

function arrangeWindows(edge, style) {
  const wins = BrowserWindow.getAllWindows().filter(w => w.profile && w.isVisible());
  if (wins.length === 0) return;
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const gap = 8;
  if (style === 'cascade') {
    let cx = x + 40, cy = y + 40;
    wins.forEach((w, i) => w.setBounds({ x: cx + i * 32, y: cy + i * 32, width: SMALL_W, height: SMALL_H }, true));
    return;
  }
  const horiz = edge === 'top' || edge === 'bottom';
  const n = wins.length;
  if (horiz) {
    const wEach = Math.floor((width - gap * (n + 1)) / n);
    const yPos = edge === 'top' ? y + gap : y + height - SMALL_H - gap;
    wins.forEach((w, i) => w.setBounds({ x: x + gap + i * (wEach + gap), y: yPos, width: wEach, height: SMALL_H }, true));
  } else {
    const hEach = Math.floor((height - gap * (n + 1)) / n);
    const xPos = edge === 'left' ? x + gap : x + width - SMALL_W - gap;
    wins.forEach((w, i) => w.setBounds({ x: xPos, y: y + gap + i * (hEach + gap), width: SMALL_W, height: hEach }, true));
  }
}

// ─── IPC ───
ipcMain.handle('profiles:list', () => loadProfiles());
ipcMain.handle('profiles:save', (e, profiles) => { saveProfiles(profiles); refreshTray(); return true; });
ipcMain.handle('profiles:upsert', (e, profile) => {
  const ps = loadProfiles();
  const i = ps.findIndex(p => p.id === profile.id);
  if (i >= 0) ps[i] = profile; else ps.push(profile);
  saveProfiles(ps);
  refreshTray();
  if (launcherWindow && !launcherWindow.isDestroyed())
    launcherWindow.webContents.send('profiles:changed');
  return true;
});
ipcMain.handle('profiles:delete', (e, id) => {
  saveProfiles(loadProfiles().filter(p => p.id !== id));
  refreshTray();
  if (launcherWindow && !launcherWindow.isDestroyed())
    launcherWindow.webContents.send('profiles:changed');
  return true;
});

ipcMain.handle('launch', (e, profile, opts) => {
  createBrowserWindow(profile, opts || {});
  if (launcherWindow) launcherWindow.hide();
});

ipcMain.handle('edit:open', (e, profile) => openEditWindow(profile || null));
ipcMain.handle('bm:openManager', (e, profileId) => openBookmarkManager(profileId));
ipcMain.handle('edit:close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });

// ─── 书签 IPC ───
ipcMain.handle('bm:list', (e, profileId) => bm.load(profileId));
ipcMain.handle('bm:add', (e, profileId, item) => {
  const list = bm.add(profileId, item);
  broadcastBmChange(profileId);
  return list;
});
ipcMain.handle('bm:remove', (e, profileId, url) => {
  const list = bm.remove(profileId, url);
  broadcastBmChange(profileId);
  return list;
});
ipcMain.handle('bm:reorder', (e, profileId, urls) => bm.reorder(profileId, urls));
ipcMain.handle('bm:importChrome', (e, profileId) => {
  const r = bm.importFromChrome(profileId);
  broadcastBmChange(profileId);
  return r;
});
ipcMain.handle('bm:exportHtml', async (e, profileId) => {
  const r = await dialog.showSaveDialog({
    title: '导出书签 HTML',
    defaultPath: path.join(os.homedir(), `Meowser_bookmarks_${profileId}.html`),
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, bm.exportHtml(profileId), 'utf8');
  return r.filePath;
});
ipcMain.handle('bm:importHtml', async (e, profileId) => {
  const r = await dialog.showOpenDialog({
    title: '选 HTML 书签文件',
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
    properties: ['openFile'],
  });
  if (r.canceled || r.filePaths.length === 0) return 0;
  const html = fs.readFileSync(r.filePaths[0], 'utf8');
  const n = bm.importHtml(profileId, html);
  broadcastBmChange(profileId);
  return n;
});
function broadcastBmChange(profileId) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('bm:changed', profileId);
  });
}

// ─── 扩展安装 ───
async function pickProfileId() {
  const profiles = loadProfiles();
  if (profiles.length === 0) return null;
  if (profiles.length === 1) return profiles[0].id;
  const pick = await dialog.showMessageBox({
    type: 'question', title: '装到哪个工作区？',
    buttons: [...profiles.map(p => `${p.emoji} ${p.name}`), '取消'],
    cancelId: profiles.length, defaultId: 0,
  });
  if (pick.response >= profiles.length) return null;
  return profiles[pick.response].id;
}
ipcMain.handle('extension:installLocal', async (e, profileIdOpt) => {
  const profileId = profileIdOpt || await pickProfileId();
  if (!profileId) return null;
  const r = await dialog.showOpenDialog({ title: '选 unpacked extension 目录', properties: ['openDirectory'] });
  if (r.canceled || r.filePaths.length === 0) return null;
  const src = r.filePaths[0];
  const dst = path.join(DATA_DIR, 'extensions', profileId, path.basename(src));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  // 立即加载到当前 session（不再需要重开窗口）
  const ses = session.fromPartition(`persist:meowser-${profileId}`);
  try {
    const ext = await ses.loadExtension(dst, { allowFileAccess: true });
    console.log(`✓ 本地扩展加载成功: ${path.basename(dst)} (${ext.id})`);
    return { profileId, dst, ok: true, id: ext.id };
  } catch (err) {
    console.error(`✗ 本地扩展加载失败: ${err.message}`);
    return { profileId, dst, ok: false, msg: err.message };
  }
});

ipcMain.handle('ui:askText', async (e, { title, label, placeholder }) => {
  return new Promise(resolve => {
    const win = new BrowserWindow({
      width: 480, height: 180, show: false,
      backgroundColor: '#161618', titleBarStyle: 'hiddenInset',
      title: title || '输入', vibrancy: 'under-window',
      webPreferences: { contextIsolation: false, nodeIntegration: true },
    });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;padding:36px 18px 18px;background:#161618;color:#ededed;font-family:-apple-system,sans-serif;-webkit-app-region:drag;-webkit-user-select:none}
      label{display:block;font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;font-family:ui-monospace,monospace}
      input{width:100%;height:34px;padding:0 12px;background:rgba(255,255,255,0.06);color:#ededed;border:0.5px solid rgba(255,255,255,0.10);border-radius:6px;outline:none;-webkit-app-region:no-drag;font-size:13px}
      input:focus{border-color:#4ade80}
      .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;-webkit-app-region:no-drag}
      button{height:30px;padding:0 14px;font-size:12px;background:rgba(255,255,255,0.06);color:#ededed;border:0.5px solid rgba(255,255,255,0.10);border-radius:6px;cursor:pointer;font-family:ui-monospace,monospace}
      button.primary{background:#4ade80;color:#0e0e10;border-color:#4ade80}
    </style>
    <label>${(label||'输入').replace(/[<>&]/g,'')}</label>
    <input id="x" placeholder="${(placeholder||'').replace(/[<>&"]/g,'')}" autofocus>
    <div class="row"><button id="c">取消</button><button class="primary" id="o">确定</button></div>
    <script>
      const { ipcRenderer } = require('electron');
      const i = document.getElementById('x');
      const send = v => ipcRenderer.send('done', v);
      document.getElementById('c').onclick = () => send(null);
      document.getElementById('o').onclick = () => send(i.value);
      i.addEventListener('keydown', e => { if (e.key==='Enter') send(i.value); if (e.key==='Escape') send(null); });
    </script>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.once('ready-to-show', () => win.show());
    let done = false;
    const finish = (v) => {
      if (done) return; done = true;
      resolve(v);
      if (!win.isDestroyed()) win.close();
    };
    // 直接监听 webContents 的 ipc-message（sendToHost 在嵌入环境用，独立窗用 console-message + executeJs 不太合适；改回普通 ipc + 用 sender 比对）
    win.webContents.on('ipc-message', (_e, ch, v) => { if (ch === 'done') finish(v); });
    win.on('closed', () => finish(null));
  });
});

ipcMain.handle('extension:list', (e, profileId) => {
  const dir = path.join(DATA_DIR, 'extensions', profileId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(n => { try { return fs.statSync(path.join(dir, n)).isDirectory(); } catch { return false; } })
    .map(name => {
      const p = path.join(dir, name);
      const meta = readManifest(p);
      const status = extStatus.get(`${profileId}|${name}`) || { state: 'pending' };
      return {
        dir: name,
        name: meta.name,
        version: meta.version,
        description: meta.description,
        manifestVersion: meta.manifestVersion,
        state: status.state,             // pending | loading | loaded | failed
        error: status.error || '',
        id: status.id || '',
      };
    });
});
ipcMain.handle('extension:reload', async (e, profileId) => {
  const ses = session.fromPartition(`persist:meowser-${profileId}`);
  // 把已加载的全部卸掉，然后从扩展目录重新加载
  const loaded = ses.extensions ? ses.extensions.getAllExtensions() : ses.getAllExtensions();
  loaded.forEach(ext => {
    try {
      if (ses.extensions && ses.extensions.removeExtension) ses.extensions.removeExtension(ext.id);
      else ses.removeExtension(ext.id);
    } catch (err) { console.error('removeExtension', err.message); }
  });
  for (const k of Array.from(extStatus.keys())) {
    if (k.startsWith(profileId + '|')) extStatus.delete(k);
  }
  // 重新扫扩展目录加载
  const extDir = path.join(DATA_DIR, 'extensions', profileId);
  if (fs.existsSync(extDir)) {
    for (const name of fs.readdirSync(extDir)) {
      const p = path.join(extDir, name);
      try { if (!fs.statSync(p).isDirectory()) continue; } catch { continue; }
      const meta = readManifest(p);
      try {
        const ext = await ses.loadExtension(p, { allowFileAccess: true });
        extStatus.set(`${profileId}|${name}`, { state: 'loaded', id: ext.id, manifestVersion: meta.manifestVersion });
        console.log(`✓ reload: ${name} (${ext.id})`);
      } catch (err) {
        extStatus.set(`${profileId}|${name}`, { state: 'failed', error: err.message, manifestVersion: meta.manifestVersion });
        console.error(`✗ reload 失败: ${name} — ${err.message}`);
      }
    }
  }
  return true;
});
ipcMain.handle('extension:remove', (e, profileId, dirName) => {
  const p = path.join(DATA_DIR, 'extensions', profileId, dirName);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  extLoaded.delete(profileId);
  return true;
});
ipcMain.handle('extension:openDir', (e, profileId) => {
  const dir = path.join(DATA_DIR, 'extensions', profileId);
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

// ─── 日志 ───
ipcMain.handle('log:openFile', () => shell.openPath(logger.currentLogFile()));
ipcMain.handle('log:openDir',  () => shell.openPath(logger.LOG_DIR));
ipcMain.handle('log:path',     () => logger.currentLogFile());
ipcMain.handle('window:openInNewWindow', (e, url) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !win.profile) return;
  createBrowserWindow(win.profile, { url, incognito: !!win.__incognito });
});

ipcMain.handle('extension:installFromStore', async (e, urlOrId, profileIdOpt) => {
  const profileId = profileIdOpt || await pickProfileId();
  if (!profileId) return { ok: false, msg: '取消' };
  const targetDir = path.join(DATA_DIR, 'extensions', profileId);
  fs.mkdirSync(targetDir, { recursive: true });
  // 提取 32 位扩展 ID
  const m = String(urlOrId || '').match(/[a-p]{32}/);
  if (!m) return { ok: false, msg: '提取不到扩展 ID' };
  const extId = m[0];
  const ses = session.fromPartition(`persist:meowser-${profileId}`);
  try {
    // 用 electron-chrome-web-store 装（自动加载 + 后续自动更新）
    const ext = await installExtension(extId, {
      session: ses,
      extensionsPath: targetDir,
      loadExtensionOptions: { allowFileAccess: true },
    });
    console.log(`✓ 商店扩展安装成功: ${ext.name} (${ext.id})`);
    return { ok: true, profileId, id: ext.id, name: ext.name };
  } catch (err) {
    console.error(`✗ 商店扩展安装失败 (${extId}):`, err.message);
    // 回退到老的手卷 crx 流程，至少能解压保留文件
    try {
      const r = await crx.installFromStore(urlOrId, targetDir);
      console.log(`↪ 回退手卷安装成功（未自动加载）`);
      return { ok: true, profileId, ...r, msg: 'electron-chrome-web-store 失败，已用 crx.js 回退' };
    } catch (e2) {
      return { ok: false, msg: `${err.message}（回退也失败: ${e2.message}）` };
    }
  }
});

ipcMain.handle('extension:registerWebviewTab', (e) => {
  // 渲染进程 webview did-attach 后调用，让扩展运行时把这个 webContents 当成"tab"
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !win.profile) return false;
  const ses = session.fromPartition(win.__incognito
    ? `meowser-incognito-${win.profile.id}`
    : `persist:meowser-${win.profile.id}`);
  // sender 是 host webContents（chrome.html 的渲染进程）；我们要的是 webview 的 webContents
  // webview 子 webContents 的 hostWebContents 等于 sender
  const allWcs = require('electron').webContents.getAllWebContents();
  const webviewWc = allWcs.find(wc => wc.hostWebContents && wc.hostWebContents.id === e.sender.id);
  if (!webviewWc) return false;
  registerWebviewAsTab(ses, webviewWc, win);
  return true;
});

// ─── 配置导出/导入 ───
ipcMain.handle('migrate:export', async (e) => {
  const r = await dialog.showSaveDialog({
    title: '导出 Meowser 配置 zip',
    defaultPath: path.join(os.homedir(), `Meowser_backup_${Date.now()}.zip`),
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  });
  if (r.canceled || !r.filePath) return null;
  try { return await migrate.exportToZip(r.filePath); }
  catch (err) { return { error: err.message }; }
});
ipcMain.handle('migrate:import', async (e) => {
  const r = await dialog.showOpenDialog({
    title: '选 Meowser 配置 zip',
    filters: [{ name: 'Zip', extensions: ['zip'] }],
    properties: ['openFile'],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  const overwrite = await dialog.showMessageBox({
    type: 'question', title: '冲突处理',
    message: '同名文件已存在时？',
    buttons: ['覆盖', '保留现有', '取消'],
    cancelId: 2, defaultId: 1,
  });
  if (overwrite.response === 2) return null;
  try {
    await migrate.importFromZip(r.filePaths[0], { overwrite: overwrite.response === 0 });
    refreshTray();
    if (launcherWindow && !launcherWindow.isDestroyed())
      launcherWindow.webContents.send('profiles:changed');
    return { ok: true };
  } catch (err) { return { error: err.message }; }
});

// ─── 窗口控制 ───
ipcMain.handle('window:resize', (e, { w, h }) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (win) win.setSize(w, h, true);
});
ipcMain.handle('window:toggleSize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (!win) return false;
  const [cw] = win.getSize(); const small = cw > SMALL_W + 20;
  win.setSize(small ? SMALL_W : LARGE_W, small ? SMALL_H : LARGE_H, true);
  return small;
});
ipcMain.handle('window:setOpacity', (e, alpha) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (win) win.setOpacity(alpha);
});
ipcMain.handle('window:toggleAlwaysOnTop', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (!win) return false;
  const cur = win.isAlwaysOnTop(); win.setAlwaysOnTop(!cur); return !cur;
});
ipcMain.handle('window:setAutoShrink', (e, v) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (win) win.__autoShrink = !!v;
  return !!v;
});
ipcMain.handle('window:openExternal', (e, url, app) => {
  if (!url) return;
  if (app === 'chrome') require('child_process').exec(`open -a "Google Chrome" ${JSON.stringify(url)}`);
  else if (app === 'safari') require('child_process').exec(`open -a Safari ${JSON.stringify(url)}`);
  else shell.openExternal(url);
});
ipcMain.handle('window:relaunchIncognito', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !win.profile) return;
  const p = win.profile;
  win.close();
  setTimeout(() => createBrowserWindow(p, { incognito: true }), 50);
});

ipcMain.handle('layout:arrange', (e, edge, style) => arrangeWindows(edge, style));
ipcMain.handle('home:url', (e, profile) => homeUrlFor(profile));
ipcMain.handle('app:version', () => app.getVersion());

// ─── 内存监控（每 5 秒推一次给所有浏览器窗）───
async function pushMemoryToWindows() {
  let metrics;
  try { metrics = await app.getAppMetrics(); } catch { return; }
  // pid → memory.workingSetSize (KB)
  const byPid = new Map(metrics.map(m => [m.pid, m]));
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.isDestroyed() || !win.profile) return;
    let total = 0;
    let webviewCount = 0;
    try {
      const mainPid = win.webContents.getOSProcessId();
      const main = byPid.get(mainPid);
      if (main) total += main.memory.workingSetSize;
      // webview 子进程：webContents 列表里 type='webview' 且 hostWebContents 是当前窗
      require('electron').webContents.getAllWebContents().forEach(wc => {
        if (wc.hostWebContents && wc.hostWebContents.id === win.webContents.id) {
          const pid = wc.getOSProcessId();
          const m = byPid.get(pid);
          if (m) { total += m.memory.workingSetSize; webviewCount++; }
        }
      });
      win.webContents.send('mem:update', { kb: total, webviews: webviewCount });
    } catch {}
  });
}
setInterval(pushMemoryToWindows, 5000);
ipcMain.handle('clipboard:writeText', (e, text) => {
  require('electron').clipboard.writeText(String(text || ''));
});

// macOS 必须装一个含 Edit role 的应用菜单，⌘C/⌘V/⌘X/⌘A 才会被路由到聚焦的网页内容。
// 不调 setApplicationMenu 时 Electron 给的默认菜单**不含** Edit role —— 这就是为啥之前 ⌘C/⌘V 全失效。
function installAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '启动器…', accelerator: 'Cmd+Alt+L', click: () => createLauncher() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo',       label: '撤销' },
        { role: 'redo',       label: '重做' },
        { type: 'separator' },
        { role: 'cut',        label: '剪切' },
        { role: 'copy',       label: '复制' },
        { role: 'paste',      label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete',     label: '删除' },
        { role: 'selectAll',  label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload',           label: '刷新',     accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload',      label: '强制刷新', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools',   label: '开发者工具', accelerator: 'CmdOrCtrl+Alt+I' },
        { type: 'separator' },
        { role: 'resetZoom',        label: '实际大小' },
        { role: 'zoomIn',           label: '放大' },
        { role: 'zoomOut',          label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      role: 'windowMenu',
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  installAppMenu();          // ← 必须在 createLauncher 之前
  createLauncher();
  createTray();
  globalShortcut.register('Alt+`', toggleAllWindows);
  globalShortcut.register('CommandOrControl+Alt+L', () => createLauncher());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

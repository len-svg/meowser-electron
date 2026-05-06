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

function loadExtensionsForSession(profileId, ses) {
  const extDir = path.join(DATA_DIR, 'extensions', profileId);
  if (!fs.existsSync(extDir)) return;
  fs.readdirSync(extDir).forEach(name => {
    const p = path.join(extDir, name);
    let isDir = false;
    try { isDir = fs.statSync(p).isDirectory(); } catch {}
    if (!isDir) return;
    const key = `${profileId}|${name}`;
    const meta = readManifest(p);
    extStatus.set(key, { state: 'loading', manifestVersion: meta.manifestVersion });
    if (meta.parseError) {
      extStatus.set(key, { state: 'failed', error: `manifest.json 解析失败: ${meta.parseError}`, manifestVersion: 0 });
      console.error(`✗ 扩展 ${name}: manifest.json 解析失败 — ${meta.parseError}`);
      return;
    }
    console.log(`→ 加载扩展 ${name} (MV${meta.manifestVersion}, "${meta.name}" v${meta.version})`);
    ses.loadExtension(p, { allowFileAccess: true })
      .then(ext => {
        extStatus.set(key, { state: 'loaded', id: ext.id, manifestVersion: meta.manifestVersion });
        console.log(`✓ 扩展加载成功: ${name} (id=${ext.id})`);
      })
      .catch(err => {
        const msg = err && err.message ? err.message : String(err);
        extStatus.set(key, { state: 'failed', error: msg, stack: err && err.stack, manifestVersion: meta.manifestVersion });
        console.error(`✗ 扩展加载失败: ${name} (MV${meta.manifestVersion}) — ${msg}`);
      });
  });
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
    loadExtensionsForSession(profile.id, ses);
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
  extLoaded.delete(profileId);
  return { profileId, dst };
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
ipcMain.handle('extension:reload', (e, profileId) => {
  // 强制下次 sessionForProfile 时重新 load
  extLoaded.delete(profileId);
  // 立即对当前 session 触发一次（如果存在）
  const ses = session.fromPartition(`persist:meowser-${profileId}`);
  // 先把已加载的卸掉
  ses.getAllExtensions().forEach(ext => {
    try { ses.removeExtension(ext.id); } catch (err) { console.error('removeExtension', err.message); }
  });
  // 清掉旧状态
  for (const k of Array.from(extStatus.keys())) {
    if (k.startsWith(profileId + '|')) extStatus.delete(k);
  }
  loadExtensionsForSession(profileId, ses);
  extLoaded.add(profileId);
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
  try {
    const r = await crx.installFromStore(urlOrId, targetDir);
    extLoaded.delete(profileId);
    return { ok: true, profileId, ...r };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
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

app.whenReady().then(() => {
  createLauncher();
  createTray();
  globalShortcut.register('Alt+`', toggleAllWindows);
  globalShortcut.register('CommandOrControl+Alt+L', () => createLauncher());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

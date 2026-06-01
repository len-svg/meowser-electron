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
const profilePrefs = require('./profile_prefs');
const historyStore = require('./history_store');
const sessionStore = require('./session_store');
const updater = require('./updater');

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
  // 最近访问取最后 8 条（倒序），传给首页渲染
  const recent = historyStore.load(profile.id).slice(-8).reverse();
  fs.writeFileSync(fp, renderWorkHome(profile, bm.load(profile.id), recent), 'utf8');
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

// 把 Electron / Meowser 字样从 UA 抹掉，伪装成 Chromium 同版本的桌面 Chrome
// 必须早于第一次发起请求；放在 sessionForProfile 入口处调用足够
function applyChromeUA(ses) {
  const chromiumVer = (process.versions.chrome || '130.0.0.0');
  const platformUA = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64';
  const ua = `Mozilla/5.0 (${platformUA}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumVer} Safari/537.36`;
  ses.setUserAgent(ua);
  return ua;
}

function sessionForProfile(profile, { incognito = false } = {}) {
  const partition = incognito
    ? `meowser-incognito-${profile.id}-${Date.now()}`         // 无 persist: 前缀 → 内存
    : `persist:meowser-${profile.id}`;
  const ses = session.fromPartition(partition);

  // ─── User Agent 伪装成原生 Chrome ───
  // Google 登录、银行、WebAuthn 等敏感流程会嗅探 UA，看到 "Electron/Meowser" 直接拒绝
  // FIDO2 安全密钥 (YubiKey) 在 Electron 版本里 Google 报"出现问题"就是 UA 检测拦截
  // 同 partition 反复 setUserAgent 是幂等的
  applyChromeUA(ses);

  // ─── 权限请求：默认放行（独立浏览器对自己的权限请求语义就是接受）───
  // 不装 handler 的话很多 permission 默认拒绝，影响 webauthn / clipboard / notification 等
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(true);
  });

  // ─── 同步权限检查：Chromium 内部很多操作走这条而非 Request；最关键是 clipboard-* ───
  // 没装 check handler 的话默认 deny → webview 内 input 的 ⌘C/⌘V 全失效（实测确认）
  ses.setPermissionCheckHandler(() => true);

  // ─── 设备访问授权：HID (FIDO2 安全密钥走这条) / USB / Serial ───
  // YubiKey 通过 USB-HID 用 CTAP2 协议跟浏览器通信，必须显式同意
  ses.setDevicePermissionHandler(() => true);

  // ─── HID 设备选择回调：WebAuthn 触发选择安全密钥时 ───
  // 默认无 listener → Chromium 等用户选 → 永远不会被选 → fallback "出现问题"
  // 单 token 场景直接选第一个；多 token 也选第一个（不展示选择 UI 满足 demand pattern）
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    if (details.deviceList && details.deviceList.length > 0) {
      callback(details.deviceList[0].deviceId);
    } else {
      callback(null);
    }
  });
  // 同上对 USB 设备（少数 FIDO key 走 WebUSB 而非 WebHID）
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    if (details.deviceList && details.deviceList.length > 0) {
      callback(details.deviceList[0].deviceId);
    } else {
      callback(null);
    }
  });

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

// ─── 历史管理窗 ───
let historyManagerWindow = null;
function openHistoryManager(profileId) {
  if (historyManagerWindow && !historyManagerWindow.isDestroyed()) {
    historyManagerWindow.focus();
    return;
  }
  historyManagerWindow = new BrowserWindow({
    width: 920, height: 600, show: false,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    title: '访问历史',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  historyManagerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const q = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
  historyManagerWindow.loadURL(`file://${path.join(__dirname, 'history_manager.html')}${q}`);
  historyManagerWindow.once('ready-to-show', () => historyManagerWindow.show());
  historyManagerWindow.on('closed', () => { historyManagerWindow = null; });
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
// 大窗：标准浏览体验 / 小窗：minibar 用，浮在屏幕角落只看一眼
// 比例不等 = 故意的（小窗 4:3 更窄更适合悬浮）
const LARGE_W = 1200, LARGE_H = 800;
const SMALL_W = 360,  SMALL_H = 240;

function createBrowserWindow(profile, opts = {}) {
  const display = screen.getPrimaryDisplay();
  const isSmall = !!opts.small;
  const incognito = !!opts.incognito;
  const w = isSmall ? SMALL_W : LARGE_W;
  const h = isSmall ? SMALL_H : LARGE_H;

  // 读取该 profile 的持久偏好（无痕窗不读，永远默认）
  const prefs = incognito ? profilePrefs.DEFAULTS : profilePrefs.load(profile.id);

  const win = new BrowserWindow({
    width: w, height: h,
    x: display.workArea.x + display.workArea.width - w - 20,
    y: display.workArea.y + 20,
    show: false, frame: true, titleBarStyle: 'hiddenInset',
    title: `${profile.emoji} ${profile.name}${incognito ? ' · 无痕' : ''}`,
    backgroundColor: '#ffffff',
    alwaysOnTop: prefs.always_on_top !== false,   // 默认 true
    opacity: (typeof prefs.opacity === 'number' ? prefs.opacity : 100) / 100,
    webPreferences: {
      session: sessionForProfile(profile, { incognito }),
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true,
    },
  });
  win.__autoShrink = !incognito && !!prefs.auto_shrink;
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
    // 大头针置顶时 = 用户明确要求窗口固定，不缩
    if (win.isAlwaysOnTop()) return;
    const [cw] = win.getSize();
    if (cw > SMALL_W + 20) {
      win.setSize(SMALL_W, SMALL_H, true);
      win.webContents.send('window:resized', { w: SMALL_W, h: SMALL_H, small: true });
    }
  });

  registerBrowserWindow(win, { profile, incognito, isSmall });
  return win;
}

// ─── 窗口注册表 (v0.5.0 批量窗口管理用) ───
// key = BrowserWindow.id, value = WindowMeta
const windowRegistry = new Map();

function nowUTC() { return new Date().toISOString(); }

function registerBrowserWindow(win, { profile, incognito, isSmall }) {
  const meta = {
    window_id: win.id,
    profile_id: profile.id,
    profile_emoji: profile.emoji,
    profile_name: profile.name,
    profile_theme: profile.theme || 'yellow',
    is_incognito: !!incognito,
    is_small: !!isSmall,
    always_on_top: win.isAlwaysOnTop(),
    title: win.getTitle(),
    url: '',
    opened_at: nowUTC(),
    last_focused_at: null,
    memory_kb: 0,
    webview_count: 0,
  };
  windowRegistry.set(win.id, meta);

  // 标题/URL 跟随 chrome.html webview，需要在主进程 fish 出 webview 的 webContents
  // —— chrome.html 的 host webContents 自己也会发 page-title-updated（来自 .profile-strip），
  //    用 webContents.getAllWebContents 找 hostWebContents === win.webContents 的子项
  function syncFromWebview() {
    if (win.isDestroyed()) return;
    require('electron').webContents.getAllWebContents().forEach(wc => {
      if (wc.hostWebContents && wc.hostWebContents.id === win.webContents.id) {
        try {
          meta.url = wc.getURL() || '';
          meta.title = wc.getTitle() || meta.title;
        } catch {}
      }
    });
    broadcastWindowsChanged();
  }

  win.on('focus', () => {
    meta.last_focused_at = nowUTC();
    broadcastWindowsChanged();
  });
  win.on('always-on-top-changed', () => {
    meta.always_on_top = win.isAlwaysOnTop();
    broadcastWindowsChanged();
  });
  win.on('resize', () => {
    const [cw] = win.getSize();
    meta.is_small = cw <= SMALL_W + 20;
  });
  win.on('page-title-updated', (_e, title) => {
    meta.title = title || meta.title;
    broadcastWindowsChanged();
  });
  // 'close' (准备关闭，元数据还在) → 保存该 profile 的会话快照
  win.on('close', () => {
    if (meta.is_incognito) return;  // 无痕窗不保存
    try {
      const survivors = [...windowRegistry.values()].filter(m =>
        m.profile_id === meta.profile_id && m.window_id !== meta.window_id
      );
      // 把当前正在关的也算 saved 状态（用户可能想恢复"曾经开着的"集合）
      // 但 fork 行为：一个一个关时不该 0 个 → 我们采用"幸存者 + 自己"
      const snapshot = [...survivors, meta];
      sessionStore.saveFromWindows(meta.profile_id, snapshot);
    } catch (e) { console.error('session save', e.message); }
  });
  win.on('closed', () => {
    windowRegistry.delete(win.id);
    broadcastWindowsChanged();
  });
  // webview attach 时挂事件
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.on('did-navigate',        (_, url) => { meta.url = url; broadcastWindowsChanged(); historyAddFromWebview(meta.profile_id, meta.is_incognito, url, wc.getTitle()); });
    wc.on('did-navigate-in-page',(_, url) => { meta.url = url; broadcastWindowsChanged(); historyAddFromWebview(meta.profile_id, meta.is_incognito, url, wc.getTitle()); });
    wc.on('page-title-updated',  (_, t)   => { meta.title = t || meta.title; broadcastWindowsChanged(); historyAddFromWebview(meta.profile_id, meta.is_incognito, wc.getURL(), t); });

    // ─── webview 内 ⌘C/⌘V/⌘X/⌘A/⌘Z 显式兜底 ───
    // Chromium 在 webview 子进程对 menu role 的路由有时不工作（实测网页内 input 复制粘贴死）。
    // 这里直接 listen before-input-event，在主进程对 webview wc 显式调 copy/paste 等。
    // 用 preventDefault 完全接管，避免 Chromium 也跑导致 paste 双发。
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (!(input.meta || input.control)) return;
      const k = (input.key || '').toLowerCase();
      if (input.shift && k === 'z') { wc.redo(); event.preventDefault(); return; }
      // ─── 缩放网页内容（⌘+ / ⌘- / ⌘0）───
      // View 菜单的 zoom role 缩放的是 chrome.html 外壳，不是网页；这里直接缩 webview
      if (k === '=' || k === '+') {  // ⌘+ (= 键，shift 时是 +)
        const z = wc.getZoomLevel(); wc.setZoomLevel(Math.min(z + 0.5, 5)); event.preventDefault(); return;
      }
      if (k === '-' || k === '_') {  // ⌘-
        const z = wc.getZoomLevel(); wc.setZoomLevel(Math.max(z - 0.5, -3)); event.preventDefault(); return;
      }
      if (k === '0') {               // ⌘0 重置
        wc.setZoomLevel(0); event.preventDefault(); return;
      }
      switch (k) {
        case 'c': wc.copy();      event.preventDefault(); break;
        case 'v': wc.paste();     event.preventDefault(); break;
        case 'x': wc.cut();       event.preventDefault(); break;
        case 'a': wc.selectAll(); event.preventDefault(); break;
        case 'z': wc.undo();      event.preventDefault(); break;
      }
    });
  });
  // 首次同步（webview 可能还没 ready，5s 后再来一次保险）
  setTimeout(syncFromWebview, 1500);
  setTimeout(syncFromWebview, 5000);
}

// 50ms debounce 防抖广播
let _broadcastTimer = null;
function broadcastWindowsChanged() {
  if (_broadcastTimer) return;
  _broadcastTimer = setTimeout(() => {
    _broadcastTimer = null;
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('windows:changed');
    });
  }, 50);
}

// 取一份当前所有工作区窗口的快照（不含 launcher/editor/bm-mgr/window-mgr 自身）
// 保存某个 BrowserWindow 对应 profile 的偏好
function saveProfilePref(win, key, value) {
  if (!win || !win.profile) return;
  try { profilePrefs.setOne(win.profile.id, key, value); } catch (e) { console.error('saveProfilePref', e.message); }
}

// 给 webview 加一条访问历史（过滤无痕和 internal:// urls）
function historyAddFromWebview(profileId, isIncognito, url, title) {
  if (isIncognito || !profileId || !url) return;
  try { historyStore.add(profileId, url, title); } catch (e) { console.error('history.add', e.message); }
}

function snapshotWindows() {
  const list = [];
  for (const meta of windowRegistry.values()) {
    const w = BrowserWindow.fromId(meta.window_id);
    if (!w || w.isDestroyed()) {
      windowRegistry.delete(meta.window_id);
      continue;
    }
    // 实时刷一遍 is_small / always_on_top（避免事件没追上）
    try {
      const [cw] = w.getSize();
      meta.is_small = cw <= SMALL_W + 20;
      meta.always_on_top = w.isAlwaysOnTop();
    } catch {}
    list.push({ ...meta, is_focused: w.isFocused() });
  }
  return list;
}

// 探测一个窗口的 webview 里是否有疑似未保存的输入
async function probeUnsavedInput(win) {
  return new Promise(resolve => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(false), 800);  // 超时按"无未保存"处理，避免卡住

    require('electron').webContents.getAllWebContents().forEach(wc => {
      if (wc.hostWebContents && wc.hostWebContents.id === win.webContents.id) {
        wc.executeJavaScript(`
          (() => {
            const list = document.querySelectorAll('input, textarea, [contenteditable]');
            for (const el of list) {
              const v = ((el.value || el.textContent || '') + '').trim();
              if (v.length > 5) return true;
            }
            return false;
          })()
        `).then(r => finish(!!r)).catch(() => finish(false));
      }
    });
  });
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
    { label: '🗂 窗口管理…', accelerator: 'Ctrl+Cmd+W', click: () => openWindowManager() },
    { label: '显示/隐藏所有窗口', accelerator: 'Alt+`', click: toggleAllWindows },
    { type: 'separator' },
    { label: '退出 Meowser', role: 'quit' },
  ]);
}
function createTray() {
  // 用 logo 而非 emoji；macOS menu bar 高度 ~22pt（retina 44px）
  // 用 brand/logo.png 缩到 22 高度，setTemplateImage 让系统按浅/深色自动反色
  const logoPath = path.join(__dirname, '..', 'build', 'brand', 'logo.png');
  let img;
  try {
    img = nativeImage.createFromPath(logoPath).resize({ height: 18 });
  } catch (e) {
    img = nativeImage.createEmpty();
  }
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  // 没拿到 logo 才 fallback emoji；正常 setTitle('') 避免压挤位置
  if (img.isEmpty()) tray.setTitle('🐱');
  else tray.setTitle('');
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
function showAllWindows() {
  const all = BrowserWindow.getAllWindows().filter(w => w.profile);
  if (all.length === 0) { createLauncher(); return; }
  all.forEach(w => w.show());
}
function hideAllWindows() {
  BrowserWindow.getAllWindows().filter(w => w.profile).forEach(w => w.hide());
}

// 在所有工作区窗口之间循环聚焦（dir = +1 下一个 / -1 上一个）
function cycleWindows(dir) {
  const wins = BrowserWindow.getAllWindows()
    .filter(w => w.profile && w.isVisible())
    .sort((a, b) => a.id - b.id);
  if (wins.length === 0) return;
  const focused = BrowserWindow.getFocusedWindow();
  let idx = focused ? wins.findIndex(w => w.id === focused.id) : -1;
  idx = (idx + dir + wins.length) % wins.length;
  const target = wins[idx];
  if (target) { target.show(); target.focus(); }
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

ipcMain.handle('launch', async (e, profile, opts) => {
  opts = opts || {};

  // 检测是否有上次的会话快照可恢复（无痕 / 小窗 / 指定 url 不触发）
  if (!opts.incognito && !opts.small && !opts.url && !opts.skipSessionRestore) {
    try {
      const snap = sessionStore.loadClean(profile.id);
      const n = (snap.windows || []).filter(w => w.url).length;
      // 当前 profile 还有窗口开着，跳过提示（用户已经在用了）
      const alive = [...windowRegistry.values()].some(m => m.profile_id === profile.id);
      if (n > 0 && !alive) {
        const r = await dialog.showMessageBox({
          type: 'question',
          title: '恢复上次会话？',
          message: `「${profile.emoji} ${profile.name}」上次还开着 ${n} 个窗口`,
          detail: '恢复会按原 URL 打开这些窗口；新窗口将清空快照。',
          buttons: ['恢复全部', '新窗口', '取消'],
          defaultId: 0, cancelId: 2,
        });
        if (r.response === 2) { return; }
        if (r.response === 0) {
          for (const w of snap.windows) {
            if (w.url) createBrowserWindow(profile, { url: w.url, small: !!w.is_small });
          }
          if (launcherWindow) launcherWindow.hide();
          return;
        }
        // response 1 = 新窗口：清快照，正常 fall through
        sessionStore.clear(profile.id);
      }
    } catch (err) { console.error('session restore prompt', err.message); }
  }

  createBrowserWindow(profile, opts);
  if (launcherWindow) launcherWindow.hide();
});

ipcMain.handle('edit:open', (e, profile) => openEditWindow(profile || null));
ipcMain.handle('bm:openManager', (e, profileId) => openBookmarkManager(profileId));
ipcMain.handle('history:openManager', (e, profileId) => openHistoryManager(profileId));
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
ipcMain.handle('bm:setFolder', (e, profileId, url, folder) => {
  const list = bm.setFolder(profileId, url, folder);
  broadcastBmChange(profileId);
  return list;
});
ipcMain.handle('bm:folders', (e, profileId) => bm.folders(profileId));
ipcMain.handle('bm:renameFolder', (e, profileId, oldName, newName) => {
  const list = bm.renameFolder(profileId, oldName, newName);
  broadcastBmChange(profileId);
  return list;
});
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

// 从 manifest 的 icon 字段（可能是字符串或 {16,24,32,48,128}: path）取最佳尺寸
function pickIconPath(extDir, iconField, preferSize) {
  if (!iconField) return null;
  if (typeof iconField === 'string') return path.join(extDir, iconField);
  if (typeof iconField === 'object') {
    const sizes = Object.keys(iconField).map(s => parseInt(s)).filter(n => !isNaN(n)).sort((a,b)=>a-b);
    if (sizes.length === 0) return null;
    let pick = sizes.find(s => s >= (preferSize || 24)) || sizes[sizes.length-1];
    return path.join(extDir, iconField[String(pick)]);
  }
  return null;
}

ipcMain.handle('extension:list', (e, profileId) => {
  const dir = path.join(DATA_DIR, 'extensions', profileId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(n => { try { return fs.statSync(path.join(dir, n)).isDirectory(); } catch { return false; } })
    .map(name => {
      const p = path.join(dir, name);
      const meta = readManifest(p);
      const m = meta.raw || {};
      const status = extStatus.get(`${profileId}|${name}`) || { state: 'pending' };
      // browser_action (MV2) / action (MV3) — 两者结构一致
      const action = m.action || m.browser_action || null;
      let actionIcon = null, actionPopup = null, actionTitle = '';
      if (action) {
        actionIcon  = pickIconPath(p, action.default_icon || m.icons, 24);
        actionPopup = action.default_popup ? path.join(p, action.default_popup) : null;
        actionTitle = action.default_title || meta.name;
      } else if (m.icons) {
        actionIcon = pickIconPath(p, m.icons, 24);
        actionTitle = meta.name;
      }
      return {
        dir: name,
        name: meta.name,
        version: meta.version,
        description: meta.description,
        manifestVersion: meta.manifestVersion,
        state: status.state,
        error: status.error || '',
        id: status.id || '',
        action: action ? {
          // file:// URL 给前端直接用作 <img src>
          icon:  actionIcon  && fs.existsSync(actionIcon)  ? 'file://' + actionIcon : null,
          popup: actionPopup && fs.existsSync(actionPopup) ? actionPopup : null,
          title: actionTitle,
        } : null,
      };
    });
});

// 打开扩展的 popup（点击图标时调用）
const extPopupWindows = new Map();  // extId → BrowserWindow
ipcMain.handle('extension:openPopup', (e, payload) => {
  const { profileId, extDir, anchor } = payload || {};
  const list = fs.readdirSync(path.join(DATA_DIR, 'extensions', profileId));
  if (!list.includes(extDir)) return { ok: false, msg: 'extension dir not found' };
  const p = path.join(DATA_DIR, 'extensions', profileId, extDir);
  const meta = readManifest(p);
  const m = meta.raw || {};
  const action = m.action || m.browser_action;
  if (!action || !action.default_popup) return { ok: false, msg: '该扩展没有 popup（只有 onClicked 触发，本版不支持）' };
  const popupRel = action.default_popup;
  if (!fs.existsSync(path.join(p, popupRel))) return { ok: false, msg: 'popup 文件不存在' };

  // 必须用 chrome-extension://<id>/<popup> 加载，否则 chrome.* API 不可用 → popup 是死的
  const status = extStatus.get(`${profileId}|${extDir}`);
  if (!status || status.state !== 'loaded' || !status.id) {
    return { ok: false, msg: '扩展未成功加载（看 🧩 面板里的错误）。重开窗口或菜单"重新加载扩展"' };
  }
  const popupUrl = `chrome-extension://${status.id}/${popupRel}`;

  // 关闭已有的 popup（chrome 行为：同时只允许一个）
  for (const [k, w] of extPopupWindows) {
    if (!w.isDestroyed()) w.close();
    extPopupWindows.delete(k);
  }

  const popup = new BrowserWindow({
    width: (anchor && anchor.w) || 360,
    height: (anchor && anchor.h) || 480,
    x: (anchor && anchor.x) || undefined,
    y: (anchor && anchor.y) || undefined,
    frame: false, resizable: true, show: false,
    backgroundColor: '#ffffff',
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      session: session.fromPartition(`persist:meowser-${profileId}`),
      contextIsolation: false,   // 给 popup 完整 chrome.* 访问
      sandbox: false,
      nodeIntegration: false,
    },
  });
  popup.loadURL(popupUrl).catch(err => console.error('popup loadURL', err.message));
  popup.once('ready-to-show', () => popup.show());
  popup.on('blur', () => { if (!popup.isDestroyed()) popup.close(); });
  popup.on('closed', () => extPopupWindows.delete(extDir));
  extPopupWindows.set(extDir, popup);
  return { ok: true, url: popupUrl };
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
  const newW = small ? SMALL_W : LARGE_W;
  const newH = small ? SMALL_H : LARGE_H;
  win.setSize(newW, newH, true);
  // 广播 resized 让所有 listener（包括 zoom 同步）收到，跟 blur-shrink 路径一致
  win.webContents.send('window:resized', { w: newW, h: newH, small });
  return small;
});
ipcMain.handle('window:setOpacity', (e, alpha) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (!win) return;
  win.setOpacity(alpha);
  saveProfilePref(win, 'opacity', Math.round(alpha * 100));  // 持久化（0-100）
});
ipcMain.handle('window:toggleAlwaysOnTop', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (!win) return false;
  const cur = win.isAlwaysOnTop();
  const next = !cur;
  win.setAlwaysOnTop(next);
  // 取消置顶 + 已开启 autoShrink + 当前没聚焦 → 立即触发缩小（"恢复 autoShrink 行为"）
  if (cur === true && next === false && win.__autoShrink && !win.isFocused()) {
    const [cw] = win.getSize();
    if (cw > SMALL_W + 20) {
      win.setSize(SMALL_W, SMALL_H, true);
      win.webContents.send('window:resized', { w: SMALL_W, h: SMALL_H, small: true });
    }
  }
  // 持久化到 profile.prefs.always_on_top
  saveProfilePref(win, 'always_on_top', next);
  return next;
});
ipcMain.handle('window:setAutoShrink', (e, v) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (!win) return false;
  win.__autoShrink = !!v;
  saveProfilePref(win, 'auto_shrink', !!v);
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

// ─── 历史 (v0.6.0) ───
ipcMain.handle('history:list',   (e, profileId)        => historyStore.load(profileId));
ipcMain.handle('history:search', (e, profileId, q, n)  => historyStore.search(profileId, q, n || 200));
ipcMain.handle('history:remove', (e, profileId, url)   => { historyStore.remove(profileId, url); return true; });
ipcMain.handle('history:clear',  (e, profileId)        => { historyStore.clear(profileId); return true; });

// ─── 会话恢复 (v0.6.0) ───
ipcMain.handle('session:peek',   (e, profileId) => sessionStore.loadClean(profileId));
ipcMain.handle('session:clear',  (e, profileId) => { sessionStore.clear(profileId); return true; });
ipcMain.handle('session:restore', (e, profileId) => {
  const snap = sessionStore.loadClean(profileId);
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return { ok: false, msg: 'profile not found' };
  let opened = 0;
  for (const w of (snap.windows || [])) {
    if (!w.url) continue;
    createBrowserWindow(profile, { url: w.url, small: !!w.is_small });
    opened++;
  }
  return { ok: true, opened };
});

// ─── 偏好读取（renderer 知道当前持久化值，用于 UI 同步）───
ipcMain.handle('prefs:get', (e, profileId) => profilePrefs.load(profileId));

// ─── 窗口管理 (v0.5.0) ───
ipcMain.handle('windows:list', () => snapshotWindows());

ipcMain.handle('windows:focus', (e, windowId) => {
  const w = BrowserWindow.fromId(windowId);
  if (!w || w.isDestroyed()) return { ok: false, reason: 'not_found' };
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  return { ok: true };
});

async function confirmAndClose(w, force) {
  if (!w || w.isDestroyed()) return { ok: false, reason: 'not_found' };
  if (!force) {
    const hasUnsaved = await probeUnsavedInput(w);
    if (hasUnsaved) {
      const meta = windowRegistry.get(w.id);
      const r = await dialog.showMessageBox(w, {
        type: 'warning',
        title: '关闭窗口',
        message: meta ? `「${meta.profile_emoji} ${meta.profile_name}」窗口里有疑似未保存的输入` : '此窗口有疑似未保存的输入',
        detail: '关闭后输入内容将丢失。',
        buttons: ['取消', '确认关闭'],
        defaultId: 0,
        cancelId: 0,
      });
      if (r.response !== 1) return { ok: false, cancelled: true };
    }
  }
  w.close();
  return { ok: true };
}

ipcMain.handle('windows:close', (e, windowId, force) => {
  const w = BrowserWindow.fromId(windowId);
  return confirmAndClose(w, !!force);
});

ipcMain.handle('windows:closeBatch', async (e, payload) => {
  const { window_ids = [], force = false } = payload || {};
  let closed = 0, cancelled = 0;
  for (const id of window_ids) {
    const w = BrowserWindow.fromId(id);
    if (!w || w.isDestroyed()) continue;
    const r = await confirmAndClose(w, force);
    if (r && r.ok) closed++;
    else if (r && r.cancelled) cancelled++;
  }
  return { closed, cancelled };
});

ipcMain.handle('windows:closeByProfile', async (e, payload) => {
  const { profile_id, keep_focused = false, force = false } = payload || {};
  if (!profile_id) return { closed: 0 };
  const focusedId = BrowserWindow.getFocusedWindow() ? BrowserWindow.getFocusedWindow().id : null;
  let closed = 0;
  for (const meta of [...windowRegistry.values()]) {
    if (meta.profile_id !== profile_id) continue;
    if (keep_focused && meta.window_id === focusedId) continue;
    const w = BrowserWindow.fromId(meta.window_id);
    const r = await confirmAndClose(w, force);
    if (r && r.ok) closed++;
  }
  return { closed };
});

ipcMain.handle('windows:closeAllIncognito', async () => {
  let closed = 0;
  for (const meta of [...windowRegistry.values()]) {
    if (!meta.is_incognito) continue;
    const w = BrowserWindow.fromId(meta.window_id);
    const r = await confirmAndClose(w, true);  // 无痕窗一律 force 关，无意义提示
    if (r && r.ok) closed++;
  }
  return { closed };
});

ipcMain.handle('windows:keepFocusedCloseOthers', async () => {
  const focused = BrowserWindow.getFocusedWindow();
  const focusedId = focused ? focused.id : null;
  let closed = 0;
  for (const meta of [...windowRegistry.values()]) {
    if (meta.window_id === focusedId) continue;
    const w = BrowserWindow.fromId(meta.window_id);
    const r = await confirmAndClose(w, false);
    if (r && r.ok) closed++;
  }
  return { closed };
});

// ─── 窗口管理面板窗本身 ───
let windowManagerWindow = null;
function openWindowManager() {
  if (windowManagerWindow && !windowManagerWindow.isDestroyed()) {
    windowManagerWindow.show();
    windowManagerWindow.focus();
    return;
  }
  windowManagerWindow = new BrowserWindow({
    width: 980, height: 640, show: false,
    backgroundColor: '#1d1d1f',
    titleBarStyle: 'hiddenInset',
    title: '窗口管理',
    vibrancy: 'under-window', visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  windowManagerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  windowManagerWindow.loadFile(path.join(__dirname, 'window_manager.html'));
  windowManagerWindow.once('ready-to-show', () => {
    windowManagerWindow.show();
    windowManagerWindow.focus();
  });
  windowManagerWindow.on('closed', () => { windowManagerWindow = null; });
}
ipcMain.handle('windowManager:open', () => openWindowManager());

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
        { label: `${app.name} v${app.getVersion()}`, enabled: false },
        { type: 'separator' },
        { label: '检查更新…', accelerator: 'Cmd+,', click: async () => {
          try {
            const r = await (require('electron-updater').autoUpdater).checkForUpdates();
            const v = r && r.updateInfo && r.updateInfo.version;
            const cur = app.getVersion();
            if (!v || v === cur) {
              dialog.showMessageBox({ type: 'info', title: '已是最新版', message: `当前 v${cur}`, buttons: ['好'] });
            } else {
              const pick = await dialog.showMessageBox({
                type: 'info', title: '发现新版',
                message: `v${v} 已发布`, detail: `当前 v${cur}\n打开 GitHub Releases 下载 dmg 拖装。\n（app 未签名，无法静默替换）`,
                buttons: ['打开 Releases', '稍后'], defaultId: 0, cancelId: 1,
              });
              if (pick.response === 0) shell.openExternal('https://github.com/len-svg/meowser-electron/releases/latest');
            }
          } catch (e) {
            dialog.showMessageBox({ type: 'error', title: '检查更新失败', message: e.message, buttons: ['好'] });
          }
        }},
        { label: '前往 GitHub Releases', click: () => shell.openExternal('https://github.com/len-svg/meowser-electron/releases') },
        { type: 'separator' },
        { role: 'about' },
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
  // macOS "关于 Meowser" 面板显示版本/作者/版权
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Meowser',
      applicationVersion: app.getVersion(),
      version: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
      copyright: 'GPL-3.0 · len@maskex.vip',
      website: 'https://github.com/len-svg/meowser-electron',
    });
  }
  installAppMenu();          // ← 必须在 createLauncher 之前
  createLauncher();
  createTray();
  // Option+` 一键显示/隐藏所有窗口
  globalShortcut.register('Alt+`', toggleAllWindows);
  // Option+Shift+` 一键唤起所有 / Option+Cmd+` 一键隐藏所有（拆开按需）
  globalShortcut.register('Alt+Shift+`', showAllWindows);
  globalShortcut.register('Alt+Cmd+`', hideAllWindows);
  globalShortcut.register('CommandOrControl+Alt+L', () => createLauncher());
  // ⌃⌘W 唤起窗口管理器（与 macOS 系统的 ⌘W 关闭窗口冲突，故用 Ctrl+Cmd 组合）
  globalShortcut.register('Control+Cmd+W', () => openWindowManager());
  // ─── 窗口循环切换 ───
  // 注意：Cmd+方向键 在文本框里是"行首/行尾/文首/文末"，全局抢占会破坏所有输入。
  // 因此用 Cmd+Alt+方向键（不与文本编辑冲突）。Cmd+Alt+← / → 上一个 / 下一个窗口。
  globalShortcut.register('Cmd+Alt+Right', () => cycleWindows(+1));
  globalShortcut.register('Cmd+Alt+Left',  () => cycleWindows(-1));
  globalShortcut.register('Cmd+Alt+Down',  () => cycleWindows(+1));
  globalShortcut.register('Cmd+Alt+Up',    () => cycleWindows(-1));

  // 自动更新（5s 后第一次查 + 每 6h 复查；只在打包后启动，dev 模式跳过）
  if (app.isPackaged) {
    try { updater.init(); } catch (e) { console.error('updater.init', e); }
  } else {
    console.log('[updater] dev 模式跳过自动更新');
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

// 退出 app 前：保存所有 profile 的当前会话（在窗口被销毁前抢救一次）
app.on('before-quit', () => {
  try {
    const byProfile = new Map();
    for (const meta of windowRegistry.values()) {
      if (meta.is_incognito) continue;
      if (!byProfile.has(meta.profile_id)) byProfile.set(meta.profile_id, []);
      byProfile.get(meta.profile_id).push(meta);
    }
    for (const [pid, windows] of byProfile) {
      sessionStore.saveFromWindows(pid, windows);
    }
    console.log(`✓ 退出前保存 ${byProfile.size} 个 profile 的会话快照`);
  } catch (e) { console.error('before-quit session save', e.message); }
});

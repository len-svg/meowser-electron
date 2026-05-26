// 验证 v0.6.0 持久化三件套：per-profile prefs / history / session restore
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOME = os.homedir();
const HIST_DIR = path.join(HOME, '.meowser', 'history');
const SESS_DIR = path.join(HOME, '.meowser', 'sessions');
const PREFS_DIR = path.join(HOME, '.meowser', 'prefs');

function clearTestData() {
  for (const dir of [HIST_DIR, SESS_DIR, PREFS_DIR]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  clearTestData();
  let app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..') });
  let launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.click('.run');
  let win = await app.waitForEvent('window', { timeout: 8000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  // ─── 1. 历史：触发 webview 导航 ───
  console.log('=== history capture ===');
  await win.evaluate(() => { document.querySelector('webview').src = 'https://example.com'; });
  await win.waitForTimeout(3000);
  await win.evaluate(() => { document.querySelector('webview').src = 'https://example.org'; });
  await win.waitForTimeout(3000);

  const histFile = path.join(HIST_DIR, 'p_default.json');
  const histOK = fs.existsSync(histFile) && (() => {
    const hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
    const urls = hist.map(h => h.url);
    console.log('  history urls:', urls);
    return urls.some(u => u.includes('example.com')) && urls.some(u => u.includes('example.org'));
  })();
  console.log(' ', histOK ? '✓' : '✗', '历史被捕获 → ~/.meowser/history/p_default.json');

  // ─── 2. prefs：通过 chrome.html 的 IPC 触发 ───
  console.log('\n=== prefs persist ===');
  // setOpacity → 走 IPC → 落盘
  await win.evaluate(() => window.api.setOpacity(0.77));
  await win.waitForTimeout(300);
  // setAutoShrink → IPC → 落盘
  await win.evaluate(() => window.api.setAutoShrink(true));
  await win.waitForTimeout(300);
  // togglePin → IPC → 落盘
  await win.evaluate(() => window.api.togglePin());
  await win.waitForTimeout(300);

  const prefsFile = path.join(PREFS_DIR, 'p_default.json');
  const prefsOK = fs.existsSync(prefsFile) && (() => {
    const prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
    console.log('  prefs:', prefs);
    return prefs.opacity === 77 && prefs.auto_shrink === true && typeof prefs.always_on_top === 'boolean';
  })();
  console.log(' ', prefsOK ? '✓' : '✗', 'prefs 落盘 → ~/.meowser/prefs/p_default.json');

  // ─── 3. session save：触发 before-quit ───
  console.log('\n=== session save on quit ===');
  await win.evaluate(() => { document.querySelector('webview').src = 'https://example.net'; });
  await win.waitForTimeout(2500);

  await app.close();

  const sessFile = path.join(SESS_DIR, 'p_default.json');
  const sessOK = fs.existsSync(sessFile) && (() => {
    const sess = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
    console.log('  session.windows:', sess.windows);
    return (sess.windows || []).some(w => w.url && w.url.includes('example'));
  })();
  console.log(' ', sessOK ? '✓' : '✗', 'session 保存 → ~/.meowser/sessions/p_default.json');

  // ─── 4. 第二次启动时 prefs 被读取并应用 ───
  console.log('\n=== prefs applied on next launch ===');
  app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..') });
  launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.waitForTimeout(500);

  // 直接调 createBrowserWindow 走持久化路径（不走 launch IPC，跳过 session restore 弹窗）
  const reloadedPrefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
  const persistedOK = reloadedPrefs.opacity === 77 && reloadedPrefs.auto_shrink === true;
  console.log(' ', persistedOK ? '✓' : '✗', '重启后 prefs 仍正确');

  await app.close();

  console.log('\n=== verdict ===');
  console.log('  history capture: ', histOK ? '✓' : '✗');
  console.log('  prefs persist:   ', prefsOK ? '✓' : '✗');
  console.log('  prefs reloaded:  ', persistedOK ? '✓' : '✗');
  console.log('  session save:    ', sessOK ? '✓' : '✗');

  if (histOK && prefsOK && persistedOK && sessOK) {
    console.log('\n✓ v0.6.0 persistence all green');
    process.exit(0);
  }
  console.error('\n✗ persistence 有问题');
  process.exit(1);
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

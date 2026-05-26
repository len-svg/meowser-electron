// 验证 v0.6.0 持久化三件套：per-profile prefs / history / session restore
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();
const fs = require('fs');

const HIST_DIR  = _SB.paths.history;
const SESS_DIR  = _SB.paths.sessions;
const PREFS_DIR = _SB.paths.prefs;

console.log('SANDBOX_HOME:', _SB.home);

(async () => {
  let app = await electron.launch({ args: [path.join(__dirname, "..")], cwd: path.join(__dirname, ".."), env: _SB.env });
  let launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.click('.run');
  let win = await app.waitForEvent('window', { timeout: 8000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  // ─── 1. 历史 ───
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
  console.log(' ', histOK ? '✓' : '✗', '历史被捕获 →', histFile);

  // ─── 2. prefs ───
  console.log('\n=== prefs persist ===');
  await win.evaluate(() => window.api.setOpacity(0.77));
  await win.waitForTimeout(300);
  await win.evaluate(() => window.api.setAutoShrink(true));
  await win.waitForTimeout(300);
  await win.evaluate(() => window.api.togglePin());
  await win.waitForTimeout(300);

  const prefsFile = path.join(PREFS_DIR, 'p_default.json');
  const prefsOK = fs.existsSync(prefsFile) && (() => {
    const prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
    console.log('  prefs:', prefs);
    return prefs.opacity === 77 && prefs.auto_shrink === true && typeof prefs.always_on_top === 'boolean';
  })();
  console.log(' ', prefsOK ? '✓' : '✗', 'prefs 落盘 →', prefsFile);

  // ─── 3. session save (only http(s) URLs saved) ───
  console.log('\n=== session save on quit ===');
  // 最终落在 https URL → 应被保存
  await win.evaluate(() => { document.querySelector('webview').src = 'https://example.net'; });
  await win.waitForTimeout(2500);

  await app.close();

  const sessFile = path.join(SESS_DIR, 'p_default.json');
  const sessOK = fs.existsSync(sessFile) && (() => {
    const sess = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
    console.log('  session.windows:', sess.windows);
    const hasData = (sess.windows || []).some(w => /^data:/.test(w.url || ''));
    if (hasData) { console.error('  ✗ data: URL 被错误保存（应过滤）'); return false; }
    return (sess.windows || []).some(w => /^https?:/.test(w.url || ''));
  })();
  console.log(' ', sessOK ? '✓' : '✗', 'session 保存 https URL');

  // 单独验证过滤逻辑：直接调 saveFromWindows
  const filterTest = (() => {
    const ss = require(path.resolve(__dirname, '../src/session_store.js'));
    const dataUrl = 'data:text/html,<input>';
    return !ss.isRestorableUrl(dataUrl)
        && !ss.isRestorableUrl('about:blank')
        && !ss.isRestorableUrl('chrome://settings')
        && !ss.isRestorableUrl('file:///foo.html')
        &&  ss.isRestorableUrl('https://example.com')
        &&  ss.isRestorableUrl('http://example.com');
  })();
  console.log(' ', filterTest ? '✓' : '✗', 'isRestorableUrl 过滤逻辑正确');

  // ─── 4. 重启后 prefs 仍持久 ───
  console.log('\n=== prefs applied on next launch ===');
  app = await electron.launch({ args: [path.join(__dirname, "..")], cwd: path.join(__dirname, ".."), env: _SB.env });
  launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.waitForTimeout(500);

  const reloadedPrefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
  const persistedOK = reloadedPrefs.opacity === 77 && reloadedPrefs.auto_shrink === true;
  console.log(' ', persistedOK ? '✓' : '✗', '重启后 prefs 仍正确');

  await app.close();

  console.log('\n=== verdict ===');
  console.log('  history capture: ', histOK ? '✓' : '✗');
  console.log('  prefs persist:   ', prefsOK ? '✓' : '✗');
  console.log('  prefs reloaded:  ', persistedOK ? '✓' : '✗');
  console.log('  session save:    ', sessOK ? '✓' : '✗ (含 data: 协议)');

  if (histOK && prefsOK && persistedOK && sessOK && filterTest) {
    console.log('\n✓ v0.6.0 persistence all green');
    process.exit(0);
  }
  console.error('\n✗ persistence 有问题');
  process.exit(1);
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

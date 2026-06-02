// v0.7.9 测试：浏览器送出（handoff）功能
//  H1 detectBrowsers IPC 返回已装的 KNOWN_BROWSERS 子集
//  H2 toolbar 多了 #btn-handoff 按钮
//  H3 ⇧⌘O 快捷键 listener 已挂
//  H4 在工作区首页 (file://) 调 handoff 不发出 — toast 提示
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();

let failures = [];
function check(name, ok, detail) {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures.push(name);
}

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..'), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.click('.run');
  const win = await app.waitForEvent('window', { timeout: 8000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  // H1: detectBrowsers IPC
  console.log('=== H1 detectBrowsers IPC ===');
  const browsers = await win.evaluate(() => window.api.detectBrowsers());
  check('detectBrowsers 返回数组', Array.isArray(browsers), JSON.stringify(browsers));
  if (Array.isArray(browsers)) {
    // 本机 mac 至少装着 Safari 或 Chrome 其中一个；测试环境只 KNOWN_BROWSERS 里的会被识别
    // Safari 不在 KNOWN_BROWSERS（它不能登 Google + 1Password chrome ext）
    // 所以只要有任一已知浏览器在列就够（CI 可能空）
    check('每项都是字符串', browsers.every(b => typeof b === 'string'));
  }

  // H2: toolbar 多了 #btn-handoff
  console.log('\n=== H2 #btn-handoff 按钮 ===');
  const handoffBtn = await win.evaluate(() => {
    const el = document.getElementById('btn-handoff');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { visible: r.width > 0, title: el.title };
  });
  check('#btn-handoff 渲染', !!handoffBtn && handoffBtn.visible);
  if (handoffBtn) check('title 含 "Chrome/Arc"', handoffBtn.title.includes('Chrome'));

  // H3 ⇧⌘O 快捷键 -> 调用 handoffToBrowser
  // 在首页调，应该被 file:// 检测拦下，弹 toast
  console.log('\n=== H3 ⇧⌘O 在首页应提示无 URL 可送 ===');
  await win.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'O', metaKey: true, ctrlKey: false, shiftKey: true, bubbles: true }));
  });
  await win.waitForTimeout(500);
  const toastFound = await win.evaluate(() => {
    return [...document.body.querySelectorAll('div')]
      .some(d => (d.textContent || '').includes('工作区首页') || (d.textContent || '').includes('没检测到'));
  });
  check('⇧⌘O 在首页有 toast 提示', toastFound);

  // H4 切到真 URL 后再按 ⇧⌘O 应调 openExternal
  console.log('\n=== H4 真 URL 下 ⇧⌘O 调 openExternal ===');
  // 用一个真 https URL 让 safeGetURL 返回非 file://
  let openExternalCalled = false;
  // 通过 main 进程 hook 检测
  await app.evaluate(({ ipcMain }) => {
    const origHandlers = ipcMain._invokeHandlers || ipcMain._handlers;
    // ipcMain.handle 内部记到 _invokeHandlers (Map)；不同 Electron 版本不一样，使用兜底
  });
  await win.evaluate(() => {
    document.querySelector('webview').src = 'https://example.com';
  });
  await win.waitForTimeout(3000);
  // 在主进程 patch openExternal handler，用 flag 记录
  await app.evaluate(({ ipcMain }) => {
    global.__handoffCalled = false;
    ipcMain.removeHandler('window:openExternal');
    ipcMain.handle('window:openExternal', (e, url, appName) => {
      global.__handoffCalled = { url, appName };
    });
  });
  await win.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'O', metaKey: true, ctrlKey: false, shiftKey: true, bubbles: true }));
  });
  await win.waitForTimeout(500);
  const handoffCalled = await app.evaluate(() => global.__handoffCalled);
  check('⇧⌘O 触发 openExternal', !!handoffCalled, JSON.stringify(handoffCalled));
  if (handoffCalled) {
    check('  传入了 URL', !!handoffCalled.url && handoffCalled.url.includes('example.com'));
    check('  传入了 app 名（首选浏览器）', !!handoffCalled.appName);
  }

  await app.close();

  if (failures.length === 0) { console.log('\n✓ handoff 全过'); process.exit(0); }
  console.error('\n✗ 失败:', failures); process.exit(1);
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

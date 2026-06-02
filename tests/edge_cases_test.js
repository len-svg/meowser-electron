// v0.7.6 边界测试集（4 个新功能）
// E1 ⌘N 开新窗口
// E2 menu mouseleave 350ms 后关
// E3 webview 在 small 模式 setZoomLevel
// E4 tray 用 logo 图片
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
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

  // ─── E4 tray icon ───
  console.log('\n=== E4 tray icon 用 logo 而非 emoji ===');
  const trayInfo = await app.evaluate(({ app: a }) => {
    return { name: a.name, version: a.getVersion() };
  });
  // tray 实例无法直接从 app 拿；改测 logo 文件存在 + 大小
  const logoFile = path.join(__dirname, '..', 'build', 'brand', 'logo.png');
  check('build/brand/logo.png 存在', fs.existsSync(logoFile));
  if (fs.existsSync(logoFile)) {
    const stat = fs.statSync(logoFile);
    check('logo 文件 > 0 bytes', stat.size > 0, `${stat.size}B`);
  }

  // ─── E1 ⌘N 新建窗口 ───
  console.log('\n=== E1 ⌘N → 当前 profile 新窗口 ===');
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.profile).length);
  await win.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, ctrlKey: false, shiftKey: false, bubbles: true }));
  });
  await win.waitForTimeout(1500);
  const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.profile).length);
  check('⌘N 后窗口数 +1', after === before + 1, `${before} → ${after}`);

  // ─── E3 small 模式 webview setZoomLevel ───
  console.log('\n=== E3 small 模式 → webview zoom -1.5 ===');
  // 强制切小窗
  await win.evaluate(() => window.api.toggleSize());
  await win.waitForTimeout(800);
  const zoomLevel = await app.evaluate(({ webContents }) => {
    const wv = webContents.getAllWebContents().find(wc => wc.hostWebContents);
    return wv ? wv.getZoomLevel() : 999;
  });
  check('small 模式 zoom ≈ -1.5', Math.abs(zoomLevel - (-1.5)) < 0.01, `zoom=${zoomLevel}`);
  // 切回大窗
  await win.evaluate(() => window.api.toggleSize());
  await win.waitForTimeout(800);
  const zoomLevel2 = await app.evaluate(({ webContents }) => {
    const wv = webContents.getAllWebContents().find(wc => wc.hostWebContents);
    return wv ? wv.getZoomLevel() : 999;
  });
  check('large 模式 zoom = 0', Math.abs(zoomLevel2) < 0.01, `zoom=${zoomLevel2}`);

  // ─── E2 menu mouseleave 350ms 关闭 ───
  console.log('\n=== E2 menu 鼠标离开 350ms 自动关 ===');
  // 打开 ⋮ 主菜单 — 加重试，应对 race（preload IPC、buildMainMenu 可能慢一拍）
  let panelShown = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await win.click('#btn-menu');
    // 轮询最多 1.2s
    for (let t = 0; t < 12; t++) {
      panelShown = await win.evaluate(() => document.getElementById('main-menu').classList.contains('show'));
      if (panelShown) break;
      await win.waitForTimeout(100);
    }
    if (panelShown) break;
    console.log(`  ⚠️ 第 ${attempt + 1} 次点 #btn-menu 没显示，重试`);
    await win.waitForTimeout(300);
  }
  check('点击 ⋮ 后菜单显示', panelShown);
  // 模拟 mouseleave
  await win.evaluate(() => {
    const p = document.getElementById('main-menu');
    p.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  });
  await win.waitForTimeout(150);
  let stillShown = await win.evaluate(() => document.getElementById('main-menu').classList.contains('show'));
  check('mouseleave 150ms 时还显示（在 350ms 内）', stillShown);
  await win.waitForTimeout(400);  // 累计 ~550ms，超过 350
  let closedNow = await win.evaluate(() => !document.getElementById('main-menu').classList.contains('show'));
  check('mouseleave 550ms 后已关闭', closedNow);

  // ─── E2.1 边界：mouseleave 后 350ms 内 mouseenter 应取消关闭 ───
  console.log('\n=== E2.1 mouseleave 后 mouseenter 取消关闭 ===');
  await win.click('#btn-menu');
  await win.waitForTimeout(500);
  await win.evaluate(() => {
    const p = document.getElementById('main-menu');
    p.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    // 150ms 后回到菜单
    setTimeout(() => p.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })), 150);
  });
  await win.waitForTimeout(600);  // 等过原本会关闭的时间
  let stillOpen = await win.evaluate(() => document.getElementById('main-menu').classList.contains('show'));
  check('mouseenter 取消了关闭定时器', stillOpen);

  await app.close();

  console.log('\n=== 总结 ===');
  if (failures.length === 0) {
    console.log('✓ 边界测试 v0.7.6 全部通过');
    process.exit(0);
  } else {
    console.error('✗ 失败:', failures);
    process.exit(1);
  }
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

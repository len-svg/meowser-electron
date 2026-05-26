// 一次性验证 3 个 bug：webview ⌘V / URL bar Enter / pin gates autoShrink
const { _electron: electron } = require('@playwright/test');
const path = require('path');

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..') });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.click('.run');
  const win = await app.waitForEvent('window', { timeout: 8000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  const out = { bugs: [] };

  // ─── Bug #2: URL bar Enter 触发 navigate ───
  console.log('\n=== Bug #2: URL bar Enter → navigate ===');
  await win.click('#url');
  await win.fill('#url', 'example.com');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1500);
  const wvAfterEnter = await win.evaluate(() => {
    const wv = document.querySelector('webview');
    return wv ? wv.src : null;
  });
  console.log('  webview src after Enter:', wvAfterEnter);
  const enterOK = (wvAfterEnter || '').includes('example.com');
  console.log('  ' + (enterOK ? '✓' : '✗') + ' Enter 在地址栏触发导航');
  if (!enterOK) out.bugs.push('URL bar Enter navigate broken');

  // ─── Bug #1a: URL bar ⌘C/⌘V (chrome.html host page input) ───
  console.log('\n=== Bug #1a: URL bar ⌘C/⌘V ===');
  await win.click('#url');
  await win.fill('#url', 'meowser-url-bar-clip-test');
  await win.keyboard.press('Meta+a');
  await win.waitForTimeout(150);
  await win.keyboard.press('Meta+c');
  await win.waitForTimeout(200);
  const clip1 = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log('  clipboard after URL ⌘C:', JSON.stringify(clip1));
  await win.fill('#url', '');
  await win.click('#url');
  await win.waitForTimeout(150);
  await win.keyboard.press('Meta+v');
  await win.waitForTimeout(200);
  const pasted1 = await win.evaluate(() => document.getElementById('url').value);
  console.log('  URL after ⌘V:', JSON.stringify(pasted1));
  const urlClipOK = clip1 === 'meowser-url-bar-clip-test' && pasted1 === 'meowser-url-bar-clip-test';
  console.log('  ' + (urlClipOK ? '✓' : '✗') + ' URL bar ⌘C/⌘V');
  if (!urlClipOK) out.bugs.push('URL bar ⌘C/⌘V broken');

  // ─── Bug #1b: webview-loaded page input ⌘C/⌘V ───
  console.log('\n=== Bug #1b: webview content ⌘C/⌘V ===');
  await win.evaluate(() => {
    const wv = document.querySelector('webview');
    wv.src = 'data:text/html,<input id=probe value=meowser-webview-clip autofocus style="font-size:16px;padding:8px">';
  });
  await win.waitForTimeout(2500);
  // 焦点跑到 webview 里？通过 webview API 间接发 keystroke 难做，用 contents.executeJavaScript 模拟
  const wvWcInfo = await app.evaluate(({ webContents }) => {
    const all = webContents.getAllWebContents().filter(wc => wc.hostWebContents);
    return all.map(wc => ({ id: wc.id, url: wc.getURL() }));
  });
  console.log('  webview wc list:', wvWcInfo);

  // 用 webContents.copy/paste 模拟（这是 Electron 暴露的剪贴板操作；如果工作说明菜单 role 路径 OK）
  const copyPasteResult = await app.evaluate(async ({ webContents, clipboard }) => {
    const list = webContents.getAllWebContents().filter(wc => wc.hostWebContents);
    const target = list.find(wc => wc.getURL().startsWith('data:text/html'));
    if (!target) return { error: 'no webview wc' };
    // select all + copy
    target.selectAll();
    target.copy();
    await new Promise(r => setTimeout(r, 200));
    const clipAfter = clipboard.readText();
    // clear & paste
    target.executeJavaScript('document.getElementById("probe").value=""; document.getElementById("probe").focus();');
    await new Promise(r => setTimeout(r, 100));
    target.paste();
    await new Promise(r => setTimeout(r, 300));
    const finalVal = await target.executeJavaScript('document.getElementById("probe").value');
    return { clipAfter, finalVal };
  });
  console.log('  webview copy/paste roundtrip:', JSON.stringify(copyPasteResult));
  const wvClipOK = copyPasteResult.clipAfter === 'meowser-webview-clip' && copyPasteResult.finalVal === 'meowser-webview-clip';
  console.log('  ' + (wvClipOK ? '✓' : '✗') + ' webview content ⌘C/⌘V (via WebContents API)');
  if (!wvClipOK) out.bugs.push('webview content ⌘C/⌘V broken');

  // ─── Bug #3: pin gates autoShrink ───
  console.log('\n=== Bug #3: pin gates autoShrink ===');
  const winState = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.profile);
    if (!w) return null;
    return {
      always_on_top: w.isAlwaysOnTop(),
      auto_shrink: !!w.__autoShrink,
      bounds: w.getBounds(),
    };
  });
  console.log('  initial state:', winState);
  // 启用 autoShrink + 保持 alwaysOnTop=true（默认）→ blur 不应缩
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.profile);
    if (w) w.__autoShrink = true;
  });
  // 创造 blur：聚焦另一个窗
  await launcher.bringToFront();
  await win.waitForTimeout(800);
  const afterBlur = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.profile);
    return w ? w.getBounds() : null;
  });
  console.log('  after blur with pin ON:', afterBlur);
  const stayedLarge = afterBlur && afterBlur.width > 600;
  console.log('  ' + (stayedLarge ? '✓' : '✗') + ' 置顶时 blur 不缩小');
  if (!stayedLarge) out.bugs.push('Pin does not gate autoShrink');

  await app.close();

  if (out.bugs.length > 0) {
    console.error('\n✗ confirmed bugs:', out.bugs);
    process.exit(1);
  } else {
    console.log('\n✓ all 3 bugs cannot be reproduced (already fixed)');
  }
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

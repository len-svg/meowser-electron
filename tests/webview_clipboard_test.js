// 准确判断 webview 内 ⌘C/⌘V 是否工作（每步独立 try-catch）
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

  await win.evaluate(() => {
    document.querySelector('webview').src = 'data:text/html;charset=utf-8,<body><input id=probe value=meowser-clip-XYZ autofocus></body>';
  });
  await win.waitForTimeout(2500);

  // path 1: execCommand 在 webview 内调
  const r1 = await app.evaluate(async ({ webContents, clipboard }) => {
    try {
      const target = webContents.getAllWebContents().find(wc => wc.hostWebContents && wc.getURL().startsWith('data:'));
      if (!target) return { ok: false, err: 'no webview' };
      clipboard.writeText('__init__');
      const cmdOk = await target.executeJavaScript(`(()=>{const i=document.getElementById('probe');i.focus();i.select();return document.execCommand('copy');})()`);
      await new Promise(r => setTimeout(r, 300));
      const cb = clipboard.readText();
      return { ok: true, execCopyOk: cmdOk, clipboard: cb };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  console.log('execCommand path:', JSON.stringify(r1));

  // path 2: webContents.copy() 直接
  const r2 = await app.evaluate(async ({ webContents, clipboard }) => {
    try {
      const target = webContents.getAllWebContents().find(wc => wc.hostWebContents && wc.getURL().startsWith('data:'));
      clipboard.writeText('__init2__');
      await target.executeJavaScript(`(()=>{const i=document.getElementById('probe');i.value='WC-API-copy';i.focus();i.select();})()`);
      await new Promise(r => setTimeout(r, 200));
      target.copy();
      await new Promise(r => setTimeout(r, 300));
      return { ok: true, clipboard: clipboard.readText() };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  console.log('webContents.copy() path:', JSON.stringify(r2));

  // path 3: webContents.paste()
  const r3 = await app.evaluate(async ({ webContents, clipboard }) => {
    try {
      const target = webContents.getAllWebContents().find(wc => wc.hostWebContents && wc.getURL().startsWith('data:'));
      clipboard.writeText('paste-target-VALUE');
      await target.executeJavaScript(`(()=>{const i=document.getElementById('probe');i.value='';i.focus();})()`);
      await new Promise(r => setTimeout(r, 200));
      target.paste();
      await new Promise(r => setTimeout(r, 400));
      const v = await target.executeJavaScript(`document.getElementById('probe').value`);
      return { ok: true, finalVal: v };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  console.log('webContents.paste() path:', JSON.stringify(r3));

  // path 4: 触发主应用菜单的 paste role（这是 ⌘V 真实路由）
  const r4 = await app.evaluate(async ({ Menu, webContents, clipboard }) => {
    try {
      const target = webContents.getAllWebContents().find(wc => wc.hostWebContents && wc.getURL().startsWith('data:'));
      clipboard.writeText('menu-paste-VALUE');
      await target.executeJavaScript(`(()=>{const i=document.getElementById('probe');i.value='';i.focus();})()`);
      target.focus();
      await new Promise(r => setTimeout(r, 200));

      const menu = Menu.getApplicationMenu();
      const editMenu = menu.items.find(i => i.label === '编辑' || i.label === 'Edit');
      const pasteItem = editMenu && editMenu.submenu.items.find(s => s.role === 'paste');
      if (!pasteItem) return { ok: false, err: 'no paste menu item' };
      pasteItem.click();   // 模拟用户点 编辑 > 粘贴
      await new Promise(r => setTimeout(r, 500));
      const v = await target.executeJavaScript(`document.getElementById('probe').value`);
      return { ok: true, finalVal: v };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  console.log('menu paste role.click() path:', JSON.stringify(r4));

  await app.close();

  // 判断
  const execOk = r1.ok && r1.clipboard === 'meowser-clip-XYZ';
  const apiCopyOk = r2.ok && r2.clipboard === 'WC-API-copy';
  const apiPasteOk = r3.ok && r3.finalVal === 'paste-target-VALUE';
  const menuOk = r4.ok && r4.finalVal === 'menu-paste-VALUE';
  console.log('\n=== verdict ===');
  console.log('  execCommand("copy") in webview:', execOk ? '✓' : '✗');
  console.log('  webContents.copy() in webview:', apiCopyOk ? '✓' : '✗');
  console.log('  webContents.paste() in webview:', apiPasteOk ? '✓' : '✗');
  console.log('  Menu Edit>Paste role.click():', menuOk ? '✓' : '✗');

  if (menuOk && apiPasteOk) {
    console.log('\n✓ webview ⌘C/⌘V 路径打通（菜单 role + webContents API 都工作）');
    process.exit(0);
  }
  console.error('\n✗ 仍有 path 不通，需要修');
  process.exit(1);
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

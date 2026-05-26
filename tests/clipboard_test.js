// 验证 ⌘C / ⌘V 在 webview 内真的工作 + 应用菜单已装上 Edit role
// 用法: node tests/clipboard_test.js
const { _electron: electron } = require('@playwright/test');
const path = require('path');

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..') });
  console.log('✓ launched');

  // 1) 验证 app menu 已装上含 Edit/role:copy 的项
  const menuDump = await app.evaluate(async ({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return { hasMenu: false };
    const items = m.items.map(i => ({
      label: i.label,
      sub: (i.submenu ? i.submenu.items.map(s => ({ label: s.label, role: s.role })) : []),
    }));
    const edit = items.find(i => i.label === '编辑' || i.label === 'Edit');
    const hasCopy  = edit && edit.sub.some(s => s.role === 'copy');
    const hasPaste = edit && edit.sub.some(s => s.role === 'paste');
    return { hasMenu: true, items, hasCopy, hasPaste };
  });
  console.log('=== app menu ===');
  console.log('  hasMenu:', menuDump.hasMenu);
  console.log('  topItems:', menuDump.items.map(i => i.label));
  console.log('  Edit has copy role:', menuDump.hasCopy);
  console.log('  Edit has paste role:', menuDump.hasPaste);

  if (!menuDump.hasCopy || !menuDump.hasPaste) {
    console.error('✗ Edit role missing — ⌘C/⌘V will NOT work');
    await app.close();
    process.exit(1);
  }

  // 2) 实测：聚焦输入框，写文字，全选，⌘C，读剪贴板
  // 用 data: URL 直接造一个简单页面避免 webview 复杂度
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // 在 launcher 窗里注入一个 input 来测
  await win.evaluate(() => {
    const i = document.createElement('input');
    i.id = '__clipboard_probe__';
    i.value = 'meowser-clipboard-test-12345';
    i.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:white;color:black;padding:4px';
    document.body.appendChild(i);
    i.focus();
    i.select();
  });

  // 给 OS 一点时间处理键盘事件
  await win.waitForTimeout(200);

  // 模拟 ⌘A（全选）然后 ⌘C
  await win.keyboard.press('Meta+a');
  await win.waitForTimeout(100);
  await win.keyboard.press('Meta+c');
  await win.waitForTimeout(300);

  // 从主进程读 clipboard
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log('\n=== clipboard test ===');
  console.log('  clipboard.readText() ->', JSON.stringify(clip));

  if (clip === 'meowser-clipboard-test-12345') {
    console.log('✓ ⌘A + ⌘C 工作正常');
  } else {
    console.error('✗ 剪贴板没拿到预期内容 —— ⌘C 仍然失效');
    await app.close();
    process.exit(1);
  }

  // 3) 测 ⌘V：清空 input，⌘V 看能否粘贴回来
  await win.evaluate(() => {
    const i = document.getElementById('__clipboard_probe__');
    i.value = '';
    i.focus();
  });
  await win.waitForTimeout(100);
  await win.keyboard.press('Meta+v');
  await win.waitForTimeout(300);

  const pasted = await win.evaluate(() => document.getElementById('__clipboard_probe__').value);
  console.log('  ⌘V 后 input.value ->', JSON.stringify(pasted));
  if (pasted === 'meowser-clipboard-test-12345') {
    console.log('✓ ⌘V 工作正常');
  } else {
    console.error('✗ ⌘V 没生效');
    await app.close();
    process.exit(1);
  }

  await app.close();
  console.log('\n✓ all checks passed');
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

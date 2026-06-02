const { _electron: electron } = require('@playwright/test');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();
(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..'), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.click('.run');
  const win = await app.waitForEvent('window', { timeout: 8000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  await win.click('#btn-menu');
  await win.waitForTimeout(800);

  // 检查 onmouseleave 是否在 panel 上
  const info1 = await win.evaluate(() => {
    const p = document.getElementById('main-menu');
    return {
      hasShow: p.classList.contains('show'),
      hasOnMouseleave: typeof p.onmouseleave === 'function',
      onmouseleaveText: p.onmouseleave ? p.onmouseleave.toString().substr(0, 150) : null,
    };
  });
  console.log('open state:', JSON.stringify(info1, null, 2));

  // 模拟 mouseleave，再立即检查
  const fired = await win.evaluate(() => {
    const p = document.getElementById('main-menu');
    let count = 0;
    p.addEventListener('mouseleave', () => count++, { once: true });
    p.dispatchEvent(new MouseEvent('mouseleave'));
    return { listenerFired: count, hasShowImmediately: p.classList.contains('show') };
  });
  console.log('after dispatch:', JSON.stringify(fired));

  // 等 500ms（350+buffer）然后检查
  await win.waitForTimeout(500);
  const after = await win.evaluate(() => {
    const p = document.getElementById('main-menu');
    return { hasShow: p.classList.contains('show') };
  });
  console.log('after 500ms:', JSON.stringify(after));

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });

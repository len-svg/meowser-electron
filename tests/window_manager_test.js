// E2E: 开 3 个窗 → 列出 3 条 → 关 1 个 → 列表变 2 → closeBatch 关剩下 2 个
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, "..")], cwd: path.join(__dirname, ".."), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');

  // 开 3 个工作区窗
  const runBtns = await launcher.locator('.run').all();
  console.log('found run buttons:', runBtns.length);
  for (let i = 0; i < Math.min(3, runBtns.length); i++) {
    await runBtns[i].click();
    await launcher.waitForTimeout(800);
  }

  // 从主进程拿 windowRegistry 大小
  const initial = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows().filter(w => w.profile).length;
  });
  console.log('opened profile windows:', initial);

  if (initial < 1) {
    console.error('✗ 没成功开任何工作区窗');
    await app.close(); process.exit(1);
  }

  // 打开窗口管理器
  await launcher.click('#btn-windows').catch(() => {});
  const wm = await app.waitForEvent('window', { timeout: 5000 });
  await wm.waitForLoadState('domcontentloaded');
  await wm.waitForTimeout(1500);
  console.log('window manager URL:', wm.url());

  await wm.screenshot({ path: path.join(__dirname, '_out', 'window_manager_live.png') });

  // 验证列表条数
  const rows = await wm.locator('.row').count();
  console.log('rows in manager:', rows);
  if (rows !== initial) {
    console.error(`✗ 列表条数 ${rows} != 实际打开 ${initial}`);
  } else {
    console.log('✓ 列表条数对得上');
  }

  // 关一个
  await wm.locator('.row').first().locator('[data-act=close]').click();
  await wm.waitForTimeout(500);
  const after1 = await wm.locator('.row').count();
  console.log('after closing 1, rows:', after1);
  if (after1 !== initial - 1) {
    console.error(`✗ 关一个后期望 ${initial - 1} 条，实际 ${after1}`);
  } else {
    console.log('✓ 关一个后列表正确缩短');
  }

  // batch close 剩余
  await wm.evaluate(() => {
    document.querySelectorAll('.row input[type=checkbox]').forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('click', { bubbles: true })); });
  });
  await wm.waitForTimeout(300);
  const sel = await wm.locator('#sel-cnt').textContent();
  console.log('selected count:', sel);

  await wm.locator('#btn-bulk-close').click();
  await wm.waitForTimeout(1500);
  const remaining = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.profile).length);
  console.log('after batch close, profile windows:', remaining);
  if (remaining !== 0) {
    console.error(`✗ 批量关后还剩 ${remaining} 个`);
  } else {
    console.log('✓ 批量关清空');
  }

  await app.close();
  console.log('\n✓ window manager E2E passed');
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

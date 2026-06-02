// 真实验证 URL bar 在导航后是否稳定显示 URL
// 关键：等 5s 模拟"加载后"，截屏看到底是 URL 还是空
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();
const fs = require('fs');

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..'), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.click('.run');
  const win = await app.waitForEvent('window', { timeout: 8000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  console.log('=== 初始状态 (首页 file://) ===');
  let urlValue = await win.evaluate(() => document.getElementById('url').value);
  console.log('  urlInput.value:', JSON.stringify(urlValue));

  console.log('\n=== 导航到 https://example.com ===');
  await win.evaluate(() => { document.querySelector('webview').src = 'https://example.com'; });

  // 立刻读
  await win.waitForTimeout(500);
  urlValue = await win.evaluate(() => document.getElementById('url').value);
  console.log('  +500ms urlInput.value:', JSON.stringify(urlValue));

  await win.waitForTimeout(1500);
  urlValue = await win.evaluate(() => document.getElementById('url').value);
  console.log('  +2s   urlInput.value:', JSON.stringify(urlValue));

  await win.waitForTimeout(3000);
  urlValue = await win.evaluate(() => document.getElementById('url').value);
  console.log('  +5s   urlInput.value:', JSON.stringify(urlValue));

  await win.waitForTimeout(5000);
  urlValue = await win.evaluate(() => document.getElementById('url').value);
  console.log('  +10s  urlInput.value:', JSON.stringify(urlValue));

  // 截屏（waitForFonts 在 webview 主导窗时会超时，捕获后忽略）
  try {
    await win.screenshot({ path: path.join(__dirname, '_out', 'urlbar_after_navigate.png'), timeout: 5000 });
    console.log('\n截屏保存: tests/_out/urlbar_after_navigate.png');
  } catch (e) { console.log('  (截屏跳过:', e.message.split('\n')[0], ')'); }

  // 调试：拿 syncUrl 内部状态
  const debug = await win.evaluate(() => {
    const wv = document.querySelector('webview');
    let getURL = '';
    try { getURL = wv.getURL(); } catch (e) { getURL = '[error: ' + e.message + ']'; }
    return {
      urlInput: document.getElementById('url').value,
      wv_getURL: getURL,
      wv_src: wv.getAttribute('src'),
      activeElement: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
    };
  });
  console.log('\n=== 调试快照 ===');
  console.log(JSON.stringify(debug, null, 2));

  await app.close();

  const finalUrl = urlValue;
  const isBuggy = !finalUrl || !finalUrl.includes('example.com');
  console.log(isBuggy ? '\n✗ URL bar BUG 复现：最终 value = ' + JSON.stringify(finalUrl) : '\n✓ URL bar 稳定显示 https://example.com/');
  process.exit(isBuggy ? 1 : 0);
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

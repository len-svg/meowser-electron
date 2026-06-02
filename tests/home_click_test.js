// 验证首页书签/最近访问卡片点击是否真的导航
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();

// 预置书签：1 条带 URL
fs.mkdirSync(path.join(_SB.dataDir, 'bookmarks'), { recursive: true });
fs.writeFileSync(path.join(_SB.dataDir, 'bookmarks', 'p_default.json'), JSON.stringify([
  { url: 'https://example.org', title: 'Example Org', folder: '', ts: Date.now() },
]));

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..'), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.click('.run');
  const win = await app.waitForEvent('window', { timeout: 8000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(3000);  // 等 webview 加载首页

  // 获取 webview wc，看初始 URL（应该是 file://...home_*.html）
  const initialUrl = await app.evaluate(({ webContents }) => {
    const wv = webContents.getAllWebContents().find(wc => wc.hostWebContents);
    return wv ? wv.getURL() : null;
  });
  console.log('webview 初始 URL:', initialUrl);

  // 在 webview 里找到书签卡片 <a> 并点击
  const clickResult = await app.evaluate(async ({ webContents }) => {
    const wv = webContents.getAllWebContents().find(wc => wc.hostWebContents);
    if (!wv) return { error: 'no webview wc' };
    // 检查 DOM 里有几个 .grid a
    const cnt = await wv.executeJavaScript(`document.querySelectorAll('.grid a').length`);
    const firstHref = await wv.executeJavaScript(`document.querySelector('.grid a') ? document.querySelector('.grid a').href : null`);
    // 点击第一个
    await wv.executeJavaScript(`(()=>{const a=document.querySelector('.grid a');if(a)a.click();})()`);
    return { cnt, firstHref };
  });
  console.log('点击信息:', JSON.stringify(clickResult));

  // 等导航
  await win.waitForTimeout(3500);

  const afterUrl = await app.evaluate(({ webContents }) => {
    const wv = webContents.getAllWebContents().find(wc => wc.hostWebContents);
    return wv ? wv.getURL() : null;
  });
  console.log('点击后 URL:', afterUrl);

  const navigated = afterUrl && afterUrl.includes('example.org');
  console.log(navigated ? '✓ 卡片点击导航工作' : '✗ 卡片点击没导航 — 用户报告的 bug 复现');

  await app.close();
  process.exit(navigated ? 0 : 1);
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

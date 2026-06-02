// 启动 + 直接 RUN 第一个 profile，截图 chrome.html 真实样子
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '_out');
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, "..")], cwd: path.join(__dirname, ".."), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');

  // 点第一个 ▶ RUN
  const ran = await launcher.evaluate(() => {
    const btn = document.querySelector('.run');
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log('clicked RUN:', ran);

  // 等浏览器窗
  const win = await app.waitForEvent('window', { timeout: 10000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000); // 等首页 + bookmark bar
  console.log('chrome window URL:', win.url());

  await win.screenshot({ path: path.join(OUT_DIR, 'chrome.png'), fullPage: false });

  // dump 工具栏元素
  const toolbar = await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.iconbtn, .url, .pill, #star, #bm-menu, #strip')].map(el => {
      const r = el.getBoundingClientRect();
      return {
        id: el.id, cls: el.className,
        text: (el.textContent || '').trim().slice(0, 30),
        visible: r.width > 0 && r.height > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    });
    const url = document.querySelector('#url, .url');
    return {
      toolbarBtns: btns,
      urlInput: url ? { tag: url.tagName.toLowerCase(), value: url.value, placeholder: url.placeholder } : null,
      hasBmbar: !!document.querySelector('#bmbar, .bmbar'),
      webviewSrc: document.querySelector('webview') ? document.querySelector('webview').src : null,
    };
  });
  console.log('toolbar dump:', JSON.stringify(toolbar, null, 2));

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });

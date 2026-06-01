// 验证 URL bar 输入模糊匹配建议
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();

// 预置历史 + 书签
fs.mkdirSync(_SB.paths.history, { recursive: true });
fs.writeFileSync(path.join(_SB.paths.history, 'p_default.json'), JSON.stringify([
  { url: 'https://github.com/len-svg/meowser', title: 'GitHub: meowser', first_visit_at: '2026-05-26T00:00:00Z', last_visit_at: '2026-05-26T00:00:00Z', visit_count: 5 },
  { url: 'https://stackoverflow.com/questions/123', title: 'SO question', first_visit_at: '2026-05-26T00:00:00Z', last_visit_at: '2026-05-26T00:00:00Z', visit_count: 2 },
  { url: 'https://news.ycombinator.com', title: 'Hacker News', first_visit_at: '2026-05-26T00:00:00Z', last_visit_at: '2026-05-26T00:00:00Z', visit_count: 1 },
]));
fs.mkdirSync(path.join(_SB.dataDir, 'bookmarks'), { recursive: true });
fs.writeFileSync(path.join(_SB.dataDir, 'bookmarks', 'p_default.json'), JSON.stringify([
  { url: 'https://github.com', title: 'GitHub Home', folder: '开发', ts: Date.now() },
]));

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], cwd: path.join(__dirname, '..'), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.click('.run');
  const win = await app.waitForEvent('window', { timeout: 8000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  // 在 URL 输入 "github"，期待 suggest 出现
  await win.click('#url');
  await win.fill('#url', 'github');
  await win.waitForTimeout(500);
  const visible = await win.evaluate(() => {
    const p = document.getElementById('omnibox-suggest');
    return { display: p.style.display, count: p.querySelectorAll('.sugg').length, text: p.textContent.slice(0, 200) };
  });
  console.log('suggest panel:', JSON.stringify(visible));

  const hasGithub = visible.text.includes('github.com');
  console.log(hasGithub ? '✓ 输入 github 命中历史/书签' : '✗ 建议没出来');

  // ↓ 选第一条，回车
  await win.keyboard.press('ArrowDown');
  await win.waitForTimeout(100);
  await win.keyboard.press('Enter');
  await win.waitForTimeout(2500);
  const url = await app.evaluate(({ webContents }) => {
    const wv = webContents.getAllWebContents().find(wc => wc.hostWebContents);
    return wv ? wv.getURL() : '';
  });
  console.log('after ↓+Enter, webview URL:', url);
  const navigated = url.includes('github.com');
  console.log(navigated ? '✓ 选中建议后导航' : '✗ 没导航');

  await app.close();
  process.exit(hasGithub && navigated ? 0 : 1);
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

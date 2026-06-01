const { _electron: electron } = require('@playwright/test');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();
const fs = require('fs');
const OUT = path.join(__dirname, '_out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, "..")], cwd: path.join(__dirname, ".."), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.waitForTimeout(800);  // launcher ready-to-show 之后再点（沙箱启动稍慢）

  // 点 📚 书签 pill；带重试
  let bm = null;
  for (let i = 0; i < 3; i++) {
    try {
      await launcher.click('#btn-bm');
      bm = await app.waitForEvent('window', { timeout: 8000 });
      break;
    } catch (e) {
      console.log(`  ⚠️ 第 ${i+1} 次点 #btn-bm 超时，重试`);
    }
  }
  if (!bm) throw new Error('bm manager 没开起来');
  await bm.waitForLoadState('domcontentloaded');
  await bm.waitForTimeout(1500);
  console.log('bm manager URL:', bm.url());
  await bm.screenshot({ path: path.join(OUT, 'bm_manager.png') });

  const dump = await bm.evaluate(() => {
    return {
      title: document.title,
      hasFolderTree: !!document.querySelector('.folder-tree, .tree, [class*=folder]'),
      hasSidebar: !!document.querySelector('aside, .sidebar, [class*=side]'),
      bookmarkRows: document.querySelectorAll('.bm-row, .bookmark, [class*=bookmark]').length,
      buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim().slice(0,20)),
    };
  });
  console.log('bm dump:', JSON.stringify(dump, null, 2));

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });

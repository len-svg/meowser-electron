// 验证 webview 的 UA 已伪装成 Chrome（不含 Electron/Meowser），permission/device handler 已挂上
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');
const _SB = createSandbox();

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, "..")], cwd: path.join(__dirname, ".."), env: _SB.env });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');

  // 点 RUN 开浏览器窗
  await launcher.click('.run');
  const win = await app.waitForEvent('window', { timeout: 10000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 让 webview 加载一个能回报 UA 的页面
  await win.evaluate(() => new Promise(r => setTimeout(r, 500)));
  await win.evaluate(() => {
    const wv = document.querySelector('webview');
    wv.src = 'data:text/html,<script>document.title=navigator.userAgent</script>';
  });
  await win.waitForTimeout(2000);
  const webviewUA = await win.evaluate(() => {
    const wv = document.querySelector('webview');
    return wv.getTitle();
  });
  console.log('=== webview UA ===');
  console.log(' ', webviewUA);

  const hasChrome   = /Chrome\/\d+\.\d+\.\d+\.\d+/.test(webviewUA);
  const hasElectron = /Electron/i.test(webviewUA);
  const hasMeowser  = /Meowser/i.test(webviewUA);
  console.log('  contains "Chrome/x.y.z.w":', hasChrome);
  console.log('  contains "Electron":', hasElectron);
  console.log('  contains "Meowser":', hasMeowser);

  // 验证 session 装上了 permission/device/select-hid-device handler
  const handlers = await app.evaluate(async ({ session }) => {
    const ses = session.fromPartition('persist:meowser-p_default');
    return {
      hasSelectHid: ses.listenerCount('select-hid-device') > 0,
      hasSelectUsb: ses.listenerCount('select-usb-device') > 0,
    };
  });
  console.log('\n=== session handlers ===');
  console.log(' ', JSON.stringify(handlers));

  let ok = true;
  if (!hasChrome)   { console.error('✗ UA 不含 Chrome/x.y.z.w —— Google 仍会拦截 WebAuthn'); ok = false; }
  if (hasElectron)  { console.error('✗ UA 仍含 Electron —— Google 仍会拦截 WebAuthn'); ok = false; }
  if (hasMeowser)   { console.error('✗ UA 仍含 Meowser —— 部分网站会拦'); ok = false; }
  if (!handlers.hasSelectHid) { console.error('✗ select-hid-device 没装 handler —— FIDO key 不会被选'); ok = false; }
  if (!handlers.hasSelectUsb) { console.error('✗ select-usb-device 没装 handler'); ok = false; }

  await app.close();
  if (!ok) process.exit(1);
  console.log('\n✓ YubiKey 前置条件全部满足（UA + 设备选择 handler）');
})().catch(e => { console.error('✗ FAIL', e); process.exit(1); });

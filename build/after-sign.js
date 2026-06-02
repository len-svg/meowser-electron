// 在 electron-builder 默认签名后追加一次"深度 ad-hoc 签名"
// 默认 identity:null 只签 .app 外壳，不深入签 helpers / frameworks。
// macOS Sequoia 对深度未签名的二进制更严格 → "已损坏" / "无法验证开发者"
// 这里 codesign --deep --force --sign - 强制 ad-hoc 重签所有子二进制，
// 用户再加一次 xattr -dr com.apple.quarantine 就能开。
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`[after-sign] 深度 ad-hoc 签名: ${appPath}`);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    console.log('[after-sign] ✓ 深度签名完成');
    // 移除 codesign 自动加的 quarantine（如果有）
    try {
      execSync(`xattr -dr com.apple.quarantine "${appPath}"`, { stdio: 'ignore' });
    } catch {}
  } catch (e) {
    console.error('[after-sign] codesign 失败:', e.message);
    // 不抛 — build 继续，用户装的时候自己跑 xattr
  }
};

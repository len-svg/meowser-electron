// 验证打包配置：universal binary + after-sign 钩子 + Gatekeeper 兼容
const fs = require('fs');
const path = require('path');

let failures = [];
function check(name, ok, detail) {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures.push(name);
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const build = pkg.build || {};
const mac = build.mac || {};

console.log('=== build target arch ===');
const targets = mac.target || [];
const archSets = targets.map(t => new Set(t.arch || []));
check('mac target arch 包含 arm64 (M1-M4)', archSets.every(s => s.has('arm64')));
check('mac target arch 包含 x64 (Intel Mac)', archSets.every(s => s.has('x64')));

console.log('\n=== Gatekeeper / 签名 hook ===');
check('hardenedRuntime: false', mac.hardenedRuntime === false);
check('gatekeeperAssess: false', mac.gatekeeperAssess === false);
check('identity: null (ad-hoc)', mac.identity === null);
check('afterSign hook 已配置', !!build.afterSign);
if (build.afterSign) {
  const hookPath = path.join(__dirname, '..', build.afterSign);
  check('afterSign 脚本文件存在', fs.existsSync(hookPath), build.afterSign);
  if (fs.existsSync(hookPath)) {
    const src = fs.readFileSync(hookPath, 'utf8');
    check('afterSign 调用 codesign --deep', /codesign[\s\S]*--deep/.test(src));
    check('afterSign 调用 xattr (除 quarantine)', /xattr.*quarantine/.test(src));
  }
}

console.log('\n=== 文档 ===');
const installMd = path.join(__dirname, '..', 'INSTALL.md');
check('INSTALL.md 存在', fs.existsSync(installMd));
if (fs.existsSync(installMd)) {
  const md = fs.readFileSync(installMd, 'utf8');
  check('INSTALL.md 含 xattr 命令', /xattr.*com\.apple\.quarantine/.test(md));
  check('INSTALL.md 提到 M4', /M4/.test(md));
}

console.log('\n=== 自动更新配置 ===');
check('publish.provider = github', Array.isArray(build.publish) && build.publish.some(p => p.provider === 'github'));

if (failures.length === 0) {
  console.log('\n✓ build config 全过');
  process.exit(0);
} else {
  console.error('\n✗ 失败:', failures);
  process.exit(1);
}

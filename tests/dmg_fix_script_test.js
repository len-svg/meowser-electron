// 验证 dmg 修复脚本和打包配置
const fs = require('fs');
const path = require('path');

let failures = [];
function check(name, ok, detail) {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures.push(name);
}

console.log('=== 修复.command 脚本 ===');
const scriptPath = path.join(__dirname, '..', 'build', '修复.command');
check('build/修复.command 存在', fs.existsSync(scriptPath));
if (fs.existsSync(scriptPath)) {
  const stat = fs.statSync(scriptPath);
  check('可执行位 (0o100)', !!(stat.mode & 0o100), `mode=${(stat.mode & 0o777).toString(8)}`);
  const src = fs.readFileSync(scriptPath, 'utf8');
  check('含 xattr -cr 命令', /xattr.*-cr/.test(src));
  check('引用 /Applications/Meowser.app', src.includes('/Applications/Meowser.app'));
  check('shebang 是 bash', src.startsWith('#!/bin/bash'));
}

console.log('\n=== package.json dmg.contents 配置 ===');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const contents = pkg.build && pkg.build.dmg && pkg.build.dmg.contents;
check('dmg.contents 是数组', Array.isArray(contents));
if (Array.isArray(contents)) {
  const fixEntry = contents.find(c => c.path === 'build/修复.command');
  check('contents 含 修复.command', !!fixEntry);
  if (fixEntry) {
    check('用 name 改成中文可读', fixEntry.name && fixEntry.name.includes('双击修复'));
  }
  const appEntry = contents.find(c => c.type === 'file' && !c.path);
  check('contents 仍含 app 入口', !!appEntry);
  const linkEntry = contents.find(c => c.type === 'link' && c.path === '/Applications');
  check('contents 仍含 Applications 软链', !!linkEntry);
}

if (failures.length === 0) { console.log('\n✓ dmg fix script 配置全过'); process.exit(0); }
console.error('\n✗ 失败:', failures); process.exit(1);

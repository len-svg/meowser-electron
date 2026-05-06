// 一键导出 ~/.meowser → zip ；从 zip 导入
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const DATA_DIR = path.join(os.homedir(), '.meowser');

function exportToZip(dstZip) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DATA_DIR)) return reject(new Error('~/.meowser 不存在'));
    // -r 递归 -X 不存元数据 -x 排除 cache
    execFile('zip', ['-r', '-X', dstZip, '.', '-x', 'cache/*', '-x', '*.DS_Store'], { cwd: DATA_DIR },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        const stat = fs.statSync(dstZip);
        resolve({ path: dstZip, size: stat.size });
      });
  });
}

function importFromZip(srcZip, { overwrite = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(srcZip)) return reject(new Error('zip 文件不存在'));
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const args = [overwrite ? '-o' : '-n', srcZip, '-d', DATA_DIR];
    execFile('unzip', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ ok: true });
    });
  });
}

module.exports = { exportToZip, importFromZip, DATA_DIR };

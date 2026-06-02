// 测试隔离：临时 HOME 目录 + 默认 profile，保证不污染真实 ~/.meowser
const fs = require('fs');
const path = require('path');
const os = require('os');

function createSandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'meowser-test-'));
  // 预置一份 profiles.json 跟 main.js 的 DEFAULT_PROFILES 一致，避免每次启动重写
  const dataDir = path.join(home, '.meowser');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'profiles.json'), JSON.stringify([
    { id: 'p_default', name: '默认', note: '测试沙箱', emoji: '🐱', mode: 'work', theme: 'yellow', proxy: { type: 'direct' }, show_bookmarks: false },
    { id: 'p_work',    name: '工作', note: '测试沙箱', emoji: '💻', mode: 'work', theme: 'green',  proxy: { type: 'direct' }, show_bookmarks: false },
    { id: 'p_fun',     name: '娱乐', note: '测试沙箱', emoji: '🎮', mode: 'slack', theme: 'red',   proxy: { type: 'direct' }, show_bookmarks: false },
  ], null, 2));

  // 进程退出时自动清理
  process.on('exit', () => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  });

  return {
    home,
    dataDir,
    paths: {
      history:  path.join(dataDir, 'history'),
      sessions: path.join(dataDir, 'sessions'),
      prefs:    path.join(dataDir, 'prefs'),
      bookmarks:path.join(dataDir, 'bookmarks'),
      extensions: path.join(dataDir, 'extensions'),
      logs:     path.join(dataDir, 'logs'),
    },
    // 给 electron.launch 用：env 注入 HOME 让 main.js 把所有数据写到沙箱
    env: { ...process.env, HOME: home, MEOWSER_TEST: '1' },
  };
}

module.exports = { createSandbox };

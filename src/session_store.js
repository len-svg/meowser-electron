// 会话恢复：~/.meowser/sessions/<pid>.json
// 关闭窗口/退出 app 时记录该 profile 当前所有打开窗口的 URL；下次启动可恢复
// 字段：windows[] = { url, title, is_small, is_pinned, saved_at }
const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSIONS_DIR = path.join(os.homedir(), '.meowser', 'sessions');

function fileFor(profileId) { return path.join(SESSIONS_DIR, `${profileId}.json`); }

function load(profileId) {
  try {
    const fp = fileFor(profileId);
    if (!fs.existsSync(fp)) return { windows: [] };
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch { return { windows: [] }; }
}

// 原子写。windows 为空时不删文件（标记空，避免冲忽然启动一个空快照覆盖）
function save(profileId, snapshot) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const fp = fileFor(profileId);
  const tmp = fp + '.tmp';
  const data = { ...snapshot, saved_at: new Date().toISOString() };
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

function clear(profileId) {
  save(profileId, { windows: [] });
}

// 入参：当前所有 BrowserWindow 的 metadata 列表（只包含 profile_id === 我们要保存的）
function saveFromWindows(profileId, windows) {
  const filtered = (windows || []).filter(w => w.profile_id === profileId && !w.is_incognito);
  save(profileId, {
    windows: filtered.map(w => ({
      url: w.url || '',
      title: w.title || '',
      is_small: !!w.is_small,
      is_pinned: !!w.always_on_top,
    })),
  });
}

module.exports = { load, save, clear, saveFromWindows };

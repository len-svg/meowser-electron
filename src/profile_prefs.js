// per-profile 运行偏好持久化：~/.meowser/prefs/<pid>.json
// 字段命名遵循团队规范：snake_case，无 user_id，时间字段 _at 后缀
const fs = require('fs');
const path = require('path');
const os = require('os');

const PREFS_DIR = path.join(os.homedir(), '.meowser', 'prefs');

const DEFAULTS = {
  always_on_top: true,    // 默认置顶（与 createBrowserWindow 一致）
  auto_shrink:   false,   // 失焦自动缩成小窗
  opacity:       100,     // 0-100
  updated_at:    null,    // ISO8601 UTC，最后一次修改
};

function fileFor(profileId) { return path.join(PREFS_DIR, `${profileId}.json`); }

function load(profileId) {
  try {
    const fp = fileFor(profileId);
    if (!fs.existsSync(fp)) return { ...DEFAULTS };
    const saved = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}

// 原子写：先 .tmp，再 rename。崩溃 / 断电不会损坏配置
function save(profileId, prefs) {
  fs.mkdirSync(PREFS_DIR, { recursive: true });
  const fp = fileFor(profileId);
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...prefs, updated_at: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

function setOne(profileId, key, value) {
  if (!(key in DEFAULTS)) return;  // 防写未知字段
  const cur = load(profileId);
  cur[key] = value;
  save(profileId, cur);
}

module.exports = { load, save, setOne, DEFAULTS };

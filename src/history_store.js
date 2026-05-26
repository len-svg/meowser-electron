// per-profile 浏览历史：~/.meowser/history/<pid>.json
// 字段：url / title / first_visit_at / last_visit_at / visit_count
// 命名规范：_at 后缀 + ISO8601 UTC；snake_case；profile_id 不是 user_id
const fs = require('fs');
const path = require('path');
const os = require('os');

const HISTORY_DIR = path.join(os.homedir(), '.meowser', 'history');
const MAX_ENTRIES = 5000;

function fileFor(profileId) { return path.join(HISTORY_DIR, `${profileId}.json`); }

function load(profileId) {
  try {
    const fp = fileFor(profileId);
    if (!fs.existsSync(fp)) return [];
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch { return []; }
}

// 原子写
function save(profileId, list) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const fp = fileFor(profileId);
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 0), 'utf8');  // 紧凑，省空间
  fs.renameSync(tmp, fp);
}

// 加一条；同 url 去重并提升 visit_count；同时也忽略一些"非真实访问"的协议
function add(profileId, url, title) {
  if (!url) return;
  // 过滤：file:// 本地首页、about:、chrome://、扩展页面
  if (/^(file:|about:|chrome:|chrome-extension:|data:)/i.test(url)) return;

  const list = load(profileId);
  const now = new Date().toISOString();
  const i = list.findIndex(h => h.url === url);
  if (i >= 0) {
    // 已存在：更新 last_visit_at + 标题（如果新标题更具体）+ visit_count++
    list[i].last_visit_at = now;
    list[i].visit_count = (list[i].visit_count || 1) + 1;
    if (title && title !== url && (!list[i].title || list[i].title === url)) list[i].title = title;
    // 移到末尾（最近）
    const item = list.splice(i, 1)[0];
    list.push(item);
  } else {
    list.push({
      url,
      title: title || url,
      first_visit_at: now,
      last_visit_at: now,
      visit_count: 1,
    });
  }

  // 超额裁掉最旧
  while (list.length > MAX_ENTRIES) list.shift();

  save(profileId, list);
}

function clear(profileId) {
  save(profileId, []);
}

function remove(profileId, url) {
  const list = load(profileId).filter(h => h.url !== url);
  save(profileId, list);
}

// search: 简单按 title / url 子串匹配，从最近往前
function search(profileId, query, limit = 200) {
  const q = String(query || '').toLowerCase();
  const list = load(profileId);
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
    const h = list[i];
    if (!q ||
        (h.title || '').toLowerCase().includes(q) ||
        (h.url || '').toLowerCase().includes(q)) {
      out.push(h);
    }
  }
  return out;
}

module.exports = { load, save, add, clear, remove, search, MAX_ENTRIES };

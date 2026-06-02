// per-profile 书签存储 ~/.meowser/bookmarks/<profileId>.json
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.meowser');
const BM_DIR = path.join(DATA_DIR, 'bookmarks');

function fileFor(profileId) {
  return path.join(BM_DIR, `${profileId}.json`);
}

function load(profileId) {
  try {
    const fp = fileFor(profileId);
    if (!fs.existsSync(fp)) return [];
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) { return []; }
}

function save(profileId, list) {
  fs.mkdirSync(BM_DIR, { recursive: true });
  fs.writeFileSync(fileFor(profileId), JSON.stringify(list, null, 2), 'utf8');
}

function add(profileId, item) {
  const list = load(profileId);
  if (!item.url) return list;
  if (list.some(b => b.url === item.url)) return list;
  list.push({ url: item.url, title: item.title || item.url, folder: item.folder || '', ts: Date.now() });
  save(profileId, list);
  return list;
}

function remove(profileId, url) {
  const list = load(profileId).filter(b => b.url !== url);
  save(profileId, list);
  return list;
}

// 把书签移动到某文件夹（folder='' 表示未分类）
function setFolder(profileId, url, folder) {
  const list = load(profileId);
  const b = list.find(x => x.url === url);
  if (b) { b.folder = folder || ''; save(profileId, list); }
  return list;
}

// 列出所有文件夹名（去重，排序，不含空）
function folders(profileId) {
  const set = new Set();
  load(profileId).forEach(b => { if (b.folder) set.add(b.folder); });
  return [...set].sort();
}

// 重命名文件夹（把所有该 folder 的书签改名）
function renameFolder(profileId, oldName, newName) {
  const list = load(profileId);
  list.forEach(b => { if (b.folder === oldName) b.folder = newName || ''; });
  save(profileId, list);
  return list;
}

function reorder(profileId, urls) {
  const list = load(profileId);
  const m = new Map(list.map(b => [b.url, b]));
  const out = urls.map(u => m.get(u)).filter(Boolean);
  // 把没在 urls 里的尾部追加（保险）
  list.forEach(b => { if (!urls.includes(b.url)) out.push(b); });
  save(profileId, out);
  return out;
}

// 从 Chrome 默认 profile 导入
function importFromChrome(profileId) {
  const cb = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default/Bookmarks');
  if (!fs.existsSync(cb)) return { ok: false, msg: 'Chrome 书签文件不存在' };
  try {
    const j = JSON.parse(fs.readFileSync(cb, 'utf8'));
    const out = [];
    // 保留 Chrome 文件夹层级：用最近一层文件夹名作为 folder
    function walk(n, folder) {
      if (!n) return;
      if (n.type === 'url') out.push({ url: n.url, title: n.name, folder: folder || '', ts: Date.now() });
      else if (n.type === 'folder' && n.children) {
        // 顶层 bookmark_bar/other/synced 不当文件夹；子文件夹名才用
        n.children.forEach(c => walk(c, n.name || folder));
      } else if (n.children) {
        n.children.forEach(c => walk(c, folder));
      }
    }
    if (j.roots) ['bookmark_bar', 'other', 'synced'].forEach(k => {
      const root = j.roots[k];
      if (root && root.children) root.children.forEach(c => walk(c, ''));
    });
    const cur = load(profileId);
    const seen = new Set(cur.map(b => b.url));
    out.forEach(b => { if (!seen.has(b.url)) cur.push(b); });
    save(profileId, cur);
    return { ok: true, count: out.length };
  } catch (e) { return { ok: false, msg: e.message }; }
}

// 导出 Chrome 兼容 HTML（Netscape Bookmark File Format）
function exportHtml(profileId) {
  const list = load(profileId);
  const items = list.map(b =>
    `        <DT><A HREF="${escAttr(b.url)}" ADD_DATE="${Math.floor((b.ts || Date.now())/1000)}">${escHtml(b.title || b.url)}</A>`
  ).join('\n');
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Meowser - ${escHtml(profileId)}</H3>
    <DL><p>
${items}
    </DL><p>
</DL><p>
`;
}

// 导入 Chrome HTML 书签
function importHtml(profileId, html) {
  const re = /<A[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ url: decodeEntities(m[1]), title: decodeEntities(m[2]), ts: Date.now() });
  }
  const cur = load(profileId);
  const seen = new Set(cur.map(b => b.url));
  out.forEach(b => { if (!seen.has(b.url)) cur.push(b); });
  save(profileId, cur);
  return out.length;
}

function escHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escAttr(s){return escHtml(s);}
function decodeEntities(s){return String(s||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}

module.exports = { load, save, add, remove, reorder, setFolder, folders, renameFolder, importFromChrome, exportHtml, importHtml };
